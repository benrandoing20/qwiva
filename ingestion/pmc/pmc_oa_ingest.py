"""
pmc_oa_ingest.py
================
Production PMC OA ingestion pipeline for Qwiva.
Runs on Railway as a background worker or cron job.
Can also be run locally for testing with a subset of queries.
Full pipeline in one script:
  1. ESearch  — find PMC IDs for each specialty query
  2. EFetch   — download full JATS XML for each article
  3. Parse    — extract sections, authors, metadata from JATS
  4. Chunk    — split into 60-400 word chunks
  5. Enrich   — GRADE detection, tags, chunk classification
  6. Embed    — generate OpenAI text-embedding-3-large vectors (1536 dims, Matryoshka)
  7. Write    — batch upsert to Supabase guideline_chunks with retry + row-by-row fallback
  8. Register — update guideline_versions audit table
Designed to be:
  - Idempotent   : safe to re-run; deduplicates on content_hash
  - Resumable    : checkpoint files in checkpoints/pmc/ survive crashes
  - Observable   : structured logs, Slack alerts on completion/failure
  - Schedulable  : Railway cron runs this weekly for new content
EMBEDDING:
  Model:      text-embedding-3-large (Matryoshka, dimensions=1536)
  Max chars:  12,000 per chunk — lowered from 24,000 after 400 errors on dense
              clinical text (Lancet articles tokenising at ~1.6-2.0 ch/tok).
              At 3.2 ch/tok: 12,000 chars = 3,750 tokens — safe below 8,192 limit.
  IMPORTANT:  Must match ct_ingest.py and ingest_pipeline.py exactly.
CONTENT HASH:
  SHA-256 truncated to 32 hex chars (128 bits).
  Consistent with ct_ingest.py and ingest_pipeline.py.
CHECKPOINTS:
  Written to checkpoints/pmc/{query_id}.json — separate from CT pipeline
  (checkpoints/ct/) to avoid filename collisions between pipelines.
Environment variables (set in Railway dashboard or .env file):
  SUPABASE_URL         required
  SUPABASE_KEY         required
  OPENAI_API_KEY       required
  NCBI_API_KEY         optional — without it rate limit is 3 req/s instead of 10
  ANTHROPIC_API_KEY    not used here — LLM enrichment is now a separate pass
  #                    run pmc_llm_enrich.py after this pipeline completes
  SLACK_WEBHOOK_URL    optional — completion/failure alerts
  RUN_MODE             full | tier1 | tier2 | tier3 | tier4 (default: full)
Run locally:
  pip install -r requirements.txt
  python pmc_oa_ingest.py
Run on Railway:
  Deploy repo, set env vars, trigger manually or via cron.
"""
import os
import re
import json
import time
import hashlib
import logging
import requests
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import dataclass, field
import signal

# ── Crash-proof: SIGTERM handler + runtime guard ─────────────────────────────
# Railway sends SIGTERM before killing the container. We catch it and exit
# cleanly so the checkpoint is saved and Supabase writes complete.
_shutdown_requested = False
_start_wall_time    = datetime.now(timezone.utc)
MAX_RUNTIME_HOURS   = float(os.environ.get("MAX_RUNTIME_HOURS", "20"))

def _handle_sigterm(signum, frame):  # noqa: ARG001 — signal handler signature required by Python
    global _shutdown_requested
    logging.warning("SIGTERM received — finishing current article then exiting cleanly")
    _shutdown_requested = True

signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT,  _handle_sigterm)

def _runtime_exceeded() -> bool:
    elapsed_h = (datetime.now(timezone.utc) - _start_wall_time).total_seconds() / 3600
    return elapsed_h >= MAX_RUNTIME_HOURS

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from lxml import etree

# ── Environment ───────────────────────────────────────────────────────────────
SUPABASE_URL   = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY   = os.environ.get("SUPABASE_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
NCBI_API_KEY   = os.environ.get("NCBI_API_KEY", "")       # optional — higher rate limit
SLACK_WEBHOOK  = os.environ.get("SLACK_WEBHOOK_URL", "")  # optional — alerts
RUN_MODE       = os.environ.get("RUN_MODE", "full")

# Validate required vars — NCBI_API_KEY is optional (warn, don't crash)
_missing = [k for k, v in {
    "SUPABASE_URL":   SUPABASE_URL,
    "SUPABASE_KEY":   SUPABASE_KEY,
    "OPENAI_API_KEY": OPENAI_API_KEY,
}.items() if not v]
if _missing:
    raise RuntimeError(
        f"Missing required environment variables: {', '.join(_missing)}\n"
        f"Set these in Railway dashboard or .env file."
    )

# ── Logging ───────────────────────────────────────────────────────────────────
import sys
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,   # ← write to stdout, not stderr
)
log = logging.getLogger("qwiva.pmc_ingest")

if not NCBI_API_KEY:
    log.warning("NCBI_API_KEY not set — rate limit is 3 req/s (10 req/s with key). "
                "Register free at https://www.ncbi.nlm.nih.gov/account/")

# ── Constants ─────────────────────────────────────────────────────────────────
ESEARCH_URL   = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EFETCH_URL    = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
OPENAI_EMBED  = "https://api.openai.com/v1/embeddings"
EMBED_MODEL   = "text-embedding-3-large"  # 1536 dims Matryoshka
EMBED_DIM     = 1536                       # stays under pgvector 2000-dim index limit
EMBED_BATCH   = 100                        # chunks per OpenAI embed call

# FIX: lowered from 24,000 — dense clinical text tokenises at ~1.6-2.0 ch/tok,
# causing 400 errors. At 3.2 ch/tok: 12,000 chars = 3,750 tokens, well below 8,192.
MAX_EMBED_CHARS     = 12_000
HARD_TRUNCATE_CHARS = 10_000  # last-resort per-chunk truncation in embed_chunks

REQUEST_DELAY = 0.12 if NCBI_API_KEY else 0.4
MAX_CHUNK_W   = 400
MIN_CHUNK_W   = 60

# 25 rows keeps pgvector index updates within Supabase statement_timeout.
DB_BATCH_SIZE = 25

# Checkpoint directory — separate from CT pipeline (checkpoints/ct/)
CHECKPOINT_DIR = Path("checkpoints/pmc")
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

