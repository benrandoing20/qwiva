from collections.abc import AsyncGenerator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.auth import verify_token
from backend.config import get_settings
from backend.models import SearchRequest, UserProfile
from backend.rag import rag

_settings = get_settings()

app = FastAPI(title="Qwiva API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


@app.get("/me")
async def me(user: UserProfile = Depends(verify_token)) -> UserProfile:
    return user


@app.post("/search/stream")
async def search_stream(
    body: SearchRequest,
    user: UserProfile = Depends(verify_token),
) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            async for chunk in rag.stream_search(body.query, user.user_id):
                yield chunk
        except Exception as exc:
            import json

            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering in production
        },
    )
