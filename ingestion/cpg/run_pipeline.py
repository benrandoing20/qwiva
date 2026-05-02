#!/usr/bin/env python3
"""
run_pipeline.py — Full Pipeline Orchestrator
=============================================
Runs all 4 stages in sequence for one or all sources.
Each stage is independently resumable — if Stage 3 fails halfway,
re-running picks up where it left off via pipeline_status checkpoints.

Local usage:
    python run_pipeline.py --source nice
    python run_pipeline.py --source moh_kenya
    python run_pipeline.py --source all
    python run_pipeline.py --source all --retry-failed
    python run_pipeline.py --source nice --stages 2,3,4

Railway usage (set SOURCE env var):
    SOURCE=nice python run_pipeline.py
    SOURCE=all RETRY_FAILED=true python run_pipeline.py
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

from config import SOURCES

# ── Logging ───────────────────────────────────────────────────────────────────
# Plain format for Railway log viewer (no ANSI codes)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger("pipeline")


# ── Pipeline runner ───────────────────────────────────────────────────────────

def run_pipeline(
    source: str,
    stages: list[int],
    retry_failed: bool,
) -> int:
    """
    Run the full pipeline for a source.
    Returns exit code: 0 = success, 1 = one or more stages had failures.
    """
    source_id = None if source == "all" else source
    start     = datetime.now(timezone.utc)
    had_error = False

    logger.info("=" * 70)
    logger.info(
        "CPG PIPELINE START  source=%s  stages=%s  retry=%s  time=%s",
        source, stages, retry_failed,
        start.strftime("%Y-%m-%d %H:%M UTC"),
    )
    logger.info("=" * 70)

    if 1 in stages:
        logger.info("-- Stage 1: Discovery ------------------------------------------")
        try:
            from _01_discover import run_discovery
            sources_to_run = [source_id] if source_id else list(SOURCES.keys())
            for src in sources_to_run:
                run_discovery(src)
        except Exception as e:
            logger.error("Stage 1 failed: %s", e, exc_info=True)
            had_error = True

    if 2 in stages:
        logger.info("-- Stage 2: Fetch & Store --------------------------------------")
        try:
            from _02_fetch_store import run_fetch_store
            run_fetch_store(source_id=source_id, retry_failed=retry_failed)
        except Exception as e:
            logger.error("Stage 2 failed: %s", e, exc_info=True)
            had_error = True

    if 3 in stages:
        logger.info("-- Stage 3: Parse & Chunk --------------------------------------")
        try:
            from _03_parse_chunk import run_parse_chunk
            run_parse_chunk(source_id=source_id, retry_failed=retry_failed)
        except Exception as e:
            logger.error("Stage 3 failed: %s", e, exc_info=True)
            had_error = True

    if 4 in stages:
        logger.info("-- Stage 4: Embed ----------------------------------------------")
        try:
            from _04_embed_insert import run_embed
            run_embed(source_id=source_id, retry_failed=retry_failed)
        except Exception as e:
            logger.error("Stage 4 failed: %s", e, exc_info=True)
            had_error = True

    elapsed = (datetime.now(timezone.utc) - start).total_seconds()
    status  = "COMPLETE WITH ERRORS" if had_error else "COMPLETE"

    logger.info("=" * 70)
    logger.info("PIPELINE %s  elapsed=%.1fs", status, elapsed)
    logger.info("=" * 70)

    return 1 if had_error else 0


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Qwiva CPG Pipeline Orchestrator")
    parser.add_argument(
        "--source",
        choices=list(SOURCES.keys()) + ["all"],
        default=os.environ.get("SOURCE", "all"),
        help="Source to process (default: all, or SOURCE env var)",
    )
    parser.add_argument(
        "--stages",
        default=os.environ.get("STAGES", "1,2,3,4"),
        help="Comma-separated stages to run (default: 1,2,3,4)",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        default=os.environ.get("RETRY_FAILED", "").lower() in ("true", "1", "yes"),
        help="Retry documents that previously failed",
    )
    parser.add_argument(
        "--log-level",
        default=os.environ.get("LOG_LEVEL", "INFO"),
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.getLogger().setLevel(args.log_level)
    stages_to_run = [int(s.strip()) for s in args.stages.split(",")]

    exit_code = run_pipeline(args.source, stages_to_run, args.retry_failed)
    sys.exit(exit_code)
