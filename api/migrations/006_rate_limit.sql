-- Per-email booking attempts for the sliding-window rate limit. In Postgres (not process memory)
-- so the limit holds across every serverless instance. Rows older than the window are pruned on use.
CREATE TABLE rate_limit_attempts (
  email text NOT NULL,
  at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX rate_limit_attempts_email_at ON rate_limit_attempts (email, at);
