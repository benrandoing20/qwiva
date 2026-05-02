"""
stage4_embed_insert.py
======================
Stage 4 of the PDF pipeline.

Loads chunks from storage, generates text-embedding-3-large embeddings,
and inserts into clinical_practice_guideline_chunks.

sanitize_row() normalises all field values against table constraints
before inserting. This handles both existing bad chunk files (produced
before constraint fixes) and new chunks from stage3.

Input:  corpus_documents WHERE pipeline_status = 'chunked'
Output: clinical_practice_guideline_chunks rows with embeddings
        corpus_documents pipeline_status -> 'complete'
"""

import os
import re
import json
import time
import logging
import httpx

log = logging.getLogger("pdf_pipeline.stage4")

SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
STORAGE_BUCKET = "corpus-raw"

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates,return=minimal",
}

EMBED_MODEL     = "text-embedding-3-large"
EMBED_DIM       = 1536
EMBED_BATCH     = 50
DB_BATCH_SIZE   = 25
MAX_EMBED_CHARS = 10_000

_supabase_session = httpx.Client(headers=SUPABASE_HEADERS, timeout=90)
_openai_session   = httpx.Client(
    headers={"Authorization": f"Bearer {OPENAI_API_KEY}", "Content-Type": "application/json"},
    timeout=60,
)


# ── Row sanitisation ──────────────────────────────────────────────────────────
# Normalises all field values against clinical_practice_guideline_chunks constraints.
# Called on every row before insert — handles both new chunks and legacy chunk files.

_VALID_CHUNK_TYPES = {
    "recommendation", "practice_point", "rationale", "evidence_summary",
    "clinical_consideration", "definition_criteria", "algorithm", "table",
    "background", "monitoring", "drug_dosing", "patient_guidance", "summary",
}

_CHUNK_TYPE_MAP = {
    "recommendation_statement": "recommendation",   # legacy value from earlier stage3
    "rationale":                "rationale",
    "background":               "background",
}

_VALID_DOC_TYPES = {
    "guideline", "protocol", "summary", "pocket_guide",
    "consensus_statement", "position_statement",
}

_DOCTYPE_MAP = {
    # Map any value from corpus_documents -> valid chunks table value
    "clinical_practice_guideline":   "guideline",
    "standard_treatment_guideline":  "guideline",
    "training_manual":               "guideline",
    "reference_manual":              "guideline",
    "policy_document":               "guideline",
    "formulary":                     "guideline",
    "other":                         "guideline",
    "research_article":              "guideline",
}

_VALID_DOMAINS = {
    "general_medicine", "emergency_medicine", "critical_care", "anaesthesia",
    "pharmacology", "public_health", "palliative_care", "other",
    "cardiology", "respiratory", "infectious_disease", "hiv",
    "obstetrics", "gynaecology", "paediatrics", "oncology", "haematology",
    "endocrinology", "nephrology", "urology", "gastroenterology", "hepatology",
    "neurology", "mental_health", "dermatology", "rheumatology", "orthopaedics",
    "ophthalmology", "surgery", "radiology",
}

_DOMAIN_MAP = {
    "maternal": "obstetrics", "neonatal": "paediatrics",
    "tb": "infectious_disease", "tuberculosis": "infectious_disease",
    "malaria": "infectious_disease", "sti": "infectious_disease",
    "amr": "infectious_disease", "ntd": "infectious_disease",
    "enteric": "infectious_disease", "hepatitis": "hepatology",
    "diabetes": "endocrinology", "cardiovascular": "cardiology",
    "cardiac": "cardiology", "nutrition": "public_health",
    "vaccines": "public_health", "reproductive": "gynaecology",
    "reproductive_health": "gynaecology", "emergency": "emergency_medicine",
    "palliative": "palliative_care", "mixed": "general_medicine",
    "who": "general_medicine", "hematology": "haematology",
    "cardiovascular": "cardiology", "mental health": "mental_health",
}

_VALID_EF = {
    "GRADE", "Oxford", "SIGN", "AHA_ACC", "unspecified",
    "RCOG grading", "RCOG", "NICE", "ADA", "WHO", "ESMO", "ESC", "EULAR", "other",
}

_EF_MAP = {
    "grade": "GRADE", "oxford": "Oxford", "sign": "SIGN",
    "aha_acc": "AHA_ACC", "aha/acc": "AHA_ACC",
    "rcog grading": "RCOG grading", "rcog": "RCOG",
    "nice": "NICE", "ada": "ADA", "who": "WHO",
    "esmo": "ESMO", "esc": "ESC", "eular": "EULAR",
    "unspecified": "unspecified",
    "kenya moh": "other", "nascop": "other", "kemri": "other",
}

