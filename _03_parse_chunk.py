#!/usr/bin/env python3
"""
03_parse_chunk.py — Stage 3: Parse, Chunk & Contextualize
===========================================================
Reads stored files from Supabase Storage, parses into sections,
chunks with section boundary awareness, generates contextual_text
headers via Claude Haiku, and inserts into clinical_practice_guideline_chunks.

Transitions: stored → parsed → chunked

Run:
    python 03_parse_chunk.py --source nice
    python 03_parse_chunk.py --source moh_kenya
    python 03_parse_chunk.py --source all
    python 03_parse_chunk.py --retry-failed
"""

import argparse
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import anthropic
import tiktoken
from bs4 import BeautifulSoup, Tag

from config import (
    SOURCES, ANTHROPIC_API_KEY, CONTEXT_MODEL, CONTEXT_MAX_TOKENS,
    CHUNK_TARGET_TOKENS, CHUNK_MAX_TOKENS, CHUNK_OVERLAP_TOKENS,
    MIN_CONFIDENCE_SCORE, CHUNK_TYPE_SIGNALS, GRADE_MAP,
    EMBEDDING_MODEL,
)
from db import (
    get_client, CorpusDocuments, CorpusStorage, GuidelineChunks,
    sha256_str, sha256_content,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("parse_chunk")

# tiktoken encoder for cl100k_base (used by text-embedding-3-large)
TOKENIZER = tiktoken.get_encoding("cl100k_base")


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class Section:
    """A structural section extracted from a guideline document."""
    heading:    str
    level:      int           # 1=h1, 2=h2, 3=h3, etc.
    text:       str
    page_start: Optional[int] = None
    page_end:   Optional[int] = None


@dataclass
class Chunk:
    """A single chunk ready for embedding and insertion."""
    content:         str
    section_heading: str
    section_path:    list[str]
    section_depth:   int
    chunk_type:      str
    page_start:      Optional[int] = None
    page_end:        Optional[int] = None
    recommendation_id:   Optional[str] = None
    recommendation_text: Optional[str] = None
    grade_symbol:        Optional[str] = None
    grade_strength:      Optional[str] = None
    grade_direction:     Optional[str] = None
    grade_evidence_quality: Optional[str] = None
    has_recommendation:  bool = False
    has_dosage:          bool = False
    drug_names:          list[str] = field(default_factory=list)
    population_tags:     list[str] = field(default_factory=list)
    intervention_tags:   list[str] = field(default_factory=list)
    condition_tags:      list[str] = field(default_factory=list)


# ── Tokenizer utilities ───────────────────────────────────────────────────────

def count_tokens(text: str) -> int:
    return len(TOKENIZER.encode(text))


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    tokens = TOKENIZER.encode(text)
    if len(tokens) <= max_tokens:
        return text
    return TOKENIZER.decode(tokens[:max_tokens])


# ── NICE HTML Parser ──────────────────────────────────────────────────────────
#
# NICE guidelines use semantic HTML with a predictable structure:
#   <h2> = chapter/section heading
#   <h3> = subsection heading
#   <p class="recommendation"> or data-testid="recommendation" = rec statement
#   <p> = body text
#   <table> = tables
#   Recommendation grades appear as <span class="grade"> or similar

def parse_nice_html(html_bytes: bytes) -> list[Section]:
    """
    Parse NICE guidance HTML into a list of Sections.
    Preserves heading hierarchy for section_path construction.
    """
    soup = BeautifulSoup(html_bytes, "lxml")
    sections: list[Section] = []

    # Remove navigation, footer, header noise
    for tag in soup.find_all(["nav", "footer", "header", "aside",
                               "script", "style", "noscript"]):
        tag.decompose()

    # NICE uses <div class="content"> or <main> as the content root
    content_root = (
        soup.find("main") or
        soup.find("div", class_="content") or
        soup.find("div", id="main-content") or
        soup.body
    )

    if not content_root:
        logger.warning("Could not find content root in NICE HTML")
        return []

    current_heading = "Introduction"
    current_level   = 1
    current_texts: list[str] = []

    def flush_section():
        nonlocal current_texts
        text = "\n\n".join(t for t in current_texts if t.strip())
        if text.strip():
            sections.append(Section(
                heading = current_heading,
                level   = current_level,
                text    = text,
            ))
        current_texts = []

    for element in content_root.descendants:
        if not isinstance(element, Tag):
            continue

        tag_name = element.name.lower() if element.name else ""

        # Heading → new section boundary
        if tag_name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            flush_section()
            current_heading = element.get_text(separator=" ", strip=True)
            current_level   = int(tag_name[1])
            continue

        # Table → treat as atomic chunk
        if tag_name == "table":
            table_text = _table_to_text(element)
            if table_text:
                current_texts.append(f"[TABLE]\n{table_text}")
            continue

        # Paragraph or list item
        if tag_name in ("p", "li"):
            text = element.get_text(separator=" ", strip=True)
            if text and len(text) > 20:   # skip navigation/button text
                current_texts.append(text)

    flush_section()
    return sections


def _table_to_text(table_tag: Tag) -> str:
    """Convert an HTML table to pipe-delimited text."""
    rows = []
    for tr in table_tag.find_all("tr"):
        cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
        rows.append(" | ".join(cells))
    return "\n".join(rows)


# ── PDF Parser (MOH Kenya) ────────────────────────────────────────────────────
#
# Uses pymupdf (fitz) for layout-aware text extraction.
# Detects headings by font size comparison against body text baseline.

def parse_pdf(pdf_bytes: bytes) -> list[Section]:
    """
    Parse a PDF into sections using pymupdf.
    Heading detection: text blocks significantly larger than body font = heading.
    """
    try:
        import fitz   # pymupdf
    except ImportError:
        logger.error("pymupdf not installed. Run: pip install pymupdf")
        return []

    sections: list[Section] = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # First pass: determine body font size baseline
    font_sizes: list[float] = []
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if span["text"].strip():
                        font_sizes.append(span["size"])

    if not font_sizes:
        return []

    # Body text = most common font size (mode)
    from collections import Counter
    body_size = Counter(round(s) for s in font_sizes).most_common(1)[0][0]
    heading_threshold = body_size * 1.2    # 20% larger = heading

    current_heading  = "Introduction"
    current_level    = 1
    current_texts: list[str] = []
    current_page_start: Optional[int] = None
    current_page     = 0

    def flush_section():
        text = "\n\n".join(t for t in current_texts if t.strip())
        if text.strip():
            sections.append(Section(
                heading    = current_heading,
                level      = current_level,
                text       = text,
                page_start = current_page_start,
                page_end   = current_page,
            ))

    for page_num, page in enumerate(doc, 1):
        blocks = page.get_text("dict")["blocks"]

        for block in blocks:
            if block.get("type") != 0:   # skip images
                continue

            lines = block.get("lines", [])
            if not lines:
                continue

            # Get dominant font size for this block
            sizes = []
            text_parts = []
            for line in lines:
                for span in line.get("spans", []):
                    if span["text"].strip():
                        sizes.append(span["size"])
                        text_parts.append(span["text"])

            if not sizes:
                continue

            block_text = " ".join(text_parts).strip()
            if not block_text or len(block_text) < 3:
                continue

            avg_size = sum(sizes) / len(sizes)
            is_heading = avg_size >= heading_threshold and len(block_text) < 200

            if is_heading:
                flush_section()
                current_heading  = block_text
                current_level    = _estimate_heading_level(avg_size, body_size)
                current_texts    = []
                current_page_start = page_num
            else:
                if current_page_start is None:
                    current_page_start = page_num
                current_texts.append(block_text)
                current_page = page_num

    flush_section()
    doc.close()
    return sections


def _estimate_heading_level(font_size: float, body_size: float) -> int:
    ratio = font_size / body_size
    if ratio >= 1.8:   return 1
    if ratio >= 1.5:   return 2
    if ratio >= 1.2:   return 3
    return 4


# ── NICE JSON bundle parser ───────────────────────────────────────────────────
#
# Stage 2 stores NICE guidelines as a JSON bundle:
# {
#   "guidance_id": "NG28",
#   "title": "...",
#   "pub_year": 2015,
#   "chapters": [
#     { "slug": "Blood-glucose-management", "title": "...", "html": "<main>..." },
#     ...
#   ]
# }
#
# NICE heading structure (verified from live pages):
#   <h1> = guideline title (skip — same on every chapter)
#   <h2> = chapter heading  (level 1 in our section model)
#   <h3> = subsection       (level 2)
#   <h4> = sub-subsection   (level 3)
#   <h5> = individual recommendation number (e.g. "1.5.1") (level 4)
#   <p>  = recommendation text / rationale / body

def _parse_chapter_html(chapter_html: str, chapter_title: str) -> list[Section]:
    """
    Parse a single NICE chapter HTML string into Sections.
    Each heading transition creates a new section boundary.
    """
    soup = BeautifulSoup(chapter_html, "lxml")
    sections: list[Section] = []

    # Remove any residual noise
    for tag in soup.find_all(["nav", "aside", "script", "style",
                               "noscript", "header", "footer", "button"]):
        tag.decompose()

    content_root = soup.find("main") or soup.find("div", id="main-content") or soup.body
    if not content_root:
        return []

    current_heading = chapter_title
    current_level   = 2        # chapters are level 2 in NICE structure
    current_texts: list[str] = []

    def flush():
        nonlocal current_texts
        text = "\n\n".join(t for t in current_texts if t.strip())
        if text.strip():
            sections.append(Section(
                heading = current_heading,
                level   = current_level,
                text    = text,
            ))
        current_texts = []

    for element in content_root.descendants:
        if not isinstance(element, Tag):
            continue

        tag_name = element.name.lower() if element.name else ""

        if tag_name == "h1":
            # Skip h1 — it's just the guideline title repeated on every chapter
            continue

        if tag_name in ("h2", "h3", "h4", "h5", "h6"):
            flush()
            current_heading = element.get_text(separator=" ", strip=True)
            current_level   = int(tag_name[1])
            continue

        if tag_name == "table":
            table_text = _table_to_text(element)
            if table_text:
                current_texts.append(f"[TABLE]\n{table_text}")
            continue

        if tag_name in ("p", "li"):
            # Skip if this element is a descendant of a heading we already processed
            if element.find_parent(["h1","h2","h3","h4","h5","h6"]):
                continue
            text = element.get_text(separator=" ", strip=True)
            if text and len(text) > 20:
                current_texts.append(text)

    flush()
    return sections


def parse_nice_json_bundle(raw_bytes: bytes) -> list[Section]:
    """
    Parse a NICE JSON bundle (produced by Stage 2) into Sections.
    Iterates through all chapters in order, parsing each chapter's HTML.
    """
    import json as _json
    try:
        bundle = _json.loads(raw_bytes.decode("utf-8"))
    except Exception as e:
        logger.error("Failed to parse JSON bundle: %s", e)
        return []

    chapters = bundle.get("chapters", [])
    if not chapters:
        logger.warning("JSON bundle has no chapters: %s", bundle.get("guidance_id"))
        return []

    all_sections: list[Section] = []
    for ch in chapters:
        html    = ch.get("html", "")
        title   = ch.get("title", ch.get("slug", "Chapter"))
        if not html:
            continue
        sections = _parse_chapter_html(html, title)
        all_sections.extend(sections)
        logger.debug("Chapter '%s': %d sections", title, len(sections))

    logger.info("JSON bundle: %d chapters → %d sections total",
                len(chapters), len(all_sections))
    return all_sections


# ── Parser router ─────────────────────────────────────────────────────────────

def parse_document(raw_bytes: bytes, content_type: str, source_id: str) -> list[Section]:
    # NICE stores JSON bundles from Stage 2
    if "json" in content_type or (source_id == "nice" and raw_bytes[:1] == b"{"):
        return parse_nice_json_bundle(raw_bytes)
    elif "html" in content_type:
        return parse_nice_html(raw_bytes)
    elif "pdf" in content_type or source_id == "moh_kenya":
        return parse_pdf(raw_bytes)
    else:
        logger.warning("Unknown content type '%s' for source '%s'", content_type, source_id)
        # Try JSON first as a fallback for NICE
        if source_id == "nice":
            return parse_nice_json_bundle(raw_bytes)
        return parse_nice_html(raw_bytes)


# ── Section-aware chunker ─────────────────────────────────────────────────────

def sections_to_chunks(sections: list[Section]) -> list[Chunk]:
    """
    Convert parsed sections into chunks.

    Rules:
    1. Never split mid-sentence.
    2. Tables are always a single atomic chunk regardless of size.
    3. If a section exceeds CHUNK_MAX_TOKENS, split at paragraph boundaries
       with CHUNK_OVERLAP_TOKENS overlap.
    4. Sections below MIN_CONFIDENCE threshold are dropped.
    5. Build section_path breadcrumb from heading hierarchy.
    """
    chunks: list[Chunk] = []

    # Build section path stack [h1_heading, h2_heading, h3_heading, ...]
    heading_stack: list[tuple[int, str]] = []   # (level, heading_text)

    for section in sections:
        # Maintain heading stack for breadcrumb
        heading_stack = [
            (lvl, h) for lvl, h in heading_stack
            if lvl < section.level
        ]
        heading_stack.append((section.level, section.heading))
        section_path = [h for _, h in heading_stack]

        # Tables: always one atomic chunk
        if section.text.startswith("[TABLE]"):
            table_text = section.text[8:]   # strip [TABLE]\n prefix
            chunk = _make_chunk(
                content      = table_text,
                section      = section,
                section_path = section_path,
                chunk_type   = "table",
            )
            if chunk:
                chunks.append(chunk)
            continue

        # Split section text into paragraphs
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", section.text) if p.strip()]

        # Group paragraphs into chunks respecting token limits
        current_paras: list[str] = []
        current_tokens = 0

        for para in paragraphs:
            para_tokens = count_tokens(para)

            # Paragraph itself exceeds max — split at sentence level
            if para_tokens > CHUNK_MAX_TOKENS:
                # Flush current before split paragraph
                if current_paras:
                    chunk = _make_chunk(
                        content      = "\n\n".join(current_paras),
                        section      = section,
                        section_path = section_path,
                    )
                    if chunk:
                        chunks.append(chunk)
                current_paras  = []
                current_tokens = 0

                for sentence_chunk in _split_at_sentences(para):
                    chunk = _make_chunk(
                        content      = sentence_chunk,
                        section      = section,
                        section_path = section_path,
                    )
                    if chunk:
                        chunks.append(chunk)
                continue

            # Adding this paragraph would exceed target → flush and start new chunk
            if current_tokens + para_tokens > CHUNK_TARGET_TOKENS and current_paras:
                chunk = _make_chunk(
                    content      = "\n\n".join(current_paras),
                    section      = section,
                    section_path = section_path,
                )
                if chunk:
                    chunks.append(chunk)

                # Overlap: carry last N tokens from previous chunk
                overlap_text = _get_overlap(current_paras)
                current_paras  = [overlap_text, para] if overlap_text else [para]
                current_tokens = count_tokens("\n\n".join(current_paras))
            else:
                current_paras.append(para)
                current_tokens += para_tokens

        # Flush remainder
        if current_paras:
            chunk = _make_chunk(
                content      = "\n\n".join(current_paras),
                section      = section,
                section_path = section_path,
            )
            if chunk:
                chunks.append(chunk)

    return chunks


def _make_chunk(
    content: str,
    section: Section,
    section_path: list[str],
    chunk_type: Optional[str] = None,
) -> Optional[Chunk]:
    """Build a Chunk from content, inferring metadata."""
    content = content.strip()
    if not content:
        return None

    tokens = count_tokens(content)

    # Confidence score — discard very short/noisy chunks
    confidence = _compute_confidence(content, tokens)
    if confidence < MIN_CONFIDENCE_SCORE:
        return None

    # Classify chunk type
    inferred_type = chunk_type or _classify_chunk_type(content, section.heading)

    # Extract recommendation metadata
    rec_id, rec_text, grade_symbol = _extract_recommendation_fields(content)
    grade_fields = _parse_grade(grade_symbol) if grade_symbol else {}

    # Boolean flags
    has_rec    = inferred_type in ("recommendation", "practice_point")
    has_dosage = _has_dosage_signal(content)

    # Simple PICO tag extraction
    drug_names = _extract_drug_names(content)

    return Chunk(
        content             = content,
        section_heading     = section.heading,
        section_path        = section_path,
        section_depth       = section.level,
        chunk_type          = inferred_type,
        page_start          = section.page_start,
        page_end            = section.page_end,
        recommendation_id   = rec_id,
        recommendation_text = rec_text,
        grade_symbol        = grade_symbol,
        grade_strength      = grade_fields.get("grade_strength"),
        grade_direction     = grade_fields.get("grade_direction"),
        grade_evidence_quality = grade_fields.get("grade_evidence_quality"),
        has_recommendation  = has_rec,
        has_dosage          = has_dosage,
        drug_names          = drug_names,
    )


def _split_at_sentences(text: str) -> list[str]:
    """Split text at sentence boundaries, respecting CHUNK_MAX_TOKENS."""
    sentences = re.split(r'(?<=[.!?])\s+', text)
    result: list[str] = []
    current_sents: list[str] = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = count_tokens(sent)
        if current_tokens + sent_tokens > CHUNK_MAX_TOKENS and current_sents:
            result.append(" ".join(current_sents))
            current_sents  = [sent]
            current_tokens = sent_tokens
        else:
            current_sents.append(sent)
            current_tokens += sent_tokens

    if current_sents:
        result.append(" ".join(current_sents))

    return result


def _get_overlap(paragraphs: list[str]) -> str:
    """Return the last CHUNK_OVERLAP_TOKENS of content for chunk overlap."""
    combined = "\n\n".join(paragraphs)
    tokens   = TOKENIZER.encode(combined)
    if len(tokens) <= CHUNK_OVERLAP_TOKENS:
        return combined
    overlap_tokens = tokens[-CHUNK_OVERLAP_TOKENS:]
    return TOKENIZER.decode(overlap_tokens)


def _compute_confidence(content: str, tokens: int) -> float:
    """
    Heuristic confidence score 0.0–1.0.
    Combines: token length, sentence completeness, clinical signal density.
    """
    # Length score
    if tokens < 20:    length_score = 0.1
    elif tokens < 50:  length_score = 0.5
    elif tokens < 400: length_score = 1.0
    else:              length_score = 0.8   # very long chunks are less precise

    # Sentence completeness: ends with punctuation?
    completeness = 1.0 if content.rstrip()[-1] in ".!?):" else 0.7

    # Clinical signal density: contains clinical keywords
    clinical_keywords = [
        "recommend", "suggest", "evidence", "treatment", "therapy",
        "patient", "clinical", "diagnosis", "monitor", "dose", "mg",
        "risk", "guideline", "standard", "protocol",
    ]
    content_lower = content.lower()
    signal_count  = sum(1 for kw in clinical_keywords if kw in content_lower)
    signal_score  = min(1.0, signal_count / 3)

    return (length_score * 0.5) + (completeness * 0.2) + (signal_score * 0.3)


def _classify_chunk_type(content: str, heading: str) -> str:
    """Classify chunk type from content and heading text."""
    combined = (content + " " + heading).lower()
    for keywords, chunk_type in CHUNK_TYPE_SIGNALS:
        if any(kw in combined for kw in keywords):
            return chunk_type
    return "background"


def _extract_recommendation_fields(
    content: str,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Extract recommendation_id, recommendation_text, and grade_symbol
    from a chunk's content.

    Patterns:
    - ADA:   "9.3a Empagliflozin is recommended... A"
    - KDIGO: "3.6.1 We recommend... (1B)"
    - NICE:  "We recommend..." with [Strong] or [Conditional] nearby
    """
    rec_id  = None
    rec_text = None
    grade    = None

    # KDIGO / numbered recommendation pattern: "1.2.3 We recommend..."
    m = re.match(r"^(\d+(?:\.\d+){1,3}[a-z]?)\s+(.+?)[\s.]+\(([12][ABCD])\)", content, re.I)
    if m:
        rec_id   = m.group(1)
        rec_text = m.group(2).strip()
        grade    = m.group(3).lower()
        return rec_id, rec_text, grade

    # ADA pattern: "9.3a Recommendation text A"  (letter grade at end of sentence)
    m = re.match(r"^(\d+\.\d+[a-z]?)\s+(.+)\s+([ABCE])$", content.strip(), re.I | re.S)
    if m:
        rec_id   = m.group(1)
        rec_text = m.group(2).strip()
        grade    = m.group(3).lower()
        return rec_id, rec_text, grade

    # NICE pattern: "Strong" or "Conditional" in brackets
    m = re.search(r"\[(strong|conditional)\]", content, re.I)
    if m:
        grade = m.group(1).lower()

    # Simple numbered rec: "R12" or "Recommendation 5"
    m = re.match(r"^(R\d+|Recommendation\s+\d+)[:\s]+(.+)", content, re.I | re.S)
    if m:
        rec_id   = m.group(1)
        rec_text = m.group(2).strip()[:500]

    return rec_id, rec_text, grade


def _parse_grade(grade_symbol: str) -> dict:
    symbol = grade_symbol.lower().strip()
    return GRADE_MAP.get(symbol, {})


def _has_dosage_signal(content: str) -> bool:
    dosage_patterns = [
        r"\d+\s*mg", r"\d+\s*mcg", r"\d+\s*μg",
        r"\d+\s*mg/kg", r"\d+\s*mg/day", r"\d+\s*units",
        r"once daily", r"twice daily", r"three times",
        r"oral dose", r"iv dose", r"loading dose",
    ]
    return any(re.search(p, content, re.I) for p in dosage_patterns)


# Common drug name fragments for basic extraction
DRUG_FRAGMENTS = [
    "metformin", "empagliflozin", "dapagliflozin", "canagliflozin",
    "sitagliptin", "glipizide", "glibenclamide", "insulin",
    "atorvastatin", "rosuvastatin", "aspirin", "warfarin",
    "furosemide", "spironolactone", "amlodipine", "lisinopril",
    "enalapril", "losartan", "ramipril", "bisoprolol",
    "tenofovir", "lamivudine", "efavirenz", "dolutegravir",
    "nevirapine", "lopinavir", "ritonavir", "atazanavir",
    "artemether", "lumefantrine", "quinine", "coartem",
    "amoxicillin", "azithromycin", "doxycycline", "cotrimoxazole",
    "prednisolone", "dexamethasone", "hydrocortisone",
]


def _extract_drug_names(content: str) -> list[str]:
    content_lower = content.lower()
    return [drug for drug in DRUG_FRAGMENTS if drug in content_lower]


# ── Contextual text generation (Claude Haiku) ─────────────────────────────────

def generate_context_header(
    client: anthropic.Anthropic,
    chunk: Chunk,
    doc_metadata: dict,
) -> str:
    """
    Generate a 1-2 sentence clinical context header via Claude Haiku.
    This is prepended to content to form contextual_text for embedding.
    Falls back to a template if the LLM call fails.
    """
    prompt = f"""You are a medical knowledge engineer preparing clinical guideline text for embedding in a RAG system.

Generate a concise 1-2 sentence context header for this chunk. The header should:
- State which guideline and section this chunk comes from
- Capture the clinical topic so the embedding retrieves it for relevant queries
- Be under 50 words
- NOT repeat the chunk content verbatim

Guideline: {doc_metadata.get('guideline_title', 'Unknown')}
Issuing body: {doc_metadata.get('issuing_body_canonical', 'Unknown')}
Year: {doc_metadata.get('pub_year', 'Unknown')}
Section: {chunk.section_heading}
Chunk type: {chunk.chunk_type}

Chunk content:
{truncate_to_tokens(chunk.content, 300)}

Respond with ONLY the context header text. No preamble, no quotes."""

    try:
        resp = client.messages.create(
            model      = CONTEXT_MODEL,
            max_tokens = CONTEXT_MAX_TOKENS,
            messages   = [{"role": "user", "content": prompt}],
        )
        header = resp.content[0].text.strip()
        return header
    except Exception as e:
        logger.warning("Context header LLM call failed: %s — using template", e)
        return _template_context_header(chunk, doc_metadata)


def _template_context_header(chunk: Chunk, doc_metadata: dict) -> str:
    """Fallback template context header when LLM call fails."""
    body      = doc_metadata.get("issuing_body_canonical", "")
    title     = doc_metadata.get("guideline_title", "clinical guideline")
    year      = doc_metadata.get("pub_year", "")
    section   = chunk.section_heading
    year_str  = f" ({year})" if year else ""

    return (
        f"From {body}{year_str} {title}, section: {section}. "
        f"Content type: {chunk.chunk_type.replace('_', ' ')}."
    )


# ── Main processing ───────────────────────────────────────────────────────────

def process_document(
    doc: dict,
    corpus: CorpusDocuments,
    storage: CorpusStorage,
    chunks_db: GuidelineChunks,
    ai_client: anthropic.Anthropic,
) -> bool:
    doc_id     = doc["id"]
    source_id  = doc["source_id"]
    title      = doc.get("guideline_title", "Unknown")

    logger.info("Parsing: %s [%s]", title[:70], doc_id[:12])

    # ── Download from Supabase Storage ───────────────────────────────────────
    storage_path = doc.get("storage_path")
    if not storage_path:
        corpus.mark_failed(doc_id, "parse", "No storage_path found")
        return False

    try:
        raw_bytes = storage.download(storage_path)
    except Exception as e:
        corpus.mark_failed(doc_id, "parse", f"Storage download failed: {e}")
        return False

    content_type = doc.get("content_type", "text/html")

    # ── Parse into sections ───────────────────────────────────────────────────
    try:
        sections = parse_document(raw_bytes, content_type, source_id)
    except Exception as e:
        corpus.mark_failed(doc_id, "parse", f"Parse error: {e}")
        return False

    if not sections:
        corpus.mark_failed(doc_id, "parse", "No sections extracted")
        return False

    logger.info("Extracted %d sections from %s", len(sections), title[:60])

    # Update domain if we have better info from parsed content
    corpus.mark_parsed(
        doc_id,
        guideline_title = doc.get("guideline_title", title),
        pub_year        = doc.get("pub_year"),
        domain          = doc.get("domain"),
    )

    # ── Chunk ─────────────────────────────────────────────────────────────────
    try:
        chunks = sections_to_chunks(sections)
    except Exception as e:
        corpus.mark_failed(doc_id, "chunk", f"Chunking error: {e}")
        return False

    if not chunks:
        corpus.mark_failed(doc_id, "chunk", "No chunks produced")
        return False

    logger.info("Produced %d chunks from %s", len(chunks), title[:60])

    # ── Delete old chunks for this doc (re-ingest) ────────────────────────────
    existing_count = chunks_db.count_by_doc_id(doc_id)
    if existing_count > 0:
        logger.info("Replacing %d existing chunks for doc_id %s", existing_count, doc_id[:12])
        chunks_db.delete_by_doc_id(doc_id)

    # ── Build rows for insertion ──────────────────────────────────────────────
    total_tokens = 0
    rows: list[dict] = []

    for idx, chunk in enumerate(chunks):
        content_tokens = count_tokens(chunk.content)
        total_tokens  += content_tokens

        # Generate contextual_text (LLM call with template fallback)
        context_header   = generate_context_header(ai_client, chunk, doc)
        contextual_text  = f"{context_header}\n\n{chunk.content}"

        row = {
            # Identity
            "doc_id":                 doc_id,
            "file_hash":              doc.get("file_hash", ""),
            "content_hash":           sha256_content(chunk.content),
            "chunk_index":            idx,
            "chunk_total":            len(chunks),

            # Content
            "content":                chunk.content,
            "contextual_text":        contextual_text,
            "content_tokens":         content_tokens,
            "word_count":             len(chunk.content.split()),

            # Embedding (populated in Stage 4)
            "embedding":              None,
            "embedding_model":        EMBEDDING_MODEL,

            # Citation fields
            "guideline_title":        doc.get("guideline_title", ""),
            "issuing_body":           doc.get("issuing_body"),
            "issuing_body_canonical": doc.get("issuing_body_canonical", ""),
            "pub_year":               doc.get("pub_year"),
            "date_published":         doc.get("date_published"),
            "page_start":             chunk.page_start,
            "page_end":               chunk.page_end,
            "authors":                doc.get("authors"),
            "source_url":             doc.get("source_url"),
            "doi":                    doc.get("doi"),
            "licence":                doc.get("licence"),

            # Classification
            "domain":                 doc.get("domain", "general_medicine"),
            "geographic_scope":       doc.get("geographic_scope", "global"),
            "document_type":          doc.get("document_type", "guideline"),
            "evidence_framework":     doc.get("evidence_framework"),

            # Version lifecycle
            "guideline_version":      doc.get("guideline_version"),
            "is_current_version":     True,
            "superseded_by":          None,

            # Structural position
            "chapter_title":          chunk.section_path[0] if chunk.section_path else None,
            "chapter_detection_method": "heading_h1" if chunk.section_depth == 1 else "heading_h2",
            "section_path":           chunk.section_path,
            "section_depth":          chunk.section_depth,

            # Chunk type
            "chunk_type":             chunk.chunk_type,

            # Recommendation fields
            "recommendation_id":      chunk.recommendation_id,
            "recommendation_text":    chunk.recommendation_text,

            # Grade fields
            "grade_strength":         chunk.grade_strength,
            "grade_direction":        chunk.grade_direction,
            "grade_evidence_quality": chunk.grade_evidence_quality,
            "grade_symbol":           chunk.grade_symbol,

            # Ranking signals
            "evidence_tier":          _infer_evidence_tier(chunk),
            "authority_rank":         doc.get("authority_rank",
                                         SOURCES[source_id].authority_rank),
            "confidence_score":       _compute_confidence(chunk.content, content_tokens),

            # PICO tags
            "population_tags":        chunk.population_tags,
            "intervention_tags":      chunk.intervention_tags,
            "condition_tags":         chunk.condition_tags,
            "drug_names":             chunk.drug_names,

            # Boolean flags
            "has_recommendation":     chunk.has_recommendation,
            "has_dosage":             chunk.has_dosage,
        }
        rows.append(row)

    # ── Batch insert ──────────────────────────────────────────────────────────
    try:
        BATCH_SIZE = 100
        total_inserted = 0
        for i in range(0, len(rows), BATCH_SIZE):
            batch = rows[i:i + BATCH_SIZE]
            total_inserted += chunks_db.insert_batch(batch)
            logger.debug("Inserted batch %d-%d", i, i + len(batch))

        corpus.mark_chunked(doc_id, len(rows), total_tokens)
        logger.info("Chunked %s: %d chunks, %d tokens", title[:60], len(rows), total_tokens)
        return True

    except Exception as e:
        corpus.mark_failed(doc_id, "insert", str(e))
        return False


def _infer_evidence_tier(chunk: Chunk) -> Optional[int]:
    content_lower = chunk.content.lower()
    if any(kw in content_lower for kw in ["randomized", "rct", "systematic review", "meta-analysis"]):
        return 1
    if any(kw in content_lower for kw in ["cohort", "observational", "registry", "case-control"]):
        return 2
    if chunk.chunk_type in ("practice_point", "background"):
        return 3
    return None


# ── Entry point ───────────────────────────────────────────────────────────────

def run_parse_chunk(
    source_id: Optional[str] = None,
    retry_failed: bool = False,
) -> None:
    db_client  = get_client()
    corpus     = CorpusDocuments(db_client)
    storage    = CorpusStorage(db_client)
    chunks_db  = GuidelineChunks(db_client)
    ai_client  = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    sources = [source_id] if source_id else list(SOURCES.keys())
    docs = []

    for src in sources:
        docs += corpus.get_by_status("stored", src)
        if retry_failed:
            docs += [d for d in corpus.get_failed(src)
                     if d.get("failed_stage") in ("parse", "chunk", "insert")]

    if not docs:
        logger.info("No documents to parse.")
        return

    logger.info("Parsing %d documents", len(docs))
    success = fail = 0

    for i, doc in enumerate(docs, 1):
        logger.info("[%d/%d]", i, len(docs))
        ok = process_document(doc, corpus, storage, chunks_db, ai_client)
        if ok:
            success += 1
        else:
            fail += 1

    logger.info("Parse & chunk complete — success=%d failed=%d", success, fail)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPG Pipeline — Stage 3: Parse & Chunk")
    parser.add_argument("--source", choices=list(SOURCES.keys()) + ["all"], default="all")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--log-level", default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()
    logging.getLogger().setLevel(args.log_level)

    source = None if args.source == "all" else args.source
    run_parse_chunk(source_id=source, retry_failed=args.retry_failed)
