"""
Conversation and message persistence for the Qwiva chat experience.

All DB operations use the service-key client (backend/db.py). RLS policies
on the Supabase side enforce user isolation — the service key bypasses RLS,
so every query must explicitly filter by user_id.
"""

from __future__ import annotations

import json
import time
from typing import Any

from backend.db import get_db
from backend.models import Citation

# ---------------------------------------------------------------------------
# Lightweight in-process TTL cache for conversation lookups
# ---------------------------------------------------------------------------
# list_conversations and get_conversation are called on every route for auth
# checks and sidebar loads. Caching them eliminates redundant DB round trips.
# Mutations (create/delete/update_title) invalidate the relevant entries.

_conv_list_cache: dict[str, tuple[float, list[dict]]] = {}  # user_id → (ts, data)
_conv_cache: dict[tuple[str, str], tuple[float, dict | None]] = {}  # (conv_id, user_id) → (ts, data)

_LIST_TTL = 30.0   # seconds — sidebar stays fresh enough
_CONV_TTL = 300.0  # seconds — conversation metadata rarely changes


def _conv_list_get(user_id: str) -> list[dict] | None:
    entry = _conv_list_cache.get(user_id)
    if entry and time.monotonic() - entry[0] < _LIST_TTL:
        return entry[1]
    return None


def _conv_list_set(user_id: str, data: list[dict]) -> None:
    _conv_list_cache[user_id] = (time.monotonic(), data)


def _conv_list_invalidate(user_id: str) -> None:
    _conv_list_cache.pop(user_id, None)


def _conv_get(conv_id: str, user_id: str) -> tuple[bool, dict | None]:
    """Returns (cache_hit, data)."""
    entry = _conv_cache.get((conv_id, user_id))
    if entry and time.monotonic() - entry[0] < _CONV_TTL:
        return True, entry[1]
    return False, None


def _conv_set(conv_id: str, user_id: str, data: dict | None) -> None:
    _conv_cache[(conv_id, user_id)] = (time.monotonic(), data)


def _conv_invalidate(conv_id: str, user_id: str) -> None:
    _conv_cache.pop((conv_id, user_id), None)


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


async def create_conversation(user_id: str) -> dict:
    db = await get_db()
    res = await db.table("conversations").insert({"user_id": user_id}).execute()
    row = res.data[0]
    _conv_list_invalidate(user_id)
    _conv_set(row["id"], user_id, row)
    return row


async def list_conversations(user_id: str, limit: int = 50) -> list[dict]:
    cached = _conv_list_get(user_id)
    if cached is not None:
        return cached
    db = await get_db()
    res = (
        await db.table("conversations")
        .select("id, title, title_generated, created_at, updated_at")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    data = res.data or []
    _conv_list_set(user_id, data)
    return data


async def get_conversation(conversation_id: str, user_id: str) -> dict | None:
    hit, cached = _conv_get(conversation_id, user_id)
    if hit:
        return cached
    db = await get_db()
    res = (
        await db.table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    data = res.data if res else None
    _conv_set(conversation_id, user_id, data)
    return data


async def update_title(conversation_id: str, user_id: str, title: str) -> None:
    db = await get_db()
    await (
        db.table("conversations")
        .update({"title": title, "title_generated": True})
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    # Invalidate so next read gets the updated title
    _conv_invalidate(conversation_id, user_id)
    _conv_list_invalidate(user_id)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


async def append_user_message(
    conversation_id: str,
    content: str,
    parent_id: str | None = None,
) -> dict:
    """
    Insert a user message and update the parent's selected_child_id in one RPC call.
    Collapsed from 3 sequential DB round trips (count + insert + update) into 1.
    Requires Supabase function: append_user_message(p_conversation_id, p_content, p_parent_id).
    Falls back to 3-call path if RPC is unavailable.
    """
    db = await get_db()
    try:
        res = await db.rpc("append_user_message", {
            "p_conversation_id": conversation_id,
            "p_content": content,
            "p_parent_id": parent_id,
        }).execute()
        return res.data[0]
    except Exception:
        # Fallback: original 3-call path
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
    Insert assistant response and update parent's selected_child_id in one RPC call.
    Collapsed from 2 sequential DB round trips into 1.
    Requires Supabase function: append_assistant_message(p_conversation_id, p_parent_id, p_content, p_citations, p_evidence_grade).
    Falls back to 2-call path if RPC is unavailable.
    """
    db = await get_db()
    citations_json = json.dumps([c.model_dump() for c in citations])
    try:
        res = await db.rpc("append_assistant_message", {
            "p_conversation_id": conversation_id,
            "p_parent_id": parent_id,
            "p_content": content,
            "p_citations": citations_json,
            "p_evidence_grade": evidence_grade,
        }).execute()
        return res.data[0]
    except Exception:
        # Fallback: original 2-call path
        res = await db.table("messages").insert({
            "conversation_id": conversation_id,
            "parent_id": parent_id,
            "role": "assistant",
            "content": content,
            "citations": citations_json,
            "evidence_grade": evidence_grade,
            "branch_index": 0,
        }).execute()
        message = res.data[0]

        await db.table("messages").update(
            {"selected_child_id": message["id"]}
        ).eq("id", parent_id).execute()

        return message


async def get_active_path(conversation_id: str) -> list[dict]:
    """Calls the get_active_path DB function — returns ordered message list.

    The RPC was created before the suggestions column existed, so we fetch
    suggestions in a single follow-up query and merge them in.
    """
    db = await get_db()
    res = await db.rpc("get_active_path", {"p_conversation_id": conversation_id}).execute()
    messages = res.data or []
    if not messages:
        return messages

    # Bulk-fetch suggestions (not returned by the RPC) and merge into each row
    msg_ids = [m["id"] for m in messages]
    try:
        sugg_res = (
            await db.table("messages")
            .select("id, suggestions")
            .in_("id", msg_ids)
            .execute()
        )
        sugg_map = {row["id"]: row.get("suggestions") for row in (sugg_res.data or [])}
        for m in messages:
            m.setdefault("suggestions", sugg_map.get(m["id"]))
    except Exception:
        pass  # suggestions column may not exist yet — degrade gracefully

    return messages


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
    _conv_invalidate(conversation_id, user_id)
    _conv_list_invalidate(user_id)
