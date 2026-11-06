"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listSlots } from "@/lib/api";
import { startLiveSlots } from "@/lib/live";
import { loadGsap, prefersReducedMotion } from "@/lib/motion";
import type { Booking, SlotWithAvailability } from "@/lib/types";
import { BookingPanel } from "./BookingPanel";
import { Hero } from "./Hero";
import { MotionProvider } from "./MotionProvider";
import { MyBookings } from "./MyBookings";
import { SlotsSection } from "./SlotsSection";

export function BookingApp() {
  const root = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<SlotWithAvailability[] | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SlotWithAvailability | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [confirmed, setConfirmed] = useState<Booking | null>(null);
  const [lastEmail, setLastEmail] = useState(""); // memory only, never persisted
  const [announcement, setAnnouncement] = useState("");

  const providerRef = useRef<string | null>(null);
  const liveRows = useRef<SlotWithAvailability[] | null>(null); // set while the Realtime subscription is live
  const reqId = useRef(0);
  const index = useRef(new Map<string, SlotWithAvailability>());

  // Apply a full slot list (from REST or from a live update) to state.
  const apply = useCallback((list: SlotWithAvailability[]) => {
    for (const s of list) index.current.set(s.id, s);
    setProviders((cur) => [...new Set([...cur, ...list.map((s) => s.provider)])].sort());
    // Keep the same array when nothing changed so memoised groups and animations stay quiet.
    setSlots((cur) => (cur && JSON.stringify(cur) === JSON.stringify(list) ? cur : list));
    setSelected((cur) => (cur ? (list.find((s) => s.id === cur.id) ?? cur) : cur));
  }, []);

  const refresh = useCallback(async () => {
    if (liveRows.current) {
      // Live: rows are already current; just re-filter for the chosen provider.
      const p = providerRef.current;
      apply(p ? liveRows.current.filter((s) => s.provider === p) : liveRows.current);
      return;
    }
    const id = ++reqId.current;
    const p = providerRef.current;
    const r = await listSlots(p ?? undefined);
    if (id !== reqId.current) return; // a newer request superseded this one
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    apply(r.data.slots);
  }, [apply]);

  // Live availability via Neon Realtime when the API offers it; otherwise (or if it drops) poll.
  useEffect(() => {
    let handle: { stop(): void } | null = null;
    let dead = false;
    startLiveSlots(
      (rows) => {
        liveRows.current = rows;
        setLoading(false);
        setError(null);
        const p = providerRef.current;
        apply(p ? rows.filter((s) => s.provider === p) : rows);
      },
      () => {
        liveRows.current = null; // fall back to polling
        refresh();
      },
    ).then((h) => {
      if (dead) h?.stop();
      else handle = h;
    });
    return () => {
      dead = true;
      handle?.stop();
      liveRows.current = null;
    };
  }, [apply, refresh]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => !liveRows.current && refresh(), 20_000);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  function chooseProvider(p: string | null) {
    providerRef.current = p;
    setProvider(p);
    refresh();
  }

  // Section headings fade and rise as they scroll in (only those below the fold; set from JS only).
  useLayoutEffect(() => {
    if (prefersReducedMotion() || !root.current) return;
    let dead = false;
    let ctx: { revert: () => void } | undefined;
    loadGsap().then(({ gsap }) => {
      if (dead || !root.current) return;
      ctx = gsap.context(() => {
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          if (el.getBoundingClientRect().top < window.innerHeight) return;
          gsap.fromTo(
            el,
            { opacity: 0, y: 28 },
            { opacity: 1, y: 0, duration: 0.7, ease: "power2.out", clearProps: "opacity,transform", scrollTrigger: { trigger: el, start: "top 88%", once: true } },
          );
        });
      }, root);
    });
    return () => {
      dead = true;
      ctx?.revert();
    };
  }, []);

  const closePanel = useCallback(() => {
    setSelected(null);
    setConfirmed(null);
  }, []);

  return (
    <MotionProvider>
      <div ref={root}>
        <Hero />
        <main>
          <SlotsSection
            slots={slots}
            providers={providers}
            provider={provider}
            onProvider={chooseProvider}
            loading={loading}
            error={error}
            onRetry={() => {
              setLoading(true);
              refresh();
            }}
            selectedId={selected?.id}
            onSelect={(s, el) => {
              setConfirmed(null);
              setSelected(s);
              setTrigger(el);
            }}
          />
          <MyBookings
            lastEmail={lastEmail}
            onEmail={setLastEmail}
            slotLookup={(id) => index.current.get(id)}
            onSlotsChanged={refresh}
            announce={setAnnouncement}
          />
        </main>
        <footer className="border-t border-line bg-surface px-4 py-8 text-center text-sm text-muted">Built for the Koya assessment</footer>

        {selected && (
          <BookingPanel
            key={selected.id}
            slot={selected}
            confirmed={confirmed}
            lastEmail={lastEmail}
            onEmail={setLastEmail}
            onBooked={setConfirmed}
            onBookingChange={setConfirmed}
            onClose={closePanel}
            onRefresh={refresh}
            announce={setAnnouncement}
            returnFocus={trigger}
          />
        )}
        <div aria-live="polite" role="status" className="sr-only">
          {announcement}
        </div>
      </div>
    </MotionProvider>
  );
}
