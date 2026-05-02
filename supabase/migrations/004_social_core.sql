-- =============================================================================
-- Migration 004: Social core — posts, comments, likes
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  content         TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  post_type       TEXT        NOT NULL DEFAULT 'question'
                              CHECK (post_type IN ('question', 'case_discussion', 'clinical_pearl', 'resource')),
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  specialty_tags  TEXT[]      NOT NULL DEFAULT '{}',
  image_urls      TEXT[]      NOT NULL DEFAULT '{}',
  is_anonymous    BOOLEAN     NOT NULL DEFAULT FALSE,
  like_count      INT         NOT NULL DEFAULT 0,
  comment_count   INT         NOT NULL DEFAULT 0,
  view_count      INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_posts_author     ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created    ON posts (created_at DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_posts_specialty  ON posts USING GIN (specialty_tags);
CREATE INDEX IF NOT EXISTS idx_posts_tags       ON posts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_posts_engagement ON posts (like_count DESC, comment_count DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_posts_fts        ON posts USING GIN (to_tsvector('english', content));

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_read" ON posts;
CREATE POLICY "posts_read"
  ON posts FOR SELECT
  USING (NOT is_deleted);

DROP POLICY IF EXISTS "posts_insert" ON posts;
CREATE POLICY "posts_insert"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "posts_update" ON posts;
CREATE POLICY "posts_update"
  ON posts FOR UPDATE
  USING (auth.uid() = author_id);

CREATE OR REPLACE FUNCTION touch_post()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_post ON posts;
CREATE TRIGGER trg_touch_post
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION touch_post();

-- Bump/decrement post_count on user_profiles
CREATE OR REPLACE FUNCTION update_user_post_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE user_profiles SET post_count = post_count + 1 WHERE user_id = NEW.author_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_deleted AND NOT OLD.is_deleted THEN
    UPDATE user_profiles SET post_count = GREATEST(0, post_count - 1) WHERE user_id = NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_post_count ON posts;
CREATE TRIGGER trg_user_post_count
  AFTER INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_user_post_count();

-- ---------------------------------------------------------------------------
-- Post likes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_likes (
  post_id    UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_likes_read" ON post_likes;
CREATE POLICY "post_likes_read"
  ON post_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "post_likes_write" ON post_likes;
CREATE POLICY "post_likes_write"
  ON post_likes FOR ALL
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_post_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSE
    UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_like_count ON post_likes;
CREATE TRIGGER trg_post_like_count
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION update_post_like_count();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id           UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id         UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  parent_comment_id UUID        REFERENCES comments(id) ON DELETE CASCADE,
  content           TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  is_anonymous      BOOLEAN     NOT NULL DEFAULT FALSE,
  like_count        INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_comment_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_read" ON comments;
CREATE POLICY "comments_read"
  ON comments FOR SELECT
  USING (NOT is_deleted);

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert"
  ON comments FOR INSERT
  WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "comments_update" ON comments;
CREATE POLICY "comments_update"
  ON comments FOR UPDATE
  USING (auth.uid() = author_id);

CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_deleted AND NOT OLD.is_deleted THEN
    UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_comment_count ON comments;
CREATE TRIGGER trg_post_comment_count
  AFTER INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_post_comment_count();

-- ---------------------------------------------------------------------------
-- Comment likes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id UUID        NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comment_likes_read" ON comment_likes;
CREATE POLICY "comment_likes_read"
  ON comment_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "comment_likes_write" ON comment_likes;
CREATE POLICY "comment_likes_write"
  ON comment_likes FOR ALL
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSE
    UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_like_count ON comment_likes;
CREATE TRIGGER trg_comment_like_count
  AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION update_comment_like_count();
