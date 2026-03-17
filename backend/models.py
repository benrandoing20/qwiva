from typing import Literal

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Request / Response
# ---------------------------------------------------------------------------


class SearchRequest(BaseModel):
    query: str


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
# Auth / User
# ---------------------------------------------------------------------------


class UserProfile(BaseModel):
    user_id: str
    email: str | None = None
