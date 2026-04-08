"""
One-time migration: documents_v2 → guideline_chunks + re-upsert Qdrant.

Copies all existing legacy chunks from documents_v2 into guideline_chunks,
adding default values for fields that did not exist at ingestion time, then
re-upserts each point to Qdrant with the new payload fields (doc_type,
is_current_version, evidence_tier) so the version filter works correctly.

Run with --dry-run first to inspect what would be written.

Usage:
    python -m scripts.ingest.migrate_legacy
    python -m scripts.ingest.migrate_legacy --dry-run
    python -m scripts.ingest.migrate_legacy --batch-size 200
"""

from __future__ import annotations

import argparse
import asyncio
import logging

log = logging.getLogger(__name__)

PAGE_SIZE = 500  # rows per Supabase fetch


async def migrate(dry_run: bool, batch_size: int) -> None:
    from dotenv import load_dotenv
    load_dotenv()

    from backend.config import get_settings
    from backend.db import get_db
    from scripts.ingest.pipeline import upsert_qdrant, upsert_supabase

    settings = get_settings()
    db = await get_db()

    log.info("Starting migration: documents_v2 → %s", settings.guideline_chunk_table)

    # Fetch all legacy rows in pages (Supabase REST has row limits)
    all_rows = []
    offset = 0
    while True:
        res = (
            await db.table(settings.legacy_chunk_table)
            .select("id, content, embedding, metadata")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = res.data or []
        all_rows.extend(batch)
        log.info("  Fetched %d rows (total so far: %d)", len(batch), len(all_rows))
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    log.info("Total legacy rows to migrate: %d", len(all_rows))

    if dry_run:
        # Show first 3 rows
        for row in all_rows[:3]:
            meta = row.get("metadata") or {}
            log.info(
                "  [DRY RUN] id=%s title=%s publisher=%s",
                row["id"],
                meta.get("guideline_title", "?"),
                meta.get("publisher", "?"),
            )
        log.info("  [DRY RUN] ... (%d total, not written)", len(all_rows))
        return

    # Convert to guideline_chunks schema
    guideline_rows = []
    qdrant_chunks = []

    for row in all_rows:
        meta = row.get("metadata") or {}
        raw_embed = row.get("embedding")
        # Supabase may return embedding as a string like "[0.1, 0.2, ...]"
        if isinstance(raw_embed, str):
            import json as _json
            try:
                raw_embed = _json.loads(raw_embed)
            except Exception:
                raw_embed = None

        content = row.get("content", "")
        title = meta.get("guideline_title", "Unknown guideline")
        publisher = meta.get("publisher", "")
        year_raw = meta.get("year", "")
        try:
            pub_year = int(year_raw) if year_raw else None
        except ValueError:
            pub_year = None

        # Build guideline_chunks row (no embedding column — stored separately in Qdrant)
        g_row = {
            "id": str(row["id"]),
            "content": content,
            "chunk_index": int(meta.get("chunk_index", 0)),
            "guideline_title": title,
            "issuing_body": publisher,
            "pub_year": pub_year,
            "cascading_path": meta.get("cascading_path", ""),
            "source_url": meta.get("source_url", "") or meta.get("url", ""),
            "geographic_scope": meta.get("geography", ""),
            "document_type": "national_guideline",
            "evidence_tier": 1,
            "chunk_type": "text",
            "is_current_version": True,
            "guideline_id": meta.get("doc_id", str(row["id"])),
            "guideline_version": "legacy",
        }
        guideline_rows.append(g_row)

        # Build Qdrant point (includes embedding)
        if raw_embed:
            qdrant_chunk = dict(g_row)
            qdrant_chunk["embedding"] = raw_embed
            qdrant_chunk["doc_type"] = "guideline"
            qdrant_chunk["publisher"] = publisher
            qdrant_chunk["year"] = str(year_raw)
            qdrant_chunks.append(qdrant_chunk)

    log.info("Upserting %d rows to %s …", len(guideline_rows), settings.guideline_chunk_table)

    # Batch upsert to Supabase in chunks of batch_size
    for start in range(0, len(guideline_rows), batch_size):
        batch = guideline_rows[start : start + batch_size]
        await db.table(settings.guideline_chunk_table).upsert(batch, on_conflict="id").execute()
        log.info("  Supabase: %d/%d", start + len(batch), len(guideline_rows))

    log.info("Supabase migration complete.")

    if settings.qdrant_url and qdrant_chunks:
        log.info("Re-upserting %d points to Qdrant with new payload fields …", len(qdrant_chunks))
        await upsert_qdrant(qdrant_chunks, settings.qdrant_collection, settings)
        log.info("Qdrant migration complete.")
    elif not settings.qdrant_url:
        log.info("QDRANT_URL not set — skipping Qdrant re-upsert.")
    else:
        log.warning("No rows had embeddings — Qdrant not updated.")

    log.info("Migration finished. %d rows migrated.", len(guideline_rows))
    log.info(
        "Next step: validate with `python scripts/validate_qdrant.py`, "
        "then set LEGACY_CHUNK_TABLE reads off in config once satisfied."
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Migrate documents_v2 → guideline_chunks")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=200)
    args = parser.parse_args()
    asyncio.run(migrate(args.dry_run, args.batch_size))
