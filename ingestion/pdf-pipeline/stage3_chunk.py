"""
stage3_chunk.py
===============
Stage 3 of the PDF pipeline.

Reads extracted page text from storage, detects document structure,
splits into 200-400 word chunks, and enriches with clinical metadata.

Output schema exactly matches clinical_practice_guideline_chunks constraints.

Input:  corpus_documents WHERE pipeline_status = 'stored'
Output: Chunk JSON files in storage
        corpus_documents pipeline_status -> 'chunked'
"""

import os
import re
import json
import time
import hashlib
import logging
import httpx

log = logging.getLogger("pdf_pipeline.stage3")

SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_KEY"]
STORAGE_BUCKET = "corpus-raw"

SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}

MIN_CHUNK_WORDS = 60
MAX_CHUNK_WORDS = 400
OVERLAP_WORDS   = 50

# ── Constraint-valid value sets ───────────────────────────────────────────────
# These must exactly match chk_* constraints in clinical_practice_guideline_chunks.

VALID_CHUNK_TYPES = {
    "recommendation", "practice_point", "rationale", "evidence_summary",
    "clinical_consideration", "definition_criteria", "algorithm", "table",
    "background", "monitoring", "drug_dosing", "patient_guidance", "summary",
}

VALID_DOCUMENT_TYPES = {
    "guideline", "protocol", "summary", "pocket_guide",
    "consensus_statement", "position_statement",
}

VALID_GRADE_STRENGTHS = {"strong", "conditional", "weak", "expert_opinion"}

VALID_GRADE_EVIDENCE = {"high", "moderate", "low", "very_low"}

VALID_GRADE_DIRECTIONS = {"for", "against"}

VALID_EVIDENCE_FRAMEWORKS = {
    "GRADE", "Oxford", "SIGN", "AHA_ACC", "unspecified",
    "RCOG grading", "RCOG", "NICE", "ADA", "WHO", "ESMO", "ESC", "EULAR", "other",
}

VALID_DOMAINS = {
    "general_medicine", "emergency_medicine", "critical_care", "anaesthesia",
    "pharmacology", "public_health", "palliative_care", "other",
    "cardiology", "respiratory", "infectious_disease", "hiv",
    "obstetrics", "gynaecology", "paediatrics", "oncology", "haematology",
    "endocrinology", "nephrology", "urology", "gastroenterology", "hepatology",
    "neurology", "mental_health", "dermatology", "rheumatology", "orthopaedics",
    "ophthalmology", "surgery", "radiology",
}

# ── Domain normalisation ──────────────────────────────────────────────────────
# Maps values Claude may return (from stage1 metadata extraction) to the
# allowed values in the chk_domain constraint.
DOMAIN_NORM = {
    # Claude stage1 values -> constraint values
    "maternal":           "obstetrics",
    "neonatal":           "paediatrics",
    "tb":                 "infectious_disease",
    "tuberculosis":       "infectious_disease",
    "malaria":            "infectious_disease",
    "sti":                "infectious_disease",
    "amr":                "infectious_disease",
    "ntd":                "infectious_disease",
    "enteric":            "infectious_disease",
    "hepatitis":          "hepatology",
    "diabetes":           "endocrinology",
    "cardiovascular":     "cardiology",
    "cardiac":            "cardiology",
    "nutrition":          "public_health",
    "vaccines":           "public_health",
    "reproductive":       "gynaecology",
    "reproductive_health":"gynaecology",
    "emergency":          "emergency_medicine",
    "palliative":         "palliative_care",
    "mixed":              "general_medicine",
    "who":                "general_medicine",
    "hematology":         "haematology",  # US spelling
    "mental health":      "mental_health",
    "eye":                "ophthalmology",
    "ophthalmology":      "ophthalmology",
}

def normalize_domain(domain: str) -> str:
    if not domain:
        return "general_medicine"
    d = domain.lower().strip()
    if d in VALID_DOMAINS:
        return d
    return DOMAIN_NORM.get(d, "general_medicine")


