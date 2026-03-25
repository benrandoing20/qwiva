<div align="center">

# Qwiva

**Guideline-grounded clinical decision support for physicians in Kenya**

[![Python](https://img.shields.io/badge/python-3.11%2B-3776ab?logo=python&logoColor=white)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Qdrant](https://img.shields.io/badge/Qdrant-vector%20store-dc2626)](https://qdrant.tech)
[![Anthropic](https://img.shields.io/badge/LLM-Anthropic-cc785c)](https://anthropic.com)
[![Groq](https://img.shields.io/badge/routing-Groq-F55036)](https://groq.com)
[![Render](https://img.shields.io/badge/backend-Render-46E3B7?logo=render&logoColor=white)](https://render.com)
[![Vercel](https://img.shields.io/badge/frontend-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![Code style: black](https://img.shields.io/badge/code%20style-black-000000)](https://github.com/psf/black)
[![Linting: ruff](https://img.shields.io/badge/linting-ruff-FCC21B)](https://github.com/astral-sh/ruff)

Qwiva answers clinical questions with cited, guideline-grounded responses — streamed in real time directly to the physician at the point of care.

</div>

---

## What it does

A physician types a clinical question. Qwiva retrieves the most relevant excerpts from 82,000+ chunks across Kenya MoH, WHO, and specialist society guidelines, reranks them, and streams a precise, cited answer in seconds.

Follow-up questions and small talk are handled from conversation context — no unnecessary retrieval. Prior cited sources are available to reference throughout the conversation.

```
Physician: "First-line malaria treatment in adults"

Qwiva: For uncomplicated P. falciparum malaria, the first-line regimen is
       Artemether-Lumefantrine (AL) given as a fixed-dose combination over
       three days... [1]

       Sources
       [1] Kenya National Guidelines for Management of Malaria — MoH Kenya · 2022
       [2] WHO Guidelines for Malaria — WHO · 2023

Physician: "Tell me more about source 1"

Qwiva: The Kenya National Guidelines for Management of Malaria (MoH, 2022)
       specifically states that AL should be taken twice daily with food or
       a fatty drink to improve lumefantrine absorption...
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Browser / Physician                 │
└────────────────────────┬─────────────────────────────┘
                         │ HTTPS · Supabase JWT
                         ▼
┌──────────────────────────────────────────────────────┐
│             Next.js 14  (Vercel)                     │
│  SearchBar · ConversationSidebar · AnswerCard        │
│  StreamingText · ChatInput                           │
└────────────────────────┬─────────────────────────────┘
                         │ SSE  POST /search/stream
                         ▼
┌──────────────────────────────────────────────────────┐
│              FastAPI  (Render)                       │
│                                                      │
│   ┌─────────────────────────────────────────────┐   │
│   │           Agentic Router                    │   │
│   │  classify(query, history) → rag | chat      │   │
│   └──────────────┬──────────────────────────────┘   │
│                  │                                   │
│         rag ◄────┴────► chat                         │
│          │                │                          │
│          ▼                ▼                          │
│   ┌─────────────┐  ┌────────────────┐               │
│   │ RAG Pipeline│  │ Direct respond │               │
│   │  1. Embed   │  │ from history   │               │
│   │  2. Retrieve│  └────────────────┘               │
│   │  3. RRF     │                                    │
│   │  4. Rerank  │                                    │
│   │  5. Generate│                                    │
│   └──────┬──────┘                                    │
│          │                                           │
└──────────┼───────────────────────────────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
 Qdrant       Supabase
 (vector)     (FTS + chat history)
    │             │
    └──────┬──────┘
           │ RRF merge
           ▼
     NVIDIA Reranker
           │ top-5 chunks
           ▼
    Claude via LiteLLM
           │ stream tokens
           ▼
     SSE → Browser
```

---

## RAG Pipeline

| Stage | Implementation | Detail |
|-------|---------------|--------|
| **Embed** | `text-embedding-3-small` | 1536-dim via OpenAI direct |
| **Vector search** | Qdrant HNSW | cosine similarity, top-12 |
| **Full-text search** | Supabase `wfts` | websearch operator, top-12 |
| **Merge** | Reciprocal Rank Fusion | k=60, deduplicates across both lists |
| **Rerank** | NVIDIA `llama-3.2-nv-rerankqa-1b-v2` | top-12 → top-5 |
| **Route** | Groq `llama-3.3-70b-versatile` | classify → `rag` or `chat` (~100ms) |
| **Generate** | Anthropic Claude (via LiteLLM) | streamed, grounded, prompt-cached |
| **Suggestions** | Groq `llama-3.3-70b-versatile` | history-aware follow-up questions |
| **Title** | Groq `llama-3.3-70b-versatile` | generated in parallel with RAG |

---

## Quick start

### Prerequisites

- Python 3.11+, [`uv`](https://github.com/astral-sh/uv)
- Node.js 18+
- Supabase project with the schema from `supabase/migrations/`
- Anthropic API key, OpenAI API key, Groq API key, NVIDIA API key
- Qdrant cloud cluster (or local)

### Backend

```bash
# From repo root
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"

cp .env.example .env
# Fill in required keys — see Environment variables below

uvicorn backend.main:app --reload
# → http://localhost:8000
# → http://localhost:8000/docs  (auto-generated API docs)
```

### Frontend

```bash
cd frontend
npm install

# Copy the frontend env vars from the root .env into frontend/.env.local
# (Next.js requires NEXT_PUBLIC_* vars in this file — it will not read the root .env)
cp ../.env.example frontend/.env.local   # then fill in your values, or:

cat > frontend/.env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_API_URL=http://localhost:8000
EOF

npm run dev
# → http://localhost:3000
```

> **Common mistake:** skipping `frontend/.env.local` causes a Supabase client crash on startup
> (`Your project's URL and API key are required`). The root `.env` is only read by the backend.

### Database

Run migrations in order against your Supabase project:

```sql
-- In the Supabase SQL editor, run in sequence:
-- supabase/migrations/000_initial_schema.sql   (documents_v2, pgvector, FTS)
-- supabase/migrations/001_metadata_optimisation.sql
-- supabase/migrations/002_chat_history.sql     (conversations, messages, RPCs)
```

---

## Environment variables

### Backend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✓ | Project URL from Supabase dashboard |
| `SUPABASE_SERVICE_KEY` | ✓ | Service role key (never expose to frontend) |
| `SUPABASE_JWT_SECRET` | ✓ | Legacy JWT secret — Settings → API → JWT Secret |
| `ANTHROPIC_API_KEY` | ✓ | LLM generation (`claude-sonnet-4-6` default) |
| `OPENAI_API_KEY` | ✓ | Embeddings (`text-embedding-3-small`) |
| `GROQ_API_KEY` | ✓ | Classify, title generation, follow-up suggestions |
| `NVIDIA_API_KEY` | ✓ | Reranker only |
| `NVIDIA_API_BASE` | | Default: `https://inference-api.nvidia.com/v1/` |
| `QDRANT_URL` | ✓ | Qdrant cluster URL |
| `QDRANT_API_KEY` | ✓ | Qdrant API key |
| `QDRANT_COLLECTION` | | Default: `qwiva_docs` |
| `LITELLM_MODEL` | | Default: `anthropic/claude-sonnet-4-6` |
| `CLASSIFY_MODEL` | | Default: `groq/llama-3.3-70b-versatile` |
| `FRONTEND_URL` | | CORS origin for your deployed frontend |
| `LANGFUSE_PUBLIC_KEY` | | Optional — enables LLM tracing via Langfuse |
| `LANGFUSE_SECRET_KEY` | | Optional |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend URL, e.g. `https://your-backend.onrender.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |

---

## Deployment

### Backend → Render

1. Connect your GitHub repo on [render.com](https://render.com) → **New Web Service**
2. Set **Environment** to Docker (Render detects the `Dockerfile` automatically)
3. Add all backend env vars under **Environment → Add Environment Variable**
4. Render uses the `Dockerfile` — the `CMD` runs `uvicorn` on `$PORT`

### Frontend → Vercel

1. Connect repo on [vercel.com](https://vercel.com) → set **Root Directory** to `frontend/`
2. Add environment variables: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. After deploy, update `FRONTEND_URL` in Render to your Vercel domain

---

## Evaluation harness

Qwiva ships with a professional eval suite covering latency, RAG quality, and clinical correctness.

```bash
# Install eval dependencies
uv pip install -e ".[eval]"

# Full suite — calls judge LLM (costs API credits)
python -m evals.run_evals

# Fast mode — code metrics only, no LLM judge (~1 min)
python -m evals.run_evals --skip-ragas --skip-deepeval --n 5

# Reload pipeline results and rerun judges only
python -m evals.run_evals --skip-pipeline --report evals/reports/20260319T220425Z.json
```

**Metrics collected:**

| Category | Metrics |
|----------|---------|
| **Latency** | p50 / p95 per stage: embed, retrieval, rerank, TTFT, total |
| **RAG quality** | Faithfulness, answer relevancy, context precision, context recall (RAGAS) |
| **Hallucination** | Hallucination score, contextual precision/recall (DeepEval) |
| **Clinical** | Citation present rate, source coverage rate, answer length |

Reports are saved to `evals/reports/` as both JSON and Markdown.

---

## Project structure

```
qwiva/
├── backend/
│   ├── main.py          # FastAPI app, routes, SSE streaming
│   ├── rag.py           # RAG pipeline + agentic router (classify, stream_search, stream_chat)
│   ├── models.py        # Pydantic models: Citation, SearchRequest, MessageOut, ...
│   ├── conversations.py # Conversation + message persistence (branching tree)
│   ├── auth.py          # Supabase JWT verification (HS256, local)
│   ├── config.py        # Pydantic Settings with lru_cache singleton
│   └── db.py            # Async Supabase client singleton
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx          # Main chat interface + state machine
│   │   ├── learn/page.tsx    # Learning Hub (CME credits, lesson tracks)
│   │   └── auth/login/       # Supabase email/password auth
│   ├── components/
│   │   ├── AnswerCard.tsx        # Answer + collapsible citations
│   │   ├── StreamingText.tsx     # Typewriter effect, citation compression [1][2]→[1-2]
│   │   ├── ConversationSidebar.tsx
│   │   ├── ChatInput.tsx
│   │   ├── Navbar.tsx
│   │   └── SearchBar.tsx
│   ├── lib/
│   │   ├── api.ts        # streamSearch() async generator, fetchConversations()
│   │   └── supabase.ts   # Browser Supabase client
│   └── types/index.ts    # Shared TypeScript types (SSEEvent, Citation, ChatMessage, ...)
│
├── evals/
│   ├── run_evals.py      # CLI entrypoint
│   ├── pipeline.py       # Per-stage latency capture
│   ├── dataset.py        # EvalQuestion dataclass
│   ├── datasets/
│   │   └── clinical_questions.json   # 35-question golden dataset
│   ├── metrics/
│   │   ├── clinical.py       # Citation rate, source coverage (code-based)
│   │   ├── latency.py        # p50/p95 per stage
│   │   ├── ragas_runner.py   # RAGAS judge integration
│   │   └── deepeval_runner.py
│   └── reports/          # Timestamped JSON + Markdown reports
│
├── supabase/migrations/
│   ├── 000_initial_schema.sql       # documents_v2, pgvector, FTS indexes
│   ├── 001_metadata_optimisation.sql
│   └── 002_chat_history.sql         # conversations, messages, get_active_path RPC
│
├── Dockerfile            # python:3.12-slim, uv install, uvicorn
├── pyproject.toml        # Dependencies, black + ruff config
└── .env.example          # All required environment variables
```

---

## Development

```bash
# Lint
ruff check backend/

# Format
black backend/

# Frontend lint
cd frontend && npm run lint

# Type check
cd frontend && npx tsc --noEmit
```

---

## Key design decisions

**Split provider strategy** — Groq LPU for latency-sensitive calls (classify, title, suggestions ~50–150ms), Anthropic for generation quality, NVIDIA for reranker only, OpenAI for embeddings.

**JWT auth** — Supabase HS256 tokens verified locally on the backend using `SUPABASE_JWT_SECRET`. No external call on every request.

**Agentic routing** — a classifier call (`max_tokens=5`) on Groq routes each message to either the full RAG pipeline or a direct response from conversation context. Clinical app defaults to RAG on classifier failure.

**Parallel title generation** — conversation title is generated via Groq in parallel with the RAG pipeline and emitted as a `title` SSE event before streaming starts. No blank-state flash in the sidebar.

**Prompt caching** — system prompt is wrapped with Anthropic `cache_control` to cache the large instruction block across calls.

**History-aware suggestions** — follow-up question suggestions are generated by Groq after streaming ends, conditioned on the full conversation history. Omitted for greetings and small talk.

**Citation grounding** — the first 400 characters of each retrieved chunk are stored with the citation. This excerpt surfaces in conversation history so follow-up questions about sources can be answered accurately without re-retrieval.

**Conversation tree** — messages form a tree (`parent_id` / `selected_child_id`) enabling edit-and-branch. The active path is reconstructed with a single recursive CTE (`get_active_path`).

**In-process TTL cache** — `list_conversations` (30s TTL) and `get_conversation` (5min TTL) are cached in-process to reduce Supabase round trips on every page load.

---

## Corpus

The knowledge base contains **82,000+ chunks** from:

- Kenya Clinical Guidelines (MoH)
- Kenya ARV Guidelines
- Kenya Essential Medicines List
- Kenya Basic Paediatric Protocols (5th Edition)
- WHO treatment guidelines (malaria, TB, HIV, nutrition, maternal health)
- RCOG and specialist society guidelines relevant to the Kenyan clinical context

All documents are chunked, embedded with `text-embedding-3-small` (1536-dim), and indexed in both Qdrant (HNSW cosine) and Supabase (tsvector FTS).
