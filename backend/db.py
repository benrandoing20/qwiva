from supabase._async.client import AsyncClient, create_client

from backend.config import get_settings

_client: AsyncClient | None = None


async def get_db() -> AsyncClient:
    """
    Returns a module-level singleton async Supabase client.
    Lazily initialised on first request; reused for all subsequent calls.
    Uses the service key — never expose this to the frontend.
    """
    global _client
    if _client is None:
        settings = get_settings()
        _client = await create_client(
            settings.supabase_url,
            settings.supabase_service_key,
        )
    return _client