# ── Document type normalisation ───────────────────────────────────────────────
# corpus_documents.document_type uses 'guideline'
# clinical_practice_guideline_chunks.document_type ALSO uses 'guideline'
# (NOT 'clinical_practice_guideline' — that value is NOT in the constraint)
DOCTYPE_NORM = {
    "guideline":                     "guideline",
    "clinical_practice_guideline":   "guideline",   # map back — chunks table uses 'guideline'
    "standard_treatment_guideline":  "guideline",
    "training_manual":               "guideline",
    "reference_manual":              "guideline",
    "policy_document":               "guideline",
    "formulary":                     "guideline",
    "other":                         "guideline",
    "protocol":                      "protocol",
    "consensus_statement":           "consensus_statement",
    "position_statement":            "position_statement",
    "pocket_guide":                  "pocket_guide",
    "summary":                       "summary",
}

# ── Evidence framework normalisation ─────────────────────────────────────────
EF_NORM = {
    "grade":              "GRADE",
    "oxford":             "Oxford",
    "sign":               "SIGN",
    "aha_acc":            "AHA_ACC",
    "aha/acc":            "AHA_ACC",
    "rcog grading":       "RCOG grading",
    "rcog":               "RCOG",
    "nice":               "NICE",
    "ada":                "ADA",
    "who":                "WHO",
    "esmo":               "ESMO",
    "esc":                "ESC",
    "eular":              "EULAR",
    "unspecified":        "unspecified",
    "kenya moh":          "other",
    "kenya ministry":     "other",
    "nascop":             "other",
    "kemri":              "other",
}

def normalize_evidence_framework(ef: str) -> str | None:
    if not ef:
        return "unspecified"
    if ef in VALID_EVIDENCE_FRAMEWORKS:
        return ef
    return EF_NORM.get(ef.lower().strip(), "other")


# ── Domain -> evidence_framework default ──────────────────────────────────────
DOMAIN_FRAMEWORK_MAP = {
    "hiv":               "WHO",
    "tb":                "WHO",
    "infectious_disease":"WHO",
    "malaria":           "WHO",
    "obstetrics":        "WHO",
    "paediatrics":       "WHO",
    "cardiology":        "GRADE",
    "respiratory":       "GRADE",
    "endocrinology":     "GRADE",
    "gastroenterology":  "GRADE",
    "mental_health":     "WHO",
    "general_medicine":  "unspecified",
}


# ── GRADE / Recommendation detection ─────────────────────────────────────────

RECOMMENDATION_RE = re.compile(
    r'(?:'
    r'[Ww]e (?:strongly )?recommend\b|'
    r'[Ww]e (?:weakly )?suggest\b|'
    r'[Ss]trong recommendation|'
    r'[Cc]onditional recommendation|'
    r'[Gg]ood practice statement|'
    r'[Ii]t is recommended|'
    r'[Ss]hould be (?:offered|used|given|provided|initiated|started)\b|'
    r'[Ii]s recommended for\b|'
    r'[Aa]re recommended for\b|'
    r'\((?:strong|conditional|weak),\s*(?:high|moderate|low|very low)[^\)]{0,30}\)|'
    r'\([12][ABCD]\)|'
    r'\([Gg]rade\s+[ABCE]\)|'
    r'(?:STRONG|CONDITIONAL)\s+RECOMMENDATION|'
    r'[Rr]ecommendation\s+\d+[.:]\s*|'
    r'^[A-Z]\.\s+(?:We |It |All |Patients )'
    r')'
)

# Maps detected text patterns to constraint-valid grade_strength values
# Constraint allows: 'strong', 'conditional', 'weak', 'expert_opinion'
GRADE_STRENGTH_MAP = [
    ("strong recommendation",              "strong"),
    ("we strongly recommend",              "strong"),
    ("we recommend",                       "strong"),
    ("is recommended",                     "strong"),
    ("are recommended",                    "strong"),
    ("should be",                          "strong"),
    ("conditional recommendation",         "conditional"),
    ("we suggest",                         "conditional"),
    ("may be considered",                  "conditional"),
    ("good practice statement",            "expert_opinion"),
    ("good practice",                      "expert_opinion"),
    ("expert opinion",                     "expert_opinion"),
]

# Maps detected text to constraint-valid grade_evidence_quality values
# Constraint allows: 'high', 'moderate', 'low', 'very_low'
GRADE_EVIDENCE_MAP = [
    ("high certainty",     "high"),
    ("high-certainty",     "high"),
    ("moderate certainty", "moderate"),
    ("low certainty",      "low"),
    ("very low certainty", "very_low"),
    ("very-low certainty", "very_low"),
    ("grade a",            "high"),
    ("level a",            "high"),
    ("grade b",            "moderate"),
    ("level b",            "moderate"),
    ("grade c",            "low"),
    ("level c",            "low"),
    ("level 1",            "high"),
    ("level 2",            "moderate"),
]

