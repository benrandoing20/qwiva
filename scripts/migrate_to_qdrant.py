"""
One-time migration: copy all embeddings + metadata from Supabase → Qdrant.

Usage:
    uv pip install -e ".[dev]"
    python scripts/migrate_to_qdrant.py

Requires .env (or environment variables):
    SUPABASE_URL, SUPABASE_SERVICE_KEY
    QDRANT_URL, QDRANT_API_KEY
    QDRANT_COLLECTION  (optional, default: qwiva_docs)

The script is idempotent — safe to re-run. Qdrant upserts by point ID so
existing points are overwritten, not duplicated.
"""

import ast
import asyncio
import logging
import sys

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

BATCH_SIZE = 500   # rows fetched from Supabase per page
UPSERT_BATCH = 50   # points pushed to Qdrant per upsert call (keep payloads small)
MAX_RETRIES = 5     # retries per upsert batch on 502/timeout


def _parse_embedding(raw) -> list[float] | None:
    """Supabase may return the pgvector column as a string '[0.1,0.2,...]' or as a list."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        try:
            parsed = ast.literal_eval(raw)
            return [float(x) for x in parsed]
        except Exception:
            return None
    return None


async def migrate() -> None:
    # Late imports so env vars are loaded first
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import (
        Distance,
        PointStruct,
        ScalarQuantization,
        ScalarQuantizationConfig,
        ScalarType,
        VectorParams,
    )
    from supabase._async.client import AsyncClient, create_client

    from backend.config import get_settings

    settings = get_settings()

    if not settings.qdrant_url or not settings.qdrant_api_key:
        log.error("QDRANT_URL and QDRANT_API_KEY must be set in .env")
        sys.exit(1)

    log.info("Connecting to Supabase and Qdrant…")
    supabase: AsyncClient = await create_client(
        settings.supabase_url, settings.supabase_service_key
    )
    qdrant = AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=60)

    # -----------------------------------------------------------------------
    # Create collection (no-op if already exists)
    # -----------------------------------------------------------------------
    collections = await qdrant.get_collections()
    existing = {c.name for c in collections.collections}

    if settings.qdrant_collection not in existing:
        log.info("Creating collection '%s' with scalar quantization…", settings.qdrant_collection)
        await qdrant.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            # Scalar quantization: stores vectors as int8 (~4x smaller, <5% accuracy loss)
            # always_ram=True keeps quantized vectors hot in memory
            quantization_config=ScalarQuantization(
                scalar=ScalarQuantizationConfig(
                    type=ScalarType.INT8,
                    quantile=0.99,
                    always_ram=True,
                )
            ),
        )
        log.info("Collection created.")
    else:
        log.info("Collection '%s' already exists — upserting.", settings.qdrant_collection)

    # -----------------------------------------------------------------------
    # Count total rows
    # -----------------------------------------------------------------------
    count_res = await supabase.table("documents_v2").select("id", count="exact").execute()
    total = count_res.count or 0
    log.info("Total rows in documents_v2: %d", total)

    # -----------------------------------------------------------------------
    # Paginate through Supabase, upsert to Qdrant
    # -----------------------------------------------------------------------
    offset = 0
    migrated = 0
    skipped = 0

    while offset < total:
        log.info("Fetching rows %d–%d…", offset, offset + BATCH_SIZE)
        res = (
            await supabase.table("documents_v2")
            .select("id, content, embedding, metadata")
            .range(offset, offset + BATCH_SIZE - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break

        points: list[PointStruct] = []
        for row in rows:
            embedding = _parse_embedding(row.get("embedding"))
            if embedding is None:
                skipped += 1
                continue

            meta = row.get("metadata") or {}
            points.append(
                PointStruct(
                    id=row["id"],  # Supabase bigint id — Qdrant accepts integer ids
                    vector=embedding,
                    payload={
                        "content": row.get("content", ""),
                        "guideline_title": meta.get("guideline_title", ""),
                        "cascading_path": meta.get("cascading_path", ""),
                        "year": str(meta.get("year", "")),
                        "publisher": meta.get("publisher", ""),
                        "doc_id": meta.get("doc_id", ""),
                        "chunk_index": int(meta.get("chunk_index", 0)),
                    },
                )
            )

        # Upsert in sub-batches with retry/backoff for transient 502s
        for i in range(0, len(points), UPSERT_BATCH):
            batch = points[i : i + UPSERT_BATCH]
            for attempt in range(MAX_RETRIES):
                try:
                    await qdrant.upsert(
                        collection_name=settings.qdrant_collection, points=batch
                    )
                    break
                except Exception as exc:
                    wait = 2 ** attempt  # 1s, 2s, 4s, 8s, 16s
                    if attempt < MAX_RETRIES - 1:
                        log.warning("Upsert failed (%s) — retry %d in %ds", exc, attempt + 1, wait)
                        await asyncio.sleep(wait)
                    else:
                        raise
            migrated += len(batch)

        offset += BATCH_SIZE
        log.info("Progress: %d / %d migrated, %d skipped", migrated, total, skipped)

    log.info("Done. %d points in Qdrant, %d rows skipped (no embedding).", migrated, skipped)
    await qdrant.close()


if __name__ == "__main__":
    asyncio.run(migrate())
