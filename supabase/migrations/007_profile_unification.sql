-- =============================================================================
-- Migration 007: Unify profile schema with mobile onboarding fields
-- =============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS first_name          TEXT,
  ADD COLUMN IF NOT EXISTS last_name           TEXT,
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  ADD COLUMN IF NOT EXISTS cadre               TEXT
    CHECK (cadre IN ('Medical Practitioner', 'Clinical Officer', 'Dental Practitioner', 'Intern')),
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS specialties         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_rotation    TEXT[] NOT NULL DEFAULT '{}';

-- Best-effort backfill: split existing display_name into first/last name
UPDATE user_profiles
SET
  first_name = split_part(display_name, ' ', 1),
  last_name  = NULLIF(
    trim(substring(display_name FROM position(' ' IN display_name) + 1)),
    ''
  )
WHERE first_name IS NULL
  AND display_name IS NOT NULL
  AND display_name <> ''
  AND position(' ' IN display_name) > 0;
