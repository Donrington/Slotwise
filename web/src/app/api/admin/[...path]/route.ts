import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, sessionValid } from "@/lib/adminSession";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Staff proxy. Requires a valid staff session; adds the API key server-side. Mutations also need the
// x-slotwise-admin header, which a cross-site form or image cannot send (CSRF, alongside SameSite=Strict).
const ID = "[A-Za-z0-9._:~-]{1,128}";
const ROUTES: [string, RegExp, (m: RegExpMatchArray) => string][] = [
  ["GET", /^\/overview$/, () => "/admin/overview"],
  ["GET", /^\/slots$/, () => "/admin/slots"],
  ["POST", /^\/slots$/, () => "/admin/slots"],
  ["DELETE", new RegExp(`^/slots/(${ID})$`), (m) => `/admin/slots/${encodeURIComponent(m[1]!)}`],
  ["GET", /^\/bookings$/, () => "/admin/bookings"],
  ["DELETE", new RegExp(`^/bookings/(${ID})$`), (m) => `/bookings/${encodeURIComponent(m[1]!)}`], // cancel
  ["POST", /^\/reset$/, () => "/reset"],
];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sessionValid(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "staff sign-in required" }, { status: 401 });
  }
  if (req.method !== "GET" && req.headers.get("x-slotwise-admin") !== "1") {
    return NextResponse.json({ error: "missing staff request header" }, { status: 403 });
  }
  const { path } = await ctx.params;
  const sub = "/" + path.map((p) => decodeURIComponent(p)).join("/");
  let target: string | undefined;
  for (const [method, re, to] of ROUTES) {
    const m = sub.match(re);
    if (m && method === req.method) target = to(m);
  }
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  const env = readEnv();
  if (!env.ok) return NextResponse.json({ error: "booking service unavailable" }, { status: 502 });
  try {
    const upstream = await fetch(env.baseUrl + target + req.nextUrl.search, {
      method: req.method,
      headers: { "X-API-Key": env.apiKey, Accept: "application/json", ...(req.method === "POST" ? { "Content-Type": "application/json" } : {}) },
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(65_000),
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "booking service unavailable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
