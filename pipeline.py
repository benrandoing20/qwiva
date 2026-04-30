"""
pipeline.py
===========
PDF ingestion pipeline — Railway service entry point.

Runs as a continuous worker, polling corpus_documents for PDFs at each
pipeline stage and processing them through stages 1-4.

Stage 1: Claude Haiku vision -> structured metadata from cover pages
Stage 2: Per-page OCR/text extraction (pymupdf/pdfplumber + Mistral + Claude)
Stage 3: Structure detection + chunking + clinical enrichment
Stage 4: text-embedding-3-large + insert to clinical_practice_guideline_chunks

v2 additions:
  - sync_storage_to_db(): auto-registers PDFs dropped directly into storage
    so manual Supabase uploads are fully automated
  - MISTRAL_API_KEY added to required env var validation
"""

import os
import time
import logging
import signal
import json
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("pdf_pipeline")

# ── Graceful shutdown ─────────────────────────────────────────────────────────
_shutdown = False

def _handle_signal(signum, frame):
    global _shutdown
    log.warning("Shutdown signal received — finishing current document")
    _shutdown = True

signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT,  _handle_signal)

# ── Env validation ────────────────────────────────────────────────────────────
REQUIRED_ENV = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "MISTRAL_API_KEY",
]
missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
if missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")

# ── Stage imports ─────────────────────────────────────────────────────────────
import stage1_metadata
import stage2_extract
import stage3_chunk
import stage4_embed_insert

import httpx

SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_KEY"]
STORAGE_BUCKET = "corpus-raw"
SLACK_WEBHOOK  = os.environ.get("SLACK_WEBHOOK_URL", "")
POLL_INTERVAL  = int(os.environ.get("POLL_INTERVAL_SECONDS", "60"))

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}


# ── Storage sync — auto-register manual drops ─────────────────────────────────

def sync_storage_to_db():
    """
    Scan the pdf-intake/ storage path and register any PDFs that
    exist in storage but have no corpus_documents row.

    This makes manual Supabase storage uploads fully automatic:
    drop a PDF into corpus-raw/pdf-intake/xx/ and the pipeline
    picks it up on the next poll cycle (within 60 seconds).
    """
    # List all files in pdf-intake/
    try:
        r = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
            headers={
                "apikey":        SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type":  "application/json",
            },
            json={"prefix": "pdf-intake/", "limit": 1000, "offset": 0},
            timeout=30,
        )
        if r.status_code != 200:
            log.warning("Storage sync: list HTTP %d — skipping", r.status_code)
            return
        items = r.json()
    except Exception as e:
        log.error("Storage sync list error: %s", e)
        return

    # Filter to actual PDF files (exclude folder placeholders)
    pdf_items = [
        item for item in items
        if isinstance(item, dict) and item.get("name", "").endswith(".pdf")
    ]

    if not pdf_items:
        return

    # Get already-registered hashes
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "file_hash", "source_id": "in.(pdf_intake)"},
            headers=SUPABASE_HEADERS,
            timeout=30,
        )
        registered = set()
        if r.status_code == 200:
            registered = {row["file_hash"] for row in r.json() if row.get("file_hash")}
    except Exception as e:
        log.error("Storage sync: fetch registered error: %s", e)
        return

    # Register any unregistered files
    new_count = 0
    for item in pdf_items:
        filename  = item.get("name", "")         # e.g. "abcdef123....pdf"
        file_hash = filename.replace(".pdf", "")

        if file_hash in registered:
            continue
        if len(file_hash) != 64:
            continue  # not a hash-named file (e.g. test.txt)

        full_path = f"pdf-intake/{file_hash[:2]}/{filename}"
        now       = datetime.now(timezone.utc).isoformat()
        row = {
            "id":                     file_hash,
            "file_hash":              file_hash,
            "source_id":              "pdf_intake",
            "canonical_url":          f"storage://{STORAGE_BUCKET}/{full_path}",
            "source_url":             f"storage://{STORAGE_BUCKET}/{full_path}",
            "storage_path":           full_path,
            "original_filename":      filename,
            "content_type":           "application/pdf",
            "file_size_bytes":        item.get("metadata", {}).get("size", 0),
            "pipeline_status":        "uploaded",
            "is_current_version":     True,
            "retry_count":            0,
            "guideline_title":        filename.replace(".pdf", ""),
            "issuing_body_canonical": "pending",
            "domain":                 "general_medicine",
            "geographic_scope":       "global",
            "document_type":          "guideline",
            "raw_metadata": {
                "original_filename": filename,
                "auto_registered":   True,
            },
            "first_seen_at": now,
            "created_at":    now,
            "updated_at":    now,
        }
        try:
            r = httpx.post(
                f"{SUPABASE_URL}/rest/v1/corpus_documents",
                params={"on_conflict": "canonical_url"},
                headers=SUPABASE_HEADERS,
                json=row,
                timeout=30,
            )
            if r.status_code in (200, 201):
                new_count += 1
                log.info("  Auto-registered: %s", file_hash[:16])
            else:
                log.warning("  Register failed %d: %s", r.status_code, r.text[:150])
        except Exception as e:
            log.error("  Register error for %s: %s", file_hash[:12], e)

    if new_count > 0:
        log.info("Storage sync: %d new PDFs registered", new_count)


