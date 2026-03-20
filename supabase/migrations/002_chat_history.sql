-- =============================================================================
-- Migration 002: Conversations and messages with branching tree structure
-- =============================================================================
-- Design: each message has a parent_id (tree node) and a selected_child_id
-- (which branch is currently active). The active path is reconstructed by
-- following selected_child_id from root to leaf — one recursive CTE, no extra
-- join table needed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT,                         -- NULL until first exchange completes
  title_generated BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
  ON conversations (user_id, updated_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_conversations" ON conversations;
CREATE POLICY "users_own_conversations"
  ON conversations FOR ALL
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_id         UUID        REFERENCES messages(id),   -- NULL = first message
  selected_child_id UUID        REFERENCES messages(id),   -- which branch is active; NULL = leaf
  role              TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content           TEXT        NOT NULL,
  citations         JSONB,                                 -- assistant only
  evidence_grade    TEXT,                                  -- assistant only
  branch_index      INT         NOT NULL DEFAULT 0,        -- 0=original, 1,2...=edits
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON messages (parent_id);
-- Index for branch switching: find siblings (same parent) quickly
CREATE INDEX IF NOT EXISTS idx_messages_parent_branch
  ON messages (parent_id, branch_index);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_messages" ON messages;
CREATE POLICY "users_own_messages"
  ON messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Auto-bump conversations.updated_at when a message is inserted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_conversation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE conversations SET updated_at = NOW() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_conversation ON messages;
CREATE TRIGGER trg_touch_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION touch_conversation();

-- ---------------------------------------------------------------------------
-- get_active_path(conversation_id)
-- Returns the linear sequence of messages on the currently active branch,
-- ordered oldest → newest. Call this to render a conversation in the UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_active_path(p_conversation_id UUID)
RETURNS TABLE (
  id                UUID,
  parent_id         UUID,
  selected_child_id UUID,
  role              TEXT,
  content           TEXT,
  citations         JSONB,
  evidence_grade    TEXT,
  branch_index      INT,
  created_at        TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH RECURSIVE path AS (
    -- Root: first message in this conversation (no parent)
    SELECT m.id, m.parent_id, m.selected_child_id, m.role, m.content,
           m.citations, m.evidence_grade, m.branch_index, m.created_at
    FROM messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.parent_id IS NULL

    UNION ALL

    -- Follow selected_child_id at each node
    SELECT m.id, m.parent_id, m.selected_child_id, m.role, m.content,
           m.citations, m.evidence_grade, m.branch_index, m.created_at
    FROM messages m
    INNER JOIN path p ON m.id = p.selected_child_id
  )
  SELECT * FROM path ORDER BY created_at;
$$;

-- ---------------------------------------------------------------------------
-- get_siblings(parent_message_id)
-- Returns all branches at a given fork point — used to render branch switcher.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_siblings(p_parent_id UUID)
RETURNS TABLE (
  id           UUID,
  branch_index INT,
  content      TEXT,
  created_at   TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id, branch_index, content, created_at
  FROM messages
  WHERE parent_id = p_parent_id
  ORDER BY branch_index;
$$;
