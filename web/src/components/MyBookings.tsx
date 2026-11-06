"use client";
import { useState } from "react";
import { cancelBooking, listBookings } from "@/lib/api";
import { fullWhen } from "@/lib/format";
import { isEmail } from "@/lib/validate";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { Button, Notice, StatusBadge } from "./ui";

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
    <section id="my-bookings" aria-labelledby="mine-title" className="mx-auto max-w-5xl scroll-mt-4 px-4 pb-20 sm:px-6">
      <div data-reveal>
        <h2 id="mine-title" className="font-display text-3xl text-ink sm:text-4xl">
          My bookings
        </h2>
        <p className="mt-1 text-muted">Look up everything booked with your email, including cancelled ones.</p>
      </div>

      <form onSubmit={lookup} noValidate className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="lookup-email" className="block text-sm font-semibold text-ink">
            Email
          </label>
          <input
            id="lookup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base"
          />
        </div>
        <Button type="submit" disabled={loading} aria-busy={loading}>
          {loading && !items ? "Looking…" : "Look up"}
        </Button>
      </form>

      {error && (
        <div className="mt-4" role="alert">
          <Notice>{error}</Notice>
        </div>
      )}

      {items && items.length === 0 && (
        <p className="mt-6 rounded-2xl bg-surface p-6 text-center text-muted ring-1 ring-line">No bookings found for {queried}.</p>
      )}

      {items && items.length > 0 && (
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {items.map((b) => {
            const s = slotLookup(b.slot_id);
            return (
              <li key={b.id} className="rounded-2xl bg-surface p-5 ring-1 ring-line">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{s ? s.provider : `Slot ${b.slot_id}`}</p>
                    <p className="text-muted">{s ? fullWhen(s.start, s.end) : "Time unavailable"}</p>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
                <p className="mt-3 break-all text-xs text-muted">{b.id}</p>
                {b.status === "confirmed" && (
                  <Button variant="danger" className="mt-4 min-h-10 py-1.5 text-sm" onClick={() => cancel(b)} disabled={busyId === b.id}>
                    {busyId === b.id ? "Cancelling…" : "Cancel booking"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cursor && (
        <div className="mt-6">
          <Button variant="secondary" onClick={more} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </section>
  );
}
