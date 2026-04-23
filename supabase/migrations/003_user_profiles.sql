-- =============================================================================
-- Migration 003: User profiles for the medical community platform
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id             UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        TEXT        NOT NULL,
  specialty           TEXT,
  subspecialty        TEXT,
  institution         TEXT,
  country             TEXT        NOT NULL DEFAULT 'Kenya',
  city                TEXT,
  bio                 TEXT,
  avatar_url          TEXT,
  years_experience    INT,
  medical_license     TEXT,
  verification_status TEXT        NOT NULL DEFAULT 'unverified'
                                  CHECK (verification_status IN ('unverified', 'pending', 'verified')),
  languages           TEXT[]      NOT NULL DEFAULT '{}',
  interests           TEXT[]      NOT NULL DEFAULT '{}',
  onboarding_complete BOOLEAN     NOT NULL DEFAULT FALSE,
  follower_count      INT         NOT NULL DEFAULT 0,
  following_count     INT         NOT NULL DEFAULT 0,
  post_count          INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_specialty ON user_profiles (specialty);
CREATE INDEX IF NOT EXISTS idx_profiles_country   ON user_profiles (country);
CREATE INDEX IF NOT EXISTS idx_profiles_followers ON user_profiles (follower_count DESC);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_read_all" ON user_profiles;
CREATE POLICY "profiles_read_all"
  ON user_profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "profiles_own_insert" ON user_profiles;
CREATE POLICY "profiles_own_insert"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "profiles_own_update" ON user_profiles;
CREATE POLICY "profiles_own_update"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-bump updated_at on any update
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_profile()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_profile ON user_profiles;
CREATE TRIGGER trg_touch_profile
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_profile();

-- ---------------------------------------------------------------------------
-- Auto-create a skeleton profile whenever a new user signs up
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_profiles (user_id, display_name, country)
  VALUES (NEW.id, split_part(NEW.email, '@', 1), 'Kenya')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill skeleton profiles for any users who already exist
-- ---------------------------------------------------------------------------
INSERT INTO user_profiles (user_id, display_name, country)
SELECT id, split_part(email, '@', 1), 'Kenya'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
