"""
stage2_extract.py (v3)
======================
Stage 2 of the PDF pipeline.

Extraction stack:
  Digital text pages  -> pymupdf (speed) + pdfplumber (tables)
  Scanned/image pages -> Mistral OCR mistral-ocr-latest (primary)
  Very degraded pages -> Claude Haiku vision (fallback)

v3 fixes (crash loop on large PDFs):
  FIX 1: Sort queue by file_size_bytes ASC — small docs processed first,
          large docs like DSM-5 go to the back and don't block others.
  FIX 2: Text pages extracted in batches of TEXT_BATCH_SIZE (100) with
          checkpoint saved after every batch. Previously all text pages
          were extracted in one call — for a 1335-page doc this took 6+
          minutes with no save, so every Railway restart lost all work.
  FIX 3: Retry limit — docs that have failed 3+ times are marked failed
          and skipped rather than crashing the pipeline in a loop.
  FIX 4: retry_count incremented at start of processing so crashes are
          counted even when the container is killed mid-extraction.

Input:  corpus_documents WHERE pipeline_status = 'metadata_extracted'
Output: Supabase storage: extracted text JSON per document
        corpus_documents pipeline_status -> 'stored'
"""

import os
import re
import io
import json
import time
import base64
import logging
import httpx
import fitz   # pymupdf

log = logging.getLogger("pdf_pipeline.stage2")

SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_KEY"]
ANTHROPIC_KEY  = os.environ["ANTHROPIC_API_KEY"]
MISTRAL_KEY    = os.environ["MISTRAL_API_KEY"]
STORAGE_BUCKET = "corpus-raw"

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}

# ── Tuning constants ──────────────────────────────────────────────────────────
PYMUPDF_MIN_CHARS   = 100   # fewer chars -> treat page as image
MISTRAL_MIN_WORDS   = 30    # fewer words from Mistral -> Claude fallback
CLAUDE_MIN_WORDS    = 10    # fewer words from Claude -> flag low quality
MISTRAL_BATCH_PAGES = 50    # image pages per Mistral API call
TEXT_BATCH_SIZE     = 100   # text pages per extraction batch (FIX 2)
MAX_RETRY_COUNT     = 3     # skip doc after this many failures (FIX 3)
MISTRAL_OCR_MODEL   = "mistral-ocr-latest"

# ── Optional dependencies ─────────────────────────────────────────────────────
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
    log.info("pdfplumber available")
except ImportError:
    HAS_PDFPLUMBER = False
    log.warning("pdfplumber not installed — pip install pdfplumber")

try:
    from docling.document_converter import DocumentConverter
    HAS_DOCLING = True
    log.info("Docling available")
except ImportError:
    HAS_DOCLING = False


# ── Page classification ───────────────────────────────────────────────────────

def classify_pages(pdf_bytes: bytes) -> dict:
    """
    Classify each page as 'text' or 'image'.
    Opens PDF once, reads all pages, closes immediately to free memory.
    """
    classifications = {}
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_num in range(len(doc)):
            page       = doc[page_num]
            char_count = len(re.sub(r'\s', '', page.get_text("text").strip()))
            classifications[page_num] = "text" if char_count >= PYMUPDF_MIN_CHARS else "image"
            page = None  # release page
        doc.close()
    except Exception as e:
        log.error("Page classification error: %s", e)

    text_c  = sum(1 for v in classifications.values() if v == "text")
    image_c = sum(1 for v in classifications.values() if v == "image")
    log.info("  Classification: %d text pages, %d image pages", text_c, image_c)
    return classifications


# ── Text page extraction ──────────────────────────────────────────────────────

