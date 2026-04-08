"""
GuidelineExtractor — PDF/text → guideline_chunks records.

Wraps the paragraph-aware chunking from the original ingest_pdf.py and
writes to the new guideline_chunks table with the full rich schema.
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from typing import Any

log = logging.getLogger(__name__)

CHUNK_SIZE = 800    # target tokens (~3200 chars)
OVERLAP = 100       # token overlap between chunks


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------


def _extract_text_with_outline(pdf_path: str) -> tuple[str, dict[int, str]]:
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    page_headings: dict[int, str] = {}

    def _walk(outline, depth: int = 0) -> None:
        for item in outline:
            if isinstance(item, list):
                _walk(item, depth + 1)
            else:
                try:
                    page_num = reader.get_destination_page_number(item)
                    page_headings[page_num] = item.title
                except Exception:
                    pass

    if reader.outline:
        _walk(reader.outline)

    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if i in page_headings:
            text = f"\n## {page_headings[i]}\n{text}"
        pages.append(text)

    return "\n".join(pages), page_headings


def _para_chunks(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    paras = re.split(r"\n{2,}", text.strip())
    chunks: list[str] = []
    current = ""

    for para in paras:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) + 1 <= max_chars:
            current = (current + "\n\n" + para).strip()
        else:
            if current:
                chunks.append(current)
            # If single para exceeds max, hard-split it
            if len(para) > max_chars:
                for start in range(0, len(para), max_chars - overlap_chars):
                    chunks.append(para[start : start + max_chars])
                current = ""
            else:
                current = para

    if current:
        chunks.append(current)
    return chunks


# ---------------------------------------------------------------------------
# Main ingest function
# ---------------------------------------------------------------------------


async def ingest_guideline(
    entry: dict,
    settings: Any,
    db: Any,
    dry_run: bool = False,
) -> None:
    """Extract, diff, embed, and upsert one guideline from the manifest entry.

    Manifest entry shape:
    {
      "path": "docs/kenya_clinical_guidelines_2016.pdf",
      "guideline_id": "kcg-2016",
      "guideline_version": "2016",
      "title": "Kenya Clinical Guidelines",
      "issuing_body": "Kenya MoH",
      "pub_year": 2016,
      "geography": "Kenya",
      "document_type": "national_guideline",
      "evidence_tier": 1,
      "source_url": "",     # optional direct URL
      "licence": ""         # optional licence string
    }
    """
    from scripts.ingest.pipeline import (
        content_hash,
        embed_chunks,
        filter_novel_chunks,
        mark_guideline_superseded,
        upsert_qdrant,
        upsert_supabase,
    )

    guideline_id = entry["guideline_id"]
    guideline_version = str(entry.get("guideline_version", entry.get("pub_year", "1")))
    title = entry["title"]
    issuing_body = entry.get("issuing_body", "")
    pub_year = int(entry.get("pub_year", 0)) or None
    evidence_tier = int(entry.get("evidence_tier", 1))
    document_type = entry.get("document_type", "national_guideline")
    geography = entry.get("geography", "")
    source_url = entry.get("source_url", "")
    licence = entry.get("licence", "")

    log.info("--- Guideline: %s @ %s ---", guideline_id, guideline_version)

    # Extract text
    pdf_path = entry.get("path", "")
    if pdf_path:
        full_text, _ = _extract_text_with_outline(pdf_path)
    elif entry.get("text"):
        full_text = entry["text"]
    else:
        log.error("No 'path' or 'text' in manifest entry for %s", guideline_id)
        return

    if not full_text.strip():
        log.error("No text extracted for %s", guideline_id)
        return

    # Chunk
    max_chars = CHUNK_SIZE * 4
    overlap_chars = OVERLAP * 4
    raw_texts = _para_chunks(full_text, max_chars, overlap_chars)
    total_chunks = len(raw_texts)

    raw_chunks = []
    for i, text in enumerate(raw_texts):
        chunk_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{guideline_id}:{guideline_version}:{i}"))
        raw_chunks.append({
            "id": chunk_id,
            "content": text,
            "content_hash": content_hash(text),
            "chunk_index": i,
            "total_chunks": total_chunks,
            "word_count": len(text.split()),
            "guideline_id": guideline_id,
            "guideline_version": guideline_version,
            "is_current_version": True,
            "guideline_title": title,
            "issuing_body": issuing_body,
            "pub_year": pub_year,
            "evidence_tier": evidence_tier,
            "document_type": document_type,
            "geographic_scope": geography,
            "source_url": source_url,
            "licence": licence,
            "chunk_type": "text",
            # Qdrant payload fields
            "doc_type": "guideline",
            "cascading_path": f"{title} > chunk {i + 1}",
            "publisher": issuing_body,
        })

    log.info("Extracted %d chunks from %s", len(raw_chunks), guideline_id)

    if dry_run:
        for c in raw_chunks[:3]:
            log.info("  [DRY RUN] %s | %d words | hash=%s", c["id"], c["word_count"], c["content_hash"][:12])
        log.info("  [DRY RUN] ... (%d total, not written)", len(raw_chunks))
        return

    # Check if this version already exists in DB — if so, supersede old version
    try:
        existing_versions = (
            await db.table(settings.guideline_chunk_table)
            .select("guideline_version")
            .eq("guideline_id", guideline_id)
            .eq("is_current_version", True)
            .limit(1)
            .execute()
        )
        if existing_versions.data:
            old_version = existing_versions.data[0]["guideline_version"]
            if old_version != guideline_version:
                log.info("Superseding old version %s with %s", old_version, guideline_version)
                await mark_guideline_superseded(guideline_id, old_version, guideline_version, db, settings)
    except Exception as exc:
        log.warning("Could not check existing versions: %s", exc)

    # Novelty filter — only embed and upsert changed/new chunks
    novel_chunks = await filter_novel_chunks(
        raw_chunks,
        table=settings.guideline_chunk_table,
        hash_field="content_hash",
        filter_field="guideline_id",
        filter_value=guideline_id,
        db=db,
    )

    if not novel_chunks:
        log.info("All chunks already current for %s — nothing to do", guideline_id)
        return

    # Embed
    await embed_chunks(novel_chunks, settings)

    # Upsert to Supabase guideline_chunks (strip embedding before DB write)
    await upsert_supabase(novel_chunks, settings.guideline_chunk_table, db)

    # Upsert to Qdrant (full payload including embedding)
    if settings.qdrant_url:
        await upsert_qdrant(novel_chunks, settings.qdrant_collection, settings)

    log.info("Done: %d novel chunks ingested for %s", len(novel_chunks), guideline_id)
