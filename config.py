"""
config.py — CPG Pipeline Source Registry
=========================================
Central config for all guideline sources.
The pipeline code never changes — only this config does when adding new sources.
"""

import os
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


# ── Environment ──────────────────────────────────────────────────────────────

SUPABASE_URL        = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_API_KEY      = os.environ["OPENAI_API_KEY"]
ANTHROPIC_API_KEY   = os.environ["ANTHROPIC_API_KEY"]

# Supabase Storage bucket for raw files
STORAGE_BUCKET = "corpus-raw"

# Embedding model
EMBEDDING_MODEL     = "text-embedding-3-large"
EMBEDDING_DIMS      = 1536
EMBEDDING_BATCH_SIZE = 100          # chunks per OpenAI batch call

# Chunking
CHUNK_TARGET_TOKENS  = 400          # target chunk size
CHUNK_MAX_TOKENS     = 600          # hard ceiling before forced split
CHUNK_OVERLAP_TOKENS = 50           # overlap between consecutive chunks

# Context header (Claude Haiku)
CONTEXT_MODEL        = "claude-haiku-4-5"
CONTEXT_MAX_TOKENS   = 150          # context header is short

# Confidence score threshold — chunks below this are discarded
MIN_CONFIDENCE_SCORE = 0.3

# HTTP
REQUEST_TIMEOUT_S    = 30
REQUEST_RETRY_MAX    = 3
REQUEST_DELAY_S      = 0.5          # polite crawl delay between requests


# ── Source config dataclass ───────────────────────────────────────────────────

@dataclass
class SourceConfig:
    source_id:               str
    issuing_body_canonical:  str
    authority_rank:          int         # 1=global, 2=regional, 3=national
    geographic_scope:        str
    fetch_strategy:          str         # "nice_api" | "crawl_pdf" | "direct_pdf"
    base_url:                str
    document_type:           str         = "guideline"
    licence:                 str         = "copyright"
    recrawl_days:            int         = 90    # how often to check for updates
    domain_map:              dict        = field(default_factory=dict)


# ── Domain vocabulary mapping ─────────────────────────────────────────────────
# Maps source-specific taxonomy strings → your canonical domain vocab.
# The CHECK constraint on clinical_practice_guideline_chunks.domain is
# the ground truth — values here must be in that list.

NICE_DOMAIN_MAP = {
    # NICE guidance type codes → canonical domain
    "cardiovascular":               "cardiology",
    "cardiac":                      "cardiology",
    "heart":                        "cardiology",
    "diabetes":                     "endocrinology",
    "endocrine":                    "endocrinology",
    "hiv":                          "hiv",
    "infectious":                   "infectious_disease",
    "infection":                    "infectious_disease",
    "maternity":                    "obstetrics",
    "obstetric":                    "obstetrics",
    "antenatal":                    "obstetrics",
    "paediatric":                   "paediatrics",
    "child":                        "paediatrics",
    "neonatal":                     "paediatrics",
    "cancer":                       "oncology",
    "oncology":                     "oncology",
    "kidney":                       "nephrology",
    "renal":                        "nephrology",
    "respiratory":                  "respiratory",
    "lung":                         "respiratory",
    "asthma":                       "respiratory",
    "copd":                         "respiratory",
    "mental":                       "mental_health",
    "depression":                   "mental_health",
    "anxiety":                      "mental_health",
    "neurological":                 "neurology",
    "stroke":                       "neurology",
    "gastro":                       "gastroenterology",
    "liver":                        "gastroenterology",
    "skin":                         "dermatology",
    "dermatology":                  "dermatology",
    "blood":                        "haematology",
    "haematology":                  "haematology",
    "surgical":                     "surgery",
    "surgery":                      "surgery",
    "anaesthesia":                  "anaesthesia",
    "emergency":                    "emergency_medicine",
    "rheumatology":                 "rheumatology",
    "musculoskeletal":              "rheumatology",
    "ophthalmology":                "ophthalmology",
    "eye":                          "ophthalmology",
    "public health":                "public_health",
    "medicines":                    "pharmacology",
    "drug":                         "pharmacology",
}

MOH_KENYA_DOMAIN_MAP = {
    # MOH Kenya document titles → canonical domain (keyword matching)
    "cardiovascular":               "cardiology",
    "hypertension":                 "cardiology",
    "heart":                        "cardiology",
    "diabetes":                     "endocrinology",
    "hiv":                          "hiv",
    "antiretroviral":               "hiv",
    "arv":                          "hiv",
    "malaria":                      "infectious_disease",
    "tuberculosis":                 "infectious_disease",
    "tb ":                          "infectious_disease",
    "maternal":                     "obstetrics",
    "antenatal":                    "obstetrics",
    "reproductive":                 "obstetrics",
    "child":                        "paediatrics",
    "paediatric":                   "paediatrics",
    "newborn":                      "paediatrics",
    "cancer":                       "oncology",
    "kidney":                       "nephrology",
    "renal":                        "nephrology",
    "pneumonia":                    "respiratory",
    "respiratory":                  "respiratory",
    "mental":                       "mental_health",
    "surgery":                      "surgery",
    "surgical":                     "surgery",
    "emergency":                    "emergency_medicine",
    "nutrition":                    "general_medicine",
    "essential medicine":           "pharmacology",
    "formulary":                    "pharmacology",
}


