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
Node 20, TypeScript, Fastify, pg, zod, vitest. Web: Next.js 15 (App Router), TypeScript, Tailwind CSS, GSAP, Lenis, anime.js. DB: Neon Postgres. API host: Render. Web host: Vercel.
