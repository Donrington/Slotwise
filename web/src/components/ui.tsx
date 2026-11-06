"use client";
import { useRef, type ButtonHTMLAttributes } from "react";
import { loadAnime, prefersReducedMotion } from "@/lib/motion";

type Variant = "signal" | "ink" | "outline" | "outline-inverse" | "link" | "link-inverse";
const styles: Record<Variant, string> = {
  signal: "bg-signal text-ink hover:bg-ink hover:text-on-ink disabled:bg-signal/50 disabled:text-ink/70",
  ink: "bg-ink text-on-ink hover:bg-signal hover:text-ink disabled:opacity-50",
  outline: "text-ink ring-1 ring-inset ring-ink hover:bg-ink hover:text-on-ink disabled:opacity-50",
  "outline-inverse": "text-on-ink ring-1 ring-inset ring-on-ink/60 hover:bg-on-ink hover:text-ink disabled:opacity-50",
  link: "px-0 text-ink underline decoration-1 underline-offset-[6px] hover:decoration-2 disabled:opacity-50",
  "link-inverse": "px-0 text-on-ink underline decoration-1 underline-offset-[6px] hover:decoration-2 disabled:opacity-50",
};

/** Button with a press-light ripple from the pointer (anime.js), skipped under reduced motion. */
export function Button({
  variant = "signal",
  className = "",
  children,
  onPointerEnter,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const ref = useRef<HTMLButtonElement>(null);
  const ripples = variant !== "link" && variant !== "link-inverse";

  async function ripple(e: React.PointerEvent<HTMLButtonElement>) {
    onPointerEnter?.(e);
    const el = ref.current;
    if (!ripples || !el || el.disabled || prefersReducedMotion()) return;
    const { animate } = await loadAnime();
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement("span");
    s.setAttribute("aria-hidden", "true");
    s.className = "pointer-events-none absolute rounded-full bg-white/25";
    s.style.cssText += `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    el.appendChild(s);
    animate(s, { scale: [0, 1], opacity: [0.6, 0], duration: 560, ease: "outQuad", onComplete: () => s.remove() });
  }

  return (
    <button
      ref={ref}
      type="button"
      onPointerEnter={ripple}
      className={`relative inline-flex min-h-12 items-center justify-center gap-3 overflow-hidden rounded-full px-6 font-display text-base font-medium tracking-tight transition-colors duration-300 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-[1em] w-[1em] ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 18L18 6M8 6h10v10" strokeLinecap="square" />
    </svg>
  );
}

/** Mono, uppercase, tracked: the timetable's labelling voice. */
export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${className}`}>{children}</span>;
}

export function StatusBadge({ status, inverse = false }: { status: "confirmed" | "cancelled"; inverse?: boolean }) {
  const confirmed = status === "confirmed";
  const tone = confirmed
    ? inverse
      ? "bg-on-ink text-ink"
      : "bg-ink text-on-ink"
    : inverse
      ? "text-on-ink-muted ring-1 ring-inset ring-on-ink-line line-through"
      : "text-muted ring-1 ring-inset ring-line-strong line-through";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] ${tone}`}>
      {confirmed ? "Confirmed" : "Cancelled"}
    </span>
  );
}

export function Notice({ tone = "error", inverse = false, children }: { tone?: "error" | "info"; inverse?: boolean; children: React.ReactNode }) {
  const color =
    tone === "error" ? (inverse ? "text-danger-on-ink border-danger-on-ink" : "text-danger border-danger") : inverse ? "text-on-ink border-on-ink-line" : "text-ink border-line-strong";
  return <p className={`border-l-2 py-1 pl-4 text-sm leading-relaxed ${color}`}>{children}</p>;
}
