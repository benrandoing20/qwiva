"""
Standalone retrieval diagnostic — runs a query through the full pipeline
and shows per-stage chunk counts + doc_types without generating an answer.

Usage:
    python scripts/test_retrieval.py "pharmacokinetics of cyclophosphamide"
    python scripts/test_retrieval.py "amoxicillin dosing pneumonia" --top-k 20
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter

from dotenv import load_dotenv

load_dotenv(dotenv_path=".env")


async def test(query: str, top_k: int) -> None:
    import logging
    logging.basicConfig(level=logging.WARNING, format="%(message)s")

    from backend.config import get_settings
    from backend.rag import QwivaRAG

    settings = get_settings()
    rag = QwivaRAG(settings)

    print(f"\nQuery: {query!r}")
    print(f"Settings: retrieval_top_k={settings.retrieval_top_k}  rerank_top_n={settings.rerank_top_n}  enable_drug_retrieval={settings.enable_drug_retrieval}")
    print("-" * 70)

    # 1. Embed
    embedding = await rag._embed(query)
    print(f"Embedding: {len(embedding)}-dim vector ✓")

    # 2. Qdrant
    if settings.qdrant_url:
        qdrant_chunks = await rag._qdrant_search(embedding)
        q_counts = Counter(c.doc_type for c in qdrant_chunks)
        print(f"\nQdrant ({len(qdrant_chunks)} chunks): {dict(q_counts)}")
        for c in qdrant_chunks[:3]:
            print(f"  [{c.doc_type}] {c.guideline_title[:60]} | chunk_index={c.chunk_index}")
    else:
        print("\nQdrant: not configured (QDRANT_URL not set)")
        qdrant_chunks = []

    # 3. FTS
    fts_chunks = await rag._fts_search(query)
    f_counts = Counter(c.doc_type for c in fts_chunks)
    print(f"\nFTS ({len(fts_chunks)} chunks): {dict(f_counts)}")
    for c in fts_chunks[:3]:
        print(f"  [{c.doc_type}] {c.guideline_title[:60]} | chunk_index={c.chunk_index}")

    # 4. RRF merge
    from backend.rag import _rrf_merge
    merged = _rrf_merge(qdrant_chunks, fts_chunks, settings.rrf_k, top_k or settings.retrieval_top_k)
    m_counts = Counter(c.doc_type for c in merged)
    print(f"\nAfter RRF ({len(merged)} chunks): {dict(m_counts)}")

    # 5. Rerank
    reranked = await rag._rerank(query, merged)
    r_counts = Counter(c.doc_type for c in reranked)
    print(f"\nAfter Rerank ({len(reranked)} chunks): {dict(r_counts)}")
    print()
    for i, c in enumerate(reranked, 1):
        print(f"  [{i}] [{c.doc_type}] {c.guideline_title[:65]}")
        print(f"       section={c.cascading_path[:50] or '—'}  year={c.year or '—'}")
        if c.source_url:
            print(f"       url={c.source_url[:80]}")

    print()
    if not any(c.doc_type == "drug" for c in reranked):
        if any(c.doc_type == "drug" for c in merged):
            print("⚠  Drug chunks reached RRF but were dropped by the reranker — consider raising RERANK_TOP_N")
        elif any(c.doc_type == "drug" for c in qdrant_chunks):
            print("⚠  Drug chunks found in Qdrant but dropped before reranking — check RRF merge")
        elif any(c.doc_type == "drug" for c in fts_chunks):
            print("⚠  Drug chunks found in FTS but not in Qdrant results")
        else:
            print("⚠  No drug chunks at any stage — drug content may not exist for this query in the dataset")
    else:
        print("✓  Drug chunks present in final reranked set")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test retrieval pipeline for a query")
    parser.add_argument("query", help="The clinical query to test")
    parser.add_argument("--top-k", type=int, default=0, help="Override retrieval_top_k for RRF (default: use config)")
    args = parser.parse_args()
    asyncio.run(test(args.query, args.top_k))
