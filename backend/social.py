from datetime import UTC, datetime, timedelta

from backend.db import get_db

# ---------------------------------------------------------------------------
# Feed
# ---------------------------------------------------------------------------


async def get_feed(
    user_id: str,
    cursor: str | None = None,
    limit: int = 20,
    feed_filter: str = "all",
) -> list[dict]:
    db = await get_db()
    cursor_ts = cursor or datetime.now(UTC).isoformat()
    result = await db.rpc(
        "get_personalized_feed",
        {
            "p_user_id": user_id,
            "p_cursor": cursor_ts,
            "p_limit": limit,
            "p_filter": feed_filter,
        },
    ).execute()
    return result.data or []


async def get_trending_posts(user_id: str, limit: int = 20) -> list[dict]:
    db = await get_db()
    # Trending = highest (likes + 2×comments) in last 7 days, with viewer context


    week_ago = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    result = await db.rpc(
        "get_personalized_feed",
        {
            "p_user_id": user_id,
            "p_cursor": datetime.now(UTC).isoformat(),
            "p_limit": limit * 3,  # over-fetch so we can sort by engagement
            "p_filter": "all",
        },
    ).execute()
    rows = result.data or []
    # Sort by engagement score client-side (created within 7 days)
    recent = [r for r in rows if r["created_at"] >= week_ago]
    recent.sort(key=lambda r: r["like_count"] + 2 * r["comment_count"], reverse=True)
    return recent[:limit]


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------


async def create_post(
    author_id: str,
    content: str,
    post_type: str,
    tags: list[str],
    specialty_tags: list[str],
    is_anonymous: bool,
) -> dict:
    db = await get_db()
    result = await db.table("posts").insert({
        "author_id": author_id,
        "content": content,
        "post_type": post_type,
        "tags": tags,
        "specialty_tags": specialty_tags,
        "is_anonymous": is_anonymous,
    }).execute()
    return result.data[0]


async def get_post(post_id: str, user_id: str) -> dict | None:
    db = await get_db()
    result = await db.rpc(
        "get_post_with_context",
        {"p_post_id": post_id, "p_user_id": user_id},
    ).execute()
    rows = result.data or []
    if not rows:
        return None
    # Increment view count in background — fire and forget
    new_count = rows[0]["view_count"] + 1
    await db.table("posts").update({"view_count": new_count}).eq("id", post_id).execute()
    return rows[0]


async def delete_post(post_id: str, author_id: str) -> bool:
    db = await get_db()
    result = (
        await db.table("posts")
        .update({"is_deleted": True})
        .eq("id", post_id)
        .eq("author_id", author_id)
        .execute()
    )
    return bool(result.data)


async def get_posts_by_author(
    author_id: str,
    viewer_id: str,
    cursor: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Returns a user's posts (for their profile page)."""
    db = await get_db()
    cursor_ts = cursor or datetime.now(UTC).isoformat()
    result = await db.rpc(
        "get_personalized_feed",
        {
            "p_user_id": viewer_id,
            "p_cursor": cursor_ts,
            "p_limit": limit,
            "p_filter": "all",
        },
    ).execute()
    rows = result.data or []
    return [r for r in rows if r["author_id"] == author_id]


# ---------------------------------------------------------------------------
# Likes
# ---------------------------------------------------------------------------


async def toggle_post_like(post_id: str, user_id: str) -> bool:
    """Toggle like. Returns True if now liked, False if unliked."""
    db = await get_db()
    existing = (
        await db.table("post_likes")
        .select("post_id")
        .eq("post_id", post_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing.data:
        await (
            db.table("post_likes").delete().eq("post_id", post_id).eq("user_id", user_id).execute()
        )
        return False
    else:
        await db.table("post_likes").insert({"post_id": post_id, "user_id": user_id}).execute()
        return True


async def toggle_comment_like(comment_id: str, user_id: str) -> bool:
    db = await get_db()
    existing = (
        await db.table("comment_likes")
        .select("comment_id")
        .eq("comment_id", comment_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing.data:
        await (
            db.table("comment_likes")
            .delete()
            .eq("comment_id", comment_id)
            .eq("user_id", user_id)
            .execute()
        )
        return False
    else:
        await (
            db.table("comment_likes")
            .insert({"comment_id": comment_id, "user_id": user_id})
            .execute()
        )
        return True


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


async def get_comments(post_id: str, user_id: str, limit: int = 50) -> list[dict]:
    db = await get_db()
    result = await db.rpc(
        "get_comments_with_context",
        {"p_post_id": post_id, "p_user_id": user_id, "p_limit": limit},
    ).execute()
    return result.data or []


async def create_comment(
    post_id: str,
    author_id: str,
    content: str,
    parent_comment_id: str | None,
    is_anonymous: bool,
) -> dict:
    db = await get_db()
    payload: dict = {
        "post_id": post_id,
        "author_id": author_id,
        "content": content,
        "is_anonymous": is_anonymous,
    }
    if parent_comment_id:
        payload["parent_comment_id"] = parent_comment_id
    result = await db.table("comments").insert(payload).execute()
    return result.data[0]


async def delete_comment(comment_id: str, author_id: str) -> bool:
    db = await get_db()
    result = (
        await db.table("comments")
        .update({"is_deleted": True})
        .eq("id", comment_id)
        .eq("author_id", author_id)
        .execute()
    )
    return bool(result.data)


# ---------------------------------------------------------------------------
# Follows
# ---------------------------------------------------------------------------


async def follow_user(follower_id: str, following_id: str) -> None:
    db = await get_db()
    await db.table("follows").insert({
        "follower_id": follower_id,
        "following_id": following_id,
    }).execute()


async def unfollow_user(follower_id: str, following_id: str) -> None:
    db = await get_db()
    await (
        db.table("follows")
        .delete()
        .eq("follower_id", follower_id)
        .eq("following_id", following_id)
        .execute()
    )


async def is_following(follower_id: str, following_id: str) -> bool:
    db = await get_db()
    result = (
        await db.table("follows")
        .select("follower_id")
        .eq("follower_id", follower_id)
        .eq("following_id", following_id)
        .maybe_single()
        .execute()
    )
    return result.data is not None


_PROFILE_FIELDS = (
    "user_id, display_name, specialty, avatar_url, country, "
    "verification_status, follower_count, following_count, post_count"
)


async def get_followers(
    user_id: str, viewer_id: str, limit: int = 50, offset: int = 0
) -> list[dict]:
    db = await get_db()
    result = (
        await db.table("follows")
        .select(f"follower_id, user_profiles!follower_id({_PROFILE_FIELDS})")
        .eq("following_id", user_id)
        .limit(limit)
        .offset(offset)
        .execute()
    )
    rows = []
    for r in result.data or []:
        profile = r.get("user_profiles") or {}
        profile["is_following"] = await is_following(viewer_id, profile.get("user_id", ""))
        rows.append(profile)
    return rows


async def get_following(
    user_id: str, viewer_id: str, limit: int = 50, offset: int = 0
) -> list[dict]:
    db = await get_db()
    result = (
        await db.table("follows")
        .select(f"following_id, user_profiles!following_id({_PROFILE_FIELDS})")
        .eq("follower_id", user_id)
        .limit(limit)
        .offset(offset)
        .execute()
    )
    rows = []
    for r in result.data or []:
        profile = r.get("user_profiles") or {}
        profile["is_following"] = await is_following(viewer_id, profile.get("user_id", ""))
        rows.append(profile)
    return rows
