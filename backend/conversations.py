"""
Conversation and message persistence for the Qwiva chat experience.

All DB operations use the service-key client (backend/db.py). RLS policies
on the Supabase side enforce user isolation — the service key bypasses RLS,
so every query must explicitly filter by user_id.
"""

from __future__ import annotations

import json

from backend.db import get_db
from backend.models import Citation


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


async def create_conversation(user_id: str) -> dict:
    db = await get_db()
    res = await db.table("conversations").insert({"user_id": user_id}).execute()
    return res.data[0]


async def list_conversations(user_id: str, limit: int = 50) -> list[dict]:
    db = await get_db()
    res = (
        await db.table("conversations")
        .select("id, title, title_generated, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


async def get_conversation(conversation_id: str, user_id: str) -> dict | None:
    db = await get_db()
    res = (
        await db.table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return res.data


async def update_title(conversation_id: str, user_id: str, title: str) -> None:
    db = await get_db()
    await (
        db.table("conversations")
        .update({"title": title, "title_generated": True})
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


async def append_user_message(
    conversation_id: str,
    content: str,
    parent_id: str | None = None,
) -> dict:
    """
    Insert a user message and update the parent's selected_child_id pointer.
    If parent_id is provided and the parent already has a selected child,
    this creates a new branch (branch_index > 0).
    """
    db = await get_db()

    # Determine branch_index: count existing siblings
    branch_index = 0
    if parent_id:
        siblings = (
            await db.table("messages")
            .select("id", count="exact")
            .eq("parent_id", parent_id)
            .execute()
        )
        branch_index = siblings.count or 0

    res = await db.table("messages").insert({
        "conversation_id": conversation_id,
        "parent_id": parent_id,
        "role": "user",
        "content": content,
        "branch_index": branch_index,
    }).execute()
    message = res.data[0]

    # Point parent's selected_child_id at the new message (activates this branch)
    if parent_id:
        await db.table("messages").update(
            {"selected_child_id": message["id"]}
        ).eq("id", parent_id).execute()

    return message


async def append_assistant_message(
    conversation_id: str,
    parent_id: str,
    content: str,
    citations: list[Citation],
    evidence_grade: str,
) -> dict:
    """
    Insert the assistant response and link it as the active child of the user message.
    """
    db = await get_db()

    citations_json = [c.model_dump() for c in citations]
    res = await db.table("messages").insert({
        "conversation_id": conversation_id,
        "parent_id": parent_id,
        "role": "assistant",
        "content": content,
        "citations": json.dumps(citations_json),
        "evidence_grade": evidence_grade,
        "branch_index": 0,
    }).execute()
    message = res.data[0]

    # Point the user message at this assistant response
    await db.table("messages").update(
        {"selected_child_id": message["id"]}
    ).eq("id", parent_id).execute()

    return message


async def get_active_path(conversation_id: str) -> list[dict]:
    """Calls the get_active_path DB function — returns ordered message list."""
    db = await get_db()
    res = await db.rpc("get_active_path", {"p_conversation_id": conversation_id}).execute()
    return res.data or []


async def get_siblings(parent_message_id: str) -> list[dict]:
    """Returns all branches at a fork point for the branch switcher UI."""
    db = await get_db()
    res = await db.rpc("get_siblings", {"p_parent_id": parent_message_id}).execute()
    return res.data or []


async def switch_branch(parent_message_id: str, child_message_id: str) -> None:
    """Update the active branch selection at a fork point."""
    db = await get_db()
    await db.table("messages").update(
        {"selected_child_id": child_message_id}
    ).eq("id", parent_message_id).execute()


async def delete_conversation(conversation_id: str, user_id: str) -> None:
    """Delete a conversation and all its messages (cascade)."""
    db = await get_db()
    await (
        db.table("conversations")
        .delete()
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
