import { BookingLookup } from "@/components/BookingLookup";
import { EnvError } from "@/components/EnvError";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const env = readEnv();
  if (!env.ok) return <EnvError missing={env.missing} />;
  const { id } = await params;
  return <BookingLookup id={id} />;
}
