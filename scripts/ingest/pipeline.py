"""
Unified ingestion pipeline for Qwiva.

Shared embed + upsert + novelty detection + stale cleanup logic
used by both GuidelineExtractor and DrugLabelExtractor.

Usage (run from repo root with venv active):
    python -m scripts.ingest.pipeline --manifest corpus-manifest.json
    python -m scripts.ingest.pipeline --manifest corpus-manifest.json --dry-run
    python -m scripts.ingest.pipeline --manifest corpus-manifest.json --source-type guideline
    python -m scripts.ingest.pipeline --manifest corpus-manifest.json --source-type drug
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

log = logging.getLogger(__name__)

EMBED_BATCH = 20   # chunks per embedding API call
UPSERT_BATCH = 50  # rows / points per batch write


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------


async def embed_chunks(
    chunks: list[dict],
    settings: Any,
) -> list[dict]:
    """Add 'embedding' key (list[float]) to each chunk dict in-place."""
    from openai import AsyncOpenAI

    if getattr(settings, "openai_api_key", ""):
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
        log.info("  Embedding chunks %d–%d / %d", start + 1, start + len(batch), len(chunks))
        resp = await client.embeddings.create(model=model, input=texts)
        for chunk, emb_obj in zip(batch, resp.data):
            chunk["embedding"] = emb_obj.embedding

    return chunks


# ---------------------------------------------------------------------------
# Novelty detection
# ---------------------------------------------------------------------------


async def filter_novel_chunks(
    raw_chunks: list[dict],
    table: str,
    hash_field: str,
    filter_field: str,
    filter_value: str,
    db: Any,
) -> list[dict]:
    """Return only chunks whose content_hash is not already in the DB.

    Args:
        raw_chunks:    Chunks to check (must have 'content_hash' key).
        table:         Supabase table name (e.g. 'guideline_chunks').
        hash_field:    Column name for the hash (e.g. 'content_hash').
        filter_field:  Column to scope the lookup (e.g. 'guideline_id').
        filter_value:  Value to match (e.g. 'kcg-2016').
        db:            Async Supabase client.
    """
    try:
        res = (
            await db.table(table)
            .select(hash_field)
            .eq(filter_field, filter_value)
            .execute()
        )
        existing_hashes = {r[hash_field] for r in (res.data or []) if r.get(hash_field)}
    except Exception as exc:
        log.warning("Could not fetch existing hashes from %s: %s — treating all as novel", table, exc)
        existing_hashes = set()

    novel = [c for c in raw_chunks if c.get("content_hash") not in existing_hashes]
    skipped = len(raw_chunks) - len(novel)
    if skipped:
        log.info("  Novelty check: %d/%d chunks already current (hash match) — skipping", skipped, len(raw_chunks))
    return novel


def content_hash(text: str) -> str:
    """Stable SHA-256 hex digest of chunk content (first 64 chars)."""
    return hashlib.sha256(text.encode()).hexdigest()[:64]


# ---------------------------------------------------------------------------
# Qdrant upsert
# ---------------------------------------------------------------------------


async def upsert_qdrant(
    chunks: list[dict],
    collection: str,
    settings: Any,
) -> None:
    """Upsert chunks (must have 'embedding' and 'id' keys) to Qdrant."""
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import (
        Distance,
        PointStruct,
        ScalarQuantization,
        ScalarQuantizationConfig,
        ScalarType,
        VectorParams,
    )

    qdrant = AsyncQdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=60,
    )

    # Ensure collection exists
    existing = {c.name for c in (await qdrant.get_collections()).collections}
    if collection not in existing:
        log.info("Creating Qdrant collection '%s'", collection)
        await qdrant.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            quantization_config=ScalarQuantization(
                scalar=ScalarQuantizationConfig(
                    type=ScalarType.INT8, quantile=0.99, always_ram=True
                )
            ),
        )
        # Create payload indexes for efficient filtering
        from qdrant_client.models import PayloadSchemaType
        await qdrant.create_payload_index(collection, "doc_type", PayloadSchemaType.KEYWORD)
        await qdrant.create_payload_index(collection, "is_current_version", PayloadSchemaType.BOOL)
        await qdrant.create_payload_index(collection, "evidence_tier", PayloadSchemaType.INTEGER)
        log.info("Payload indexes created on doc_type, is_current_version, evidence_tier")

    for start in range(0, len(chunks), UPSERT_BATCH):
        batch = chunks[start : start + UPSERT_BATCH]
        # Build payload from all fields except the raw embedding
        points = [
            PointStruct(
                id=c["id"],
                vector=c["embedding"],
                payload={k: v for k, v in c.items() if k != "embedding"},
            )
            for c in batch
        ]
        await qdrant.upsert(collection_name=collection, points=points)
        log.info("  Qdrant upsert %d–%d / %d", start + 1, start + len(batch), len(chunks))

    log.info("Qdrant: %d points upserted to '%s'", len(chunks), collection)


# ---------------------------------------------------------------------------
# Supabase upsert
# ---------------------------------------------------------------------------


async def upsert_supabase(
    chunks: list[dict],
    table: str,
    db: Any,
) -> None:
    """Upsert chunk rows (without 'embedding' key) to a Supabase table."""
    rows = [{k: v for k, v in c.items() if k != "embedding"} for c in chunks]
    for start in range(0, len(rows), UPSERT_BATCH):
        batch = rows[start : start + UPSERT_BATCH]
        await db.table(table).upsert(batch, on_conflict="id").execute()
        log.info("  Supabase upsert %d–%d / %d", start + 1, start + len(batch), len(rows))
    log.info("Supabase: %d rows upserted to '%s'", len(rows), table)


# ---------------------------------------------------------------------------
# Stale cleanup
# ---------------------------------------------------------------------------


async def delete_stale_from_qdrant(
    chunk_ids: list[str],
    collection: str,
    settings: Any,
) -> None:
    """Delete specific points from Qdrant by ID."""
    if not chunk_ids:
        return
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import PointIdsList

    qdrant = AsyncQdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=60,
    )
    await qdrant.delete(
        collection_name=collection,
        points_selector=PointIdsList(points=chunk_ids),
    )
    log.info("Qdrant: deleted %d stale points from '%s'", len(chunk_ids), collection)


async def mark_guideline_superseded(
    guideline_id: str,
    old_version: str,
    new_version: str,
    db: Any,
    settings: Any,
) -> None:
    """Mark old guideline version as superseded in Supabase and delete from Qdrant."""
    # Fetch old chunk IDs before marking them superseded
    res = (
        await db.table(settings.guideline_chunk_table)
        .select("id")
        .eq("guideline_id", guideline_id)
        .eq("guideline_version", old_version)
        .execute()
    )
    old_ids = [r["id"] for r in (res.data or [])]

    if old_ids:
        # Mark superseded in Supabase (keep for audit; is_current_version=False
        # means they are excluded from retrieval)
        await (
            db.table(settings.guideline_chunk_table)
            .update({"is_current_version": False, "superseded_by": new_version})
            .eq("guideline_id", guideline_id)
            .eq("guideline_version", old_version)
            .execute()
        )
        log.info(
            "Marked %d chunks of %s@%s as superseded by %s",
            len(old_ids), guideline_id, old_version, new_version,
        )
        # Remove from Qdrant so they no longer surface in vector search
        await delete_stale_from_qdrant(old_ids, settings.qdrant_collection, settings)


async def replace_drug_chunks(
    drug_filter_field: str,
    drug_filter_value: str,
    new_chunk_ids: list[str],
    drug_table: str,
    db: Any,
    settings: Any,
) -> None:
    """Delete drug chunks that are no longer in the new extraction (content changed)."""
    res = (
        await db.table(drug_table)
        .select("id")
        .eq(drug_filter_field, drug_filter_value)
        .execute()
    )
    all_existing_ids = {r["id"] for r in (res.data or [])}
    stale_ids = list(all_existing_ids - set(new_chunk_ids))
    if stale_ids:
        await db.table(drug_table).delete().in_("id", stale_ids).execute()
        await delete_stale_from_qdrant(stale_ids, settings.qdrant_collection, settings)
        log.info("Removed %d stale drug chunks for %s=%s", len(stale_ids), drug_filter_field, drug_filter_value)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def run(manifest_path: str, source_type: str | None, dry_run: bool) -> None:
    from dotenv import load_dotenv
    load_dotenv()

    from backend.config import get_settings
    from backend.db import get_db
    from scripts.ingest.manifest import load_manifest
    from scripts.ingest.guideline import ingest_guideline
    from scripts.ingest.drug import ingest_drug

    settings = get_settings()
    db = await get_db()
    manifest = load_manifest(manifest_path)

    if source_type in (None, "guideline"):
        for entry in manifest.get("guidelines", []):
            await ingest_guideline(entry, settings, db, dry_run=dry_run)

    if source_type in (None, "drug"):
        for entry in manifest.get("drugs", []):
            await ingest_drug(entry, settings, db, dry_run=dry_run)


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Qwiva unified ingestion pipeline")
    parser.add_argument("--manifest", default="corpus-manifest.json")
    parser.add_argument("--source-type", choices=["guideline", "drug"], default=None,
                        help="Run only this source type (default: both)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print chunks without writing to any sink")
    args = parser.parse_args()

    asyncio.run(run(args.manifest, args.source_type, args.dry_run))
