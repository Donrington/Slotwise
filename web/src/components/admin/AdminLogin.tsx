"use client";
import Link from "next/link";
import { useState } from "react";
import { signIn } from "@/lib/adminApi";
import { Arrow, Button, Label, Notice } from "../ui";

export function AdminLogin({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return setError("Enter the staff password.");
    setBusy(true);
    setError(null);
    const r = await signIn(password);
    setBusy(false);
    if (r.ok) window.location.reload();
    else setError(r.status === 401 ? "That password is not right." : r.error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-4 py-16 text-on-ink">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display text-2xl font-semibold tracking-[-0.04em]">
          Slotwise<span className="text-signal">.</span>
        </Link>
        <Label className="mt-10 block text-on-ink-muted">Clinic staff</Label>
        <h1 className="mt-3 font-display text-5xl font-medium leading-none tracking-[-0.04em]">
          Staff <em className="font-serif font-normal">sign in</em>
        </h1>
        {!configured ? (
          <div className="mt-8">
            <Notice inverse>Staff access is not set up yet. Add an ADMIN_PASSWORD (12+ characters) to the web app&apos;s environment.</Notice>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-10">
            <label htmlFor="admin-password" className="block">
              <Label className="text-on-ink-muted">Password</Label>
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 block w-full border-0 border-b border-on-ink-line bg-transparent px-0 pb-3 font-display text-2xl tracking-tight text-on-ink focus:border-b-2 focus:border-signal focus:outline-none focus:ring-0 focus-visible:outline-none"
            />
            {error && (
              <div className="mt-5" role="alert">
                <Notice inverse>{error}</Notice>
              </div>
            )}
            <Button type="submit" disabled={busy} aria-busy={busy} className="mt-8 h-14 w-full justify-between px-7">
              <span>{busy ? "Signing in…" : "Sign in"}</span>
              <Arrow />
            </Button>
          </form>
        )}
        <p className="mt-10">
          <Link href="/" className="text-sm text-on-ink-muted underline decoration-1 underline-offset-[6px] hover:text-on-ink">
            Back to the patient page
          </Link>
        </p>
      </div>
    </main>
  );
}
