CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY,
  request_hash  text NOT NULL,
  status_code   int NOT NULL,
  response_body jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
