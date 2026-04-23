-- =============================================================================
-- Migration 005: Follow relationships + personalized feed RPC
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Follows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follows (
  follower_id  UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  following_id UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follows_read" ON follows;
CREATE POLICY "follows_read"
  ON follows FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "follows_write" ON follows;
CREATE POLICY "follows_write"
  ON follows FOR ALL
  USING (auth.uid() = follower_id);

-- Keep follower_count / following_count in sync
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE user_profiles SET following_count = following_count + 1 WHERE user_id = NEW.follower_id;
    UPDATE user_profiles SET follower_count  = follower_count  + 1 WHERE user_id = NEW.following_id;
    RETURN NEW;
  ELSE
    UPDATE user_profiles SET following_count = GREATEST(0, following_count - 1) WHERE user_id = OLD.follower_id;
    UPDATE user_profiles SET follower_count  = GREATEST(0, follower_count  - 1) WHERE user_id = OLD.following_id;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_counts ON follows;
CREATE TRIGGER trg_follow_counts
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- ---------------------------------------------------------------------------
-- get_personalized_feed: scored feed with follow boost, specialty match,
-- and recency decay. Returns cursor-paginated results.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_personalized_feed(
  p_user_id UUID,
  p_cursor  TIMESTAMPTZ DEFAULT NOW(),
  p_limit   INT         DEFAULT 20,
  p_filter  TEXT        DEFAULT 'all'   -- 'all' | 'following'
)
RETURNS TABLE (
  id               UUID,
  author_id        UUID,
  content          TEXT,
  post_type        TEXT,
  tags             TEXT[],
  specialty_tags   TEXT[],
  image_urls       TEXT[],
  is_anonymous     BOOLEAN,
  like_count       INT,
  comment_count    INT,
  view_count       INT,
  created_at       TIMESTAMPTZ,
  author_name      TEXT,
  author_specialty TEXT,
  author_avatar    TEXT,
  author_country   TEXT,
  author_verified  TEXT,
  viewer_liked     BOOLEAN,
  is_following     BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH viewer_interests AS (
    SELECT interests FROM user_profiles WHERE user_id = p_user_id
  )
  SELECT
    p.id,
    p.author_id,
    p.content,
    p.post_type,
    p.tags,
    p.specialty_tags,
    p.image_urls,
    p.is_anonymous,
    p.like_count,
    p.comment_count,
    p.view_count,
    p.created_at,
    CASE WHEN p.is_anonymous THEN 'Anonymous Physician' ELSE up.display_name END AS author_name,
    CASE WHEN p.is_anonymous THEN NULL ELSE up.specialty END                      AS author_specialty,
    CASE WHEN p.is_anonymous THEN NULL ELSE up.avatar_url END                     AS author_avatar,
    up.country                                                                     AS author_country,
    up.verification_status                                                         AS author_verified,
    (pl.user_id IS NOT NULL)                                                       AS viewer_liked,
    (f.follower_id IS NOT NULL)                                                    AS is_following
  FROM posts p
  JOIN user_profiles up ON up.user_id = p.author_id
  LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = p_user_id
  LEFT JOIN follows    f  ON f.follower_id = p_user_id AND f.following_id = p.author_id
  LEFT JOIN viewer_interests vi ON true
  WHERE
    NOT p.is_deleted
    AND p.created_at < p_cursor
    AND (p_filter = 'all' OR (p_filter = 'following' AND f.follower_id IS NOT NULL))
  ORDER BY
    -- Followed authors: 1.5× boost; specialty match: 1.2× boost; recency decay + engagement
    (
      CASE WHEN f.follower_id IS NOT NULL THEN 1.5 ELSE 1.0 END
      * CASE WHEN p.specialty_tags && vi.interests THEN 1.2 ELSE 1.0 END
      * (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 86400.0))
      + 0.1  * LN(1 + p.like_count)
      + 0.05 * LN(1 + p.comment_count)
    ) DESC
  LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- get_post_with_context: fetch a single post with author info + viewer context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_post_with_context(
  p_post_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  id               UUID,
  author_id        UUID,
  content          TEXT,
  post_type        TEXT,
  tags             TEXT[],
  specialty_tags   TEXT[],
  image_urls       TEXT[],
  is_anonymous     BOOLEAN,
  like_count       INT,
  comment_count    INT,
  view_count       INT,
  created_at       TIMESTAMPTZ,
  author_name      TEXT,
  author_specialty TEXT,
  author_avatar    TEXT,
  author_country   TEXT,
  author_verified  TEXT,
  viewer_liked     BOOLEAN,
  is_following     BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id, p.author_id, p.content, p.post_type, p.tags, p.specialty_tags,
    p.image_urls, p.is_anonymous, p.like_count, p.comment_count, p.view_count, p.created_at,
    CASE WHEN p.is_anonymous THEN 'Anonymous Physician' ELSE up.display_name END,
    CASE WHEN p.is_anonymous THEN NULL ELSE up.specialty END,
    CASE WHEN p.is_anonymous THEN NULL ELSE up.avatar_url END,
    up.country,
    up.verification_status,
    (pl.user_id IS NOT NULL),
    (f.follower_id IS NOT NULL)
  FROM posts p
  JOIN user_profiles up ON up.user_id = p.author_id
  LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = p_user_id
  LEFT JOIN follows    f  ON f.follower_id = p_user_id AND f.following_id = p.author_id
  WHERE p.id = p_post_id AND NOT p.is_deleted;
$$;

-- ---------------------------------------------------------------------------
-- get_comments_with_context: comments for a post with author info
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_comments_with_context(
  p_post_id UUID,
  p_user_id UUID,
  p_limit   INT DEFAULT 50
)
RETURNS TABLE (
  id                UUID,
  post_id           UUID,
  author_id         UUID,
  parent_comment_id UUID,
  content           TEXT,
  is_anonymous      BOOLEAN,
  like_count        INT,
  created_at        TIMESTAMPTZ,
  author_name       TEXT,
  author_specialty  TEXT,
  author_avatar     TEXT,
  author_verified   TEXT,
  viewer_liked      BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    c.id, c.post_id, c.author_id, c.parent_comment_id, c.content,
    c.is_anonymous, c.like_count, c.created_at,
    CASE WHEN c.is_anonymous THEN 'Anonymous Physician' ELSE up.display_name END,
    CASE WHEN c.is_anonymous THEN NULL ELSE up.specialty END,
    CASE WHEN c.is_anonymous THEN NULL ELSE up.avatar_url END,
    up.verification_status,
    (cl.user_id IS NOT NULL)
  FROM comments c
  JOIN user_profiles up ON up.user_id = c.author_id
  LEFT JOIN comment_likes cl ON cl.comment_id = c.id AND cl.user_id = p_user_id
  WHERE c.post_id = p_post_id AND NOT c.is_deleted
  ORDER BY c.created_at
  LIMIT p_limit;
$$;

-- ---------------------------------------------------------------------------
-- discover_users: find physicians by specialty/country, with follow context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION discover_users(
  p_user_id  UUID,
  p_specialty TEXT  DEFAULT NULL,
  p_country   TEXT  DEFAULT NULL,
  p_limit     INT   DEFAULT 20,
  p_offset    INT   DEFAULT 0
)
RETURNS TABLE (
  user_id             UUID,
  display_name        TEXT,
  specialty           TEXT,
  subspecialty        TEXT,
  institution         TEXT,
  country             TEXT,
  city                TEXT,
  bio                 TEXT,
  avatar_url          TEXT,
  years_experience    INT,
  verification_status TEXT,
  languages           TEXT[],
  interests           TEXT[],
  follower_count      INT,
  following_count     INT,
  post_count          INT,
  is_following        BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    up.user_id, up.display_name, up.specialty, up.subspecialty, up.institution,
    up.country, up.city, up.bio, up.avatar_url, up.years_experience,
    up.verification_status, up.languages, up.interests,
    up.follower_count, up.following_count, up.post_count,
    (f.follower_id IS NOT NULL) AS is_following
  FROM user_profiles up
  LEFT JOIN follows f ON f.follower_id = p_user_id AND f.following_id = up.user_id
  WHERE
    up.user_id <> p_user_id
    AND up.onboarding_complete = TRUE
    AND (p_specialty IS NULL OR up.specialty = p_specialty)
    AND (p_country IS NULL OR up.country = p_country)
  ORDER BY up.follower_count DESC, up.post_count DESC
  LIMIT p_limit OFFSET p_offset;
$$;
