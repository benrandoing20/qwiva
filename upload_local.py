"""
upload_local.py
===============
Run this LOCALLY (not on Railway) to upload your PDFs to Supabase storage
and register them for processing by the pdf-pipeline Railway service.

Usage:
    python upload_local.py --dir "C:\\Users\\USER\\qwiva_ingestion\\guidelines_pdfs"
    python upload_local.py --file "C:\\path\\to\\single.pdf"
    python upload_local.py --dir "C:\\path\\to\\pdfs" --dry-run
    python upload_local.py --dir "C:\\path\\to\\pdfs" --source-prefix pdf_nascop

Requirements:
    pip install httpx pymupdf python-dotenv tqdm

Environment (.env file in same directory as this script):
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_KEY=your_service_role_key   <- must be service_role, not anon
"""

import os
import sys
import hashlib
import argparse
from pathlib import Path
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import httpx
import fitz  # pymupdf

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_KEY"]
STORAGE_BUCKET = "corpus-raw"

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}

# Persistent client — reuses TCP connections, prevents SSL crashes on large batches
CLIENT = httpx.Client(timeout=180)


# ── Log helper ────────────────────────────────────────────────────────────────

def log(msg: str):
    """Print that works correctly inside tqdm without corrupting the bar."""
    if HAS_TQDM:
        tqdm.write(msg)
    else:
        print(msg)


# ── Storage helpers ───────────────────────────────────────────────────────────

def file_exists_in_storage(storage_path: str) -> bool:
    """
    Check if a file already exists in Supabase storage.
    Avoids re-uploading files that are already there.
    """
    url = f"{SUPABASE_URL}/storage/v1/object/info/{STORAGE_BUCKET}/{storage_path}"
    try:
        r = CLIENT.get(
            url,
            headers={
                "apikey":        SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            },
            timeout=10,
        )
        return r.status_code == 200
    except Exception:
        return False


def upload_to_storage(storage_path: str, pdf_bytes: bytes) -> tuple[bool, str]:
    """Upload PDF bytes to Supabase storage. Returns (success, error_message)."""
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    try:
        r = CLIENT.put(
            url,
            content=pdf_bytes,
            headers={
                "apikey":        SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type":  "application/pdf",
                "x-upsert":      "true",
            },
        )
        if r.status_code in (200, 201):
            return True, ""
        return False, f"HTTP {r.status_code}: {r.text[:300]}"
    except Exception as e:
        return False, f"exception: {e}"


# ── DB registration ───────────────────────────────────────────────────────────

def register_document(
    doc_id: str,
    storage_path: str,
    original_filename: str,
    file_size_bytes: int,
    source_id: str,
) -> tuple[bool, str]:
    """
    Insert a row into corpus_documents.
    Returns (success, error_message).

    IMPORTANT — pipeline_status must be 'uploaded' not 'stored'.
    The pipeline stages are:
      uploaded           -> Stage 1 picks up (Claude extracts metadata from cover)
      metadata_extracted -> Stage 2 picks up (Mistral OCR extracts full text)
      stored             -> Stage 3 picks up (chunking)
      chunked            -> Stage 4 picks up (embed + insert to chunks table)
      complete           -> done

    Setting 'stored' here would skip Stage 1 and Stage 2 entirely,
    producing chunks with no metadata and no extracted text.

    Metadata placeholders (issuing_body_canonical, domain etc.) are
    overwritten by Stage 1 when Claude reads the PDF cover page.
    """
    now = datetime.now(timezone.utc).isoformat()

    row = {
        # ── Identity ──────────────────────────────────────────────────────
        "id":                doc_id,
        "file_hash":         doc_id,
        "source_id":         source_id,
        "canonical_url":     f"storage://{STORAGE_BUCKET}/{storage_path}",
        "source_url":        f"storage://{STORAGE_BUCKET}/{storage_path}",
        "storage_path":      storage_path,
        "original_filename": original_filename,
        "content_type":      "application/pdf",
        "file_size_bytes":   file_size_bytes,

        # ── Pipeline state ────────────────────────────────────────────────
        # MUST be 'uploaded' — this is what Stage 1 polls for.
        # Do NOT change to 'stored' — that skips metadata extraction and OCR.
        "pipeline_status":   "uploaded",
        "is_current_version": True,
        "retry_count":       0,

        # ── Metadata placeholders ─────────────────────────────────────────
        # Stage 1 (Claude Haiku vision) overwrites all of these with real
        # values extracted from the PDF cover page.
        "guideline_title":        original_filename.replace(".pdf", "").replace("_", " "),
        "issuing_body_canonical": "pending",
        "domain":                 "general_medicine",
        "geographic_scope":       "global",
        "document_type":          "clinical_practice_guideline",

        # ── Raw metadata — pass as dict, Supabase serialises to JSONB ─────
        # Do NOT use json.dumps() here — passing a string to a JSONB column
        # causes a silent 400 error.
        "raw_metadata": {
            "original_filename": original_filename,
            "file_size_bytes":   file_size_bytes,
        },

        # ── Timestamps ────────────────────────────────────────────────────
        "first_seen_at": now,
        "created_at":    now,
        "updated_at":    now,
    }

    try:
        r = CLIENT.post(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"on_conflict": "canonical_url"},
            headers=SUPABASE_HEADERS,
            json=row,
        )
        if r.status_code in (200, 201):
            return True, ""
        # Return full Supabase error — don't swallow it
        return False, f"HTTP {r.status_code}: {r.text}"
    except Exception as e:
        return False, f"exception: {e}"


