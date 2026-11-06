"use client";
import { useEffect, useRef, useState } from "react";
import { cancelBooking } from "@/lib/api";
import { dayLabel, timeParts, timeRange } from "@/lib/format";
import { loadAnime, prefersReducedMotion } from "@/lib/motion";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { Arrow, Button, Label, Notice } from "./ui";

interface Props {
  booking: Booking;
  slot?: SlotWithAvailability;
  onChange: (b: Booking) => void;
  onBookAnother: React.ReactNode | (() => void);
  fresh?: boolean;
  announce?: (m: string) => void;
  /** true inside the ink drawer, false on a paper page */
  inverse?: boolean;
}

/** The confirmation is a ticket: stub, perforation, and a stamp that lands when it is fresh. */
export function ConfirmationCard({ booking, slot, onChange, onBookAnother, fresh = false, announce, inverse = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const stamp = useRef<HTMLSpanElement>(null);
  const check = useRef<SVGPathElement>(null);
  const cancelled = booking.status === "cancelled";
  const t = slot ? timeParts(slot.start) : null;

  useEffect(() => {
    if (!fresh || prefersReducedMotion()) return;
    let dead = false;
    loadAnime().then(({ animate, svg }) => {
      if (dead) return;
      if (check.current) animate(svg.createDrawable(check.current), { draw: ["0 0", "0 1"], duration: 420, delay: 120, ease: "outQuad" });
      if (stamp.current)
        animate(stamp.current, { scale: [1.9, 1], opacity: [0, 1], rotate: [-22, -8], duration: 520, delay: 260, ease: "outBack(1.6)" });
    });
    return () => {
      dead = true;
    };
  }, [fresh]);

  async function cancel() {
    setBusy(true);
    setNote(null);
    const r = await cancelBooking(booking.id);
    setBusy(false);
    if (r.ok) {
      onChange(r.data);
      announce?.("Booking cancelled. The slot is open again.");
    } else if (r.status === 409) {
      onChange({ ...booking, status: "cancelled" });
      setNote("This booking was already cancelled.");
    } else if (r.status === 404) {
      setNote("We could not find this booking any more.");
    } else {
      setNote("We could not cancel right now. Please try again in a moment.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(booking.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNote("Copy is not available here. Select the id and copy it manually.");
    }
  }

  return (
    <div>
      <h2 className={`font-display text-4xl font-medium leading-none tracking-[-0.035em] sm:text-5xl ${inverse ? "text-on-ink" : "text-ink"}`}>
        {cancelled ? (
          <>
            Booking <em className="font-serif font-normal">cancelled</em>
          </>
        ) : (
          <>
            You are <em className="font-serif font-normal">booked</em>
          </>
        )}
      </h2>

      <article
        className="relative mt-8 overflow-hidden rounded-[28px] bg-paper text-ink"
        style={{ ["--ticket-bg" as string]: inverse ? "var(--color-ink)" : "var(--color-paper-2)" }}
        aria-label="Booking ticket"
      >
        <div className="relative p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <Label className="text-muted">Slotwise · Admit one</Label>
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              {cancelled ? <path d="M6 6l12 12M18 6L6 18" /> : <path ref={check} d="M4 12.5l5 5L20 6.5" strokeLinecap="square" />}
            </svg>
          </div>

          {slot && t ? (
            <div className="mt-6">
              <p className={`flex items-baseline gap-2 ${cancelled ? "text-muted line-through decoration-2" : ""}`}>
                <span className="font-mono text-6xl leading-none tracking-[-0.05em] tabular sm:text-7xl">{t.hm}</span>
                {t.period && <span className="font-mono text-sm uppercase">{t.period}</span>}
              </p>
              <p className="mt-3 font-display text-2xl font-medium tracking-tight">{slot.provider}</p>
              <p className="text-muted">
                {dayLabel(slot.start)}, {timeRange(slot.start, slot.end)}
              </p>
            </div>
          ) : (
            <p className="mt-6 font-mono text-sm text-muted">Slot {booking.slot_id}</p>
          )}

          <span
            ref={stamp}
            className={`mt-6 inline-block -rotate-[8deg] rounded-md px-3 py-1.5 font-display text-xl font-semibold uppercase tracking-[0.06em] sm:absolute sm:right-7 sm:top-[5.25rem] sm:mt-0 ${
              cancelled ? "text-muted ring-2 ring-inset ring-line-strong line-through" : "bg-signal text-ink"
            }`}
          >
            {cancelled ? "Cancelled" : "Confirmed"}
          </span>
        </div>

        <div className="perforation" aria-hidden="true" />

        <dl className="grid gap-4 p-6 text-sm sm:grid-cols-2 sm:p-7">
          <div>
            <dt>
              <Label className="text-muted">Name</Label>
            </dt>
            <dd className="mt-1 font-medium">{booking.name}</dd>
          </div>
          <div>
            <dt>
              <Label className="text-muted">Email</Label>
            </dt>
            <dd className="mt-1 break-all font-medium">{booking.email}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt>
              <Label className="text-muted">Booking id</Label>
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3">
              <code className="break-all font-mono text-[13px]">{booking.id}</code>
              <Button variant="link" className="min-h-8 text-sm" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </dd>
          </div>
        </dl>
      </article>

      {note && (
        <div className="mt-5" role="status">
          <Notice tone="info" inverse={inverse}>
            {note}
          </Notice>
        </div>
      )}

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        {typeof onBookAnother === "function" ? (
          <Button onClick={onBookAnother} className="h-14 px-7">
            Book another slot <Arrow />
          </Button>
        ) : (
          onBookAnother
        )}
        {!cancelled && (
          <Button variant={inverse ? "link-inverse" : "link"} onClick={cancel} disabled={busy} aria-busy={busy} className="sm:ml-4">
            {busy ? "Cancelling…" : "Cancel this booking"}
          </Button>
        )}
      </div>
    </div>
  );
}
