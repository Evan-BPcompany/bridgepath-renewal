-- Phase 1 Day 2: Admin sessions table for token management

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
  access_token_hash VARCHAR(255),
  is_revoked BOOLEAN DEFAULT false,
  device_info VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
);

-- Indexes for session management
CREATE INDEX idx_admin_sessions_admin_user_id ON admin_sessions(admin_user_id);
CREATE INDEX idx_admin_sessions_refresh_token_hash ON admin_sessions(refresh_token_hash);
CREATE INDEX idx_admin_sessions_is_revoked ON admin_sessions(is_revoked);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX idx_admin_sessions_last_activity ON admin_sessions(last_activity_at DESC);
