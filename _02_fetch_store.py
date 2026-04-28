#!/usr/bin/env python3
"""
02_fetch_store.py — Stage 2: Fetch & Store
============================================
Fetches raw content for all 'discovered' documents and archives to Supabase Storage.

NICE strategy (verified from live testing):
  - Fetch guidance landing page → extract pub_year + all chapter URLs
  - Fetch each chapter HTML individually (~10-27 chapters per guideline)
  - Bundle into a single JSON file:
      { guidance_id, title, pub_year, chapters: [{slug, title, html}] }
  - Store JSON bundle to Supabase Storage as application/json
  - Parser (Stage 3) processes this JSON — no re-fetching needed

MOH Kenya strategy:
  - Direct PDF download → store as application/pdf

Uses ETags / Last-Modified for conditional GETs on recrawls.
Transitions: discovered → fetched → stored

Run:
    python 02_fetch_store.py --source nice
    python 02_fetch_store.py --source moh_kenya
    python 02_fetch_store.py --source all
    python 02_fetch_store.py --retry-failed
"""

import argparse
import json
import logging
import re
import time
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from config import (
    SOURCES, REQUEST_TIMEOUT_S, REQUEST_DELAY_S, REQUEST_RETRY_MAX,
)
from db import (
    get_client, CorpusDocuments, CorpusStorage,
    sha256_bytes,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("fetch_store")


# ── HTTP client ───────────────────────────────────────────────────────────────

def make_http_client() -> httpx.Client:
    return httpx.Client(
        timeout=REQUEST_TIMEOUT_S,
        follow_redirects=True,
        headers={
            "User-Agent": "Qwiva-CPG-Pipeline/1.0 (clinical decision support; contact@qwiva.com)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )


# ── Generic fetch with retry + conditional GET ────────────────────────────────

def fetch_url(
    client: httpx.Client,
    url: str,
    etag: Optional[str] = None,
    last_modified: Optional[str] = None,
) -> Optional[dict]:
    """
    Fetch a URL. Supports conditional GET via ETag / Last-Modified.
    Returns None on 304 (not modified).
    Raises on permanent errors (404, 410, 403) and exhausted retries.
    """
    headers = {}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified

    for attempt in range(1, REQUEST_RETRY_MAX + 1):
        try:
            resp = client.get(url, headers=headers)

            if resp.status_code == 304:
                return None

            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "").split(";")[0].strip()
            return {
                "data":          resp.content,
                "content_type":  content_type or _guess_content_type(url),
                "file_size":     len(resp.content),
                "http_status":   resp.status_code,
                "etag":          resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
            }

        except httpx.HTTPStatusError as e:
            if e.response.status_code in (404, 410, 403):
                raise
            if attempt == REQUEST_RETRY_MAX:
                raise
            wait = 2 ** attempt
            logger.warning("HTTP %s attempt %d/%d — retrying in %ds",
                           e.response.status_code, attempt, REQUEST_RETRY_MAX, wait)
            time.sleep(wait)

        except httpx.RequestError as e:
            if attempt == REQUEST_RETRY_MAX:
                raise
            logger.warning("Request error attempt %d/%d: %s", attempt, REQUEST_RETRY_MAX, e)
            time.sleep(2 ** attempt)


def _guess_content_type(url: str) -> str:
    lower = url.lower()
    if lower.endswith(".pdf"):  return "application/pdf"
    if lower.endswith(".html"): return "text/html"
    if lower.endswith(".json"): return "application/json"
    return "application/octet-stream"


# ── NICE fetch strategy ───────────────────────────────────────────────────────

PUB_YEAR_RE     = re.compile(r"Published[:\s]+\d+\s+\w+\s+(\d{4})", re.I)
UPDATED_YEAR_RE = re.compile(r"Last\s+updated[:\s]+\d+\s+\w+\s+(\d{4})", re.I)


def _extract_chapter_urls(soup: BeautifulSoup, guidance_id: str) -> list[dict]:
    """Extract ordered chapter URLs from a NICE guidance landing page."""
    pattern = re.compile(rf"/guidance/{re.escape(guidance_id)}/chapter/", re.I)
    seen: set[str] = set()
    chapters = []

    for a in soup.find_all("a", href=pattern):
        href = a["href"]
        if not href.startswith("http"):
            href = f"https://www.nice.org.uk{href}"
        clean = href.split("?")[0].split("#")[0]
        if clean in seen:
            continue
        seen.add(clean)
        slug  = clean.split("/chapter/")[-1]
        title = a.get_text(separator=" ", strip=True)
        chapters.append({"slug": slug, "title": title, "url": clean})

    return chapters


def _clean_chapter_html(soup: BeautifulSoup) -> str:
    """
    Extract and clean main content HTML from a NICE chapter page.

    NOTE: do NOT remove 'page-header' class elements.
    Testing showed page-header removal wiped the entire content area on
    NG guidelines. The page-header div only contains the guideline title
    and metadata — safe to keep, and needed for some content structures.
    """
    main = (
        soup.find("main") or
        soup.find("div", id="main-content") or
        soup.find("div", class_="content") or
        soup.body
    )
    if not main:
        return ""

    # Remove chrome/noise — NOT page-header
    for tag in main.find_all([
        "nav", "aside", "script", "style", "noscript",
        "header", "footer", "form", "button",
    ]):
        tag.decompose()

    # EXACT class name matching — NOT regex/substring.
    # Using regex would remove js-in-page-nav-target (contains "in-page-nav")
    # which is the main content wrapper for NICE recommendations.
    for cls_name in ["breadcrumbs", "share-links", "in-page-nav",
                     "local-header", "sticky-header", "feedback", "print-link"]:
        for el in main.find_all(class_=cls_name):
            el.decompose()

    return str(main)


def _is_js_rendered(html: str) -> bool:
    """
    Returns True if a chapter page has no useful static content.
    TA/HTG pages render via JavaScript — paragraphs with real text will be absent.
    Threshold: fewer than 3 paragraphs with >50 chars of text.
    """
    soup = BeautifulSoup(html, "lxml")
    cr = soup.find("main") or soup.body
    if not cr:
        return True
    paras = [p for p in cr.find_all("p") if len(p.get_text(strip=True)) > 50]
    return len(paras) < 3


def _extract_pdf_url(soup: BeautifulSoup, guidance_id: str) -> str | None:
    """Extract the PDF download URL from a NICE guidance landing page."""
    # Primary: specific guidance PDF resource link
    pdf_pattern = re.compile(rf"/guidance/{re.escape(guidance_id)}/resources/.*pdf-\d+", re.I)
    link = soup.find("a", href=pdf_pattern)
    if link:
        href = link["href"]
        return f"https://www.nice.org.uk{href}" if href.startswith("/") else href
    # Fallback: any PDF resource link
    link = soup.find("a", href=re.compile(r"/resources/.*pdf-\d+", re.I))
    if link:
        href = link["href"]
        return f"https://www.nice.org.uk{href}" if href.startswith("/") else href
    return None


def fetch_nice_guideline(client: httpx.Client, doc: dict) -> Optional[dict]:
    """
    Fetch all chapters for a NICE guideline and return a JSON bundle.

    1. GET landing page → pub_year, last_updated_year, chapter URLs
    2. GET each chapter → clean HTML
    3. Bundle all into JSON
    """
    source_url  = doc["source_url"]
    guidance_id = doc.get("guideline_version", "")

    # Step 1 — Landing page
    logger.debug("Landing page: %s", source_url)
    landing = fetch_url(
        client, source_url,
        etag=doc.get("http_etag"),
        last_modified=doc.get("http_last_modified"),
    )

    if landing is None:
        return None     # 304 not modified

    soup      = BeautifulSoup(landing["data"], "lxml")
    page_text = soup.get_text()

    # Extract years
    pub_year          = None
    last_updated_year = None
    m = PUB_YEAR_RE.search(page_text)
    if m:
        pub_year = int(m.group(1))
    m = UPDATED_YEAR_RE.search(page_text)
    if m:
        last_updated_year = int(m.group(1))
    effective_year = last_updated_year or pub_year

    # Extract clean title
    title_tag  = soup.find("title")
    page_title = doc.get("guideline_title", "")
    if title_tag and "|" in (title_tag.string or ""):
        parts = title_tag.string.split("|")
        if len(parts) >= 2:
            page_title = parts[1].strip()

    # Step 2 — Chapter URLs
    chapters_meta = _extract_chapter_urls(soup, guidance_id)
    logger.info("%s — %d chapters to fetch (pub: %s, updated: %s)",
                guidance_id, len(chapters_meta), pub_year, last_updated_year)

    if not chapters_meta:
        # No chapters found — store landing page HTML as single chapter
        logger.warning("%s: no chapters found, storing overview only", guidance_id)
        main_html = _clean_chapter_html(soup)
        bundle = {
            "source":            "nice",
            "guidance_id":       guidance_id,
            "title":             page_title,
            "pub_year":          pub_year,
            "last_updated_year": last_updated_year,
            "source_url":        source_url,
            "total_chapters":    1,
            "chapters_fetched":  1,
            "chapters_failed":   0,
            "chapters":          [{"slug": "overview", "title": "Overview", "html": main_html}],
        }
        json_bytes = json.dumps(bundle, ensure_ascii=False).encode("utf-8")
        return {
            "data":          json_bytes,
            "content_type":  "application/json",
            "file_size":     len(json_bytes),
            "http_status":   landing["http_status"],
            "etag":          landing["etag"],
            "last_modified": landing["last_modified"],
            "pub_year":      effective_year,
        }

    # Step 3 — Fetch each chapter
    fetched_chapters = []
    failed_chapters  = 0

    for i, ch in enumerate(chapters_meta, 1):
        try:
            r = fetch_url(client, ch["url"])
            if r is None:
                logger.debug("Chapter 304 (unchanged): %s", ch["slug"])
                continue

            ch_soup    = BeautifulSoup(r["data"], "lxml")
            clean_html = _clean_chapter_html(ch_soup)

            if clean_html:
                fetched_chapters.append({
                    "slug":  ch["slug"],
                    "title": ch["title"],
                    "url":   ch["url"],
                    "html":  clean_html,
                })
                logger.debug("  [%d/%d] %s (%d chars)",
                             i, len(chapters_meta), ch["slug"], len(clean_html))
            else:
                logger.warning("Empty chapter: %s", ch["slug"])
                failed_chapters += 1

        except Exception as e:
            logger.warning("Chapter fetch failed [%s]: %s", ch["slug"], e)
            failed_chapters += 1

        time.sleep(REQUEST_DELAY_S)

    if not fetched_chapters:
        raise RuntimeError(
            f"All {len(chapters_meta)} chapters failed for {guidance_id}"
        )

    # ── JS-rendered detection ─────────────────────────────────────────────────
    # TA/HTG/QS pages render their content via JavaScript.
    # If most chapters have no useful text, fall back to the PDF download.
    js_rendered_count = sum(1 for ch in fetched_chapters if _is_js_rendered(ch["html"]))
    js_rendered_ratio = js_rendered_count / len(fetched_chapters)

    if js_rendered_ratio > 0.7:
        logger.warning(
            "%s: %d/%d chapters appear JS-rendered (%.0f%%) — falling back to PDF",
            guidance_id, js_rendered_count, len(fetched_chapters), js_rendered_ratio * 100,
        )
        pdf_url = _extract_pdf_url(soup, guidance_id)
        if pdf_url:
            try:
                pdf_result = fetch_url(client, pdf_url)
                if pdf_result and len(pdf_result["data"]) > 10_000:
                    logger.info("%s: PDF fallback successful (%.1f KB)",
                                guidance_id, len(pdf_result["data"]) / 1024)
                    return {
                        "data":          pdf_result["data"],
                        "content_type":  "application/pdf",
                        "file_size":     len(pdf_result["data"]),
                        "http_status":   pdf_result["http_status"],
                        "etag":          pdf_result.get("etag"),
                        "last_modified": pdf_result.get("last_modified"),
                        "pub_year":      effective_year,
                    }
            except Exception as e:
                logger.warning("%s: PDF fallback failed: %s — continuing with HTML", guidance_id, e)

    if failed_chapters:
        logger.warning("%s: %d/%d chapters failed",
                       guidance_id, failed_chapters, len(chapters_meta))

    # Step 4 — Build JSON bundle
    bundle = {
        "source":            "nice",
        "guidance_id":       guidance_id,
        "title":             page_title,
        "pub_year":          pub_year,
        "last_updated_year": last_updated_year,
        "source_url":        source_url,
        "total_chapters":    len(chapters_meta),
        "chapters_fetched":  len(fetched_chapters),
        "chapters_failed":   failed_chapters,
        "chapters":          fetched_chapters,
    }

    json_bytes = json.dumps(bundle, ensure_ascii=False).encode("utf-8")
    logger.info("%s: stored %d chapters → %.1f KB",
                guidance_id, len(fetched_chapters), len(json_bytes) / 1024)

    return {
        "data":          json_bytes,
        "content_type":  "application/json",
        "file_size":     len(json_bytes),
        "http_status":   landing["http_status"],
        "etag":          landing["etag"],
        "last_modified": landing["last_modified"],
        "pub_year":      effective_year,
    }


# ── MOH Kenya fetch strategy ──────────────────────────────────────────────────

def fetch_moh_pdf(client: httpx.Client, doc: dict) -> Optional[dict]:
    """Direct PDF download."""
    return fetch_url(
        client, doc["source_url"],
        etag=doc.get("http_etag"),
        last_modified=doc.get("http_last_modified"),
    )


# ── Fetch router ──────────────────────────────────────────────────────────────

FETCH_FUNCTIONS = {
    "nice":      fetch_nice_guideline,
    "moh_kenya": fetch_moh_pdf,
}


# ── Document processor ────────────────────────────────────────────────────────

def process_document(
    doc: dict,
    http: httpx.Client,
    corpus: CorpusDocuments,
    storage: CorpusStorage,
) -> bool:
    doc_id    = doc["id"]
    source_id = doc["source_id"]
    title     = doc.get("guideline_title", doc["source_url"])[:70]

    fetch_fn = FETCH_FUNCTIONS.get(source_id)
    if not fetch_fn:
        logger.error("No fetch function for source '%s'", source_id)
        return False

    # Fetch
    try:
        result = fetch_fn(http, doc)
    except Exception as e:
        corpus.mark_failed(doc_id, "fetch", str(e))
        return False

    # 304 Not Modified
    if result is None:
        corpus.mark_skipped(doc_id)
        logger.info("Skipped (unchanged): %s", title)
        return True

    raw_data     = result["data"]
    content_type = result["content_type"]
    file_hash    = sha256_bytes(raw_data)

    # Dedup — skip if same file already complete
    if corpus.file_hash_exists(file_hash):
        corpus.mark_skipped(doc_id)
        logger.info("Skipped (hash match): %s", title)
        return True

    # Mark fetched (+ update pub_year if NICE extracted it)
    corpus.mark_fetched(
        doc_id,
        file_hash     = file_hash,
        http_status   = result["http_status"],
        etag          = result.get("etag"),
        last_modified = result.get("last_modified"),
        content_type  = content_type,
        file_size     = result["file_size"],
    )
    if result.get("pub_year"):
        corpus.update_status(doc_id, "fetched", pub_year=result["pub_year"])

    # Store to Supabase Storage
    try:
        storage_path = storage.upload(source_id, doc_id, raw_data, content_type)
        corpus.mark_stored(doc_id, storage_path)
        logger.info("✓ Stored [%s]: %s (%.1f KB)",
                    source_id, title, result["file_size"] / 1024)
        return True
    except Exception as e:
        corpus.mark_failed(doc_id, "store", str(e))
        return False


# ── Runner ────────────────────────────────────────────────────────────────────

def run_fetch_store(
    source_id: Optional[str] = None,
    retry_failed: bool = False,
) -> None:
    db_client = get_client()
    corpus    = CorpusDocuments(db_client)
    storage   = CorpusStorage(db_client)

    sources = [source_id] if source_id else list(SOURCES.keys())
    docs    = []

    for src in sources:
        docs += corpus.get_by_status("discovered", src)
        if retry_failed:
            docs += corpus.get_failed(src)

    if not docs:
        logger.info("No documents to process.")
        return

    logger.info("Processing %d documents", len(docs))
    success = fail = skipped = 0

    with make_http_client() as http:
        for i, doc in enumerate(docs, 1):
            logger.info("[%d/%d] %s", i, len(docs),
                        doc.get("guideline_title", doc["source_url"])[:70])
            ok = process_document(doc, http, corpus, storage)
            if ok:
                current = corpus.get_by_id(doc["id"])
                if current and current.get("pipeline_status") == "skipped":
                    skipped += 1
                else:
                    success += 1
            else:
                fail += 1

    logger.info("Fetch & store complete — success=%d skipped=%d failed=%d",
                success, skipped, fail)

    for src in sources:
        logger.info("Status [%s]: %s", src, corpus.count_by_source(src))


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPG Pipeline — Stage 2: Fetch & Store")
    parser.add_argument(
        "--source",
        choices=list(SOURCES.keys()) + ["all"],
        default="all",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()
    logging.getLogger().setLevel(args.log_level)

    source = None if args.source == "all" else args.source
    run_fetch_store(source_id=source, retry_failed=args.retry_failed)