# ── Query Registry ────────────────────────────────────────────────────────────
ALL_QUERIES = [
    # ══ TIER 0 — Targeted authority bodies (small, high quality, ingest first) ══
    {"id": "kdigo_guidelines",     "domain": "nephrology",     "tier": 0,
     "label": "KDIGO Clinical Practice Guidelines",
     "term":  'KDIGO[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   60},
    {"id": "ash_haematology",      "domain": "hematology",     "tier": 0,
     "label": "ASH Haematology Guidelines",
     "term":  '"American Society of Hematology"[affiliation] AND "guideline"[title] AND "open access"[filter]',
     "max":   100},
    {"id": "wses_surgery",         "domain": "surgery",        "tier": 0,
     "label": "WSES Emergency Surgery Guidelines",
     "term":  '"World Society of Emergency Surgery"[affiliation] AND "open access"[filter]',
     "max":   200},
    {"id": "figo_obstetrics",      "domain": "maternal",       "tier": 0,
     "label": "FIGO Obstetrics Guidelines",
     "term":  '"International Federation of Gynecology"[affiliation] AND "open access"[filter]',
     "max":   100},
    {"id": "surviving_sepsis",     "domain": "emergency",      "tier": 0,
     "label": "Surviving Sepsis Campaign",
     "term":  '"Surviving Sepsis Campaign"[affiliation] AND "open access"[filter]',
     "max":   50},
    {"id": "wgo_gastroenterology", "domain": "gastroenterology", "tier": 0,
     "label": "WGO Global Gastroenterology Guidelines",
     "term":  '"World Gastroenterology Organisation"[affiliation] AND "open access"[filter]',
     "max":   100},
    {"id": "eular_rheumatology",   "domain": "rheumatology",   "tier": 0,
     "label": "EULAR Recommendations",
     "term":  '"European League Against Rheumatism"[affiliation] AND "recommendation"[title] AND "open access"[filter]',
     "max":   200},
    {"id": "eras_perioperative",   "domain": "surgery",        "tier": 0,
     "label": "ERAS Society Guidelines",
     "term":  '"Enhanced Recovery After Surgery"[affiliation] AND "open access"[filter]',
     "max":   100},
    {"id": "lancet_global_health", "domain": "mixed",          "tier": 0,
     "label": "Lancet Global Health — practice guidelines",
     "term":  ('"Lancet Glob Health"[journal] AND "practice guideline"[pt] '
               'AND "pubmed pmc"[sb]'),
     "max":   100},
    # ── Cardiology ───────────────────────────────────────────────────────────
    {"id": "esc_guidelines",        "domain": "cardiovascular", "tier": 0,
     "label": "ESC Clinical Practice Guidelines",
     "term":  '"European Society of Cardiology"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   200},
    {"id": "acc_aha_guidelines",    "domain": "cardiovascular", "tier": 0,
     "label": "ACC/AHA Practice Guidelines",
     "term":  '"American Heart Association"[affiliation] AND "practice guideline"[pt] AND "open access"[filter] AND ("2018"[pdat]:"3000"[pdat])',
     "max":   300},
    {"id": "ish_hypertension",      "domain": "cardiovascular", "tier": 0,
     "label": "ISH International Hypertension Guidelines",
     "term":  '"International Society of Hypertension"[affiliation] AND "open access"[filter]',
     "max":   50},
    # ── Diabetes / Endocrinology ──────────────────────────────────────────────
    {"id": "ada_guidelines",        "domain": "diabetes",       "tier": 0,
     "label": "ADA — Diabetes Care journal practice guidelines",
     "term":  ('"Diabetes Care"[journal] AND "practice guideline"[pt] '
               'AND "pubmed pmc"[sb] AND 2015:2026[pdat]'),
     "max":   50},
    {"id": "endocrine_society",     "domain": "diabetes",       "tier": 0,
     "label": "Endocrine Society Clinical Practice Guidelines",
     "term":  '"Endocrine Society"[affiliation] AND "clinical practice guideline"[title] AND "open access"[filter]',
     "max":   100},
    # ── Respiratory ───────────────────────────────────────────────────────────
    {"id": "ers_respiratory",       "domain": "respiratory",    "tier": 0,
     "label": "ERS Respiratory Guidelines",
     "term":  '"European Respiratory Society"[affiliation] AND "open access"[filter] AND ("2018"[pdat]:"3000"[pdat])',
     "max":   200},
    {"id": "ats_guidelines",        "domain": "respiratory",    "tier": 0,
     "label": "ATS American Thoracic Society Guidelines",
     "term":  '"American Thoracic Society"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   150},
    # ── Infectious Disease ────────────────────────────────────────────────────
    {"id": "idsa_guidelines",       "domain": "hiv",            "tier": 0,
     "label": "IDSA Infectious Diseases Guidelines",
     "term":  '"Infectious Diseases Society of America"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   200},
    {"id": "eacs_hiv",              "domain": "hiv",            "tier": 0,
     "label": "EACS European HIV Guidelines",
     "term":  '"European AIDS Clinical Society"[affiliation] AND "open access"[filter]',
     "max":   50},
    {"id": "bhiva_guidelines",      "domain": "hiv",            "tier": 0,
     "label": "BHIVA British HIV Association Guidelines",
     "term":  '"British HIV Association"[affiliation] AND "open access"[filter]',
     "max":   80},
    # ── Hepatology ────────────────────────────────────────────────────────────
    {"id": "easl_guidelines",       "domain": "hepatitis",      "tier": 0,
     "label": "EASL European Liver Guidelines",
     "term":  '"European Association for the Study of the Liver"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   150},
    {"id": "aasld_guidelines",      "domain": "hepatitis",      "tier": 0,
     "label": "AASLD Liver Disease Guidelines",
     "term":  '"American Association for the Study of Liver Diseases"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   100},
    {"id": "acg_gastro",            "domain": "gastroenterology", "tier": 0,
     "label": "ACG American College of Gastroenterology Guidelines",
     "term":  '"American College of Gastroenterology"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   100},
    # ── Paediatrics ───────────────────────────────────────────────────────────
    {"id": "aap_guidelines",        "domain": "neonatal",       "tier": 0,
     "label": "AAP American Academy of Pediatrics Guidelines",
     "term":  '"American Academy of Pediatrics"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   200},
    {"id": "espghan_guidelines",    "domain": "neonatal",       "tier": 0,
     "label": "ESPGHAN Paediatric Nutrition Guidelines",
     "term":  '"European Society for Paediatric Gastroenterology"[affiliation] AND "open access"[filter]',
     "max":   100},
    # ── Neurology ─────────────────────────────────────────────────────────────
    {"id": "ean_guidelines",        "domain": "neurology",      "tier": 0,
     "label": "EAN European Academy of Neurology Guidelines",
     "term":  '"European Academy of Neurology"[affiliation] AND ("guideline"[title] OR "recommendation"[title]) AND "open access"[filter]',
     "max":   150},
    {"id": "aan_guidelines",        "domain": "neurology",      "tier": 0,
     "label": "AAN American Academy of Neurology Guidelines",
     "term":  '"American Academy of Neurology"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   150},
    # ── Oncology ─────────────────────────────────────────────────────────────
    {"id": "esmo_guidelines",       "domain": "oncology",       "tier": 0,
     "label": "ESMO Clinical Practice Guidelines",
     "term":  '"European Society for Medical Oncology"[affiliation] AND "open access"[filter] AND ("guideline"[title] OR "recommendation"[title])',
     "max":   200},
    {"id": "asco_guidelines",       "domain": "oncology",       "tier": 0,
     "label": "ASCO Clinical Practice Guidelines",
     "term":  '"American Society of Clinical Oncology"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   200},
    # ── Rheumatology ──────────────────────────────────────────────────────────
    {"id": "acr_guidelines",        "domain": "rheumatology",   "tier": 0,
     "label": "ACR American College of Rheumatology Guidelines",
     "term":  '"American College of Rheumatology"[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   150},
    # ── Haematology ───────────────────────────────────────────────────────────
    {"id": "isth_guidelines",       "domain": "hematology",     "tier": 0,
     "label": "ISTH Thrombosis and Haemostasis Guidelines",
     "term":  '"International Society on Thrombosis"[affiliation] AND "guideline"[title] AND "open access"[filter]',
     "max":   80},
    # ── Critical Care / Nutrition ─────────────────────────────────────────────
    {"id": "esicm_guidelines",      "domain": "emergency",      "tier": 0,
     "label": "ESICM Critical Care Guidelines",
     "term":  '"European Society of Intensive Care Medicine"[affiliation] AND "open access"[filter]',
     "max":   100},
    {"id": "espen_guidelines",      "domain": "nutrition",      "tier": 0,
     "label": "ESPEN Clinical Nutrition Guidelines",
     "term":  '"European Society for Clinical Nutrition"[affiliation] AND "guideline"[title] AND "open access"[filter]',
     "max":   100},
    # ══ TIER 0 — High-impact OA journals ══
    {"id": "lancet_global_health_all",  "domain": "mixed",       "tier": 0,
     "label": "Lancet Global Health — all clinical content 2018+",
     "term":  ('"Lancet Glob Health"[journal] AND "humans"[MeSH Terms] '
               'AND "pubmed pmc"[sb] AND 2018:2026[pdat]'),
     "max":   1000},
    {"id": "plos_medicine",             "domain": "mixed",       "tier": 0,
     "label": "PLOS Medicine — fully OA, global health focus",
     "term":  ('"PLoS Med"[journal] AND "humans"[MeSH Terms] '
               'AND "pubmed pmc"[sb] AND 2018:2026[pdat]'),
     "max":   2000},
    {"id": "jama_network_open",         "domain": "mixed",       "tier": 0,
     "label": "JAMA Network Open — AMA fully OA journal",
     "term":  ('"JAMA Netw Open"[journal] AND "practice guideline"[pt] '
               'AND "pubmed pmc"[sb]'),
     "max":   500},
    {"id": "lancet_infect_dis",         "domain": "hiv",         "tier": 0,
     "label": "Lancet Infectious Diseases — practice guidelines",
     "term":  ('"Lancet Infect Dis"[journal] AND "practice guideline"[pt] '
               'AND "pubmed pmc"[sb]'),
     "max":   50},
    # ══ TIER 0 — Cochrane disease-specific systematic reviews ══
    {"id": "cochrane_hiv",              "domain": "hiv",         "tier": 0,
     "label": "Cochrane HIV/AIDS systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND HIV[mesh]'),
     "max":   25},
    {"id": "cochrane_prep_arv",         "domain": "hiv",         "tier": 0,
     "label": "Cochrane HIV ARV / PrEP systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND (antiretroviral[mesh] OR "pre-exposure prophylaxis"[mesh])'),
     "max":   40},
    {"id": "cochrane_tb",               "domain": "tb",          "tier": 0,
     "label": "Cochrane Tuberculosis systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND tuberculosis[mesh]'),
     "max":   75},
    {"id": "cochrane_malaria",          "domain": "malaria",     "tier": 0,
     "label": "Cochrane Malaria systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND malaria[mesh]'),
     "max":   100},
    {"id": "cochrane_maternal",         "domain": "maternal",    "tier": 0,
     "label": "Cochrane Maternal & Obstetric systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND ("maternal health"[mesh] OR "obstetric labor complications"[mesh] '
               'OR "pregnancy complications"[mesh] OR "postpartum period"[mesh])'),
     "max":   300},
    {"id": "cochrane_neonatal",         "domain": "neonatal",    "tier": 0,
     "label": "Cochrane Neonatal / Paediatric systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND ("infant newborn"[mesh] OR "infant premature"[mesh] '
               'OR "child health"[mesh])'),
     "max":   100},
    {"id": "cochrane_diabetes",         "domain": "diabetes",    "tier": 0,
     "label": "Cochrane Diabetes systematic reviews 2018+",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND "diabetes mellitus"[mesh] AND 2018:2026[pdat]'),
     "max":   90},
    {"id": "cochrane_cardiac",          "domain": "cardiovascular", "tier": 0,
     "label": "Cochrane Cardiovascular systematic reviews 2018+",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND "cardiovascular diseases"[mesh] AND 2018:2026[pdat]'),
     "max":   300},
    {"id": "cochrane_respiratory",      "domain": "respiratory", "tier": 0,
     "label": "Cochrane Respiratory systematic reviews 2018+",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND ("asthma"[mesh] OR "pulmonary disease chronic obstructive"[mesh] '
               'OR "pneumonia"[mesh]) AND 2018:2026[pdat]'),
     "max":   170},
    {"id": "cochrane_ntd",              "domain": "ntd",         "tier": 0,
     "label": "Cochrane Neglected Tropical Diseases systematic reviews",
     "term":  ('"Cochrane Database Syst Rev"[journal] AND "pubmed pmc"[sb] '
               'AND ("tropical medicine"[mesh] OR "schistosomiasis"[mesh] '
               'OR "leishmaniasis"[mesh] OR "helminthiasis"[mesh])'),
     "max":   30},
    # ══ TIER 0 — NICE Guidelines ══
    {"id": "nice_guidelines",           "domain": "mixed",          "tier": 0,
     "label": "NICE Clinical Guidelines",
     "term":  ('"National Institute for Health and Care Excellence"[affiliation] '
               'AND "practice guideline"[pt] AND "pubmed pmc"[sb]'),
     "max":   300},
    # ══ TIER 0 — Oncology Phase 2 additions (April 2026) ══
    # Research confirmed blocked sources:
    # NCCN: "may not be reproduced without express written permission"
    # ASTRO PRO: "all rights reserved including text and data mining"
    # All sources below: CC BY-NC-ND 4.0, PMC OA verified.
    {   # JCO Global Oncology: 100% OA, all articles in PMC.
        # LMIC/Africa focus — guidelines for low-resource settings.
        "id":     "asco_jco_global",
        "domain": "oncology",
        "tier":   0,
        "label":  "ASCO JCO Global Oncology — fully OA, LMIC focus",
        "term":   ('"JCO global oncology"[journal] '
                   'AND "practice guideline"[pt]'),
        "max":    100,
    },
    {   # ESMO full CPGs in Annals of Oncology.
        # Separate from esmo_guidelines (ESMO Open interim/express updates).
        # Full CPGs: breast, lung, colorectal, gastric, prostate, ovarian etc.
        "id":     "esmo_annals_oncology",
        "domain": "oncology",
        "tier":   0,
        "label":  "ESMO Full CPGs — Annals of Oncology (PMC OA subset only)",
        "term":   ('"ESMO Guidelines Committee"[affiliation] '
                   'AND "Annals of Oncology"[journal] '
                   'AND "pubmed pmc"[sb]'),
        "max":    60,
    },
    {   # Targeted ASH haematologic malignancy query.
        # Supplements ash_haematology (VTE, sickle cell, ITP).
        # Covers: AML, ALL, CLL, lymphoma, myeloma, MDS.
        "id":     "ash_oncology_malignancies",
        "domain": "oncology",
        "tier":   0,
        "label":  "ASH Haematologic Malignancy Guidelines (AML/lymphoma/myeloma)",
        "term":   ('"American Society of Hematology"[affiliation] '
                   'AND ("leukemia"[mesh] OR "lymphoma"[mesh] '
                   'OR "multiple myeloma"[mesh] '
                   'OR "myelodysplastic syndromes"[mesh]) '
                   'AND "practice guideline"[pt] '
                   'AND "pubmed pmc"[sb]'),
        "max":    60,
    },
    {   # EHA — European Haematology Association.
        # HemaSphere is fully OA (CC BY-NC-ND), all articles in PMC.
        "id":     "eha_haematology",
        "domain": "haematology",
        "tier":   0,
        "label":  "EHA Guidelines — HemaSphere fully OA journal",
        "term":   ('"European Hematology Association"[affiliation] '
                   'AND ("guideline"[title] OR "recommendation"[title]) '
                   'AND "pubmed pmc"[sb]'),
        "max":    60,
    },
    {   # ESGE — European Society of Gastrointestinal Endoscopy.
        # Was missing from registry (identified April 2026).
        # Covers: colonoscopy, ERCP, upper GI, Barrett's, colorectal screening.
        "id":     "esge_guidelines",
        "domain": "gastroenterology",
        "tier":   0,
        "label":  "ESGE Gastrointestinal Endoscopy Guidelines",
        "term":   ('"European Society of Gastrointestinal Endoscopy"[affiliation] '
                   'AND ("guideline"[title] OR "recommendation"[title]) '
                   'AND "pubmed pmc"[sb]'),
        "max":    80,
    },
    {   # RCOG via PMC — fills gap where Wiley blocks direct RCOG scraping.
        # 29 RCOG Green-top Guidelines blocked on Wiley (403 errors).
        # This captures the subset deposited as open access in PMC.
        "id":     "rcog_bjog_guidelines",
        "domain": "obstetrics",
        "tier":   0,
        "label":  "RCOG Green-top Guidelines (BJOG / PMC OA subset)",
        "term":   ('"Royal College of Obstetricians"[affiliation] '
                   'AND "practice guideline"[pt] '
                   'AND "pubmed pmc"[sb]'),
        "max":    100,
    },
    {   # SSO — Society of Surgical Oncology.
        # Joint guidelines with ASCO/ASTRO on breast, GI, melanoma surgery.
        "id":     "sso_surgical_oncology",
        "domain": "oncology",
        "tier":   0,
        "label":  "SSO Surgical Oncology Guidelines (ASCO/ASTRO/SSO joint)",
        "term":   ('"Society of Surgical Oncology"[affiliation] '
                   'AND "practice guideline"[pt] '
                   'AND "pubmed pmc"[sb]'),
        "max":    50,
    },
    {   # European Journal of Cancer: multi-society oncology guidelines.
        # ESMO, ESSO, SIOPE publish jointly here. Many in PMC OA.
        "id":     "european_journal_cancer_guidelines",
        "domain": "oncology",
        "tier":   0,
        "label":  "European Journal of Cancer — multi-society oncology guidelines",
        "term":   ('"European Journal of Cancer"[journal] '
                   'AND "practice guideline"[pt] '
                   'AND "pubmed pmc"[sb] '
                   'AND 2018:2026[pdat]'),
        "max":    80,
    },
    {   # Cervical cancer — leading female cancer in Kenya/East Africa.
        # Captures WHO, FIGO, ASCO, ESMO guidelines specifically on cervical.
        "id":     "cervical_cancer_guidelines",
        "domain": "oncology",
        "tier":   1,
        "label":  "Cervical Cancer Guidelines — East Africa priority",
        "term":   ('"uterine cervical neoplasms"[mesh] '
                   'AND "practice guideline"[pt] '
                   'AND "pubmed pmc"[sb] '
                   'AND "humans"[MeSH Terms]'),
        "max":    80,
    },
    {   # Kaposi sarcoma — endemic in East Africa, HIV-associated.
        "id":     "kaposi_sarcoma_guidelines",
        "domain": "oncology",
        "tier":   1,
        "label":  "Kaposi Sarcoma Guidelines — HIV-associated, East Africa",
        "term":   ('"sarcoma kaposi"[mesh] '
                   'AND ("practice guideline"[pt] OR "guideline"[title]) '
                   'AND "pubmed pmc"[sb]'),
        "max":    30,
    },
    {   # Burkitt lymphoma — endemic in equatorial Africa (malaria belt).
        # Paediatric EBV-associated cancer, high burden East Africa.
        "id":     "burkitt_lymphoma_guidelines",
        "domain": "oncology",
        "tier":   1,
        "label":  "Burkitt Lymphoma Guidelines — East Africa endemic",
        "term":   ('"burkitt lymphoma"[mesh] '
                   'AND ("practice guideline"[pt] '
                   'OR "guideline"[title] OR "treatment"[title]) '
                   'AND "pubmed pmc"[sb]'),
        "max":    30,
    },
    {   # Breast cancer in LMIC / resource-limited settings.
        # Second most common female cancer in Kenya.
        "id":     "breast_cancer_lmic_guidelines",
        "domain": "oncology",
        "tier":   1,
        "label":  "Breast Cancer Guidelines — LMIC / Africa context",
        "term":   ('"breast neoplasms"[mesh] '
                   'AND "practice guideline"[pt] '
                   'AND "pubmed pmc"[sb] '
                   'AND ("developing countries"[mesh] OR "Africa"[mesh] '
                   'OR "low-income"[tiab] OR "resource-limited"[tiab]) '
                   'AND "humans"[MeSH Terms]'),
        "max":    40,
    },
    # ══ TIER 1 — Core East Africa burden ══
    {"id": "who_pmc_guidelines",   "domain": "who",          "tier": 1,
     "label": "WHO Guidelines in PMC",
     "term":  'WHO[affiliation] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   249},
    {"id": "malaria_guidelines",   "domain": "malaria",      "tier": 1,
     "label": "Malaria Practice Guidelines",
     "term":  'malaria[mesh] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   47},
    {"id": "hiv_guidelines",       "domain": "hiv",          "tier": 1,
     "label": "HIV/AIDS Practice Guidelines",
     "term":  'HIV[mesh] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   67},
    {"id": "tb_guidelines",        "domain": "tb",           "tier": 1,
     "label": "Tuberculosis Practice Guidelines",
     "term":  'tuberculosis[mesh] AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   281},
    {"id": "maternal_guidelines",  "domain": "maternal",     "tier": 1,
     "label": "Maternal and Child Health Guidelines",
     "term":  '(maternal health[mesh] OR child health[mesh] OR antenatal care[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   199},
    {"id": "hepatitis_guidelines", "domain": "hepatitis",    "tier": 1,
     "label": "Hepatitis B and C Guidelines",
     "term":  '(hepatitis B[mesh] OR hepatitis C[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   489},
    {"id": "sti_guidelines",       "domain": "sti",          "tier": 1,
     "label": "STI Treatment Guidelines",
     "term":  '(sexually transmitted diseases[mesh] OR syphilis[mesh] OR gonorrhea[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   695},
    {"id": "neonatal_guidelines",  "domain": "neonatal",     "tier": 1,
     "label": "Neonatal Care Guidelines",
     "term":  '(infant newborn diseases[mesh] OR neonatal sepsis[mesh] OR birth asphyxia[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   554},
    # ══ TIER 1 — Landmark RCTs by high-burden disease ══
    {"id": "rct_hiv",                   "domain": "hiv",            "tier": 1,
     "label": "HIV/AIDS Landmark RCTs",
     "term":  ('HIV[mesh] AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2015"[pdat]:"3000"[pdat])'),
     "max":   300},
    {"id": "rct_tb",                    "domain": "tb",             "tier": 1,
     "label": "Tuberculosis Landmark RCTs",
     "term":  ('tuberculosis[mesh] AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2015"[pdat]:"3000"[pdat])'),
     "max":   200},
    {"id": "rct_malaria",               "domain": "malaria",        "tier": 1,
     "label": "Malaria Treatment RCTs",
     "term":  ('malaria[mesh] AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2015"[pdat]:"3000"[pdat])'),
     "max":   200},
    {"id": "rct_maternal",              "domain": "maternal",       "tier": 1,
     "label": "Maternal & Obstetric RCTs",
     "term":  ('("maternal health"[mesh] OR "obstetric labor complications"[mesh] '
               'OR "pregnancy complications"[mesh]) '
               'AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2015"[pdat]:"3000"[pdat])'),
     "max":   300},
    {"id": "rct_neonatal",              "domain": "neonatal",        "tier": 1,
     "label": "Neonatal / Paediatric RCTs",
     "term":  ('("infant newborn diseases"[mesh] OR "infant premature"[mesh] '
               'OR "child health"[mesh]) '
               'AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2015"[pdat]:"3000"[pdat])'),
     "max":   250},
    {"id": "typhoid_guidelines",        "domain": "enteric",         "tier": 1,
     "label": "Typhoid / Enteric Fever Guidelines",
     "term":  ('("typhoid fever"[mesh] OR "salmonella typhi"[mesh]) '
               'AND "practice guideline"[pt] AND "open access"[filter]'),
     "max":   50},
    {"id": "cholera_guidelines",        "domain": "enteric",         "tier": 1,
     "label": "Cholera / Diarrhoeal Disease Guidelines",
     "term":  ('(cholera[mesh] OR "vibrio cholerae"[mesh] '
               'OR "diarrhea"[mesh]) AND "practice guideline"[pt] '
               'AND "open access"[filter] AND "humans"[MeSH Terms]'),
     "max":   100},
    # ══ TIER 1 — Africa-specific bodies ══
    {"id": "who_afro_guidelines",       "domain": "who",             "tier": 0,
     "label": "WHO AFRO Regional Guidelines",
     "term":  ('"Regional Office for Africa"[affiliation] AND "pubmed pmc"[sb] '
               'AND "humans"[MeSH Terms]'),
     "max":   100},
    {"id": "sahcs_hiv",                 "domain": "hiv",             "tier": 1,
     "label": "Southern African HIV Clinicians Society Guidelines",
     "term":  ('"Southern African HIV Clinicians Society"[affiliation] '
               'AND "pubmed pmc"[sb]'),
     "max":   50},
    {"id": "idf_diabetes",              "domain": "diabetes",        "tier": 0,
     "label": "IDF International Diabetes Federation Guidelines",
     "term":  ('"International Diabetes Federation"[affiliation] '
               'AND "pubmed pmc"[sb]'),
     "max":   60},
    # ══ TIER 2 — Rising NCD burden ══
    {"id": "cardiovascular_guidelines", "domain": "cardiovascular", "tier": 2,
     "label": "Cardiovascular / Hypertension Guidelines",
     "term":  '(cardiovascular diseases[mesh] OR hypertension[mesh] OR heart failure[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND ("2018"[pdat]:"3000"[pdat])',
     "max":   500},
    {"id": "diabetes_guidelines",  "domain": "diabetes",     "tier": 2,
     "label": "Diabetes / Metabolic Guidelines",
     "term":  '(diabetes mellitus[mesh] OR metabolic syndrome[mesh] OR obesity[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND ("2018"[pdat]:"3000"[pdat])',
     "max":   500},
    {"id": "mental_health_guidelines", "domain": "mental_health", "tier": 2,
     "label": "Mental Health Guidelines",
     "term":  '(mental disorders[mesh] OR depression[mesh] OR epilepsy[mesh] OR substance-related disorders[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND ("2018"[pdat]:"3000"[pdat])',
     "max":   500},
    {"id": "respiratory_guidelines", "domain": "respiratory", "tier": 2,
     "label": "Respiratory Disease Guidelines",
     "term":  '(asthma[mesh] OR pulmonary disease chronic obstructive[mesh] OR pneumonia[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND ("2018"[pdat]:"3000"[pdat])',
     "max":   500},
    {"id": "emergency_guidelines", "domain": "emergency",    "tier": 2,
     "label": "Emergency / Sepsis / Critical Care Guidelines",
     "term":  '(emergency medicine[mesh] OR critical care[mesh] OR sepsis[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND "humans"[MeSH Terms]',
     "max":   1397},
    {"id": "amr_guidelines",       "domain": "amr",          "tier": 2,
     "label": "Antimicrobial Resistance Guidelines",
     "term":  '(drug resistance bacterial[mesh] OR anti-bacterial agents[mesh] OR antimicrobial stewardship[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND "humans"[MeSH Terms]',
     "max":   1927},
    {"id": "nutrition_guidelines", "domain": "nutrition",    "tier": 2,
     "label": "Nutrition / Malnutrition Guidelines",
     "term":  '(malnutrition[mesh] OR protein-energy malnutrition[mesh] OR micronutrients[mesh]) AND "practice guideline"[pt] AND "open access"[filter] AND "humans"[MeSH Terms]',
     "max":   2094},
    {"id": "vaccine_guidelines",   "domain": "vaccines",     "tier": 2,
     "label": "Vaccination / Immunization Guidelines",
     "term":  '(vaccination[mesh] OR immunization programs[mesh] OR vaccines[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   733},
    {"id": "reproductive_health",  "domain": "reproductive", "tier": 2,
     "label": "Reproductive / Family Planning Guidelines",
     "term":  '(reproductive health[mesh] OR contraception[mesh] OR family planning services[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   79},
    {"id": "rct_cardiovascular",        "domain": "cardiovascular",  "tier": 2,
     "label": "Cardiovascular / Hypertension RCTs",
     "term":  ('("cardiovascular diseases"[mesh] OR "hypertension"[mesh] '
               'OR "heart failure"[mesh]) '
               'AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2018"[pdat]:"3000"[pdat])'),
     "max":   400},
    {"id": "rct_diabetes",              "domain": "diabetes",        "tier": 2,
     "label": "Diabetes / Metabolic RCTs",
     "term":  ('("diabetes mellitus"[mesh] OR "metabolic syndrome"[mesh]) '
               'AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2018"[pdat]:"3000"[pdat])'),
     "max":   300},
    {"id": "rct_respiratory",           "domain": "respiratory",     "tier": 2,
     "label": "Respiratory Disease RCTs",
     "term":  ('("asthma"[mesh] OR "pulmonary disease chronic obstructive"[mesh] '
               'OR "pneumonia"[mesh]) '
               'AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2018"[pdat]:"3000"[pdat])'),
     "max":   300},
    {"id": "rct_sepsis_criticalcare",   "domain": "emergency",       "tier": 2,
     "label": "Sepsis / Critical Care RCTs",
     "term":  ('(sepsis[mesh] OR "critical care"[mesh] OR "shock septic"[mesh]) '
               'AND "randomized controlled trial"[pt] '
               'AND "pubmed pmc"[sb] AND "humans"[MeSH Terms] '
               'AND ("2018"[pdat]:"3000"[pdat])'),
     "max":   200},
    {"id": "dermatology_guidelines",    "domain": "dermatology",     "tier": 2,
     "label": "Dermatology / Skin Disease Guidelines",
     "term":  ('(skin diseases[mesh] OR dermatitis[mesh] OR mycoses[mesh] '
               'OR tinea[mesh]) AND "practice guideline"[pt] '
               'AND "open access"[filter] AND "humans"[MeSH Terms]'),
     "max":   200},
    {"id": "snakebite_guidelines",      "domain": "emergency",       "tier": 2,
     "label": "Snakebite Envenomation Guidelines",
     "term":  ('("snake bites"[mesh] OR "antivenins"[mesh]) '
               'AND "practice guideline"[pt] AND "open access"[filter]'),
     "max":   30},
    {"id": "palliative_guidelines",     "domain": "palliative",      "tier": 2,
     "label": "Palliative Care / Pain Management Guidelines",
     "term":  ('("palliative care"[mesh] OR "terminal care"[mesh] '
               'OR "pain management"[mesh]) AND "practice guideline"[pt] '
               'AND "open access"[filter] AND "humans"[MeSH Terms]'),
     "max":   150},
    {"id": "psychiatry_guidelines",     "domain": "mental_health",   "tier": 2,
     "label": "Psychiatry / Substance Use Guidelines",
     "term":  ('("schizophrenia"[mesh] OR "bipolar disorder"[mesh] '
               'OR "substance-related disorders"[mesh] '
               'OR "alcohol-related disorders"[mesh]) '
               'AND "practice guideline"[pt] AND "open access"[filter] '
               'AND "humans"[MeSH Terms]'),
     "max":   200},
    {"id": "gastro_guidelines",         "domain": "gastroenterology", "tier": 2,
     "label": "Gastroenterology Guidelines (H. pylori, IBD, GI)",
     "term":  ('("helicobacter pylori"[mesh] OR "inflammatory bowel diseases"[mesh] '
               'OR "peptic ulcer"[mesh] OR "liver cirrhosis"[mesh]) '
               'AND "practice guideline"[pt] AND "open access"[filter]'),
     "max":   200},
    {"id": "rheumatology_guidelines",   "domain": "rheumatology",    "tier": 2,
     "label": "Rheumatology / Lupus / Arthritis Guidelines",
     "term":  ('("arthritis rheumatoid"[mesh] OR "lupus erythematosus systemic"[mesh] '
               'OR "spondylitis ankylosing"[mesh]) '
               'AND "practice guideline"[pt] AND "open access"[filter]'),
     "max":   200},
    # ══ TIER 3 — Specialty completeness ══
    {"id": "nephrology_guidelines",    "domain": "nephrology",    "tier": 3,
     "label": "Nephrology Guidelines",
     "term":  '(kidney diseases[mesh] OR renal insufficiency chronic[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   500},
    {"id": "neurology_guidelines",     "domain": "neurology",     "tier": 3,
     "label": "Neurology Guidelines",
     "term":  '(nervous system diseases[mesh] OR stroke[mesh] OR meningitis[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   500},
    {"id": "surgery_guidelines",       "domain": "surgery",       "tier": 3,
     "label": "Surgery / Perioperative Guidelines",
     "term":  '(surgical procedures operative[mesh] OR anesthesia[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   500},
    {"id": "oncology_guidelines",      "domain": "oncology",      "tier": 3,
     "label": "Cancer Guidelines",
     "term":  '(neoplasms[mesh] OR uterine cervical neoplasms[mesh] OR breast neoplasms[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   500},
    {"id": "blood_disorders",          "domain": "hematology",    "tier": 3,
     "label": "Blood Disorders / Sickle Cell Guidelines",
     "term":  '(anemia[mesh] OR sickle cell disease[mesh] OR hemoglobinopathies[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   500},
    {"id": "ntd_guidelines",           "domain": "ntd",           "tier": 3,
     "label": "Neglected Tropical Diseases Guidelines",
     "term":  '(tropical medicine[mesh] OR schistosomiasis[mesh] OR leishmaniasis[mesh] OR onchocerciasis[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   200},
    {"id": "ophthalmology_guidelines", "domain": "ophthalmology", "tier": 3,
     "label": "Ophthalmology Guidelines",
     "term":  '(eye diseases[mesh] OR trachoma[mesh] OR blindness[mesh]) AND "practice guideline"[pt] AND "open access"[filter]',
     "max":   532},
    # ══ TIER 4 — Large catch-all queries — run LAST ══
    {"id": "global_guidelines",    "domain": "mixed",  "tier": 4,
     "label": "Global Clinical Practice Guidelines (human, 2018+)",
     "term":  ('"practice guideline"[pt] AND "open access"[filter] '
               'AND "humans"[MeSH Terms] '
               'AND ("2018"[pdat]:"3000"[pdat])'),
     "max":   500},
    {"id": "global_systematic_reviews", "domain": "mixed", "tier": 4,
     "label": "Global Systematic Reviews — human clinical (2020+)",
     "term":  ('"systematic review"[pt] AND "open access"[filter] '
               'AND "humans"[MeSH Terms] '
               'AND ("2020"[pdat]:"3000"[pdat]) '
               'AND ("clinical" OR "patient" OR "treatment" OR "diagnosis" OR "therapy")'),
     "max":   1000},
]

# Filter by RUN_MODE
TIER_MAP = {
    "full":  {0, 1, 2, 3, 4},
    "tier0": {0},
    "tier1": {0, 1},
    "tier2": {0, 1, 2},
    "tier3": {0, 1, 2, 3},
    "tier4": {0, 1, 2, 3, 4},
    # Aliases
    "guidelines_only": {0, 1},
    "rct_only":        {1, 2},
}
QUERIES = [q for q in ALL_QUERIES if q["tier"] in TIER_MAP.get(RUN_MODE, {0, 1, 2, 3, 4})]

# ── Data Model ────────────────────────────────────────────────────────────────
@dataclass
class Chunk:
    content:                str
    pmcid:                  str
    doi:                    str
    guideline_id:           str
    guideline_title:        str
    authors:                str
    issuing_body:           str
    guideline_version:      str
    domain:                 str
    section_title:          str
    query_id:               str
    chunk_type:             str
    grade_strength:         str
    grade_evidence_quality: str
    recommendation_text:    str
    confidence_score:       float
    population_tags:        list
    intervention_tags:      list
    source_url:             str
    licence:                str
    word_count:             int
    content_hash:           str
    document_type:          str  = "research_article"
    evidence_tier:          int  = 5
    authority_rank:         int  = 4
    pub_year:               int  = 0
    publication_types:      list = field(default_factory=list)
    mesh_terms:             list = field(default_factory=list)
    journal:                str  = ""
    is_clinical:            bool = True
    geographic_scope:       str  = "global"
    issuing_body_canonical: str  = ""
    embedding:              list = field(default_factory=list)
    chunk_index:            int  = 0
    total_chunks:           int  = 0

# ── GRADE / Recommendation Detection ─────────────────────────────────────────
GRADE_STRENGTH_MAP = [
    ("strong recommendation for",          "Strong for"),
    ("strong recommendation against",      "Strong against"),
    ("conditional recommendation for",     "Conditional for"),
    ("conditional recommendation against", "Conditional against"),
    ("strong recommendation",              "Strong"),
    ("conditional recommendation",         "Conditional"),
    ("we recommend",                       "Strong"),
    ("we suggest",                         "Conditional"),
    ("good practice statement",            "Good practice"),
    ("is recommended",                     "Strong"),
    ("are recommended",                    "Strong"),
    ("should be offered",                  "Strong"),
    ("is suggested",                       "Conditional"),
    ("may be considered",                  "Conditional"),
]

GRADE_EVIDENCE_MAP = [
    ("high certainty",     "High"),
    ("moderate certainty", "Moderate"),
    ("low certainty",      "Low"),
    ("very low certainty", "Very low"),
    ("high-certainty",     "High"),
    ("moderate-certainty", "Moderate"),
    ("low-certainty",      "Low"),
    ("level a evidence",   "High"),
    ("grade a",            "High"),
    ("grade b",            "Moderate"),
    ("1a)", "High"), ("1b)", "Moderate"),
    ("2a)", "Low"),  ("2b)", "Very low"),
]

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
    r'(?:STRONG|CONDITIONAL)\s+RECOMMENDATION'
    r')'
)

def detect_strength(text: str) -> str:
    tl = text.lower()
    for marker, label in GRADE_STRENGTH_MAP:
        if marker in tl:
            return label
    return ""

def detect_evidence(text: str) -> str:
    tl = text.lower()
    for marker, label in GRADE_EVIDENCE_MAP:
        if marker in tl:
            return label
    return ""

# ── Population / Intervention Tags ───────────────────────────────────────────
POPULATION_TAGS = {
    "adults":      [r'(?i)\badult[s]?\b'],
    "children":    [r'(?i)\bchild(?:ren)?\b', r'(?i)\bpediatric\b', r'(?i)\bpaediatric\b'],
    "infants":     [r'(?i)\binfant[s]?\b', r'(?i)\bneonatal\b'],
    "pregnant":    [r'(?i)\bpregnant\b', r'(?i)\bpregnancy\b', r'(?i)\bmaternal\b'],
    "adolescents": [r'(?i)\badolescent[s]?\b'],
    "elderly":     [r'(?i)\bolder adult[s]?\b', r'(?i)\bgeriatric\b'],
}

INTERVENTION_TAGS = {
    "dolutegravir":            [r'(?i)\bdolutegravir\b', r'(?i)\bDTG\b(?!\w)'],
    "ART":                     [r'(?i)\bantiretroviral\b', r'(?i)\bART\b(?!\w)'],
    "cabotegravir":            [r'(?i)\bcabotegravir\b'],
    "ACT":                     [r'(?i)\bartemisinin.based combination\b', r'(?i)\bACT\b(?!\w)'],
    "artemether-lumefantrine": [r'(?i)\bartemether.lumefantrine\b'],
    "ITN":                     [r'(?i)\binsecticide.treated net\b', r'(?i)\b(?:LLIN|ITN)\b(?!\w)'],
    "isoniazid":               [r'(?i)\bisoniazid\b'],
    "rifampicin":              [r'(?i)\brifampicin\b', r'(?i)\brifampin\b'],
    "bedaquiline":             [r'(?i)\bbedaquiline\b'],
    "BPaL":                    [r'(?i)\bBPaL\b', r'(?i)\bpretomanid\b'],
    "metformin":               [r'(?i)\bmetformin\b'],
    "insulin":                 [r'(?i)\binsulin\b'],
    "SGLT2-inhibitor":         [r'(?i)\bSGLT2\b', r'(?i)\bempagliflozin\b', r'(?i)\bdapagliflozin\b'],
    "GLP1-agonist":            [r'(?i)\bGLP.1\b', r'(?i)\bsemaglutide\b', r'(?i)\bliraglutide\b'],
    "statin":                  [r'(?i)\bstatin\b', r'(?i)\batorvastatin\b'],
    "ACE-inhibitor":           [r'(?i)\bACE inhibitor\b', r'(?i)\blisinopril\b'],
    "oxytocin":                [r'(?i)\boxytocin\b'],
    "iron-supplements":        [r'(?i)\biron supplement\b', r'(?i)\bferrous\b'],
}

def extract_tags(text: str) -> dict:
    return {
        "population_tags":   [t for t, ps in POPULATION_TAGS.items()
                               if any(re.search(p, text) for p in ps)],
        "intervention_tags": [t for t, ps in INTERVENTION_TAGS.items()
                               if any(re.search(p, text) for p in ps)],
    }

# ── JATS XML Parser ───────────────────────────────────────────────────────────
def _text(node) -> str:
    parts = []
    def walk(el):
        if el.text: parts.append(el.text.strip())
        for ch in el:
            walk(ch)
            if ch.tail: parts.append(ch.tail.strip())
    walk(node)
    return " ".join(p for p in parts if p)

def parse_article(xml_bytes: bytes) -> dict | None:
    try:
        root = etree.fromstring(xml_bytes)
    except Exception:
        return None

    title_el = root.find(".//article-title")
    title    = _text(title_el) if title_el is not None else ""
    if not title:
        return None

    article_type = root.get("article-type", "")

    pub_types = []
    for sg in root.findall(".//subj-group"):
        stype = sg.get("subj-group-type", "").lower()
        if stype in ("heading", "article-type", "publication-type"):
            for subj in sg.findall("subject"):
                t = _text(subj).strip()
                if t:
                    pub_types.append(t)
    for kg in root.findall(".//kwd-group"):
        if "pub" in kg.get("kwd-group-type", "").lower():
            for kwd in kg.findall("kwd"):
                t = _text(kwd).strip()
                if t:
                    pub_types.append(t)

    mesh = []
    for kg in root.findall(".//kwd-group"):
        ktype = kg.get("kwd-group-type", "").lower()
        if "mesh" in ktype or "controlled" in ktype:
            for kwd in kg.findall("kwd"):
                t = _text(kwd).strip()
                if t:
                    mesh.append(t)
    if not mesh:
        for kwd in root.findall(".//kwd"):
            t = _text(kwd).strip()
            if t and t[0].isupper() and len(t.split()) <= 6:
                mesh.append(t)
    mesh = list(set(mesh))[:30]

    non_human_markers = {"animals", "rats", "mice", "mouse model", "murine",
                         "rodent", "dogs", "cattle", "swine", "in vitro",
                         "cell line", "cell culture", "geology", "seismic",
                         "earthquake", "mineral", "cryptocurrency"}
    kwd_text = " ".join(m.lower() for m in mesh)
    title_l  = title.lower()

    is_basic_science = (
        any(marker in kwd_text for marker in non_human_markers)
        and not any(clinical in kwd_text or clinical in title_l
                    for clinical in ["patient", "clinical", "guideline",
                                     "human", "treatment", "diagnosis"])
    )
    is_veterinary = (
        "veterinar" in title_l
        and not any(h in title_l
                    for h in ["human", "patient", "women",
                              "men", "children", "adult"])
    )
    is_clinical = not (is_basic_science or is_veterinary)

    doi, journal, year = "", "", ""
    for aid in root.findall(".//article-id"):
        if aid.get("pub-id-type") == "doi":
            doi = aid.text or ""
    j_el = root.find(".//journal-title")
    if j_el is not None:
        journal = j_el.text or ""
    pd = root.find(".//pub-date")
    if pd is not None:
        ye = pd.find("year")
        if ye is not None:
            year = ye.text or ""

    authors = []
    for c in root.findall(".//contrib[@contrib-type='author']"):
        n   = c.find("name")
        col = c.find("collab")
        if n is not None:
            s = n.find("surname")
            g = n.find("given-names")
            surname  = (s.text or "").strip() if s is not None else ""
            given    = (g.text or "").strip() if g is not None else ""
            initials = "".join(w[0] for w in given.split() if w)
            if surname:
                authors.append(f"{surname} {initials}".strip())
        elif col is not None:
            ct = _text(col).strip()
            if ct:
                authors.append(ct)
    authors_str = (
        ", ".join(authors[:3]) + " et al." if len(authors) > 3
        else ", ".join(authors)
    )

    licence = "open-access"
    for lic in root.findall(".//license"):
        lt = lic.get("license-type", "")
        if lt:
            licence = lt
            break

    abstract_sections = []
    abstract_el = root.find(".//abstract")
    if abstract_el is not None:
        abs_secs = abstract_el.findall("sec")
        if abs_secs:
            for abs_sec in abs_secs:
                st_el = abs_sec.find("title")
                st    = _text(st_el).strip() if st_el is not None else "Abstract"
                paras = [_text(p).strip() for p in abs_sec.findall(".//p")]
                content = "\n\n".join(p for p in paras if len(p.split()) >= 5)
                if content:
                    abstract_sections.append({
                        "title": st, "content": content, "level": 0
                    })
        else:
            paras = [_text(p).strip() for p in abstract_el.findall(".//p")]
            if not paras:
                full = _text(abstract_el).strip()
                if full:
                    paras = [full]
            content = "\n\n".join(p for p in paras if len(p.split()) >= 10)
            if content:
                abstract_sections.append({
                    "title": "Abstract", "content": content, "level": 0
                })

    body = root.find(".//body")
    if body is None:
        return {"title": title, "doi": doi, "journal": journal,
                "year": year, "authors": authors_str, "licence": licence,
                "article_type": article_type, "pub_types": pub_types,
                "mesh_terms": mesh, "is_clinical": is_clinical,
                "sections": abstract_sections}

    def table_to_prose(table_el) -> str:
        """Convert a JATS <table> element to readable prose rows."""
        rows = table_el.findall(".//tr")
        if not rows:
            return ""
        lines, headers = [], []
        for i, row in enumerate(rows):
            cells = row.findall("th") + row.findall("td")
            texts = [_text(c).strip() for c in cells]
            texts = [t for t in texts if t]
            if not texts:
                continue
            # FIX: corrected boolean check — was: i 0 or all(... "th" ...)
            is_header = (i == 0) or all(c.tag.split("}")[-1] == "th" for c in row)
            if is_header:
                headers = texts
                lines.append(" | ".join(texts))
            else:
                if headers and len(texts) == len(headers):
                    lines.append("; ".join(
                        f"{h}: {v}" for h, v in zip(headers, texts) if v
                    ))
                else:
                    lines.append(" | ".join(texts))
        return "\n".join(lines)

    def extract(parent, level=0):
        secs = []
        for sec in parent.findall("sec"):
            st_el = sec.find("title")
            st    = _text(st_el).strip() if st_el is not None else ""
            paras = []
            for child in sec:
                tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                if tag in ("p", "list", "boxed-text", "statement", "def-list"):
                    t = _text(child).strip()
                    if t and len(t.split()) >= 10:
                        paras.append(t)
                elif tag == "table-wrap":
                    parts = []
                    label_el   = child.find("label")
                    caption_el = child.find("caption")
                    if label_el is not None:
                        lbl = _text(label_el).strip()
                        if lbl:
                            parts.append(lbl)
                    if caption_el is not None:
                        cap = _text(caption_el).strip()
                        if cap:
                            parts.append(cap)
                    for tbl in child.findall(".//table"):
                        prose = table_to_prose(tbl)
                        if prose:
                            parts.append(prose)
                    for fn in child.findall(".//table-wrap-foot"):
                        ft = _text(fn).strip()
                        if ft and len(ft.split()) >= 5:
                            parts.append(ft)
                    combined = "\n\n".join(parts)
                    if combined and len(combined.split()) >= 10:
                        paras.append(combined)
                elif tag == "fig":
                    fig_parts = []
                    fig_label = child.find("label")
                    fig_cap   = child.find("caption")
                    if fig_label is not None:
                        lbl = _text(fig_label).strip()
                        if lbl:
                            fig_parts.append(lbl)
                    if fig_cap is not None:
                        cap = _text(fig_cap).strip()
                        if cap:
                            fig_parts.append(cap)
                    combined = " — ".join(fig_parts)
                    if combined and len(combined.split()) >= 5:
                        paras.append(combined)
            content = "\n\n".join(paras)
            if content or st:
                secs.append({"title": st, "content": content, "level": level})
            secs.extend(extract(sec, level + 1))
        return secs

    return {"title": title, "doi": doi, "journal": journal, "year": year,
            "authors": authors_str, "licence": licence,
            "article_type": article_type, "pub_types": pub_types,
            "mesh_terms": mesh, "is_clinical": is_clinical,
            "sections": abstract_sections + extract(body)}

# ── Document Type & Evidence Tier Classification ─────────────────────────────
PUBTYPE_TO_DOCTYPE = {
    "practice guideline":              "clinical_practice_guideline",
    "guideline":                       "clinical_practice_guideline",
    "consensus development conference":"consensus_statement",
    "consensus development conference, nih": "consensus_statement",
    "systematic review":               "systematic_review",
    "meta-analysis":                   "meta_analysis",
    "network meta-analysis":           "network_meta_analysis",
    "cochrane review":                 "systematic_review",
    "randomized controlled trial":     "randomized_controlled_trial",
    "randomized controlled trial, veterinary": None,
    "pragmatic clinical trial":        "clinical_trial",
    "adaptive clinical trial":         "clinical_trial",
    "equivalence trial":               "clinical_trial",
    "clinical trial":                  "clinical_trial",
    "clinical trial, phase i":         "clinical_trial",
    "clinical trial, phase ii":        "clinical_trial",
    "clinical trial, phase iii":       "clinical_trial",
    "clinical trial, phase iv":        "clinical_trial",
    "controlled clinical trial":       "clinical_trial",
    "multicenter study":               "clinical_trial",
    "comparative effectiveness research": "clinical_trial",
    "observational study":             "observational_study",
    "cohort study":                    "observational_study",
    "cross-sectional study":           "observational_study",
    "validation study":                "observational_study",
    "diagnostic test accuracy study":  "observational_study",
    "twin study":                      "observational_study",
    "review":                          "review_article",
    "scoping review":                  "scoping_review",
    "case reports":                    "case_report",
    "editorial":                       None,
    "letter":                          None,
    "news":                            None,
    "comment":                         None,
    "patient education handout":       None,
    "published erratum":               None,
    "retracted publication":           None,
    "preprint":                        None,
}

DOCTYPE_TO_TIER = {
    "clinical_practice_guideline": 1,
    "consensus_statement":         1,
    "systematic_review":           2,
    "meta_analysis":               2,
    "network_meta_analysis":       2,
    "randomized_controlled_trial": 3,
    "clinical_trial":              3,
    "review_article":              4,
    "scoping_review":              4,
    "observational_study":         4,
    "case_report":                 5,
    "research_article":            5,
}

GUIDELINE_QUERY_IDS = {
    "guideline", "recommendation", "consensus", "protocol",
    "kdigo", "esc_", "ada_", "ash_", "who_", "nice_", "wses_",
    "figo_", "surviving_sepsis", "eras_", "surviving",
}
SYSREV_QUERY_IDS = {
    "systematic_review", "global_systematic_reviews", "meta_analysis",
    "cochrane_",
}
RCT_QUERY_IDS = {
    "rct_", "landmark_rct", "_rct",
}

RANK1_BODIES = {
    "who", "world health organization", "world health organisation",
    "nice", "national institute for health and care excellence",
    "cochrane", "kdigo",
    "africa cdc", "africa centres for disease control",
}
RANK2_BODIES = {
    "esc", "european society of cardiology",
    "ada", "american diabetes association",
    "aha", "american heart association",
    "acc", "american college of cardiology",
    "eacs", "european aids clinical society",
    "idsa", "infectious diseases society of america",
    "isth", "international society on thrombosis",
    "figo", "international federation of gynecology",
    "wses", "world society of emergency surgery",
    "eras", "enhanced recovery after surgery",
    "wgo", "world gastroenterology organisation",
    "eular", "european league against rheumatism",
    "esmo", "european society for medical oncology",
    "asco", "american society of clinical oncology",
    "espen", "european society for clinical nutrition",
    "ash", "american society of hematology",
    "aasld", "american association for study of liver",
    "easl", "european association for the study of the liver",
    "aan", "american academy of neurology",
    "ean", "european academy of neurology",
    "sccm", "society of critical care medicine",
    "surviving sepsis",
    "ers", "european respiratory society",
    "ats", "american thoracic society",
    "idf", "international diabetes federation",
    "sahcs", "southern african hiv clinicians society",
    "bhiva", "british hiv association",
    "acr", "american college of rheumatology",
    "aap", "american academy of pediatrics",
    "who afro", "regional office for africa",
    # Phase 2 additions
    "eha", "european hematology association",
    "esge", "european society of gastrointestinal endoscopy",
    "rcog", "royal college of obstetricians",
    "sso", "society of surgical oncology",
}
RANK3_BODIES = {
    "ministry of health", "national guidelines", "nascop",
    "government", "national institute", "health authority",
    "kenya medical research", "kemri",
    "kenya ministry", "national aids",
    "east african community",
    "amref",
}

AFRICA_TERMS = {"africa", "african", "sub-saharan", "sub saharan"}
EA_TERMS     = {"kenya", "uganda", "tanzania", "ethiopia", "rwanda",
                "east africa", "east african", "eastern africa"}
LMIC_TERMS   = {"low-income", "middle-income", "lmic", "developing countr",
                "resource-limited", "resource limited"}

def detect_geographic_scope(title: str, abstract_text: str = "") -> str:
    text = (title + " " + abstract_text).lower()
    if any(t in text for t in EA_TERMS):
        return "east_africa"
    if any(t in text for t in AFRICA_TERMS):
        return "africa"
    if any(t in text for t in LMIC_TERMS):
        return "lmic"
    if any(t in text for t in {"europe", "european", "uk ", "british",
                                "france", "germany", "spain", "italy"}):
        return "europe"
    if any(t in text for t in {"united states", "american", "canada",
                                "north america"}):
        return "north_america"
    return "global"

def canonical_body(issuing_body: str) -> str:
    b = issuing_body.lower().strip()
    canon_map = {
        "world health organization":  "WHO",
        "world health organisation":  "WHO",
        "who":                        "WHO",
        "nice":                       "NICE",
        "national institute for health and care excellence": "NICE",
        "cochrane":                   "Cochrane",
        "kdigo":                      "KDIGO",
        "esc":                        "ESC",
        "european society of cardiology": "ESC",
        "ada":                        "ADA",
        "american diabetes association": "ADA",
        "idf":                        "IDF",
        "international diabetes federation": "IDF",
        "aha":                        "AHA",
        "american heart association": "AHA",
        "idsa":                       "IDSA",
        "infectious diseases society of america": "IDSA",
        "eacs":                       "EACS",
        "ash":                        "ASH",
        "american society of hematology": "ASH",
        "eular":                      "EULAR",
        "esmo":                       "ESMO",
        "wses":                       "WSES",
        "figo":                       "FIGO",
        "easl":                       "EASL",
        "aasld":                      "AASLD",
        "ers":                        "ERS",
        "european respiratory society": "ERS",
        "ats":                        "ATS",
        "american thoracic society":  "ATS",
        "acr":                        "ACR",
        "american college of rheumatology": "ACR",
        "sahcs":                      "SAHCS",
        "southern african hiv clinicians": "SAHCS",
        "bhiva":                      "BHIVA",
        "british hiv association":    "BHIVA",
        "africa cdc":                 "Africa CDC",
        "africa centres for disease control": "Africa CDC",
        # Phase 2 additions
        "eha":                        "EHA",
        "european hematology association": "EHA",
        "esge":                       "ESGE",
        "european society of gastrointestinal endoscopy": "ESGE",
        "rcog":                       "RCOG",
        "royal college of obstetricians": "RCOG",
        "sso":                        "SSO",
        "society of surgical oncology": "SSO",
    }
    for key, val in canon_map.items():
        if key in b:
            return val
    return issuing_body

def classify_document(query_id: str, title: str, article_type: str,
                       issuing_body: str,
                       pub_types: list | None = None,
                       pt_verified: bool = False) -> tuple:
    """
    Returns (document_type, evidence_tier, authority_rank).
    Priority:
    1. PubMed publication types (NLM-assigned)
    2. Query ID — only when pt_verified=True
    3. JATS article-type attribute
    4. Title keywords (fallback)
    """
    qid     = query_id.lower()
    title_l = title.lower()
    art_l   = article_type.lower()
    body_l  = issuing_body.lower()
    ptypes  = [p.lower() for p in (pub_types or [])]

    doc_type = None

    for pt in ptypes:
        if pt not in PUBTYPE_TO_DOCTYPE:
            continue
        mapped = PUBTYPE_TO_DOCTYPE[pt]
        if mapped is None:
            doc_type = "exclude"
        else:
            doc_type = mapped
        break

    if doc_type is None and pt_verified:
        if any(s in qid for s in SYSREV_QUERY_IDS):
            doc_type = "systematic_review"
        elif any(s in qid for s in RCT_QUERY_IDS):
            doc_type = "randomized_controlled_trial"
        elif any(s in qid for s in GUIDELINE_QUERY_IDS):
            doc_type = "clinical_practice_guideline"

    if doc_type is None:
        if any(t in art_l for t in ("practice-guideline", "practice guideline")):
            doc_type = "clinical_practice_guideline"
        elif any(t in art_l for t in ("systematic-review", "systematic review")):
            doc_type = "systematic_review"
        elif "meta-analysis" in art_l:
            doc_type = "meta_analysis"
        elif any(t in art_l for t in ("clinical-trial", "randomized")):
            doc_type = "randomized_controlled_trial"
        elif "review" in art_l:
            doc_type = "review_article"

    if doc_type is None:
        if any(w in title_l for w in ("guideline", "guidance",
                                       "recommendation", "consensus",
                                       "protocol", "standard of care")):
            doc_type = "clinical_practice_guideline"
        elif any(w in title_l for w in ("systematic review", "meta-analysis",
                                         "meta analysis", "cochrane review")):
            doc_type = "systematic_review"
        elif any(w in title_l for w in ("randomized", "randomised", " rct",
                                         "clinical trial")):
            doc_type = "randomized_controlled_trial"
        elif "review" in title_l:
            doc_type = "review_article"
        else:
            doc_type = "research_article"

    evidence_tier = DOCTYPE_TO_TIER.get(doc_type, 5)

    if any(t in body_l for t in RANK1_BODIES):
        authority_rank = 1
    elif any(t in body_l for t in RANK2_BODIES):
        authority_rank = 2
    elif doc_type == "clinical_practice_guideline":
        authority_rank = 3
    elif any(t in body_l for t in RANK3_BODIES):
        authority_rank = 3
    else:
        authority_rank = 4

    return doc_type, evidence_tier, authority_rank

# ── Chunking ──────────────────────────────────────────────────────────────────
OVERLAP_WORDS = 50

def split_sentences(text: str, max_w: int, overlap: int = OVERLAP_WORDS) -> list[str]:
    sents = re.split(r'(?<=[.!?])\s+', text)
    chunks, buf_sents, bw = [], [], 0
    for s in sents:
        sw = len(s.split())
        if buf_sents and bw + sw > max_w:
            chunks.append(" ".join(buf_sents))
            new_buf, new_bw = [], 0
            for prev_s in reversed(buf_sents):
                prev_w = len(prev_s.split())
                if new_bw + prev_w <= overlap:
                    new_buf.insert(0, prev_s)
                    new_bw += prev_w
                else:
                    break
            buf_sents, bw = new_buf, new_bw
        buf_sents.append(s)
        bw += sw
    if buf_sents:
        chunks.append(" ".join(buf_sents))

    refined = []
    for chunk in chunks:
        if len(chunk.split()) <= max_w:
            refined.append(chunk)
            continue
        lines = [ln.strip() for ln in chunk.split('\n') if ln.strip()]
        line_buf, line_bw = [], 0
        for line in lines:
            lw = len(line.split())
            if line_buf and line_bw + lw > max_w:
                refined.append(" ".join(line_buf))
                line_buf, line_bw = [], 0
            line_buf.append(line)
            line_bw += lw
        if line_buf:
            refined.append(" ".join(line_buf))

    final = []
    for chunk in refined:
        words = chunk.split()
        if len(words) <= max_w:
            final.append(chunk)
        else:
            step = max(1, max_w - overlap)
            for i in range(0, len(words), step):
                window = " ".join(words[i:i + max_w])
                if len(window.split()) >= MIN_CHUNK_W:
                    final.append(window)
    return [c for c in final if len(c.split()) >= MIN_CHUNK_W]

def split_block(text: str) -> list[str]:
    if len(text.split()) <= MAX_CHUNK_W:
        return [text] if len(text.split()) >= MIN_CHUNK_W else []
    paras  = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]
    chunks, buf, bw = [], [], 0
    for para in paras:
        pw = len(para.split())
        if pw > MAX_CHUNK_W:
            if buf:
                j = "\n\n".join(buf)
                if len(j.split()) >= MIN_CHUNK_W:
                    chunks.append(j)
                buf, bw = [], 0
            chunks.extend(split_sentences(para, MAX_CHUNK_W))
            continue
        if buf and bw + pw > MAX_CHUNK_W:
            j = "\n\n".join(buf)
            if len(j.split()) >= MIN_CHUNK_W:
                chunks.append(j)
            buf, bw = [], 0
        buf.append(para)
        bw += pw
    if buf:
        j = "\n\n".join(buf)
        if len(j.split()) >= MIN_CHUNK_W:
            chunks.append(j)
    final = []
    for c in (chunks or split_sentences(text, MAX_CHUNK_W)):
        if len(c.split()) > MAX_CHUNK_W:
            final.extend(split_sentences(c, MAX_CHUNK_W))
        else:
            final.append(c)
    return final

# ── Module-level constants ────────────────────────────────────────────────────
SKIP_SEC_TITLES: frozenset[str] = frozenset({
    "references", "bibliography", "acknowledgements", "acknowledgments",
    "conflict of interest", "conflicts of interest", "declaration",
    "declarations", "disclosures", "funding", "author contributions",
    "supporting information", "supplementary", "appendix",
    "list of abbreviations", "abbreviations", "glossary",
})

_QUERY_TERM_LOOKUP: dict[str, str] = {
    q["id"]: (q["term"] if isinstance(q["term"], str) else " ".join(q["term"]))
    for q in ALL_QUERIES
}

_QUERY_ID_TO_BODY = {
    "kdigo":                   "KDIGO",
    "ash_":                    "ASH",
    "wses":                    "WSES",
    "figo":                    "FIGO",
    "surviving_sepsis":        "Surviving Sepsis Campaign",
    "wgo":                     "WGO",
    "eular":                   "EULAR",
    "eras":                    "ERAS Society",
    "esc_":                    "ESC",
    "acc_aha":                 "ACC/AHA",
    "ish_":                    "ISH",
    "ada_":                    "ADA",
    "endocrine":               "Endocrine Society",
    "ers_":                    "ERS",
    "ats_":                    "ATS",
    "idsa":                    "IDSA",
    "eacs":                    "EACS",
    "bhiva":                   "BHIVA",
    "easl":                    "EASL",
    "aasld":                   "AASLD",
    "acg_":                    "ACG",
    "aap_":                    "AAP",
    "espghan":                 "ESPGHAN",
    "ean_":                    "EAN",
    "aan_":                    "AAN",
    "esmo":                    "ESMO",
    "asco":                    "ASCO",
    "acr_":                    "ACR",
    "isth":                    "ISTH",
    "esicm":                   "ESICM",
    "espen":                   "ESPEN",
    "who_":                    "WHO",
    "who_afro":                "WHO AFRO",
    "cochrane":                "Cochrane",
    "lancet_infect":           "Lancet Infectious Diseases",
    "nice_":                   "NICE",
    "sahcs":                   "SAHCS",
    "idf_":                    "IDF",
    # ── Oncology Phase 2 additions (April 2026) ──────────────────────────────
    "asco_jco":                "ASCO",
    "esmo_annals":             "ESMO",
    "ash_oncology":            "ASH",
    "eha_":                    "EHA",
    "esge_":                   "ESGE",
    "rcog_bjog":               "RCOG",
    "sso_":                    "SSO",
    "european_journal_cancer": "ESMO/ESSO/SIOPE",
    # Disease-specific queries — issuing body inferred from article metadata
    # (WHO, FIGO, ASCO etc.) rather than query_id. Left blank intentionally
    # so classify_document() falls through to title/affiliation detection.
    "cervical_cancer":         "",
    "kaposi_":                 "",
    "burkitt_":                "",
    "breast_cancer_lmic":      "",
}

def _body_from_query_id(query_id: str) -> str:
    """Infer issuing body from query_id when title/journal-based detection fails."""
    qid = query_id.lower()
    for prefix, body in _QUERY_ID_TO_BODY.items():
        if qid.startswith(prefix):
            return body
    return ""

def build_chunks(article: dict, pmcid: str, query_id: str, domain: str,
                 rec_counter: dict | None = None) -> list[Chunk]:
    """
    Build chunks from a parsed article.
    FIX: rec_counter is now passed in from the caller so recommendation_id
    values (PMCxxx-R1, PMCxxx-R2 ...) remain unique across flush cycles.
    Pass rec_counter={"n": 0} at the start of each query and reuse it across
    all articles in that query. chunk_to_row() no longer needs its own counter.
    """
    if rec_counter is None:
        rec_counter = {"n": 0}

    chunks = []
    title        = article["title"]
    doi          = article["doi"]
    journal      = article["journal"]
    year         = article["year"]
    authors      = article["authors"]
    licence      = article.get("licence", "open-access")
    article_type = article.get("article_type", "")
    pub_types    = article.get("pub_types", [])
    mesh_terms   = article.get("mesh_terms", [])
    is_clinical  = article.get("is_clinical", True)
    gid          = f"pmc_{pmcid}"
    pub_year     = int(year) if year and year.isdigit() else 0

    _title_l = title.lower()
    issuing_body_tmp = (
        "WHO"
        if "world health" in _title_l or "WHO" in journal
        else _body_from_query_id(query_id)
        or journal
        or "PMC"
    )

    _q_term = _QUERY_TERM_LOOKUP.get(query_id, "")
    pt_verified = (
        '"practice guideline"[pt]' in _q_term
        or '"systematic review"[pt]' in _q_term
        or '"meta-analysis"[pt]' in _q_term
        or '"randomized controlled trial"[pt]' in _q_term
    )

    doc_type, evidence_tier, authority_rank = classify_document(
        query_id, title, article_type, issuing_body_tmp, pub_types, pt_verified
    )
    body_canonical = canonical_body(issuing_body_tmp)

    _abstract_text = " ".join(
        s.get("content", "") for s in article.get("sections", [])
        if s.get("title", "").lower() in ("abstract", "background",
                                          "introduction", "objectives", "")
        and s.get("level", 0) == 0
    )[:2000]
    geo_scope = detect_geographic_scope(title, _abstract_text)

    if not is_clinical:
        log.debug("  SKIP (non-clinical): %s", title[:60])
        return []
    if doc_type == "exclude":
        log.debug("  SKIP (excluded doc type): %s", title[:60])
        return []

    for sec in article.get("sections", []):
        content   = sec.get("content", "")
        sec_title = sec.get("title", "").lower().strip()

        if any(s in sec_title for s in SKIP_SEC_TITLES):
            continue
        if not content or len(content.split()) < MIN_CHUNK_W:
            continue

        positions = [m.start() for m in RECOMMENDATION_RE.finditer(content)]
        raw: list[tuple[str, str]] = []
        if positions:
            if positions[0] > MIN_CHUNK_W * 4:
                for b in split_block(content[:positions[0]].strip()):
                    raw.append(("context", b))
            for i, pos in enumerate(positions):
                end = positions[i + 1] if i + 1 < len(positions) else len(content)
                for b in split_block(content[pos:end].strip()):
                    raw.append(("rec", b))
        else:
            for b in split_block(content):
                raw.append(("context", b))

        for seg_type, block in raw:
            is_rec   = seg_type == "rec"
            strength = detect_strength(block) if is_rec else ""
            evidence = detect_evidence(block) if is_rec else ""
            tags     = extract_tags(block)

            if is_rec and RECOMMENDATION_RE.search(block):
                ctype = "recommendation_statement"
            elif sum(1 for p in [r'(?i)\bevidence\b', r'(?i)\btrial\b', r'(?i)\bmeta-analysis\b']
                     if re.search(p, block)) >= 2:
                ctype = "rationale"
            else:
                ctype = "background"

            # FIX: recommendation_id assigned here using the persistent rec_counter
            # so IDs are unique across flush cycles within a query run.
            rec_id = ""
            if ctype == "recommendation_statement":
                rec_counter["n"] += 1
                rec_id = f"PMC{pmcid}-R{rec_counter['n']}"

            chunks.append(Chunk(
                content=block,
                pmcid=pmcid,
                doi=doi,
                guideline_id=gid,
                guideline_title=title,
                authors=authors,
                issuing_body=issuing_body_tmp,
                guideline_version=year or "unknown",
                domain=domain,
                section_title=sec.get("title", ""),
                query_id=query_id,
                chunk_type=ctype,
                grade_strength=strength,
                grade_evidence_quality=evidence,
                recommendation_text="",   # populated by pmc_llm_enrich.py
                confidence_score=0.0,     # populated by pmc_llm_enrich.py
                population_tags=tags["population_tags"],
                intervention_tags=tags["intervention_tags"],
                source_url=f"https://pmc.ncbi.nlm.nih.gov/articles/PMC{pmcid}/",
                licence=licence,
                document_type=doc_type,
                evidence_tier=evidence_tier,
                authority_rank=authority_rank,
                pub_year=pub_year,
                publication_types=pub_types,
                mesh_terms=mesh_terms,
                journal=journal,
                is_clinical=is_clinical,
                geographic_scope=geo_scope,
                issuing_body_canonical=body_canonical,
                word_count=len(block.split()),
                content_hash=hashlib.sha256(block.encode()).hexdigest()[:32],
            ))

    total = len(chunks)
    for i, c in enumerate(chunks):
        c.chunk_index  = i
        c.total_chunks = total

    return chunks

# ── Embedding ─────────────────────────────────────────────────────────────────
def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings using text-embedding-3-large (1536 dims).
    Truncates to MAX_EMBED_CHARS before sending.
    FIX: Added 5xx retry — original returned empty vectors immediately on any
    non-200/429 response, silently dropping chunks on transient OpenAI errors.
    """
    safe_texts = [t[:MAX_EMBED_CHARS] for t in texts]
    for attempt in range(4):
        try:
            time.sleep(0.05)
            r = _openai_session.post(
                OPENAI_EMBED,
                json={"model": EMBED_MODEL, "input": safe_texts, "dimensions": EMBED_DIM},
                timeout=60,
            )
            if r.status_code == 200:
                data = r.json()["data"]
                return [d["embedding"] for d in sorted(data, key=lambda x: x["index"])]
            elif r.status_code == 429:
                wait = 10 * (2 ** attempt)
                log.warning("OpenAI rate limit — waiting %ds (attempt %d/4)", wait, attempt + 1)
                time.sleep(wait)
            elif r.status_code >= 500:
                # FIX: retry on 5xx instead of returning empty immediately
                wait = 10 * (2 ** attempt)
                log.warning("OpenAI 5xx error %d — retrying in %ds (attempt %d/4)",
                            r.status_code, wait, attempt + 1)
                time.sleep(wait)
            else:
                log.error("OpenAI embed error %d: %s", r.status_code, r.text[:200])
                return [[] for _ in texts]
        except Exception as e:
            wait = 5 * (2 ** attempt)
            log.warning("Embed attempt %d/4 failed: %s — retrying in %ds", attempt + 1, e, wait)
            time.sleep(wait)
    return [[] for _ in texts]

def embed_chunks(chunks: list[Chunk]) -> list[Chunk]:
    """Embed all chunks with adaptive batch sizing and per-chunk fallback."""
    total    = len(chunks)
    embedded = 0
    batch_sz = EMBED_BATCH
    MIN_BATCH = 10
    i = 0
    while i < total:
        if _shutdown_requested or _runtime_exceeded():
            log.warning("  Embed interrupted at %d/%d — returning partial results", i, total)
            break
        batch   = chunks[i: i + batch_sz]
        texts   = [c.content for c in batch]
        vectors = embed_batch(texts)
        success = sum(1 for v in vectors if v)
        if success == 0:
            if batch_sz > MIN_BATCH:
                batch_sz = max(MIN_BATCH, batch_sz // 2)
                log.warning("  Embed batch failed — reducing batch size to %d", batch_sz)
                continue
            else:
                log.warning("  Embed batch failed at min batch_sz=%d — falling back to per-chunk mode", MIN_BATCH)
                rescued = 0
                for chunk in batch:
                    hard_text = chunk.content[:HARD_TRUNCATE_CHARS]
                    solo_vecs = embed_batch([hard_text])
                    if solo_vecs and solo_vecs[0]:
                        chunk.embedding = solo_vecs[0]
                        rescued += 1
                if rescued:
                    log.warning("  Per-chunk fallback rescued %d/%d chunks", rescued, len(batch))
                embedded += rescued
                i        += len(batch)
                batch_sz = min(EMBED_BATCH, batch_sz * 2)
                continue
        for chunk, vec in zip(batch, vectors):
            chunk.embedding = vec
        embedded += success
        i        += len(batch)
        if i % 1000 == 0:
            log.info("  Embedded %d/%d chunks (batch_sz=%d)", i, total, batch_sz)
    log.info("  Embedding complete — %d/%d successful", embedded, total)
    return chunks

# ── Supabase Write ────────────────────────────────────────────────────────────
SUPABASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "resolution=ignore-duplicates,return=minimal",
}

_supabase_session = requests.Session()
_supabase_session.headers.update(SUPABASE_HEADERS)
_ncbi_session = requests.Session()
_openai_session = requests.Session()
_openai_session.headers.update({
    "Authorization": f"Bearer {OPENAI_API_KEY}",
    "Content-Type":  "application/json",
})

def get_existing_pmcids() -> set[str]:
    """Load all ingested PMCIDs from Supabase with pagination."""
    existing: set[str] = set()
    offset = 0
    PAGE   = 10000
    while True:
        fetched = False
        for attempt in range(3):
            try:
                r = _supabase_session.get(
                    f"{SUPABASE_URL}/rest/v1/guideline_chunks",
                    params={
                        "select": "pmcid",
                        "pmcid":  "not.is.null",
                        "limit":  PAGE,
                        "offset": offset,
                        "order":  "id.asc",
                    },
                    timeout=60,
                )
                if r.status_code == 200:
                    rows = r.json()
                    existing.update(row["pmcid"] for row in rows if row.get("pmcid"))
                    fetched = True
                    if len(rows) < PAGE:
                        return existing
                    offset += PAGE
                    break
                else:
                    wait = 10 * (2 ** attempt)
                    log.warning("get_existing_pmcids HTTP %d at offset %d — retrying in %ds",
                                r.status_code, offset, wait)
                    time.sleep(wait)
            except Exception as exc:
                wait = 10 * (2 ** attempt)
                log.warning("get_existing_pmcids error at offset %d: %s — retrying in %ds",
                            offset, exc, wait)
                time.sleep(wait)
        if not fetched:
            log.error("get_existing_pmcids gave up at offset %d after 3 attempts — "
                      "deduplication may be incomplete", offset)
            break
    return existing

def chunk_to_row(c: Chunk) -> dict:
    """
    FIX: rec_counter removed — recommendation_id is now assigned in build_chunks()
    using a persistent counter passed across flush cycles. This prevents duplicate
    PMCxxx-R1 IDs when an article spans multiple flush boundaries.
    """
    return {
        "content":                  c.content,
        "word_count":               c.word_count,
        "content_hash":             c.content_hash,
        "chunk_index":              c.chunk_index,
        "total_chunks":             c.total_chunks,
        "guideline_id":             c.guideline_id,
        "guideline_version":        c.guideline_version,
        "is_current_version":       True,
        "guideline_title":          c.guideline_title,
        "authors":                  c.authors,
        "issuing_body":             c.issuing_body,
        "domain":                   c.domain,
        "chapter_title":            c.section_title or "",
        "chapter_detection_method": "jats_xml_sec",
        "recommendation_id":        getattr(c, "recommendation_id", ""),
        "chunk_type":               c.chunk_type,
        "grade_strength":           c.grade_strength,
        "grade_direction":          "",
        "grade_evidence_quality":   c.grade_evidence_quality,
        "grade_symbol":             "",
        "recommendation_text":      c.recommendation_text,
        "confidence_score":         c.confidence_score,
        "population_tags":          c.population_tags,
        "intervention_tags":        c.intervention_tags,
        "condition_tags":           [],
        "source_url":               c.source_url,
        "source_type":              "pmc_oa_guideline",
        "document_type":            c.document_type,
        "evidence_tier":            c.evidence_tier,
        "authority_rank":           c.authority_rank,
        "pub_year":                 c.pub_year,
        "publication_types":        c.publication_types,
        "mesh_terms":               c.mesh_terms,
        "journal":                  c.journal,
        "is_clinical":              c.is_clinical,
        "geographic_scope":         c.geographic_scope,
        "issuing_body_canonical":   c.issuing_body_canonical,
        "licence":                  c.licence,
        "pmcid":                    c.pmcid,
        "doi":                      c.doi,
        "embedding":                c.embedding if c.embedding else None,
        "date_ingested":            datetime.now(timezone.utc).isoformat(),
    }

def write_batch(rows: list[dict]) -> tuple[int, int]:
    """
    Insert rows to guideline_chunks with retry and row-by-row fallback.
    Safe to re-run — existing rows are silently skipped.
    """
    seen: set[str] = set()
    deduped = []
    for row in rows:
        h = row["content_hash"]
        if h not in seen:
            seen.add(h)
            deduped.append(row)
    if not deduped:
        return 0, 0

    r = None
    for attempt in range(3):
        try:
            r = _supabase_session.post(
                f"{SUPABASE_URL}/rest/v1/guideline_chunks",
                headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
                json=deduped,
                timeout=90,
            )
            if r.status_code in (200, 201):
                return len(deduped), 0
            if r.status_code in (500, 502, 503, 504):
                wait = 15 * (2 ** attempt)
                log.warning("  Supabase %d on batch — retrying in %ds (attempt %d/3)",
                            r.status_code, wait, attempt + 1)
                time.sleep(wait)
                r = None
                continue
            break
        except requests.exceptions.Timeout:
            wait = 15 * (2 ** attempt)
            log.warning("  Batch write timeout — retrying in %ds (attempt %d/3)", wait, attempt + 1)
            time.sleep(wait)
            r = None

    if r is not None and r.status_code not in (200, 201):
        written = skipped = errors = 0
        for row in deduped:
            row_written = False
            for attempt in range(3):
                try:
                    r2 = _supabase_session.post(
                        f"{SUPABASE_URL}/rest/v1/guideline_chunks",
                        headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
                        json=row,
                        timeout=45,
                    )
                    if r2.status_code in (200, 201):
                        written += 1
                        row_written = True
                        break
                    elif r2.status_code == 409:
                        skipped += 1
                        row_written = True
                        break
                    elif r2.status_code in (500, 502, 503, 504):
                        wait = 10 * (2 ** attempt)
                        log.warning("  Row error %d — retrying in %ds", r2.status_code, wait)
                        time.sleep(wait)
                    else:
                        log.warning("  Row write error %d: %s", r2.status_code, r2.text[:150])
                        break
                except requests.exceptions.Timeout:
                    wait = 10 * (2 ** attempt)
                    log.warning("  Row write timeout — retrying in %ds", wait)
                    time.sleep(wait)
            if not row_written:
                errors += 1
        if skipped:
            log.debug("  %d chunks already in DB (skipped)", skipped)
        return written, errors

    log.error("  Write batch failed after 3 timeout retries — %d chunks lost", len(deduped))
    return 0, len(deduped)

def register_guideline_version(pmcid: str, title: str, year: str,
                                domain: str, chunk_count: int):
    """Update guideline_versions audit table. Non-fatal."""
    row = {
        "guideline_id":    f"pmc_{pmcid}",
        "version":         year or "unknown",
        "canonical_title": title,
        "issuing_body":    "PMC",
        "domain":          domain,
        "is_current":      True,
        "chunk_count":     chunk_count,
        "date_ingested":   datetime.now(timezone.utc).isoformat(),
    }
    try:
        r = _supabase_session.post(
            f"{SUPABASE_URL}/rest/v1/guideline_versions",
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            json=row,
            timeout=15,
        )
        if r.status_code not in (200, 201):
            log.warning("register_guideline_version HTTP %d for PMC%s: %s",
                        r.status_code, pmcid, r.text[:100])
    except Exception as exc:
        log.warning("register_guideline_version failed for PMC%s: %s", pmcid, exc)

# ── NCBI Fetch ────────────────────────────────────────────────────────────────
def esearch(term: str, max_results: int) -> tuple[list[str], int]:
    """Search PubMed for article IDs. Returns (pmid_list, total_count)."""
    term_clean = term.replace('"open access"[filter]', '"pubmed pmc"[sb]')
    pmc_filter = '"pubmed pmc"[sb]'
    if pmc_filter in term_clean:
        full_term = f'({term_clean}) AND "english"[lang]'
    else:
        full_term = f'({term_clean}) AND "english"[lang] AND {pmc_filter}'

    params = {
        "db":      "pubmed",
        "term":    full_term,
        "retmax":  max_results,
        "retmode": "json",
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    for attempt in range(4):
        try:
            time.sleep(REQUEST_DELAY)
            r = _ncbi_session.get(ESEARCH_URL, params=params, timeout=20)
            if r.status_code == 200:
                d = r.json()["esearchresult"]
                return d["idlist"], int(d["count"])
            elif r.status_code == 429:
                wait = 15 * (2 ** attempt)
                log.warning("ESearch rate-limited — waiting %ds (attempt %d/4)", wait, attempt + 1)
                time.sleep(wait)
            elif r.status_code >= 500:
                wait = 10 * (2 ** attempt)
                log.warning("ESearch %d server error — retrying in %ds (attempt %d/4)",
                            r.status_code, wait, attempt + 1)
                time.sleep(wait)
            else:
                log.error("ESearch HTTP %d: %s", r.status_code, r.text[:200])
                raise RuntimeError(f"ESearch HTTP {r.status_code}")
        except (requests.exceptions.ConnectionError,
                requests.exceptions.Timeout) as exc:
            wait = 10 * (2 ** attempt)
            log.warning("ESearch network error (attempt %d/4): %s — retrying in %ds",
                        attempt + 1, exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"ESearch failed after 4 attempts for term: {term[:80]}")

EPUBMED_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

def efetch_pubmed(pmids: list[str]) -> dict[str, dict]:
    """Fetch PubMed records. Returns {pmid: {"pmcid": str, "pub_types": list}}."""
    if not pmids:
        return {}
    params = {
        "db":      "pubmed",
        "id":      ",".join(pmids),
        "rettype": "xml",
        "retmode": "xml",
    }
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    for attempt in range(4):
        try:
            time.sleep(REQUEST_DELAY)
            r = _ncbi_session.get(EPUBMED_URL, params=params, timeout=60)
            if r.status_code == 200:
                root = etree.fromstring(r.content)
                result = {}
                for art in root.findall(".//PubmedArticle"):
                    pmid_el = art.find(".//PMID")
                    pmid = pmid_el.text if pmid_el is not None else None
                    if not pmid:
                        continue
                    pmcid = None
                    for aid in art.findall(".//ArticleId"):
                        if aid.get("IdType") == "pmc" and aid.text:
                            pmcid = aid.text.replace("PMC", "").strip()
                            break
                    pub_types = [
                        pt.text for pt in art.findall(".//PublicationType")
                        if pt.text
                    ]
                    result[pmid] = {"pmcid": pmcid, "pub_types": pub_types}
                return result
            elif r.status_code == 429:
                wait = 15 * (2 ** attempt)
                log.warning("efetch_pubmed rate-limited — waiting %ds (attempt %d/4)", wait, attempt + 1)
                time.sleep(wait)
            elif r.status_code >= 500:
                wait = 10 * (2 ** attempt)
                log.warning("efetch_pubmed HTTP %d — retrying in %ds (attempt %d/4)",
                            r.status_code, wait, attempt + 1)
                time.sleep(wait)
            else:
                log.warning("efetch_pubmed HTTP %d — non-retryable, returning empty", r.status_code)
                return {}
        except (requests.exceptions.ConnectionError,
                requests.exceptions.Timeout) as exc:
            wait = 10 * (2 ** attempt)
            log.warning("efetch_pubmed network error (attempt %d/4): %s — retrying in %ds",
                        attempt + 1, exc, wait)
            time.sleep(wait)
    log.error("efetch_pubmed failed after 4 attempts for %d PMIDs — batch skipped", len(pmids))
    return {}

def efetch(pmcid: str, retries: int = 4) -> bytes | None:
    params = {"db": "pmc", "id": pmcid, "rettype": "xml", "retmode": "xml"}
    if NCBI_API_KEY:
        params["api_key"] = NCBI_API_KEY

    for attempt in range(retries):
        try:
            time.sleep(REQUEST_DELAY)
            r = _ncbi_session.get(EFETCH_URL, params=params, timeout=45)
            if r.status_code == 200:
                if "does not allow downloading" in r.text:
                    return None
                if len(r.content) > 5_000_000:
                    log.warning("  PMC%s XML too large (%dKB) — skipping",
                                pmcid, len(r.content) // 1024)
                    return None
                return r.content
            elif r.status_code == 429:
                time.sleep(10 * (attempt + 1))
            elif r.status_code >= 500:
                wait = 5 * (2 ** attempt)
                log.warning("PMC%s efetch HTTP %d on attempt %d/%d — retrying in %ds",
                            pmcid, r.status_code, attempt + 1, retries, wait)
                time.sleep(wait)
            else:
                log.warning("PMC%s efetch HTTP %d — skipping", pmcid, r.status_code)
                return None
        except (
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.ChunkedEncodingError,
        ):
            wait = 5 * (2 ** attempt)
            log.warning("PMC%s network error on attempt %d/%d, retry in %ds",
                        pmcid, attempt + 1, retries, wait)
            time.sleep(wait)
    return None

# ── Slack Notification ────────────────────────────────────────────────────────
def notify_slack(msg: str, error: bool = False):
    if not SLACK_WEBHOOK:
        return
    emoji = "🚨" if error else "✅"
    try:
        requests.post(
            SLACK_WEBHOOK,
            json={"text": f"{emoji} _Qwiva PMC Ingest_ — {msg}"},
            timeout=10,
        )
    except Exception:
        pass

def flush_buffer(buf: list, label: str) -> int:
    """
    Embed + write a buffer of chunks. Returns count written.
    FIX: rec_counter removed from here — recommendation_id is now assigned
    in build_chunks() with a persistent counter. chunk_to_row() no longer
    needs a counter argument.
    """
    if not buf:
        return 0
    embedded = embed_chunks(buf)
    rows     = [chunk_to_row(c) for c in embedded]
    written  = errors = 0
    for b in range(0, len(rows), DB_BATCH_SIZE):
        w, e = write_batch(rows[b: b + DB_BATCH_SIZE])
        written += w
        errors  += e
    if errors:
        log.warning("  %s: %d written, %d write errors", label, written, errors)
    return written

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
def main():
    global _shutdown_requested
    start_time = datetime.now()
    log.info("=" * 60)
    log.info("QWIVA PMC OA INGESTION PIPELINE")
    log.info("Mode:     %s (%d queries active)", RUN_MODE, len(QUERIES))
    log.info("Embed:    %s (%d dims)", EMBED_MODEL, EMBED_DIM)
    log.info("LLM enrichment: disabled (run pmc_llm_enrich.py separately)")
    log.info("NCBI:     %s", "keyed (10 req/s)" if NCBI_API_KEY else "unkeyed (3 req/s)")
    log.info("Target:   %s...", SUPABASE_URL[:40])
    log.info("=" * 60)

    notify_slack(f"Ingestion started — {RUN_MODE} mode, {len(QUERIES)} queries")

    log.info("Checking existing PMC IDs in Supabase...")
    existing = get_existing_pmcids()
    log.info("  %d articles already in DB", len(existing))

    seen_pmcids: set[str]   = set(existing)
    seen_hashes: set[str]   = set()
    run_stats:   list[dict] = []

    WRITE_EVERY = 100

    for q in QUERIES:
        cp_file   = CHECKPOINT_DIR / f"{q['id']}.json"
        processed = set(json.loads(cp_file.read_text()).get("ids", [])) if cp_file.exists() else set()

        try:
            pmcids, total = esearch(q["term"], q["max"])
        except Exception as e:
            log.error("Search failed for %s: %s", q["id"], e)
            continue

        remaining = [p for p in pmcids if p not in processed]

        log.info("\n[%s]", q["label"])
        log.info("  Available: %d | Fetching: %d | New: %d", total, len(pmcids), len(remaining))

        ok = fail = skip = 0
        query_total_chunks  = 0
        query_total_written = 0
        buffer: list[Chunk] = []

        # FIX: rec_counter is now persistent across the entire query (across flush
        # cycles) so recommendation_id values never repeat within a query run.
        rec_counter: dict = {"n": 0}

        PUBMED_BATCH = 200
        pubmed_meta: dict[str, dict] = {}
        for b in range(0, len(remaining), PUBMED_BATCH):
            batch_pmids = remaining[b: b + PUBMED_BATCH]
            meta = efetch_pubmed(batch_pmids)
            pubmed_meta.update(meta)

        log.info("  PubMed metadata: %d/%d resolved", len(pubmed_meta), len(remaining))

        for idx, pmid in enumerate(remaining):
            if _shutdown_requested:
                log.warning("  Shutdown requested — stopping after %d articles", idx)
                break
            if _runtime_exceeded():
                log.warning("  Max runtime (%.0fh) reached — stopping cleanly", MAX_RUNTIME_HOURS)
                _shutdown_requested = True
                break

            meta  = pubmed_meta.get(pmid, {})
            pmcid = meta.get("pmcid")
            medline_pub_types = meta.get("pub_types", [])

            if not pmcid:
                skip += 1
                processed.add(pmid)
                continue
            if pmcid in seen_pmcids:
                skip += 1
                processed.add(pmid)
                continue

            xml = efetch(pmcid)
            if not xml:
                fail += 1
                processed.add(pmid)
                continue

            article = parse_article(xml)
            if not article or not article.get("sections"):
                fail += 1
                processed.add(pmid)
                continue

            if medline_pub_types:
                article["pub_types"] = medline_pub_types

            # FIX: pass rec_counter so IDs persist across flush cycles
            chunks = build_chunks(article, pmcid, q["id"], q["domain"], rec_counter)
            unique = [c for c in chunks if c.content_hash not in seen_hashes]
            for c in unique:
                seen_hashes.add(c.content_hash)

            if unique:
                buffer.extend(unique)
                seen_pmcids.add(pmcid)
                ok += 1
            processed.add(pmid)

            if (idx + 1) % 20 == 0:
                log.info("  [%d/%d] %d buffered, %d ok, %d fail",
                         idx + 1, len(remaining), len(buffer), ok, fail)

            if ok > 0 and ok % WRITE_EVERY == 0:
                log.info("  Flushing %d chunks to Supabase...", len(buffer))
                written = flush_buffer(buffer, f"[{idx+1}/{len(remaining)}]")
                query_total_chunks  += len(buffer)
                query_total_written += written
                buffer = []
                tmp = cp_file.with_suffix(".tmp")
                tmp.write_text(json.dumps({"ids": list(processed)}))
                tmp.replace(cp_file)

        if buffer:
            log.info("  Final flush — %d chunks...", len(buffer))
            written = flush_buffer(buffer, "final")
            query_total_chunks  += len(buffer)
            query_total_written += written
            buffer = []

        cp_file.write_text(json.dumps({"ids": list(processed)}))
        log.info("  Done — %d articles, %d chunks, %d written, %d failed",
                 ok, query_total_chunks, query_total_written, fail)

        run_stats.append({
            "query":    q["label"],
            "articles": ok,
            "chunks":   query_total_chunks,
            "written":  query_total_written,
            "failed":   fail,
            "embedded": query_total_written,
        })

    elapsed           = int((datetime.now() - start_time).total_seconds() // 60)
    total_run_chunks  = sum(s["chunks"]  for s in run_stats)
    total_run_written = sum(s["written"] for s in run_stats)
    total_run_failed  = sum(s.get("failed", 0) for s in run_stats)

    log.info("\n%s", "=" * 60)
    log.info("INGESTION COMPLETE")
    log.info("%s", "=" * 60)
    log.info("  Total articles:   %d", sum(s["articles"] for s in run_stats))
    log.info("  Total chunks:     %d", total_run_chunks)
    log.info("  Written:          %d", total_run_written)
    log.info("  recommendation_text: run pmc_llm_enrich.py to populate")
    log.info("  Elapsed:          %d minutes", elapsed)
    log.info("\n  BY QUERY:")
    for s in run_stats:
        log.info("    %-45s %4d art  %6d chunks  %6d written",
                 s["query"][:45], s["articles"], s["chunks"], s["written"])

    notify_slack(
        f"Ingestion complete — {total_run_written:,} chunks written, "
        f"{total_run_failed:,} failed, {elapsed} min",
        error=total_run_failed > 0,
    )

    log.info("\n  VERIFY IN SUPABASE:")
    log.info("  SELECT domain, count(*), sum(case when embedding is not null then 1 else 0 end) embedded")
    log.info("  FROM guideline_chunks")
    log.info("  GROUP BY domain ORDER BY count DESC;")

if __name__ == "__main__":
    main()
