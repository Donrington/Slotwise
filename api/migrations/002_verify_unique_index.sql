-- Level 3 guarantee. Created in 001; recreated here only if missing (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_confirmed_per_slot
  ON bookings (slot_id) WHERE status = 'confirmed';
