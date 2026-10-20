CREATE TABLE IF NOT EXISTS studio_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile TEXT NOT NULL UNIQUE CHECK (profile IN ('podo','personal')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision INTEGER NOT NULL DEFAULT 0,
  login_failures INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES studio_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_sessions_expires_at_idx ON studio_sessions(expires_at);