def extract_tables_pdfplumber(pdf_bytes: bytes, page_nums: list) -> dict:
    """
    Extract tables from a batch of pages using pdfplumber.
    Much better than pymupdf for clinical tables — drug dosing,
    CD4 thresholds, lab reference ranges.
    Returns {page_num: table_text}
    """
    if not HAS_PDFPLUMBER or not page_nums:
        return {}

    table_texts = {}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page_num in page_nums:
                if page_num >= len(pdf.pages):
                    continue
                tables = pdf.pages[page_num].extract_tables()
                if not tables:
                    continue
                table_parts = []
                for table in tables:
                    rows    = []
                    headers = None
                    for i, row in enumerate(table):
                        clean = [str(c).strip() if c else "" for c in row]
                        if not any(clean):
                            continue
                        if i == 0:
                            headers = clean
                            rows.append(" | ".join(clean))
                        else:
                            if headers and len(clean) == len(headers):
                                rows.append("; ".join(
                                    f"{h}: {v}" for h, v in zip(headers, clean) if v
                                ))
                            else:
                                rows.append(" | ".join(clean))
                    if rows:
                        table_parts.append("\n".join(rows))
                if table_parts:
                    table_texts[page_num] = "\n\n".join(table_parts)
    except Exception as e:
        log.warning("pdfplumber error on batch: %s", e)

    return table_texts


def extract_text_pages_batch(pdf_bytes: bytes, page_nums: list) -> dict:
    """
    Extract text from a batch of digital pages.
    Uses pymupdf for prose + pdfplumber for tables.
    Called per-batch so memory is bounded even for 1000+ page docs.
    """
    results    = {}
    table_data = extract_tables_pdfplumber(pdf_bytes, page_nums)

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_num in page_nums:
            if page_num >= len(doc):
                continue
            page   = doc[page_num]
            blocks = page.get_text("blocks", sort=True)
            lines  = [b[4].strip() for b in blocks if b[6] == 0 and b[4].strip()]
            text   = "\n\n".join(lines)
            page   = None  # explicit release

            if page_num in table_data:
                text = text + "\n\n[TABLE DATA]\n" + table_data[page_num]

            results[page_num] = {
                "page":       page_num,
                "text":       text,
                "method":     "pymupdf" + ("+pdfplumber" if page_num in table_data else ""),
                "confidence": 1.0,
                "word_count": len(text.split()),
            }
        doc.close()
    except Exception as e:
        log.error("Text batch extraction error: %s", e)

    return results


# ── Mistral OCR ───────────────────────────────────────────────────────────────

def extract_pdf_chunk_bytes(pdf_bytes: bytes, page_nums: list) -> bytes:
    """Extract a subset of pages as a new PDF for Mistral batching."""
    src = fitz.open(stream=pdf_bytes, filetype="pdf")
    out = fitz.open()
    for p in page_nums:
        if p < len(src):
            out.insert_pdf(src, from_page=p, to_page=p)
    chunk = out.tobytes()
    out.close()
    src.close()
    return chunk


def _call_mistral_ocr(pdf_b64: str) -> dict | None:
    """Call Mistral OCR API. Returns {batch_index: markdown} or None."""
    for attempt in range(3):
        try:
            r = httpx.post(
                "https://api.mistral.ai/v1/ocr",
                headers={"Authorization": f"Bearer {MISTRAL_KEY}",
                         "Content-Type": "application/json"},
                json={
                    "model":    MISTRAL_OCR_MODEL,
                    "document": {
                        "type":         "document_url",
                        "document_url": f"data:application/pdf;base64,{pdf_b64}",
                    },
                    "include_image_base64": False,
                },
                timeout=120,
            )
            if r.status_code == 200:
                pages = r.json().get("pages", [])
                return {p.get("index", i): p.get("markdown", "").strip()
                        for i, p in enumerate(pages)}
            elif r.status_code == 429:
                time.sleep(15 * (2 ** attempt))
            elif r.status_code >= 500:
                time.sleep(10 * (2 ** attempt))
            else:
                log.error("  Mistral %d: %s", r.status_code, r.text[:200])
                return None
        except httpx.TimeoutException:
            time.sleep(20 * (attempt + 1))
        except Exception as e:
            if attempt == 2:
                return None
            time.sleep(10)
    return None


