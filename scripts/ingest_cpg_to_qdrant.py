"""
Ingest clinical_practice_guideline_chunks → Qdrant.

Reads embeddings and metadata directly from Supabase (no re-embedding) and
upserts into the existing Qdrant collection. Safe to re-run — upsert by
deterministic UUID means duplicate rows are overwritten, not duplicated.

Usage:
    source .venv/bin/activate
    python scripts/ingest_cpg_to_qdrant.py            # all rows
    python scripts/ingest_cpg_to_qdrant.py --limit 500  # test run

Requires .env:
    SUPABASE_URL, SUPABASE_SERVICE_KEY
    QDRANT_URL, QDRANT_API_KEY
    QDRANT_COLLECTION  (optional, default: qwiva_docs)
"""

import argparse
import ast
import asyncio
import logging
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

TABLE = "clinical_practice_guideline_chunks"
BATCH_SIZE = 500    # rows fetched from Supabase per page
UPSERT_BATCH = 50   # points pushed to Qdrant per call
MAX_RETRIES = 5

# Namespace for deterministic UUIDs — avoids integer ID collisions with documents_v2
_UUID_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def _point_id(row_id: int) -> str:
    """Deterministic UUID from table row id — safe across collections."""
    return str(uuid.uuid5(_UUID_NS, f"cpg_{row_id}"))


def _parse_embedding(raw) -> list[float] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        try:
            return [float(x) for x in ast.literal_eval(raw)]
        except Exception:
            return None
    return None


def _build_payload(row: dict) -> dict:
    doi = row.get("doi") or ""
    source_url = (
        row.get("source_url")
        or (f"https://doi.org/{doi}" if doi else "")
        or row.get("iris_url", "")
        or ""
    )
    return {
        "doc_type": "guideline",
        "document_type": row.get("document_type", "guideline"),
        "content": row.get("content", ""),
        "guideline_title": row.get("guideline_title", ""),
        "chapter_title": row.get("chapter_title", ""),
        "pub_year": row.get("pub_year"),
        "issuing_body": row.get("issuing_body", ""),
        "issuing_body_canonical": row.get("issuing_body_canonical", ""),
        "chunk_index": row.get("chunk_index", 0),
        "source_url": source_url,
        "doi": doi,
        "iris_url": row.get("iris_url", ""),
        "evidence_tier": row.get("evidence_tier") or 1,
        "grade_strength": row.get("grade_strength", ""),
        "grade_direction": row.get("grade_direction", ""),
        "chunk_type": row.get("chunk_type", "text"),
        "is_current_version": row.get("is_current_version"),
        "authors": row.get("authors", ""),
        "domain": row.get("domain", ""),
        "population_tags": row.get("population_tags") or [],
        "condition_tags": row.get("condition_tags") or [],
        "intervention_tags": row.get("intervention_tags") or [],
        "licence": row.get("licence", ""),
    }


async def ingest(limit: int | None = None, clear_old: bool = False) -> None:
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import (
        Distance,
        FieldCondition,
        Filter,
        FilterSelector,
        MatchValue,
        PointStruct,
        ScalarQuantization,
        ScalarQuantizationConfig,
        ScalarType,
        VectorParams,
    )

    from backend.config import get_settings
    from supabase._async.client import AsyncClient, create_client

    settings = get_settings()

    if not settings.qdrant_url or not settings.qdrant_api_key:
        log.error("QDRANT_URL and QDRANT_API_KEY must be set in .env")
        sys.exit(1)

    log.info("Connecting to Supabase and Qdrant…")
    supabase: AsyncClient = await create_client(
        settings.supabase_url, settings.supabase_service_key
    )
    qdrant = AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=60)

    # Ensure collection exists (no-op if already there)
    collections = await qdrant.get_collections()
    existing = {c.name for c in collections.collections}
    if settings.qdrant_collection not in existing:
        log.info("Creating collection '%s'…", settings.qdrant_collection)
        await qdrant.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
            quantization_config=ScalarQuantization(
                scalar=ScalarQuantizationConfig(
                    type=ScalarType.INT8, quantile=0.99, always_ram=True
                )
            ),
        )
    else:
        log.info("Collection '%s' exists.", settings.qdrant_collection)

    # Delete old non-drug points to free space for new CPG data.
    # Preserves doc_type="drug" points; removes legacy/guideline/missing doc_type.
    if clear_old:
        log.info("Deleting old non-drug points from '%s'…", settings.qdrant_collection)
        await qdrant.delete(
            collection_name=settings.qdrant_collection,
            points_selector=FilterSelector(
                filter=Filter(
                    must_not=[FieldCondition(key="doc_type", match=MatchValue(value="drug"))]
                )
            ),
        )
        log.info("Old points deleted. Drug chunks preserved.")

    # Count rows to ingest
    count_res = await supabase.table(TABLE).select("id", count="exact").execute()
    total = min(count_res.count or 0, limit) if limit else (count_res.count or 0)
    log.info("Rows to ingest from %s: %d", TABLE, total)

    SELECT_COLS = (
        "id, content, embedding, guideline_title, chapter_title, pub_year, "
        "issuing_body, issuing_body_canonical, chunk_index, source_url, doi, "
        "iris_url, evidence_tier, grade_strength, grade_direction, chunk_type, "
        "is_current_version, document_type, authors, domain, "
        "population_tags, condition_tags, intervention_tags, licence"
    )

    offset = 0
    ingested = 0
    skipped = 0

    while offset < total:
        end = min(offset + BATCH_SIZE, total)
        log.info("Fetching rows %d–%d / %d…", offset, end, total)
        res = (
            await supabase.table(TABLE)
            .select(SELECT_COLS)
            .range(offset, end - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break

        points: list[PointStruct] = []
        for row in rows:
            vector = _parse_embedding(row.get("embedding"))
            if vector is None:
                skipped += 1
                continue
            points.append(
                PointStruct(
                    id=_point_id(row["id"]),
                    vector=vector,
                    payload=_build_payload(row),
                )
            )

        for i in range(0, len(points), UPSERT_BATCH):
            batch = points[i : i + UPSERT_BATCH]
            for attempt in range(MAX_RETRIES):
                try:
                    await qdrant.upsert(
                        collection_name=settings.qdrant_collection, points=batch
                    )
                    break
                except Exception as exc:
                    wait = 2**attempt
                    if attempt < MAX_RETRIES - 1:
                        log.warning("Upsert failed (%s) — retry %d in %ds", exc, attempt + 1, wait)
                        await asyncio.sleep(wait)
                    else:
                        raise
            ingested += len(batch)

        offset += BATCH_SIZE
        pct = ingested / total * 100 if total else 0
        log.info("Progress: %d / %d (%.1f%%) ingested, %d skipped", ingested, total, pct, skipped)

    log.info("Done. %d points upserted, %d skipped (no embedding).", ingested, skipped)
    await qdrant.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest CPG chunks into Qdrant")
    parser.add_argument("--limit", type=int, default=None, help="Max rows to ingest (omit for all)")
    parser.add_argument(
        "--clear-old",
        action="store_true",
        help="Delete existing non-drug points before ingesting (frees space for CPG data)",
    )
    args = parser.parse_args()
    asyncio.run(ingest(limit=args.limit, clear_old=args.clear_old))
