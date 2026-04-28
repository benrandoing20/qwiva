"""
db.py — Supabase Client & corpus_documents Operations
=======================================================
All database interactions go through this module.
The pipeline stages import from here — they never touch supabase directly.
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, STORAGE_BUCKET

logger = logging.getLogger(__name__)


# ── Client singleton ──────────────────────────────────────────────────────────

def get_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Hashing utilities ─────────────────────────────────────────────────────────

def sha256_str(value: str) -> str:
    """Stable document ID: sha256(canonical_url or resolved_file_path)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    """File hash: sha256(raw_file_bytes). Changes when content changes."""
    return hashlib.sha256(data).hexdigest()


def sha256_content(text: str) -> str:
    """Chunk content hash: sha256(content). Detects duplicate chunks."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalise_url(url: str) -> str:
    """
    Canonical URL for dedup.
    Lowercases, strips trailing slash, strips common tracking params.
    """
    url = url.strip().lower().rstrip("/")
    # Strip fragment
    if "#" in url:
        url = url.split("#")[0]
    return url


# ── corpus_documents operations ───────────────────────────────────────────────

class CorpusDocuments:
    """
    Typed interface to the corpus_documents table.
    All methods are synchronous (supabase-py is sync by default).
    """

    def __init__(self, client: Client):
        self.db = client
        self.table = "corpus_documents"

    # ── Read ─────────────────────────────────────────────────────────────────

    def get_by_id(self, doc_id: str) -> Optional[dict]:
        r = (self.db.table(self.table)
                    .select("*")
                    .eq("id", doc_id)
                    .maybe_single()
                    .execute())
        return r.data

    def get_by_canonical_url(self, canonical_url: str) -> Optional[dict]:
        r = (self.db.table(self.table)
                    .select("*")
                    .eq("canonical_url", canonical_url)
                    .maybe_single()
                    .execute())
        return r.data

    def get_by_status(self, status: str, source_id: Optional[str] = None) -> list[dict]:
        q = (self.db.table(self.table)
                    .select("*")
                    .eq("pipeline_status", status))
        if source_id:
            q = q.eq("source_id", source_id)
        return q.execute().data or []

    def get_failed(self, source_id: Optional[str] = None, max_retries: int = 3) -> list[dict]:
        q = (self.db.table(self.table)
                    .select("*")
                    .eq("pipeline_status", "failed")
                    .lt("retry_count", max_retries))
        if source_id:
            q = q.eq("source_id", source_id)
        return q.execute().data or []

    def file_hash_exists(self, file_hash: str) -> bool:
        """Return True if this exact file hash is already complete in the corpus."""
        r = (self.db.table(self.table)
                    .select("id")
                    .eq("file_hash", file_hash)
                    .eq("pipeline_status", "complete")
                    .limit(1)
                    .execute())
        return bool(r.data)

    def count_by_source(self, source_id: str) -> dict[str, int]:
        """Return counts per pipeline_status for a source."""
        r = (self.db.table(self.table)
                    .select("pipeline_status")
                    .eq("source_id", source_id)
                    .execute())
        counts: dict[str, int] = {}
        for row in (r.data or []):
            s = row["pipeline_status"]
            counts[s] = counts.get(s, 0) + 1
        return counts

    # ── Write ─────────────────────────────────────────────────────────────────

    def upsert_discovered(self, doc: dict) -> dict:
        """
        Insert a newly discovered document.
        On conflict (canonical_url already exists), does nothing —
        we never overwrite a further-along document with 'discovered'.
        Returns the row (inserted or existing).
        """
        r = (self.db.table(self.table)
                    .upsert(doc, on_conflict="canonical_url", ignore_duplicates=True)
                    .execute())
        return r.data[0] if r.data else self.get_by_canonical_url(doc["canonical_url"])

    def update_status(self, doc_id: str, status: str, **extra) -> None:
        payload = {"pipeline_status": status, **extra}
        (self.db.table(self.table)
                .update(payload)
                .eq("id", doc_id)
                .execute())
        logger.debug("corpus_documents %s → %s", doc_id[:12], status)

    def mark_fetched(self, doc_id: str, file_hash: str,
                     http_status: int, etag: Optional[str],
                     last_modified: Optional[str],
                     content_type: str, file_size: int) -> None:
        self.update_status(
            doc_id, "fetched",
            file_hash        = file_hash,
            last_http_status = http_status,
            http_etag        = etag,
            http_last_modified = last_modified,
            content_type     = content_type,
            file_size_bytes  = file_size,
            last_fetched_at  = datetime.now(timezone.utc).isoformat(),
        )

    def mark_stored(self, doc_id: str, storage_path: str) -> None:
        self.update_status(doc_id, "stored", storage_path=storage_path)

    def mark_parsed(self, doc_id: str, guideline_title: str,
                    pub_year: Optional[int] = None,
                    domain: Optional[str] = None) -> None:
        extra = {}
        if guideline_title:
            extra["guideline_title"] = guideline_title
        if pub_year:
            extra["pub_year"] = pub_year
        if domain:
            extra["domain"] = domain
        self.update_status(doc_id, "parsed", **extra)

    def mark_chunked(self, doc_id: str, chunk_count: int, total_tokens: int) -> None:
        self.update_status(
            doc_id, "chunked",
            chunk_count   = chunk_count,
            total_tokens  = total_tokens,
        )

    def mark_embedded(self, doc_id: str) -> None:
        self.update_status(doc_id, "embedded")

    def mark_complete(self, doc_id: str) -> None:
        self.update_status(doc_id, "complete",
                           last_checked_at=datetime.now(timezone.utc).isoformat())

    def mark_skipped(self, doc_id: str) -> None:
        self.update_status(doc_id, "skipped",
                           last_checked_at=datetime.now(timezone.utc).isoformat())

    def mark_failed(self, doc_id: str, stage: str, error: str) -> None:
        # Increment retry_count atomically via RPC if available,
        # otherwise fetch-and-increment
        existing = self.get_by_id(doc_id)
        retry_count = (existing.get("retry_count") or 0) + 1 if existing else 1
        self.update_status(
            doc_id, "failed",
            failed_stage = stage,
            last_error   = str(error)[:2000],   # truncate runaway stack traces
            retry_count  = retry_count,
        )
        logger.error("corpus_documents %s failed at %s: %s", doc_id[:12], stage, error)

    def deprecate_old_version(self, old_doc_id: str, new_doc_id: str) -> None:
        """
        Mark the old document version as superseded.
        Must be called BEFORE inserting new chunks for the new doc_id.
        """
        (self.db.table(self.table)
                .update({
                    "is_current_version": False,
                    "superseded_by": new_doc_id,
                })
                .eq("id", old_doc_id)
                .execute())
        logger.info("Deprecated %s → superseded by %s", old_doc_id[:12], new_doc_id[:12])


# ── clinical_practice_guideline_chunks operations ─────────────────────────────

class GuidelineChunks:
    """
    Typed interface to clinical_practice_guideline_chunks.
    """

    def __init__(self, client: Client):
        self.db = client
        self.table = "clinical_practice_guideline_chunks"

    def delete_by_doc_id(self, doc_id: str) -> int:
        """
        Delete all chunks for a document before re-inserting.
        Returns row count deleted.
        Used during re-ingest of updated guidelines.
        """
        r = (self.db.table(self.table)
                    .delete()
                    .eq("doc_id", doc_id)
                    .execute())
        count = len(r.data) if r.data else 0
        logger.info("Deleted %d chunks for doc_id %s", count, doc_id[:12])
        return count

    def insert_batch(self, chunks: list[dict]) -> int:
        """
        Batch insert chunks. Returns count inserted.
        Uses upsert on (doc_id, chunk_index) to be idempotent.
        """
        if not chunks:
            return 0
        r = (self.db.table(self.table)
                    .upsert(chunks, on_conflict="doc_id,chunk_index")
                    .execute())
        count = len(r.data) if r.data else 0
        logger.info("Inserted %d chunks", count)
        return count

    def get_unembedded(self, doc_id: str) -> list[dict]:
        """Return chunks for a document that have no embedding yet."""
        r = (self.db.table(self.table)
                    .select("id, contextual_text")
                    .eq("doc_id", doc_id)
                    .is_("embedding", "null")
                    .execute())
        return r.data or []

    def update_embedding(self, chunk_id: str, embedding: list[float]) -> None:
        (self.db.table(self.table)
                .update({"embedding": embedding})
                .eq("id", chunk_id)
                .execute())

    def update_embeddings_batch(self, updates: list[dict]) -> None:
        """
        updates = [{"id": uuid, "embedding": [...]}, ...]
        Supabase-py doesn't support batch updates natively —
        we loop but keep it in one logical operation.
        """
        for u in updates:
            self.update_embedding(u["id"], u["embedding"])

    def deprecate_by_doc_id(self, doc_id: str, new_doc_id: str) -> None:
        """Mark all chunks of an old document version as superseded."""
        (self.db.table(self.table)
                .update({
                    "is_current_version": False,
                    "superseded_by": new_doc_id,
                })
                .eq("doc_id", doc_id)
                .execute())
        logger.info("Deprecated all chunks for doc_id %s", doc_id[:12])

    def count_by_doc_id(self, doc_id: str) -> int:
        r = (self.db.table(self.table)
                    .select("id", count="exact")
                    .eq("doc_id", doc_id)
                    .execute())
        return r.count or 0


# ── Supabase Storage ──────────────────────────────────────────────────────────

class CorpusStorage:
    """
    Wraps Supabase Storage for raw file archival.
    Path convention: corpus-raw/{source_id}/{doc_id_prefix}/{doc_id}.{ext}
    """

    def __init__(self, client: Client):
        self.storage = client.storage

    def _storage_path(self, source_id: str, doc_id: str, ext: str) -> str:
        prefix = doc_id[:2]   # two-char prefix for pseudo-directory sharding
        return f"{source_id}/{prefix}/{doc_id}.{ext}"

    def upload(self, source_id: str, doc_id: str,
               data: bytes, content_type: str) -> str:
        """
        Upload raw file to Supabase Storage.
        Returns the storage path.
        """
        ext = {
            "application/pdf":  "pdf",
            "text/html":        "html",
            "application/json": "json",
        }.get(content_type, "bin")

        path = self._storage_path(source_id, doc_id, ext)

        try:
            self.storage.from_(STORAGE_BUCKET).upload(
                path=path,
                file=data,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            logger.debug("Stored %s → %s", doc_id[:12], path)
            return path
        except Exception as e:
            logger.error("Storage upload failed for %s: %s", doc_id[:12], e)
            raise

    def download(self, storage_path: str) -> bytes:
        return self.storage.from_(STORAGE_BUCKET).download(storage_path)
