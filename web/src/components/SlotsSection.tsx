"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dayKey, dayParts, minutes, timeParts, timeRange } from "@/lib/format";
import { loadAnime, loadGsap, prefersReducedMotion } from "@/lib/motion";
import type { SlotWithAvailability } from "@/lib/types";
import { Arrow, Button, Label } from "./ui";

interface Props {
  slots: SlotWithAvailability[] | null;
  providers: string[];
  provider: string | null;
  onProvider: (p: string | null) => void;
  loading: boolean;
  error: string | null;
  live: boolean;
  onRetry: () => void;
  onSelect: (s: SlotWithAvailability, trigger: HTMLElement) => void;
  selectedId?: string;
}

export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    if (prefersReducedMotion()) {
      setShown(target);
      return;
    }
    let anim: { pause: () => void } | undefined;
    let dead = false;
    const o = { v: from };
    loadAnime().then(({ animate }) => {
      if (dead) return;
      anim = animate(o, { v: target, duration: 550, ease: "outExpo", onUpdate: () => setShown(Math.round(o.v)) });
    });
    return () => {
      dead = true;
      anim?.pause();
    };
  }, [target]);
  return shown;
}

export function SlotsSection({ slots, providers, provider, onProvider, loading, error, live, onRetry, onSelect, selectedId }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());
  const ctxRef = useRef<{ add: (fn: () => void) => void; revert: () => void } | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, { iso: string; items: SlotWithAvailability[] }>();
    for (const s of slots ?? []) {
      const k = dayKey(s.start);
      if (!m.has(k)) m.set(k, { iso: s.start, items: [] });
      m.get(k)!.items.push(s);
    }
    return [...m.values()];
  }, [slots]);

  const openCount = useCountUp((slots ?? []).filter((s) => s.available).length);

  // Rows rise in as they scroll into view. Only rows not seen before animate, so a poll or a live
  // update that changes one row does not replay the whole timetable.
  useLayoutEffect(() => {
    if (!slots || prefersReducedMotion() || !list.current) return;
    const fresh = [...list.current.querySelectorAll<HTMLElement>("[data-slot]")].filter((el) => !seen.current.has(el.dataset.slot!));
    fresh.forEach((el) => seen.current.add(el.dataset.slot!));
    if (fresh.length === 0) return;
    let dead = false;
    loadGsap().then(({ gsap }) => {
      if (dead) return;
      ctxRef.current ??= gsap.context(() => {}, list.current!);
      ctxRef.current.add(() => {
        const rows = fresh.filter((el) => el.isConnected);
        if (rows.length === 0) return;
        gsap.fromTo(
          rows,
          { opacity: 0, y: 32 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: "expo.out",
            stagger: { each: 0.05, amount: 0.5 },
            clearProps: "opacity,transform",
            scrollTrigger: { trigger: rows[0], start: "top 92%", once: true },
          },
        );
      });
    });
    return () => {
      dead = true;
    };
  }, [slots]);

  useEffect(() => () => ctxRef.current?.revert(), []);

  async function press(el: HTMLElement) {
    if (prefersReducedMotion()) return;
    const { animate } = await loadAnime();
    animate(el, { scale: [{ to: 0.985, duration: 90 }, { to: 1, duration: 320 }], ease: "outQuad" });
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of slots ?? []) if (s.available) c.set(s.provider, (c.get(s.provider) ?? 0) + 1);
    return c;
  }, [slots]);

  return (
    <section id="slots" aria-labelledby="slots-title" className="scroll-mt-20 px-4 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-[1440px]">
        <div data-reveal className="grid items-end gap-6 border-b border-ink pb-6 md:grid-cols-12">
          <div className="md:col-span-8">
            <Label className="text-muted">N°02 The timetable</Label>
            <h2
              id="slots-title"
              tabIndex={-1}
              className="mt-3 font-display text-[clamp(2.75rem,7vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.04em] outline-none"
            >
              Open <em className="font-serif font-normal">slots</em>
            </h2>
          </div>
          <div className="flex items-end justify-between gap-4 md:col-span-4 md:flex-col md:items-end">
            <p className="font-display text-[clamp(3rem,6vw,5.5rem)] font-medium leading-none tracking-[-0.04em] tabular" aria-live="off">
              {slots ? String(openCount).padStart(2, "0") : "--"}
            </p>
            <span className="flex items-center gap-2 text-sm text-muted">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-signal" : "bg-line-strong"}`} aria-hidden="true" />
              {live ? "Live: updates as people book" : "available, refreshed every 20 s"}
            </span>
          </div>
        </div>

        {providers.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter by provider">
            {[null, ...providers].map((p) => {
              const on = provider === p;
              return (
                <button
                  key={p ?? "all"}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onProvider(p)}
                  className={`min-h-11 rounded-full px-5 font-display text-[15px] font-medium transition-colors duration-300 ${
                    on ? "bg-ink text-on-ink" : "text-ink ring-1 ring-inset ring-line-strong hover:ring-ink"
                  }`}
                >
                  {p ?? "All providers"}
                  {p && counts.has(p) && !provider && <sup className="ml-1 font-mono text-[10px] tabular">{counts.get(p)}</sup>}
                </button>
              );
            })}
          </div>
        )}

        <div ref={list} className="mt-10">
          {error && !slots && (
            <div role="alert" className="border-y border-ink py-10">
              <p className="font-display text-3xl tracking-tight">The timetable did not load.</p>
              <p className="mt-2 text-muted">Check your connection, then try again.</p>
              <Button variant="ink" className="mt-6" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}

          {loading && !slots && !error && (
            <div aria-hidden="true" className="space-y-px">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-24 animate-pulse border-t border-line bg-paper-2/60" />
              ))}
            </div>
          )}

          {slots && slots.length === 0 && (
            <div className="border-y border-ink py-16 text-center">
              <p className="font-display text-3xl tracking-tight">Nothing open{provider ? ` with ${provider}` : ""}.</p>
              <p className="mt-2 text-muted">New appointments are added regularly. Check back soon.</p>
            </div>
          )}

          {error && slots && (
            <p role="status" className="mb-4 text-sm text-muted">
              Could not refresh just now. Showing the last known timetable.
            </p>
          )}

          <div className="space-y-14">
            {groups.map((g) => {
              const d = dayParts(g.iso);
              return (
                <div key={dayKey(g.iso)} className="grid gap-4 md:grid-cols-12">
                  <h3 className="md:col-span-3">
                    <span className="flex items-baseline gap-3 md:sticky md:top-24 md:flex-col md:gap-1">
                      <span className="font-display text-6xl font-medium leading-none tracking-[-0.04em] tabular sm:text-7xl">{d.day}</span>
                      <Label className="text-muted">
                        {d.weekday} · {d.month}
                      </Label>
                    </span>
                  </h3>
                  <ul className="border-b border-line md:col-span-9">
                    {g.items.map((s) => (
                      <li key={s.id} data-slot={s.id} className="border-t border-line">
                        <SlotRow
                          slot={s}
                          selected={selectedId === s.id}
                          onPick={(el) => {
                            press(el);
                            onSelect(s, el);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function SlotRow({ slot, selected, onPick }: { slot: SlotWithAvailability; selected: boolean; onPick: (el: HTMLElement) => void }) {
  const t = timeParts(slot.start);
  const e = timeParts(slot.end);
  const len = minutes(slot.start, slot.end);
  const cells = (
    <>
      <span className="col-span-5 flex items-baseline gap-2 sm:col-span-3">
        <span className="font-mono text-[2rem] leading-none tracking-[-0.04em] tabular sm:text-[2.6rem]">{t.hm}</span>
        {t.period && <span className="font-mono text-xs uppercase">{t.period}</span>}
      </span>
      <span className="col-span-7 font-display text-xl font-medium tracking-tight sm:col-span-4 sm:text-2xl">{slot.provider}</span>
      <span className="col-span-8 font-mono text-xs uppercase tracking-[0.14em] opacity-70 tabular sm:col-span-3">
        to {e.hm}
        {e.period && ` ${e.period}`} · {len} min
      </span>
    </>
  );

  if (!slot.available) {
    return (
      <div aria-disabled="true" className="grid grid-cols-12 items-center gap-y-2 px-2 py-6 text-muted sm:px-4">
        <span className="contents [&>span:first-child]:line-through [&>span:first-child]:decoration-1">{cells}</span>
        <span className="col-span-4 text-right sm:col-span-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Taken</span>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Book ${slot.provider}, ${timeRange(slot.start, slot.end)}`}
      onClick={(ev) => onPick(ev.currentTarget)}
      className="sweep group grid w-full grid-cols-12 items-center gap-y-2 px-2 py-6 text-left text-ink outline-offset-0 sm:px-4"
    >
      {cells}
      <span className="col-span-4 flex items-center justify-end gap-2 sm:col-span-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Book</span>
        <span className="flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-ink transition-all duration-500 group-hover:bg-ink group-hover:text-signal group-aria-pressed:bg-ink group-aria-pressed:text-signal">
          <Arrow />
        </span>
      </span>
    </button>
  );
}
