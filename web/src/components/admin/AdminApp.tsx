"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addSlots,
  cancelBooking,
  deleteSlot,
  getBookings,
  getOverview,
  getSlots,
  resetTimetable,
  signOut,
  type AdminBooking,
  type AdminSlot,
  type Overview,
} from "@/lib/adminApi";
import { dayKey, dayParts, minutes, timeParts } from "@/lib/format";
import { MAX_SLOTS, demoSlots, generateSchedule, singleSlot, type NewSlot } from "@/lib/schedule";
import { Arrow, Button, Label, Notice, StatusBadge } from "../ui";

type Toast = { tone: "ok" | "error"; text: string } | null;
const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
] as const;
const LENGTHS = [15, 20, 30, 45, 60];

const todayPlus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const when = (start: string) => {
  const t = timeParts(start);
  const d = dayParts(start);
  return `${d.weekday} ${d.day} ${d.month}, ${t.hm}${t.period ? ` ${t.period}` : ""}`;
};

export function AdminApp() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [slots, setSlots] = useState<AdminSlot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [bookingsVersion, setBookingsVersion] = useState(0);

  const notify = useCallback((tone: "ok" | "error", text: string) => setToast({ tone, text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    const [o, s] = await Promise.all([getOverview(), getSlots()]);
    if ((!o.ok && o.status === 401) || (!s.ok && s.status === 401)) return window.location.reload(); // session expired
    if (!o.ok || !s.ok) return setLoadError("Could not load the clinic data. Check the API, then refresh.");
    setLoadError(null);
    setOverview(o.data);
    setSlots(s.data.slots);
    setBookingsVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000); // see bookings patients make while the console is open
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-on-ink-line bg-ink text-on-ink">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
          <p className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-semibold tracking-[-0.04em]">
              Slotwise<span className="text-signal">.</span>
            </span>
            <Label className="hidden text-on-ink-muted sm:inline">Clinic console</Label>
          </p>
          <nav className="flex items-center gap-1" aria-label="Console">
            <Link href="/" className="whitespace-nowrap rounded-full px-3 py-2 font-display text-[15px] font-medium hover:bg-on-ink hover:text-ink sm:px-4">
              Patient page
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                window.location.reload();
              }}
              className="whitespace-nowrap rounded-full px-3 py-2 font-display text-[15px] font-medium ring-1 ring-inset ring-on-ink-line hover:bg-signal hover:text-ink sm:px-4"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-8">
        <section aria-labelledby="console-title" className="border-b border-ink pb-8 pt-12">
          <Label className="text-muted">Today at the clinic</Label>
          <h1 id="console-title" className="mt-3 font-display text-[clamp(2.75rem,7vw,6rem)] font-medium leading-[0.9] tracking-[-0.04em]">
            The <em className="font-serif font-normal">schedule</em>
          </h1>
          {loadError && (
            <div className="mt-6" role="alert">
              <Notice>{loadError}</Notice>
            </div>
          )}
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line md:grid-cols-4">
            {[
              ["Open, upcoming", overview?.slots_open_upcoming],
              ["Booked", overview?.bookings_confirmed],
              ["Cancelled", overview?.bookings_cancelled],
              ["Slots in total", overview?.slots_total],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-paper p-5 sm:p-6">
                <dt>
                  <Label className="text-muted">{label}</Label>
                </dt>
                <dd className="mt-3 font-display text-5xl font-medium leading-none tracking-[-0.04em] tabular">
                  {value === undefined ? "--" : String(value).padStart(2, "0")}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-14 grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <AddSlots providers={overview?.providers ?? []} onAdded={refresh} notify={notify} />
            <ResetDemo onReset={refresh} notify={notify} />
          </div>
          <div className="lg:col-span-7">
            <Timetable slots={slots} onChanged={refresh} notify={notify} />
          </div>
        </div>

        <Bookings version={bookingsVersion} onChanged={refresh} notify={notify} />
      </main>

      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <p
            className={`pointer-events-auto max-w-lg rounded-full px-6 py-3 font-display text-[15px] font-medium shadow-xl ${
              toast.tone === "ok" ? "bg-ink text-on-ink" : "bg-danger text-white"
            }`}
          >
            {toast.text}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- add slots */

function AddSlots({ providers, onAdded, notify }: { providers: string[]; onAdded: () => void; notify: (t: "ok" | "error", m: string) => void }) {
  const [mode, setMode] = useState<"single" | "schedule">("schedule");
  const [provider, setProvider] = useState("");
  const [date, setDate] = useState(todayPlus(1));
  const [time, setTime] = useState("09:00");
  const [from, setFrom] = useState(todayPlus(1));
  const [to, setTo] = useState(todayPlus(5));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("12:00");
  const [length, setLength] = useState(30);
  const [gap, setGap] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planned: NewSlot[] = useMemo(() => {
    if (mode === "single") {
      const s = singleSlot(provider, date, time, length);
      return s ? [s] : [];
    }
    return generateSchedule({ provider, from, to, weekdays, dayStart, dayEnd, minutes: length, gap });
  }, [mode, provider, date, time, from, to, weekdays, dayStart, dayEnd, length, gap]);

  const past = planned.some((s) => Date.parse(s.start) <= Date.now());
  const tooMany = planned.length > MAX_SLOTS;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!provider.trim()) return setError("Enter the provider's name.");
    if (planned.length === 0) return setError(mode === "single" ? "Pick a date and a start time." : "Those settings make no slots. Check the dates, days and hours.");
    if (tooMany) return setError(`That is more than ${MAX_SLOTS} slots. Narrow the dates or hours.`);
    setBusy(true);
    const r = await addSlots(planned);
    setBusy(false);
    if (r.ok) {
      notify("ok", `Added ${r.data.added} slot${r.data.added === 1 ? "" : "s"} for ${provider.trim()}. Patients can book them now.`);
      onAdded();
    } else setError(r.status === 409 ? `${r.error}. Some of these times already exist for this provider.` : r.error);
  }

  const input = "mt-2 block w-full rounded-xl border border-line-strong bg-paper px-3 py-2.5 text-base focus:border-ink focus:outline-none";
  return (
    <section aria-labelledby="add-title">
      <Label className="text-muted">N°01 Add</Label>
      <h2 id="add-title" className="mt-2 font-display text-4xl font-medium tracking-[-0.035em]">
        Open new <em className="font-serif font-normal">slots</em>
      </h2>

      <div className="mt-6 inline-flex rounded-full p-1 ring-1 ring-inset ring-line-strong" role="tablist" aria-label="How to add">
        {(
          [
            ["schedule", "Generate a schedule"],
            ["single", "One slot"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 font-display text-[15px] font-medium transition-colors ${mode === m ? "bg-ink text-on-ink" : "text-ink hover:bg-paper-2"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} noValidate className="mt-6 space-y-5 rounded-3xl bg-paper-2 p-6">
        <div>
          <label htmlFor="provider">
            <Label className="text-muted">Provider</Label>
          </label>
          <input id="provider" list="providers" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Dr Ade Okafor" className={input} />
          <datalist id="providers">
            {providers.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        {mode === "single" ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="date">
                <Label className="text-muted">Date</Label>
              </label>
              <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="time">
                <Label className="text-muted">Starts at</Label>
              </label>
              <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="from">
                  <Label className="text-muted">From</Label>
                </label>
                <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
              </div>
              <div>
                <label htmlFor="to">
                  <Label className="text-muted">To (inclusive)</Label>
                </label>
                <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
              </div>
            </div>
            <fieldset>
              <legend>
                <Label className="text-muted">On these days</Label>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEKDAYS.map(([n, label]) => {
                  const on = weekdays.includes(n);
                  return (
                    <label
                      key={n}
                      className={`cursor-pointer rounded-full px-3.5 py-2 font-display text-sm font-medium ring-1 ring-inset transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-signal ${
                        on ? "bg-ink text-on-ink ring-ink" : "ring-line-strong hover:ring-ink"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => setWeekdays((w) => (on ? w.filter((x) => x !== n) : [...w, n]))}
                      />
                      {label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="day-start">
                  <Label className="text-muted">First slot at</Label>
                </label>
                <input id="day-start" type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} className={input} />
              </div>
              <div>
                <label htmlFor="day-end">
                  <Label className="text-muted">Finish by</Label>
                </label>
                <input id="day-end" type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} className={input} />
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="length">
              <Label className="text-muted">Length</Label>
            </label>
            <select id="length" value={length} onChange={(e) => setLength(Number(e.target.value))} className={input}>
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </div>
          {mode === "schedule" && (
            <div>
              <label htmlFor="gap">
                <Label className="text-muted">Break between</Label>
              </label>
              <select id="gap" value={gap} onChange={(e) => setGap(Number(e.target.value))} className={input}>
                {[0, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "No break" : `${m} minutes`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="border-t border-line-strong pt-4" aria-live="polite">
          <p className="font-display text-lg font-medium tracking-tight">
            {planned.length === 0 ? "Nothing to add yet" : tooMany ? `Over ${MAX_SLOTS} slots` : `${planned.length} slot${planned.length === 1 ? "" : "s"} to add`}
          </p>
          {planned.length > 0 && !tooMany && (
            <p className="mt-1 text-sm text-muted">
              {when(planned[0]!.start)}
              {planned.length > 1 && ` to ${when(planned[planned.length - 1]!.start)}`}, {length} min each
            </p>
          )}
          {past && <p className="mt-2 text-sm text-danger">Some of these start in the past. Patients cannot book those.</p>}
        </div>

        {error && (
          <div role="alert">
            <Notice>{error}</Notice>
          </div>
        )}

        <Button type="submit" variant="ink" disabled={busy} aria-busy={busy} className="h-14 w-full justify-between px-7">
          <span>{busy ? "Adding…" : planned.length > 1 ? `Add ${planned.length} slots` : "Add slot"}</span>
          <Arrow />
        </Button>
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------- timetable */

function Timetable({ slots, onChanged, notify }: { slots: AdminSlot[] | null; onChanged: () => void; notify: (t: "ok" | "error", m: string) => void }) {
  const [provider, setProvider] = useState<string | null>(null);
  const [show, setShow] = useState<"upcoming" | "all">("upcoming");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const providers = useMemo(() => [...new Set((slots ?? []).map((s) => s.provider))].sort(), [slots]);
  const groups = useMemo(() => {
    const now = Date.now();
    const m = new Map<string, { iso: string; items: AdminSlot[] }>();
    for (const s of slots ?? []) {
      if (provider && s.provider !== provider) continue;
      if (show === "upcoming" && Date.parse(s.end) < now) continue;
      const k = dayKey(s.start);
      if (!m.has(k)) m.set(k, { iso: s.start, items: [] });
      m.get(k)!.items.push(s);
    }
    return [...m.values()];
  }, [slots, provider, show]);

  async function act(s: AdminSlot) {
    setBusy(s.id);
    const r = s.booking ? await cancelBooking(s.booking.id) : await deleteSlot(s.id);
    setBusy(null);
    setConfirming(null);
    if (r.ok) notify("ok", s.booking ? `Cancelled ${s.booking.name}'s booking. The slot is open again.` : "Slot removed.");
    else notify("error", r.status === 409 && !s.booking ? "Someone just booked that slot. Cancel the booking first." : r.error);
    onChanged();
  }

  return (
    <section aria-labelledby="tt-title">
      <Label className="text-muted">N°02 Manage</Label>
      <h2 id="tt-title" className="mt-2 font-display text-4xl font-medium tracking-[-0.035em]">
        Time<em className="font-serif font-normal">table</em>
      </h2>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {[null, ...providers].map((p) => (
          <button
            key={p ?? "all"}
            type="button"
            aria-pressed={provider === p}
            onClick={() => setProvider(p)}
            className={`min-h-10 rounded-full px-4 font-display text-sm font-medium ring-1 ring-inset transition-colors ${
              provider === p ? "bg-ink text-on-ink ring-ink" : "ring-line-strong hover:ring-ink"
            }`}
          >
            {p ?? "All providers"}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={show === "all"} onChange={(e) => setShow(e.target.checked ? "all" : "upcoming")} className="h-4 w-4 accent-ink" />
          Include past slots
        </label>
      </div>

      <div className="mt-6">
        {slots === null && <div className="h-40 animate-pulse rounded-2xl bg-paper-2" aria-hidden="true" />}
        {slots && groups.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line-strong p-10 text-center text-muted">
            No {show === "upcoming" ? "upcoming " : ""}slots{provider ? ` for ${provider}` : ""}. Add some on the left.
          </p>
        )}
        <div className="space-y-8">
          {groups.map((g) => {
            const d = dayParts(g.iso);
            return (
              <div key={dayKey(g.iso)}>
                <h3 className="flex items-baseline gap-3 border-b border-ink pb-2">
                  <span className="font-display text-3xl font-medium tracking-[-0.04em] tabular">{d.day}</span>
                  <Label className="text-muted">
                    {d.weekday} · {d.month}
                  </Label>
                  <span className="ml-auto font-mono text-xs text-muted tabular">
                    {g.items.filter((s) => !s.available).length}/{g.items.length} booked
                  </span>
                </h3>
                <ul>
                  {g.items.map((s) => {
                    const t = timeParts(s.start);
                    const asking = confirming === s.id;
                    const started = Date.parse(s.start) <= Date.now();
                    return (
                      <li key={s.id} className="grid grid-cols-12 items-center gap-x-3 gap-y-1 border-b border-line py-4">
                        <span className="col-span-4 flex items-baseline gap-1.5 sm:col-span-2">
                          <span className={`font-mono text-xl tracking-[-0.04em] tabular ${started ? "text-muted" : ""}`}>{t.hm}</span>
                          {t.period && <span className="font-mono text-[10px] uppercase">{t.period}</span>}
                        </span>
                        <span className="col-span-8 font-display text-[17px] font-medium tracking-tight sm:col-span-3">
                          {s.provider}
                          <span className="block font-mono text-[11px] font-normal text-muted">{minutes(s.start, s.end)} min</span>
                        </span>
                        <span className="col-span-12 sm:col-span-4">
                          {s.booking ? (
                            <span className="block">
                              <span className="font-medium">{s.booking.name}</span>
                              <span className="block break-all text-sm text-muted">{s.booking.email}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-sm text-muted">
                              <span className={`h-2 w-2 rounded-full ${started ? "bg-line-strong" : "bg-signal"}`} aria-hidden="true" />
                              {started ? "Passed, not booked" : "Open"}
                            </span>
                          )}
                        </span>
                        <span className="col-span-12 flex justify-end gap-2 sm:col-span-3">
                          {asking ? (
                            <>
                              <Button variant={s.booking ? "outline" : "ink"} className="min-h-9 px-4 text-sm" onClick={() => act(s)} disabled={busy === s.id}>
                                {busy === s.id ? "Working…" : s.booking ? "Yes, cancel it" : "Yes, remove"}
                              </Button>
                              <Button variant="link" className="min-h-9 text-sm" onClick={() => setConfirming(null)}>
                                Keep
                              </Button>
                            </>
                          ) : (
                            <Button variant="link" className="min-h-9 text-sm" onClick={() => setConfirming(s.id)} aria-label={`${s.booking ? "Cancel booking for" : "Remove"} ${s.provider} at ${when(s.start)}`}>
                              {s.booking ? "Cancel booking" : "Remove slot"}
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- bookings */

function Bookings({ version, onChanged, notify }: { version: number; onChanged: () => void; notify: (t: "ok" | "error", m: string) => void }) {
  const [status, setStatus] = useState<"all" | "confirmed" | "cancelled">("all");
  const [items, setItems] = useState<AdminBooking[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (s: typeof status) => {
    setLoading(true);
    const r = await getBookings(s);
    setLoading(false);
    if (r.ok) {
      setItems(r.data.bookings);
      setCursor(r.data.next_cursor);
    }
  }, []);

  useEffect(() => {
    load(status);
  }, [status, version, load]);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    const r = await getBookings(status, cursor);
    setLoading(false);
    if (r.ok) {
      setItems((cur) => [...(cur ?? []), ...r.data.bookings]);
      setCursor(r.data.next_cursor);
    }
  }

  async function cancel(b: AdminBooking) {
    setBusy(b.id);
    const r = await cancelBooking(b.id);
    setBusy(null);
    if (r.ok || r.status === 409) notify("ok", `Cancelled ${b.name}'s booking.`);
    else notify("error", r.error);
    onChanged();
  }

  return (
    <section aria-labelledby="bk-title" className="mt-20 border-t border-ink pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label className="text-muted">N°03 Records</Label>
          <h2 id="bk-title" className="mt-2 font-display text-4xl font-medium tracking-[-0.035em]">
            All <em className="font-serif font-normal">bookings</em>
          </h2>
        </div>
        <div className="inline-flex rounded-full p-1 ring-1 ring-inset ring-line-strong" role="group" aria-label="Filter bookings">
          {(["all", "confirmed", "cancelled"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-4 py-2 font-display text-sm font-medium capitalize ${status === s ? "bg-ink text-on-ink" : "hover:bg-paper-2"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {items && items.length === 0 && <p className="mt-8 rounded-2xl border border-dashed border-line-strong p-10 text-center text-muted">No bookings yet.</p>}
      {items && items.length > 0 && (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink">
                {["When", "Provider", "Patient", "Status", "Booked", ""].map((h) => (
                  <th key={h} scope="col" className="py-3 pr-4">
                    <Label className="text-muted">{h}</Label>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b border-line align-top">
                  <td className="py-4 pr-4 font-mono text-sm tabular">{when(b.slot.start)}</td>
                  <td className="py-4 pr-4 font-display font-medium">{b.slot.provider}</td>
                  <td className="py-4 pr-4">
                    {b.name}
                    <span className="block break-all text-sm text-muted">{b.email}</span>
                  </td>
                  <td className="py-4 pr-4">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="py-4 pr-4 text-sm text-muted">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(b.created_at))}</td>
                  <td className="py-4 text-right">
                    {b.status === "confirmed" && (
                      <Button variant="link" className="min-h-8 text-sm" onClick={() => cancel(b)} disabled={busy === b.id}>
                        {busy === b.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <Button variant="outline" onClick={more} disabled={loading} className="mt-6 h-12 w-full">
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- demo reset */

function ResetDemo({ onReset, notify }: { onReset: () => void; notify: (t: "ok" | "error", m: string) => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toUpperCase() === "RESET";

  async function reset() {
    if (!ready) return;
    setBusy(true);
    const r = await resetTimetable(demoSlots());
    setBusy(false);
    setTyped("");
    if (r.ok) notify("ok", `Timetable reset: ${r.data.slots} demo slots, every booking cleared.`);
    else notify("error", r.error);
    onReset();
  }

  return (
    <section aria-labelledby="reset-title" className="mt-12 rounded-3xl p-6 ring-1 ring-inset ring-danger/40">
      <Label className="text-danger">Danger zone</Label>
      <h2 id="reset-title" className="mt-2 font-display text-2xl font-medium tracking-tight">
        Reset to the demo timetable
      </h2>
      <p className="mt-2 text-sm text-muted">
        Deletes <strong className="text-ink">every slot and every booking</strong>, then loads 24 demo slots starting 14 days from today. Use it before a
        demo, never once real patients have booked.
      </p>
      <label htmlFor="reset-confirm" className="mt-4 block">
        <Label className="text-muted">Type RESET to confirm</Label>
      </label>
      <div className="mt-2 flex gap-3">
        <input
          id="reset-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="block w-full rounded-xl border border-line-strong bg-paper px-3 py-2.5 font-mono uppercase focus:border-danger focus:outline-none"
        />
        <Button variant="outline" onClick={reset} disabled={!ready || busy} className="shrink-0 ring-danger text-danger hover:bg-danger hover:text-white">
          {busy ? "Resetting…" : "Reset"}
        </Button>
      </div>
    </section>
  );
}
