"use client";
import { useLayoutEffect, useRef } from "react";
import { loadGsap, prefersReducedMotion, scrollToId } from "@/lib/motion";
import { Button } from "./ui";

const WORDS = ["Book", "the", "right", "clinic", "slot,", "without", "the", "wait."];

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    let dead = false;
    let ctx: { revert: () => void } | undefined;
    loadGsap().then(({ gsap }) => {
      if (dead || !root.current) return;
      ctx = gsap.context(() => {
        gsap.from("[data-word]", { yPercent: 110, duration: 0.8, ease: "power3.out", stagger: 0.07 });
        gsap.from("[data-hero-fade]", { opacity: 0, y: 16, duration: 0.7, delay: 0.5, stagger: 0.12, ease: "power2.out" });
        gsap.to("[data-shape]", {
          yPercent: -35,
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
    <header ref={root} className="relative overflow-hidden bg-brand-50">
      <div
        data-shape
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-brand-100 sm:h-[26rem] sm:w-[26rem]"
      />
      <div className="relative mx-auto max-w-5xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-700">Slotwise</p>
        <h1 className="mt-4 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-6xl">
          {WORDS.map((w, i) => (
            <span key={i}>
              <span className="inline-block overflow-hidden align-bottom">
                <span data-word className="inline-block">
                  {w}
                </span>
              </span>{" "}
            </span>
          ))}
        </h1>
        <p data-hero-fade className="mt-5 max-w-xl text-lg text-muted">
          See every open appointment, pick a time and get an instant confirmation.
        </p>
        <div data-hero-fade className="mt-8">
          <Button onClick={() => scrollToId("slots")}>See open slots</Button>
        </div>
      </div>
    </header>
  );
}
