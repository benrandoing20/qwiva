"""
stage1_metadata.py
==================
Stage 1 of the PDF pipeline.

Uses Claude Haiku vision to extract structured metadata from the first
3 pages of each uploaded PDF. Handles both text and image cover pages.

Input:  corpus_documents WHERE pipeline_status = 'uploaded'
Output: corpus_documents updated with metadata fields
        pipeline_status → 'metadata_extracted' (confidence >= 0.7)
        pipeline_status → 'metadata_review'    (confidence < 0.7)
"""

import os
import re
import json
import time
import base64
import logging
import httpx
import fitz   # pymupdf

log = logging.getLogger("pdf_pipeline.stage1")

# ── Environment ───────────────────────────────────────────────────────────────
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_KEY"]
ANTHROPIC_KEY   = os.environ["ANTHROPIC_API_KEY"]
STORAGE_BUCKET  = "corpus-raw"

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}

# ── Metadata extraction prompt ────────────────────────────────────────────────
# Designed to handle:
#   - WHO, NASCOP, Kenya MoH, ADA, NICE documents
#   - Both text-based and image/scanned cover pages
#   - Poorly formatted government documents
#   - Documents in English with Swahili section names

METADATA_PROMPT = """You are extracting metadata from the cover pages of a clinical or medical document.
Examine ALL text visible across these pages carefully, including headers, footers, logos, and small print.

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:

{
  "title": "Full document title exactly as written",
  "subtitle": "Subtitle if present, else null",
  "issuing_body": "Full name of the organisation that published this document",
  "issuing_body_canonical": "Short canonical name: WHO | NASCOP | Kenya MoH | KEMRI | MOH Uganda | MOH Tanzania | ADA | NICE | RCOG | CDC | other",
  "domain": "Single most relevant domain from: hiv | tb | malaria | maternal | paediatrics | neonatal | cardiology | respiratory | endocrinology | diabetes | gastroenterology | hepatology | mental_health | emergency_medicine | surgery | oncology | haematology | nephrology | neurology | dermatology | rheumatology | nutrition | vaccines | reproductive_health | general_medicine | other",
  "pub_year": 2022,
  "version": "e.g. 4th Edition, Version 2.0, 2022 Update — or null if not found",
  "geographic_scope": "kenya | east_africa | africa | global",
  "document_type": "clinical_practice_guideline | standard_treatment_guideline | protocol | training_manual | formulary | policy_document | reference_manual | other",
  "authority_rank": 2,
  "evidence_framework": "GRADE | Oxford | SIGN | WHO | Kenya MoH | unspecified | null",
  "licence": "Open text describing licence or copyright e.g. 'Kenya MoH open use' or 'WHO CC BY-NC-SA 3.0'",
  "authors": "Author names or authoring group if listed, else null",
  "doi": "DOI if visible, else null",
  "confidence": 0.95
}

Authority rank rules:
  1 = WHO, CDC, Cochrane, NICE
  2 = NASCOP, Kenya MoH, MOH regional, major international society (ADA, ESC etc.)
  3 = National body, county health, NGO guideline
  4 = Unknown or unclear issuing body

Confidence rules:
  0.9-1.0 = All key fields clearly visible
  0.7-0.9 = Most fields found, minor uncertainty
  0.5-0.7 = Some fields inferred, not directly stated
  0.0-0.5 = Cover page unclear or mostly image with little readable text

Return ONLY the JSON object. No markdown fences. No explanation."""


# ── PDF helpers ───────────────────────────────────────────────────────────────

def fetch_pdf_from_storage(storage_path: str) -> bytes | None:
    """Download PDF bytes from Supabase storage."""
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{storage_path}"
    try:
        r = httpx.get(
            url,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=120,
            follow_redirects=True,
        )
        if r.status_code == 200:
            return r.content
        log.warning("Storage fetch HTTP %d for %s", r.status_code, storage_path)
        return None
    except Exception as e:
        log.error("Storage fetch error for %s: %s", storage_path, e)
        return None


def render_cover_pages(pdf_bytes: bytes, n_pages: int = 5) -> list[str]:
    """
    Render first n_pages of PDF as base64-encoded PNG images.
    Uses 150 DPI — sufficient for metadata extraction, keeps image size small.
    Always renders as images (even text PDFs) for consistent Claude vision input.
    """
    images = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_num in range(min(n_pages, len(doc))):
            page = doc[page_num]
            mat = fitz.Matrix(150 / 72, 150 / 72)  # 150 DPI
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            img_bytes = pix.tobytes("png")
            images.append(base64.standard_b64encode(img_bytes).decode())
            pix = None   # explicit memory release
            page = None
        doc.close()
    except Exception as e:
        log.error("Cover page render error: %s", e)
    return images


# ── Claude metadata extraction ────────────────────────────────────────────────

