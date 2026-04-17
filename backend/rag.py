"""
Core RAG pipeline for Qwiva clinical search.

Pipeline (per query):
  1. Embed query        → text-embedding-3-small via NVIDIA hub
  2. Hybrid retrieval   → Qdrant vector search + Supabase FTS, Python RRF merge
  3. Rerank             → NVIDIA llama-3.2-nv-rerankqa-1b-v2, top 12 → top 5
  4. Generate           → anthropic/claude-sonnet-4-6 via LiteLLM (prompt-cached)
  5. Stream             → SSE: status → citations → token → done
"""

import asyncio
import json
import logging
import math
import os
import re
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
log = logging.getLogger(__name__)

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
Your role is to surface what clinical guidelines recommend — not to instruct. \
The physician makes the clinical decision. \
Your answers are grounded exclusively in the clinical guidelines provided below.

Clinical precision: Address the physician directly. Use appropriate medical \
terminology. Be concise — a busy clinician should get the answer in the first \
two sentences. Always name the source guideline in the first two sentences. \
State the evidence grade (Class I, IIa, IIb / Level A, B, C) if explicitly \
present in the retrieved guidelines. Do not infer or assume a grade \
not in the source.

Honesty: If the provided guidelines do not address the question, say so clearly \
and flag which part cannot be answered from available sources. Do not extrapolate \
beyond the sources. Never state a drug dose not explicitly present in the \
retrieved guidelines — if absent, say so and direct the physician to the \
appropriate formulary.

Drug label information: Some retrieved excerpts come from official drug prescribing \
information (FDA SPL or EMC). When citing these, label the citation as \
"[medicine_name] prescribing information (FDA)" or "(EMC)" as appropriate. \
Drug label doses take precedence over general guideline doses when the label is \
more specific for the drug in question. Always note Kenya availability and flag \
if a drug is not on the KEML.

Refer vs manage: For every management query include — even if not asked — \
(1) what to do now with specific doses where available, \
(2) when and to whom to refer with exact criteria, \
(3) what to do if referral is not immediately available.

Ambiguous queries: If the query lacks a presenting complaint, age, or clinical \
setting, ask one clarifying question before answering. While asking, always \
provide the universal immediate action bridge: \
"While you clarify — if the patient is acutely unwell right now, follow ABCDE: \
secure Airway, support Breathing, restore Circulation, assess Disability \
(GCS and pupils), Expose and examine fully. Call for help immediately." \
Do not generate specific clinical output until context is provided.

Formatting rules — follow exactly:
- Lead with named guideline + evidence grade (if available) + direct answer \
  in 1-2 sentences. Frame recommendations as: "Per [guideline], [recommendation]" \
  or "[Guideline] recommends..." — not "Start / Give / Use" as standalone \
  instructions without attribution.
- Use **bold** for section headers, drug names, diagnoses, and critical values.
- Use standard markdown only: numbered lists (1. 2. 3.) for ordered steps where \
  sequence matters, bullet points ( - ) for criteria and conditions, tables for \
  drug comparisons and dose thresholds, and a blockquote (>) for one critical \
  safety point per section — state it directly as a fact without the word Warning \
  or any prefix label. Use blockquotes sparingly. \
  Do not use special symbols such as ☐ → ✓ ⚠️.
- DOSING: present as a markdown table whenever doses appear in the retrieved \
  guidelines: | Drug | Starting Dose | Route | Frequency | Notes |
- Citations: use only the [n] numbers from the provided guideline excerpts. \
  Each source document has exactly one number — if multiple excerpts come from the same \
  guideline title, they all share the same [n]; never assign a second number to the same source. \
  Always cite the same source with the same [n] throughout the response. \
  Never invent a citation number for content from your own training knowledge — \
  omit the bracket entirely for any statement not in the provided excerpts. \
  Do not list retrieved sources not referenced in the text.
- End every response with a 🇰🇪 Kenya context note: name specific drugs on the \
  KEML, flag what is unavailable, state the guideline-supported alternative, \
  and note what to do if the recommended treatment or referral pathway is \
  not accessible.
"""

_USER_TEMPLATE = """\
Clinical question: {question}

Relevant guideline excerpts:
{sources}

Answer using only the excerpts above. Place citations sparingly: one [n] at the \
end of a paragraph or bullet group it supports — not after each individual sentence \
or bullet. \
Citation rules — follow exactly: (1) only use citation numbers [1]-[N] that \
appear in the excerpts above; (2) each source has exactly one number — always \
use the same [n] for the same source throughout your response; \
(3) never invent a citation number for content from your own training knowledge \
not in the excerpts — omit the bracket entirely for such content.
"""

_CHAT_SYSTEM_PROMPT = """\
You are Qwiva, a clinical decision-support assistant for physicians in Kenya.
Be concise and professional. Address the physician directly.

You are responding to a conversational message or a follow-up that can be \
answered from the conversation so far. Respond naturally and briefly.

