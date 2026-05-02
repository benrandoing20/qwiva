-- =============================================================================
-- Migration 006: Surveys feature
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Role column on user_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'physician'
    CHECK (role IN ('physician', 'admin'));

-- ---------------------------------------------------------------------------
-- surveys
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS surveys (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by        UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  title             TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description       TEXT,
  specialty_tags    TEXT[]      NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'active', 'closed')),
  is_anonymous      BOOLEAN     NOT NULL DEFAULT FALSE,
  estimated_minutes INT,
  response_count    INT         NOT NULL DEFAULT 0,
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surveys_status     ON surveys (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_surveys_created_by ON surveys (created_by);
CREATE INDEX IF NOT EXISTS idx_surveys_specialty  ON surveys USING GIN (specialty_tags);

ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surveys_read_active" ON surveys;
CREATE POLICY "surveys_read_active"
  ON surveys FOR SELECT
  USING (status = 'active' OR auth.uid() = created_by);

DROP POLICY IF EXISTS "surveys_admin_insert" ON surveys;
CREATE POLICY "surveys_admin_insert"
  ON surveys FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "surveys_admin_update" ON surveys;
CREATE POLICY "surveys_admin_update"
  ON surveys FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION touch_survey()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_survey ON surveys;
CREATE TRIGGER trg_touch_survey
  BEFORE UPDATE ON surveys
  FOR EACH ROW EXECUTE FUNCTION touch_survey();

-- ---------------------------------------------------------------------------
-- survey_questions
-- Options JSONB stores [{id: "<uuid>", text: "..."}] for MC/multi_select.
-- Using stable UUIDs per option ensures aggregation is correct over time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS survey_questions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id        UUID    NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  question_text    TEXT    NOT NULL CHECK (char_length(question_text) BETWEEN 1 AND 1000),
  question_type    TEXT    NOT NULL
                           CHECK (question_type IN ('multiple_choice', 'multi_select', 'scale', 'open_text')),
  options          JSONB,
  scale_min        INT     DEFAULT 1,
  scale_max        INT     DEFAULT 5,
  scale_min_label  TEXT,
  scale_max_label  TEXT,
  is_required      BOOLEAN NOT NULL DEFAULT TRUE,
  order_index      INT     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions (survey_id, order_index);

ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_questions_read" ON survey_questions;
CREATE POLICY "survey_questions_read"
  ON survey_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM surveys s
      WHERE s.id = survey_id
        AND (s.status = 'active' OR auth.uid() = s.created_by)
    )
  );

DROP POLICY IF EXISTS "survey_questions_admin_write" ON survey_questions;
CREATE POLICY "survey_questions_admin_write"
  ON survey_questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- survey_responses  (one per user per survey, enforced by UNIQUE constraint)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS survey_responses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id  UUID        NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_user   ON survey_responses (user_id);

ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_responses_insert" ON survey_responses;
CREATE POLICY "survey_responses_insert"
  ON survey_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "survey_responses_read" ON survey_responses;
CREATE POLICY "survey_responses_read"
  ON survey_responses FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM surveys s
      WHERE s.id = survey_id AND s.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Increment response_count on surveys when a new response is submitted
CREATE OR REPLACE FUNCTION increment_survey_response_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE surveys SET response_count = response_count + 1 WHERE id = NEW.survey_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_survey_response_count ON survey_responses;
CREATE TRIGGER trg_survey_response_count
  AFTER INSERT ON survey_responses
  FOR EACH ROW EXECUTE FUNCTION increment_survey_response_count();

-- ---------------------------------------------------------------------------
-- survey_answers
-- answer_options stores selected option IDs (UUIDs from options JSONB) for
-- multiple_choice and multi_select questions.
-- answer_text stores the string value for scale (e.g. "3") and open_text.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS survey_answers (
  id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id    UUID  NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id    UUID  NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  answer_text    TEXT,
  answer_options TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_survey_answers_response  ON survey_answers (response_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question  ON survey_answers (question_id);

ALTER TABLE survey_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_answers_insert" ON survey_answers;
CREATE POLICY "survey_answers_insert"
  ON survey_answers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM survey_responses sr
      WHERE sr.id = response_id AND sr.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "survey_answers_read" ON survey_answers;
CREATE POLICY "survey_answers_read"
  ON survey_answers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM survey_responses sr
      WHERE sr.id = response_id AND sr.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM survey_responses sr
      JOIN surveys s ON s.id = sr.survey_id
      WHERE sr.id = response_id
        AND (
          s.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE user_id = auth.uid() AND role = 'admin'
          )
        )
    )
  );