_GRADE_STRENGTH_MAP = {
    # Normalise all variants to constraint-valid lowercase values
    "strong":             "strong",
    "strong for":         "strong",
    "strong against":     "strong",
    "conditional":        "conditional",
    "conditional for":    "conditional",
    "conditional against":"conditional",
    "weak":               "weak",
    "good practice":      "expert_opinion",
    "expert_opinion":     "expert_opinion",
    "expert opinion":     "expert_opinion",
}

_GRADE_EVIDENCE_MAP = {
    # Normalise all variants to constraint-valid values
    "high":         "high",
    "High":         "high",
    "moderate":     "moderate",
    "Moderate":     "moderate",
    "low":          "low",
    "Low":          "low",
    "very low":     "very_low",
    "Very low":     "very_low",
    "very_low":     "very_low",
}

_VALID_GEO = {
    "global", "kenya", "east_africa", "sub_saharan_africa", "africa", "other",
}

_GEO_MAP = {
    "east africa":      "east_africa",
    "sub-saharan":      "sub_saharan_africa",
    "sub saharan":      "sub_saharan_africa",
    "sub_saharan":      "sub_saharan_africa",
}


def sanitize_row(row: dict) -> dict:
    """
    Normalise all field values against clinical_practice_guideline_chunks constraints.
    Handles legacy chunk files (produced before constraint fixes) and new chunks.

    Constraints checked:
      chk_chunk_type           chunk_type IN allowed set
      chk_document_type        document_type IN allowed set
      chk_domain               domain IN allowed set or NULL
      chk_evidence_framework   evidence_framework IN allowed set or NULL
      chk_evidence_tier        1-3 or NULL
      chk_authority_rank       1-3 or NULL
      chk_section_depth        1-6 or NULL
      chk_grade_strength       'strong'/'conditional'/'weak'/'expert_opinion' or NULL
      chk_grade_direction      'for'/'against' or NULL (NOT empty string)
      chk_grade_evidence_quality  'high'/'moderate'/'low'/'very_low' or NULL
      chk_pub_year             1900-2100 or NULL
      chk_content_tokens       > 0
      chk_recommendation_fields  rec_id only when chunk_type IN ('recommendation','practice_point')
      chk_grade_consistency    grade_symbol NULL or grade_strength NOT NULL
      chk_chunk_position       chunk_index >= 0 AND chunk_total > 0 AND chunk_index < chunk_total
    """
    row = dict(row)

    # ── chunk_type ────────────────────────────────────────────────────────────
    ct = row.get("chunk_type") or "background"
    ct = _CHUNK_TYPE_MAP.get(ct, ct)  # map legacy values
    if ct not in _VALID_CHUNK_TYPES:
        ct = "background"
    row["chunk_type"] = ct

    # ── document_type ─────────────────────────────────────────────────────────
    dt = row.get("document_type") or "guideline"
    dt = _DOCTYPE_MAP.get(dt, dt)  # map legacy values
    if dt not in _VALID_DOC_TYPES:
        dt = "guideline"
    row["document_type"] = dt

    # ── domain ────────────────────────────────────────────────────────────────
    dom = row.get("domain") or "general_medicine"
    if dom not in _VALID_DOMAINS:
        dom = _DOMAIN_MAP.get(dom.lower().strip(), "general_medicine")
    row["domain"] = dom

    # ── evidence_framework ────────────────────────────────────────────────────
    ef = row.get("evidence_framework")
    if ef and ef not in _VALID_EF:
        ef = _EF_MAP.get(ef.lower().strip(), "other")
    row["evidence_framework"] = ef

    # ── geographic_scope ──────────────────────────────────────────────────────
    gs = row.get("geographic_scope") or "global"
    if gs not in _VALID_GEO:
        gs = _GEO_MAP.get(gs.lower().strip(), "global")
    row["geographic_scope"] = gs

    # ── evidence_tier: 1-3 or NULL ────────────────────────────────────────────
    et = row.get("evidence_tier")
    if et is not None:
        try:
            et = max(1, min(int(et), 3))
        except (ValueError, TypeError):
            et = None
    row["evidence_tier"] = et

    # ── authority_rank: 1-3 or NULL ───────────────────────────────────────────
    ar = row.get("authority_rank")
    if ar is not None:
        try:
            ar = max(1, min(int(ar), 3))
        except (ValueError, TypeError):
            ar = None
    row["authority_rank"] = ar

    # ── section_depth: 1-6 or NULL ───────────────────────────────────────────
    sd = row.get("section_depth")
    if sd is not None:
        try:
            sd = max(1, min(int(sd), 6))
        except (ValueError, TypeError):
            sd = None
    row["section_depth"] = sd

    # ── pub_year: 1900-2100 or NULL ───────────────────────────────────────────
    py = row.get("pub_year")
    if py is not None:
        try:
            py = int(py)
            if not (1900 <= py <= 2100):
                py = None
        except (ValueError, TypeError):
            py = None
    row["pub_year"] = py

    # ── date_published: YYYY-MM-DD or NULL (NOT bare year like "2024") ────────
    dp = row.get("date_published")
    if dp is not None:
        dp = str(dp).strip()
        if re.match(r'^\d{4}$', dp):
            dp = f"{dp}-01-01"
        elif not re.match(r'^\d{4}-\d{2}-\d{2}$', dp):
            dp = None
    row["date_published"] = dp

    # ── grade_strength: constraint-valid lowercase or NULL ────────────────────
    gs_val = row.get("grade_strength")
    if gs_val is not None and gs_val != "":
        gs_val = _GRADE_STRENGTH_MAP.get(gs_val, _GRADE_STRENGTH_MAP.get(gs_val.lower(), None))
    else:
        gs_val = None
    row["grade_strength"] = gs_val

    # ── grade_direction: NULL, 'for', or 'against' ONLY (not empty string) ───
    gd = row.get("grade_direction")
    if gd not in ("for", "against"):
        gd = None
    row["grade_direction"] = gd

    # ── grade_evidence_quality: constraint-valid or NULL ─────────────────────
    geq = row.get("grade_evidence_quality")
    if geq is not None and geq != "":
        geq = _GRADE_EVIDENCE_MAP.get(geq, _GRADE_EVIDENCE_MAP.get(geq.lower(), None))
    else:
        geq = None
    row["grade_evidence_quality"] = geq

    # ── grade_symbol: must be NULL if grade_strength is NULL ─────────────────
    # chk_grade_consistency: grade_symbol IS NULL OR grade_strength IS NOT NULL
    if row.get("grade_strength") is None:
        row["grade_symbol"] = None
    # Also normalise empty string to NULL
    if row.get("grade_symbol") == "":
        row["grade_symbol"] = None

    # ── content_tokens: must be > 0 ──────────────────────────────────────────
    ct_val = row.get("content_tokens")
    if not ct_val or int(ct_val) < 1:
        row["content_tokens"] = max(1, len(row.get("content", "").split()))

    # ── recommendation_id: only valid for recommendation/practice_point ───────
    if row.get("recommendation_id") and row.get("chunk_type") not in ("recommendation", "practice_point"):
        row["recommendation_id"] = None

    # ── Remove None embedding — Supabase rejects explicit null for vector ────
    if row.get("embedding") is None:
        row.pop("embedding", None)

    return row


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_batch(texts: list) -> list:
    safe_texts = [t[:MAX_EMBED_CHARS] for t in texts]
    for attempt in range(4):
        try:
            time.sleep(0.05)
            r = _openai_session.post(
                "https://api.openai.com/v1/embeddings",
                json={"model": EMBED_MODEL, "input": safe_texts, "dimensions": EMBED_DIM},
            )
            if r.status_code == 200:
                data = r.json()["data"]
                return [d["embedding"] for d in sorted(data, key=lambda x: x["index"])]
            elif r.status_code == 429:
                time.sleep(10 * (2 ** attempt))
            else:
                log.error("OpenAI embed %d: %s", r.status_code, r.text[:200])
                return [[] for _ in texts]
        except Exception as e:
            log.warning("Embed attempt %d: %s", attempt+1, e)
            time.sleep(5 * (2 ** attempt))
    return [[] for _ in texts]


