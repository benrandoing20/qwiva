# Qwiva

Guideline-grounded clinical search for physicians in Kenya.

## Quick start

### Backend

```bash
# From repo root
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
cp .env.example .env   # fill in your keys
uvicorn backend.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
cp ../.env.example .env.local   # fill in NEXT_PUBLIC_* vars
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
Query
  │
  ├─ OpenAI text-embedding-3-large
  │
  ├─ asyncio.gather()
  │    ├─ Supabase HNSW vector search  (top 20)
  │    └─ Supabase full-text search    (top 20)
  │
  ├─ Reciprocal Rank Fusion → deduplicated ranked list
  │
  ├─ Cohere rerank → top 5 chunks
  │
  └─ gpt-4o via LiteLLM → streamed grounded answer
        │
        SSE stream:  citations event → token events → done event
```

## Environment variables

See `.env.example`. The `SUPABASE_JWT_SECRET` is found in your Supabase project under **Settings → API → JWT Secret**.
