from collections.abc import AsyncGenerator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

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

app = FastAPI(title="Qwiva API", version="0.1.0")


@app.on_event("startup")
async def startup() -> None:
    """Pre-warm the Supabase connection so the first query doesn't pay init cost."""
    await get_db()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.frontend_url, "http://localhost:3000"],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@app.post("/search/stream")
async def search_stream(
    body: SearchRequest,
    user: UserProfile = Depends(verify_token),
) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            conversation_id = body.conversation_id
            parent_message_id = body.parent_message_id

            # Create conversation on first turn if none provided
            if not conversation_id:
                row = await create_conversation(user.user_id)
                conversation_id = row["id"]

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

            # Run RAG pipeline — collect tokens while streaming to client
            tokens: list[str] = []
            citations = []
            evidence_grade = ""

            async for chunk in rag.stream_search(body.query, user.user_id):
                # Skip the RAG-level done — main.py emits done with assistant_message_id
                if chunk.startswith("event: done"):
                    continue
                yield chunk
                # Parse SSE chunks to capture citations for persistence
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

            # Persist assistant response and emit its ID so the client
            # can use it as parent_message_id for the next turn.
            answer = "".join(tokens)
            assistant_msg = await append_assistant_message(
                conversation_id=conversation_id,
                parent_id=user_message_id,
                content=answer,
                citations=citations,
                evidence_grade=evidence_grade,
            )
            yield f"event: done\ndata: {_json.dumps({'assistant_message_id': assistant_msg['id']})}\n\n"

            # Generate title on first exchange — emit via SSE so sidebar updates instantly
            convo = await get_conversation(conversation_id, user.user_id)
            if convo and not convo.get("title"):
                title = await _generate_title(body.query)
                if title:
                    await update_title(conversation_id, user.user_id, title)
                    yield f"event: title\ndata: {_json.dumps({'conversation_id': conversation_id, 'title': title})}\n\n"

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


async def _generate_title(first_query: str) -> str | None:
    """Generate a short conversation title from the first user query. Returns None on failure."""
    try:
        import litellm

        resp = await litellm.acompletion(
            model=_settings.litellm_model,
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
            api_key=_settings.nvidia_api_key,
            api_base=_settings.nvidia_api_base,
        )
        title = resp.choices[0].message.content.strip().strip('"').strip("'")
        return title or None
    except Exception:
        return None
