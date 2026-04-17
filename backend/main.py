import asyncio
import logging
from collections.abc import AsyncGenerator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

# ---------------------------------------------------------------------------
# Compatibility patch: litellm passes sdk_integration= to Langfuse.__init__
# for langfuse >= 2.6.0, but langfuse 4.x removed that parameter.
# Patch the class before anything imports it so the kwarg is silently dropped.
# ---------------------------------------------------------------------------
try:
    import langfuse as _langfuse
    _orig_lf_init = _langfuse.Langfuse.__init__

    def _patched_lf_init(self, *args, **kwargs):
        kwargs.pop("sdk_integration", None)
        _orig_lf_init(self, *args, **kwargs)

    _langfuse.Langfuse.__init__ = _patched_lf_init
except Exception:
    pass

import jwt as pyjwt
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.auth import verify_token
from backend.config import get_settings
from backend.conversations import (
    append_assistant_message,
    append_user_message,
    create_conversation,
    delete_conversation,
    get_active_path,
    get_conversation,
    get_siblings,
    list_conversations,
    switch_branch,
    update_title,
)
from backend.db import get_db
from backend.models import (
    ConversationSummary,
    MessageOut,
    SearchRequest,
    SiblingOut,
    UserProfile,
)
from backend.rag import rag

_settings = get_settings()


def _limit_key(request: Request) -> str:
    """Rate-limit by user_id extracted from JWT.

    Falls back to remote IP so unauthenticated probes are also throttled.
    Per-user keying is important for Kenyan mobile networks where many users
    share the same carrier-NAT IP address.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = pyjwt.decode(
                auth[7:],
                _settings.supabase_jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
            uid = payload.get("sub")
            if uid:
                return uid
        except Exception:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=_limit_key)

app = FastAPI(title="Qwiva API", version="0.1.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*.onrender.com", "localhost", "127.0.0.1"])


@app.on_event("startup")
async def startup() -> None:
    """Pre-warm all clients so the first request doesn't pay initialisation cost."""
    # Touch all @cached_property clients — this constructs them once and caches them
    _ = rag._openai        # embedding client (AsyncOpenAI direct)
    _ = rag._http          # reranker HTTP client (httpx.AsyncClient)
    _ = rag._extra_kwargs  # generation LiteLLM kwargs (Anthropic)
    _ = rag._classify_kwargs  # classify/suggestions LiteLLM kwargs (Groq)
    if rag._settings.qdrant_url:
        _ = rag._qdrant  # Qdrant async client
    await get_db()  # Supabase connection pool


app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.frontend_url, "http://localhost:3000"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


@app.get("/me")
async def me(user: UserProfile = Depends(verify_token)) -> UserProfile:
    return user


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


@app.get("/conversations", response_model=list[ConversationSummary])
async def list_convos(user: UserProfile = Depends(verify_token)):
    return await list_conversations(user.user_id)


@app.post("/conversations", response_model=ConversationSummary, status_code=201)
async def new_conversation(user: UserProfile = Depends(verify_token)):
    row = await create_conversation(user.user_id)
    return row