POPULATION_TAGS = {
    "adults":      [r'(?i)\badult[s]?\b'],
    "children":    [r'(?i)\bchild(?:ren)?\b', r'(?i)\bpediatric\b', r'(?i)\bpaediatric\b'],
    "infants":     [r'(?i)\binfant[s]?\b', r'(?i)\bneonatal\b', r'(?i)\bnewborn\b'],
    "pregnant":    [r'(?i)\bpregnant\b', r'(?i)\bpregnancy\b', r'(?i)\bmaternal\b', r'(?i)\bantenatal\b'],
    "adolescents": [r'(?i)\badolescent[s]?\b', r'(?i)\bteenager[s]?\b'],
    "hiv_positive":[r'(?i)\bPLHIV\b', r'(?i)\bHIV.positive\b', r'(?i)\bpeople living with HIV\b'],
}

INTERVENTION_TAGS = {
    "dolutegravir":            [r'(?i)\bdolutegravir\b', r'(?i)\bDTG\b(?!\w)'],
    "ART":                     [r'(?i)\bantiretroviral\b', r'(?i)\bART\b(?!\w)', r'(?i)\bHAART\b'],
    "cotrimoxazole":           [r'(?i)\bcotrimoxazole\b', r'(?i)\btrimethoprim.sulfamethoxazole\b'],
    "ACT":                     [r'(?i)\bartemisinin.based combination\b', r'(?i)\bACT\b(?!\w)'],
    "artemether-lumefantrine": [r'(?i)\bartemether.lumefantrine\b', r'(?i)\bCoartem\b'],
    "isoniazid":               [r'(?i)\bisoniazid\b', r'(?i)\bINH\b(?!\w)'],
    "rifampicin":              [r'(?i)\brifampicin\b', r'(?i)\brifampin\b'],
    "oxytocin":                [r'(?i)\boxytocin\b'],
    "misoprostol":             [r'(?i)\bmisoprostol\b'],
    "metformin":               [r'(?i)\bmetformin\b'],
    "insulin":                 [r'(?i)\binsulin\b'],
    "iron-supplements":        [r'(?i)\biron supplement\b', r'(?i)\bferrous\b'],
    "folic-acid":              [r'(?i)\bfolic acid\b', r'(?i)\bfolate\b'],
}

HAS_DOSAGE_RE = re.compile(
    r'(?i)(?:\d+\s*mg|\d+\s*mcg|\d+\s*g\b|\d+\s*ml\b|'
    r'\d+\s*(?:tablet|capsule|vial|unit|IU|dose)s?\b|'
    r'twice daily|once daily|BD|TDS|OD\b|per kg|mg/kg)'
)

SKIP_SECTIONS = frozenset({
    "references", "bibliography", "acknowledgements", "acknowledgments",
    "conflict of interest", "funding", "abbreviations", "glossary",
    "annex", "appendix", "contents", "table of contents", "foreword",
    "preface", "acronyms", "list of tables", "list of figures",
})


# ── Clinical enrichment helpers ───────────────────────────────────────────────

def detect_grade_strength(text: str) -> str | None:
    """Returns constraint-valid grade_strength value or None."""
    tl = text.lower()
    for marker, label in GRADE_STRENGTH_MAP:
        if marker in tl:
            return label
    return None


def detect_grade_evidence(text: str) -> str | None:
    """Returns constraint-valid grade_evidence_quality value or None."""
    tl = text.lower()
    for marker, label in GRADE_EVIDENCE_MAP:
        if marker in tl:
            return label
    return None


