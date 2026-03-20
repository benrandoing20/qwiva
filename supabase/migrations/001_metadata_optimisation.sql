-- =============================================================================
-- Migration 001: Promote hot JSONB metadata fields to generated stored columns
-- =============================================================================
-- Adds GENERATED ALWAYS AS STORED columns so application code and the ORM can
-- reference real columns with proper B-tree indexes instead of JSONB expressions.
--
-- NOTE: doc_id and chunk_index already have expression indexes in production
-- (idx_documents_v2_doc_id, idx_documents_v2_chunk_index). We add the generated
-- columns for cleaner query syntax but do NOT create duplicate indexes for those
-- two fields. New indexes are only added for fields not yet indexed.
-- =============================================================================

ALTER TABLE documents_v2
  ADD COLUMN IF NOT EXISTS guideline_title  TEXT
    GENERATED ALWAYS AS (metadata->>'guideline_title') STORED,
  ADD COLUMN IF NOT EXISTS publisher        TEXT
    GENERATED ALWAYS AS (metadata->>'publisher') STORED,
  ADD COLUMN IF NOT EXISTS geography        TEXT
    GENERATED ALWAYS AS (metadata->>'geography') STORED,
  ADD COLUMN IF NOT EXISTS doc_id_col       TEXT
    GENERATED ALWAYS AS (metadata->>'doc_id') STORED,
  ADD COLUMN IF NOT EXISTS chunk_index_col  INT
    GENERATED ALWAYS AS (
      CASE WHEN metadata->>'chunk_index' ~ '^\d+$'
           THEN (metadata->>'chunk_index')::int
           ELSE NULL
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS year_pub         INT
    GENERATED ALWAYS AS (
      CASE WHEN metadata->>'year' ~ '^\d{4}$'
           THEN (metadata->>'year')::int
           ELSE NULL
      END
    ) STORED;

-- New B-tree indexes for fields not yet indexed
-- (doc_id and chunk_index already covered by existing expression indexes)
CREATE INDEX IF NOT EXISTS idx_docs_guideline_title ON documents_v2 (guideline_title);
CREATE INDEX IF NOT EXISTS idx_docs_geography        ON documents_v2 (geography);
CREATE INDEX IF NOT EXISTS idx_docs_publisher        ON documents_v2 (publisher);
CREATE INDEX IF NOT EXISTS idx_docs_year_pub         ON documents_v2 (year_pub);

-- GIN index on full JSONB for any remaining fields (cascading_path etc.)
-- Only create if it doesn't already exist under any name
CREATE INDEX IF NOT EXISTS idx_docs_metadata_gin ON documents_v2 USING GIN (metadata);
