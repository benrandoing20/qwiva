-- =============================================================================
-- PDF Pipeline Migration
-- Run once in Supabase SQL editor before deploying pdf-pipeline to Railway.
-- Safe to re-run — uses IF NOT EXISTS throughout.
-- =============================================================================

-- Add columns to corpus_documents to support PDF pipeline
ALTER TABLE corpus_documents
    ADD COLUMN IF NOT EXISTS original_filename   TEXT,
    ADD COLUMN IF NOT EXISTS raw_metadata        JSONB,
    ADD COLUMN IF NOT EXISTS ocr_quality         TEXT,      -- 'clean' | 'ocr_good' | 'ocr_low' | 'mixed'
    ADD COLUMN IF NOT EXISTS metadata_confidence FLOAT;

-- New pipeline_status values used by pdf-pipeline:
--   uploaded           → PDF in storage, awaiting metadata extraction
--   metadata_extracted → Claude extracted metadata, confidence >= 0.7
--   metadata_review    → confidence < 0.7, needs human check before continuing
--   stored             → (existing) text extracted, ready for chunking
--   parsed             → (existing) chunks built
--   chunked            → (existing) ready for embedding
--   complete           → (existing) embedded + inserted
--   failed             → (existing) error

-- Index for pipeline worker polling
CREATE INDEX IF NOT EXISTS idx_corpus_pdf_pipeline
    ON corpus_documents (source_id, pipeline_status)
    WHERE source_id LIKE 'pdf_%';

-- View: review queue for low-confidence metadata extractions
CREATE OR REPLACE VIEW pdf_metadata_review AS
SELECT
    id,
    original_filename,
    raw_metadata->>'title'            AS extracted_title,
    raw_metadata->>'issuing_body'     AS extracted_body,
    raw_metadata->>'domain'           AS extracted_domain,
    raw_metadata->>'pub_year'         AS extracted_year,
    raw_metadata->>'geographic_scope' AS extracted_scope,
    metadata_confidence,
    raw_metadata->>'error'            AS extraction_error,
    pipeline_status,
    created_at
FROM corpus_documents
WHERE pipeline_status IN ('metadata_review', 'uploaded')
  AND source_id LIKE 'pdf_%'
ORDER BY created_at DESC;

-- View: pipeline progress summary
CREATE OR REPLACE VIEW pdf_pipeline_progress AS
SELECT
    source_id,
    pipeline_status,
    COUNT(*)                                             AS doc_count,
    AVG(metadata_confidence)                             AS avg_confidence,
    COUNT(*) FILTER (WHERE ocr_quality = 'clean')        AS clean_text,
    COUNT(*) FILTER (WHERE ocr_quality = 'ocr_good')     AS ocr_good,
    COUNT(*) FILTER (WHERE ocr_quality = 'ocr_low')      AS ocr_low
FROM corpus_documents
WHERE source_id LIKE 'pdf_%'
GROUP BY source_id, pipeline_status
ORDER BY source_id, pipeline_status;
