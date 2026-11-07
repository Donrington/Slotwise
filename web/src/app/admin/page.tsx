import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdminApp } from "@/components/admin/AdminApp";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { EnvError } from "@/components/EnvError";
import { ADMIN_COOKIE, adminConfigured, sessionValid } from "@/lib/adminSession";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clinic console · Slotwise", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const env = readEnv();
  if (!env.ok) return <EnvError missing={env.missing} />;
  const signedIn = sessionValid((await cookies()).get(ADMIN_COOKIE)?.value);
  return signedIn ? <AdminApp /> : <AdminLogin configured={adminConfigured()} />;
}
