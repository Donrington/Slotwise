# Slotwise

A clinic booking REST API and the web page that uses it. Patients see open appointments, book one, get a
confirmation, cancel it and look up their bookings. Clinic staff open new slots and manage bookings from a
signed-in console. The API follows the Koya assessment contract exactly (all five levels): API key auth,
validation, no double booking under concurrency, cancellation, idempotent retries, cursor pagination and a
per-email rate limit.

| | URL |
|---|---|
| API base URL | https://slotwise-api-murex.vercel.app |
| Web page | https://slotwise-one-delta.vercel.app |
| Staff console | https://slotwise-one-delta.vercel.app/admin |

Every API request needs the `X-API-Key` header except `GET /healthz`. The key is not in this repository.

**Stack:** Node 22, TypeScript, Fastify, `pg`, zod, vitest (API); Next.js 15, Tailwind CSS, GSAP, Lenis,
anime.js (web); Neon Postgres with Neon Realtime; both apps on Vercel.

## Run it locally

You need Node 20 or newer and a Postgres database (a local one, or a Neon branch).

```bash
git clone https://github.com/Donrington/Slotwise && cd Slotwise
```

**API** (variables in `api/.env.example`):

```bash
cd api && npm ci
export DATABASE_URL=postgres://user:pass@localhost/slotwise   # tables are created on start
export API_KEY=any-string-of-16-or-more-characters
PORT=3111 npm run dev
```

**Web** (variables in `web/.env.example`), in a second terminal:

```bash
cd web && npm ci
export API_BASE_URL=http://localhost:3111 API_KEY=same-key-as-above
export ADMIN_PASSWORD=a-staff-password-of-12-plus-characters   # optional, enables /admin
npm run dev        # http://localhost:3000
```

**Slots and checks**, with the API running:

```bash
node scripts/seed-demo.mjs --base http://localhost:3111 --key same-key-as-above   # 24 demo slots
node scripts/verify.mjs   --base http://localhost:3111 --key same-key-as-above   # the contract, 59 checks
node scripts/verify.mjs   --base http://localhost:3111 --key same-key-as-above --slow   # + rate-limit recovery, 23-booking walk (~5 min)
```

Both scripts call `POST /reset`, which deletes every booking. Staff can also open slots from `/admin`.

**Tests:** `cd api && TEST_DATABASE_URL=postgres://... npm test` (107 tests; integration tests run against a
real Postgres and skip if the variable is unset). Web: `npm run lint`, `npm run build`, and a Playwright smoke
test with `WEB_URL=... API_BASE_URL=... API_KEY=... npm run test:e2e`.

## The five levels

**Level 1, slots and bookings.** `POST /reset` replaces slots in one transaction; `GET /slots` computes
`available` with a `NOT EXISTS` subquery. Slots keep the original `start`/`end` strings (`start_raw`,
`end_raw`) next to parsed timestamps, so they come back exactly as sent.
Look at `api/src/services/slots.ts`, `api/src/services/bookings.ts`, `api/migrations/001_init.sql`.

**Level 2, auth and validation.** An `onRequest` hook checks `X-API-Key` before routing, so unknown paths get
401 too; both sides are hashed with SHA-256 and compared with `timingSafeEqual`. Bodies are validated with zod
(trimmed, email lower-cased), then the slot lookup (404), then the started check (400).
Look at `api/src/lib/auth.ts`, `api/src/lib/validate.ts`, `api/src/buildApp.ts`.

**Level 3, no double booking.** A partial unique index, `bookings(slot_id) WHERE status = 'confirmed'`, makes a
second confirmed booking impossible. The insert runs with no availability pre-check; the unique violation
(23505) becomes 409, so 30 simultaneous requests give exactly one 201. Cancel is a conditional
`UPDATE … WHERE status = 'confirmed'`, which frees the index slot at once.
Look at `api/migrations/001_init.sql` and `createBookingIdempotent` / `cancelBooking` in `bookings.ts`.

**Level 4, idempotency and pagination.** Requests with an `Idempotency-Key` take
`pg_advisory_xact_lock(hashtextextended(key))`, look up a stored response, and otherwise book and store the
final response in the same transaction (a savepoint keeps a 409 from aborting it). Same key and same
normalised body (SHA-256) replays the stored status and body byte for byte (stored as `json`, not `jsonb`);
a different body is 422. Pagination uses a seq-based cursor: `WHERE email = $1 AND seq > $cursor ORDER BY seq
LIMIT n+1`. Cursors are HMAC-signed and bound to the email, so an edited cursor is 400.
Look at `bookings.ts`, `api/src/lib/cursor.ts`, `api/migrations/003_idempotency.sql`.

