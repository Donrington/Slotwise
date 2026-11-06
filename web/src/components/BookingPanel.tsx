"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBooking } from "@/lib/api";
import { dayLabel, timeParts, timeRange } from "@/lib/format";
import { loadAnime, prefersReducedMotion } from "@/lib/motion";
import { isEmail } from "@/lib/validate";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { ConfirmationCard } from "./ConfirmationCard";
import { Arrow, Button, Label, Notice } from "./ui";

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
  const backdrop = useRef<HTMLDivElement>(null);
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
    const heading = () => document.getElementById("slots-title");
    requestAnimationFrame(() => (returnFocus?.isConnected ? returnFocus : heading())?.focus());
    // A refresh in flight can still turn the trigger row into a non-focusable Taken row after we
    // focus it, which drops focus to <body>. If that happens, move focus to the timetable heading.
    for (const ms of [150, 600, 1500]) {
      setTimeout(() => {
        if (document.activeElement === document.body || !document.activeElement?.isConnected) heading()?.focus();
      }, ms);
    }
  }, [onClose, returnFocus]);

  // Drawer slides in from the right (bottom sheet on small screens).
  useEffect(() => {
    if (prefersReducedMotion() || !dialog.current) return;
    const wide = window.matchMedia("(min-width: 768px)").matches;
    loadAnime().then(({ animate }) => {
      if (dialog.current) animate(dialog.current, wide ? { translateX: ["100%", "0%"], duration: 600, ease: "outExpo" } : { translateY: ["100%", "0%"], duration: 600, ease: "outExpo" });
      if (backdrop.current) animate(backdrop.current, { opacity: [0, 1], duration: 400, ease: "outQuad" });
    });
  }, []);

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
      msg = "That slot no longer exists. The timetable has been refreshed.";
      onRefresh();
    } else if (r.status === 409) {
      msg = "Someone just took this slot. Pick another time from the timetable.";
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

  const t = timeParts(slot.start);
  const field =
    "mt-2 block w-full border-0 border-b border-on-ink-line bg-transparent px-0 pb-3 pt-1 font-display text-2xl font-medium tracking-tight text-on-ink placeholder:text-on-ink-muted/60 focus:border-b-2 focus:border-signal focus:outline-none focus:ring-0 focus-visible:outline-none aria-[invalid=true]:border-danger-on-ink";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end" role="presentation">
      <div ref={backdrop} className="absolute inset-0 bg-ink/55 backdrop-blur-[2px]" onClick={close} aria-hidden="true" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        tabIndex={-1}
        data-lenis-prevent
        className="relative max-h-[94vh] w-full overflow-y-auto rounded-t-[32px] bg-ink px-6 pb-10 pt-6 text-on-ink shadow-2xl md:max-h-none md:w-[min(600px,100%)] md:rounded-none md:px-10 md:pt-8"
      >
        <div className="flex items-center justify-between border-b border-on-ink-line pb-4">
          <Label className="text-on-ink-muted">{confirmed ? "N°03 Confirmation" : "N°03 Reserve"}</Label>
          <button type="button" onClick={close} aria-label="Close" className="flex h-11 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-on-ink hover:text-signal">
            Close <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="pt-8">
          {confirmed ? (
            <ConfirmationCard
              booking={confirmed}
              slot={slot}
              fresh
              inverse
              announce={announce}
              onChange={(b) => {
                onBookingChange(b);
                onRefresh();
              }}
              onBookAnother={close}
            />
          ) : (
            <form onSubmit={submit} noValidate>
              <h2 id="panel-title" className="font-display text-4xl font-medium leading-none tracking-[-0.035em] sm:text-5xl">
                Book this <em className="font-serif font-normal">slot</em>
              </h2>

              <div className="mt-8 flex items-end justify-between gap-4 border-y border-on-ink-line py-6">
                <div>
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-6xl leading-none tracking-[-0.05em] tabular">{t.hm}</span>
                    {t.period && <span className="font-mono text-sm uppercase text-on-ink-muted">{t.period}</span>}
                  </p>
                  <p className="mt-3 text-on-ink-muted">
                    {dayLabel(slot.start)}, {timeRange(slot.start, slot.end)}
                  </p>
                </div>
                <p className="text-right font-display text-xl font-medium tracking-tight">{slot.provider}</p>
              </div>

              <div className="mt-8">
                <label htmlFor="name" className="block">
                  <Label className="text-on-ink-muted">Full name</Label>
                </label>
                <input
                  id="name"
                  autoComplete="name"
                  placeholder="Ada Okafor"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((x) => ({ ...x, name: true }))}
                  aria-invalid={!!nameErr}
                  aria-describedby={nameErr ? "name-err" : undefined}
                  className={field}
                />
                {nameErr && (
                  <p id="name-err" className="mt-2 text-sm text-danger-on-ink">
                    {nameErr}
                  </p>
                )}
              </div>

              <div className="mt-7">
                <label htmlFor="email" className="block">
                  <Label className="text-on-ink-muted">Email</Label>
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched((x) => ({ ...x, email: true }))}
                  aria-invalid={!!emailErr}
                  aria-describedby={emailErr ? "email-err" : undefined}
                  className={field}
                />
                {emailErr && (
                  <p id="email-err" className="mt-2 text-sm text-danger-on-ink">
                    {emailErr}
                  </p>
                )}
              </div>

              {formError && (
                <div className="mt-6" role="alert">
                  <Notice inverse>{formError}</Notice>
                </div>
              )}

              <Button type="submit" className="mt-10 h-16 w-full justify-between rounded-full px-8 text-lg" disabled={pending || secondsLeft > 0} aria-busy={pending}>
                <span>{pending ? "Booking…" : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : "Confirm booking"}</span>
                <Arrow />
              </Button>
              <p className="mt-4 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-on-ink-muted">
                Safe to retry: a repeated submit never books twice
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