# ── Pipeline status ───────────────────────────────────────────────────────────

def get_pipeline_status() -> dict:
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "pipeline_status", "source_id": "in.(pdf_intake)"},
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=15,
        )
        if r.status_code == 200:
            counts = {}
            for row in r.json():
                s = row["pipeline_status"]
                counts[s] = counts.get(s, 0) + 1
            return counts
    except Exception:
        pass
    return {}


def has_work_to_do() -> bool:
    status = get_pipeline_status()
    return any(status.get(s, 0) > 0
               for s in {"uploaded", "metadata_extracted", "stored", "chunked"})


def notify_slack(msg: str, error: bool = False):
    if not SLACK_WEBHOOK:
        return
    emoji = "🚨" if error else "✅"
    try:
        httpx.post(
            SLACK_WEBHOOK,
            json={"text": f"{emoji} *Qwiva PDF Pipeline* — {msg}"},
            timeout=10,
        )
    except Exception:
        pass


# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    start_time = datetime.now(timezone.utc)
    log.info("=" * 60)
    log.info("QWIVA PDF INGESTION PIPELINE")
    log.info("Started: %s", start_time.isoformat())
    log.info("Poll interval: %ds", POLL_INTERVAL)
    log.info("=" * 60)

    notify_slack("PDF pipeline started")

    run_stats = {
        "stage1_extracted": 0,
        "stage2_extracted": 0,
        "stage3_chunked":   0,
        "stage4_complete":  0,
        "stage4_chunks":    0,
    }

    while not _shutdown:
        try:
            # Auto-register any PDFs dropped directly into storage
            sync_storage_to_db()

            # Current status
            status = get_pipeline_status()
            if status:
                log.info(
                    "Pipeline status: %s",
                    " | ".join(f"{k}={v}" for k, v in sorted(status.items()))
                )

            # Stage 1: Metadata extraction
            if status.get("uploaded", 0) > 0 and not _shutdown:
                log.info("── Stage 1: Metadata extraction ──")
                s1 = stage1_metadata.run(confidence_threshold=0.7)
                run_stats["stage1_extracted"] += s1.get("extracted", 0)

            # Stage 2: Text/OCR extraction
            if status.get("metadata_extracted", 0) > 0 and not _shutdown:
                log.info("── Stage 2: Text extraction ──")
                s2 = stage2_extract.run()
                run_stats["stage2_extracted"] += s2.get("extracted", 0)

            # Stage 3: Chunking
            if status.get("stored", 0) > 0 and not _shutdown:
                log.info("── Stage 3: Chunking ──")
                s3 = stage3_chunk.run()
                run_stats["stage3_chunked"] += s3.get("chunked", 0)

            # Stage 4: Embed + insert
            if status.get("chunked", 0) > 0 and not _shutdown:
                log.info("── Stage 4: Embed + insert ──")
                s4 = stage4_embed_insert.run()
                run_stats["stage4_complete"] += s4.get("complete", 0)
                run_stats["stage4_chunks"]   += s4.get("chunks_written", 0)

            # Cumulative stats
            if any(run_stats.values()):
                log.info(
                    "Cumulative: s1=%d s2=%d s3=%d s4=%d docs | %d chunks",
                    run_stats["stage1_extracted"],
                    run_stats["stage2_extracted"],
                    run_stats["stage3_chunked"],
                    run_stats["stage4_complete"],
                    run_stats["stage4_chunks"],
                )

            # Sleep if no work
            if not has_work_to_do():
                log.info("No pending work — sleeping %ds", POLL_INTERVAL)
                for _ in range(POLL_INTERVAL):
                    if _shutdown:
                        break
                    time.sleep(1)

        except Exception as e:
            log.error("Pipeline loop error: %s", e, exc_info=True)
            notify_slack(f"Pipeline error: {e}", error=True)
            time.sleep(30)

    # Shutdown summary
    elapsed = int((datetime.now(timezone.utc) - start_time).total_seconds() // 60)
    log.info("=" * 60)
    log.info("PDF PIPELINE SHUTDOWN — %d min | %d docs | %d chunks",
             elapsed, run_stats["stage4_complete"], run_stats["stage4_chunks"])
    log.info("=" * 60)
    notify_slack(
        f"Shutdown — {run_stats['stage4_complete']} docs, "
        f"{run_stats['stage4_chunks']:,} chunks, {elapsed} min"
    )


if __name__ == "__main__":
    main()