**Level 5, rate limit.** A sliding-window log of attempts per email, kept in Postgres
(`rate_limit_attempts`). Each check takes a per-email advisory lock, prunes entries older than 60 s, counts,
and records the attempt, using the database clock. The sixth attempt gets 429 with `Retry-After` from the
oldest attempt in the window. A blocked attempt is not recorded, so the client recovers on schedule.
Look at `PgRateLimiter` in `api/src/lib/rateLimiter.ts` and `api/migrations/006_rate_limit.sql`.

## Decisions and trade-offs

- **Order of checks on `POST /bookings`:** key, idempotent replay, rate limit, then (in one transaction)
  same-key-different-body 422, validation, slot lookup, started check, insert. The replay is checked again
  under the per-key lock, so ten simultaneous requests with one key count as one attempt and all get the same
  booking.
- **Replays are not counted** as attempts. Failed attempts are (400, 404, 409, 422). A 429 is never stored.
- **Idempotency stores every final response except 429 and 5xx**, so those can be retried successfully.
- **`POST /reset` also clears idempotency keys and rate-limit counters**, so a checker can reset between tests.
- **`GET /bookings` returns confirmed and cancelled bookings**, oldest first by `seq`, so history never vanishes.
- **The rate limiter lives in Postgres, not memory.** The plan was one Render instance with an in-memory
  limiter. The API runs on Vercel, which runs many instances, and an in-memory count would allow 5 attempts per
  instance. A test runs two app instances against one database and lets exactly 5 of 24 through. At much higher
  traffic I would move this counter to Redis behind the same `RateLimiter` interface.
- **The Next.js proxy keeps the API key on the server.** The browser calls `/api/clinic/*`, which allowlists
  the patient routes and adds the key. It cannot reach `/reset` or `/admin`.
- **`/healthz` needs no key**, for health checks and uptime pings. It runs `SELECT 1`.
- **Neon wiring:** app traffic on the pooled URL, migrations on the direct URL (at build time on Vercel).
  Statement timeouts are set on the database role, because Neon's pooler can refuse them as startup parameters.
- **Live availability:** the page subscribes to a sealed, read-only Neon Realtime query over slots (no names or
  emails), and falls back to polling `GET /slots` every 20 s if Realtime is unavailable.

**Additions beyond the brief** (none change the checked endpoints): the staff console and its `/admin/*` API
routes (add slots without a reset, remove open slots, list bookings with who holds each slot), live
availability, and a booking page by URL at `/booking/{id}`.

## Known limits

- **One shared API key** for all clients, with no per-client keys or scopes. The staff console is one
  shared password, not individual accounts.
- **Cold starts:** a Vercel function or a suspended Neon compute can add a few hundred milliseconds to the
  first request after idle. The live verify run saw no request over 3 s.
- **Idempotency keys never expire**; only `/reset` clears them. A real deployment would add a TTL.
- **Neon Realtime is in beta.** If it fails, the page polls, so booking still works.
- **No licence file:** the code is shared for assessment only; all rights are reserved by default. The
  typefaces (Clash Grotesk, Zodiak, Satoshi) are from Fontshare under the ITF Free Font License.

## Project layout

```
api/            Fastify API: src/index.ts (entry), src/buildApp.ts (routes), src/services, src/lib, migrations, test
web/            Next.js app: src/app (pages, proxies), src/components, src/lib, e2e
scripts/        verify.mjs (contract check), seed-demo.mjs (demo timetable)
neon.ts         Neon project config (Postgres, Realtime origins)
```

## How AI was used

Claude Code built this from a written prompt pack, one prompt per level, then the web page, the verification
script and the deployment. I reviewed the code and the decisions, ran `scripts/verify.mjs` against the local
and the live API (59/59, and 62/62 with `--slow`), and tested the live site by booking, cancelling and using
the staff console. Several fixes came out of that testing, for example simultaneous same-key requests each
consuming a rate-limit attempt, and the limiter moving to Postgres once the API ran on several instances.
