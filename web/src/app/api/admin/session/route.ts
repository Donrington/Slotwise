import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, SESSION_SECONDS, adminConfigured, cookieOptions, issueSession, passwordMatches } from "@/lib/adminSession";

export const dynamic = "force-dynamic";

/** Sign in: {password} -> session cookie. A wrong password is slowed down to blunt guessing. */
export async function POST(req: NextRequest) {
  if (!adminConfigured()) return NextResponse.json({ error: "staff access is not configured" }, { status: 503 });
  let password: unknown;
  try {
    password = (await req.json())?.password;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!passwordMatches(password)) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, issueSession(), { ...cookieOptions, maxAge: SESSION_SECONDS });
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
