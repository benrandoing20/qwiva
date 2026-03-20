import json
from typing import Literal

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Request / Response
# ---------------------------------------------------------------------------


class SearchRequest(BaseModel):
    query: str
    conversation_id: str | None = None   # omit to start a new conversation
    parent_message_id: str | None = None  # omit to append at current leaf


class Citation(BaseModel):
    index: int  # 1-based, matches [1] [2] in answer text
    guideline_title: str
    section: str  # from cascading_path
    year: str
    publisher: str


class SearchResult(BaseModel):
    answer: str
    citations: list[Citation]
    evidence_grade: str


# ---------------------------------------------------------------------------
# SSE event payloads
# ---------------------------------------------------------------------------


class CitationsPayload(BaseModel):
    citations: list[Citation]
    evidence_grade: str


class TokenPayload(BaseModel):
    token: str


# A discriminated union makes the frontend types clean
SSEEventType = Literal["citations", "token", "done", "error"]


class SSEEvent(BaseModel):
    event: SSEEventType
    data: CitationsPayload | TokenPayload | dict


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


class ConversationSummary(BaseModel):
    id: str
    title: str | None
    title_generated: bool
    created_at: str
    updated_at: str


class MessageOut(BaseModel):
    id: str
    parent_id: str | None
    selected_child_id: str | None
    role: str
    content: str
    citations: list[Citation] | None = None
    evidence_grade: str | None = None
    branch_index: int
    created_at: str

    @field_validator("citations", mode="before")
    @classmethod
    def parse_citations(cls, v: object) -> object:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v


class SiblingOut(BaseModel):
    id: str
    branch_index: int
    content: str
    created_at: str


# ---------------------------------------------------------------------------
# Auth / User
# ---------------------------------------------------------------------------


class UserProfile(BaseModel):
    user_id: str
    email: str | None = None