def classify_chunk_type(text: str, is_rec_position: bool) -> str:
    """
    Returns constraint-valid chunk_type value.
    Constraint allows: recommendation, practice_point, rationale,
    evidence_summary, clinical_consideration, definition_criteria,
    algorithm, table, background, monitoring, drug_dosing,
    patient_guidance, summary
    """
    if is_rec_position and RECOMMENDATION_RE.search(text):
        return "recommendation"   # was 'recommendation_statement' — NOT in constraint

    tl = text.lower()

    # Detect specialised types
    if HAS_DOSAGE_RE.search(text) and any(
        w in tl for w in ("dose", "dosage", "dosing", "mg/kg", "per kg")
    ):
        return "drug_dosing"

    if any(w in tl for w in ("monitor", "surveillance", "follow-up", "follow up")):
        return "monitoring"

    if any(w in tl for w in ("defined as", "criterion", "criteria", "classified as")):
        return "definition_criteria"

    evidence_signals = sum(1 for p in [
        r'(?i)\bevidence\b', r'(?i)\btrial\b', r'(?i)\bmeta.analysis\b',
        r'(?i)\bsystematic review\b', r'(?i)\bRCT\b', r'(?i)\bstudy\b',
    ] if re.search(p, text))
    if evidence_signals >= 2:
        return "rationale"

    return "background"


def extract_population_tags(text: str) -> list:
    return [t for t, patterns in POPULATION_TAGS.items()
            if any(re.search(p, text) for p in patterns)]


def extract_intervention_tags(text: str) -> list:
    return [t for t, patterns in INTERVENTION_TAGS.items()
            if any(re.search(p, text) for p in patterns)]


# ── Structure detection ───────────────────────────────────────────────────────

def detect_sections(full_text: str, doc_title: str) -> list:
    sections = []

    # Strategy 1: Markdown headings
    md_re      = re.compile(r'^(#{1,3})\s+(.+)$', re.MULTILINE)
    md_matches = list(md_re.finditer(full_text))
    if len(md_matches) >= 3:
        for i, m in enumerate(md_matches):
            end     = md_matches[i+1].start() if i+1 < len(md_matches) else len(full_text)
            content = full_text[m.end():end].strip()
            sections.append({
                "title": m.group(2).strip(), "content": content,
                "depth": len(m.group(1)), "method": "markdown_heading",
            })
        if sections:
            return sections

    # Strategy 2: ALL CAPS headings
    caps_re      = re.compile(r'^([A-Z][A-Z\s\d\/\-]{4,60})\s*$', re.MULTILINE)
    caps_matches = [m for m in caps_re.finditer(full_text) if len(m.group(1).split()) <= 8]
    if len(caps_matches) >= 3:
        for i, m in enumerate(caps_matches):
            end     = caps_matches[i+1].start() if i+1 < len(caps_matches) else len(full_text)
            content = full_text[m.end():end].strip()
            if len(content.split()) >= MIN_CHUNK_WORDS:
                sections.append({
                    "title": m.group(1).strip().title(), "content": content,
                    "depth": 1, "method": "caps_heading",
                })
        if sections:
            return sections

    # Strategy 3: Numbered headings
    num_re      = re.compile(r'^(\d+(?:\.\d+)*\.?\s+[A-Z][^\n]{3,60})$', re.MULTILINE)
    num_matches = list(num_re.finditer(full_text))
    if len(num_matches) >= 3:
        for i, m in enumerate(num_matches):
            end     = num_matches[i+1].start() if i+1 < len(num_matches) else len(full_text)
            content = full_text[m.end():end].strip()
            if len(content.split()) >= MIN_CHUNK_WORDS:
                sections.append({
                    "title": m.group(1).strip(), "content": content,
                    "depth": 1, "method": "numbered_heading",
                })
        if sections:
            return sections

    # Fallback: whole document as one section
    return [{"title": doc_title, "content": full_text, "depth": 1, "method": "sliding_window"}]


# ── Chunking ──────────────────────────────────────────────────────────────────

def split_into_chunks(text: str) -> list:
    if len(text.split()) <= MAX_CHUNK_WORDS:
        return [text] if len(text.split()) >= MIN_CHUNK_WORDS else []

    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, buf_sents, buf_words = [], [], 0

    for sent in sentences:
        sw = len(sent.split())
        if buf_sents and buf_words + sw > MAX_CHUNK_WORDS:
            chunks.append(" ".join(buf_sents))
            new_buf, new_words = [], 0
            for prev in reversed(buf_sents):
                pw = len(prev.split())
                if new_words + pw <= OVERLAP_WORDS:
                    new_buf.insert(0, prev)
                    new_words += pw
                else:
                    break
            buf_sents, buf_words = new_buf, new_words
        buf_sents.append(sent)
        buf_words += sw

    if buf_sents:
        chunks.append(" ".join(buf_sents))

    final = []
    for chunk in chunks:
        words = chunk.split()
        if len(words) > MAX_CHUNK_WORDS:
            step = max(1, MAX_CHUNK_WORDS - OVERLAP_WORDS)
            for i in range(0, len(words), step):
                window = " ".join(words[i:i + MAX_CHUNK_WORDS])
                if len(window.split()) >= MIN_CHUNK_WORDS:
                    final.append(window)
        elif len(words) >= MIN_CHUNK_WORDS:
            final.append(chunk)

    return final


