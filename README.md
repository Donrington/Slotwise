# Slotwise

Clinic booking REST API (Node 20, Fastify, Postgres) plus a small Next.js page. Final README is written in the last step.

## Deployment

Hosts: Neon (Postgres), Render (API, single instance because the rate limiter is in memory), Vercel (web).

1. **Neon**: create a project and database. Copy the pooled connection string (host contains `-pooler`) with `sslmode=require`.
2. **API key**: `openssl rand -hex 24`. Use a throwaway key for this assessment only.
3. **Render**: New Web Service from this GitHub repo, root directory `api` (or use `render.yaml`). Set env `DATABASE_URL` and `API_KEY`. Keep a single instance.
4. **Vercel**: import the repo, root directory `web`. Set env `API_BASE_URL` (the Render https URL, no trailing slash) and `API_KEY` (same key). Never use `NEXT_PUBLIC_` for these.
5. **Check**: `node scripts/verify.mjs --base <render url> --key <key>`, then again with `--slow`.
6. **Keep warm**: a free uptime monitor hitting `<render url>/healthz` every 5 minutes.
