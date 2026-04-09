"""
Migrate drug_label_chunks → Qdrant.

Mirrors migrate_to_qdrant.py but targets the drug chunk table.

If rows already have an `embedding` column, it is used directly.
If not (or embedding is null), the content is embedded on the fly using
the same text-embedding-3-small model as the guideline chunks.

Usage:
    python scripts/migrate_drugs_to_qdrant.py
    python scripts/migrate_drugs_to_qdrant.py --dry-run         # count + preview only
    python scripts/migrate_drugs_to_qdrant.py --batch-size 200
    python scripts/migrate_drugs_to_qdrant.py --inn amoxicillin  # single drug only

The script is idempotent — Qdrant upserts by point ID so re-running is safe.
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import logging
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

FETCH_BATCH = 500   # rows per Supabase page
EMBED_BATCH = 20    # texts per embedding API call
UPSERT_BATCH = 50   # points per Qdrant upsert call
MAX_RETRIES = 5


def _parse_embedding(raw) -> list[float] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        try:
            return [float(x) for x in ast.literal_eval(raw)]
        except Exception:
            return None
    return None


def _row_to_point_id(row: dict) -> str:
    """Convert the row id to a stable UUID string for Qdrant."""
    raw = row.get("id", "")
    try:
        # If already a UUID string, use it directly
        return str(uuid.UUID(str(raw)))
    except (ValueError, AttributeError):
        # Fall back: namespace UUID from the string representation
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, str(raw)))


async def migrate(dry_run: bool, batch_size: int, inn_filter: str | None) -> None:
    from openai import AsyncOpenAI
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import PointStruct

    from backend.config import get_settings

    settings = get_settings()

    if not settings.qdrant_url:
        log.error("QDRANT_URL not set in .env — cannot migrate")
        sys.exit(1)

    log.info("Connecting to Supabase and Qdrant…")
    from backend.db import get_db
    db = await get_db()
    qdrant = AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=60)

    table = settings.drug_chunk_table
    col = settings.qdrant_collection

    # ------------------------------------------------------------------
    # Verify collection exists
    # ------------------------------------------------------------------
    collections = await qdrant.get_collections()
    existing = {c.name for c in collections.collections}
    if col not in existing:
        log.error(
            "Qdrant collection '%s' does not exist. "
            "Run migrate_to_qdrant.py first to create it with the guideline chunks, "
            "then re-run this script.",
            col,
        )
        sys.exit(1)

    # ------------------------------------------------------------------
    # Count rows
    # ------------------------------------------------------------------
    count_query = db.table(table).select("id", count="exact")
    if inn_filter:
        count_query = count_query.eq("inn", inn_filter)
    count_res = await count_query.execute()
    total = count_res.count or 0

    if total == 0:
        log.info(
            "Table '%s' is empty%s. Nothing to migrate.",
            table,
            f" for inn={inn_filter}" if inn_filter else "",
        )
        log.info(
            "Ask your colleague to populate '%s' in Supabase, then re-run this script.",
            table,
        )
        return

    log.info("Found %d rows in '%s'%s", total, table, f" (inn={inn_filter})" if inn_filter else "")

    if dry_run:
        # Show sample rows only
        sample_q = db.table(table).select("*").limit(3)
        if inn_filter:
            sample_q = sample_q.eq("inn", inn_filter)
        sample = await sample_q.execute()
        log.info("Columns: %s", list((sample.data or [{}])[0].keys()))
        for row in (sample.data or []):
            med = row.get("medicine_name") or row.get("inn", "?")
            src = row.get("source_type", "?")
            section = row.get("section_key") or row.get("section_title", "?")
            has_embed = _parse_embedding(row.get("embedding")) is not None
            log.info("  [DRY RUN] %s / %s / section=%s / has_embedding=%s", med, src, section, has_embed)
        log.info("[DRY RUN] %d total rows — not written", total)
        return

    # ------------------------------------------------------------------
    # Embedding client (same model as guideline ingestion)
    # ------------------------------------------------------------------
    if getattr(settings, "openai_api_key", ""):
        embed_client = AsyncOpenAI(api_key=settings.openai_api_key)
        embed_model = "text-embedding-3-small"
    else:
        embed_client = AsyncOpenAI(
            api_key=settings.nvidia_api_key,
            base_url=settings.nvidia_api_base,
        )
        embed_model = settings.embedding_model

    async def _embed_texts(texts: list[str]) -> list[list[float]]:
        resp = await embed_client.embeddings.create(model=embed_model, input=texts)
        return [obj.embedding for obj in resp.data]

    # ------------------------------------------------------------------
    # Paginate Supabase → embed if needed → upsert Qdrant
    # ------------------------------------------------------------------
    offset = 0
    migrated = 0
    skipped = 0
    embedded_count = 0

    while offset < total:
        log.info("Fetching rows %d–%d…", offset, min(offset + FETCH_BATCH, total))
        fetch_q = (
            db.table(table)
            .select("*")
            .range(offset, offset + FETCH_BATCH - 1)
        )
        if inn_filter:
            fetch_q = fetch_q.eq("inn", inn_filter)
        res = await fetch_q.execute()
        rows = res.data or []
        if not rows:
            break

        # Split into rows with and without pre-computed embeddings
        need_embed: list[dict] = []
        for row in rows:
            if _parse_embedding(row.get("embedding")) is None:
                need_embed.append(row)

        # Embed missing ones in batches
        if need_embed:
            log.info("  Embedding %d rows without pre-computed vectors…", len(need_embed))
            for start in range(0, len(need_embed), EMBED_BATCH):
                batch = need_embed[start : start + EMBED_BATCH]
                texts = [r.get("content", "") for r in batch]
                embeddings = await _embed_texts(texts)
                for row, emb in zip(batch, embeddings):
                    row["embedding"] = emb
                embedded_count += len(batch)

        # Build Qdrant PointStructs
        points: list[PointStruct] = []
        for row in rows:
            embedding = _parse_embedding(row.get("embedding"))
            if embedding is None:
                log.warning("  Skipping row %s — no embedding after embed attempt", row.get("id"))
                skipped += 1
                continue

            med_name = row.get("medicine_name", "") or row.get("inn", "")
            source_type = row.get("source_type", "")
            label = (
                f"{med_name} prescribing information ({source_type.upper()})"
                if source_type else f"{med_name} prescribing information"
            )

            points.append(
                PointStruct(
                    id=_row_to_point_id(row),
                    vector=embedding,
                    payload={
                        # Required fields for retrieval
                        "content": row.get("content", ""),
                        "doc_type": "drug",
                        "guideline_title": label,   # used by citation builder
                        "chunk_index": int(row.get("chunk_index", 0)),
                        "is_current_version": True,
                        # Drug-specific fields
                        "medicine_name": med_name,
                        "inn": row.get("inn", ""),
                        "atc_code": row.get("atc_code", ""),
                        "section_key": row.get("section_key", ""),
                        "section_title": row.get("section_title", ""),
                        "clinical_priority": row.get("clinical_priority", ""),
                        "source_type": source_type,
                        "source_url": row.get("source_url", ""),
                        # Reuse guideline fields expected by rag.py
                        "cascading_path": row.get("section_title", ""),
                        "year": str(row.get("pub_year", "") or ""),
                        "publisher": source_type.upper() if source_type else "Drug Label",
                        "evidence_tier": 0,
                    },
                )
            )

        # Upsert to Qdrant in sub-batches with retry
        for i in range(0, len(points), UPSERT_BATCH):
            sub = points[i : i + UPSERT_BATCH]
            for attempt in range(MAX_RETRIES):
                try:
                    await qdrant.upsert(collection_name=col, points=sub)
                    break
                except Exception as exc:
                    wait = 2 ** attempt
                    if attempt < MAX_RETRIES - 1:
                        log.warning("Upsert failed (%s) — retry %d in %ds", exc, attempt + 1, wait)
                        await asyncio.sleep(wait)
                    else:
                        raise
            migrated += len(sub)

        offset += FETCH_BATCH
        log.info(
            "Progress: %d / %d migrated, %d embedded on-the-fly, %d skipped",
            migrated, total, embedded_count, skipped,
        )

    log.info("Done. %d drug points upserted to Qdrant '%s'. %d skipped.", migrated, col, skipped)
    if embedded_count:
        log.info("(%d rows had no pre-computed embedding and were embedded on-the-fly)", embedded_count)
    log.info("Run  python scripts/validate_qdrant.py  to verify.")
    await qdrant.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate drug_label_chunks → Qdrant")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no writes")
    parser.add_argument("--batch-size", type=int, default=FETCH_BATCH, help="Supabase fetch page size")
    parser.add_argument("--inn", default=None, help="Migrate only this drug (by INN, e.g. amoxicillin)")
    args = parser.parse_args()
    asyncio.run(migrate(args.dry_run, args.batch_size, args.inn))
