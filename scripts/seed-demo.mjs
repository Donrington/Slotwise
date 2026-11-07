#!/usr/bin/env node
// Loads the demo timetable reviewers will see: 24 slots, 2 providers, 30-minute steps, starting
// 14 days from today (09:00 UTC), 12 per day over two days. Dependency-free, Node 20+.
//
//   node scripts/seed-demo.mjs --base https://slotwise-api-murex.vercel.app --key YOUR_API_KEY
//
// WARNING: POST /reset deletes every booking. Run this once, as the very LAST call before you submit.

const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
const BASE = (opt("base") ?? process.env.BASE_URL ?? "").replace(/\/+$/, "");
const KEY = opt("key") ?? process.env.API_KEY ?? "";
if (!BASE || !KEY) {
  console.error("Usage: node scripts/seed-demo.mjs --base <url> --key <api key>");
  process.exit(2);
}

const iso = (d) => d.toISOString().replace(".000Z", "Z");
const first = new Date();
first.setUTCDate(first.getUTCDate() + 14);
first.setUTCHours(9, 0, 0, 0);

const providers = ["Dr Ade Okafor", "Dr Bisi Adeyemi"];
const slots = Array.from({ length: 24 }, (_, i) => {
  const day = Math.floor(i / 12);
  const step = i % 12; // 09:00 to 14:30 in 30-minute steps
  const start = new Date(first.getTime() + day * 86_400_000 + step * 1_800_000);
  return {
    id: `demo-${String(i + 1).padStart(2, "0")}`,
    provider: providers[i % 2],
    start: iso(start),
    end: iso(new Date(start.getTime() + 1_800_000)),
  };
});

const res = await fetch(`${BASE}/reset`, {
  method: "POST",
  headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ slots }),
  signal: AbortSignal.timeout(60_000),
});
const body = await res.text();
if (!res.ok) {
  console.error(`reset failed: HTTP ${res.status} ${body}`);
  process.exit(1);
}
console.log(`reset ok: ${body}`);
console.log(`first slot ${slots[0].start}, last slot ${slots[23].end}`);
const check = await fetch(`${BASE}/slots`, { headers: { "X-API-Key": KEY } });
const listed = (await check.json()).slots ?? [];
console.log(`GET /slots now lists ${listed.length} slots, ${listed.filter((s) => s.available).length} available`);
