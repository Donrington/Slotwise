"use client";
import { useEffect, useRef, useState } from "react";
import { cancelBooking } from "@/lib/api";
import { fullWhen } from "@/lib/format";
import { loadAnime, prefersReducedMotion } from "@/lib/motion";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { Button, Notice, StatusBadge } from "./ui";

function Check({ animate: shouldAnimate }: { animate: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const circle = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (!shouldAnimate || prefersReducedMotion() || !path.current || !circle.current) return;
    let dead = false;
    loadAnime().then(({ animate, svg }) => {
      if (dead || !path.current || !circle.current) return;
      animate(svg.createDrawable(circle.current), { draw: ["0 0", "0 1"], duration: 450, ease: "outQuad" });
      animate(svg.createDrawable(path.current), { draw: ["0 0", "0 1"], duration: 350, delay: 250, ease: "outQuad" });
    });
    return () => {
      dead = true;
    };
  }, [shouldAnimate]);
  return (
    <svg viewBox="0 0 52 52" className="h-16 w-16 text-ok" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle ref={circle} cx="26" cy="26" r="23" />
      <path ref={path} d="M15 27l8 8 14-16" />
    </svg>
  );
}

interface Props {
  booking: Booking;
  slot?: SlotWithAvailability;
  onChange: (b: Booking) => void;
  onBookAnother: React.ReactNode | (() => void);
  fresh?: boolean;
  announce?: (m: string) => void;
}

export function ConfirmationCard({ booking, slot, onChange, onBookAnother, fresh = false, announce }: Props) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelled = booking.status === "cancelled";

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
    <div className="text-center sm:text-left">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
        {cancelled ? (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-bg text-3xl text-danger" aria-hidden="true">
            ×
          </span>
        ) : (
          <Check animate={fresh} />
        )}
        <div>
          <h2 className="font-display text-3xl text-ink">{cancelled ? "Booking cancelled" : "You are booked"}</h2>
          <div className="mt-2">
            <StatusBadge status={booking.status} />
          </div>
        </div>
      </div>

      <dl className="mt-6 grid gap-3 rounded-2xl bg-brand-50 p-5 text-left text-sm sm:text-base">
        {slot && (
          <>
            <Row k="Provider" v={slot.provider} />
            <Row k="When" v={fullWhen(slot.start, slot.end)} />
          </>
        )}
        <Row k="Name" v={booking.name} />
        <Row k="Email" v={booking.email} />
        <div>
          <dt className="text-muted">Booking id</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface px-2 py-1 text-sm">{booking.id}</code>
            <Button variant="ghost" className="min-h-9 px-3 py-1 text-sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </dd>
        </div>
      </dl>

      {note && (
        <div className="mt-4" role="status">
          <Notice tone="info">{note}</Notice>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {!cancelled && (
          <Button variant="danger" onClick={cancel} disabled={busy} aria-busy={busy}>
            {busy ? "Cancelling…" : "Cancel this booking"}
          </Button>
        )}
        {typeof onBookAnother === "function" ? (
          <Button onClick={onBookAnother}>Book another slot</Button>
        ) : (
          onBookAnother
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="font-semibold text-ink">{v}</dd>
    </div>
  );
}