Vague presentations: If the physician states a patient's condition without a \
specific clinical question (e.g. "my patient is unwell", "my patient has a fever"), \
ask ONE targeted clarifying question to understand what guideline information they \
need — e.g. "What specific aspect would you like guidance on — diagnosis, treatment, \
dosing, or referral criteria?"

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
    doc_type: str           # "guideline" | "evidence" | "drug" | "legacy"
    guideline_title: str
    cascading_path: str
    year: str
    publisher: str
    chunk_index: int
    source_url: str = ""
    # Evidence grading — populated from guideline/cpg chunk tables
    evidence_tier: int = 0          # 1=clinical_guideline, 2=systematic_review/meta, 3=rct
    grade_strength: str = ""        # "Strong", "Conditional", "Best Practice"
    grade_direction: str = ""       # "for" | "against"
    chunk_type: str = "text"        # "recommendation" | "text" | "table" | "background"
    is_current_version: bool = True
    # Drug label fields — populated from drug chunk table schema
    medicine_name: str = ""
    inn: str = ""
    atc_code: str = ""
    section_key: str = ""
    clinical_priority: str = ""
    # Extended metadata from new table schemas
    document_type: str = ""    # original DB value e.g. "systematic_review", "guideline"
    doi: str = ""              # DOI identifier — used to build https://doi.org/{doi} links


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
        
        _t0 = time.perf_counter()

        yield _sse("status", {"message": "Searching guidelines…"})

        # Expand short follow-ups ("yes", "Both") into a full clinical question
        # so the vector store has something meaningful to search against.
        # _expand_query is a no-op when query is already ≥7 words or history is empty.
        _ts = time.perf_counter()
        effective_query = await self._expand_query(query, history or [])
        log.info("LATENCY expand_query: %.3fs", time.perf_counter() - _ts)

        # Accept pre-computed embedding from main.py (saves one embed round-trip).
        # Re-embed when the query was expanded — the original embedding would be useless.
        _ts = time.perf_counter()
        if effective_query != query:
            embedding = await self._embed(effective_query)
        else:
            embedding = precomputed_embedding or await self._embed(query)
        log.info("LATENCY embed: %.3fs", time.perf_counter() - _ts)

        # --- semantic cache check ---
        # Skip cache when conversation history is present: a follow-up question
        # may embed similarly to a prior standalone query, but the answer must
        # reflect the current conversation context rather than a cached response.
        cached = self._cache.lookup(embedding) if not history else None
        if cached:
            yield _sse("citations", CitationsPayload(
                citations=cached.citations,
                evidence_grade=cached.evidence_grade,
            ).model_dump())
            yield _sse("status", {"message": "Generating response…"})
            # Stream cached answer in small chunks to preserve typewriter UX
            step = 8
            for i in range(0, len(cached.answer), step):
                yield _sse("token", {"token": cached.answer[i:i + step]})
            yield _sse("done", {})
            log.info("LATENCY total (cache hit): %.3fs", time.perf_counter() - _t0)
            return

        # --- full pipeline on cache miss ---
        _ts = time.perf_counter()
        top_chunks = await self._hybrid_search(effective_query, embedding)
        log.info("LATENCY hybrid_search total: %.3fs", time.perf_counter() - _ts)

        yield _sse("status", {"message": "Ranking results…"})
        _ts = time.perf_counter()
        chunks = await self._rerank(effective_query, top_chunks)
        log.info("LATENCY rerank: %.3fs", time.perf_counter() - _ts)

        citations = _build_citations(chunks)
        evidence_grade = _derive_evidence_grade(chunks)
        citations_payload = CitationsPayload(citations=citations, evidence_grade=evidence_grade)
        yield _sse("citations", citations_payload.model_dump())

        yield _sse("status", {"message": "Generating response…"})
        answer_parts: list[str] = []
        _first_token = True
        _ts_gen = time.perf_counter()
        async for token in self._generate_stream(effective_query, chunks, user_id=user_id, history=history):
            if _first_token:
                log.info("LATENCY generation first token: %.3fs", time.perf_counter() - _ts_gen)
                _first_token = False
            answer_parts.append(token)
            yield _sse("token", {"token": token})

        full_answer = "".join(answer_parts)
        log.info("LATENCY generation total: %.3fs", time.perf_counter() - _ts_gen)
        log.info("LATENCY pipeline total: %.3fs", time.perf_counter() - _t0)

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
        suggestions = await self._generate_suggestions(effective_query, full_answer, history, citations)
        if suggestions:
            yield _sse("suggestions", {"suggestions": suggestions})

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    async def _hybrid_search(self, query: str, embedding: list[float]) -> list[Chunk]:
        """Parallel vector (Qdrant) + FTS (Supabase) merged with RRF."""
        if self._settings.qdrant_url:
            gather_coros: list = [
                self._qdrant_search(embedding, doc_type="guideline"),
                self._fts_search(query),
            ]
            if self._settings.enable_drug_retrieval:
                gather_coros.append(self._qdrant_search(embedding, doc_type="drug"))
                gather_coros.append(self._drug_direct_lookup(query))

            _ts = time.perf_counter()
            gather_results = await asyncio.gather(*gather_coros)
            log.info("LATENCY parallel_gather (qdrant+fts+drug): %.3fs", time.perf_counter() - _ts)
            vector_chunks: list[Chunk] = gather_results[0]
            fts_chunks: list[Chunk] = gather_results[1]
            drug_qdrant_chunks: list[Chunk] = gather_results[2] if self._settings.enable_drug_retrieval else []
            drug_direct_chunks: list[Chunk] = gather_results[3] if self._settings.enable_drug_retrieval else []

            doc_type_counts = {}
            for c in vector_chunks:
                doc_type_counts[c.doc_type] = doc_type_counts.get(c.doc_type, 0) + 1
            log.info(
                "Retrieval: Qdrant=%d %s  FTS=%d  DrugQdrant=%d  DrugDirect=%d",
                len(vector_chunks), doc_type_counts, len(fts_chunks),
                len(drug_qdrant_chunks), len(drug_direct_chunks),
            )
            for i, c in enumerate(vector_chunks):
                log.info("  Qdrant[%d] %s — %s", i + 1, c.doc_type, c.guideline_title or c.id)
            for i, c in enumerate(fts_chunks):
                log.info("  FTS[%d] %s — %s", i + 1, c.doc_type, c.guideline_title or c.id)

            merged = _rrf_merge(
                vector_chunks, fts_chunks, self._settings.rrf_k, self._settings.retrieval_top_k
            )
            log.info("After RRF: %d chunks", len(merged))
            for i, c in enumerate(merged):
                log.info("  RRF[%d] %s — %s", i + 1, c.doc_type, c.guideline_title or c.id)

            # Inject drug chunks (direct lookup first, then Qdrant drug fallback)
            # directly into the pool — bypassing RRF rank penalty.
            seen_ids = {c.id for c in merged}
            drug_inject_k = max(2, self._settings.retrieval_top_k // 3)
            injected = 0

            # Direct lookup chunks take priority — they are the exact drug the user asked about
            for c in drug_direct_chunks:
                if injected >= drug_inject_k:
                    break
                if c.id not in seen_ids:
                    merged.append(c)
                    seen_ids.add(c.id)
                    injected += 1

            # Fill remaining slots from semantic drug search
            for c in drug_qdrant_chunks:
                if injected >= drug_inject_k:
                    break
                if c.id not in seen_ids:
                    merged.append(c)
                    seen_ids.add(c.id)
                    injected += 1

            if injected:
                log.info("Injected %d drug chunks into rerank pool", injected)

            return merged

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

    async def _drug_direct_lookup(self, query: str) -> list[Chunk]:
        """Detect drug names in the query and fetch their label sections directly.

        FTS ranking de-prioritises a drug's own label when many other drugs
        mention that drug by name (e.g. in drug-interaction sections).  This
        method bypasses ranking entirely: it does a fast ilike lookup on
        medicine_name, then fetches the most clinically relevant sections for
        any matched drug.
        """
        if not self._settings.enable_drug_retrieval:
            return []

        db = await get_db()
        s = self._settings

        # Extract candidate terms (words ≥ 5 chars to avoid stopwords)
        import re as _re
        words = list(dict.fromkeys(
            w for w in _re.split(r"[\s,;]+", query) if len(w) >= 5
        ))
        if not words:
            return []

        # Find distinct medicine_names that match any query word
        matched_names: set[str] = set()
        for word in words[:8]:  # cap to avoid too many round-trips
            try:
                res = await (
                    db.table(s.drug_chunk_table)
                    .select("medicine_name")
                    .ilike("medicine_name", f"%{word}%")
                    .limit(3)
                    .execute()
                )
                for r in res.data or []:
                    if r.get("medicine_name"):
                        matched_names.add(r["medicine_name"])
            except Exception:
                pass

        if not matched_names:
            return []

        log.info("Drug direct lookup matched names: %s", matched_names)

        # Priority sections — ordered by clinical relevance to any query
        PRIORITY_SECTIONS = [
            "pharmacokinetics", "dosage_and_administration",
            "mechanism_of_action", "indications_and_usage",
            "adverse_reactions", "pharmacodynamics", "contraindications",
            "drug_interactions", "use_in_specific_populations",
        ]

        # Also detect section intent from query keywords
        query_lower = query.lower()
        section_hints: list[str] = []
        if any(k in query_lower for k in ("pharmacokinetic", "absorption", "distribution", "clearance", "half-life")):
            section_hints.insert(0, "pharmacokinetics")
        if any(k in query_lower for k in ("dos", "administration", "regimen")):
            section_hints.insert(0, "dosage_and_administration")
        if any(k in query_lower for k in ("mechanism", "moa", "action")):
            section_hints.insert(0, "mechanism_of_action")
        if any(k in query_lower for k in ("indicat", "approved", "use for")):
            section_hints.insert(0, "indications_and_usage")

        # Merge: section_hints first, then remaining PRIORITY_SECTIONS
        ordered_sections = list(dict.fromkeys(section_hints + PRIORITY_SECTIONS))

        chunks: list[Chunk] = []
        select_cols = (
            "id, content, medicine_name, inn, atc_code, section_key, section_title, "
            "clinical_priority, chunk_index, fda_url, emc_url, source, last_updated"
        )
        for name in list(matched_names)[:3]:
            try:
                res = await (
                    db.table(s.drug_chunk_table)
                    .select(select_cols)
                    .eq("medicine_name", name)
                    .in_("section_key", ordered_sections[:5])
                    .limit(4)
                    .execute()
                )
                fetched = [_drug_row_to_chunk(r) for r in (res.data or [])]
                # Sort by section priority
                fetched.sort(key=lambda c: ordered_sections.index(c.section_key) if c.section_key in ordered_sections else 99)
                chunks.extend(fetched)
            except Exception as exc:
                log.warning("Drug direct lookup failed for %s: %s", name, exc)

        log.info("Drug direct lookup: %d chunks for names %s", len(chunks), matched_names)
        return chunks

    async def _qdrant_search(
        self, embedding: list[float], doc_type: str | None = None
    ) -> list[Chunk]:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        conditions = []
        if self._settings.enable_version_filter:
            conditions.append(
                FieldCondition(key="is_current_version", match=MatchValue(value=True))
            )
        if doc_type:
            conditions.append(
                FieldCondition(key="doc_type", match=MatchValue(value=doc_type))
            )
        query_filter = Filter(must=conditions) if conditions else None

        
        _ts = time.perf_counter()
        response = await self._qdrant.query_points(
            collection_name=self._settings.qdrant_collection,
            query=embedding,
            query_filter=query_filter,
            limit=self._settings.retrieval_top_k,
            with_payload=True,
        )
        log.info("LATENCY qdrant_search (doc_type=%s): %.3fs → %d hits", doc_type, time.perf_counter() - _ts, len(response.points))
        return [_qdrant_hit_to_chunk(r) for r in response.points]

    async def _fts_search(self, query: str) -> list[Chunk]:
        """Parallel FTS across cpg_chunks + guideline_chunks (PubMed) + drug chunks.

        clinical_practice_guideline_chunks — NICE and other CPGs (highest clinical priority)
        guideline_chunks — PubMed articles: SRs, RCTs, trials, research articles
        Falls back to documents_v2 only if both new tables fail.
        """
        db = await get_db()
        s = self._settings
        fts_query = _expand_clinical_abbreviations(query)
        # Replace hyphens with spaces — websearch_to_tsquery treats "-word" as NOT,
        # so "artemether-lumefantrine" becomes "artemether AND NOT lumefantrine" and
        # excludes the very guidelines that discuss both drugs together.
        fts_query = fts_query.replace("-", " ")

        _fts_t0 = time.perf_counter()
        if fts_query != query:
            log.info("FTS query expanded: %r → %r", query, fts_query)
        else:
            log.info("FTS query: %r", fts_query)

        _CPG_SELECT = (
            "id, content, guideline_title, chapter_title, pub_year, issuing_body, "
            "issuing_body_canonical, chunk_index, source_url, doi, "
            "evidence_tier, grade_strength, grade_direction, chunk_type, "
            "is_current_version, document_type"
        )
        _PUBMED_SELECT = (
            "id, content, guideline_title, chapter_title, pub_year, issuing_body, "
            "issuing_body_canonical, chunk_index, source_url, doi, iris_url, "
            "evidence_tier, grade_strength, grade_direction, chunk_type, "
            "is_current_version, document_type, authors, journal"
        )

        cpg_coro = (
            db.table(s.cpg_chunk_table)
            .select(_CPG_SELECT)
            .filter("fts", "wfts(english)", fts_query)
            .limit(s.retrieval_top_k)
            .execute()
        )

        pubmed_coro = (
            db.table(s.guideline_chunk_table)
            .select(_PUBMED_SELECT)
            .filter("fts", "wfts(english)", fts_query)
            .limit(s.retrieval_top_k)
            .execute()
        )

        coros: list = [cpg_coro, pubmed_coro]
        if s.enable_drug_retrieval:
            drug_coro = (
                db.table(s.drug_chunk_table)
                .select(
                    "id, content, medicine_name, inn, atc_code, section_key, section_title, "
                    "clinical_priority, chunk_index, fda_url, emc_url, source, last_updated"
                )
                .filter("fts", "wfts(english)", fts_query)
                .limit(max(1, s.retrieval_top_k // 2))
                .execute()
            )
            coros.append(drug_coro)

        _ts = time.perf_counter()
        results = await asyncio.gather(*coros, return_exceptions=True)
        log.info("LATENCY fts_parallel_gather: %.3fs", time.perf_counter() - _ts)

        chunks: list[Chunk] = []
        cpg_res, pubmed_res = results[0], results[1]

        if isinstance(cpg_res, Exception):
            log.warning("cpg_chunks FTS failed: %s", cpg_res)
        else:
            cpg_chunks = [_cpg_row_to_chunk(r) for r in (cpg_res.data or [])]
            log.info("FTS clinical_practice_guideline_chunks: %d results", len(cpg_chunks))
            chunks += cpg_chunks

        if isinstance(pubmed_res, Exception):
            log.warning("guideline_chunks FTS failed: %s", pubmed_res)
        else:
            pubmed_chunks = [_guideline_row_to_chunk(r) for r in (pubmed_res.data or [])]
            log.info("FTS guideline_chunks (PubMed): %d results", len(pubmed_chunks))
            chunks += pubmed_chunks

        if s.enable_drug_retrieval and len(results) > 2:
            drug_res = results[2]
            if isinstance(drug_res, Exception):
                log.warning("drug FTS failed: %s", drug_res)
            else:
                d_chunks = [_drug_row_to_chunk(r) for r in (drug_res.data or [])]
                log.info("FTS drug_label_chunks: %d results", len(d_chunks))
                chunks += d_chunks

        log.info("LATENCY fts_search total: %.3fs → %d chunks", time.perf_counter() - _fts_t0, len(chunks))
        return chunks

    async def _rerank(self, query: str, chunks: list[Chunk]) -> list[Chunk]:
        
        if not chunks:
            return chunks
        in_counts: dict[str, int] = {}
        for c in chunks:
            in_counts[c.doc_type] = in_counts.get(c.doc_type, 0) + 1
        log.info("Rerank input: %d chunks %s", len(chunks), in_counts)
        _ts = time.perf_counter()
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
        log.info("LATENCY rerank_http: %.3fs", time.perf_counter() - _ts)
        results = response.json()["results"]
        # Slice to top_n — some reranker endpoints return all docs sorted rather than truncating
        kept = [chunks[r["index"]] for r in results[: self._settings.rerank_top_n]]
        out_counts: dict[str, int] = {}
        for c in kept:
            out_counts[c.doc_type] = out_counts.get(c.doc_type, 0) + 1
        log.info("Rerank output: %d chunks %s", len(kept), out_counts)
        for r in results[: self._settings.rerank_top_n]:
            c = chunks[r["index"]]
            log.info("  Reranked[%.4f] %s — %s", r.get("relevance_score", 0), c.doc_type, c.guideline_title or c.id)
        return kept

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
        history_snippet = ""
        if history:
            last_few = history[-6:]
            history_snippet = "\n".join(
                f"{m['role'].upper()}: {m['content'][:600]}" for m in last_few
            )

        # Surface last assistant message content so classifier knows what was already retrieved
        retrieved_context = ""
        if history:
            last_assistant = next(
                (m for m in reversed(history) if m["role"] == "assistant"), None
            )
            if last_assistant:
                retrieved_context = (
                    f"\nContent already retrieved and answered in this session:\n"
                    f"{last_assistant['content'][:800]}\n"
                )

        prompt = (
            "Classify this message for a clinical assistant.\n"
            "Reply with ONLY one word: rag OR chat\n\n"
            "rag = needs a NEW clinical guideline lookup (treatments, diagnoses, dosing, protocols not yet discussed)\n"
            "chat = greeting, thanks, small talk, follow-up question about the previous answer, "
            "or any question answerable from the conversation history above\n\n"
            "Vague patient presentations without a specific clinical question "
            "(e.g. \"my patient is unwell\", \"I have a patient with fever\") → chat, "
            "so the assistant can ask what specific information is needed.\n\n"
            "A follow-up that introduces a NEW drug, dose, protocol, or clinical scenario "
            "not yet discussed in the conversation → rag, even if phrased as a follow-up.\n\n"
            "IMPORTANT: If the content already retrieved (shown below) contains the information "
            "needed to answer the current message, classify as chat — do NOT trigger another RAG lookup.\n\n"
            + (f"Recent conversation:\n{history_snippet}\n\n" if history_snippet else "")
            + retrieved_context
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
        self,
        query: str,
        answer: str,
        history: list[dict] | None = None,
        citations: list | None = None,
    ) -> list[str]:
        """
        Return up to 3 follow-up questions only when they would genuinely help.

        The model decides — it returns null when the answer is already complete
        or the query is conversational/social (no follow-ups needed).
        History and citation titles are included so suggestions are grounded in
        the specific drugs, guidelines, and conditions discussed.
        """
        # Recent conversation context (roles + truncated content)
        history_snippet = ""
        if history:
            last_few = history[-4:]
            history_snippet = "\n".join(
                f"{m['role'].upper()}: {m['content'][:500]}" for m in last_few
            )

        # Citation passages give the LLM the actual retrieved text to anchor suggestions
        citation_lines = ""
        if citations:
            parts = []
            for c in citations:
                header = f"[{c.index}] {c.guideline_title}"
                if getattr(c, "publisher", None):
                    header += f" ({c.publisher}, {c.year})"
                body = getattr(c, "source_content", "") or getattr(c, "excerpt", "")
                if body:
                    # 500 chars per source keeps prompt tight but includes key clinical values
                    header += f"\n    {body[:500]}"
                parts.append(header)
            citation_lines = "\n\n".join(parts)

        prompt = (
            "A physician just received the clinical answer below. Generate 3 follow-up "
            "questions they would realistically ask next, grounded in the specific information in the answer.\n\n"
            "Rules:\n"
            "- Each question ≤12 words and must name a CLINICAL entity from the answer: "
            "a drug (amoxicillin, artesunate), a condition (eclampsia, sepsis), or a "
            "procedure (magnesium sulphate infusion)\n"
            "- Do NOT generate questions about diagnostic manuals (DSM-5-TR, ICD-11), "
            "scoring systems (APGAR, GCS, SOFA), guideline names (WHO 2025, RCOG Green-top), "
            "or classification systems — these are reference tools, not clinical entities to ask about\n"
            "- Natural next clinical steps: monitoring parameters for a named drug or condition, "
            "adverse effects or dosing only for actual DRUGS (not foods or nutrition products), "
            "alternative if first-line fails, paediatric vs adult dosing, or complication management\n"
            "- Therapeutic milks and nutrition products (F75, F100, RUTF, Plumpy'Nut, ORS, EBM, "
            "formula feeds) are NOT drugs. Do NOT ask about their 'side effects', 'dosing', or "
            "'drug interactions'. For nutrition products, valid questions concern: when to switch "
            "formulations, feeding volumes, or specific feeding complications\n"
            "- Each suggestion must be a complete English question (subject + verb), 5–12 words, ending with '?'\n"
            "- Do NOT generate generic questions — 'What are the side effects?' is wrong; "
            "'What are the side effects of amoxicillin in SAM?' is correct\n"
            "- Do not repeat a question already answered in the conversation\n"
            "- Return ONLY a JSON array of exactly 3 strings, or the word null if the "
            "answer was conversational/social and no clinical follow-up adds value\n\n"
            + (f"Conversation so far:\n{history_snippet}\n\n" if history_snippet else "")
            + (f"Guidelines cited:\n{citation_lines}\n\n" if citation_lines else "")
            + f"Physician question: {query[:400]}\n"
            f"Clinical answer: {answer[:1500]}"
        )
        try:
            resp = await litellm.acompletion(
                model=self._settings.classify_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                temperature=0.3,
                **self._classify_kwargs,
            )
            raw = resp.choices[0].message.content.strip()
            if not raw or raw.lower() == "null":
                return []
            suggestions = json.loads(raw)
            if isinstance(suggestions, list) and suggestions:
                grounded = [
                    str(s) for s in suggestions[:3]
                    if _suggestion_grounded(str(s), answer)
                ]
                return grounded
        except Exception:
            pass
        return []

    # ------------------------------------------------------------------
    # Direct chat (no retrieval)
    # ------------------------------------------------------------------

    async def _expand_query(self, query: str, history: list[dict]) -> str:
        """Expand a short follow-up into a full standalone clinical question.

        When a physician answers a clarifying question with "yes", "Both", etc.,
        the raw word produces meaningless vector search results.  This rewrites
        the follow-up using recent conversation context so retrieval is accurate.
        Returns the original query unchanged if it is already specific or if
        expansion fails.
        """
        if len(query.split()) > 6 or not history:
            return query

        recent = history[-4:]  # last 2 user+assistant pairs
        ctx = "\n".join(
            f"{'Physician' if m['role'] == 'user' else 'Assistant'}: "
            f"{m['content'][:400] if isinstance(m.get('content'), str) else ''}"
            for m in recent
        )
        prompt = (
            f"Conversation:\n{ctx}\n\n"
            f"Physician follow-up: \"{query}\"\n\n"
            "Rewrite as a single complete standalone clinical question capturing exactly "
            "what the physician is asking, including all relevant patient context from the "
            "conversation (age, condition, gestational age, etc.). "
            "Output ONLY the rewritten question, nothing else."
        )
        try:
            resp = await litellm.acompletion(
                model=self._settings.classify_model,  # groq — fast and cheap
                messages=[{"role": "user", "content": prompt}],
                max_tokens=120,
                temperature=0,
                **self._classify_kwargs,
            )
            expanded = resp.choices[0].message.content.strip().strip('"')
            return expanded if expanded else query
        except Exception:
            return query  # fail safe: use original query

    async def stream_chat(
        self, query: str, user_id: str, history: list[dict] | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream a direct response from conversation context — no RAG."""
        yield _sse("status", {"message": "Generating response…"})
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
        """LiteLLM kwargs — routes credentials by model prefix.

        Supported prefixes:
          groq/          → GROQ_API_KEY
          openai/aws/    → NVIDIA hub (Bedrock models)
          openai/azure/  → NVIDIA hub (Azure models)
          openai/        → OpenAI direct (OPENAI_API_KEY) or NVIDIA hub fallback
          anthropic/     → ANTHROPIC_API_KEY
        """
        model = self._settings.litellm_model
        s = self._settings
        if model.startswith("groq/"):
            return {"api_key": s.groq_api_key} if s.groq_api_key else {}
        if model.startswith("openai/aws/") or model.startswith("openai/azure/"):
            return {"api_key": s.nvidia_api_key, "api_base": s.nvidia_api_base}
        if model.startswith("openai/"):
            if s.openai_api_key:
                return {"api_key": s.openai_api_key}
            # Fall back to NVIDIA hub for other openai/ prefixed models
            return {"api_key": s.nvidia_api_key, "api_base": s.nvidia_api_base}
        if model.startswith("anthropic/"):
            return {"api_key": s.anthropic_api_key} if s.anthropic_api_key else {}
        return {}

    @cached_property
    def _classify_kwargs(self) -> dict:
        """LiteLLM kwargs for classify + suggestions (Groq)."""
        extra: dict = {}
        if self._settings.groq_api_key:
            extra["api_key"] = self._settings.groq_api_key
        return extra

    @cached_property
    def _openai(self) -> AsyncOpenAI:
        """Embeddings client — uses OpenAI direct if openai_api_key is set, otherwise NVIDIA hub."""
        if self._settings.openai_api_key:
            return AsyncOpenAI(api_key=self._settings.openai_api_key)
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



def _trim_history(
    history: list[dict],
    max_turns: int | None = None,
    max_chars: int = 32_000,
) -> list[dict]:
    """Return as many recent messages as fit within the character budget.

    max_turns is intentionally unlimited by default — the full conversation is
    passed so the LLM retains context from early turns.  max_chars acts as a
    safety valve against extreme conversation lengths.
    """
    pool = history[-max_turns:] if max_turns else history
    total = 0
    trimmed: list[dict] = []
    for msg in reversed(pool):
        total += len(msg.get("content", ""))
        if total > max_chars:
            break
        trimmed.insert(0, msg)
    return trimmed


def _row_to_chunk(row: dict) -> Chunk:
    """Legacy: maps a documents_v2 row (JSONB metadata) to Chunk."""
    meta = row.get("metadata") or {}
    return Chunk(
        id=str(row["id"]),
        content=row.get("content", ""),
        doc_type="legacy",
        guideline_title=meta.get("guideline_title", "Unknown guideline"),
        cascading_path=meta.get("cascading_path", ""),
        year=str(meta.get("year", "")),
        publisher=meta.get("publisher", ""),
        chunk_index=int(meta.get("chunk_index", 0)),
        source_url=meta.get("source_url", "") or meta.get("url", ""),
        evidence_tier=1,
        chunk_type="text",
    )


def _source_url_from_row(row: dict) -> str:
    """Build source URL with priority: source_url → doi → iris_url."""
    doi = row.get("doi") or ""
    return (
        row.get("source_url")
        or (f"https://doi.org/{doi}" if doi else "")
        or row.get("iris_url", "")
    ) or ""


def _cpg_row_to_chunk(row: dict) -> Chunk:
    """Maps a clinical_practice_guideline_chunks row to Chunk."""
    return Chunk(
        id=str(row["id"]),
        content=row.get("content", ""),
        doc_type="guideline",
        document_type=row.get("document_type", "guideline"),
        guideline_title=row.get("guideline_title", "Unknown guideline"),
        cascading_path=row.get("chapter_title", ""),
        year=str(row.get("pub_year", "") or ""),
        publisher=row.get("issuing_body", "") or row.get("issuing_body_canonical", ""),
        chunk_index=int(row.get("chunk_index", 0)),
        source_url=_source_url_from_row(row),
        doi=row.get("doi") or "",
        evidence_tier=int(row.get("evidence_tier") or 1),
        grade_strength=row.get("grade_strength", ""),
        grade_direction=row.get("grade_direction", ""),
        chunk_type=row.get("chunk_type", "text"),
        is_current_version=bool(row.get("is_current_version", True)),
    )


def _guideline_row_to_chunk(row: dict) -> Chunk:
    """Maps a guideline_chunks (PubMed) row to Chunk."""
    doc_type_val = row.get("document_type", "")
    return Chunk(
        id=str(row["id"]),
        content=row.get("content", ""),
        doc_type="guideline" if doc_type_val == "clinical_practice_guideline" else "evidence",
        document_type=doc_type_val,
        guideline_title=row.get("guideline_title", "Unknown"),
        cascading_path=row.get("chapter_title", ""),
        year=str(row.get("pub_year", "") or ""),
        publisher=(
            row.get("issuing_body", "")
            or row.get("issuing_body_canonical", "")
            or row.get("journal", "")
        ),
        chunk_index=int(row.get("chunk_index", 0)),
        source_url=_source_url_from_row(row),
        doi=row.get("doi") or "",
        evidence_tier=int(row.get("evidence_tier") or 2),
        grade_strength=row.get("grade_strength", ""),
        grade_direction=row.get("grade_direction", ""),
        chunk_type=row.get("chunk_type", "text"),
        is_current_version=bool(row.get("is_current_version", True)),
    )


def _drug_row_to_chunk(row: dict) -> Chunk:
    """Maps a drug chunk table row to Chunk."""
    med_name = row.get("medicine_name", "") or row.get("inn", "")
    # `source` holds the meaningful value (e.g. "fda_spl"); source_type is always "drug_label"
    source = row.get("source", row.get("source_type", ""))
    label = f"{med_name} prescribing information ({source.upper()})" if source else f"{med_name} prescribing information"
    return Chunk(
        id=str(row["id"]),
        content=row.get("content", ""),
        doc_type="drug",
        guideline_title=label,
        cascading_path=row.get("section_title", "") or row.get("section_key", ""),
        year=str(row.get("last_updated", "") or ""),
        publisher=source.upper() if source else "Drug Label",
        chunk_index=int(row.get("chunk_index", 0)),
        source_url=row.get("fda_url", "") or row.get("emc_url", "") or row.get("source_url", ""),
        medicine_name=row.get("medicine_name", ""),
        inn=row.get("inn", ""),
        atc_code=row.get("atc_code", ""),
        section_key=row.get("section_key", ""),
        clinical_priority=row.get("clinical_priority", ""),
        chunk_type="drug_label",
    )



_EXCERPT_CHARS = 400  # chars of chunk content stored per citation for follow-up grounding


def _build_citations(chunks: list[Chunk]) -> list[Citation]:
    """
    Build deduplicated citations from reranked chunks.
    Multiple chunks from the same source collapse into one citation entry.
    Dedup key is (doc_type, normalised title) to prevent a drug label and a
    guideline with a similar name from merging incorrectly.
    The leading excerpt of the first (highest-ranked) chunk is stored so
    follow-up questions can reference what was actually retrieved.
    """
    seen: dict[str, int] = {}
    citations: list[Citation] = []
    idx = 1

    for chunk in chunks:
        title = (chunk.guideline_title or chunk.medicine_name or "").strip()
        # Use title-only key — matches _generate_stream — so legacy + guideline
        # chunks from the same document collapse to one citation index in both
        # functions. (doc_type mismatch between FTS/Qdrant caused index skew.)
        key = title.lower()
        if key not in seen:
            seen[key] = idx
            # For drug chunks, use section_title as the section label
            section = (
                chunk.cascading_path
                if chunk.doc_type != "drug"
                else (chunk.section_key or chunk.cascading_path)
            )
            citations.append(Citation(
                index=idx,
                guideline_title=title,
                section=section,
                year=chunk.year,
                publisher=chunk.publisher,
                excerpt=chunk.content[:_EXCERPT_CHARS],
                source_url=chunk.source_url,
                source_content=chunk.content,
            ))
            idx += 1

    return citations


def _derive_evidence_grade(chunks: list[Chunk]) -> str:
    """Derives an evidence label from the richest available chunk metadata.

    Priority: structured grade fields > evidence_tier number > publisher name.
    """
    if not chunks:
        return "Clinical Guideline"
    top = chunks[0]
    # Use structured grade when available (from guideline_chunks schema)
    if top.grade_strength and top.grade_direction:
        base = f"{top.grade_strength} recommendation ({top.grade_direction})"
        return f"{base} · {top.publisher}" if top.publisher else base
    # Evidence tier map
    _tier_labels = {1: "Clinical Guideline", 2: "Systematic Review", 3: "RCT Evidence"}
    label = _tier_labels.get(top.evidence_tier, "Clinical Reference")
    if top.doc_type == "drug":
        label = "Prescribing Information"
    return f"{label} · {top.publisher}" if top.publisher else label


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


_SUGGESTION_STOP_WORDS = {
    "what", "which", "should", "would", "could", "given", "after",
    "before", "during", "about", "these", "their", "there", "where",
    "when", "while", "since", "until", "other", "first", "second",
}

# Patterns that indicate a suggestion is asking drug-pharmacology questions
_DRUG_QUESTION_RE = re.compile(
    r"\b(side effects?|adverse effects?|doses?|dosing|dosage|drug interactions?|contraindications?)\b",
    re.IGNORECASE,
)

# Therapeutic nutrition products that must NOT be framed as drugs
_NUTRITION_PRODUCTS = {
    "f75", "f100", "rutf", "plumpy", "ors", "ebm",
    "formula", "therapeutic milk", "therapeutic food",
}

# Drug-dose markers: their presence in the answer confirms something drug-like is being discussed
_DRUG_MARKERS_RE = re.compile(
    r"\b(\d+\s*mg|\d+\s*mcg|\d+\s*ml/kg|\d+\s*iu\b"
    r"|tablets?|capsules?|intravenous|infusion|injection|oral dose)\b",
    re.IGNORECASE,
)


def _suggestion_grounded(suggestion: str, answer: str) -> bool:
    """Return True if the suggestion is grounded, grammatical, and appropriately framed.

    Three checks (in order):
    A. Completeness — must be ≥5 words and end with '?'
    B. Drug-framing appropriateness — drug-pharmacology templates ('side effects',
       'dosing', etc.) only pass if (i) the entity is not a known nutrition product
       AND (ii) the answer contains at least one drug-dose marker
    C. Entity grounding — every capitalised entity word ≥5 chars must appear verbatim
       in the answer (case-insensitive)
    """
    stripped = suggestion.strip()

    # A. Grammar / completeness
    if not stripped.endswith("?") or len(stripped.split()) < 5:
        return False

    # B. Drug-type framing must match actual drugs in the answer
    if _DRUG_QUESTION_RE.search(stripped):
        sugg_lower = stripped.lower()
        if any(np in sugg_lower for np in _NUTRITION_PRODUCTS):
            return False
        if not _DRUG_MARKERS_RE.search(answer):
            return False

    # C. Named entity grounding
    answer_lower = answer.lower()
    words = re.findall(r"\b[A-Za-z]{5,}\b", stripped)
    entity_words = [w for w in words if w[0].isupper() and w.lower() not in _SUGGESTION_STOP_WORDS]
    if not entity_words:
        return True
    return all(w.lower() in answer_lower for w in entity_words)


_CLINICAL_ABBREVS: dict[str, str] = {
    r"\bARVs?\b": "antiretroviral",
    r"\bART\b": "antiretroviral therapy",
    r"\bTB\b": "tuberculosis",
    r"\bMDR-TB\b": "multidrug resistant tuberculosis",
    r"\bXDR-TB\b": "extensively drug resistant tuberculosis",
    r"\bIPT\b": "isoniazid preventive therapy",
    r"\bPMTCT\b": "prevention of mother to child transmission",
    r"\bHTN\b": "hypertension",
    r"\bDM\b": "diabetes mellitus",
    r"\bT2DM\b": "type 2 diabetes",
    r"\bCHD\b": "coronary heart disease",
    r"\bACS\b": "acute coronary syndrome",
    r"\bMI\b": "myocardial infarction",
    r"\bHF\b": "heart failure",
    r"\bCOPD\b": "chronic obstructive pulmonary disease",
    r"\bPPH\b": "postpartum haemorrhage",
    r"\bPE\b": "pre-eclampsia",
    r"\bSSI\b": "surgical site infection",
    r"\bUTI\b": "urinary tract infection",
    r"\bRDS\b": "respiratory distress syndrome",
    r"\bSAM\b": "severe acute malnutrition",
}


def _expand_clinical_abbreviations(query: str) -> str:
    import re
    result = query
    for pattern, expansion in _CLINICAL_ABBREVS.items():
        result = re.sub(pattern, expansion, result)
    return result


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
    """Maps a Qdrant point to Chunk, reading both legacy and new payload fields."""
    p = hit.payload or {}
    doc_type = p.get("doc_type", "legacy")
    medicine_name = p.get("medicine_name", "")
    title = p.get("guideline_title", "") or (
        f"{medicine_name} prescribing information ({p.get('source_type', '').upper()})"
        if doc_type == "drug" else "Unknown guideline"
    )
    doi = p.get("doi", "")
    source_url = (
        p.get("source_url", "")
        or (f"https://doi.org/{doi}" if doi else "")
        or p.get("url", "")
        or p.get("iris_url", "")
    )
    return Chunk(
        id=str(hit.id),
        content=p.get("content", ""),
        doc_type=doc_type,
        document_type=p.get("document_type", ""),
        guideline_title=title,
        cascading_path=p.get("cascading_path", "") or p.get("chapter_title", "") or p.get("section_title", ""),
        year=str(p.get("year", "") or p.get("pub_year", "") or ""),
        publisher=p.get("publisher", "") or p.get("issuing_body", "") or p.get("source_type", "").upper(),
        chunk_index=int(p.get("chunk_index", 0)),
        source_url=source_url,
        doi=doi,
        evidence_tier=int(p.get("evidence_tier") or 0),
        grade_strength=p.get("grade_strength", ""),
        grade_direction=p.get("grade_direction", ""),
        chunk_type=p.get("chunk_type", "text"),
        is_current_version=bool(p.get("is_current_version", True)),
        medicine_name=medicine_name,
        inn=p.get("inn", ""),
        atc_code=p.get("atc_code", ""),
        section_key=p.get("section_key", ""),
        clinical_priority=p.get("clinical_priority", ""),
    )
