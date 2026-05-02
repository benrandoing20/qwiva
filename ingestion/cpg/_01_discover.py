#!/usr/bin/env python3
"""
01_discover.py — Stage 1: Discovery
=====================================
Hits the NICE API and MOH Kenya website to discover guideline URLs.
Writes one row per discovered document to corpus_documents
with pipeline_status = 'discovered'.

Run:
    python 01_discover.py --source nice
    python 01_discover.py --source moh_kenya
    python 01_discover.py --source all

Safe to re-run: upsert on canonical_url means existing rows are untouched.
"""

import argparse
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Iterator

import httpx
from bs4 import BeautifulSoup

from config import (
    SOURCES, REQUEST_TIMEOUT_S, REQUEST_DELAY_S, REQUEST_RETRY_MAX,
    SourceConfig,
)
from db import (
    get_client, CorpusDocuments,
    sha256_str, normalise_url,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("discover")


# ── HTTP client ───────────────────────────────────────────────────────────────

def make_http_client() -> httpx.Client:
    return httpx.Client(
        timeout=REQUEST_TIMEOUT_S,
        follow_redirects=True,
        headers={"User-Agent": "Qwiva-CPG-Pipeline/1.0 (clinical decision support; contact@qwiva.com)"},
    )


def fetch_with_retry(client: httpx.Client, url: str) -> httpx.Response:
    for attempt in range(1, REQUEST_RETRY_MAX + 1):
        try:
            resp = client.get(url)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise   # no point retrying
            if attempt == REQUEST_RETRY_MAX:
                raise
            wait = 2 ** attempt
            logger.warning("HTTP %s on attempt %d/%d, retrying in %ds",
                           e.response.status_code, attempt, REQUEST_RETRY_MAX, wait)
            time.sleep(wait)
        except httpx.RequestError as e:
            if attempt == REQUEST_RETRY_MAX:
                raise
            logger.warning("Request error on attempt %d/%d: %s", attempt, REQUEST_RETRY_MAX, e)
            time.sleep(2 ** attempt)


# ── NICE Discovery ────────────────────────────────────────────────────────────
#
# Crawls the NICE published guidance index (no API key required):
#   https://www.nice.org.uk/guidance/published?page=1
#
# Each page lists guidance items with title, type, date, and link.
# We paginate until no "next page" link is found.

import re as _re


def _map_domain_from_nice(item: dict, domain_map: dict) -> str:
    """
    Map a NICE guidance item to a canonical domain.
    Tries therapeuticArea first, then title keywords.
    Falls back to 'general_medicine'.
    """
    areas = item.get("therapeuticArea", [])
    if isinstance(areas, str):
        areas = [areas]
    for area in areas:
        area_lower = area.lower()
        for keyword, domain in domain_map.items():
            if keyword in area_lower:
                return domain

    title = item.get("title", "").lower()
    for keyword, domain in domain_map.items():
        if keyword in title:
            return domain

    return "general_medicine"


def discover_nice(
    config: SourceConfig,
    client: httpx.Client,
) -> Iterator[dict]:
    """
    Crawl NICE published guidance index (no API key needed).

    Verified from live testing:
    - Guidelines render inside <td> elements, not <li> or <article>
    - Pagination uses ?pa=N (NOT ?page=N — that param does nothing)
    - "Next page" link text points to ?pa=N+1
    - Real guidance IDs: ng|ta|qs|csg|mpg|ipg|dg|ph|sc|mtg|es|hte|htg + digits
    - ~10 guidelines per page, ~255 pages (~2500 guidelines total)
    """
    # Whitelist regex — only real guidance IDs get through
    GUIDANCE_RE = _re.compile(
        r"/guidance/(ng|ta|qs|csg|mpg|ipg|dg|ph|sc|mtg|es|hte|htg)(\d+)$",
        _re.IGNORECASE,
    )

    current_url   = config.base_url
    page_num      = 0
    seen_urls: set[str] = set()

    while current_url:
        page_num += 1
        logger.info("NICE page %d: %s", page_num, current_url)

        try:
            resp = fetch_with_retry(client, current_url)
        except Exception as e:
            logger.error("Failed to fetch NICE page %d: %s", page_num, e)
            break

        soup = BeautifulSoup(resp.text, "lxml")
        page_found = 0

        # Target links whose href matches a real guidance ID — works regardless
        # of surrounding markup (table, list, div — NICE has changed this over time)
        for link in soup.find_all("a", href=GUIDANCE_RE):
            href = link["href"].strip()
            if not href.startswith("http"):
                href = f"https://www.nice.org.uk{href}"

            if href in seen_urls:
                continue
            seen_urls.add(href)

            match    = GUIDANCE_RE.search(href)
            prefix   = match.group(1).upper()
            number   = match.group(2)
            version  = f"{prefix}{number}"

            title = link.get_text(separator=" ", strip=True)
            if not title or len(title) < 5:
                continue

            canonical = normalise_url(href)
            doc_id    = sha256_str(canonical)
            domain    = _map_domain_from_nice({"title": title}, config.domain_map)

            page_found += 1
            yield {
                "id":                     doc_id,
                "source_id":              config.source_id,
                "issuing_body_canonical": config.issuing_body_canonical,
                "issuing_body":           "National Institute for Health and Care Excellence",
                "source_url":             href,
                "canonical_url":          canonical,
                "guideline_title":        title,
                "guideline_version":      version,
                "pub_year":               None,   # extracted in parse stage from guideline page
                "domain":                 domain,
                "geographic_scope":       config.geographic_scope,
                "document_type":          config.document_type,
                "licence":                config.licence,
                "pipeline_status":        "discovered",
                "first_seen_at":          datetime.now(timezone.utc).isoformat(),
                "next_check_at":          (
                    datetime.now(timezone.utc) + timedelta(days=config.recrawl_days)
                ).isoformat(),
                "is_current_version":     True,
                "retry_count":            0,
            }

        logger.info("Page %d: %d new guidelines (running total: %d)",
                    page_num, page_found, len(seen_urls))

        # Follow the actual "Next page" href — NICE paginates via ?pa=N
        # Never increment manually — always follow the link
        next_link = (
            soup.find("a", string=_re.compile(r"next page", _re.I)) or
            soup.find("a", attrs={"rel": "next"}) or
            soup.select_one(".pagination__item--bookend:last-child a")
        )

        if next_link and next_link.get("href"):
            next_href   = next_link["href"]
            current_url = (
                f"https://www.nice.org.uk{next_href}"
                if next_href.startswith("/") else next_href
            )
        else:
            logger.info("NICE discovery complete — %d total guidelines", len(seen_urls))
            current_url = None

        time.sleep(REQUEST_DELAY_S)


# ── MOH Kenya Discovery ───────────────────────────────────────────────────────
#
# MOH Kenya publishes guidelines at https://www.health.go.ke/guidelines/
# The page contains links to PDF files. We crawl the listing page(s) and
# extract all PDF links.
#
# Additional sources for Kenyan guidelines:
#   NASCOP:   https://www.nascop.or.ke/guidelines/
#   KEPI:     https://www.kepi.go.ke/resources/guidelines/

MOH_KENYA_PDF_SOURCES = [
    "https://www.health.go.ke/guidelines/",
    "https://www.nascop.or.ke/guidelines/",
]


def _map_domain_from_title(title: str, domain_map: dict) -> str:
    title_lower = title.lower()
    for keyword, domain in domain_map.items():
        if keyword in title_lower:
            return domain
    return "general_medicine"


def discover_moh_kenya(
    config: SourceConfig,
    client: httpx.Client,
    seed_urls: list[str] = MOH_KENYA_PDF_SOURCES,
) -> Iterator[dict]:
    """
    Crawl MOH Kenya and NASCOP listing pages.
    Yield corpus_documents rows for all discovered PDF links.
    """
    for seed_url in seed_urls:
        logger.info("Crawling: %s", seed_url)

        try:
            resp = fetch_with_retry(client, seed_url)
        except Exception as e:
            logger.error("Failed to crawl %s: %s", seed_url, e)
            continue

        soup = BeautifulSoup(resp.text, "lxml")
        base = seed_url.rsplit("/", 1)[0]

        # Extract all links to PDF files
        links = soup.find_all("a", href=True)
        found = 0

        for link in links:
            href = link["href"].strip()

            # Resolve relative URLs
            if href.startswith("http"):
                pdf_url = href
            elif href.startswith("/"):
                from urllib.parse import urlparse
                parsed = urlparse(seed_url)
                pdf_url = f"{parsed.scheme}://{parsed.netloc}{href}"
            else:
                pdf_url = f"{base}/{href}"

            # Only process PDF links
            if not pdf_url.lower().endswith(".pdf"):
                continue

            canonical = normalise_url(pdf_url)
            doc_id    = sha256_str(canonical)

            # Extract title from link text, clean it up
            title = link.get_text(strip=True)
            if not title or len(title) < 5:
                # Fall back to filename
                title = pdf_url.split("/")[-1].replace(".pdf", "").replace("-", " ").replace("_", " ").title()

            domain = _map_domain_from_title(title, config.domain_map)

            # Determine issuing body from URL
            if "nascop" in pdf_url.lower():
                issuing_body = "NASCOP (National AIDS & STI Control Programme)"
                issuing_body_canonical = "NASCOP"
            else:
                issuing_body = "Kenya Ministry of Health"
                issuing_body_canonical = "MOH Kenya"

            found += 1
            yield {
                "id":                     doc_id,
                "source_id":              config.source_id,
                "issuing_body_canonical": issuing_body_canonical,
                "issuing_body":           issuing_body,
                "source_url":             pdf_url,
                "canonical_url":          canonical,
                "guideline_title":        title,
                "domain":                 domain,
                "geographic_scope":       config.geographic_scope,
                "document_type":          config.document_type,
                "licence":                config.licence,
                "pipeline_status":        "discovered",
                "first_seen_at":          datetime.now(timezone.utc).isoformat(),
                "next_check_at":          (
                    datetime.now(timezone.utc) + timedelta(days=config.recrawl_days)
                ).isoformat(),
                "is_current_version":     True,
                "retry_count":            0,
            }

        logger.info("Found %d PDFs on %s", found, seed_url)
        time.sleep(REQUEST_DELAY_S)


# ── Discovery router ──────────────────────────────────────────────────────────

DISCOVERY_FUNCTIONS = {
    "nice":      discover_nice,
    "moh_kenya": discover_moh_kenya,
}


def run_discovery(source_id: str) -> None:
    config = SOURCES[source_id]
    fn     = DISCOVERY_FUNCTIONS[source_id]

    db_client = get_client()
    corpus    = CorpusDocuments(db_client)

    inserted  = 0
    skipped   = 0
    errors    = 0

    with make_http_client() as http:
        for doc in fn(config, http):
            try:
                result = corpus.upsert_discovered(doc)
                if result and result.get("pipeline_status") == "discovered":
                    inserted += 1
                else:
                    skipped += 1
            except Exception as e:
                logger.error("Failed to upsert %s: %s", doc.get("canonical_url"), e)
                errors += 1

    logger.info(
        "Discovery complete — source=%s inserted=%d skipped=%d errors=%d",
        source_id, inserted, skipped, errors,
    )

    # Print status summary
    counts = corpus.count_by_source(source_id)
    logger.info("Status summary for %s: %s", source_id, counts)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPG Pipeline — Stage 1: Discovery")
    parser.add_argument(
        "--source",
        choices=list(SOURCES.keys()) + ["all"],
        default="all",
        help="Which source to discover (default: all)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args()

    logging.getLogger().setLevel(args.log_level)

    sources_to_run = list(SOURCES.keys()) if args.source == "all" else [args.source]

    for source_id in sources_to_run:
        if source_id not in DISCOVERY_FUNCTIONS:
            logger.warning("No discovery function for source '%s', skipping", source_id)
            continue
        logger.info("=" * 60)
        logger.info("Starting discovery: %s", source_id)
        logger.info("=" * 60)
        run_discovery(source_id)
