-- GoTogether Carpool Product - Migration 03: V1 Quick Chat & Conversations Schema

-- 1. Create `conversations` Table tied 1:1 with an accepted `join_request`
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  join_request_id uuid NOT NULL UNIQUE REFERENCES join_requests(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 2. Create `messages` Table with Quick-Message Validation
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  sender_name text NOT NULL,
  quick_message_key text NOT NULL,
  quick_message_text text NOT NULL,
  created_at timestamptz DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT chk_valid_quick_message_key CHECK (
    quick_message_key IN (
      'where_meet',
      'near_metro',
      'around_time',
      'ready_leave',
      'thanks_see_you'
    )
  )
);

-- 3. Create Indexes for High Performance Queries
CREATE INDEX IF NOT EXISTS idx_conversations_join_request ON conversations(join_request_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(conversation_id, read_at) WHERE read_at IS NULL;

-- 4. Automatic Conversation Initializer Trigger on Request Acceptance
CREATE OR REPLACE FUNCTION auto_create_conversation_on_acceptance()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status != 'accepted') THEN
    INSERT INTO conversations (join_request_id)
    VALUES (NEW.id)
    ON CONFLICT (join_request_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_create_conversation ON join_requests;
CREATE TRIGGER trg_auto_create_conversation
AFTER INSERT OR UPDATE ON join_requests
FOR EACH ROW
EXECUTE FUNCTION auto_create_conversation_on_acceptance();

-- 5. Row Level Security (RLS) Policies
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is participant of conversation
CREATE OR REPLACE FUNCTION is_conversation_participant(conv_id uuid, user_profile_id uuid)
RETURNS boolean AS $$
DECLARE
  is_part boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    JOIN join_requests jr ON c.join_request_id = jr.id
    JOIN journeys rj ON jr.requester_journey_id = rj.id
    JOIN journeys tj ON jr.target_journey_id = tj.id
    WHERE c.id = conv_id
      AND jr.status = 'accepted'
      AND (
        jr.requester_id = user_profile_id
        OR rj.user_id = user_profile_id
        OR tj.user_id = user_profile_id
      )
  ) INTO is_part;
  RETURN is_part;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS for conversations table
DROP POLICY IF EXISTS p_select_conversations ON conversations;
CREATE POLICY p_select_conversations ON conversations
FOR SELECT USING (
  is_conversation_participant(id, auth.uid())
);

-- RLS for messages table
DROP POLICY IF EXISTS p_select_messages ON messages;
CREATE POLICY p_select_messages ON messages
FOR SELECT USING (
  is_conversation_participant(conversation_id, auth.uid())
);

DROP POLICY IF EXISTS p_insert_messages ON messages;
CREATE POLICY p_insert_messages ON messages
FOR INSERT WITH CHECK (
  is_conversation_participant(conversation_id, auth.uid())
  AND (sender_id = auth.uid() OR sender_id IS NULL)
);
