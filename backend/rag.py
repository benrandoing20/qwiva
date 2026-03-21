"""
Core RAG pipeline for Qwiva clinical search.

Pipeline (per query):
  1. Embed query        → text-embedding-3-small via NVIDIA hub
  2. Hybrid retrieval   → Qdrant vector search + Supabase FTS, Python RRF merge
  3. Rerank             → NVIDIA llama-3.2-nv-rerankqa-1b-v2, top 12 → top 5
  4. Generate           → bedrock-claude-sonnet-4-6 via LiteLLM
  5. Stream             → SSE: status → citations → token → done
"""

import asyncio
import json
import logging
import math
import os
import time
from collections import OrderedDict
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from functools import cached_property

import httpx
import litellm
from openai import AsyncOpenAI
from qdrant_client import AsyncQdrantClient

logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)

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

# _SYSTEM_PROMPT = """\
# You are Qwiva, a clinical decision-support assistant for physicians in Kenya. \
# Your answers are grounded exclusively in the clinical guidelines provided below.

# Clinical precision: Address the physician directly. Use appropriate medical \
# terminology. Be concise — a busy clinician should get the answer in the first \
# two sentences.

# Honesty: If the provided guidelines do not address the question, say so clearly. \
# Do not extrapolate beyond the sources.

# Formatting rules — follow exactly:
# - Lead with the direct answer in 1-2 sentences. Then supporting detail.
# - Use **bold** for drug names, diagnoses, and critical values.
# - Use bullet points for lists of drugs, criteria, or sequential steps.
# - DOSING: if the question involves dosing or weight-based regimens, present as \
#   a markdown table, e.g.: | Drug | Dose | Route | Frequency |
# - WARNINGS: prefix any contraindication or critical safety point with \
#   > **Warning:** on its own line.
# - SECTIONS: use ## headers only when the answer covers clearly distinct topics \
#   (e.g. ## Diagnosis, ## Treatment, ## Monitoring). Avoid headers for short answers.
# - Citations: place [1] at the end of the sentence or paragraph it supports. \
#   One citation can cover an entire section — do not repeat on every clause.
# - End with a one-line Kenya context note if local policy or resource availability \
#   differs from the general guideline.
# """

_SYSTEM_PROMPT = """\
You are Qwiva, a clinical decision-support assistant for physicians in Kenya. \
Your role is to surface what clinical guidelines recommend — not to instruct. \
The physician makes the clinical decision. \
Your answers are grounded exclusively in the clinical guidelines provided below.

Clinical precision: Address the physician directly. Use appropriate medical \
terminology. Be concise — a busy clinician should get the answer in the first \
two sentences. Always name the source guideline in the first two sentences. \
State the evidence grade (Class I, IIa, IIb / Level A, B, C) if explicitly \
present in the retrieved guidelines. Do not infer or assume a grade \
not in the source.

Honesty: If the provided guidelines do not address the question, say so clearly. \
Do not extrapolate beyond the sources.

Refer vs manage: For every management query include — even if not asked — \
(1) what to do now with specific doses, (2) when and to whom to refer with \
exact criteria, (3) what to do if referral is not immediately available.

Ambiguous queries: If the query lacks a presenting complaint, age, or setting, \
ask one clarifying question before answering.

Formatting rules — follow exactly:
•⁠  ⁠Lead with named guideline + evidence grade (if available) + direct answer \
  in 1–2 sentences. Frame as: "Per [guideline], [recommendation]" or \
  "[Guideline] recommends..." — not "Start / Give / Use" without attribution.
•⁠  ⁠Use *bold* for drug names, diagnoses, and critical values.
•⁠  ⁠Use bullet points for criteria or options; use ☐ checklists for actionable steps.
•⁠  ⁠DOSING: always present as a markdown table when doses are in the guidelines: \
  | Drug | Starting Dose | Route | Frequency | Target Dose |
•⁠  ⁠WARNINGS: prefix contraindications and safety thresholds with \
  > *Warning:* on its own line with exact values.
•⁠  ⁠SECTIONS: use ## headers only when covering clearly distinct topics. \
  Avoid for short answers.
•⁠  ⁠Citations: place [1] at the end of the sentence it supports. \
  Only cite sources referenced inline — do not list unreferenced retrieved sources.
•⁠  ⁠End with a one-line Kenya context note: name specific drugs on the KEML, \
  flag what is unavailable, and state the guideline-supported alternative.
"""

_USER_TEMPLATE = """\
Clinical question: {question}

Relevant guideline excerpts:
{sources}

Answer using only the excerpts above. Place citations [1], [2], etc. at the end \
of the sentence or paragraph they support — not after every clause.
"""