# ── Source Registry ───────────────────────────────────────────────────────────

SOURCES: dict[str, SourceConfig] = {

    "nice": SourceConfig(
        source_id               = "nice",
        issuing_body_canonical  = "NICE",
        authority_rank          = 1,
        geographic_scope        = "global",
        fetch_strategy          = "crawl_html",       # website crawl, no API key needed
        base_url                = "https://www.nice.org.uk/guidance/published",
        document_type           = "guideline",
        licence                 = "OGL",             # Open Government Licence
        recrawl_days            = 60,
        domain_map              = NICE_DOMAIN_MAP,
    ),

    "moh_kenya": SourceConfig(
        source_id               = "moh_kenya",
        issuing_body_canonical  = "MOH Kenya",
        authority_rank          = 3,
        geographic_scope        = "kenya",
        fetch_strategy          = "crawl_pdf",
        base_url                = "https://www.health.go.ke/guidelines/",
        document_type           = "guideline",
        licence                 = "public_domain",
        recrawl_days            = 90,
        domain_map              = MOH_KENYA_DOMAIN_MAP,
    ),

    # ── Phase 2 — add when ready ──────────────────────────────────────────────
    # "who": SourceConfig(
    #     source_id               = "who",
    #     issuing_body_canonical  = "WHO",
    #     authority_rank          = 1,
    #     geographic_scope        = "global",
    #     fetch_strategy          = "crawl_pdf",
    #     base_url                = "https://www.who.int/publications/guidelines",
    #     licence                 = "CC BY-NC-SA 3.0 IGO",
    #     recrawl_days            = 90,
    #     domain_map              = {},
    # ),
}


# ── Chunk type detection keywords ─────────────────────────────────────────────
# Used by the section-aware chunker to classify chunk_type from heading text
# or surrounding context. Order matters — first match wins.

CHUNK_TYPE_SIGNALS: list[tuple[list[str], str]] = [
    (["recommendation", "we recommend", "we suggest", "strong recommendation"],    "recommendation"),
    (["practice point", "good practice", "expert opinion", "consensus"],           "practice_point"),
    (["rationale", "basis for", "justification", "reasoning"],                     "rationale"),
    (["evidence", "systematic review", "meta-analysis", "rct", "trial data"],      "evidence_summary"),
    (["special population", "exception", "caution", "avoid in", "contraindicated"], "clinical_consideration"),
    (["definition", "criteria", "staging", "classification", "diagnostic"],        "definition_criteria"),
    (["algorithm", "flowchart", "decision tree", "pathway"],                       "algorithm"),
    (["table", "comparison table", "reference values", "summary table"],           "table"),
    (["monitoring", "follow-up", "review interval", "target", "parameter"],        "monitoring"),
    (["dosing", "dose", "dosage", "regimen", "mg/kg", "mg/day"],                   "drug_dosing"),
    (["lifestyle", "diet", "exercise", "self-management", "patient education"],    "patient_guidance"),
    (["key points", "summary", "key messages", "in brief"],                        "summary"),
    (["background", "epidemiology", "pathophysiology", "introduction"],            "background"),
]


# ── Grade symbol mapping ───────────────────────────────────────────────────────
# Maps raw grade symbols found in documents → decomposed GRADE fields.
# Extend when adding new evidence frameworks.

GRADE_MAP: dict[str, dict] = {
    # GRADE framework (KDIGO, WHO)
    "1a":  {"grade_strength": "strong",      "grade_evidence_quality": "high",      "grade_direction": "for"},
    "1b":  {"grade_strength": "strong",      "grade_evidence_quality": "moderate",  "grade_direction": "for"},
    "1c":  {"grade_strength": "strong",      "grade_evidence_quality": "low",       "grade_direction": "for"},
    "1d":  {"grade_strength": "strong",      "grade_evidence_quality": "very_low",  "grade_direction": "for"},
    "2a":  {"grade_strength": "conditional", "grade_evidence_quality": "high",      "grade_direction": "for"},
    "2b":  {"grade_strength": "conditional", "grade_evidence_quality": "moderate",  "grade_direction": "for"},
    "2c":  {"grade_strength": "conditional", "grade_evidence_quality": "low",       "grade_direction": "for"},
    "2d":  {"grade_strength": "conditional", "grade_evidence_quality": "very_low",  "grade_direction": "for"},
    # ADA framework
    "a":   {"grade_strength": "strong",      "grade_evidence_quality": "high",      "grade_direction": "for"},
    "b":   {"grade_strength": "strong",      "grade_evidence_quality": "moderate",  "grade_direction": "for"},
    "c":   {"grade_strength": "conditional", "grade_evidence_quality": "low",       "grade_direction": "for"},
    "e":   {"grade_strength": "expert_opinion", "grade_evidence_quality": "very_low", "grade_direction": "for"},
    # NICE framework
    "strong": {"grade_strength": "strong",   "grade_evidence_quality": None,        "grade_direction": "for"},
    "conditional": {"grade_strength": "conditional", "grade_evidence_quality": None, "grade_direction": "for"},
}
