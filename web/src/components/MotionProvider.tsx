"use client";
import { useEffect } from "react";
import { loadGsap, motionState, prefersReducedMotion } from "@/lib/motion";

/** Starts Lenis smooth scroll synced with GSAP's ticker. Does nothing when reduced motion is requested. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let dead = false;
    let teardown: (() => void) | undefined;
    (async () => {
      const [{ gsap, ScrollTrigger }, { default: Lenis }] = await Promise.all([loadGsap(), import("lenis")]);
      if (dead) return;
      const lenis = new Lenis({ lerp: 0.1 });
      motionState.lenis = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      teardown = () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
        motionState.lenis = null;
      };
    })();
    return () => {
      dead = true;
      teardown?.();
    };
  }, []);
  return <>{children}</>;
}