def mistral_ocr_pages(pdf_bytes: bytes, image_page_nums: list) -> dict:
    """
    OCR image pages with Mistral in batches.
    Low-yield pages queued for Claude fallback automatically.
    """
    if not image_page_nums:
        return {}

    results      = {}
    failed_pages = []

    for batch_start in range(0, len(image_page_nums), MISTRAL_BATCH_PAGES):
        batch = image_page_nums[batch_start: batch_start + MISTRAL_BATCH_PAGES]
        log.info("  Mistral OCR batch: pages %d-%d", batch[0], batch[-1])

        try:
            chunk_b64 = base64.standard_b64encode(
                extract_pdf_chunk_bytes(pdf_bytes, batch)
            ).decode()
        except Exception as e:
            log.error("  Chunk extraction error: %s", e)
            failed_pages.extend(batch)
            continue

        batch_result = _call_mistral_ocr(chunk_b64)
        if batch_result is None:
            failed_pages.extend(batch)
            continue

        for batch_idx, original_page_num in enumerate(batch):
            page_text  = batch_result.get(batch_idx, "")
            word_count = len(page_text.split())
            if word_count < MISTRAL_MIN_WORDS:
                failed_pages.append(original_page_num)
            else:
                results[original_page_num] = {
                    "page":       original_page_num,
                    "text":       page_text,
                    "method":     "mistral_ocr",
                    "confidence": 0.9,
                    "word_count": word_count,
                }
        time.sleep(0.5)

    if failed_pages:
        log.info("  Claude vision fallback for %d pages", len(failed_pages))
        results.update(claude_vision_pages(pdf_bytes, failed_pages))

    return results


# ── Claude Haiku vision fallback ──────────────────────────────────────────────

def _call_claude_vision(img_b64: str, page_num: int) -> tuple:
    """OCR single page image with Claude Haiku. Returns (text, confidence)."""
    for attempt in range(3):
        try:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": ANTHROPIC_KEY,
                         "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={
                    "model": "claude-haiku-4-5",
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": [
                        {"type": "image", "source": {
                            "type": "base64", "media_type": "image/png", "data": img_b64}},
                        {"type": "text", "text": (
                            "Extract all text from this document page. "
                            "Preserve headings, bullet points, numbered lists, "
                            "and table structure. Format tables as: "
                            "header1: value1; header2: value2 per row. "
                            "Output only the extracted text. "
                            "If blank or unreadable output: [BLANK PAGE]"
                        )},
                    ]}],
                },
                timeout=60,
            )
            if r.status_code == 200:
                text = r.json()["content"][0]["text"].strip()
                if text == "[BLANK PAGE]":
                    return "", 0.3
                words = len(text.split())
                return text, min(0.9, 0.5 + words / 500)
            elif r.status_code == 429:
                time.sleep(15 * (attempt + 1))
            else:
                return "", 0.0
        except Exception as e:
            log.warning("  Claude vision error page %d: %s", page_num, e)
            time.sleep(5)
    return "", 0.0


def claude_vision_pages(pdf_bytes: bytes, page_nums: list) -> dict:
    """Claude Haiku vision fallback for pages Mistral couldn't handle."""
    results = {}
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        log.error("Claude fallback PDF open: %s", e)
        return results

    for page_num in page_nums:
        if page_num >= len(doc):
            continue
        try:
            page    = doc[page_num]
            mat     = fitz.Matrix(200 / 72, 200 / 72)
            pix     = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            img_b64 = base64.standard_b64encode(pix.tobytes("png")).decode()
            pix     = None
            page    = None

            text, conf = _call_claude_vision(img_b64, page_num)
            word_count = len(text.split())
            results[page_num] = {
                "page":       page_num,
                "text":       text,
                "method":     "claude_vision" if word_count >= CLAUDE_MIN_WORDS else "claude_low",
                "confidence": conf,
                "word_count": word_count,
            }
            time.sleep(0.3)
        except Exception as e:
            log.warning("  Claude fallback error page %d: %s", page_num, e)
            results[page_num] = {
                "page": page_num, "text": "", "method": "failed",
                "confidence": 0.0, "word_count": 0,
            }

    doc.close()
    return results


