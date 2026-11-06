import { BookingApp } from "@/components/BookingApp";
import { EnvError } from "@/components/EnvError";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const env = readEnv();
  if (!env.ok) return <EnvError missing={env.missing} />;
  return <BookingApp />;
}
