CREATE TABLE slots (
  id         text PRIMARY KEY,
  provider   text NOT NULL,
  start_raw  text NOT NULL,
  end_raw    text NOT NULL,
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL
);
CREATE INDEX slots_start_idx ON slots (start_at, id);
CREATE INDEX slots_provider_idx ON slots (provider);

CREATE TABLE bookings (
  seq        bigserial UNIQUE,
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id    text NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text NOT NULL,
  status     text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Makes double booking impossible: at most one confirmed booking per slot.
CREATE UNIQUE INDEX bookings_one_confirmed_per_slot ON bookings (slot_id) WHERE status = 'confirmed';
CREATE INDEX bookings_email_seq_idx ON bookings (email, seq);
