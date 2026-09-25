-- GoTogether Carpool Product - Migration 04: Notifications Schema

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL, -- 'request_received', 'request_accepted', 'request_declined', 'chat_message'
  reference_id text,  -- join_request_id or conversation_id
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at, created_at DESC);
