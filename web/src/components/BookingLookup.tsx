"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getBooking, listSlots } from "@/lib/api";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { SiteHeader } from "./Chrome";
import { ConfirmationCard } from "./ConfirmationCard";
import { Arrow, Label } from "./ui";

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
    <div className="min-h-screen bg-paper-2">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-14 sm:px-8 sm:py-20">
        <Label className="text-muted">Booking</Label>
        <div className="mt-6">
          {state === "loading" && (
            <p className="font-display text-3xl tracking-tight" role="status">
              Finding your booking…
            </p>
          )}
          {state === "missing" && (
            <div role="alert">
              <h1 className="font-display text-5xl font-medium leading-none tracking-[-0.04em]">
                Booking not <em className="font-serif font-normal">found</em>
              </h1>
              <p className="mt-4 text-lg text-muted">There is no booking with that id. Check the link and try again.</p>
            </div>
          )}
          {state === "error" && (
            <div role="alert">
              <h1 className="font-display text-5xl font-medium leading-none tracking-[-0.04em]">Service unavailable</h1>
              <p className="mt-4 text-lg text-muted">We could not load this booking right now. Please try again in a moment.</p>
            </div>
          )}
          {state === "ok" && booking && (
            <ConfirmationCard
              booking={booking}
              slot={slot}
              onChange={setBooking}
              announce={setMsg}
              onBookAnother={
                <Link
                  href="/#slots"
                  className="inline-flex h-14 items-center justify-center gap-3 rounded-full bg-signal px-7 font-display text-base font-medium text-ink transition-colors duration-300 hover:bg-ink hover:text-on-ink"
                >
                  Book another slot <Arrow />
                </Link>
              }
            />
          )}
          <div aria-live="polite" role="status" className="sr-only">
            {msg}
          </div>
        </div>
        <p className="mt-16">
          <Link href="/" className="font-display text-[15px] font-medium underline decoration-1 underline-offset-[6px]">
            Back to the timetable
          </Link>
        </p>
      </main>
    </div>
  );
}
