---
marp: true
theme: default
class: invert
paginate: true
style: |
  section {
    background: #0f0f0f;
    color: #e8e8e8;
    font-family: 'Inter', system-ui, sans-serif;
  }
  h1 { color: #ffffff; font-size: 2rem; font-weight: 700; }
  h2 { color: #e8e8e8; font-size: 1.5rem; font-weight: 600; }
  h3 { color: #2dd4bf; font-size: 1.1rem; font-weight: 600; }
  code { background: #1a1a1a; color: #2dd4bf; border-radius: 4px; padding: 2px 6px; }
  pre { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 1rem; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #1a1a1a; color: #2dd4bf; padding: 8px 12px; border: 1px solid #2a2a2a; }
  td { padding: 8px 12px; border: 1px solid #2a2a2a; color: #d4d4d4; }
  strong { color: #ffffff; }
  .teal { color: #2dd4bf; }
  .muted { color: #6b6b6b; }
  blockquote { border-left: 3px solid #2dd4bf; padding-left: 1rem; color: #9a9a9a; }
---

# Qwiva
## Clinical Decision Support · System Architecture

Guideline-grounded AI for physicians at the point of care

---

## The Problem

Kenya's clinical workforce faces:

- **70+ clinical guidelines** across MoH, WHO, and specialist societies
- **No unified search** — guidelines live in PDFs, portals, physical binders
- **Point-of-care decisions** made without access to the latest protocols
- Protocols change — ARV regimens, malaria resistance maps, dosing thresholds

> A physician managing severe malaria at 2am should not be searching a PDF.

---

## What Qwiva Does

```
Physician asks:  "First-line malaria treatment in adults"

System:
  1. Retrieves the most relevant excerpts from 82,000+ guideline chunks
  2. Reranks them by relevance to the exact question
  3. Streams a precise, cited answer in real time

Physician sees:  The answer. With sources. In seconds.
```

Follow-up conversations work naturally — prior context and cited sources
are available throughout the session.

---

## System Overview

```
┌──────────────────────────────────────────────────────────┐
│                       Physician                          │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS · Supabase JWT
                            ▼
┌──────────────────────────────────────────────────────────┐
│              Next.js 14 Frontend  (Vercel)               │
└───────────────────────────┬──────────────────────────────┘
                            │ SSE stream
                            ▼
┌──────────────────────────────────────────────────────────┐
│              FastAPI Backend  (Render)                  │
│                                                          │
│   classify(query, history) ──► rag  OR  chat             │
│                                │         │               │
│                          RAG Pipeline   Direct reply     │
└──────────┬──────────────────┬────────────────────────────┘
           ▼                  ▼
        Qdrant            Supabase
      (vector DB)     (FTS + chat history)
           └──── RRF merge ────┘
                     │
              NVIDIA Reranker
                     │
           Claude via LiteLLM
                     │
              SSE → Browser
```

---

## Database Design

### Three tiers of storage

| Store | Technology | Purpose |
|---|---|---|
| **Vector store** | Qdrant (HNSW) | Dense semantic search |
| **Document store** | Supabase PostgreSQL | Full-text search + metadata |
| **Chat history** | Supabase PostgreSQL | Conversations + message tree |

---

## Database: `documents_v2`

The core knowledge base — 82,000+ chunks from clinical guidelines.

```sql
CREATE TABLE documents_v2 (
  id        BIGSERIAL   PRIMARY KEY,
  content   TEXT        NOT NULL,
  embedding vector(1536),              -- text-embedding-3-small
  metadata  JSONB       NOT NULL,      -- guideline_title, publisher, year,
                                       -- cascading_path, doc_id, chunk_index
  fts       TSVECTOR                   -- populated at ingestion
);

-- HNSW cosine similarity index (pgvector)
CREATE INDEX ON documents_v2 USING hnsw (embedding vector_cosine_ops);

-- GIN full-text search index
CREATE INDEX ON documents_v2 USING gin (fts);
```

> Metadata key: `cascading_path` = `"Chapter 3 > 3.2 > Treatment"` — breadcrumb used as citation section.

---

## Database: Conversation Tree

Messages form a **tree**, not a list. Each message has a `parent_id` and a `selected_child_id`.

```
User: "What is the malaria treatment?"
  └── Assistant: "Artemether-lumefantrine..." [branch 0]

User: "What about in pregnancy?" [branch 0 continues]
  └── Assistant: "In pregnancy, AL is still recommended..."

User: [edits earlier question] "Treatment in severe malaria?" [branch 1]
  └── Assistant: "IV artesunate for at least 24 hours..."
```

The **active path** is reconstructed with a single recursive CTE:

```sql
WITH RECURSIVE path AS (
  SELECT * FROM messages WHERE parent_id IS NULL AND conversation_id = $1
  UNION ALL
  SELECT m.* FROM messages m
  INNER JOIN path p ON m.id = p.selected_child_id  -- follow active branch
)
SELECT * FROM path ORDER BY created_at;
```

---

## Database: `conversations` + `messages`

```sql
CREATE TABLE conversations (
  id              UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID  REFERENCES auth.users(id),
  title           TEXT,                   -- auto-generated on first exchange
  title_generated BOOLEAN DEFAULT FALSE,
  updated_at      TIMESTAMPTZ             -- bumped by trigger on each message
);

CREATE TABLE messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id         UUID REFERENCES messages(id),
  selected_child_id UUID REFERENCES messages(id),  -- active branch pointer
  role              TEXT CHECK (role IN ('user', 'assistant')),
  content           TEXT,
  citations         JSONB,       -- [{index, guideline_title, excerpt, ...}]
  evidence_grade    TEXT,
  branch_index      INT DEFAULT 0
);
```

Row Level Security enforces user isolation at the DB level.

---

## RAG Pipeline

### Five stages, all async

```
Query: "First-line malaria treatment in adults"
  │
  ├─ 1. EMBED  ── text-embedding-3-small (1536-dim) via NVIDIA hub
  │
  ├─ 2. RETRIEVE (parallel)
  │      ├── Qdrant HNSW vector search    → top 12 chunks
  │      └── Supabase websearch FTS       → top 12 chunks
  │
  ├─ 3. MERGE  ── Reciprocal Rank Fusion (k=60)
  │                deduplicated, re-ranked list
  │
  ├─ 4. RERANK ── NVIDIA llama-3.2-nv-rerankqa-1b-v2
  │                top 12 → top 5 most relevant chunks
  │
  └─ 5. GENERATE ── claude-sonnet-4-6 via LiteLLM
                    grounded prompt + conversation history
                    streamed token-by-token via SSE
```

---

## RAG Pipeline: Retrieval Detail

### Why hybrid search?

| Method | Strengths | Weaknesses |
|---|---|---|
| **Dense (Qdrant)** | Semantic similarity, handles paraphrase | Misses exact drug names, dosing |
| **Sparse (FTS)** | Exact term matching, drug names, codes | No semantic understanding |
| **RRF merge** | Best of both, score-agnostic | Needs both indices populated |

### Reciprocal Rank Fusion

```python
score(chunk) = Σ  1 / (k + rank_in_list)
              lists

# k=60 dampens the effect of very high ranks
# Chunks appearing in both lists score highest
```

---

## RAG Pipeline: Semantic Cache

Identical or near-identical queries bypass retrieval and generation entirely.

```python
class _SemanticCache:
    threshold = 0.92   # cosine similarity
    ttl       = 86400  # 24 hours
    max_size  = 512    # LRU eviction

def lookup(embedding) → CachedResult | None:
    # Find stored entry with cosine similarity ≥ 0.92
    # If found: stream the cached answer token-by-token
    # If not:   run full pipeline, store result
```

A cached response still streams through the typewriter effect — the UX is identical.

---

## Agentic Routing

Not every message needs the RAG pipeline.

```
Physician: "Thank you"              → classify() → "chat"  → direct reply
Physician: "What does that mean?"   → classify() → "chat"  → answer from history
Physician: "IV artesunate dosing"   → classify() → "rag"   → full pipeline
```

### The classifier

```python
async def classify(query: str, history: list[dict]) -> "rag" | "chat":
    # One LLM call: max_tokens=5, temperature=0
    # Prompt includes last 4 messages for follow-up context
    # Defaults to "rag" on failure — safe for a clinical app
```

**Cost:** ~100ms extra latency. **Benefit:** eliminates unnecessary retrieval for ~30% of messages in a typical conversation.

---

## Agentic Routing: Memory

Conversation history is passed to the LLM for both RAG and chat modes.

### What's in history

```
ASSISTANT: For uncomplicated P. falciparum malaria, the first-line
           regimen is Artemether-Lumefantrine (AL)... [1]

Referenced sources:
[1] Kenya National Guidelines for Management of Malaria — MoH Kenya · 2022
    Excerpt: "Artemether-Lumefantrine (AL) should be given as a fixed-dose
              combination over three days, twice daily with food..."
[2] WHO Guidelines for Malaria — WHO · 2023
    Excerpt: "ACT is recommended for all malaria cases regardless of..."
```

The **excerpt** (400 chars of retrieved chunk content) is stored with each citation. This allows accurate follow-up answers like "describe source 1" without re-retrieval.

---

## Agentic Routing: Context Budget

```python
def _trim_history(history, max_turns=6, max_chars=8000):
    """Keep recent messages within a token budget."""
    # Takes the last 6 messages
    # Hard cap at 8,000 characters total
    # Prevents context window blowout on long conversations
```

### Message chain sent to LLM

```
[system prompt]
[TURN 1] user: "What is malaria treatment?"
[TURN 1] assistant: "AL is first-line... [sources: WHO 2023, excerpt: ...]"
[TURN 2] user: "What about in pregnancy?"
[TURN 2] assistant: "AL is still recommended in 2nd/3rd trimester..."
[current] user: "Tell me about the WHO source"
               + [guideline excerpts if RAG mode]
```

---

## Backend Architecture

### `backend/` module map

```
main.py          FastAPI app
  ├── /health                    GET  — liveness probe
  ├── /me                        GET  — authenticated user profile
  ├── /conversations             GET  — list (50, ordered by updated_at)
  ├── /conversations             POST — create new
  ├── /conversations/{id}/messages GET — active path (recursive CTE)
  ├── /conversations/{id}/messages/{id}/siblings GET — branch switcher
  ├── /conversations/{id}/messages/{id}/branch   PATCH — switch branch
  ├── /conversations/{id}/title  PATCH — set/update title
  ├── /conversations/{id}        DELETE
  └── /search/stream             POST — SSE stream (main endpoint)

rag.py           QwivaRAG class
  ├── classify()       → rag | chat
  ├── stream_search()  → SSE generator (full pipeline)
  ├── stream_chat()    → SSE generator (direct, no retrieval)
  └── _generate_stream(), _hybrid_search(), _rerank(), _embed()

auth.py          Supabase JWT verification (HS256, local, no network call)
conversations.py All DB read/write for conversations and messages
config.py        Pydantic Settings + lru_cache singleton
db.py            Async Supabase client singleton (service key)
models.py        Citation, SearchRequest, MessageOut, ConversationSummary, ...
```

---

## Backend: SSE Contract

```
POST /search/stream
Authorization: Bearer <supabase_jwt>

event: conversation
data: {"conversation_id": "...", "user_message_id": "..."}

event: status
data: {"message": "Searching guidelines…"}

event: citations
data: {
  "citations": [
    {"index": 1, "guideline_title": "...", "publisher": "...",
     "year": "2022", "excerpt": "...first 400 chars..."}
  ],
  "evidence_grade": "Clinical Guideline · WHO"
}

event: token
data: {"token": "Artemether"}

... (one event per token) ...

event: done
data: {"assistant_message_id": "..."}

event: title          (first turn only)
data: {"conversation_id": "...", "title": "Malaria treatment adults"}
```

---

## Backend: Auth Flow

```
Browser                  FastAPI                  Supabase
   │                        │                        │
   │── POST /search/stream ──►                        │
   │   Authorization: Bearer <JWT>                    │
   │                        │                        │
   │                        │── verify_token() ──────►│
   │                        │   decode JWT locally    │
   │                        │   HS256 + SUPABASE_JWT_SECRET
   │                        │   no network call       │
   │                        │◄── UserProfile ─────────│
   │                        │   {user_id, email}      │
   │                        │                        │
   │◄── SSE stream ──────────│                        │
```

JWT verification is **local** — using `PyJWT` and `SUPABASE_JWT_SECRET`. No round-trip to Supabase on every request.

---

## Frontend Architecture

### App structure

```
app/
  page.tsx          Main chat interface
  learn/page.tsx    Learning Hub (CME tracking)
  auth/login/       Supabase email/password

components/
  Navbar.tsx            Top nav · Search / Learn · Sign out
  ConversationSidebar.tsx  Left sidebar · list + delete · auto-title
  ChatInput.tsx         Message input · submit
  AnswerCard.tsx        Answer + collapsible citations (max 3 visible)
  StreamingText.tsx     Markdown render + typewriter + [1][2]→[1-2]
  SearchBar.tsx         Hero search input

lib/
  api.ts        streamSearch() async generator · fetchConversations()
  supabase.ts   Browser Supabase client · getAccessToken()

types/index.ts  Citation · ChatMessage · SSEEvent · SearchState · ...
```

---

## Frontend: State Machine

`page.tsx` manages a conversation state machine:

```typescript
type SearchStatus = 'idle' | 'searching' | 'streaming' | 'done' | 'error'

interface SearchState {
  status: SearchStatus
  statusMessage: string   // "Searching guidelines…"
  answer: string          // accumulated tokens
  citations: Citation[]
  evidence_grade: string
  error: string | null
}
```

### SSE event → state transition

| SSE Event | State change |
|---|---|
| `conversation` | Set `conversation_id`, `user_message_id` |
| `status` | Update `statusMessage` |
| `citations` | Set `citations`, move to `streaming` |
| `token` | Append to `answer` |
| `done` | Move to `done`, run `renumberByAppearance()` |
| `title` | Update sidebar with auto-generated title |
| `error` | Move to `error`, show retry button |

---

## Frontend: Streaming Text

`StreamingText.tsx` renders streamed Markdown with three behaviours:

### 1. Typewriter effect
```typescript
// Advances 4 characters per 16ms frame (~240 chars/sec)
// Decoupled from SSE arrival rate — smooth regardless of network
posRef.current = Math.min(posRef.current + 4, target.length)
```

### 2. Citation compression
```
[1][2][3][4]  →  [1-4]
[1][2][5]     →  [1-2][5]
```

### 3. Inline citation badges
```typescript
// [1] → <cite data-n="1">1</cite>
// Rendered as a teal superscript badge via ReactMarkdown custom component
processed = text.replace(/\[(\d+(?:-\d+)?)\]/g, '<cite data-n="$1">$1</cite>')
```

---

## Frontend: Citation Display

`AnswerCard.tsx` keeps citations compact and un-cluttered:

- **Max 3 visible** by default; `+N more sources` toggle
- **Title + publisher · year** only — no section path (too granular)
- Citations section hidden entirely when there are none (chat mode)

```typescript
const MAX_VISIBLE = 3
const visible = showAll ? citations : citations.slice(0, MAX_VISIBLE)
const hiddenCount = citations.length - MAX_VISIBLE
```

The `section` (cascading path like `"Chapter 3 > 3.2 > Treatment"`) is stored in the DB but intentionally omitted from the UI — it's available for future deep-linking to the source document.

---

## Deployment

```
┌─────────────────────┐     ┌─────────────────────┐
│   Vercel (free)     │     │   Render (free)     │
│                     │     │                      │
│   Next.js frontend  │────►│   FastAPI backend    │
│   Edge network      │     │   Docker container   │
│   Auto-deploy main  │     │   /health probe      │
└─────────────────────┘     └──────────┬───────────┘
                                        │
            ┌───────────────────────────┼────────────────┐
            ▼                           ▼                ▼
   ┌─────────────────┐      ┌───────────────────┐  ┌──────────────┐
   │  Supabase       │      │  Qdrant Cloud     │  │ NVIDIA Hub   │
   │  PostgreSQL     │      │  Vector store     │  │ Embeddings   │
   │  Auth           │      │  HNSW index       │  │ LLM (Claude) │
   │  Row-level sec  │      │  82k vectors      │  │ Reranker     │
   └─────────────────┘      └───────────────────┘  └──────────────┘
```

**One API key** — `NVIDIA_API_KEY` covers all three inference services.

---

## Evaluation Harness

### Why we built it

The RAG pipeline has 5 stages. A regression in any one reduces answer quality in ways that aren't visible from manual testing.

```
python -m evals.run_evals --skip-ragas --skip-deepeval  # ~1min, free
python -m evals.run_evals                               # full suite
```

### Metrics

| Layer | Metric | Method |
|---|---|---|
| Latency | p50/p95 per stage | Code — `time.perf_counter()` |
| Retrieval | Source coverage rate | Code — keyword match |
| Generation | Citation present rate | Code — regex |
| RAG quality | Faithfulness, relevancy, precision, recall | RAGAS (LLM judge) |
| Hallucination | Hallucination score, contextual recall | DeepEval (LLM judge) |

Reports written to `evals/reports/` as JSON + Markdown on every run.

---

## Evaluation: Pipeline Design

```python
# pipeline.py captures per-stage latencies directly from RAG internals

t = time.perf_counter()
embedding = await rag._embed(question)
embed_ms = (time.perf_counter() - t) * 1000

t = time.perf_counter()
chunks = await rag._hybrid_search(question, embedding)
retrieval_ms = (time.perf_counter() - t) * 1000

t = time.perf_counter()
reranked = await rag._rerank(question, chunks)
rerank_ms = (time.perf_counter() - t) * 1000

# ... capture TTFT and full generation time ...
```

The eval pipeline calls RAG **internals directly** — same code path as production, with no HTTP overhead from going through the API.

---

## Summary

| Component | Technology | Role |
|---|---|---|
| Frontend | Next.js 14, Tailwind, React 18 | Chat UI, streaming, conversation branching |
| Backend | FastAPI, Python 3.11 | Routing, RAG pipeline, auth, SSE |
| Vector DB | Qdrant (HNSW) | Dense semantic retrieval |
| Document DB | Supabase PostgreSQL | FTS, chat history, auth, RLS |
| Embeddings | `text-embedding-3-small` | 1536-dim via NVIDIA hub |
| LLM | `claude-sonnet-4-6` | Generation via LiteLLM |
| Reranker | NVIDIA `llama-3.2-nv-rerankqa-1b-v2` | top-12 → top-5 |
| Auth | Supabase JWT (HS256, local verify) | Physician authentication |
| Observability | Langfuse | LLM call tracing |
| Deployment | Render + Vercel | Backend + frontend hosting |
| Evals | RAGAS + DeepEval + custom | RAG quality regression |

---

<div style="text-align: center; padding: 4rem 0;">

# Qwiva

**Clinical knowledge, at the point of care.**

`github.com/benrandoing20/qwiva`

</div>
