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
    doc_type: str = "guideline"  # "guideline" | "drug" | "legacy"
    excerpt: str = ""  # short display excerpt shown in UI (≤400 chars)
    source_url: str = ""  # direct URL to the guideline document, if available in metadata
    source_content: str = ""  # full retrieved chunk text — used to ground follow-up questions in history


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
    suggestions: list[str] | None = None
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


# ---------------------------------------------------------------------------
# Social — Profiles
# ---------------------------------------------------------------------------


class PhysicianProfileOut(BaseModel):
    user_id: str
    display_name: str
    specialty: str | None = None
    subspecialty: str | None = None
    institution: str | None = None
    country: str
    city: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    years_experience: int | None = None
    verification_status: str
    languages: list[str]
    interests: list[str]
    onboarding_complete: bool
    follower_count: int
    following_count: int
    post_count: int
    created_at: str
    is_following: bool | None = None  # None when viewing own profile


class OnboardingRequest(BaseModel):
    display_name: str
    specialty: str | None = None
    subspecialty: str | None = None
    institution: str | None = None
    country: str = "Kenya"
    city: str | None = None
    bio: str | None = None
    years_experience: int | None = None
    medical_license: str | None = None
    languages: list[str] = []
    interests: list[str] = []


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    specialty: str | None = None
    subspecialty: str | None = None
    institution: str | None = None
    country: str | None = None
    city: str | None = None
    bio: str | None = None
    years_experience: int | None = None
    medical_license: str | None = None
    languages: list[str] | None = None
    interests: list[str] | None = None
    avatar_url: str | None = None


# ---------------------------------------------------------------------------
# Social — Posts
# ---------------------------------------------------------------------------


class PostOut(BaseModel):
    id: str
    author_id: str
    content: str
    post_type: str
    tags: list[str]
    specialty_tags: list[str]
    image_urls: list[str]
    is_anonymous: bool
    like_count: int
    comment_count: int
    view_count: int
    created_at: str
    author_name: str
    author_specialty: str | None = None
    author_avatar: str | None = None
    author_country: str | None = None
    author_verified: str
    viewer_liked: bool
    is_following: bool


class CreatePostRequest(BaseModel):
    content: str
    post_type: str = "question"
    tags: list[str] = []
    specialty_tags: list[str] = []
    is_anonymous: bool = False


# ---------------------------------------------------------------------------
# Social — Comments
# ---------------------------------------------------------------------------


class CommentOut(BaseModel):
    id: str
    post_id: str
    author_id: str
    parent_comment_id: str | None = None
    content: str
    is_anonymous: bool
    like_count: int
    created_at: str
    author_name: str
    author_specialty: str | None = None
    author_avatar: str | None = None
    author_verified: str
    viewer_liked: bool


class CreateCommentRequest(BaseModel):
    content: str
    parent_comment_id: str | None = None
    is_anonymous: bool = False


# ---------------------------------------------------------------------------
# Social — Follows / Discover
# ---------------------------------------------------------------------------


class DiscoverUserOut(BaseModel):
    user_id: str
    display_name: str
    specialty: str | None = None
    subspecialty: str | None = None
    institution: str | None = None
    country: str
    city: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    years_experience: int | None = None
    verification_status: str
    languages: list[str]
    interests: list[str]
    follower_count: int
    following_count: int
    post_count: int
    is_following: bool


class LikeResponse(BaseModel):
    liked: bool
    like_count: int