# ── Text assembly ─────────────────────────────────────────────────────────────

def assemble_full_text(page_results: list) -> str:
    parts = []
    for page in page_results:
        text = page.get("text", "").strip()
        if not text:
            continue
        text = re.sub(r'\f',       '\n',  text)
        text = re.sub(r'[^\S\n]+', ' ',   text)
        text = re.sub(r'\n{3,}',   '\n\n', text)
        text = re.sub(r'- \n',     '',     text)
        parts.append(text)
    return "\n\n".join(parts)


# ── Chunk builder ─────────────────────────────────────────────────────────────

def build_chunks_from_doc(doc: dict, page_results: list) -> list:
    """
    Build chunk dicts matching clinical_practice_guideline_chunks schema.
    All field values are validated against table constraints before output.
    """
    raw_meta = doc.get("raw_metadata") or {}
    if isinstance(raw_meta, str):
        raw_meta = json.loads(raw_meta)

    # ── Extract metadata from Claude stage1 output ────────────────────────────
    title        = raw_meta.get("title") or doc.get("guideline_title") or "Unknown"
    issuing_body = raw_meta.get("issuing_body") or "Unknown"
    body_canonical = raw_meta.get("issuing_body_canonical") or issuing_body

    # Normalize domain to constraint-valid values
    domain       = normalize_domain(raw_meta.get("domain") or "general_medicine")

    pub_year     = raw_meta.get("pub_year") or 0
    try:
        pub_year = int(pub_year)
    except (ValueError, TypeError):
        pub_year = 0

    version      = raw_meta.get("version") or str(pub_year) or "unknown"
    geo_scope    = raw_meta.get("geographic_scope") or "global"

    # Normalize document_type — chunks table uses 'guideline' not 'clinical_practice_guideline'
    _raw_dt  = raw_meta.get("document_type") or "guideline"
    doc_type = DOCTYPE_NORM.get(_raw_dt, "guideline")

    # Authority rank — constraint: 1-3 only (or NULL)
    auth_rank = int(raw_meta.get("authority_rank") or 3)
    auth_rank = max(1, min(auth_rank, 3))  # clamp to 1-3

    # Evidence framework — normalize to constraint values
    evidence_fw = normalize_evidence_framework(
        raw_meta.get("evidence_framework")
        or DOMAIN_FRAMEWORK_MAP.get(domain, "unspecified")
    )

    licence  = raw_meta.get("licence") or "restricted"
    authors  = raw_meta.get("authors") or ""
    doi      = raw_meta.get("doi") or None

    # Evidence tier — constraint: 1-3 only (or NULL)
    tier_map = {
        "guideline":          1,
        "protocol":           1,
        "consensus_statement":1,
        "position_statement": 1,
        "pocket_guide":       2,
        "summary":            2,
    }
    evidence_tier = tier_map.get(doc_type, 1)  # default 1 for guidelines

    # Build full text and detect structure
    full_text = assemble_full_text(page_results)
    if not full_text.strip():
        log.warning("  No text extracted from %s", doc["id"])
        return []

    sections = detect_sections(full_text, title)
    log.info("  %d sections detected (method: %s)",
             len(sections), sections[0]["method"] if sections else "none")

    # Build chunks
    chunks = []
    doc_id = doc["id"]
    rec_n  = 0

    for section in sections:
        sec_title = section.get("title", "").strip()
        content   = section.get("content", "").strip()
        depth     = section.get("depth", 1)
        method    = section.get("method", "unknown")

        # section_depth constraint: 1-6
        depth = max(1, min(int(depth or 1), 6))

        if any(skip in sec_title.lower() for skip in SKIP_SECTIONS):
            continue
        if not content or len(content.split()) < MIN_CHUNK_WORDS:
            continue

        rec_positions = [m.start() for m in RECOMMENDATION_RE.finditer(content)]
        segments = []

        if rec_positions:
            if rec_positions[0] > MIN_CHUNK_WORDS * 5:
                for c in split_into_chunks(content[:rec_positions[0]].strip()):
                    segments.append((False, c))
            for i, pos in enumerate(rec_positions):
                end = rec_positions[i+1] if i+1 < len(rec_positions) else len(content)
                for c in split_into_chunks(content[pos:end].strip()):
                    segments.append((True, c))
        else:
            for c in split_into_chunks(content):
                segments.append((False, c))

        for is_rec, chunk_text in segments:
            chunk_type = classify_chunk_type(chunk_text, is_rec)
            strength   = detect_grade_strength(chunk_text) if is_rec else None
            evidence   = detect_grade_evidence(chunk_text) if is_rec else None
            pop_tags   = extract_population_tags(chunk_text)
            int_tags   = extract_intervention_tags(chunk_text)
            has_dosage = bool(HAS_DOSAGE_RE.search(chunk_text))
            has_rec    = bool(RECOMMENDATION_RE.search(chunk_text))

            # recommendation_id only valid when chunk_type in ('recommendation', 'practice_point')
            if chunk_type in ("recommendation", "practice_point"):
                rec_n += 1
                rec_id = f"PDF{doc_id[:8].upper()}-R{rec_n}"
            else:
                rec_id = None

            content_hash = hashlib.sha256(chunk_text.encode()).hexdigest()[:32]
            word_count   = len(chunk_text.split())

            chunks.append({
                # Identity
                "doc_id":          doc_id,
                "content_hash":    content_hash,
                "file_hash":       doc_id,

                # Content
                "content":         chunk_text,
                "word_count":      word_count,
                "content_tokens":  max(1, word_count),  # chk_content_tokens: must be > 0

                # Document metadata — all values validated against constraints
                "guideline_title":        title,
                "guideline_version":      version,
                "issuing_body":           issuing_body,
                "issuing_body_canonical": body_canonical,
                "domain":                 domain,
                "document_type":          doc_type,           # 'guideline' (NOT 'clinical_practice_guideline')
                "evidence_framework":     evidence_fw,
                "evidence_tier":          evidence_tier,      # 1-3
                "authority_rank":         auth_rank,          # 1-3
                "geographic_scope":       geo_scope,
                "pub_year":               pub_year if pub_year else None,
                # date_published: YYYY-MM-DD format required (NOT just "2024")
                "date_published":         f"{pub_year}-01-01" if pub_year else None,
                "licence":                licence,
                "authors":                authors,
                "doi":                    doi,
                "source_url":             doc.get("source_url", ""),
                "is_current_version":     True,
                "superseded_by":          None,

                # Section structure
                "chapter_title":          sec_title,
                "section_path":           [sec_title] if sec_title else [title],
                "section_depth":          depth,              # 1-6
                "chapter_detection_method": method,

                # Clinical classification
                "chunk_type":             chunk_type,         # constraint-valid value
                "has_recommendation":     has_rec,
                "has_dosage":             has_dosage,
                "recommendation_id":      rec_id,
                "recommendation_text":    None,
                "confidence_score":       None,
                # grade values: None (not "") for unset fields — constraint uses IS NULL checks
                "grade_strength":         strength,           # None or 'strong'/'conditional'/'weak'/'expert_opinion'
                "grade_direction":        None,               # None (not "") — constraint: NULL or 'for'/'against'
                "grade_evidence_quality": evidence,           # None or 'high'/'moderate'/'low'/'very_low'
                "grade_symbol":           None,               # None (not "")

                # Tags
                "population_tags":    pop_tags,
                "intervention_tags":  int_tags,
                "drug_names":         int_tags,
                "condition_tags":     [],

                # Embedding (populated by stage 4)
                "embedding":          None,
                "embedding_model":    "text-embedding-3-large",

                # Contextual text for RAG
                "contextual_text": f"{title} — {sec_title}: {chunk_text[:200]}",
            })

    total = len(chunks)
    for i, chunk in enumerate(chunks):
        chunk["chunk_index"] = i
        chunk["chunk_total"] = total

    return chunks


