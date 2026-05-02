#!/usr/bin/env python3
"""
04_embed_insert.py — Stage 4: Embed
=====================================
Generates embeddings for all unembedded chunks (embedding IS NULL)
for documents in 'chunked' status.
Transitions: chunked → embedded → complete

Run:
    python 04_embed_insert.py --source nice
    python 04_embed_insert.py --source all
    python 04_embed_insert.py --retry-failed
"""

import argparse
import logging
import time
from typing import Optional

import openai

from config import (
    SOURCES, OPENAI_API_KEY,
    EMBEDDING_MODEL, EMBEDDING_DIMS, EMBEDDING_BATCH_SIZE,
)
from db import get_client, CorpusDocuments, GuidelineChunks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("embed")

openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Call OpenAI text-embedding-3-large with MRL truncation to 1536 dims.
    Returns list of embedding vectors in same order as input texts.
    Retries on rate limit / transient errors.
    """
    MAX_RETRIES = 5
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = openai_client.embeddings.create(
                model      = EMBEDDING_MODEL,
                input      = texts,
                dimensions = EMBEDDING_DIMS,
            )
            # Sort by index to guarantee order (OpenAI may return out of order)
            sorted_data = sorted(response.data, key=lambda d: d.index)
            return [d.embedding for d in sorted_data]

        except openai.RateLimitError:
            wait = 2 ** attempt
            logger.warning("Rate limit hit on attempt %d, waiting %ds", attempt, wait)
            time.sleep(wait)

        except openai.APIError as e:
            if attempt == MAX_RETRIES:
                raise
            logger.warning("OpenAI API error attempt %d: %s", attempt, e)
            time.sleep(2 ** attempt)

    raise RuntimeError("Embedding failed after max retries")


# ── Main processing ───────────────────────────────────────────────────────────

def process_document(
    doc: dict,
    corpus: CorpusDocuments,
    chunks_db: GuidelineChunks,
) -> bool:
    doc_id = doc["id"]
    title  = doc.get("guideline_title", doc_id[:12])

    # Get all unembedded chunks for this document
    unembedded = chunks_db.get_unembedded(doc_id)

    if not unembedded:
        logger.info("No unembedded chunks for %s — marking complete", title[:60])
        corpus.mark_complete(doc_id)
        return True

    logger.info("Embedding %d chunks for: %s", len(unembedded), title[:60])

    try:
        # Process in batches
        total_embedded = 0

        for batch_start in range(0, len(unembedded), EMBEDDING_BATCH_SIZE):
            batch = unembedded[batch_start:batch_start + EMBEDDING_BATCH_SIZE]
            texts = [row["contextual_text"] for row in batch]

            embeddings = embed_texts(texts)

            updates = [
                {"id": row["id"], "embedding": emb}
                for row, emb in zip(batch, embeddings)
            ]
            chunks_db.update_embeddings_batch(updates)

            total_embedded += len(batch)
            logger.info(
                "Embedded %d/%d chunks for %s",
                total_embedded, len(unembedded), title[:50],
            )

            # Brief pause to respect rate limits
            time.sleep(0.1)

        corpus.mark_embedded(doc_id)
        corpus.mark_complete(doc_id)
        logger.info("Complete: %s (%d chunks embedded)", title[:60], total_embedded)
        return True

    except Exception as e:
        corpus.mark_failed(doc_id, "embed", str(e))
        logger.error("Embedding failed for %s: %s", title[:60], e)
        return False


def run_embed(
    source_id: Optional[str] = None,
    retry_failed: bool = False,
) -> None:
    db_client = get_client()
    corpus    = CorpusDocuments(db_client)
    chunks_db = GuidelineChunks(db_client)

    sources = [source_id] if source_id else list(SOURCES.keys())
    docs = []

    for src in sources:
        docs += corpus.get_by_status("chunked", src)
        if retry_failed:
            docs += [d for d in corpus.get_failed(src)
                     if d.get("failed_stage") == "embed"]

    if not docs:
        logger.info("No documents to embed.")
        return

    logger.info("Embedding %d documents", len(docs))
    success = fail = 0

    for i, doc in enumerate(docs, 1):
        logger.info("[%d/%d] %s", i, len(docs), doc.get("guideline_title", "")[:70])
        ok = process_document(doc, corpus, chunks_db)
        if ok:
            success += 1
        else:
            fail += 1

    logger.info("Embed complete — success=%d failed=%d", success, fail)

    # Final summary per source
    for src in sources:
        counts = corpus.count_by_source(src)
        logger.info("Final status [%s]: %s", src, counts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPG Pipeline — Stage 4: Embed")
    parser.add_argument("--source", choices=list(SOURCES.keys()) + ["all"], default="all")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--log-level", default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()
    logging.getLogger().setLevel(args.log_level)

    source = None if args.source == "all" else args.source
    run_embed(source_id=source, retry_failed=args.retry_failed)
