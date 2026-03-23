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
    font-size: 0.88rem;
    padding: 2rem 2.5rem;
  }
  h1 { color: #ffffff; font-size: 1.9rem; font-weight: 700; margin-bottom: 0.4rem; }
  h2 { color: #e8e8e8; font-size: 1.4rem; font-weight: 600; margin-bottom: 0.6rem; }
  h3 { color: #2dd4bf; font-size: 1rem; font-weight: 600; margin: 0.8rem 0 0.4rem; }
  h4 { color: #9a9a9a; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; margin: 0.6rem 0 0.3rem; }
  code { background: #1a1a1a; color: #2dd4bf; border-radius: 4px; padding: 2px 6px; font-size: 0.82em; }
  pre { background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.78em; line-height: 1.5; }
  pre code { background: transparent; padding: 0; color: #d4d4d4; }
  table { border-collapse: collapse; width: 100%; font-size: 0.82em; }
  th { background: #1a1a1a; color: #2dd4bf; padding: 6px 10px; border: 1px solid #2a2a2a; }
  td { padding: 6px 10px; border: 1px solid #2a2a2a; color: #d4d4d4; }
  strong { color: #ffffff; }
  em { color: #9a9a9a; }
  ul { margin: 0.4rem 0; }
  li { margin: 0.2rem 0; line-height: 1.5; }
  blockquote { border-left: 3px solid #2dd4bf; padding-left: 1rem; color: #9a9a9a; margin: 0.8rem 0; font-style: italic; }
  hr { border-color: #2a2a2a; margin: 0.8rem 0; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .columns3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
  .box { background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; padding: 0.8rem 1rem; }
  .teal { color: #2dd4bf; }
  .muted { color: #6b6b6b; }
  .warn { color: #f59e0b; }
  .dim { color: #4a4a4a; font-size: 0.78em; }
---

# Qwiva — System Architecture
## A Complete Technical Reference

*Guideline-grounded clinical decision support for physicians at the point of care*

---

## Table of Contents

1. **The User Journey** — what the physician experiences
2. **Frontend Structure** — React component tree and state machine
3. **Authentication** — Supabase JWT end-to-end
4. **Frontend → Backend Protocol** — SSE streaming contract
5. **RAG Pipeline** — all 5 stages in detail
6. **Agentic Routing** — classify, title, suggestions
7. **LLM Provider Strategy** — why three providers
8. **Supabase Schema** — documents, conversations, messages
9. **Qdrant Schema** — vector store structure
10. **Conversation Tree** — branching message graph
11. **Caching** — semantic cache + TTL cache
12. **Citation Pipeline** — dedup → renumber → display
13. **Networking** — latency budget per stage
14. **Deployment** — Render + Vercel + external services

---

## 1 · The User Journey

> A physician at 2am needs the first-line treatment for severe malaria.

### What they do (5 steps)

1. Opens `qwiva.com` → redirected to `/auth/login` if not authenticated
2. Signs in with email/password → Supabase issues a JWT
3. Types: *"IV artesunate dosing in severe malaria"*
4. Sees: animated dots → citations appear → answer streams word-by-word
5. Clicks a follow-up suggestion or types the next question

### What happens behind the scenes

```
Browser                HTTPS/SSE               FastAPI (Render)
  │── POST /search/stream ──────────────────────► │
  │   Bearer: <supabase_jwt>                       │ verify JWT locally
  │   body: { query, conversation_id? }            │ embed → retrieve → rerank
  │                                                │ classify → generate
  │◄── event: conversation ────────────────────── │ persist user msg to Supabase
  │◄── event: status       ────────────────────── │ "Searching guidelines…"
  │◄── event: citations    ────────────────────── │ top-5 sources
  │◄── event: token (×N)   ────────────────────── │ stream answer char-by-char
  │◄── event: suggestions  ────────────────────── │ 3 follow-up questions
  │◄── event: done         ────────────────────── │ persist assistant msg
  │◄── event: title        ────────────────────── │ auto-generated title (new convos)
```

---

## 2 · Frontend Structure

### File Map

```
frontend/
├── app/
│   ├── layout.tsx              Root layout — Navbar + children
│   ├── page.tsx                ★ Main chat interface (entire state machine lives here)
│   ├── learn/page.tsx          Learning Hub — CME credits, lesson tracks
│   └── auth/login/page.tsx     Email/password sign-in + create-account
│
├── components/
│   ├── Navbar.tsx              Fixed top bar — logo, Search/Learn links, sign-out
│   ├── ConversationSidebar.tsx Left sidebar — list, new, delete, active highlight
│   ├── ChatInput.tsx           Auto-grow textarea — Enter=send, Shift+Enter=newline
│   ├── SearchBar.tsx           Hero search form (first-message only)
│   ├── AnswerCard.tsx          Answer + collapsible citations + suggestions
│   └── StreamingText.tsx       Markdown render + [1][2]→[1-2] compression
│
├── lib/
│   ├── api.ts                  streamSearch() + REST conversation helpers
│   └── supabase.ts             Browser Supabase client + getAccessToken()
│
└── types/index.ts              All shared TypeScript types
```

---

## 2 · Frontend State Machine (`page.tsx`)

### State shape

```typescript
// Conversation list (sidebar)
conversations: Conversation[]
activeConversationId: string | null

// Messages for current conversation
messages: ChatMessage[]   // { id, role, content, citations, isStreaming, suggestions, ... }

// Input
inputValue: string
isLoading: boolean        // true while streaming

// Refs (not state — no re-render)
lastAssistantIdRef    // parent_message_id for the NEXT turn
tokenBufferRef        // accumulates tokens between rAF flushes
rafIdRef              // cancelAnimationFrame handle
```

### Transitions

| Event | Action |
|---|---|
| User submits query | Optimistic user msg added; streaming begins |
| SSE `conversation` | Store `conversation_id` and `user_message_id` |
| SSE `status` | Update `statusMessage` on last message |
| SSE `citations` | Store citations on last message; status → `streaming` |
| SSE `token` | Push to `tokenBufferRef`; rAF flush every ~16ms |
| SSE `suggestions` | Store `suggestions` on last message |
| SSE `done` | Cancel rAF; run `renumberByAppearance()`; mark done |
| SSE `title` | Add/update conversation in sidebar |
| SSE `error` | Set `isError: true` on last message |
| Click sidebar item | `fetchConversationMessages()` → `setMessages()` |
| Click "New" | Clear messages, clear `activeConversationId` |

---

## 2 · `renumberByAppearance()` — Why It Exists

The LLM numbers citations `[1][2][3]` in the order it first references them. After streaming, the frontend reorders citation objects to match their appearance order in the text.

```typescript
function renumberByAppearance(answer: string, citations: Citation[]) {
  // 1. Walk the answer text left-to-right, collect [N] refs in order
  const order: number[] = []
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = parseInt(m[1])
    if (!order.includes(n)) order.push(n)
  }
  // 2. Build a remapping: oldIndex → newIndex
  const remap = new Map(order.map((old, i) => [old, i + 1]))
  // 3. Rewrite [N] in the answer text
  const rewritten = answer.replace(/\[(\d+)\]/g, (_, n) => `[${remap.get(+n) ?? n}]`)
  // 4. Re-sort citations array to match
  const reordered = order.map(old => ({
    ...citations.find(c => c.index === old)!,
    index: remap.get(old)!,
  }))
  return { answer: rewritten, citations: reordered }
}
```

> This runs once when `done` arrives — not during streaming — so it never causes mid-stream flicker.

---

## 3 · Authentication

### Overview

Qwiva uses **Supabase Auth** for identity. Supabase issues standard JWTs (HS256) that the FastAPI backend verifies **locally** — no round-trip to Supabase on every request.

### Frontend side (`lib/supabase.ts`)

```typescript
// Browser-side Supabase client — uses the PUBLIC anon key only
// This key is safe to expose; it cannot bypass Row Level Security
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Used before every API call
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
```

### Login flow (`app/auth/login/page.tsx`)

```
User fills email + password
  → supabase.auth.signInWithPassword({ email, password })
  → Supabase validates against auth.users
  → Issues JWT signed with SUPABASE_JWT_SECRET (HS256)
  → JWT stored in browser (cookie / localStorage by Supabase SDK)
  → router.push('/') — main page
```

---

## 3 · Authentication — Backend Verification (`auth.py`)

```python
async def verify_token(
    authorization: str = Header(...)
) -> UserProfile:
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,   # HS256 secret key
            algorithms=["HS256"],
            options={"verify_aud": False},   # Supabase quirk — audience not set
        )
        return UserProfile(
            user_id=payload["sub"],          # Supabase user UUID
            email=payload.get("email", ""),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
```

### Key points

- **No network call**: JWT contains the user identity. The backend just cryptographically verifies the signature.
- **`verify_aud: False`**: Supabase doesn't set the `aud` claim in legacy tokens.
- **Every protected endpoint** uses `Depends(verify_token)` — FastAPI injects `UserProfile` automatically.
- **Service key vs anon key**: The backend uses `SUPABASE_SERVICE_KEY` for all DB operations, which bypasses Supabase RLS. All queries explicitly filter by `user_id` for isolation.

---

## 4 · Frontend → Backend Protocol

### The SSE contract

The main endpoint is `POST /search/stream`. It returns a persistent HTTP connection with `Content-Type: text/event-stream`.

```
POST /search/stream
Authorization: Bearer <supabase_jwt>
Content-Type: application/json

{ "query": "...", "conversation_id": "uuid|null", "parent_message_id": "uuid|null" }
```

Each SSE message is two lines followed by a blank line:

```
event: <name>
data: <json>

```

### Full event sequence

```
event: conversation   → { conversation_id, user_message_id }          # always first
event: status         → { message: "Searching guidelines…" }          # during retrieval
event: citations      → { citations: [...], evidence_grade: "..." }    # after rerank
event: status         → { message: "Generating answer…" }             # before generate
event: token          → { token: "The " }                             # × N (one per LLM token)
event: suggestions    → { suggestions: ["...", "..."] }               # after generation
event: done           → { assistant_message_id }                      # always last
event: title          → { conversation_id, title }                    # first turn only
```

---

## 4 · How the Frontend Parses SSE (`lib/api.ts`)

```typescript
export async function* streamSearch(
  query: string,
  token: string,
  conversationId?: string,
  parentMessageId?: string,
): AsyncGenerator<SSEEvent> {
  const response = await fetch(`${API_URL}/search/stream`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, conversation_id: conversationId, parent_message_id: parentMessageId }),
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE blocks are separated by double newline
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop()!   // keep partial last block

    for (const block of blocks) {
      const eventLine = block.match(/^event: (.+)$/m)?.[1]
      const dataLine  = block.match(/^data: (.+)$/ms)?.[1]
      if (eventLine && dataLine) {
        yield { event: eventLine, data: JSON.parse(dataLine) } as SSEEvent
      }
    }
  }
}
```

> The generator is consumed in `handleSearch()` inside `page.tsx` with `for await (const evt of streamSearch(...))`.

---

## 5 · RAG Pipeline — Overview

```
Query: "IV artesunate dosing in severe malaria"
  │
  ├─ [STAGE 0] SEMANTIC CACHE ──── cosine lookup (0.92 threshold, 24hr TTL)
  │             cache hit? → stream cached answer, skip all below
  │
  ├─ [STAGE 1] EMBED ─────────── text-embedding-3-small (1536-dim) via NVIDIA
  │             ~60–100ms
  │
  ├─ [STAGE 2] HYBRID RETRIEVE ── parallel: vector + FTS → RRF merge
  │             ~120–200ms       top 12 chunks from Qdrant + top 12 from Supabase
  │
  ├─ [STAGE 3] RERANK ────────── NVIDIA llama-3.2-nv-rerankqa-1b-v2 HTTP POST
  │             ~100–200ms       top 12 → top 5 (scored by relevance to exact query)
  │
  ├─ [STAGE 4] CLASSIFY ──────── groq/llama-3.3-70b-versatile (max_tokens=5)
  │             ~50–100ms        "rag" or "chat" (runs after embed/retrieve; overlaps rerank)
  │
  └─ [STAGE 5] GENERATE ──────── anthropic/claude-sonnet-4-6 via LiteLLM
                ~500–2000ms TTFT system prompt cached, streamed token-by-token
```

**Total p50 latency**: ~800ms to first token on a warm backend.

---

## 5 · Stage 1 — Embedding

```python
@cached_property
def _openai(self) -> AsyncOpenAI:
    # Uses OpenAI direct if OPENAI_API_KEY is set; NVIDIA hub otherwise
    if self._settings.openai_api_key:
        return AsyncOpenAI(api_key=self._settings.openai_api_key)
    return AsyncOpenAI(
        api_key=self._settings.nvidia_api_key,
        base_url=self._settings.nvidia_api_base,   # "https://inference-api.nvidia.com/v1/"
    )

async def _embed(self, text: str) -> list[float]:
    resp = await self._openai.embeddings.create(
        model="azure/openai/text-embedding-3-small",  # NVIDIA-specific model path
        input=text,
    )
    return resp.data[0].embedding   # 1536-dimensional float list
```

### Why this model

- **`text-embedding-3-small`** (1536-dim): chosen at ingestion time — cannot change without re-embedding all 82k chunks.
- NVIDIA hub serves the OpenAI embedding API at their endpoint, so the same `openai` SDK works.
- The prefix `azure/openai/` is required by the NVIDIA routing layer; plain `text-embedding-3-small` returns 401.

---

## 5 · Stage 2 — Hybrid Retrieval

Two searches run in parallel via `asyncio.gather`:

```python
vector_hits, fts_hits = await asyncio.gather(
    self._vector_search(embedding, top_k),   # Qdrant
    self._fts_search(query, top_k),          # Supabase
)
```

### Vector search (Qdrant)

```python
async def _vector_search(self, embedding, top_k) -> list[Chunk]:
    results = await self._qdrant.query_points(
        collection_name=self._settings.qdrant_collection,
        query=embedding,
        limit=top_k,
        with_payload=True,
    )
    return [self._qdrant_hit_to_chunk(hit) for hit in results.points]
```

### Full-text search (Supabase)

```python
async def _fts_search(self, query, top_k) -> list[Chunk]:
    db = await get_db()
    rows = await db.table("documents_v2") \
        .select("id, content, metadata") \
        .filter("fts", "wfts", query) \          # websearch operator: "AND" by default
        .limit(top_k) \
        .execute()
    return [self._row_to_chunk(row) for row in rows.data]
```

> `wfts` = *websearch to tsquery* — handles `"severe malaria"` as phrase, `artesunate OR quinine` as OR.

---

## 5 · Stage 2 — RRF Merge

After retrieval, the two ranked lists are merged using **Reciprocal Rank Fusion** (k=60):

```python
def _rrf_merge(
    self,
    dense: list[Chunk],   # Qdrant results, position 0 = best
    sparse: list[Chunk],  # Supabase FTS results
) -> list[Chunk]:
    scores: dict[str, float] = {}
    seen:   dict[str, Chunk]  = {}

    for rank, chunk in enumerate(dense):
        scores[chunk.id] = scores.get(chunk.id, 0) + 1 / (self._settings.rrf_k + rank + 1)
        seen[chunk.id] = chunk

    for rank, chunk in enumerate(sparse):
        scores[chunk.id] = scores.get(chunk.id, 0) + 1 / (self._settings.rrf_k + rank + 1)
        seen[chunk.id] = chunk

    # Sort by combined score, highest first
    return [seen[cid] for cid in sorted(scores, key=scores.__getitem__, reverse=True)]
```

### Why RRF over score-based fusion

- Dense and sparse scores are not comparable in magnitude.
- RRF is purely rank-based — immune to score distribution differences.
- `k=60` dampens outlier-high-rank effects; chunks appearing in **both** lists naturally score highest.

---

## 5 · Stage 3 — Reranking

```python
async def _rerank(self, query: str, chunks: list[Chunk]) -> list[Chunk]:
    payload = {
        "model": self._settings.rerank_model,  # "nvidia/llama-3.2-nv-rerankqa-1b-v2"
        "query": {"text": query},
        "passages": [{"text": c.content} for c in chunks],
    }
    resp = await self._http.post(
        self._settings.rerank_base_url,         # "https://inference-api.nvidia.com/v1/rerank"
        json=payload,
        headers={"Authorization": f"Bearer {self._settings.nvidia_api_key}"},
    )
    # IMPORTANT: NVIDIA returns ALL passages sorted — we must slice ourselves
    results = resp.json()["rankings"]
    results = results[: self._settings.rerank_top_n]   # top 5

    # Re-order chunks to match reranker's ranking
    return [chunks[r["index"]] for r in results]
```

### Why rerank after RRF

RRF uses positional signals only. The reranker model actually reads the query + passage pair and scores semantic relevance. A chunk that ranks #8 in vector search but #3 in FTS might score as the most relevant passage — the reranker catches this.

**Cost of NOT reranking**: the LLM receives 12 chunks (many irrelevant) instead of 5, bloating the prompt ~3×.

---

## 5 · Stage 4 — Prompt Construction

After reranking, the top-5 chunks are formatted into a context block:

```python
def _build_citations(self, chunks: list[Chunk]) -> tuple[list[Citation], str]:
    seen_titles: dict[str, int] = {}   # guideline_title → citation index
    citations: list[Citation] = []

    for chunk in chunks:
        title = chunk.metadata.get("guideline_title", "Unknown")
        if title not in seen_titles:
            idx = len(citations) + 1
            seen_titles[title] = idx
            citations.append(Citation(
                index=idx,
                guideline_title=title,
                publisher=chunk.metadata.get("publisher", ""),
                year=chunk.metadata.get("year", ""),
                section=chunk.metadata.get("cascading_path", ""),
                excerpt=chunk.content[:400],       # first 400 chars stored for follow-ups
                source_url=chunk.metadata.get("source_url", ""),
            ))

    # Build the sources block injected into the LLM prompt
    sources_text = "\n\n".join(
        f"[{seen_titles[c.metadata['guideline_title']]}] "
        f"{c.metadata.get('guideline_title')} ({c.metadata.get('year', '')})\n{c.content}"
        for c in chunks
    )
    return citations, sources_text
```

> Deduplication happens here: if two chunks come from the same guideline, they share an index. The LLM will cite `[1]` twice for that guideline rather than `[1]` and `[3]`.

---

## 5 · Stage 4 — System Prompt & Prompt Caching

```python
_SYSTEM_PROMPT = """
You are Qwiva, a clinical decision-support assistant for physicians in Kenya.
Your role is to surface what clinical guidelines recommend — not to instruct.
The physician makes the clinical decision.
...
"""

# Anthropic prompt caching — wraps the system prompt in cache_control.
# On subsequent calls, the ~800-token system prompt is cached server-side.
# Saves ~200ms TTFT and reduces input token cost by 90% after first call.
messages = [
    {
        "role": "system",
        "content": [
            {
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},  # Anthropic cache token
            }
        ],
    },
    *history_messages,    # last 6 messages from conversation
    {
        "role": "user",
        "content": USER_TEMPLATE.format(question=query, sources=sources_text),
    },
]
```

The `cache_control` block is injected via `extra_body` in LiteLLM. Anthropic's cache TTL is 5 minutes — refreshed on every call, so it stays warm during an active session.

---

## 5 · Stage 5 — Generation & Streaming

```python
response = await litellm.acompletion(
    model=self._settings.litellm_model,    # "anthropic/claude-sonnet-4-6"
    messages=messages,
    stream=True,
    **self._extra_kwargs,                  # api_key=ANTHROPIC_API_KEY
)

async for chunk in response:
    token = chunk.choices[0].delta.content
    if token:
        yield token   # yielded to _generate_stream(), which wraps as SSE "token" events
```

Back in `stream_search()`, tokens are wrapped and yielded:

```python
async for token in self._generate_stream(query, user_id, chunks, history):
    yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"

# After generation completes — store in semantic cache
self._cache.put(embedding, answer, citations, evidence_grade)

# Generate follow-up suggestions (non-blocking — streamed after done)
async for suggestion_event in self._generate_suggestions(query, answer, history):
    yield suggestion_event
```

---

## 6 · Agentic Routing

Not every message deserves a full RAG pipeline. The router saves latency and cost for conversational follow-ups.

### Fast heuristic path (no LLM call)

```python
def _quick_classify(query: str) -> str | None:
    q = query.strip().lower()
    if len(q) < 4:                            return "chat"  # "ok", "ty"
    if re.match(r'^(thanks?|thank you)', q):  return "chat"
    if re.match(r'^(hi|hello|hey)', q):       return "chat"
    return None  # unknown → fall through to LLM classify
```

### LLM classify (Groq, ~50–100ms)

```python
resp = await litellm.acompletion(
    model=self._settings.classify_model,     # "groq/llama-3.3-70b-versatile"
    messages=[{"role": "user", "content": prompt}],
    max_tokens=5,
    temperature=0,
    **self._classify_kwargs,                 # api_key=GROQ_API_KEY
)
result = resp.choices[0].message.content.strip().lower()
return "rag" if "rag" in result else "chat"  # defaults to "rag" on parse failure
```

The classify prompt includes the last 4 history messages for context — so *"What about in pregnancy?"* correctly classifies as `rag` (clinical follow-up) rather than `chat`.

**Default to `rag` on failure** — safe for a clinical app where missing a lookup is worse than a redundant one.

---

## 6 · Title Generation (`main.py`)

Title generation runs **in parallel with the full RAG pipeline** via `asyncio.create_task`, so it arrives before streaming ends:

```python
# In event_stream() — new conversation only
title_task = asyncio.create_task(_generate_title(body.query))

# Meanwhile: embed + history fetch run in parallel
path, embedding = await asyncio.gather(
    get_active_path(conversation_id),
    rag._embed(body.query),
)

# Await title (it was generating the whole time)
title = await title_task
await update_title(conversation_id, user.user_id, title)
yield f"event: title\ndata: {json.dumps({'conversation_id': ..., 'title': title})}\n\n"
```

```python
async def _generate_title(first_query: str) -> str:
    resp = await litellm.acompletion(
        model=_settings.classify_model,   # Groq — fast + cheap
        messages=[{"role": "user", "content":
            "Summarise this clinical question as a conversation title "
            "in 5 words or fewer. Reply with only the title, no punctuation.\n\n"
            f"Question: {first_query}"
        }],
        max_tokens=20,
        api_key=_settings.groq_api_key,
    )
    # Fallback: first 6 words of query if Groq fails
```

> The sidebar entry is only created **when the `title` event arrives** — never before. This prevents the blank-title flash.

---

## 6 · Follow-up Suggestions

Generated after the answer stream completes. Omitted entirely when not clinically helpful.

```python
async def _generate_suggestions(
    self, query: str, answer: str, history: list[dict]
) -> AsyncGenerator[str, None]:
    # Build a compact history summary for context
    ctx = "\n".join(f"{m['role'].upper()}: {m['content'][:200]}" for m in history[-4:])

    prompt = f"""You are a clinical assistant. The physician just received this answer.
Suggest 2-3 SHORT follow-up questions they might want to ask next.
Rules:
- Only suggest if genuinely useful (skip for greetings, thanks, simple confirmations)
- Each question must be ≤12 words
- Use specific drug names, diagnoses, or clinical values from the conversation
- If nothing useful: reply with exactly: NONE

[CONVERSATION]
{ctx}
USER: {query}
ASSISTANT: {answer[:500]}"""

    resp = await litellm.acompletion(model=classify_model, messages=[...], max_tokens=120)
    text = resp.choices[0].message.content.strip()
    if text == "NONE" or not text:
        return   # no suggestions event emitted
    suggestions = [s.strip("•-– ").strip() for s in text.splitlines() if s.strip()][:3]
    yield f"event: suggestions\ndata: {json.dumps({'suggestions': suggestions})}\n\n"
```

---

## 7 · LLM Provider Strategy

Three providers, each chosen for a specific reason:

| Provider | Used for | Why |
|---|---|---|
| **Anthropic** | Generation (`stream_search`, `stream_chat`) | Best instruction-following, prompt caching, reliable streaming |
| **Groq** | Classify, title, suggestions | Groq LPU: ~50–150ms vs ~800ms on other providers; max_tokens=5–20 so tiny cost |
| **NVIDIA** | Embeddings, reranker | Hosts `text-embedding-3-small` and `llama-3.2-nv-rerankqa-1b-v2` on GPU; single API key |

### `_extra_kwargs` vs `_classify_kwargs`

```python
@cached_property
def _extra_kwargs(self) -> dict:     # injected into every generation call
    return {"api_key": settings.anthropic_api_key} if settings.anthropic_api_key else {}

@cached_property
def _classify_kwargs(self) -> dict:  # injected into every Groq call
    return {"api_key": settings.groq_api_key} if settings.groq_api_key else {}
```

LiteLLM routes by **model string prefix**: `anthropic/...` → Anthropic SDK, `groq/...` → Groq SDK. The `api_key` kwarg overrides whatever is in the environment.

---

## 8 · Supabase Schema — Documents

### `documents_v2` — the knowledge base

```sql
CREATE TABLE documents_v2 (
    id        BIGSERIAL    PRIMARY KEY,
    content   TEXT         NOT NULL,      -- raw chunk text (~300–800 tokens)
    embedding vector(1536),               -- text-embedding-3-small embedding
    metadata  JSONB        NOT NULL,      -- structured fields (see below)
    fts       TSVECTOR     GENERATED ALWAYS AS (
                  to_tsvector('english', content)
              ) STORED                   -- FTS index maintained automatically
);
```

### metadata JSONB fields

```json
{
  "guideline_title": "Kenya National Guidelines for Management of Malaria",
  "publisher":       "Kenya MoH",
  "year":            "2022",
  "geography":       "Kenya",
  "cascading_path":  "Chapter 4 > 4.2 > Treatment of Severe Malaria",
  "doc_id":          "ke_malaria_2022",
  "chunk_index":     47,
  "source_url":      "https://..."
}
```

### Indexes

```sql
-- Dense retrieval: HNSW index — approximate nearest neighbour, cosine distance
CREATE INDEX documents_v2_embedding_idx
    ON documents_v2 USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Sparse retrieval: GIN inverted index on tsvector
CREATE INDEX documents_v2_fts_idx ON documents_v2 USING gin (fts);

-- Supabase RPC for vector search:
-- match_documents(query_embedding vector(1536), match_count int)
```

---

## 8 · Supabase Schema — Conversations

```sql
CREATE TABLE conversations (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title           TEXT,                        -- NULL until title SSE event
    title_generated BOOLEAN      DEFAULT FALSE,
    created_at      TIMESTAMPTZ  DEFAULT now(),
    updated_at      TIMESTAMPTZ  DEFAULT now()   -- bumped by trigger on new message
);

-- Trigger: bump updated_at whenever a message is inserted
CREATE TRIGGER trg_touch_conversation
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION touch_conversation();

-- Row Level Security
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own_conversations ON conversations
    USING (auth.uid() = user_id);
```

### `list_conversations` query

```sql
SELECT id, title, title_generated, created_at, updated_at
FROM conversations
WHERE user_id = $1
ORDER BY updated_at DESC
LIMIT 50;
```

---

## 8 · Supabase Schema — Messages

```sql
CREATE TABLE messages (
    id                UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID   NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    parent_id         UUID   REFERENCES messages(id),          -- NULL = root message
    selected_child_id UUID   REFERENCES messages(id),          -- active branch pointer
    role              TEXT   NOT NULL CHECK (role IN ('user', 'assistant')),
    content           TEXT,
    citations         JSONB,           -- [{index, guideline_title, excerpt, publisher, year, source_url}]
    evidence_grade    TEXT,
    branch_index      INT    DEFAULT 0, -- 0=original, 1,2...=regenerations at same position
    created_at        TIMESTAMPTZ DEFAULT now()
);
```

### `get_active_path` RPC — reconstructing the thread

```sql
CREATE OR REPLACE FUNCTION get_active_path(p_conversation_id UUID)
RETURNS SETOF messages AS $$
WITH RECURSIVE path AS (
    -- Start at the root (no parent)
    SELECT * FROM messages
    WHERE conversation_id = p_conversation_id AND parent_id IS NULL
    UNION ALL
    -- Follow selected_child_id at each fork
    SELECT m.* FROM messages m
    INNER JOIN path p ON m.id = p.selected_child_id
)
SELECT * FROM path ORDER BY created_at;
$$ LANGUAGE sql;
```

---

## 9 · Qdrant Schema

Qdrant holds the **dense embeddings** for vector similarity search. Supabase holds the same chunks for FTS. Both are populated at ingestion time and must stay in sync.

### Collection: `qwiva_docs`

```python
# Collection created at ingestion time with:
client.recreate_collection(
    collection_name="qwiva_docs",
    vectors_config=VectorParams(
        size=1536,                        # text-embedding-3-small dimensionality
        distance=Distance.COSINE,         # cosine similarity (normalised dot product)
    ),
    hnsw_config=HnswConfigDiff(
        m=16,                             # number of bi-directional links per node
        ef_construct=100,                 # build-time quality vs speed tradeoff
        full_scan_threshold=10_000,       # use exact search below this collection size
    ),
)
```

### Point structure

Each point = one chunk:

```python
PointStruct(
    id=<int or uuid>,              # maps to documents_v2.id for cross-reference
    vector=embedding,              # list[float] of length 1536
    payload={                      # mirrors documents_v2.metadata
        "content":         "...",
        "guideline_title": "...",
        "publisher":       "...",
        "year":            "...",
        "cascading_path":  "...",
        "doc_id":          "...",
        "chunk_index":     47,
        "source_url":      "...",
    }
)
```

---

## 9 · Qdrant vs Supabase — Why Both?

| Concern | Qdrant | Supabase |
|---|---|---|
| **Dense search** | ✓ Native HNSW, fast ANN | pgvector works but slower at scale |
| **Sparse / FTS search** | ✗ Not supported | ✓ `tsvector` + `wfts` |
| **Metadata filtering** | ✓ Payload filters | ✓ WHERE clauses |
| **Auth + RLS** | ✗ | ✓ Built-in |
| **Chat history** | ✗ | ✓ Relational |
| **Operational cost** | Separate cluster (Qdrant Cloud) | Supabase free tier |

> **Fallback path**: if `QDRANT_URL` is not set, the backend falls back to the Supabase `dynamic_hybrid_search_db` RPC which runs both vector and FTS in one round-trip via SQL.

---

## 10 · Conversation Tree

### Why a tree, not a list?

A list can't represent edit-and-branch: if the physician edits a question mid-conversation, the new answer replaces the old one linearly. With a tree, the old branch is preserved and the new one is the active path.

### Data structure

```
conversation
  └── msg_1 (user: "Malaria treatment?")   parent=NULL, selected_child=msg_2
        └── msg_2 (assistant: "AL is...")  parent=msg_1, selected_child=msg_3
              └── msg_3 (user: "In preg?") parent=msg_2, selected_child=msg_4a  ← active
                    ├── msg_4a (asst: "AL still recommended...")   branch_index=0
                    └── msg_4b (asst: [regenerated answer])        branch_index=1
```

### Active path traversal

`get_active_path()` starts at the root (no parent), follows `selected_child_id` at each step — a linked list encoded in the relational rows. The result is the linear conversation the physician sees.

### Branch switching

`PATCH /conversations/{id}/messages/{id}/branch?child_id=uuid` sets `selected_child_id` on the parent message. The next call to `get_active_path()` follows the new branch.

---

## 10 · Conversation Persistence Flow

```
Frontend: POST /search/stream
  │
  ▼
Backend event_stream():
  │
  ├─ 1. create_conversation(user_id)     ← only if no conversation_id in request
  │      → INSERT into conversations     → returns { id, ... }
  │
  ├─ 2. append_user_message(conv_id, content, parent_id)
  │      → INSERT into messages (role='user', parent_id=last_assistant_msg)
  │      → UPDATE messages SET selected_child_id = new_msg.id WHERE id = parent_id
  │      → yield "event: conversation" with both IDs
  │
  ├─ 3. [run full RAG pipeline, stream tokens]
  │
  ├─ 4. append_assistant_message(conv_id, parent_id=user_msg, content, citations, grade)
  │      → INSERT into messages (role='assistant', citations=jsonb)
  │      → UPDATE parent user msg's selected_child_id
  │      → yield "event: done" with assistant_message_id
  │
  └─ 5. (if new conv) update_title(conv_id, user_id, title)
         → UPDATE conversations SET title=..., title_generated=TRUE
         → yield "event: title"
```

### TTL cache layer (`conversations.py`)

```python
_conv_list_cache: dict[str, tuple[float, list]] = {}   # user_id → (timestamp, results)
_conv_cache:      dict[str, tuple[float, dict]]  = {}   # conv_id  → (timestamp, result)

LIST_TTL = 30    # seconds — sidebar list tolerated slightly stale
CONV_TTL = 300   # 5 minutes — individual conversation
```

---

## 11 · Semantic Cache

Avoids re-running the full pipeline for identical or near-identical questions.

```python
class _SemanticCache:
    def __init__(self):
        self._entries: OrderedDict = OrderedDict()   # LRU eviction
        self.max_size  = 512
        self.threshold = 0.92    # cosine similarity — very high bar
        self.ttl       = 86400   # 24 hours

    def lookup(self, embedding: list[float]) -> CachedResult | None:
        now = time.time()
        for key, entry in list(self._entries.items()):
            if now - entry.timestamp > self.ttl:
                del self._entries[key]; continue
            sim = cosine_similarity(embedding, entry.embedding)
            if sim >= self.threshold:
                self._entries.move_to_end(key)   # LRU refresh
                return entry
        return None

    def put(self, embedding, answer, citations, evidence_grade):
        if len(self._entries) >= self.max_size:
            self._entries.popitem(last=False)    # evict oldest
        self._entries[id(embedding)] = CachedEntry(...)
```

A cached hit still goes through the SSE pipeline — it's re-streamed in 8-char chunks so the physician's UX is identical (typewriter effect, citations appear, etc.).

---

## 12 · Citation Pipeline

End-to-end: from retrieved chunk to numbered badge in the UI.

### Step 1 — Deduplication (backend `_build_citations`)

Multiple chunks from the same guideline get one citation number. The LLM prompt labels them consistently:

```
[1] Kenya Malaria Guidelines 2022
... chunk text A ...

[1] Kenya Malaria Guidelines 2022   ← same number, different chunk
... chunk text B ...

[2] WHO Malaria Treatment Guidelines 2023
... chunk text ...
```

### Step 2 — LLM cites inline

The model produces: *"Use IV artesunate for at least 24 hours [1][2]"*

### Step 3 — `renumberByAppearance()` (frontend, post-stream)

Reorders citation objects to match first-appearance order in the text. `[2][1]` → `[1][2]` with objects swapped accordingly.

### Step 4 — Compression (`compressCitations` in `StreamingText.tsx`)

```typescript
// [1][2][3][4] → [1-4]    [1][2][5] → [1-2][5]
text.replace(/(\[\d+\])+/g, (match) => { /* range compression */ })
```

### Step 5 — Rendering (inline badge)

```typescript
// [1] → <cite data-n="1">  →  teal superscript badge
text.replace(/\[(\d+(?:-\d+)?)\]/g, '<cite data-n="$1">$1</cite>')
```

---

## 13 · Networking — Latency Budget

### Per-request critical path

```
Browser                    Render (Frankfurt)         External APIs
  │                              │                         │
  ├── TLS handshake ─────────────► ~40ms                  │
  │                              │                         │
  │                              ├── embed ────────────────► NVIDIA ~80ms
  │                              ├── vector ───────────────► Qdrant Cloud ~60ms
  │                              ├── FTS ──────────────────► Supabase ~50ms
  │                              │   (parallel ↑)          │
  │                              ├── rerank ───────────────► NVIDIA ~150ms
  │                              ├── classify ─────────────► Groq ~80ms
  │                              │   (parallel with rerank)│
  │                              ├── generate TTFT ────────► Anthropic ~600ms
  │◄── first token ─────────────│                         │
  │    total: ~1050ms            │                         │
```

### What's on the fast path (sequential)

`embed` → `retrieve+classify (parallel)` → `rerank` → `generate`

### What's parallel

- Qdrant vector + Supabase FTS run simultaneously via `asyncio.gather`
- Title generation runs in `asyncio.create_task` alongside the entire pipeline
- History fetch + embed run simultaneously at request start

---

## 13 · HTTP Client Configuration

```python
@cached_property
def _http(self) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=90,
        http2=True,    # HTTP/2 multiplexing — reuses TCP connection across rerank calls
    )
```

- The httpx client is a `@cached_property` — created once, reused for all rerank calls.
- HTTP/2 avoids TLS handshake overhead on the reranker (called once per request).
- All `@cached_property` clients are **pre-warmed at startup** in `main.py:startup()` so the first request doesn't pay initialisation cost.

```python
@app.on_event("startup")
async def startup():
    _ = rag._openai          # AsyncOpenAI embedding client
    _ = rag._http            # httpx reranker client
    _ = rag._extra_kwargs    # Anthropic API key dict
    _ = rag._classify_kwargs # Groq API key dict
    _ = rag._qdrant          # AsyncQdrantClient
    await get_db()           # Supabase AsyncClient
```

---

## 14 · Deployment

```
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│      Vercel (Edge CDN)      │     │         Render (Frankfurt)        │
│                             │     │                                   │
│  Next.js 14 App Router      │────►│  FastAPI  uvicorn  Docker         │
│  Auto-deploy on main push   │     │  /health → liveness probe         │
│  NEXT_PUBLIC_* env vars     │     │  $PORT set by Render              │
└─────────────────────────────┘     └───────────┬──────────────────────┘
                                                │
              ┌─────────────────────────────────┼──────────────────────┐
              ▼                                 ▼                      ▼
   ┌──────────────────┐           ┌─────────────────────┐  ┌──────────────────────┐
   │  Supabase        │           │  Qdrant Cloud       │  │ NVIDIA Inference Hub │
   │  PostgreSQL      │           │  82k vectors        │  │ text-embedding-3-sm  │
   │  pgvector        │           │  HNSW index         │  │ llama-3.2-nv-rerank  │
   │  tsvector FTS    │           │  Single collection  │  └──────────────────────┘
   │  Auth (JWT)      │           └─────────────────────┘
   │  Row Level Sec.  │                                     ┌──────────────────────┐
   └──────────────────┘                                     │  Anthropic           │
                                                            │  claude-sonnet-4-6   │
                                                            │  prompt caching      │
                                                            └──────────────────────┘
                                                            ┌──────────────────────┐
                                                            │  Groq                │
                                                            │  llama-3.3-70b       │
                                                            │  classify/title/sugg │
                                                            └──────────────────────┘
```

---

## 14 · Environment Variables — Complete Reference

### Backend (Render)

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | ✓ | PostgreSQL API endpoint |
| `SUPABASE_SERVICE_KEY` | ✓ | Bypasses RLS — backend only, never expose |
| `SUPABASE_JWT_SECRET` | ✓ | Verifies physician JWTs locally |
| `ANTHROPIC_API_KEY` | ✓ | Generation (Claude Sonnet) |
| `GROQ_API_KEY` | ✓ | Classify, title, suggestions |
| `NVIDIA_API_KEY` | ✓ | Embeddings + reranker |
| `NVIDIA_API_BASE` | ✓ | `https://inference-api.nvidia.com/v1/` |
| `QDRANT_URL` | ✓ | Qdrant cluster endpoint |
| `QDRANT_API_KEY` | ✓ | Qdrant auth |
| `LITELLM_MODEL` | | Default: `anthropic/claude-sonnet-4-6` |
| `CLASSIFY_MODEL` | | Default: `groq/llama-3.3-70b-versatile` |
| `FRONTEND_URL` | | CORS allow-origin for Vercel domain |
| `LANGFUSE_PUBLIC_KEY` | | Optional — LLM tracing |
| `LANGFUSE_SECRET_KEY` | | Optional |

### Frontend (Vercel)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Render backend URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key (safe to expose) |

---

## Summary — Everything in One Diagram

```
Physician's browser
  │
  ├─ supabase.auth.signIn() ───────────────────────────────► Supabase Auth
  │   ← JWT (HS256, 1hr)                                       (auth.users)
  │
  ├─ GET /conversations ───────────────────────────────────► FastAPI
  │   Bearer: JWT                                              verify_token() locally
  │   ← [{ id, title, updated_at }]                           conversations table
  │
  └─ POST /search/stream ──────────────────────────────────► FastAPI
      Bearer: JWT                                              verify_token()
      { query, conversation_id?, parent_message_id? }          │
                                                               ├─► create_conversation (if new)
                                                               ├─► append_user_message
                                                               ├─► asyncio.create_task(generate_title)
                                                               ├─► asyncio.gather(embed, get_history)
                                                               │     embed ──────────────────► NVIDIA
                                                               │     history ────────────────► Supabase
                                                               ├─► asyncio.gather(vector, fts)
                                                               │     vector ─────────────────► Qdrant
                                                               │     fts ───────────────────► Supabase
                                                               ├─► RRF merge (Python, in-process)
                                                               ├─► rerank ──────────────────► NVIDIA
                                                               ├─► classify ────────────────► Groq
                                                               ├─► generate (stream) ───────► Anthropic
                                                               │     ← tokens
                                                               ├─► append_assistant_message ► Supabase
                                                               ├─► title ───────────────────► Groq
                                                               └─► update_title ────────────► Supabase

      SSE events back to browser:
      conversation → status → citations → token×N → suggestions → done → title
```

---

<div style="text-align: center; padding: 3rem 0;">

# Qwiva

**Clinical knowledge, at the point of care.**

*Kenya MoH · WHO · RCOG · 82,000+ guideline chunks*

</div>
