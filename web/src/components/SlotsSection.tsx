"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dayKey, dayLabel, timeRange } from "@/lib/format";
import { loadAnime, loadGsap, prefersReducedMotion } from "@/lib/motion";
import type { SlotWithAvailability } from "@/lib/types";
import { Button } from "./ui";

interface Props {
  slots: SlotWithAvailability[] | null;
  providers: string[];
  provider: string | null;
  onProvider: (p: string | null) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (s: SlotWithAvailability, trigger: HTMLElement) => void;
  selectedId?: string;
}

function useCountUp(target: number): number {
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
      anim = animate(o, { v: target, duration: 500, ease: "outExpo", onUpdate: () => setShown(Math.round(o.v)) });
    });
    return () => {
      dead = true;
      anim?.pause();
    };
  }, [target]);
  return shown;
}

export function SlotsSection({ slots, providers, provider, onProvider, loading, error, onRetry, onSelect, selectedId }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());
  const ctxRef = useRef<{ add: (fn: () => void) => void; revert: () => void } | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: SlotWithAvailability[] }>();
    for (const s of slots ?? []) {
      const k = dayKey(s.start);
      if (!m.has(k)) m.set(k, { label: dayLabel(s.start), items: [] });
      m.get(k)!.items.push(s);
    }
    return [...m.values()];
  }, [slots]);

  const openCount = useCountUp((slots ?? []).filter((s) => s.available).length);

  // Animate only cards that were not seen before; a poll that changes nothing animates nothing.
  useLayoutEffect(() => {
    if (!slots || prefersReducedMotion() || !grid.current) return;
    const fresh = [...grid.current.querySelectorAll<HTMLElement>("[data-slot]")].filter(
      (el) => !seen.current.has(el.dataset.slot!),
    );
    fresh.forEach((el) => seen.current.add(el.dataset.slot!));
    if (fresh.length === 0) return;
    let dead = false;
    loadGsap().then(({ gsap }) => {
      if (dead) return;
      ctxRef.current ??= gsap.context(() => {}, grid.current!);
      ctxRef.current.add(() => {
        const live = fresh.filter((el) => el.isConnected);
        if (live.length === 0) return;
        gsap.fromTo(
          live,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            ease: "power2.out",
            stagger: { each: 0.04, amount: 0.4 },
            clearProps: "opacity,transform",
            scrollTrigger: { trigger: live[0], start: "top 92%", once: true },
          },
        );
      });
    });
    return () => {
      dead = true;
    };
  }, [slots]);

  useEffect(() => () => ctxRef.current?.revert(), []);

  async function pulse(el: HTMLElement) {
    if (prefersReducedMotion()) return;
    const { animate } = await loadAnime();
    animate(el, { scale: [{ to: 0.96, duration: 110 }, { to: 1, duration: 260 }], ease: "outQuad" });
  }

  return (
    <section id="slots" aria-labelledby="slots-title" className="mx-auto max-w-5xl scroll-mt-4 px-4 py-16 sm:px-6">
      <div data-reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="slots-title" tabIndex={-1} className="font-display text-3xl text-ink outline-none sm:text-4xl">
            Open slots
          </h2>
          <p className="mt-1 text-muted" aria-live="off">
            {slots ? (
              <>
                <span className="font-semibold text-brand-700">{openCount}</span> available right now
              </>
            ) : (
              "Loading the schedule"
            )}
          </p>
        </div>
      </div>

      {providers.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter by provider">
          {[null, ...providers].map((p) => (
            <button
              key={p ?? "all"}
              type="button"
              aria-pressed={provider === p}
              onClick={() => onProvider(p)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors ${
                provider === p ? "bg-brand-600 text-white ring-brand-600" : "bg-surface text-brand-700 ring-line hover:bg-brand-50"
              }`}
            >
              {p ?? "All providers"}
            </button>
          ))}
        </div>
      )}

      <div ref={grid} className="mt-8 space-y-10">
        {error && !slots && (
          <div role="alert" className="rounded-2xl bg-danger-bg p-6">
            <p className="font-semibold text-danger">We could not load the schedule.</p>
            <p className="mt-1 text-sm text-danger">Check your connection and try again.</p>
            <Button variant="secondary" className="mt-4" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {loading && !slots && !error && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-brand-100/60" />
            ))}
          </div>
        )}
        {slots && slots.length === 0 && (
          <div className="rounded-2xl bg-surface p-8 text-center ring-1 ring-line">
            <p className="font-semibold text-ink">No slots to show{provider ? ` for ${provider}` : ""}.</p>
            <p className="mt-1 text-muted">Check back soon, new appointments are added regularly.</p>
          </div>
        )}
        {error && slots && (
          <p role="status" className="text-sm text-muted">
            Could not refresh just now. Showing the last known schedule.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <h3 className="mb-3 text-lg font-semibold text-ink">{g.label}</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((s) => (
                <li key={s.id} data-slot={s.id}>
                  {s.available ? (
                    <button
                      type="button"
                      aria-pressed={selectedId === s.id}
                      onClick={(e) => {
                        pulse(e.currentTarget);
                        onSelect(s, e.currentTarget);
                      }}
                      className="group block w-full rounded-2xl bg-surface p-4 text-left ring-1 ring-line transition hover:ring-2 hover:ring-brand-500 aria-pressed:ring-2 aria-pressed:ring-brand-600"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{s.provider}</span>
                        <span className="rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok">Available</span>
                      </span>
                      <span className="mt-2 block text-muted">{timeRange(s.start, s.end)}</span>
                    </button>
                  ) : (
                    <div aria-disabled="true" className="block w-full rounded-2xl bg-brand-50/60 p-4 ring-1 ring-line">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-muted">{s.provider}</span>
                        <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-semibold text-muted">Booked</span>
                      </span>
                      <span className="mt-2 block text-muted line-through decoration-muted/50">{timeRange(s.start, s.end)}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
