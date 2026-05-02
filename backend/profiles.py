from backend.db import get_db


async def get_profile(user_id: str) -> dict | None:
    db = await get_db()
    result = (
        await db.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return result.data


async def get_profile_or_create(user_id: str, email: str | None = None) -> dict:
    profile = await get_profile(user_id)
    if profile:
        return profile
    # Lazy-create for users who existed before migration 003
    display_name = email.split("@")[0] if email else "Physician"
    db = await get_db()
    result = (
        await db.table("user_profiles")
        .insert({"user_id": user_id, "display_name": display_name, "country": "Kenya"})
        .execute()
    )
    return result.data[0]


async def upsert_profile(user_id: str, updates: dict) -> dict:
    db = await get_db()
    updates["user_id"] = user_id
    result = (
        await db.table("user_profiles")
        .upsert(updates, on_conflict="user_id")
        .execute()
    )
    return result.data[0]


async def complete_onboarding(
    user_id: str, data: dict, email: str | None = None
) -> dict:
    data["onboarding_complete"] = True
    # Auto-derive display_name from first/last name when provided
    if data.get("first_name") and not data.get("display_name"):
        parts = [data.get("first_name", ""), data.get("last_name", "")]
        data["display_name"] = " ".join(p for p in parts if p).strip()
    # display_name is NOT NULL on user_profiles, so the upsert must always
    # carry one. Prefer the existing row's value, then email prefix, then a
    # generic fallback.
    if not data.get("display_name"):
        existing = await get_profile(user_id)
        if existing and existing.get("display_name"):
            data["display_name"] = existing["display_name"]
        elif email:
            data["display_name"] = email.split("@")[0]
        else:
            data["display_name"] = "Physician"
    return await upsert_profile(user_id, data)


async def list_profiles_for_feed(
    user_id: str,
    specialty: str | None = None,
    country: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[dict]:
    db = await get_db()
    result = await db.rpc(
        "discover_users",
        {
            "p_user_id": user_id,
            "p_specialty": specialty,
            "p_country": country,
            "p_limit": limit,
            "p_offset": offset,
        },
    ).execute()
    return result.data or []
