"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getBooking, listSlots } from "@/lib/api";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { ConfirmationCard } from "./ConfirmationCard";

export function BookingLookup({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | "missing" | "error" | "ok">("loading");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [slot, setSlot] = useState<SlotWithAvailability>();
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await getBooking(id);
      if (dead) return;
      if (!r.ok) return setState(r.status === 404 ? "missing" : "error");
      setBooking(r.data);
      setState("ok");
      const s = await listSlots();
      if (!dead && s.ok) setSlot(s.data.slots.find((x) => x.id === r.data.slot_id));
    })();
    return () => {
      dead = true;
    };
  }, [id]);

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-16 sm:px-6">
      <Link href="/" className="text-sm font-semibold text-brand-700 underline underline-offset-4">
        ← Back to Slotwise
      </Link>
      <div className="mt-8">
        {state === "loading" && <p className="text-muted" role="status">Loading your booking…</p>}
        {state === "missing" && (
          <div role="alert">
            <h1 className="font-display text-3xl text-ink">Booking not found</h1>
            <p className="mt-2 text-muted">We could not find a booking with that id. Check the link and try again.</p>
          </div>
        )}
        {state === "error" && (
          <div role="alert">
            <h1 className="font-display text-3xl text-ink">Service unavailable</h1>
            <p className="mt-2 text-muted">We could not load this booking right now. Please try again in a moment.</p>
          </div>
        )}
        {state === "ok" && booking && (
          <ConfirmationCard
            booking={booking}
            slot={slot}
            onChange={setBooking}
            announce={setMsg}
            onBookAnother={
              <Link href="/#slots" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-700">
                Book another slot
              </Link>
            }
          />
        )}
        <div aria-live="polite" role="status" className="sr-only">{msg}</div>
      </div>
    </main>
  );
}
