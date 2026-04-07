import time
import traceback
from dataclasses import dataclass

from backend.rag import _build_citations, rag


@dataclass
class PipelineResult:
    question: str
    retrieved_chunks: list  # list[Chunk]
    reranked_chunks: list  # list[Chunk]
    answer: str
    citations: list  # list[Citation]
    contexts: list[str]  # chunk content strings (for RAGAS)
    # Latencies in ms
    classify_ms: float = 0.0
    embed_ms: float = 0.0
    retrieval_ms: float = 0.0
    rerank_ms: float = 0.0
    ttft_ms: float = 0.0
    total_generation_ms: float = 0.0
    total_ms: float = 0.0
    error: str | None = None


async def run_question(question: str) -> PipelineResult:
    t_start = time.perf_counter()
    classify_ms = embed_ms = retrieval_ms = rerank_ms = ttft_ms = total_generation_ms = 0.0
    chunks: list = []
    reranked: list = []
    try:
        # 0. Routing (classify) — latency measurement only; result discarded
        t = time.perf_counter()
        try:
            await rag.classify(question, [])
            classify_ms = (time.perf_counter() - t) * 1000
        except Exception:
            classify_ms = 0.0  # rate-limited or unavailable; don't fail the question

        # 1. Embed
        t = time.perf_counter()
        embedding = await rag._embed(question)
        embed_ms = (time.perf_counter() - t) * 1000

        # 2. Hybrid search
        t = time.perf_counter()
        chunks = await rag._hybrid_search(question, embedding)
        retrieval_ms = (time.perf_counter() - t) * 1000

        # 3. Rerank
        t = time.perf_counter()
        reranked = await rag._rerank(question, chunks)
        rerank_ms = (time.perf_counter() - t) * 1000

        # 4. Generate (capture TTFT + full answer)
        t = time.perf_counter()
        _ttft_ms = None
        tokens = []
        async for token in rag._generate_stream(question, reranked):
            if _ttft_ms is None:
                _ttft_ms = (time.perf_counter() - t) * 1000
            tokens.append(token)
        ttft_ms = _ttft_ms or 0.0
        total_generation_ms = (time.perf_counter() - t) * 1000

        answer = "".join(tokens)
        citations = _build_citations(reranked)
        total_ms = (time.perf_counter() - t_start) * 1000

        return PipelineResult(
            question=question,
            retrieved_chunks=chunks,
            reranked_chunks=reranked,
            answer=answer,
            citations=citations,
            contexts=[c.content for c in reranked],
            classify_ms=classify_ms,
            embed_ms=embed_ms,
            retrieval_ms=retrieval_ms,
            rerank_ms=rerank_ms,
            ttft_ms=ttft_ms,
            total_generation_ms=total_generation_ms,
            total_ms=total_ms,
        )
    except Exception:
        return PipelineResult(
            question=question,
            retrieved_chunks=chunks,
            reranked_chunks=reranked,
            answer="",
            citations=[],
            contexts=[],
            classify_ms=classify_ms,
            embed_ms=embed_ms,
            retrieval_ms=retrieval_ms,
            rerank_ms=rerank_ms,
            ttft_ms=ttft_ms,
            total_generation_ms=total_generation_ms,
            total_ms=(time.perf_counter() - t_start) * 1000,
            error=traceback.format_exc(),
        )
