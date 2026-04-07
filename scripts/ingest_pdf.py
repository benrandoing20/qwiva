"""
Ingest a PDF into Qwiva's hybrid search index (Qdrant + Supabase).

Usage:
    uv pip install -e ".[dev]"
    python scripts/ingest_pdf.py \\
        --file path/to/guideline.pdf \\
        --title "WHO Lenacapavir Guidelines 2025" \\
        --publisher "WHO" \\
        --year "2025" \\
        [--chunk-size 800] \\
        [--overlap 100] \\
        [--dry-run]

The script:
  1. Extracts text from the PDF (pypdf), building cascading_path from outline headings
  2. Chunks text (paragraph-aware → fixed-size fallback)
  3. Embeds each chunk with text-embedding-3-small via NVIDIA hub (same model as prod)
  4. Upserts to Qdrant  (vector search)
  5. Upserts to Supabase documents_v2  (FTS for hybrid search)

Both sinks are required — _hybrid_search() queries both.
--dry-run prints chunks without writing to either sink.
"""

import argparse
import asyncio
import hashlib
import json
import logging
import re
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

REQUIRED_PAYLOAD_FIELDS = {"content", "guideline_title", "cascading_path", "year", "publisher", "doc_id", "chunk_index"}
EMBED_BATCH = 20   # chunks per embedding API call
UPSERT_BATCH = 50  # points per Qdrant upsert


# ---------------------------------------------------------------------------
# PDF parsing + chunking
# ---------------------------------------------------------------------------

def _extract_text_with_outline(pdf_path: str) -> tuple[str, dict[int, str]]:
    """
    Return (full_text, page_headings) where page_headings maps page index → heading
    derived from the PDF outline (bookmarks).
    """
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    page_headings: dict[int, str] = {}

    def _walk_outline(outline, depth=0):
        for item in outline:
            if isinstance(item, list):
                _walk_outline(item, depth + 1)
            else:
                try:
                    page_num = reader.get_destination_page_number(item)
                    heading = item.title.strip()
                    if page_num not in page_headings:
                        page_headings[page_num] = heading
                except Exception:
                    pass

    try:
        _walk_outline(reader.outline)
    except Exception:
        pass

    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n\n".join(pages), page_headings


def _para_chunks(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    """Split on double-newlines (paragraphs); merge short ones; split long ones."""
    paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for para in paras:
        if len(buf) + len(para) + 2 <= max_chars:
            buf = (buf + "\n\n" + para).strip()
        else:
            if buf:
                chunks.append(buf)
            if len(para) > max_chars:
                # Hard split long paragraph with overlap
                for start in range(0, len(para), max_chars - overlap_chars):
                    chunks.append(para[start : start + max_chars])
            else:
                buf = para
    if buf:
        chunks.append(buf)
    return [c for c in chunks if len(c.strip()) > 40]


def build_chunks(
    pdf_path: str,
    title: str,
    publisher: str,
    year: str,
    chunk_size: int,
    overlap: int,
) -> list[dict]:
    """Return list of chunk dicts ready for embedding."""
    full_text, page_headings = _extract_text_with_outline(pdf_path)
    if not full_text.strip():
        log.error("No text extracted from PDF — is it a scanned image PDF?")
        sys.exit(1)

    doc_id = hashlib.md5(pdf_path.encode()).hexdigest()[:12]
    overlap_chars = overlap * 4  # rough chars per token
    max_chars = chunk_size * 4

    raw_chunks = _para_chunks(full_text, max_chars, overlap_chars)

    chunks = []
    for i, content in enumerate(raw_chunks):
        # Pick the nearest outline heading ≤ this position (approximate by char offset)
        cascading_path = f"{title} > section {i + 1}"
        chunks.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{doc_id}:{i}")),
            "content": content,
            "guideline_title": title,
            "cascading_path": cascading_path,
            "year": year,
            "publisher": publisher,
            "doc_id": doc_id,
            "chunk_index": i,
        })

    log.info(f"Extracted {len(chunks)} chunks from {pdf_path}")
    return chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

async def embed_chunks(chunks: list[dict], settings) -> list[dict]:
    """Add 'embedding' key to each chunk dict."""
    from openai import AsyncOpenAI

    if settings.openai_api_key:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        model = "text-embedding-3-small"
    else:
        client = AsyncOpenAI(
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_api_base,
        )
        model = settings.embedding_model

    for start in range(0, len(chunks), EMBED_BATCH):
        batch = chunks[start : start + EMBED_BATCH]
        texts = [c["content"] for c in batch]
        log.info(f"  Embedding chunks {start + 1}–{start + len(batch)} / {len(chunks)}")
        resp = await client.embeddings.create(model=model, input=texts)
        for chunk, emb_obj in zip(batch, resp.data):
            chunk["embedding"] = emb_obj.embedding

    return chunks