# ── OCR quality classification ────────────────────────────────────────────────

def classify_ocr_quality(page_results: list) -> str:
    methods = [p.get("method", "failed") for p in page_results]
    if not methods:
        return "failed"
    total     = len(methods)
    pymupdf_n = sum(1 for m in methods if "pymupdf" in m)
    low_n     = sum(1 for m in methods if "low" in m or m == "failed")
    if pymupdf_n / total >= 0.9:
        return "clean"
    if low_n / total >= 0.3:
        return "ocr_low"
    if pymupdf_n / total >= 0.5:
        return "mixed"
    return "ocr_good"


# ── Storage helpers ───────────────────────────────────────────────────────────

def fetch_pdf_from_storage(storage_path: str) -> bytes | None:
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    try:
        r = httpx.get(
            url,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=300, follow_redirects=True,
        )
        return r.content if r.status_code == 200 else None
    except Exception as e:
        log.error("PDF fetch error: %s", e)
        return None


def save_checkpoint(doc_id: str, page_results: list) -> bool:
    data = {"doc_id": doc_id, "pages": page_results,
            "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    url  = (f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
            f"pdf-extraction/{doc_id[:2]}/{doc_id}_pages.json")
    try:
        r = httpx.put(
            url,
            content=json.dumps(data, ensure_ascii=False).encode(),
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                     "Content-Type": "application/json", "x-upsert": "true"},
            timeout=60,
        )
        return r.status_code in (200, 201)
    except Exception as e:
        log.error("Checkpoint save error: %s", e)
        return False


def load_checkpoint(doc_id: str) -> list | None:
    url = (f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
           f"pdf-extraction/{doc_id[:2]}/{doc_id}_pages.json")
    try:
        r = httpx.get(
            url,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=30,
        )
        if r.status_code == 200:
            return r.json().get("pages", [])
    except Exception:
        pass
    return None


# ── Supabase doc helpers ──────────────────────────────────────────────────────

def get_metadata_extracted_docs(batch_size: int = 3) -> list:
    """
    Fetch docs ready for text extraction.
    FIX 1: Sorted by file_size_bytes ASC — smallest docs first.
    This ensures large problem docs (DSM-5 etc.) never block smaller docs.
    """
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={
                "select":          "*",
                "pipeline_status": "eq.metadata_extracted",
                "source_id":       "in.(pdf_intake)",
                # FIX 1: smallest docs first — large docs go to the back
                "order":           "file_size_bytes.asc",
                "limit":           batch_size,
            },
            headers=SUPABASE_HEADERS, timeout=30,
        )
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        log.error("Fetch docs error: %s", e)
        return []


def increment_retry_count(doc_id: str):
    """
    FIX 4: Increment retry_count at the START of processing.
    This way if the container is killed mid-extraction, the crash is
    counted. After MAX_RETRY_COUNT failures the doc is skipped.
    """
    try:
        # Read current retry_count
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "retry_count", "id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS, timeout=15,
        )
        if r.status_code == 200 and r.json():
            current = r.json()[0].get("retry_count", 0) or 0
            httpx.patch(
                f"{SUPABASE_URL}/rest/v1/corpus_documents",
                params={"id": f"eq.{doc_id}"},
                headers=SUPABASE_HEADERS,
                json={"retry_count": current + 1,
                      "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                timeout=15,
            )
    except Exception as e:
        log.warning("increment_retry_count error: %s", e)


def update_doc_extracted(doc_id: str, ocr_quality: str, extraction_stats: dict):
    update = {
        "pipeline_status": "stored",
        "ocr_quality":     ocr_quality,
        "failed_stage":    None,
        "last_error":      None,
        "updated_at":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "raw_metadata", "id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS, timeout=15,
        )
        if r.status_code == 200 and r.json():
            existing = r.json()[0].get("raw_metadata") or {}
            if isinstance(existing, str):
                existing = json.loads(existing)
            existing["extraction_stats"] = extraction_stats
            update["raw_metadata"] = json.dumps(existing)
    except Exception:
        pass
    try:
        httpx.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS, json=update, timeout=30,
        )
    except Exception as e:
        log.error("Update extracted doc error: %s", e)


