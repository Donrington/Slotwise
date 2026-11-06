// Animation libraries are loaded lazily (dynamic import inside effects) to keep first paint fast.
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const loadAnime = () => import("animejs");

let gsapPromise: Promise<{ gsap: typeof import("gsap").gsap; ScrollTrigger: typeof import("gsap/ScrollTrigger").ScrollTrigger }> | undefined;
export function loadGsap() {
  gsapPromise ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([g, s]) => {
    g.gsap.registerPlugin(s.ScrollTrigger); // registered once
    return { gsap: g.gsap, ScrollTrigger: s.ScrollTrigger };
  });
  return gsapPromise;
}

// Shared handle so buttons can use Lenis for smooth scrolling when it is running.
export const motionState: { lenis: { scrollTo: (t: string | HTMLElement, o?: object) => void } | null } = { lenis: null };

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (motionState.lenis) motionState.lenis.scrollTo(el, { offset: -16 });
  else el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}
