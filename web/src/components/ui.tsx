"use client";
import { useRef, type ButtonHTMLAttributes } from "react";
import { loadAnime, prefersReducedMotion } from "@/lib/motion";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const styles: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-surface text-brand-700 ring-1 ring-inset ring-brand-600/40 hover:bg-brand-50 disabled:opacity-50",
  danger: "bg-surface text-danger ring-1 ring-inset ring-danger/40 hover:bg-danger-bg disabled:opacity-50",
  ghost: "text-brand-700 hover:bg-brand-50 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  onPointerEnter,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const ref = useRef<HTMLButtonElement>(null);

  async function ripple(e: React.PointerEvent<HTMLButtonElement>) {
    onPointerEnter?.(e);
    const el = ref.current;
    if (!el || el.disabled || prefersReducedMotion()) return;
    const { animate } = await loadAnime();
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const s = document.createElement("span");
    s.setAttribute("aria-hidden", "true");
    s.className = "pointer-events-none absolute rounded-full bg-white/40";
    s.style.cssText += `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    el.appendChild(s);
    animate(s, { scale: [0, 1], opacity: [0.5, 0], duration: 550, ease: "outQuad", onComplete: () => s.remove() });
  }

  return (
    <button
      ref={ref}
      type="button"
      onPointerEnter={ripple}
      className={`relative inline-flex min-h-11 items-center justify-center gap-2 overflow-hidden rounded-xl px-5 py-2.5 text-base font-semibold transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: "confirmed" | "cancelled" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
        status === "confirmed" ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"
      }`}
    >
      {status === "confirmed" ? "Confirmed" : "Cancelled"}
    </span>
  );
}

export function Notice({ tone = "error", children }: { tone?: "error" | "info"; children: React.ReactNode }) {
  return (
    <p
      className={`rounded-xl px-4 py-3 text-sm ${tone === "error" ? "bg-danger-bg text-danger" : "bg-brand-50 text-brand-700"}`}
    >
      {children}
    </p>
  );
}