@app.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(
    conversation_id: str,
    user: UserProfile = Depends(verify_token),
):
    convo = await get_conversation(conversation_id, user.user_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return await get_active_path(conversation_id)


@app.get(
    "/conversations/{conversation_id}/messages/{message_id}/siblings",
    response_model=list[SiblingOut],
)
async def message_siblings(
    conversation_id: str,
    message_id: str,
    user: UserProfile = Depends(verify_token),
):
    convo = await get_conversation(conversation_id, user.user_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return await get_siblings(message_id)


@app.patch("/conversations/{conversation_id}/messages/{message_id}/branch")
async def select_branch(
    conversation_id: str,
    message_id: str,
    child_id: str,
    user: UserProfile = Depends(verify_token),
):
    """Switch the active branch at a fork point."""
    convo = await get_conversation(conversation_id, user.user_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await switch_branch(message_id, child_id)
    return {"ok": True}


@app.patch("/conversations/{conversation_id}/title")
async def set_title(
    conversation_id: str,
    title: str,
    user: UserProfile = Depends(verify_token),
):
    convo = await get_conversation(conversation_id, user.user_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await update_title(conversation_id, user.user_id, title)
    return {"ok": True}


@app.delete("/conversations/{conversation_id}", status_code=204)
async def remove_conversation(
    conversation_id: str,
    user: UserProfile = Depends(verify_token),
):
    convo = await get_conversation(conversation_id, user.user_id)
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await delete_conversation(conversation_id, user.user_id)


# ---------------------------------------------------------------------------
# Search / Chat (streaming)
# ---------------------------------------------------------------------------


def _msg_to_history(m: dict) -> dict:
    """Convert a DB message row to an LLM history entry.

    For assistant messages, append citation metadata as plain text so the model
    can answer follow-up questions like "describe source 1" without hallucinating.
    """
    import json as _json

    content = m["content"] or ""
    if m["role"] == "assistant" and m.get("citations"):
        raw = m["citations"]
        try:
            cits = _json.loads(raw) if isinstance(raw, str) else (raw or [])
        except Exception:
            cits = []
        if cits:
            lines = []
            for c in cits:
                line = f"[{c['index']}] {c['guideline_title']}"
                if c.get("publisher"):
                    line += f" — {c['publisher']}"
                if c.get("year"):
                    line += f" · {c['year']}"
                body = c.get("source_content") or c.get("excerpt")
                if body:
                    line += f"\n    Content: {body}"
                lines.append(line)
            content = f"{content}\n\nReferenced sources:\n" + "\n".join(lines)
    return {"role": m["role"], "content": content}


_MAX_QUERY_LEN = 2000


@app.post("/search/stream")
@limiter.limit("15/minute")
async def search_stream(
    request: Request,
    body: SearchRequest,
    user: UserProfile = Depends(verify_token),
) -> StreamingResponse:
    if len(body.query.strip()) == 0:
        raise HTTPException(status_code=400, detail="Query must not be empty.")
    if len(body.query) > _MAX_QUERY_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Query exceeds maximum length of {_MAX_QUERY_LEN} characters.",
        )

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            conversation_id = body.conversation_id
            parent_message_id = body.parent_message_id

            # Resolve / create conversation.
            # If conversation_id was provided but no longer exists in the DB
            # (e.g. after a DB reset or the row was deleted), fall back to a
            # new conversation rather than crashing with a FK constraint error.
            if not conversation_id:
                row = await create_conversation(user.user_id)
                conversation_id = row["id"]
                is_new_conversation = True
            else:
                conv = await get_conversation(conversation_id, user.user_id)
                if conv:
                    is_new_conversation = False
                else:
                    # Stale id — start fresh
                    row = await create_conversation(user.user_id)
                    conversation_id = row["id"]
                    parent_message_id = None  # old parent belongs to deleted conversation
                    is_new_conversation = True

            # Persist user message
            user_msg = await append_user_message(
                conversation_id=conversation_id,
                content=body.query,
                parent_id=parent_message_id,
            )
            user_message_id = user_msg["id"]

            # Yield conversation_id so the client can track it for subsequent turns
            import json as _json
            yield f"event: conversation\ndata: {_json.dumps({'conversation_id': conversation_id, 'user_message_id': user_message_id})}\n\n"

            # "Thinking…" is the first visible status — covers the gather + classify wait.
            yield f"event: status\ndata: {_json.dumps({'message': 'Thinking…'})}\n\n"

            # Start title generation immediately for new conversations — runs in parallel
            # with the full RAG pipeline so the title is ready before the answer finishes.
            title_task: asyncio.Task | None = (
                asyncio.create_task(_generate_title(body.query))
                if is_new_conversation
                else None
            )

            # Parallelise: fetch conversation history + embed the query simultaneously.
            # Both are independent of each other and together take max(db, embed) ms
            # instead of db + embed ms — saves ~150ms on the critical path.
            path, embedding = await asyncio.gather(
                get_active_path(conversation_id),
                rag._embed(body.query),
            )
            history = [_msg_to_history(m) for m in path[:-1]]

            # Title ran in parallel with embed+history — emit it now, before the answer
            # starts, so the sidebar updates once and never changes.
            if title_task is not None:
                title = await title_task
                await update_title(conversation_id, user.user_id, title)
                yield f"event: title\ndata: {_json.dumps({'conversation_id': conversation_id, 'title': title})}\n\n"

            # Classify: guideline lookup needed, or conversational reply?
            # Heuristics handle obvious cases (greetings, ack) without an LLM call.
            mode = await rag.classify(body.query, history)

            # Stream response — both generators yield SSE-formatted strings
            tokens: list[str] = []
            citations = []
            evidence_grade = ""
            suggestions_list: list[str] = []

            generator = (
                rag.stream_chat(body.query, user.user_id, history)
                if mode == "chat"
                # Pass pre-computed embedding so stream_search skips its own embed call
                else rag.stream_search(body.query, user.user_id, history, precomputed_embedding=embedding)
            )

            async for chunk in generator:
                # Skip the inner done — main.py emits done with assistant_message_id
                if chunk.startswith("event: done"):
                    continue
                yield chunk
                # Parse SSE to capture citations, tokens, and suggestions for persistence
                if chunk.startswith("event: citations"):
                    data_line = chunk.split("\ndata: ", 1)[-1].strip()
                    try:
                        payload = _json.loads(data_line)
                        from backend.models import Citation
                        citations = [Citation(**c) for c in payload.get("citations", [])]
                        evidence_grade = payload.get("evidence_grade", "")
                    except Exception:
                        pass
                elif chunk.startswith("event: token"):
                    data_line = chunk.split("\ndata: ", 1)[-1].strip()
                    try:
                        tokens.append(_json.loads(data_line).get("token", ""))
                    except Exception:
                        pass
                elif chunk.startswith("event: suggestions"):
                    data_line = chunk.split("\ndata: ", 1)[-1].strip()
                    try:
                        suggestions_list = _json.loads(data_line).get("suggestions", [])
                    except Exception:
                        pass

            # Persist assistant response and emit its ID so the client
            # can use it as parent_message_id for the next turn.
            answer = "".join(tokens)

            # Filter citations to only those actually referenced inline in the answer.
            # The citations event was sent upfront with all retrieved chunks; here we
            # strip any that the LLM never cited so they don't appear in stored history
            # or the Sources panel after renumbering.
            import re as _re
            cited_indices = {int(m) for m in _re.findall(r'\[(\d+)\]', answer)}
            cited_citations = [c for c in citations if c.index in cited_indices]

            assistant_msg = await append_assistant_message(
                conversation_id=conversation_id,
                parent_id=user_message_id,
                content=answer,
                citations=cited_citations,
                evidence_grade=evidence_grade,
            )
            if suggestions_list:
                db = await get_db()
                await db.table("messages").update(
                    {"suggestions": suggestions_list}
                ).eq("id", assistant_msg["id"]).execute()
            yield f"event: done\ndata: {_json.dumps({'assistant_message_id': assistant_msg['id']})}\n\n"

        except Exception as exc:
            import json as _json
            yield f"event: error\ndata: {_json.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _generate_title(first_query: str) -> str:
    """Generate a short conversation title using Groq. Falls back to truncated query."""
    try:
        import litellm

        resp = await litellm.acompletion(
            model=_settings.classify_model,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Summarise this clinical question as a conversation title "
                        "in 5 words or fewer. Reply with only the title, no punctuation.\n\n"
                        f"Question: {first_query}"
                    ),
                }
            ],
            max_tokens=20,
            api_key=_settings.groq_api_key,
        )
        title = resp.choices[0].message.content.strip().strip('"').strip("'")
        if title:
            return title
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Title generation failed: %s", exc)

    # Fallback: first 6 words of the query
    words = first_query.strip().split()
    return " ".join(words[:6]) + ("…" if len(words) > 6 else "")
