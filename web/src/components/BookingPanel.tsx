"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBooking } from "@/lib/api";
import { fullWhen } from "@/lib/format";
import { isEmail } from "@/lib/validate";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { ConfirmationCard } from "./ConfirmationCard";
import { Button, Notice } from "./ui";

interface Props {
  slot: SlotWithAvailability;
  confirmed: Booking | null;
  lastEmail: string;
  onEmail: (e: string) => void;
  onBooked: (b: Booking) => void;
  onBookingChange: (b: Booking) => void;
  onClose: () => void;
  onRefresh: () => void;
  announce: (m: string) => void;
  returnFocus: HTMLElement | null;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

export function BookingPanel({ slot, confirmed, lastEmail, onEmail, onBooked, onBookingChange, onClose, onRefresh, announce, returnFocus }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(lastEmail);
  const [touched, setTouched] = useState({ name: false, email: false });
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // One idempotency key per unchanged form; replaced after any final response or when the form changes.
  const keyRef = useRef<{ key: string; sig: string } | null>(null);

  const close = useCallback(() => {
    onClose();
    requestAnimationFrame(() => {
      // The trigger card may have become a non-focusable Booked card; fall back to the section heading.
      const target = returnFocus?.isConnected ? returnFocus : document.getElementById("slots-title");
      target?.focus();
    });
  }, [onClose, returnFocus]);

  // Focus trap, Escape to close, focus return.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("#name") ?? el.querySelector<HTMLElement>("button:not([aria-label])") ?? el;
    first.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (f.length === 0) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [close, confirmed]);

  // Rate-limit countdown.
  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= retryUntil) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [retryUntil]);
  const secondsLeft = Math.max(0, Math.ceil((retryUntil - now) / 1000));

  const nameErr = touched.name && name.trim() === "" ? "Enter your name." : null;
  const emailErr = touched.email && !isEmail(email.trim()) ? "Enter a valid email, like you@example.com." : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true });
    setFormError(null);
    if (name.trim() === "" || !isEmail(email.trim()) || pending || secondsLeft > 0) return;
    const sig = `${slot.id}|${name}|${email}`;
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { key: crypto.randomUUID(), sig };
    setPending(true);
    const r = await createBooking({ slot_id: slot.id, name, email }, keyRef.current.key);
    setPending(false);
    onEmail(email.trim());

    if (r.ok) {
      keyRef.current = null;
      announce(`Booked. Your booking id is ${r.data.id}.`);
      onBooked(r.data);
      onRefresh();
      return;
    }
    // Network errors and 5xx keep the same key so a retry can never double book. Final answers reset it.
    if (r.status >= 400 && r.status < 500 && r.status !== 429) keyRef.current = null;

    let msg: string;
    if (r.status === 400) msg = r.error;
    else if (r.status === 404) {
      msg = "That slot no longer exists. The schedule has been refreshed.";
      onRefresh();
    } else if (r.status === 409) {
      msg = "Someone just took this slot. Pick another time from the schedule.";
      onRefresh();
    } else if (r.status === 429) {
      const wait = r.retryAfter ?? 30;
      setRetryUntil(Date.now() + wait * 1000);
      setNow(Date.now());
      msg = "Too many attempts for this email. Please wait before trying again.";
    } else msg = "The booking service is not available right now. Please try again in a moment.";
    setFormError(msg);
    announce(msg);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end" role="presentation">
      <div className="absolute inset-0 bg-ink/50" onClick={close} aria-hidden="true" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        tabIndex={-1}
        data-lenis-prevent
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-6 shadow-2xl md:max-h-none md:w-[28rem] md:rounded-none md:p-8"
      >
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-muted hover:bg-brand-50">
          ×
        </button>

        {confirmed ? (
          <ConfirmationCard
            booking={confirmed}
            slot={slot}
            fresh
            announce={announce}
            onChange={(b) => {
              onBookingChange(b);
              onRefresh();
            }}
            onBookAnother={close}
          />
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id="panel-title" className="font-display text-2xl text-ink">
              Book this slot
            </h2>
            <div className="mt-4 rounded-2xl bg-brand-50 p-4">
              <p className="font-semibold text-ink">{slot.provider}</p>
              <p className="text-muted">{fullWhen(slot.start, slot.end)}</p>
            </div>

            <div className="mt-5">
              <label htmlFor="name" className="block text-sm font-semibold text-ink">
                Full name
              </label>
              <input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                aria-invalid={!!nameErr}
                aria-describedby={nameErr ? "name-err" : undefined}
                className="mt-1 min-h-11 w-full rounded-xl border border-line px-3 text-base"
              />
              {nameErr && (
                <p id="name-err" className="mt-1 text-sm text-danger">
                  {nameErr}
                </p>
              )}
            </div>

            <div className="mt-4">
              <label htmlFor="email" className="block text-sm font-semibold text-ink">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                aria-invalid={!!emailErr}
                aria-describedby={emailErr ? "email-err" : undefined}
                className="mt-1 min-h-11 w-full rounded-xl border border-line px-3 text-base"
              />
              {emailErr && (
                <p id="email-err" className="mt-1 text-sm text-danger">
                  {emailErr}
                </p>
              )}
            </div>

            {formError && (
              <div className="mt-4" role="alert">
                <Notice>{formError}</Notice>
              </div>
            )}

            <Button type="submit" className="mt-6 w-full" disabled={pending || secondsLeft > 0} aria-busy={pending}>
              {pending ? "Booking…" : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : "Confirm booking"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
