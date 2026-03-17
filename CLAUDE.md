# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Qwiva — a guideline-grounded clinical search platform for physicians in Kenya. Physicians ask clinical questions; the system retrieves relevant chunks from 189 clinical guidelines (82k chunks in Supabase) and streams a cited answer.

## Commands

### Backend (run from repo root)
```bash
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
uvicorn backend.main:app --reload

# Lint / format
ruff check backend/
black backend/
```

### Frontend
```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
npm run build
npm run lint
```

## Architecture

```
backend/
  config.py   — Pydantic Settings; all env vars; lru_cache singleton
  models.py   — All Pydantic models: SearchRequest, Citation, SearchResult, SSE payloads, UserProfile
  db.py       — Lazy async Supabase client singleton (service key)
  auth.py     — FastAPI dependency; verifies Supabase HS256 JWT locally
  rag.py      — QwivaRAG class + module-level `rag` singleton; pure helpers at bottom
  main.py     — FastAPI app; three routes: /health, /me, POST /search/stream

frontend/
  types/index.ts        — Shared TypeScript types
  lib/supabase.ts       — Browser Supabase client + getAccessToken()
  lib/api.ts            — streamSearch() async generator; parses raw SSE stream
  components/
    SearchBar.tsx        — Controlled form
    StreamingText.tsx    — Renders answer text; converts [1][2] to styled citation badges
    AnswerCard.tsx       — Full answer UI: streaming text + evidence grade + sources list
  app/
    layout.tsx           — Root layout
    page.tsx             — Main search page; orchestrates search state machine
    auth/login/page.tsx  — Supabase email/password login
```

## RAG pipeline (rag.py)

1. **Embed** — `text-embedding-3-large` via OpenAI async client
2. **Parallel retrieval** — `asyncio.gather(vector_search, fts_search)` both hit Supabase `documents_v2`
3. **RRF merge** — Reciprocal Rank Fusion (`k=60`) deduplicates and re-ranks
4. **Rerank** — Cohere `rerank-english-v3.0`, top 20 → top 5
5. **Generate** — `claude-opus-4-6` (default) via LiteLLM `acompletion(..., stream=True)`
6. **Stream** — SSE: `citations` event first, then `token` events, then `done`

## SSE contract (POST /search/stream)

```
event: citations
data: {"citations": [...], "evidence_grade": "Clinical Guideline · WHO"}

event: token
data: {"token": "..."}

event: done
data: {}
```

## Key decisions

- **JWT auth**: HS256 verified locally using `SUPABASE_JWT_SECRET` (not decoded unverified)
- **LLM routing**: All LLM calls go through LiteLLM — never call provider SDKs directly for chat
- **Model**: `anthropic/claude-opus-4-6` by default; override via `LITELLM_MODEL` env var
- **Evidence grade**: Derived from top chunk's publisher — no LLM inference
- **Frontend auth**: `localStorage` via Supabase JS SDK (`@supabase/ssr`)
- **Supabase client**: Uses service key on backend (never exposed to frontend)

## Supabase schema (do not modify)

Table `documents_v2`: `id`, `content`, `embedding` (vector), `metadata` (jsonb), `fts` (tsvector), `is_noise` (bool)

Key metadata fields: `guideline_title`, `publisher`, `year`, `geography`, `cascading_path`, `doc_id`, `chunk_index`

RPC `match_documents(query_embedding, match_count, filter)` — HNSW cosine search
