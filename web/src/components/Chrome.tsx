"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadGsap, prefersReducedMotion, scrollToId } from "@/lib/motion";
import { Label } from "./ui";

/** Live local time, rendered only after mount so server and client markup match. */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="tabular">--:--:--</span>;
  return (
    <time dateTime={now.toISOString()} className="tabular">
      {new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now)}
    </time>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-baseline gap-2" aria-label="Slotwise, home">
          <span className="font-display text-2xl font-semibold tracking-[-0.04em]">Slotwise</span>
          <span className="hidden h-2 w-2 rounded-full bg-signal sm:inline-block" aria-hidden="true" />
        </Link>
        <Label className="hidden text-muted md:inline">
          Local time <Clock />
        </Label>
        <nav aria-label="Sections" className="flex items-center gap-1">
          {[
            ["slots", "Timetable"],
            ["my-bookings", "My bookings"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToId(id);
              }}
              className="rounded-full px-3 py-2 font-display text-[15px] font-medium hover:bg-ink hover:text-on-ink sm:px-4"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    let dead = false;
    let ctx: { revert: () => void } | undefined;
    loadGsap().then(({ gsap }) => {
      if (dead || !root.current) return;
      ctx = gsap.context(() => {
        gsap.fromTo(
          "[data-wordmark]",
          { yPercent: 35 },
          { yPercent: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom bottom", scrub: true } },
        );
      }, root);
    });
    return () => {
      dead = true;
      ctx?.revert();
    };
  }, []);

  return (
    <footer ref={root} className="overflow-hidden bg-ink text-on-ink">
      <div className="mx-auto max-w-[1440px] px-4 pt-16 sm:px-8">
        <div className="grid gap-8 border-b border-on-ink-line pb-10 md:grid-cols-12">
          <p className="font-display text-3xl font-medium leading-tight tracking-[-0.03em] md:col-span-6">
            Care, on <em className="font-serif font-normal">time</em>.
          </p>
          <div className="space-y-2 md:col-span-3">
            <Label className="text-on-ink-muted">Credits</Label>
            <p>Built for the Koya assessment</p>
          </div>
          <div className="space-y-2 md:col-span-3 md:text-right">
            <Label className="text-on-ink-muted">Back to</Label>
            <p>
              <a href="#hero-title" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }); }} className="underline decoration-1 underline-offset-[6px] hover:text-signal">
                the top
              </a>
            </p>
          </div>
        </div>
      </div>
      <p
        data-wordmark
        aria-hidden="true"
        className="-mb-[0.2em] select-none whitespace-nowrap text-center font-display text-[25vw] font-semibold leading-[0.8] tracking-[-0.06em]"
      >
        Slotwise<span className="text-signal">.</span>
      </p>
    </footer>
  );
}