# ── Storage helpers ───────────────────────────────────────────────────────────

def load_page_results(doc_id: str) -> list | None:
    url = (f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
           f"pdf-extraction/{doc_id[:2]}/{doc_id}_pages.json")
    try:
        r = httpx.get(
            url,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
            timeout=60,
        )
        if r.status_code == 200:
            return r.json().get("pages", [])
    except Exception as e:
        log.error("Load page results error for %s: %s", doc_id, e)
    return None


def save_chunks_to_storage(doc_id: str, chunks: list) -> bool:
    slim        = [{k: v for k, v in c.items() if k != "embedding"} for c in chunks]
    chunk_bytes = json.dumps(slim, ensure_ascii=False).encode("utf-8")
    url = (f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
           f"pdf-chunks/{doc_id[:2]}/{doc_id}_chunks.json")
    try:
        r = httpx.put(
            url, content=chunk_bytes,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                     "Content-Type": "application/json", "x-upsert": "true"},
            timeout=60,
        )
        return r.status_code in (200, 201)
    except Exception as e:
        log.error("Save chunks error for %s: %s", doc_id, e)
        return False


def get_stored_docs(batch_size: int = 10) -> list:
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "*", "pipeline_status": "eq.stored",
                    "source_id": "in.(pdf_intake)", "order": "file_size_bytes.asc",
                    "limit": batch_size},
            headers=SUPABASE_HEADERS, timeout=30,
        )
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        log.error("Fetch stored docs error: %s", e)
        return []


