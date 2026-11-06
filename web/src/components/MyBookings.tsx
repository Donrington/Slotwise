"use client";
import { useState } from "react";
import { cancelBooking, listBookings } from "@/lib/api";
import { dayParts, timeParts } from "@/lib/format";
import { isEmail } from "@/lib/validate";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { Arrow, Button, Label, Notice, StatusBadge } from "./ui";

interface Props {
  lastEmail: string;
  onEmail: (e: string) => void;
  slotLookup: (id: string) => SlotWithAvailability | undefined;
  onSlotsChanged: () => void;
  announce: (m: string) => void;
}

export function MyBookings({ lastEmail, onEmail, slotLookup, onSlotsChanged, announce }: Props) {
  const [email, setEmail] = useState(lastEmail);
  const [items, setItems] = useState<Booking[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [queried, setQueried] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const q = email.trim();
    if (!isEmail(q)) {
      setError("Enter the email you booked with.");
      return;
    }
    setError(null);
    setLoading(true);
    const r = await listBookings(q);
    setLoading(false);
    onEmail(q);
    if (!r.ok) {
      setError(r.status === 429 ? "Too many requests. Please wait a moment." : "We could not load your bookings. Please try again.");
      return;
    }
    setItems(r.data.bookings);
    setCursor(r.data.next_cursor);
    setQueried(q);
    announce(`${r.data.bookings.length} bookings found.`);
  }

  async function more() {
    if (!cursor) return;
    setLoading(true);
    const r = await listBookings(queried, cursor);
    setLoading(false);
    if (!r.ok) {
      setError("We could not load more. Please try again.");
      return;
    }
    setItems((cur) => [...(cur ?? []), ...r.data.bookings]);
    setCursor(r.data.next_cursor);
  }

  async function cancel(b: Booking) {
    setBusyId(b.id);
    const r = await cancelBooking(b.id);
    setBusyId(null);
    if (r.ok || r.status === 409) {
      setItems((cur) => cur?.map((x) => (x.id === b.id ? { ...x, status: "cancelled" } : x)) ?? null);
      announce("Booking cancelled.");
      onSlotsChanged();
    } else setError("We could not cancel that booking. Please try again.");
  }

  return (
    <section id="my-bookings" aria-labelledby="mine-title" className="scroll-mt-20 bg-paper-2 px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div data-reveal className="grid gap-6 border-b border-ink pb-6 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <Label className="text-muted">N°04 Your bookings</Label>
            <h2 id="mine-title" className="mt-3 font-display text-[clamp(2.75rem,7vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.04em]">
              My <em className="font-serif font-normal">bookings</em>
            </h2>
          </div>
          <p className="max-w-sm text-muted md:col-span-4">Everything booked with your email, oldest first. Cancelled ones stay on the record.</p>
        </div>

        <form onSubmit={lookup} noValidate className="mt-10 grid gap-6 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <label htmlFor="lookup-email" className="block">
              <Label className="text-muted">Email</Label>
            </label>
            <input
              id="lookup-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 block w-full border-0 border-b border-ink bg-transparent px-0 pb-3 font-display text-[clamp(1.75rem,4vw,3rem)] font-medium tracking-[-0.03em] placeholder:text-muted/50 focus:border-b-2 focus:border-signal focus:outline-none focus:ring-0 focus-visible:outline-none"
            />
          </div>
          <div className="md:col-span-4 md:text-right">
            <Button type="submit" variant="ink" disabled={loading} aria-busy={loading} className="h-14 px-8">
              {loading && !items ? "Looking…" : "Look up"} <Arrow />
            </Button>
          </div>
        </form>

        {error && (
          <div className="mt-6" role="alert">
            <Notice>{error}</Notice>
          </div>
        )}

        {items && items.length === 0 && (
          <p className="mt-12 border-y border-line py-10 text-center font-display text-2xl tracking-tight">
            No bookings for <span className="font-serif italic">{queried}</span>.
          </p>
        )}

        {items && items.length > 0 && (
          <ul className="mt-12 border-b border-ink">
            {items.map((b, i) => {
              const s = slotLookup(b.slot_id);
              const t = s ? timeParts(s.start) : null;
              const d = s ? dayParts(s.start) : null;
              const cancelled = b.status === "cancelled";
              return (
                <li key={b.id} className="grid grid-cols-12 items-center gap-y-3 border-t border-ink py-6">
                  <span className="col-span-2 font-mono text-xs text-muted tabular sm:col-span-1">{String(i + 1).padStart(2, "0")}</span>
                  <span className={`col-span-10 flex items-baseline gap-3 sm:col-span-3 ${cancelled ? "text-muted line-through" : ""}`}>
                    {t && d ? (
                      <>
                        <span className="font-mono text-3xl tracking-[-0.04em] tabular">{t.hm}</span>
                        <span className="font-mono text-xs uppercase">
                          {t.period} {d.weekday} {d.day} {d.month}
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-sm">Slot {b.slot_id}</span>
                    )}
                  </span>
                  <span className="col-span-12 font-display text-xl font-medium tracking-tight sm:col-span-3">{s?.provider ?? "Provider"}</span>
                  <span className="col-span-6 sm:col-span-2">
                    <StatusBadge status={b.status} />
                  </span>
                  <span className="col-span-6 text-right sm:col-span-3">
                    {!cancelled && (
                      <Button variant="link" onClick={() => cancel(b)} disabled={busyId === b.id} className="text-sm">
                        {busyId === b.id ? "Cancelling…" : "Cancel booking"}
                      </Button>
                    )}
                  </span>
                  <code className="col-span-12 break-all font-mono text-[11px] text-muted sm:col-start-2">{b.id}</code>
                </li>
              );
            })}
          </ul>
        )}

        {cursor && (
          <div className="mt-8">
            <Button variant="outline" onClick={more} disabled={loading} className="h-14 w-full">
              {loading ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
