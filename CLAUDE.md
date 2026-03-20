# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Qwiva — a guideline-grounded clinical search platform for physicians in Kenya. Physicians ask clinical questions; the system retrieves relevant chunks from clinical guidelines in Supabase and streams a cited answer.

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

## Deployment

**Backend → Fly.io** (free tier)
```bash
fly auth login
fly launch --no-deploy   # uses fly.toml, skips interactive prompts
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_JWT_SECRET=... \
  NVIDIA_API_KEY=... FRONTEND_URL=https://your-app.vercel.app
fly deploy
```
- `fly.toml` at repo root; primary region `jnb` (Johannesburg)
- Check logs: `fly logs`; SSH in: `fly ssh console`

**Frontend → Vercel** (free hobby tier)
- Connect repo on vercel.com → set **Root Directory** to `frontend/`
- Set env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- After deploy, set `FRONTEND_URL` in Fly secrets to your Vercel domain and `fly deploy`

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
    Navbar.tsx           — Fixed top nav with sign-out
    SearchBar.tsx        — Controlled form
    StreamingText.tsx    — Renders answer text; typewriter effect; compresses [1][2]→[1-2]
    AnswerCard.tsx       — Full answer UI: streaming text + sources list
  app/
    layout.tsx           — Root layout
    page.tsx             — Main search page; orchestrates search state machine + renumberByAppearance
    auth/login/page.tsx  — Supabase email/password login
```

## RAG pipeline (rag.py)

1. **Embed** — `text-embedding-3-small` (1536-dim) via AsyncOpenAI routed through NVIDIA hub
2. **Parallel retrieval** — `asyncio.gather(vector_search, fts_search)` both hit Supabase `documents_v2`
   - Vector: `match_documents` RPC (HNSW cosine)
   - FTS: `.filter("fts", "wfts", query)` (websearch operator)
3. **RRF merge** — Reciprocal Rank Fusion (`k=60`) deduplicates and re-ranks
4. **Rerank** — NVIDIA `llama-3.2-nv-rerankqa-1b-v2` via direct HTTP POST, top 20 → top 5
5. **Generate** — `bedrock-claude-sonnet-4-6` (default) via LiteLLM `acompletion(..., stream=True)`
6. **Stream** — SSE: `status` events during retrieval, `citations` event, `token` events, `done`

## SSE contract (POST /search/stream)

```
event: status
data: {"message": "Searching guidelines…"}

event: citations
data: {"citations": [...], "evidence_grade": "..."}

event: token
data: {"token": "..."}

event: done
data: {}
```

## Key decisions

- **JWT auth**: HS256 verified locally using `SUPABASE_JWT_SECRET` (legacy key); `verify_aud: False`
- **LLM routing**: All LLM/embedding calls go through NVIDIA inference hub; single `NVIDIA_API_KEY`
- **Citation dedup**: Done on backend by `guideline_title`; LLM prompt numbers match displayed numbers
- **Citation renumbering**: Frontend `renumberByAppearance()` reorders by first appearance in text
- **Embedding model**: Must match ingestion — `text-embedding-3-small` (1536-dim)
- **Supabase client**: Uses service key on backend (never exposed to frontend)

## Evals

```bash
# Install eval dependencies
uv pip install -e ".[eval]"

# Run full eval suite (calls judge LLM — costs API credits)
python -m evals.run_evals

# Fast run — code metrics only, no LLM judge
python -m evals.run_evals --skip-ragas --skip-deepeval --n 5

# Reports written to evals/reports/ as JSON + Markdown
```

Key design decisions:
- `pipeline.py` calls RAG internals directly to capture per-stage latency
- RAGAS and DeepEval both use the NVIDIA hub LLM as judge (same model, zero extra cost)
- Clinical metrics (citation rate, source coverage) are code-based — free to run always
- `--skip-ragas --skip-deepeval` mode runs in ~1min with no LLM judge calls
- Golden dataset in `evals/datasets/clinical_questions.json`

## Supabase schema (do not modify)

Table `documents_v2`: `id`, `content`, `embedding` (vector/1536), `metadata` (jsonb), `fts` (tsvector)

Key metadata fields: `guideline_title`, `publisher`, `year`, `geography`, `cascading_path`, `doc_id`, `chunk_index`

RPC `match_documents(query_embedding vector, match_count int)` — HNSW cosine search
