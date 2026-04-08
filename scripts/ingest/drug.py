"""
DrugLabelExtractor — drug_manifest → drug chunk table records.

Checks drug_manifest content hashes to detect changed labels,
then re-extracts, embeds, and upserts only changed drug sections.

The drug chunk table is named via settings.drug_chunk_table
(default: "drug_label_chunks") — confirm the exact name with your colleague.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

log = logging.getLogger(__name__)


async def ingest_drug(
    entry: dict,
    settings: Any,
    db: Any,
    dry_run: bool = False,
) -> None:
    """Check a drug entry from the manifest and re-ingest if content has changed.

    Manifest entry shape:
    {
      "inn": "amoxicillin",
      "sources": ["fda", "emc"],      # which sources to check
      "brand_name": "Amoxil"          # optional
    }

    The function:
    1. Looks up the drug in drug_manifest by inn
    2. Compares content_hash_fda / content_hash_emc to detect staleness
    3. If changed: fetches pre-processed chunks from drug_manifest lookup
       (your colleague's ingestion pipeline is responsible for populating the
        chunk table — this function handles novelty detection and Qdrant sync)
    """
    from scripts.ingest.pipeline import (
        content_hash,
        embed_chunks,
        replace_drug_chunks,
        upsert_qdrant,
        upsert_supabase,
    )

    inn = entry.get("inn", "")
    sources = entry.get("sources", ["fda", "emc"])
    log.info("--- Drug: %s (sources: %s) ---", inn, sources)

    # Fetch manifest row
    try:
        manifest_res = (
            await db.table("drug_manifest")
            .select("*")
            .eq("inn", inn)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.error("Could not query drug_manifest for inn=%s: %s", inn, exc)
        return

    if not manifest_res.data:
        log.warning("No drug_manifest row found for inn=%s — skipping", inn)
        return

    manifest_row = manifest_res.data[0]

    # Fetch existing chunks for this drug
    try:
        existing_res = (
            await db.table(settings.drug_chunk_table)
            .select("id, content_hash, source_type")
            .eq("inn", inn)
            .execute()
        )
        existing_chunks = existing_res.data or []
    except Exception as exc:
        log.warning("Could not fetch existing drug chunks for %s: %s", inn, exc)
        existing_chunks = []

    existing_hashes_by_source: dict[str, set[str]] = {}
    for row in existing_chunks:
        src = row.get("source_type", "")
        existing_hashes_by_source.setdefault(src, set()).add(row.get("content_hash", ""))

    # Check each source for staleness
    for source in sources:
        hash_field = f"content_hash_{source}"
        new_hash = manifest_row.get(hash_field, "")
        existing_source_hashes = existing_hashes_by_source.get(source, set())

        if new_hash and new_hash in existing_source_hashes:
            log.info("  %s/%s: content unchanged (hash match) — skipping", inn, source)
            continue

        log.info("  %s/%s: content changed or new — fetching chunks", inn, source)

        # Fetch pre-extracted chunks from the drug chunk table that belong to this source
        # (Your colleague's pipeline populates these; we sync them to Qdrant here)
        try:
            chunks_res = (
                await db.table(settings.drug_chunk_table)
                .select("*")
                .eq("inn", inn)
                .eq("source_type", source)
                .execute()
            )
            source_chunks = chunks_res.data or []
        except Exception as exc:
            log.error("Could not fetch drug chunks for %s/%s: %s", inn, source, exc)
            continue

        if not source_chunks:
            log.warning("No chunks found in %s for %s/%s", settings.drug_chunk_table, inn, source)
            continue

        if dry_run:
            log.info("  [DRY RUN] Would sync %d chunks for %s/%s to Qdrant", len(source_chunks), inn, source)
            continue

        # Add Qdrant payload fields that may not be in the DB row
        qdrant_chunks = []
        for row in source_chunks:
            med_name = row.get("medicine_name", "") or row.get("inn", inn)
            qdrant_chunk = dict(row)
            qdrant_chunk["doc_type"] = "drug"
            qdrant_chunk["is_current_version"] = True
            qdrant_chunk["guideline_title"] = (
                f"{med_name} prescribing information ({source.upper()})"
            )
            qdrant_chunk["publisher"] = source.upper()
            # Ensure content_hash is present
            if "content_hash" not in qdrant_chunk:
                qdrant_chunk["content_hash"] = content_hash(qdrant_chunk.get("content", ""))
            qdrant_chunks.append(qdrant_chunk)

        # Embed (adds embedding field in-place)
        chunks_needing_embed = [c for c in qdrant_chunks if "embedding" not in c]
        if chunks_needing_embed:
            await embed_chunks(chunks_needing_embed, settings)

        new_ids = [c["id"] for c in qdrant_chunks]

        # Upsert to Qdrant — replace stale points for this source
        if settings.qdrant_url:
            # Remove old Qdrant points for this drug/source before upserting new ones
            await replace_drug_chunks(
                drug_filter_field="inn",
                drug_filter_value=inn,
                new_chunk_ids=new_ids,
                drug_table=settings.drug_chunk_table,
                db=db,
                settings=settings,
            )
            await upsert_qdrant(qdrant_chunks, settings.qdrant_collection, settings)

        # Update manifest ingestion status
        try:
            from datetime import datetime, timezone
            await (
                db.table("drug_manifest")
                .update({
                    hash_field: new_hash,
                    "ingestion_status": "current",
                    "last_ingested_at": datetime.now(timezone.utc).isoformat(),
                })
                .eq("inn", inn)
                .execute()
            )
        except Exception as exc:
            log.warning("Could not update drug_manifest ingestion status for %s: %s", inn, exc)

        log.info("  Done: %d chunks synced to Qdrant for %s/%s", len(qdrant_chunks), inn, source)
