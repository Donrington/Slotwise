"use client";
import { useLayoutEffect, useRef } from "react";
import { loadGsap, prefersReducedMotion, scrollToId } from "@/lib/motion";
import { timeParts } from "@/lib/format";
import type { SlotWithAvailability } from "@/lib/types";
import { Arrow, Button, Label } from "./ui";

const STEPS = [
  ["01", "Pick an open slot from the live timetable."],
  ["02", "Leave a name and an email. That is all."],
  ["03", "Get a confirmed booking, instantly."],
] as const;

export function Hero({ openCount, next }: { openCount: number | null; next: SlotWithAvailability | null }) {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    let dead = false;
    let ctx: { revert: () => void } | undefined;
    loadGsap().then(({ gsap }) => {
      if (dead || !root.current) return;
      ctx = gsap.context(() => {
        gsap.from("[data-line]", { yPercent: 108, duration: 1.1, ease: "expo.out", stagger: 0.09 });
        gsap.from("[data-rise]", { y: 24, opacity: 0, duration: 0.9, delay: 0.45, ease: "expo.out", stagger: 0.08 });
        gsap.from("[data-orb]", { scale: 0, duration: 1.2, delay: 0.35, ease: "expo.out" });
        gsap.to("[data-orb]", {
          yPercent: 60,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
        });
        gsap.to("[data-headline]", {
          yPercent: -12,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
        });
      }, root);
    });
    return () => {
      dead = true;
      ctx?.revert();
    };
  }, []);

  return (
    <section ref={root} aria-labelledby="hero-title" className="relative overflow-hidden px-4 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-16">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex items-center justify-between border-b border-line pb-3" data-rise>
          <Label className="text-muted">N°01 Clinic booking</Label>
          <Label className="text-muted">
            {openCount === null ? "Loading the timetable" : `${openCount} open now`}
          </Label>
        </div>

        <div className="relative">
        {next && <NextOpen slot={next} />}
        <h1
          id="hero-title"
          data-headline
          className="mt-8 font-display text-[clamp(3.6rem,15.5vw,12.5rem)] font-medium leading-[0.86] tracking-[-0.045em] text-ink md:text-[clamp(3.6rem,12.5vw,12.5rem)]"
        >
          <span className="block overflow-hidden pb-[0.06em]">
            <span data-line className="block">
              Book care
            </span>{" "}
          </span>
          <span className="block overflow-hidden pb-[0.06em]">
            <span data-line className="block">
              at the <em className="font-serif font-normal tracking-[-0.02em]">right</em>
            </span>{" "}
          </span>
          <span className="block overflow-hidden pb-[0.06em]">
            <span data-line className="flex items-center gap-[0.18em]">
              minute.
              <span
                data-orb
                aria-hidden="true"
                className="inline-block h-[0.62em] w-[0.62em] shrink-0 rounded-full bg-signal"
              />
            </span>
          </span>
        </h1>
        </div>

        <div className="mt-12 grid gap-10 border-t border-line pt-8 md:grid-cols-12">
          <p data-rise className="max-w-md text-lg leading-relaxed text-ink md:col-span-5">
            The clinic timetable, live. Every open appointment in one place. Choose a time and it is yours, with no
            phone queue and no double bookings.
          </p>
          <ol className="grid gap-5 sm:grid-cols-3 md:col-span-7">
            {STEPS.map(([n, text]) => (
              <li key={n} data-rise className="border-t border-ink pt-3">
                <span className="font-mono text-sm tabular">{n}</span>
                <p className="mt-2 text-[15px] leading-snug text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </div>

        <div data-rise className="mt-10">
          <Button onClick={() => scrollToId("slots")} className="h-16 px-8 text-lg">
            See the timetable <Arrow className="rotate-90" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The soonest open slot, set beside the headline on wide screens: the page's live pulse. */
function NextOpen({ slot }: { slot: SlotWithAvailability }) {
  const t = timeParts(slot.start);
  return (
    <aside
      data-rise
      aria-label="Next open slot"
      className="absolute right-0 top-2 hidden w-[min(340px,28vw)] border-t-2 border-ink pt-4 lg:block"
    >
      <div className="flex items-center justify-between">
        <Label>Next open</Label>
        <span className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-signal" />
          </span>
          <Label className="text-muted">Live</Label>
        </span>
      </div>
      <p className="mt-5 flex items-baseline gap-2">
        <span className="font-mono text-[5.5rem] leading-[0.8] tracking-[-0.06em] tabular">{t.hm}</span>
        {t.period && <span className="font-mono text-sm uppercase">{t.period}</span>}
      </p>
      <p className="mt-4 font-display text-xl font-medium tracking-tight">{slot.provider}</p>
      <p className="text-sm text-muted">
        {new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date(slot.start))}
      </p>
    </aside>
  );
}

/** "Next open" ticker. Decorative motion; the same information is in the timetable below. */
export function NextOpenMarquee({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  // Two identical halves; the track slides by exactly one half, so the loop is seamless.
  const half = items.length < 6 ? [...items, ...items, ...items] : items;
  return (
    <div className="marquee overflow-hidden border-y border-ink bg-ink py-3 text-on-ink" aria-hidden="true">
      <div className="marquee-track flex w-max gap-10 whitespace-nowrap font-mono text-sm uppercase tracking-[0.14em]">
        {[0, 1].map((k) => (
          <div key={k} className="flex gap-10">
            {half.map((t, i) => (
              <span key={`${k}-${i}`} className="flex items-center gap-10">
                <span className="text-signal">●</span>
                {t}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
