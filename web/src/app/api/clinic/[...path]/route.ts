import { NextRequest, NextResponse } from "next/server";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const UUID = "[0-9a-fA-F-]{1,64}";
const ALLOWED: [string, RegExp][] = [
  ["GET", /^\/slots$/],
  ["POST", /^\/slots\/live$/], // seals a live availability query (Neon Realtime)
  ["GET", /^\/bookings$/],
  ["POST", /^\/bookings$/],
  ["GET", new RegExp(`^/bookings/${UUID}$`)],
  ["DELETE", new RegExp(`^/bookings/${UUID}$`)],
];

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = "/" + path.map(encodeURIComponent).join("/");
  if (!ALLOWED.some(([m, re]) => m === req.method && re.test(sub))) return notFound();

  const env = readEnv();
  if (!env.ok) return NextResponse.json({ error: "booking service unavailable" }, { status: 502 });

  const headers: Record<string, string> = { "X-API-Key": env.apiKey, Accept: "application/json" };
  const ct = req.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;
  const idem = req.headers.get("idempotency-key");
  if (idem) headers["Idempotency-Key"] = idem;

  try {
    const upstream = await fetch(env.baseUrl + sub + req.nextUrl.search, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(65_000), // a sleeping free instance can take about a minute to wake
    });
    const out = new Headers({ "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
    const retry = upstream.headers.get("retry-after");
    if (retry) out.set("Retry-After", retry);
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: out });
  } catch {
    return NextResponse.json({ error: "booking service unavailable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
