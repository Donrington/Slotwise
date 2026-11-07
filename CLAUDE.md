# Slotwise: clinic booking API

## Contract (do not deviate)
Every request needs header X-API-Key (except GET /healthz). Missing or wrong key gives 401. Every error body is {"error": "<message>"}. All bodies are JSON.

Slot: {id, provider, start, end}. start and end are ISO date-times returned exactly as stored from /reset.
Slot in list: Slot plus available (boolean, false while a confirmed booking holds it).
Booking: {id, slot_id, name, email, status (confirmed or cancelled), created_at (ISO)}.

POST /reset body {slots:[Slot...]}: delete every booking, replace all slots (past slots allowed), also clear idempotency records and rate-limit counters. 200.
GET /slots[?provider=exact]: {slots:[...]} earliest start first. 200.
POST /bookings body {slot_id, name, email}: 201 booking, status confirmed.
  400 if slot_id, name or email missing or empty, email invalid, or the slot already started. 404 if the slot does not exist.
  Trim name and email; store email lower case.
  409 if the slot already has a confirmed booking, even when requests arrive at the same instant.
  Optional Idempotency-Key header: same key and same body returns the same status and same booking id, never a second booking; same key and different body gives 422.
  Max 5 attempts per email per minute, failed attempts included; the 6th gives 429 with a Retry-After header (whole seconds). Other emails are unaffected.
GET /bookings/{id}: 200 booking, 404 if unknown.
DELETE /bookings/{id}: sets status cancelled and frees the slot. 200 with the booking. 404 unknown, 409 already cancelled.
GET /bookings?email=&limit=&cursor=: that person's bookings, oldest first, email match case-insensitive. limit 1 to 50, default 10, anything else 400. Cursor pagination: response {bookings:[...], next_cursor}; pass next_cursor back as cursor; last page has next_cursor null.

## Engineering rules
- Postgres is the source of truth. Concurrency safety comes from database constraints and transactions, never from in-process checks alone.
- Validate all input with zod; return the {"error"} shape for every failure, including unknown routes (404) and bad JSON (400).
- Return 401 before anything else, including for unknown routes.
- Keep handlers thin; put logic in src/services and pure helpers in src/lib so they are unit-testable.
- Never log or return the API key. Compare keys in constant time.
- After each change run: npm run build && npm test in /api. Commit small, with conventional messages.

## Stack
Node 20, TypeScript, Fastify, pg, zod, vitest. Web: Next.js 15 (App Router), TypeScript, Tailwind CSS, GSAP, Lenis, anime.js. DB: Neon Postgres. API host: Vercel (Fastify, src/index.ts entry; render.yaml kept as a single-instance alternative). Web host: Vercel.

## Order of checks on POST /bookings
1. API key (401).
2. Idempotent replay: Idempotency-Key present and a stored row with the same body hash returns the stored response. A replay is not counted as an attempt. This is checked once before the lock and again under the per-key advisory lock, so ten simultaneous requests with one key count as ONE attempt and all return the same booking.
3. Rate limit by normalised email (429, Retry-After), taken under the idempotency lock once the request is known not to be a replay. Every real attempt carrying an email counts, failures included (a same-key different-body request, which ends in 422, counts too). A 429 is never stored.
4. Then, in the same transaction: different body under an existing key is 422, validation (400), slot lookup (404), started check (400), insert (409 on the partial unique index).

## Decisions where the spec is silent
- POST /reset clears idempotency keys and rate-limit counters, so the checker can reset between tests.
- Idempotency stores every final response except 429 and 5xx.
- GET /bookings returns confirmed and cancelled bookings, oldest first (by seq).
- start and end are returned exactly as sent to /reset (start_raw, end_raw).
- /healthz is the only route without an API key.
- Pagination cursors are base64url("<seq>.<hmac>"), HMAC over email and seq with a secret derived from API_KEY. An edited cursor or one from another email's listing is 400.
- Idempotent responses are stored as json (not jsonb) so a replay is byte-for-byte the original text.
- The rate limiter lives in Postgres (rate_limit_attempts, per-email advisory lock, database clock) because Vercel runs the API as many instances; an in-memory count would allow 5 per instance. SlidingWindowLimiter (in memory) remains for unit tests only. Both sit behind the RateLimiter interface.
- On Vercel, migrations run at build time (npm run vercel-build, direct DATABASE_URL_UNPOOLED); the server skips them at runtime when VERCEL is set.