def extract_metadata(pdf_bytes: bytes) -> dict:
    """
    Send cover page images to Claude Haiku for metadata extraction.
    Returns metadata dict including confidence score.
    Retries up to 3 times on transient API errors.
    """
    images = render_cover_pages(pdf_bytes, n_pages=5)
    if not images:
        return {"confidence": 0.0, "error": "no_pages_rendered"}

    # Build message content — images first, prompt last
    content = []
    for img_b64 in images:
        content.append({
            "type": "image",
            "source": {
                "type":       "base64",
                "media_type": "image/png",
                "data":       img_b64,
            }
        })
    content.append({"type": "text", "text": METADATA_PROMPT})

    for attempt in range(3):
        try:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key":         ANTHROPIC_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type":      "application/json",
                },
                json={
                    "model":      "claude-haiku-4-5",
                    "max_tokens": 1024,
                    "messages":   [{"role": "user", "content": content}],
                },
                timeout=60,
            )

            if r.status_code != 200:
                log.warning("Claude API HTTP %d on attempt %d", r.status_code, attempt + 1)
                time.sleep(5 * (attempt + 1))
                continue

            raw = r.json()["content"][0]["text"].strip()

            # Strip markdown fences if Claude added them
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)

            metadata = json.loads(raw)

            # Validate and clamp confidence
            conf = float(metadata.get("confidence", 0.5))
            metadata["confidence"] = max(0.0, min(1.0, conf))

            # Downgrade confidence if required fields are missing
            required = ["title", "issuing_body", "domain", "pub_year"]
            missing  = [f for f in required if not metadata.get(f)]
            if missing:
                log.warning("  Missing fields: %s — capping confidence at 0.6", missing)
                metadata["confidence"] = min(metadata["confidence"], 0.6)

            return metadata

        except json.JSONDecodeError as e:
            log.warning("JSON parse failed attempt %d: %s | raw: %s",
                        attempt + 1, e, raw[:200] if 'raw' in dir() else "")
            if attempt == 2:
                return {"confidence": 0.0, "error": "json_parse_failed"}
            time.sleep(3)

        except Exception as e:
            log.warning("Extraction attempt %d failed: %s", attempt + 1, e)
            if attempt == 2:
                return {"confidence": 0.0, "error": str(e)[:200]}
            time.sleep(5)

    return {"confidence": 0.0, "error": "all_attempts_failed"}


# ── Supabase helpers ──────────────────────────────────────────────────────────

def get_uploaded_docs(batch_size: int = 20) -> list[dict]:
    """Fetch docs with pipeline_status = 'uploaded'."""
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={
                "select":          "*",
                "pipeline_status": "eq.uploaded",
                "source_id":       "in.(pdf_intake)",
                "order":           "created_at.asc",
                "limit":           batch_size,
            },
            headers=SUPABASE_HEADERS,
            timeout=30,
        )
        if r.status_code == 200:
            return r.json()
        log.error("Fetch uploaded docs HTTP %d", r.status_code)
    except Exception as e:
        log.error("Fetch uploaded docs error: %s", e)
    return []


def update_doc_metadata(doc_id: str, metadata: dict, next_status: str):
    """
    Write extracted metadata back to corpus_documents.
    Maps Claude JSON fields to corpus_documents columns.
    """
    conf = metadata.get("confidence", 0.0)

    update = {
        "pipeline_status":   next_status,
        "guideline_title":   metadata.get("title"),
        "raw_metadata":      json.dumps(metadata),
        "metadata_confidence": conf,
        "updated_at":        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # Clear any previous error on success
    if next_status == "metadata_extracted":
        update["failed_stage"] = None
        update["last_error"]   = None
    else:
        update["failed_stage"] = "metadata"
        update["last_error"]   = (
            f"Low confidence: {conf:.2f} — {metadata.get('error', 'review needed')}"
        )

    try:
        r = httpx.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS,
            json=update,
            timeout=30,
        )
        return r.status_code == 200
    except Exception as e:
        log.error("Update doc metadata error for %s: %s", doc_id, e)
        return False


# ── Main stage entry point ────────────────────────────────────────────────────

def run(confidence_threshold: float = 0.7) -> dict:
    """
    Process all docs with pipeline_status = 'uploaded'.
    Returns summary stats.
    """
    stats = {"extracted": 0, "review": 0, "errors": 0}

    while True:
        docs = get_uploaded_docs(batch_size=10)
        if not docs:
            log.info("Stage 1: no uploaded docs to process")
            break

        for doc in docs:
            doc_id    = doc["id"]
            filename  = doc.get("original_filename", doc_id)
            source_url = doc.get("source_url", "")

            # Extract storage path from source_url
            # source_url format: storage://corpus-raw/pdf-intake/ab/abcd...pdf
            storage_path = source_url.replace(f"storage://{STORAGE_BUCKET}/", "")

            log.info("Stage 1 [%s]: extracting metadata", filename[:60])

            # Fetch PDF from storage
            pdf_bytes = fetch_pdf_from_storage(storage_path)
            if not pdf_bytes:
                update_doc_metadata(doc_id, {"confidence": 0.0, "error": "storage_fetch_failed"},
                                    "metadata_review")
                stats["errors"] += 1
                continue

            # Extract metadata from cover pages
            metadata = extract_metadata(pdf_bytes)
            conf     = metadata.get("confidence", 0.0)

            if conf >= confidence_threshold:
                next_status = "metadata_extracted"
                stats["extracted"] += 1
                log.info("  ✓ confidence=%.2f title='%s' body='%s' domain='%s'",
                         conf,
                         metadata.get("title", "")[:50],
                         metadata.get("issuing_body_canonical", ""),
                         metadata.get("domain", ""))
            else:
                next_status = "metadata_review"
                stats["review"] += 1
                log.warning("  ⚠ Low confidence=%.2f — flagged for review | error=%s",
                            conf, metadata.get("error", ""))

            update_doc_metadata(doc_id, metadata, next_status)

        # Brief pause between batches
        time.sleep(1)

    log.info("Stage 1 complete — extracted=%d review=%d errors=%d",
             stats["extracted"], stats["review"], stats["errors"])
    return stats