def embed_chunks(chunks: list) -> list:
    total, batch_sz, i = len(chunks), EMBED_BATCH, 0
    while i < total:
        batch   = chunks[i: i + batch_sz]
        texts   = [c["content"] for c in batch]
        vectors = embed_batch(texts)
        success = sum(1 for v in vectors if v)

        if success == 0 and batch_sz > 10:
            batch_sz = max(10, batch_sz // 2)
            log.warning("Embed batch failed — reducing to %d", batch_sz)
            continue

        if success == 0:
            for chunk in batch:
                solo = embed_batch([chunk["content"][:MAX_EMBED_CHARS]])
                if solo and solo[0]:
                    chunk["embedding"] = solo[0]
            i += len(batch)
            continue

        for chunk, vec in zip(batch, vectors):
            if vec:
                chunk["embedding"] = vec
        i += len(batch)
        if i % 500 == 0:
            log.info("  Embedded %d/%d", i, total)

    return chunks


# ── DB insert ─────────────────────────────────────────────────────────────────

def write_chunks_batch(rows: list) -> tuple:
    if not rows:
        return 0, 0

    # Sanitise + deduplicate
    seen, deduped = set(), []
    for row in rows:
        key = (row.get("doc_id"), row.get("chunk_index"))
        if key not in seen:
            seen.add(key)
            deduped.append(sanitize_row(row))

    # Batch insert with retry
    for attempt in range(3):
        try:
            r = _supabase_session.post(
                f"{SUPABASE_URL}/rest/v1/clinical_practice_guideline_chunks",
                params={"on_conflict": "doc_id,chunk_index"},
                json=deduped,
            )
            if r.status_code in (200, 201):
                return len(deduped), 0
            if r.status_code in (500, 502, 503, 504):
                time.sleep(15 * (2 ** attempt))
                continue
            log.warning("Batch insert %d: %s — falling back to row-by-row",
                        r.status_code, r.text[:200])
            break
        except Exception as e:
            log.warning("Batch write error attempt %d: %s", attempt+1, e)
            time.sleep(10)

    # Row-by-row fallback
    written = errors = 0
    for row in deduped:
        for attempt in range(3):
            try:
                r2 = _supabase_session.post(
                    f"{SUPABASE_URL}/rest/v1/clinical_practice_guideline_chunks",
                    params={"on_conflict": "doc_id,chunk_index"},
                    json=row,
                )
                if r2.status_code in (200, 201):
                    written += 1
                    break
                elif r2.status_code in (500, 502, 503, 504):
                    time.sleep(10 * (attempt + 1))
                else:
                    log.warning("Row insert %d: %s", r2.status_code, r2.text[:150])
                    errors += 1
                    break
            except Exception as e:
                log.warning("Row write error: %s", e)
                time.sleep(5)
        else:
            errors += 1

    return written, errors


# ── Storage helpers ───────────────────────────────────────────────────────────

def load_chunks_from_storage(doc_id: str) -> list | None:
    url = (f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
           f"pdf-chunks/{doc_id[:2]}/{doc_id}_chunks.json")
    try:
        r = httpx.get(
            url,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=60,
        )
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        log.error("Load chunks error for %s: %s", doc_id, e)
    return None


def get_chunked_docs(batch_size: int = 5) -> list:
    try:
        r = _supabase_session.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "id,original_filename,raw_metadata",
                    "pipeline_status": "eq.chunked", "source_id": "in.(pdf_intake)",
                    "order": "file_size_bytes.asc", "limit": batch_size},
        )
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        log.error("Fetch chunked docs error: %s", e)
        return []


