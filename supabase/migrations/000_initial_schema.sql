-- =============================================================================
-- Migration 000: Complete baseline schema
-- =============================================================================
-- Documents the exact state of the database before any Qwiva migrations.
-- DO NOT run against the live database — it already has this schema.
-- Run only when standing up a fresh database from scratch.
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;    -- pgvector: embeddings + similarity ops
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram fuzzy search (used by dynamic_hybrid_search_db)

-- ---------------------------------------------------------------------------
-- record_manager_v2
-- Custom ingestion record manager. Tracks every document ingested into the
-- corpus with its hash (dedup), parsed metadata, and processing status.
-- tabular_document_rows references this table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS record_manager_v2 (
  id                 BIGSERIAL    PRIMARY KEY,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  doc_id             TEXT         NOT NULL,
  hash               TEXT         NOT NULL,        -- content hash for dedup
  data_type          TEXT,                         -- e.g. "pdf", "docx"
  schema             TEXT,                         -- document schema type
  document_title     TEXT,
  graph_id           TEXT,                         -- knowledge graph reference
  hierarchical_index TEXT,                         -- section hierarchy string
  document_headline  TEXT,
  document_summary   TEXT,
  status             TEXT                          -- e.g. "processed", "pending"
);

-- ---------------------------------------------------------------------------
-- metadata_fields
-- Schema registry: lists valid metadata field names and their allowed values.
-- Used by the ingestion pipeline to validate chunk metadata.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_fields (
  id             BIGSERIAL    PRIMARY KEY,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata_name  TEXT         NOT NULL,
  allowed_values TEXT         NOT NULL   -- comma-separated or JSON list
);

-- ---------------------------------------------------------------------------
-- documents_v2
-- Core chunk store: content + 1536-dim embedding + FTS + JSONB metadata.
-- 82,000+ chunks from Kenyan clinical guidelines.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents_v2 (
  id                BIGSERIAL    PRIMARY KEY,
  content           TEXT         NOT NULL,
  embedding         vector(1536),                  -- text-embedding-3-small via NVIDIA hub
  metadata          JSONB        NOT NULL DEFAULT '{}',
  fts               TSVECTOR,                      -- populated at ingestion time
  record_manager_id TEXT                           -- soft link to record_manager_v2.doc_id
);

-- Known metadata keys:
--   guideline_title  TEXT   — display name, used in citations
--   publisher        TEXT   — e.g. "Kenya MoH", "WHO"
--   year             TEXT   — publication year (stored as string)
--   geography        TEXT   — e.g. "Kenya"
--   cascading_path   TEXT   — breadcrumb, e.g. "Chapter 3 > 3.2 > Treatment"
--   doc_id           TEXT   — source document identifier
--   chunk_index      INT    — position within the document

-- HNSW cosine similarity (pgvector)
CREATE INDEX IF NOT EXISTS documents_v2_embedding_idx
  ON documents_v2 USING hnsw (embedding vector_cosine_ops);

-- GIN full-text search
CREATE INDEX IF NOT EXISTS documents_v2_fts_idx
  ON documents_v2 USING gin (fts);

-- Expression B-tree indexes on frequently queried JSONB fields
CREATE INDEX IF NOT EXISTS idx_documents_v2_doc_id
  ON documents_v2 USING btree ((metadata->>'doc_id'));

CREATE INDEX IF NOT EXISTS idx_documents_v2_chunk_index
  ON documents_v2 USING btree (((metadata->>'chunk_index')::integer));

CREATE INDEX IF NOT EXISTS idx_documents_v2_doc_id_chunk_index
  ON documents_v2 USING btree (
    (metadata->>'doc_id'),
    ((metadata->>'chunk_index')::integer)
  );

CREATE INDEX IF NOT EXISTS idx_documents_v2_record_manager_id
  ON documents_v2 USING btree (record_manager_id);

-- ---------------------------------------------------------------------------
-- tabular_document_rows
-- Structured rows extracted from tables inside guidelines (dosing tables,
-- diagnostic criteria tables, etc.). Linked to the source document via
-- record_manager_v2. Used by the dose calculator question type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tabular_document_rows (
  id                BIGSERIAL    PRIMARY KEY,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  record_manager_id BIGINT       REFERENCES record_manager_v2(id),
  row_data          JSONB                          -- flexible row contents
);

-- ---------------------------------------------------------------------------
-- n8n_chat_histories
-- Previous n8n-based chat history (flat, no tree structure).
-- Superseded by the conversations + messages tables in migration 002.
-- Retained as-is; do not drop — may contain historical session data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS n8n_chat_histories (
  id         SERIAL        PRIMARY KEY,
  session_id VARCHAR       NOT NULL,
  message    JSONB         NOT NULL                -- n8n message envelope
);

-- ---------------------------------------------------------------------------
-- match_documents — simple HNSW cosine vector search
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count     int
)
RETURNS TABLE (
  id         bigint,
  content    text,
  metadata   jsonb,
  similarity float
)
LANGUAGE sql AS $$
  SELECT
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) AS similarity
  FROM documents_v2
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ---------------------------------------------------------------------------
-- get_chunks_by_ranges — fetch contiguous chunks by doc_id + index ranges
-- Used by context expansion (e.g. surrounding chunks around a reranked hit).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_chunks_by_ranges(input_data jsonb)
RETURNS TABLE (
  doc_id      text,
  chunk_index integer,
  content     text,
  metadata    jsonb,
  id          bigint
)
LANGUAGE plpgsql AS $$
DECLARE
  doc_item        JSONB;
  range_item      JSONB;
  range_start     INTEGER;
  range_end       INTEGER;
  current_doc_id  TEXT;
BEGIN
  FOR doc_item IN SELECT * FROM jsonb_array_elements(input_data)
  LOOP
    current_doc_id := doc_item->>'doc_id';
    FOR range_item IN SELECT * FROM jsonb_array_elements(doc_item->'chunk_ranges')
    LOOP
      range_start := (range_item->0)::INTEGER;
      range_end   := (range_item->1)::INTEGER;
      RETURN QUERY
        SELECT
          current_doc_id AS doc_id,
          (d.metadata->>'chunk_index')::INTEGER AS chunk_index,
          d.content,
          d.metadata,
          d.id
        FROM documents_v2 d
        WHERE d.metadata->>'doc_id' = current_doc_id
          AND (d.metadata->>'chunk_index')::INTEGER >= range_start
          AND (d.metadata->>'chunk_index')::INTEGER <= range_end
        ORDER BY (d.metadata->>'chunk_index')::INTEGER;
    END LOOP;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- dynamic_hybrid_search_db — vector + FTS hybrid search with RRF merge
-- Called from rag.py with: dense_weight=0.6, sparse_weight=0.4, others=0.
-- Supports optional ilike and fuzzy search via weight flags.
-- Full 200-line body stored in DB; abbreviated here for readability.
-- Retrieve exact production body with:
--   SELECT routine_definition FROM information_schema.routines
--   WHERE routine_name = 'dynamic_hybrid_search_db';
-- ---------------------------------------------------------------------------
-- [Full function body omitted — too long for migration file.
--  Copy exact body from the query above when setting up fresh.]
