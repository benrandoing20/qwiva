"""
Validate the Qdrant collection and cross-check against Supabase.

Usage:
    python scripts/validate_qdrant.py [--sample 10]

Checks:
  1. Collection info: vector count, dimension, distance metric, payload indexes
  2. doc_type breakdown (guideline / drug / legacy)
  3. is_current_version breakdown
  4. Distinct guideline titles indexed
  5. Payload completeness on sampled points (new + legacy fields)
  6. Embedding sanity (dimension + non-zero)
  7. Cross-check: Supabase guideline_chunks + drug_chunk_table vs Qdrant point count
"""

import argparse
import asyncio
import sys

from dotenv import load_dotenv

load_dotenv()

# Fields that MUST be present on all points (new schema)
REQUIRED_FIELDS = ["content", "doc_type", "guideline_title", "chunk_index"]
# Fields expected on guideline points
GUIDELINE_FIELDS = ["is_current_version", "evidence_tier"]


async def validate(sample_n: int) -> None:
    from qdrant_client import AsyncQdrantClient
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    from backend.config import get_settings
    from backend.db import get_db

    settings = get_settings()

    if not settings.qdrant_url:
        print("ERROR: QDRANT_URL not set in .env")
        sys.exit(1)

    qdrant = AsyncQdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=30)
    col = settings.qdrant_collection

    print(f"\n{'=' * 60}")
    print(f"Validating Qdrant collection: '{col}'")
    print(f"{'=' * 60}\n")

    # 1. Collection info
    try:
        info = await qdrant.get_collection(col)
    except Exception as e:
        print(f"ERROR: Could not fetch collection '{col}': {e}")
        sys.exit(1)

    point_count = info.points_count or 0
    vec_config = info.config.params.vectors
    dim = getattr(vec_config, "size", "unknown")
    distance = getattr(vec_config, "distance", "unknown")

    print("COLLECTION INFO")
    print(f"  Points (vectors):  {point_count:,}")
    print(f"  Vector dimension:  {dim}")
    print(f"  Distance metric:   {distance}")
    if dim != 1536:
        print(f"  WARNING: Expected 1536-dim (text-embedding-3-small), got {dim}")

    # Payload indexes
    indexed_fields = []
    try:
        for field_name, field_schema in (info.payload_schema or {}).items():
            indexed_fields.append(field_name)
        if indexed_fields:
            print(f"  Payload indexes:   {', '.join(indexed_fields)}")
        else:
            print("  WARNING: No payload indexes found — run upsert_qdrant() to create them")
        for expected in ("doc_type", "is_current_version", "evidence_tier"):
            if expected not in indexed_fields:
                print(f"  WARNING: Missing payload index on '{expected}' — filtering will be slow")
    except Exception:
        pass

    # 2. doc_type breakdown
    print("\nDOC_TYPE BREAKDOWN")
    for doc_type in ("guideline", "drug", "legacy"):
        try:
            count_res = await qdrant.count(
                collection_name=col,
                count_filter=Filter(must=[FieldCondition(key="doc_type", match=MatchValue(value=doc_type))]),
                exact=False,
            )
            print(f"  {doc_type:12s}: {count_res.count:,}")
        except Exception as e:
            print(f"  {doc_type:12s}: (error: {e})")

    # 3. is_current_version breakdown
    print("\nVERSION FILTER")
    for flag in (True, False):
        try:
            count_res = await qdrant.count(
                collection_name=col,
                count_filter=Filter(must=[FieldCondition(key="is_current_version", match=MatchValue(value=flag))]),
                exact=False,
            )
            label = "current" if flag else "superseded"
            print(f"  is_current_version={flag} ({label}): {count_res.count:,}")
        except Exception as e:
            print(f"  is_current_version={flag}: (error: {e})")

    # 4. Distinct guideline titles
    print("\nINDEXED TITLES (sample via scroll)")
    titles: set[str] = set()
    offset = None
    while True:
        result, offset = await qdrant.scroll(
            collection_name=col,
            limit=500,
            with_payload=["guideline_title", "doc_type"],
            offset=offset,
        )
        for point in result:
            t = (point.payload or {}).get("guideline_title", "")
            if t:
                titles.add(t)
        if offset is None:
            break

    guideline_titles = sorted(titles)
    if guideline_titles:
        for t in guideline_titles[:30]:
            print(f"  • {t}")
        if len(guideline_titles) > 30:
            print(f"  ... and {len(guideline_titles) - 30} more")
    else:
        print("  (none found)")

    # 5. Payload completeness on sampled points
    print(f"\nPAYLOAD COMPLETENESS ({sample_n} sampled points)")
    sample_result, _ = await qdrant.scroll(
        collection_name=col,
        limit=sample_n,
        with_payload=True,
        with_vectors=True,
    )
    issues = 0
    for point in sample_result:
        payload = point.payload or {}
        doc_type = payload.get("doc_type", "?")
        missing = [f for f in REQUIRED_FIELDS if f not in payload or payload[f] is None]
        if doc_type in ("guideline", "legacy"):
            missing += [f for f in GUIDELINE_FIELDS if f not in payload or payload[f] is None]
        if missing:
            print(f"  Point {point.id} [{doc_type}]: MISSING fields: {missing}")
            issues += 1
        else:
            title = str(payload.get("guideline_title", "?"))[:50]
            chunk_idx = payload.get("chunk_index", "?")
            is_current = payload.get("is_current_version", "?")
            print(f"  Point {point.id} [{doc_type}]: OK  [{title}  chunk {chunk_idx}  current={is_current}]")

    # 6. Embedding sanity
    print("\nEMBEDDING SANITY")
    if sample_result:
        first = sample_result[0]
        vec = first.vector
        if vec is None:
            print("  WARNING: No vector returned — did you pass with_vectors=True?")
        else:
            actual_dim = len(vec)
            non_zero = sum(1 for v in vec if v != 0)
            print(f"  First point vector: dim={actual_dim}  non-zero={non_zero}")
            if actual_dim != 1536:
                print(f"  WARNING: Expected 1536, got {actual_dim}")
            if non_zero < 100:
                print(f"  WARNING: Very few non-zero values ({non_zero}) — embedding may be corrupt")
    else:
        print("  No points to sample")

    # 7. Supabase cross-check
    print("\nSUPABASE CROSS-CHECK")
    try:
        db = await get_db()

        # guideline_chunks (current only)
        gc_res = (
            await db.table(settings.guideline_chunk_table)
            .select("id", count="exact")
            .eq("is_current_version", True)
            .execute()
        )
        gc_count = gc_res.count or 0
        print(f"  guideline_chunks (current):  {gc_count:,}")

        # drug chunk table
        try:
            dc_res = (
                await db.table(settings.drug_chunk_table)
                .select("id", count="exact")
                .execute()
            )
            dc_count = dc_res.count or 0
            print(f"  {settings.drug_chunk_table}:       {dc_count:,}")
        except Exception as e:
            print(f"  {settings.drug_chunk_table}: (error: {e})")
            dc_count = 0

        # Legacy documents_v2
        try:
            legacy_res = (
                await db.table(settings.legacy_chunk_table)
                .select("id", count="exact")
                .execute()
            )
            legacy_count = legacy_res.count or 0
            print(f"  documents_v2 (legacy):       {legacy_count:,}")
        except Exception:
            legacy_count = 0

        print(f"  Qdrant total points:         {point_count:,}")

    except Exception as e:
        print(f"  Could not reach Supabase: {e}")

    print(f"\n{'=' * 60}")
    print(f"Validation complete. Payload issues found: {issues}")
    if issues == 0:
        print("All sampled points look healthy.")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate Qdrant collection + Supabase sync")
    parser.add_argument("--sample", type=int, default=10, help="Number of points to sample (default 10)")
    args = parser.parse_args()
    asyncio.run(validate(args.sample))