# ── Already-registered check ──────────────────────────────────────────────────

def get_already_registered() -> set[str]:
    """
    Return set of file_hash values already in corpus_documents.
    Used to skip PDFs already registered — avoids duplicate rows.
    """
    try:
        r = CLIENT.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "file_hash", "source_id": "in.(pdf_intake)"},
            headers=SUPABASE_HEADERS,
        )
        if r.status_code == 200:
            return {row["file_hash"] for row in r.json() if row.get("file_hash")}
    except Exception:
        pass
    return set()


# ── PDF helpers ───────────────────────────────────────────────────────────────

def compute_hash(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()


def get_page_count(pdf_bytes: bytes) -> int:
    """Get page count for display only — not stored in DB (column doesn't exist)."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        n   = len(doc)
        doc.close()
        return n
    except Exception:
        return 0


def find_pdfs(directory: str) -> list[Path]:
    return sorted(Path(directory).rglob("*.pdf"))


# ── Single PDF upload ─────────────────────────────────────────────────────────

def upload_pdf(
    pdf_path: Path,
    source_id: str,
    existing: set[str],
    dry_run: bool = False,
) -> dict:
    """
    Upload one PDF to storage and register in corpus_documents.
    Returns a status dict with 'status' key: uploaded | skipped | dry_run | error
    """
    filename = pdf_path.name

    # Read file
    try:
        pdf_bytes = pdf_path.read_bytes()
    except Exception as e:
        return {"file": filename, "status": "error", "reason": f"read_error: {e}"}

    file_hash    = compute_hash(pdf_bytes)
    storage_path = f"pdf-intake/{file_hash[:2]}/{file_hash}.pdf"
    file_size    = len(pdf_bytes)
    page_count   = get_page_count(pdf_bytes)  # display only

    # Dry run
    if dry_run:
        return {
            "file":    filename,
            "status":  "dry_run",
            "hash":    file_hash[:12],
            "pages":   page_count,
            "size_mb": round(file_size / 1_048_576, 1),
        }

    # Skip if already registered in DB
    if file_hash in existing:
        return {"file": filename, "status": "skipped"}

    # Step 1: Storage upload — skip if already there
    if file_exists_in_storage(storage_path):
        log(f"  → {filename}: already in storage, skipping upload")
    else:
        storage_ok, storage_err = upload_to_storage(storage_path, pdf_bytes)
        if not storage_ok:
            return {"file": filename, "status": "error",
                    "reason": f"storage failed: {storage_err}"}

    # Step 2: Register in corpus_documents
    db_ok, db_err = register_document(
        doc_id=file_hash,
        storage_path=storage_path,
        original_filename=filename,
        file_size_bytes=file_size,
        source_id=source_id,
    )
    if not db_ok:
        return {"file": filename, "status": "error",
                "reason": f"db failed: {db_err}"}

    return {
        "file":    filename,
        "status":  "uploaded",
        "pages":   page_count,
        "size_mb": round(file_size / 1_048_576, 1),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Upload PDFs to Supabase for pdf-pipeline processing"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dir",  type=str, help="Directory containing PDFs")
    group.add_argument("--file", type=str, help="Single PDF path")
    parser.add_argument("--source-prefix", type=str, default="pdf_intake",
                        help="source_id prefix (default: pdf_intake)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview without uploading")
    args = parser.parse_args()

    source_id = args.source_prefix

    # Find PDFs
    pdfs = [Path(args.file)] if args.file else find_pdfs(args.dir)
    if not pdfs:
        print("No PDFs found.")
        sys.exit(0)

    print(f"\nFound {len(pdfs)} PDF(s)")
    print(f"Source ID: {source_id}")
    print(f"Dry run:   {args.dry_run}\n")

    # Get already-registered hashes to skip
    if not args.dry_run:
        print("Checking already registered PDFs...")
        existing = get_already_registered()
        print(f"  {len(existing)} already registered — will skip\n")
    else:
        existing = set()

    # Process
    counts   = {"uploaded": 0, "skipped": 0, "error": 0, "dry_run": 0}
    iterator = tqdm(pdfs, unit="pdf") if HAS_TQDM else pdfs

    for pdf_path in iterator:
        result = upload_pdf(pdf_path, source_id, existing, args.dry_run)
        status = result["status"]
        counts[status] = counts.get(status, 0) + 1

        # Always show errors and successful uploads — visible above tqdm bar
        if status == "error":
            log(f"  ✗ {result['file']}: {result.get('reason', 'unknown')}")
        elif status == "uploaded":
            log(f"  ✓ {result['file']}  [{result.get('pages')}p  {result.get('size_mb')}MB]")

    # Summary
    print(f"\n{'=' * 50}")
    if args.dry_run:
        print(f"Dry run — would process {counts.get('dry_run', 0)} PDFs")
    else:
        print(f"Done:")
        print(f"  Uploaded:  {counts.get('uploaded', 0)}")
        print(f"  Skipped:   {counts.get('skipped', 0)}  (already registered)")
        print(f"  Errors:    {counts.get('error', 0)}")

        if counts.get("error", 0) > 0:
            print(f"\n  ⚠ Errors printed above — scroll up to review")

        if counts.get("uploaded", 0) > 0:
            print(f"\nVerify in Supabase SQL Editor:")
            print(f"  SELECT pipeline_status, COUNT(*)")
            print(f"  FROM corpus_documents")
            print(f"  WHERE source_id LIKE 'pdf_%'")
            print(f"  GROUP BY pipeline_status;")


if __name__ == "__main__":
    main()
