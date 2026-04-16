"""
Backfill FTS columns on clinical_practice_guideline_chunks and guideline_chunks.

Run AFTER the SQL setup steps:
  1. ALTER TABLE ... ADD COLUMN fts tsvector
  2. CREATE INDEX ... USING GIN(fts)
  3. CREATE OR REPLACE FUNCTION backfill_cpg_fts / backfill_guideline_fts

Usage:
    source .venv/bin/activate
    python scripts/backfill_fts.py                # both tables
    python scripts/backfill_fts.py --table cpg    # cpg only
    python scripts/backfill_fts.py --table pubmed # guideline_chunks only

Requires .env: SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import argparse
import asyncio
import logging
import sys

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BATCH_SIZE = 5000


async def backfill_table(supabase, rpc_fn: str, label: str) -> None:
    total_updated = 0
    while True:
        res = await supabase.rpc(rpc_fn, {"batch_size": BATCH_SIZE}).execute()
        updated = res.data or 0
        if updated == 0:
            break
        total_updated += updated
        log.info("%s: %d rows updated so far…", label, total_updated)
    log.info("%s backfill complete — %d rows total.", label, total_updated)


async def run(table: str) -> None:
    from supabase._async.client import AsyncClient, create_client

    from backend.config import get_settings

    settings = get_settings()
    supabase: AsyncClient = await create_client(
        settings.supabase_url, settings.supabase_service_key
    )

    if table in ("cpg", "both"):
        log.info("Backfilling clinical_practice_guideline_chunks.fts (136K rows, ~3-5 min)…")
        await backfill_table(supabase, "backfill_cpg_fts", "clinical_practice_guideline_chunks")

    if table in ("pubmed", "both"):
        log.info("Backfilling guideline_chunks.fts (362K rows, ~8-12 min)…")
        await backfill_table(supabase, "backfill_guideline_fts", "guideline_chunks")

    log.info("All done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill FTS columns via Supabase RPC")
    parser.add_argument(
        "--table",
        choices=["cpg", "pubmed", "both"],
        default="both",
        help="Which table to backfill (default: both)",
    )
    args = parser.parse_args()
    asyncio.run(run(args.table))
