-- jsonb reorders object keys, so a replayed body was the same JSON but not the same text.
-- json keeps the stored text exactly, so a replay is byte-for-byte identical to the original.
ALTER TABLE idempotency_keys ALTER COLUMN response_body TYPE json USING response_body::json;