def update_doc_chunked(doc_id: str, chunk_count: int, chunk_storage_path: str):
    try:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"select": "raw_metadata", "id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS, timeout=15,
        )
        existing = {}
        if r.status_code == 200 and r.json():
            existing = r.json()[0].get("raw_metadata") or {}
            if isinstance(existing, str):
                existing = json.loads(existing)
        existing["chunk_count"]        = chunk_count
        existing["chunk_storage_path"] = chunk_storage_path

        httpx.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS,
            json={"pipeline_status": "chunked", "failed_stage": None,
                  "last_error": None, "raw_metadata": json.dumps(existing),
                  "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            timeout=30,
        )
    except Exception as e:
        log.error("Update chunked error for %s: %s", doc_id, e)


def mark_failed(doc_id: str, error: str):
    try:
        httpx.patch(
            f"{SUPABASE_URL}/rest/v1/corpus_documents",
            params={"id": f"eq.{doc_id}"},
            headers=SUPABASE_HEADERS,
            json={"pipeline_status": "failed", "failed_stage": "chunk",
                  "last_error": error[:500],
                  "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            timeout=30,
        )
    except Exception:
        pass


# ── Stage entry point ─────────────────────────────────────────────────────────

def run() -> dict:
    stats = {"chunked": 0, "errors": 0}

    while True:
        docs = get_stored_docs(batch_size=10)
        if not docs:
            log.info("Stage 3: no stored docs to chunk")
            break

        for doc in docs:
            doc_id   = doc["id"]
            filename = doc.get("original_filename", doc_id)
            log.info("Stage 3 [%s]: chunking", filename[:60])

            page_results = load_page_results(doc_id)
            if not page_results:
                mark_failed(doc_id, "page_results_not_found")
                stats["errors"] += 1
                continue

            try:
                chunks = build_chunks_from_doc(doc, page_results)
            except Exception as e:
                log.error("  Chunking error: %s", e)
                mark_failed(doc_id, f"chunk_error: {e}")
                stats["errors"] += 1
                continue

            if not chunks:
                mark_failed(doc_id, "no_chunks_produced")
                stats["errors"] += 1
                continue

            chunk_storage_path = f"pdf-chunks/{doc_id[:2]}/{doc_id}_chunks.json"
            if not save_chunks_to_storage(doc_id, chunks):
                mark_failed(doc_id, "chunk_save_failed")
                stats["errors"] += 1
                continue

            update_doc_chunked(doc_id, len(chunks), chunk_storage_path)
            stats["chunked"] += 1
            log.info("  ✓ %d chunks produced", len(chunks))

        time.sleep(1)

    log.info("Stage 3 complete — chunked=%d errors=%d",
             stats["chunked"], stats["errors"])
    return stats