def mark_complete(doc_id: str):
    try:
        _supabase_session.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            json={"pipeline_status": "complete", "failed_stage": None,
                  "last_error": None,
                  "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        )
    except Exception as e:
        log.error("Mark complete error for %s: %s", doc_id, e)


def mark_failed(doc_id: str, error: str):
    try:
        _supabase_session.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            json={"pipeline_status": "failed", "failed_stage": "embed",
                  "last_error": error[:500],
                  "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        )
    except Exception as e:
        log.error("Mark failed error: %s", e)


# ── Stage entry point ─────────────────────────────────────────────────────────

def run() -> dict:
    stats = {"complete": 0, "chunks_written": 0, "errors": 0}

    while True:
        docs = get_chunked_docs(batch_size=5)
        if not docs:
            log.info("Stage 4: no chunked docs to embed")
            break

        for doc in docs:
            doc_id   = doc["id"]
            filename = doc.get("original_filename", doc_id)
            log.info("Stage 4 [%s]: embedding + inserting", filename[:60])

            chunks = load_chunks_from_storage(doc_id)
            if not chunks:
                mark_failed(doc_id, "chunks_not_found_in_storage")
                stats["errors"] += 1
                continue

            log.info("  Loaded %d chunks", len(chunks))

            try:
                chunks = embed_chunks(chunks)
            except Exception as e:
                log.error("  Embedding error: %s", e)
                mark_failed(doc_id, f"embed_error: {e}")
                stats["errors"] += 1
                continue

            embedded_count = sum(1 for c in chunks if c.get("embedding"))
            log.info("  Embedded: %d/%d", embedded_count, len(chunks))

            total_written = total_errors = 0
            for i in range(0, len(chunks), DB_BATCH_SIZE):
                w, e = write_chunks_batch(chunks[i: i + DB_BATCH_SIZE])
                total_written += w
                total_errors  += e

            log.info("  Inserted: %d/%d (%d errors)",
                     total_written, len(chunks), total_errors)

            if total_errors > len(chunks) * 0.3:
                mark_failed(doc_id, f"high_error_rate: {total_errors}/{len(chunks)}")
                stats["errors"] += 1
            else:
                mark_complete(doc_id)
                stats["complete"]       += 1
                stats["chunks_written"] += total_written

        time.sleep(2)

    log.info("Stage 4 complete — complete=%d chunks=%d errors=%d",
             stats["complete"], stats["chunks_written"], stats["errors"])
    return stats
