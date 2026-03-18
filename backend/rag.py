"""
Core RAG pipeline for Qwiva clinical search.

Pipeline (per query):
  1. Embed query          → text-embedding-3-small via NVIDIA hub
  2. Parallel retrieval   → vector search + full-text search via Supabase
  3. Merge & deduplicate  → Reciprocal Rank Fusion
  4. Rerank               → NVIDIA llama-3.2-nv-rerankqa-1b-v2, top 20 → top 5
  5. Generate             → bedrock-claude-sonnet-4-6 via LiteLLM
  6. Stream               → SSE: status → citations → token → done
"""

import asyncio
import json
import os
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from functools import cached_property

import httpx
import litellm
from openai import AsyncOpenAI

from backend.config import Settings, get_settings
from backend.db import get_db
from backend.models import Citation, CitationsPayload, SearchResult


def _configure_langfuse(settings: Settings) -> None:
    """Enable LiteLLM → Langfuse tracing if keys are present."""
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        return
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
    os.environ.setdefault("LANGFUSE_HOST", settings.langfuse_host)
    if "langfuse" not in (litellm.success_callback or []):
        litellm.success_callback = ["langfuse"]


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are Qwiva, a clinical decision-support assistant for physicians in Kenya. \
Your answers are grounded exclusively in the clinical guidelines provided below.

Core values:

Groundedness: Cite every factual claim with [1], [2], etc. as you write. \
Multiple citations at a single point: [1][2]. Never state something that \
isn't supported by a provided source.

Clinical precision: Address the physician directly. Use appropriate medical \
terminology. Be concise — a busy clinician should get the answer in the first \
two sentences.

Honesty: If the provided guidelines do not address the question, say so clearly. \
Do not extrapolate beyond the sources.

Format:
- Lead with the direct answer.
- Use bullet points for lists of drugs, criteria, or steps.
- End with a one-line note if local Kenya context or resource limitations are \
  relevant to applying the guideline.
"""

_USER_TEMPLATE = """\
Clinical question: {question}

Relevant guideline excerpts:
{sources}