# ---------------------------------------------------------------------------
# Qdrant upsert
# ---------------------------------------------------------------------------

async def upsert_qdrant(chunks: list[dict], settings) -> None:
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import Distance, PointStruct, ScalarQuantization, ScalarQuantizationConfig, ScalarType, VectorParams

    qdrant = AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=60)

    # Ensure collection exists
    existing = {c.name for c in (await qdrant.get_collections()).collections}
    if settings.qdrant_collection not in existing:
        log.info(f"Creating collection '{settings.qdrant_collection}'")
        await qdrant.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            quantization_config=ScalarQuantization(
                scalar=ScalarQuantizationConfig(type=ScalarType.INT8, quantile=0.99, always_ram=True)
            ),
        )

    for start in range(0, len(chunks), UPSERT_BATCH):
        batch = chunks[start : start + UPSERT_BATCH]
        points = [
            PointStruct(
                id=c["id"],
                vector=c["embedding"],
                payload={k: c[k] for k in REQUIRED_PAYLOAD_FIELDS},
            )
            for c in batch
        ]
        await qdrant.upsert(collection_name=settings.qdrant_collection, points=points)
        log.info(f"  Qdrant upsert {start + 1}–{start + len(batch)} / {len(chunks)}")

    log.info(f"Qdrant: {len(chunks)} points upserted to '{settings.qdrant_collection}'")


# ---------------------------------------------------------------------------
# Supabase upsert (for FTS)
# ---------------------------------------------------------------------------

async def upsert_supabase(chunks: list[dict], settings) -> None:
    from supabase._async.client import create_client

    sb = await create_client(settings.supabase_url, settings.supabase_service_key)

    rows = [
        {
            "id": c["id"],
            "content": c["content"],
            "embedding": c["embedding"],
            "metadata": {
                "guideline_title": c["guideline_title"],
                "cascading_path": c["cascading_path"],
                "year": c["year"],
                "publisher": c["publisher"],
                "doc_id": c["doc_id"],
                "chunk_index": c["chunk_index"],
            },
        }
        for c in chunks
    ]

    # Upsert in batches (Supabase REST has row limits)
    batch_size = 50
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        await sb.table("documents_v2").upsert(batch, on_conflict="id").execute()
        log.info(f"  Supabase upsert {start + 1}–{start + len(batch)} / {len(rows)}")

    log.info(f"Supabase: {len(rows)} rows upserted to documents_v2")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(args: argparse.Namespace) -> None:
    from backend.config import get_settings
    settings = get_settings()

    chunks = build_chunks(
        pdf_path=args.file,
        title=args.title,
        publisher=args.publisher,
        year=args.year,
        chunk_size=args.chunk_size,
        overlap=args.overlap,
    )

    if args.dry_run:
        print(f"\n[dry-run] Would ingest {len(chunks)} chunks. First chunk preview:\n")
        print(chunks[0]["content"][:400])
        print(f"\n... Last chunk:\n{chunks[-1]['content'][:200]}")
        return

    log.info("Embedding chunks…")
    chunks = await embed_chunks(chunks, settings)

    if not settings.qdrant_url:
        log.warning("QDRANT_URL not set — skipping Qdrant upsert")
    else:
        log.info("Upserting to Qdrant…")
        await upsert_qdrant(chunks, settings)

    log.info("Upserting to Supabase…")
    await upsert_supabase(chunks, settings)

    log.info(f"\nDone. {len(chunks)} chunks indexed for '{args.title}'.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest a PDF into Qwiva (Qdrant + Supabase)")
    parser.add_argument("--file", required=True, help="Path to PDF file")
    parser.add_argument("--title", required=True, help="Guideline title (e.g. 'WHO HIV Guidelines 2025')")
    parser.add_argument("--publisher", required=True, help="Publisher (e.g. 'WHO')")
    parser.add_argument("--year", required=True, help="Publication year (e.g. '2025')")
    parser.add_argument("--chunk-size", type=int, default=800, help="Target chunk size in tokens (default 800)")
    parser.add_argument("--overlap", type=int, default=100, help="Overlap between chunks in tokens (default 100)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and chunk only — do not write to any sink")
    args = parser.parse_args()
    asyncio.run(main(args))