_CHAT_SYSTEM_PROMPT = """\
You are Qwiva, a clinical decision-support assistant for physicians in Kenya.
Be concise and professional. Address the physician directly.

You are responding to a conversational message or a follow-up that can be \
answered from the conversation so far. Respond naturally and briefly.

Citation handling: if the user asks about a source from a previous response, \
describe it exactly as listed in the "Referenced sources" section of that response. \
Do not speculate about whether a citation was correctly attributed — sources were \
retrieved from verified guideline documents by the system. Trust them as given.

For clinical questions needing specific guideline information (dosing, protocols, \
treatment algorithms), give a brief answer if you can, and suggest they ask it \
as a dedicated clinical question to get a fully cited guideline-grounded response.
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
    source_url: str = ""


# ---------------------------------------------------------------------------
# Semantic cache
# ---------------------------------------------------------------------------


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


@dataclass
class _CachedResult:
    embedding: list[float]
    chunks: list["Chunk"]
    citations: list["Citation"]
    evidence_grade: str
    answer: str
    ts: float = field(default_factory=time.time)


class _SemanticCache:
    """In-process LRU cache keyed by query embedding cosine similarity."""

    def __init__(self, max_size: int = 512, ttl: float = 86_400.0, threshold: float = 0.92) -> None:
        self._store: OrderedDict[int, _CachedResult] = OrderedDict()
        self._max_size = max_size
        self._ttl = ttl
        self._threshold = threshold

    def lookup(self, embedding: list[float]) -> _CachedResult | None:
        now = time.time()
        best_score = 0.0
        best_entry: _CachedResult | None = None
        stale = []

        for key, entry in self._store.items():
            if now - entry.ts > self._ttl:
                stale.append(key)
                continue
            score = _cosine(embedding, entry.embedding)
            if score > best_score:
                best_score = score
                best_entry = entry

        for key in stale:
            del self._store[key]

        if best_entry and best_score >= self._threshold:
            # Move to end (LRU promotion)
            self._store.move_to_end(id(best_entry))
            return best_entry
        return None

    def store(
        self,
        embedding: list[float],
        chunks: list["Chunk"],
        citations: list["Citation"],
        evidence_grade: str,
        answer: str,
    ) -> None:
        entry = _CachedResult(
            embedding=embedding,
            chunks=chunks,
            citations=citations,
            evidence_grade=evidence_grade,
            answer=answer,
        )
        key = id(entry)
        self._store[key] = entry
        if len(self._store) > self._max_size:
            self._store.popitem(last=False)  # evict oldest


# ---------------------------------------------------------------------------
# RAG class
# ---------------------------------------------------------------------------


class QwivaRAG:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        _configure_langfuse(self._settings)
        self._cache = _SemanticCache()

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
        self,
        query: str,
        user_id: str,
        history: list[dict] | None = None,
        precomputed_embedding: list[float] | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Streaming search. Yields raw SSE-formatted strings.

        Event order:
          1. event: status       (progress updates during retrieval)
          2. event: citations    (sources ready — before generation starts)
          3. event: token        (one per token as the LLM streams)
          4. event: done
          5. event: suggestions  (3 follow-up question chips)
        """
        yield _sse("status", {"message": "Searching guidelines…"})
        # Accept pre-computed embedding from main.py (saves one embed round-trip)
        embedding = precomputed_embedding or await self._embed(query)

        # --- semantic cache check ---
        cached = self._cache.lookup(embedding)
        if cached:
            yield _sse("citations", CitationsPayload(
                citations=cached.citations,
                evidence_grade=cached.evidence_grade,
            ).model_dump())
            yield _sse("status", {"message": "Generating answer…"})
            # Stream cached answer in small chunks to preserve typewriter UX
            step = 8
            for i in range(0, len(cached.answer), step):
                yield _sse("token", {"token": cached.answer[i:i + step]})
            yield _sse("done", {})
            return

        # --- full pipeline on cache miss ---
        top_chunks = await self._hybrid_search(query, embedding)

        yield _sse("status", {"message": "Ranking results…"})
        chunks = await self._rerank(query, top_chunks)

        citations = _build_citations(chunks)
        evidence_grade = _derive_evidence_grade(chunks)
        citations_payload = CitationsPayload(citations=citations, evidence_grade=evidence_grade)
        yield _sse("citations", citations_payload.model_dump())

        yield _sse("status", {"message": "Generating answer…"})
        answer_parts: list[str] = []
        async for token in self._generate_stream(query, chunks, user_id=user_id, history=history):
            answer_parts.append(token)
            yield _sse("token", {"token": token})

        full_answer = "".join(answer_parts)

        # Store in cache for future identical/similar queries
        self._cache.store(
            embedding=embedding,
            chunks=chunks,
            citations=citations,
            evidence_grade=evidence_grade,
            answer=full_answer,
        )

        yield _sse("done", {})

        # Follow-up suggestions — arrive after done so the answer is already shown
        suggestions = await self._generate_suggestions(query, full_answer, history)
        if suggestions:
            yield _sse("suggestions", {"suggestions": suggestions})

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    async def _hybrid_search(self, query: str, embedding: list[float]) -> list[Chunk]:
        """Parallel vector (Qdrant) + FTS (Supabase) merged with RRF."""
        if self._settings.qdrant_url:
            vector_chunks, fts_chunks = await asyncio.gather(
                self._qdrant_search(embedding),
                self._fts_search(query),
            )
            return _rrf_merge(
                vector_chunks, fts_chunks, self._settings.rrf_k, self._settings.retrieval_top_k
            )

        # Fallback: legacy single Supabase RPC (no Qdrant configured)
        db = await get_db()
        response = await db.rpc(
            "dynamic_hybrid_search_db",
            {
                "query_embedding": embedding,
                "query_text": query,
                "dense_weight": self._settings.dense_weight,
                "sparse_weight": self._settings.sparse_weight,
                "ilike_weight": 0.0,
                "fuzzy_weight": 0.0,
                "rrf_k": self._settings.rrf_k,
                "match_count": self._settings.retrieval_top_k,
                "filter": {},
                "fuzzy_threshold": 0.3,
            },
        ).execute()
        return [_row_to_chunk(r) for r in (response.data or [])]

    async def _qdrant_search(self, embedding: list[float]) -> list[Chunk]:
        response = await self._qdrant.query_points(
            collection_name=self._settings.qdrant_collection,
            query=embedding,
            limit=self._settings.retrieval_top_k,
            with_payload=True,
        )
        return [_qdrant_hit_to_chunk(r) for r in response.points]

    async def _fts_search(self, query: str) -> list[Chunk]:
        db = await get_db()
        response = (
            await db.table("documents_v2")
            .select("id, content, metadata")
            .filter("fts", "wfts", query)
            .limit(self._settings.retrieval_top_k)
            .execute()
        )
        return [_row_to_chunk(r) for r in (response.data or [])]

    async def _rerank(self, query: str, chunks: list[Chunk]) -> list[Chunk]:
        if not chunks:
            return chunks
        response = await self._http.post(
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
        # Slice to top_n — some reranker endpoints return all docs sorted rather than truncating
        return [chunks[r["index"]] for r in results[: self._settings.rerank_top_n]]

    async def _retrieve_and_rerank(self, query: str) -> list[Chunk]:
        embedding = await self._embed(query)
        top_chunks = await self._hybrid_search(query, embedding)
        return await self._rerank(query, top_chunks)

    async def _embed(self, query: str) -> list[float]:
        response = await self._openai.embeddings.create(
            model=self._settings.embedding_model,
            input=query,
        )
        return response.data[0].embedding

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------

    async def _generate_stream(
        self,
        query: str,
        chunks: list[Chunk],
        user_id: str = "",
        history: list[dict] | None = None,
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
        history_messages = _trim_history(history or [])
        # cache_control marks the system prompt for Anthropic prompt caching.
        # On non-Anthropic routes LiteLLM strips the key — no side effects.
        system_content = [{"type": "text", "text": _SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
        messages = [
            {"role": "system", "content": system_content},
            *history_messages,
            {
                "role": "user",
                "content": _USER_TEMPLATE.format(
                    question=query,
                    sources=sources_text,
                ),
            },
        ]

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
            **self._extra_kwargs,
        )

        async for chunk in response:
            token = chunk.choices[0].delta.content
            if token:
                yield token

    # ------------------------------------------------------------------
    # Routing: classify a user message
    # ------------------------------------------------------------------

    async def classify(self, query: str, history: list[dict]) -> str:
        """Return 'rag' if guideline lookup is needed, 'chat' for conversational reply."""
        # Fast path: obvious cases resolved without an LLM call
        quick = _quick_classify(query)
        if quick:
            return quick

        history_snippet = ""
        if history:
            last_few = history[-4:]
            history_snippet = "\n".join(
                f"{m['role'].upper()}: {m['content'][:300]}" for m in last_few
            )

        prompt = (
            "Classify this message for a clinical assistant.\n"
            "Reply with ONLY one word: rag OR chat\n\n"
            "rag = needs clinical guideline lookup (treatments, diagnoses, dosing, protocols)\n"
            "chat = greeting, thanks, small talk, or answerable from conversation history\n\n"
            + (f"Recent conversation:\n{history_snippet}\n\n" if history_snippet else "")
            + f"Message: {query}"
        )
        try:
            resp = await litellm.acompletion(
                model=self._settings.classify_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=5,
                temperature=0,
                **self._classify_kwargs,
            )
            result = resp.choices[0].message.content.strip().lower()
            return "rag" if "rag" in result else "chat"
        except Exception:
            return "rag"  # safe default for a clinical app

    # ------------------------------------------------------------------
    # Follow-up suggestions
    # ------------------------------------------------------------------

    async def _generate_suggestions(
        self, query: str, answer: str, history: list[dict] | None = None
    ) -> list[str]:
        """
        Return up to 3 follow-up questions only when they would genuinely help.

        The model decides — it returns null when the answer is already complete
        or the query is conversational/social (no follow-ups needed).
        History is included so suggestions are relevant to the full conversation.
        """
        history_snippet = ""
        if history:
            last_few = history[-4:]
            history_snippet = "\n".join(
                f"{m['role'].upper()}: {m['content'][:300]}" for m in last_few
            )

        prompt = (
            "A physician just received this clinical answer. Generate follow-up questions "
            "they would realistically ask next — specific to the drugs, doses, conditions, "
            "or complications mentioned. Each question must be a natural next clinical step "
            "(e.g. monitoring, side effects of a named drug, alternative if first-line fails, "
            "paediatric vs adult dosing, specific complication management).\n\n"
            "Rules:\n"
            "- Each question must be ≤12 words and directly reference content from the answer\n"
            "- Do NOT generate generic questions like 'What are the side effects?' — "
            "name the specific drug or condition\n"
            "- Return ONLY a JSON array of exactly 3 questions, or null if the answer was "
            "conversational/social and follow-ups would add no clinical value\n\n"
            + (f"Conversation context:\n{history_snippet}\n\n" if history_snippet else "")
            + f"Question: {query[:300]}\n"
            f"Answer: {answer[:800]}"
        )
        try:
            resp = await litellm.acompletion(
                model=self._settings.classify_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=150,
                temperature=0.2,
                **self._classify_kwargs,
            )
            raw = resp.choices[0].message.content.strip()
            if not raw or raw.lower() == "null":
                return []
            suggestions = json.loads(raw)
            if isinstance(suggestions, list) and suggestions:
                return [str(s) for s in suggestions[:3]]
        except Exception:
            pass
        return []

    # ------------------------------------------------------------------
    # Direct chat (no retrieval)
    # ------------------------------------------------------------------

    async def stream_chat(
        self, query: str, user_id: str, history: list[dict] | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream a direct response from conversation context — no RAG."""
        yield _sse("status", {"message": "Thinking…"})
        yield _sse("citations", CitationsPayload(citations=[], evidence_grade="").model_dump())

        history_messages = _trim_history(history or [])
        chat_system_content = [{"type": "text", "text": _CHAT_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
        messages = [
            {"role": "system", "content": chat_system_content},
            *history_messages,
            {"role": "user", "content": query},
        ]

        response = await litellm.acompletion(
            model=self._settings.litellm_model,
            messages=messages,
            stream=True,
            metadata={
                "trace_name": "qwiva_chat",
                "tags": ["chat"],
                "trace_user_id": user_id,
            },
            **self._extra_kwargs,
        )
        chat_tokens: list[str] = []
        async for chunk in response:
            token = chunk.choices[0].delta.content
            if token:
                chat_tokens.append(token)
                yield _sse("token", {"token": token})
        yield _sse("done", {})

        suggestions = await self._generate_suggestions(query, "".join(chat_tokens), history)
        if suggestions:
            yield _sse("suggestions", {"suggestions": suggestions})

    # ------------------------------------------------------------------
    # Lazy clients (constructed once, reused across requests)
    # ------------------------------------------------------------------

    @cached_property
    def _extra_kwargs(self) -> dict:
        """LiteLLM kwargs for the main generation model."""
        extra: dict = {}
        # Direct Anthropic path (prompt caching enabled)
        if self._settings.anthropic_api_key and self._settings.litellm_model.startswith("anthropic/"):
            extra["api_key"] = self._settings.anthropic_api_key
        elif self._settings.nvidia_api_key:
            extra["api_key"] = self._settings.nvidia_api_key
            if self._settings.nvidia_api_base:
                extra["api_base"] = self._settings.nvidia_api_base
        return extra

    @cached_property
    def _classify_kwargs(self) -> dict:
        """LiteLLM kwargs for the fast classify model (always NVIDIA hub)."""
        extra: dict = {}
        if self._settings.nvidia_api_key:
            extra["api_key"] = self._settings.nvidia_api_key
        if self._settings.nvidia_api_base:
            extra["api_base"] = self._settings.nvidia_api_base
        return extra

    @cached_property
    def _openai(self) -> AsyncOpenAI:
        """Embeddings client — routed through the NVIDIA inference hub."""
        return AsyncOpenAI(
            api_key=self._settings.nvidia_api_key,
            base_url=self._settings.nvidia_api_base,
        )

    @cached_property
    def _http(self) -> httpx.AsyncClient:
        """Persistent HTTP client for reranker — avoids per-request TCP handshake."""
        return httpx.AsyncClient(timeout=90, http2=True)

    @cached_property
    def _qdrant(self) -> AsyncQdrantClient:
        """Async Qdrant client — reused across requests."""
        return AsyncQdrantClient(
            url=self._settings.qdrant_url,
            api_key=self._settings.qdrant_api_key,
        )


# ---------------------------------------------------------------------------
# Module-level singleton — import this in main.py
# ---------------------------------------------------------------------------

rag = QwivaRAG()


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


_CHAT_STARTERS = {
    "thank", "thanks", "ok", "okay", "great", "perfect", "got it",
    "hi", "hello", "hey", "bye", "goodbye", "yes", "no", "sure",
    "understood", "noted", "alright", "sounds good",
}


def _quick_classify(query: str) -> str | None:
    """
    Heuristic pre-filter — avoids an LLM call for obvious cases.
    Returns 'chat' if clearly conversational, None if ambiguous (use LLM).
    """
    stripped = query.strip().lower().rstrip("!.,")
    # Single word or very short phrases that are clearly social
    if stripped in _CHAT_STARTERS:
        return "chat"
    # Short messages whose first word is a social starter and have no clinical terms
    words = stripped.split()
    if len(words) <= 4 and words[0] in _CHAT_STARTERS:
        clinical_hints = {"dose", "mg", "treatment", "?", "how", "what", "when", "why", "which"}
        if not any(h in stripped for h in clinical_hints):
            return "chat"
    return None  # ambiguous — let the LLM decide


def _trim_history(history: list[dict], max_turns: int = 6, max_chars: int = 8000) -> list[dict]:
    """Return the most recent messages within a character budget."""
    recent = history[-max_turns:]
    total = 0
    trimmed: list[dict] = []
    for msg in reversed(recent):
        total += len(msg.get("content", ""))
        if total > max_chars:
            break
        trimmed.insert(0, msg)
    return trimmed


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
        source_url=meta.get("source_url", "") or meta.get("url", ""),
    )



_EXCERPT_CHARS = 400  # chars of chunk content stored per citation for follow-up grounding


def _build_citations(chunks: list[Chunk]) -> list[Citation]:
    """
    Build deduplicated citations from reranked chunks.
    Multiple chunks from the same guideline collapse into one citation entry.
    The LLM prompt is also built with these deduplicated numbers, so [1][2]
    in the answer text always matches what the UI displays.
    The leading excerpt of the first (highest-ranked) chunk is stored so
    follow-up questions can reference what was actually retrieved.
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
                excerpt=chunk.content[:_EXCERPT_CHARS],
                source_url=chunk.source_url,
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


def _rrf_merge(
    vector_chunks: list[Chunk],
    fts_chunks: list[Chunk],
    k: int,
    top_n: int,
) -> list[Chunk]:
    """Reciprocal Rank Fusion — merges two ranked lists into one."""
    scores: dict[str, float] = {}
    chunk_map: dict[str, Chunk] = {}

    for rank, chunk in enumerate(vector_chunks):
        scores[chunk.id] = scores.get(chunk.id, 0.0) + 1.0 / (k + rank + 1)
        chunk_map[chunk.id] = chunk

    for rank, chunk in enumerate(fts_chunks):
        scores[chunk.id] = scores.get(chunk.id, 0.0) + 1.0 / (k + rank + 1)
        chunk_map[chunk.id] = chunk

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [chunk_map[cid] for cid in sorted_ids[:top_n]]


def _qdrant_hit_to_chunk(hit) -> Chunk:
    p = hit.payload or {}
    return Chunk(
        id=str(hit.id),
        content=p.get("content", ""),
        guideline_title=p.get("guideline_title", "Unknown guideline"),
        cascading_path=p.get("cascading_path", ""),
        year=str(p.get("year", "")),
        publisher=p.get("publisher", ""),
        chunk_index=int(p.get("chunk_index", 0)),
        source_url=p.get("source_url", "") or p.get("url", ""),
    )