Answer the question using only the excerpts above. \
Cite inline with [1], [2], etc. for every claim.
"""


# ---------------------------------------------------------------------------
# Internal chunk representation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Chunk:
    id: str
    content: str
    guideline_title: str
    cascading_path: str
    year: str
    publisher: str
    chunk_index: int


# ---------------------------------------------------------------------------
# RAG class
# ---------------------------------------------------------------------------


class QwivaRAG:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        _configure_langfuse(self._settings)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def search(self, query: str, user_id: str) -> SearchResult:
        """Non-streaming search — returns the complete result."""
        chunks = await self._retrieve_and_rerank(query)
        citations = _build_citations(chunks)
        evidence_grade = _derive_evidence_grade(chunks)

        answer_parts: list[str] = []
        async for token in self._generate_stream(query, chunks):
            answer_parts.append(token)

        return SearchResult(
            answer="".join(answer_parts),
            citations=citations,
            evidence_grade=evidence_grade,
        )

    async def stream_search(
        self, query: str, user_id: str
    ) -> AsyncGenerator[str, None]:
        """
        Streaming search. Yields raw SSE-formatted strings.

        Event order:
          1. event: status     (progress updates during retrieval)
          2. event: citations  (sources ready — emitted before generation starts)
          3. event: token      (one per token as the LLM streams)
          4. event: done
        """
        yield _sse("status", {"message": "Searching guidelines…"})
        embedding = await self._embed(query)

        vec_task = self._vector_search(embedding)
        fts_task = self._fts_search(query)
        vec_results, fts_results = await asyncio.gather(vec_task, fts_task)

        merged = _reciprocal_rank_fusion(vec_results, fts_results, k=self._settings.rrf_k)
        top_chunks = merged[: self._settings.retrieval_top_k]

        yield _sse("status", {"message": "Ranking results…"})
        chunks = await self._rerank(query, top_chunks)

        citations = _build_citations(chunks)
        evidence_grade = _derive_evidence_grade(chunks)
        yield _sse("citations", CitationsPayload(citations=citations, evidence_grade=evidence_grade).model_dump())

        yield _sse("status", {"message": "Generating answer…"})
        async for token in self._generate_stream(query, chunks, user_id=user_id):
            yield _sse("token", {"token": token})

        yield _sse("done", {})

    # ------------------------------------------------------------------
    # Retrieval pipeline
    # ------------------------------------------------------------------

    async def _retrieve_and_rerank(self, query: str) -> list[Chunk]:
        embedding = await self._embed(query)
        vec_task = self._vector_search(embedding)
        fts_task = self._fts_search(query)
        vec_results, fts_results = await asyncio.gather(vec_task, fts_task)

        merged = _reciprocal_rank_fusion(
            vec_results,
            fts_results,
            k=self._settings.rrf_k,
        )
        top_chunks = merged[: self._settings.retrieval_top_k]
        return await self._rerank(query, top_chunks)

    async def _embed(self, query: str) -> list[float]:
        response = await self._openai.embeddings.create(
            model=self._settings.embedding_model,
            input=query,
        )
        return response.data[0].embedding

    async def _vector_search(self, embedding: list[float]) -> list[dict]:
        db = await get_db()
        response = await db.rpc(
            "match_documents",
            {
                "query_embedding": embedding,
                "match_count": self._settings.retrieval_top_k,
            },
        ).execute()
        return response.data or []

    async def _fts_search(self, query: str) -> list[dict]:
        db = await get_db()
        response = (
            await db.from_("documents_v2")
            .select("id, content, metadata")
            .limit(self._settings.retrieval_top_k)
            .filter("fts", "wfts", query)
            .execute()
        )
        return response.data or []

    async def _rerank(self, query: str, chunks: list[Chunk]) -> list[Chunk]:
        if not chunks:
            return chunks

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self._settings.rerank_base_url,
                headers={
                    "Authorization": f"Bearer {self._settings.nvidia_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._settings.rerank_model,
                    "query": query,
                    "documents": [c.content for c in chunks],
                    "top_n": self._settings.rerank_top_n,
                },
            )
            response.raise_for_status()
            results = response.json()["results"]

        return [chunks[r["index"]] for r in results]

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    async def _generate_stream(
        self, query: str, chunks: list[Chunk], user_id: str = ""
    ) -> AsyncGenerator[str, None]:
        # Assign the same deduplicated indices used in citations
        seen: dict[str, int] = {}
        idx = 1
        numbered: list[tuple[int, Chunk]] = []
        for chunk in chunks:
            key = (chunk.guideline_title or "").strip().lower()
            if key not in seen:
                seen[key] = idx
                idx += 1
            numbered.append((seen[key], chunk))

        sources_text = "\n\n".join(
            f"[{n}] {c.guideline_title} — {c.cascading_path}\n{c.content}"
            for n, c in numbered
        )
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _USER_TEMPLATE.format(
                    question=query,
                    sources=sources_text,
                ),
            },
        ]

        extra: dict = {}
        if self._settings.nvidia_api_key:
            extra["api_key"] = self._settings.nvidia_api_key
        if self._settings.nvidia_api_base:
            extra["api_base"] = self._settings.nvidia_api_base

        response = await litellm.acompletion(
            model=self._settings.litellm_model,
            messages=messages,
            stream=True,
            metadata={
                "trace_name": "qwiva_search",
                "tags": ["search"],
                "trace_user_id": user_id,
                "trace_metadata": {"query": query, "num_sources": len(chunks)},
            },
            **extra,
        )

        async for chunk in response:
            token = chunk.choices[0].delta.content
            if token:
                yield token

    # ------------------------------------------------------------------
    # Lazy clients (constructed once, reused across requests)
    # ------------------------------------------------------------------

    @cached_property
    def _openai(self) -> AsyncOpenAI:
        """Embeddings client — routed through the NVIDIA inference hub."""
        return AsyncOpenAI(
            api_key=self._settings.nvidia_api_key,
            base_url=self._settings.nvidia_api_base,
        )


# ---------------------------------------------------------------------------
# Module-level singleton — import this in main.py
# ---------------------------------------------------------------------------

rag = QwivaRAG()


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _row_to_chunk(row: dict) -> Chunk:
    meta = row.get("metadata") or {}
    return Chunk(
        id=str(row["id"]),
        content=row.get("content", ""),
        guideline_title=meta.get("guideline_title", "Unknown guideline"),
        cascading_path=meta.get("cascading_path", ""),
        year=str(meta.get("year", "")),
        publisher=meta.get("publisher", ""),
        chunk_index=int(meta.get("chunk_index", 0)),
    )


def _reciprocal_rank_fusion(
    vec_results: list[dict],
    fts_results: list[dict],
    k: int = 60,
) -> list[Chunk]:
    """
    Merge two ranked lists using Reciprocal Rank Fusion.
    Score(d) = Σ 1 / (k + rank)   for each list that contains d.
    Higher score = better.
    """
    scores: dict[str, tuple[float, Chunk]] = {}

    for rank, row in enumerate(vec_results):
        chunk = _row_to_chunk(row)
        prev_score = scores[chunk.id][0] if chunk.id in scores else 0.0
        scores[chunk.id] = (prev_score + 1 / (k + rank + 1), chunk)

    for rank, row in enumerate(fts_results):
        chunk = _row_to_chunk(row)
        prev_score = scores[chunk.id][0] if chunk.id in scores else 0.0
        scores[chunk.id] = (prev_score + 1 / (k + rank + 1), chunk)

    return [chunk for _, chunk in sorted(scores.values(), key=lambda x: x[0], reverse=True)]


def _build_citations(chunks: list[Chunk]) -> list[Citation]:
    """
    Build deduplicated citations from reranked chunks.
    Multiple chunks from the same guideline collapse into one citation entry.
    The LLM prompt is also built with these deduplicated numbers, so [1][2]
    in the answer text always matches what the UI displays.
    """
    seen: dict[str, int] = {}  # guideline_title -> assigned index
    citations: list[Citation] = []
    idx = 1

    for chunk in chunks:
        key = (chunk.guideline_title or "").strip().lower()
        if key not in seen:
            seen[key] = idx
            citations.append(Citation(
                index=idx,
                guideline_title=chunk.guideline_title,
                section=chunk.cascading_path,
                year=chunk.year,
                publisher=chunk.publisher,
            ))
            idx += 1

    return citations


def _derive_evidence_grade(chunks: list[Chunk]) -> str:
    """
    Derives a simple evidence label from the source guidelines.
    All answers are grounded in clinical guidelines — no ACC/AHA class inference.
    Returns the top publisher if available, otherwise a generic label.
    """
    if not chunks:
        return "Clinical Guideline"
    top_publisher = chunks[0].publisher
    return f"Clinical Guideline · {top_publisher}" if top_publisher else "Clinical Guideline"


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