def mark_failed(doc_id: str, error: str):
    try:
        httpx.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS,
            json={"pipeline_status": "failed", "failed_stage": "extract",
                  "last_error": error[:500],
                  "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            timeout=30,
        )
    except Exception:
        pass


# ── Main extraction ───────────────────────────────────────────────────────────

def extract_document(doc: dict) -> bool:
    """
    Extract text from all pages of a PDF with full crash safety.

    Strategy:
      1. Check retry_count — skip if exceeded MAX_RETRY_COUNT
      2. Increment retry_count immediately (counts even if container crashes)
      3. Load checkpoint — resume from last saved position
      4. Classify pages: text vs image
      5. Extract text pages in batches of TEXT_BATCH_SIZE with checkpoint after each
      6. OCR image pages in batches of MISTRAL_BATCH_PAGES with checkpoint after each
      7. Claude fallback for any gaps
      8. Mark as stored
    """
    doc_id       = doc["id"]
    filename     = doc.get("original_filename", doc_id)
    source_url   = doc.get("source_url", "")
    storage_path = source_url.replace(f"storage://{STORAGE_BUCKET}/", "")

    # FIX 3: Skip docs that have failed too many times
    retry_count = doc.get("retry_count", 0) or 0
    if retry_count >= MAX_RETRY_COUNT:
        log.warning(
            "Stage 2 [%s]: skipping — exceeded max retries (%d/%d)",
            filename[:50], retry_count, MAX_RETRY_COUNT
        )
        mark_failed(doc_id, f"exceeded max retries ({retry_count})")
        return False

    log.info("Stage 2 [%s]: extracting text (attempt %d/%d)",
             filename[:55], retry_count + 1, MAX_RETRY_COUNT)

    # FIX 4: Increment retry_count now so a crash is counted
    increment_retry_count(doc_id)

    # Load checkpoint — resume where we left off
    existing       = load_checkpoint(doc_id) or []
    completed_nums = {p["page"] for p in existing}
    page_dict      = {p["page"]: p for p in existing}

    if completed_nums:
        log.info("  Resuming from checkpoint — %d pages already done",
                 len(completed_nums))

    # Fetch PDF from storage
    pdf_bytes = fetch_pdf_from_storage(storage_path)
    if not pdf_bytes:
        mark_failed(doc_id, "storage_fetch_failed")
        return False

    # Get total page count
    try:
        tmp         = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(tmp)
        tmp.close()
    except Exception as e:
        mark_failed(doc_id, f"pdf_open_failed: {e}")
        return False

    log.info("  Total: %d pages | Already done: %d | Remaining: %d",
             total_pages, len(completed_nums), total_pages - len(completed_nums))

    # Classify all pending pages
    classifications = classify_pages(pdf_bytes)
    pending   = [p for p in range(total_pages) if p not in completed_nums]
    text_pgs  = [p for p in pending if classifications.get(p) == "text"]
    image_pgs = [p for p in pending if classifications.get(p) == "image"]

    # ── FIX 2: Extract text pages in batches with checkpoint after each ───────
    if text_pgs:
        log.info("  Extracting %d text pages in batches of %d",
                 len(text_pgs), TEXT_BATCH_SIZE)
        for batch_start in range(0, len(text_pgs), TEXT_BATCH_SIZE):
            batch = text_pgs[batch_start: batch_start + TEXT_BATCH_SIZE]
            log.info("  Text batch: pages %d-%d (%d pages)",
                     batch[0], batch[-1], len(batch))

            batch_results = extract_text_pages_batch(pdf_bytes, batch)
            page_dict.update(batch_results)

            # Save checkpoint after every text batch — crash-safe
            pages_sorted = [page_dict[p] for p in sorted(page_dict)]
            save_checkpoint(doc_id, pages_sorted)
            log.info("  Checkpoint saved: %d/%d pages done",
                     len(page_dict), total_pages)

    # ── OCR image pages in batches with checkpoint after each ────────────────
    if image_pgs:
        log.info("  OCR %d image pages via Mistral OCR", len(image_pgs))
        for batch_start in range(0, len(image_pgs), MISTRAL_BATCH_PAGES):
            batch = image_pgs[batch_start: batch_start + MISTRAL_BATCH_PAGES]
            page_dict.update(mistral_ocr_pages(pdf_bytes, batch))

            pages_sorted = [page_dict[p] for p in sorted(page_dict)]
            save_checkpoint(doc_id, pages_sorted)
            log.info("  Checkpoint saved: %d/%d pages done",
                     len(page_dict), total_pages)

    # Handle any gaps (shouldn't happen but just in case)
    missing = [p for p in range(total_pages) if p not in page_dict]
    if missing:
        log.warning("  %d missing pages — Claude fallback", len(missing))
        page_dict.update(claude_vision_pages(pdf_bytes, missing))

    # Final sorted results
    page_results = [
        page_dict.get(p, {"page": p, "text": "", "method": "missing",
                          "confidence": 0.0, "word_count": 0})
        for p in range(total_pages)
    ]

    # Final checkpoint save
    save_checkpoint(doc_id, page_results)

    # Compute stats
    total_words   = sum(p.get("word_count", 0) for p in page_results)
    method_counts = {}
    for p in page_results:
        m = p.get("method", "unknown")
        method_counts[m] = method_counts.get(m, 0) + 1
    ocr_quality = classify_ocr_quality(page_results)

    log.info("  ✓ %d pages | %d words | %s | %s",
             total_pages, total_words, ocr_quality,
             " ".join(f"{m}:{n}" for m, n in method_counts.items() if n > 0))

    update_doc_extracted(doc_id, ocr_quality, {
        "total_pages": total_pages, "total_words": total_words,
        "ocr_quality": ocr_quality, "methods": method_counts,
        "pdfplumber_used": HAS_PDFPLUMBER, "docling_used": HAS_DOCLING,
    })
    return True


# ── Stage entry point ─────────────────────────────────────────────────────────

def run() -> dict:
    stats = {"extracted": 0, "errors": 0}
    log.info("Stage 2: Mistral OCR + pymupdf/pdfplumber + Claude fallback")
    log.info("  pdfplumber=%s | docling=%s | text_batch=%d | max_retries=%d",
             "on" if HAS_PDFPLUMBER else "off",
             "on" if HAS_DOCLING   else "off",
             TEXT_BATCH_SIZE,
             MAX_RETRY_COUNT)

    while True:
        docs = get_metadata_extracted_docs(batch_size=3)
        if not docs:
            log.info("Stage 2: no docs pending")
            break
        for doc in docs:
            try:
                if extract_document(doc):
                    stats["extracted"] += 1
                else:
                    stats["errors"] += 1
            except Exception as e:
                log.error("Stage 2 unhandled error for %s: %s", doc.get("id"), e)
                mark_failed(doc["id"], f"unhandled: {e}")
                stats["errors"] += 1
        time.sleep(2)

    log.info("Stage 2 complete — extracted=%d errors=%d",
             stats["extracted"], stats["errors"])
    return stats
