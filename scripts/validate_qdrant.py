"""
Validate the Qdrant collection and cross-check against Supabase.

Usage:
    python scripts/validate_qdrant.py [--sample 5]

Checks:
  1. Collection info: vector count, dimension, distance metric
  2. Distinct guideline titles indexed
  3. Payload completeness on sampled points
  4. Embedding sanity (dimension + non-zero)
  5. Supabase documents_v2 row count vs Qdrant point count
"""

import argparse
import asyncio
import sys

from dotenv import load_dotenv

load_dotenv()

REQUIRED_FIELDS = ["content", "guideline_title", "cascading_path", "year", "publisher", "doc_id", "chunk_index"]


async def validate(sample_n: int) -> None:
    from qdrant_client import AsyncQdrantClient

    from backend.config import get_settings

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

    print(f"COLLECTION INFO")
    print(f"  Points (vectors):  {point_count:,}")
    print(f"  Vector dimension:  {dim}")
    print(f"  Distance metric:   {distance}")

    if dim != 1536:
        print(f"  WARNING: Expected 1536-dim (text-embedding-3-small), got {dim}")

    # 2. Distinct guideline titles
    print(f"\nINDEXED GUIDELINES")
    titles: set[str] = set()
    offset = None
    while True:
        result, offset = await qdrant.scroll(
            collection_name=col,
            limit=500,
            with_payload=["guideline_title"],
            offset=offset,
        )
        for point in result:
            t = (point.payload or {}).get("guideline_title", "")
            if t:
                titles.add(t)
        if offset is None:
            break

    if titles:
        for t in sorted(titles):
            print(f"  • {t}")
    else:
        print("  (none found)")

    # 3. Payload completeness on sampled points
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
        missing = [f for f in REQUIRED_FIELDS if f not in payload or payload[f] is None]
        if missing:
            print(f"  Point {point.id}: MISSING fields: {missing}")
            issues += 1
        else:
            title = payload.get("guideline_title", "?")[:50]
            chunk_idx = payload.get("chunk_index", "?")
            print(f"  Point {point.id}: OK  [{title}  chunk {chunk_idx}]")

    # 4. Embedding sanity
    print(f"\nEMBEDDING SANITY")
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

    # 5. Supabase cross-check
    print(f"\nSUPABASE CROSS-CHECK")
    try:
        from supabase._async.client import create_client

        sb = await create_client(settings.supabase_url, settings.supabase_service_key)
        resp = await sb.table("documents_v2").select("id", count="exact").execute()
        sb_count = resp.count or 0
        print(f"  Supabase documents_v2 rows: {sb_count:,}")
        print(f"  Qdrant points:              {point_count:,}")
        if sb_count != point_count:
            diff = abs(sb_count - point_count)
            print(f"  WARNING: Mismatch of {diff} — run ingest_pdf.py to sync")
        else:
            print(f"  OK: counts match")
    except Exception as e:
        print(f"  Could not reach Supabase: {e}")

    print(f"\n{'=' * 60}")
    print(f"Validation complete. Issues found: {issues}")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate Qdrant collection + Supabase sync")
    parser.add_argument("--sample", type=int, default=5, help="Number of points to sample for payload check (default 5)")
    args = parser.parse_args()
    asyncio.run(validate(args.sample))
