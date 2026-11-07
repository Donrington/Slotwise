// Pure helpers for building slots in the staff console. Times are entered in the browser's local time
// and sent as UTC ISO strings without milliseconds (the API stores and returns them exactly as sent).
export interface NewSlot {
  id: string;
  provider: string;
  start: string;
  end: string;
}

export const toIso = (d: Date) => d.toISOString().replace(".000Z", "Z");

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40) || "provider";

/** Stable, readable ids: provider-YYYYMMDD-HHMM in UTC, so the same slot always gets the same id. */
export function slotId(provider: string, start: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${slug(provider)}-${start.getUTCFullYear()}${p(start.getUTCMonth() + 1)}${p(start.getUTCDate())}-${p(start.getUTCHours())}${p(start.getUTCMinutes())}`;
}

/** "2026-11-21" + "09:30" in local time -> Date, or null when either part is missing or invalid. */
export function localDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const dt = new Date(y!, m! - 1, d!, hh!, mm!, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function singleSlot(provider: string, date: string, time: string, minutes: number): NewSlot | null {
  const start = localDateTime(date, time);
  if (!start || !provider.trim() || minutes <= 0) return null;
  const end = new Date(start.getTime() + minutes * 60_000);
  return { id: slotId(provider.trim(), start), provider: provider.trim(), start: toIso(start), end: toIso(end) };
}

export interface ScheduleSpec {
  provider: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD, inclusive
  weekdays: number[]; // 0 = Sunday ... 6 = Saturday
  dayStart: string; // HH:MM
  dayEnd: string; // HH:MM, last slot must end by this time
  minutes: number; // slot length
  gap: number; // minutes between slots
}

export const MAX_SLOTS = 500;

/** Every slot the spec describes, earliest first. Stops at MAX_SLOTS + 1 so the UI can say "too many". */
export function generateSchedule(spec: ScheduleSpec): NewSlot[] {
  const provider = spec.provider.trim();
  const first = localDateTime(spec.from, "00:00");
  const last = localDateTime(spec.to, "00:00");
  if (!provider || !first || !last || last < first || spec.minutes <= 0 || spec.gap < 0 || spec.weekdays.length === 0) return [];
  const out: NewSlot[] = [];
  for (let day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
    if (!spec.weekdays.includes(day.getDay())) continue;
    const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const open = localDateTime(ymd, spec.dayStart);
    const close = localDateTime(ymd, spec.dayEnd);
    if (!open || !close || close <= open) continue;
    for (let t = open.getTime(); t + spec.minutes * 60_000 <= close.getTime(); t += (spec.minutes + spec.gap) * 60_000) {
      const start = new Date(t);
      out.push({ id: slotId(provider, start), provider, start: toIso(start), end: toIso(new Date(t + spec.minutes * 60_000)) });
      if (out.length > MAX_SLOTS) return out;
    }
  }
  return out;
}

/** The reviewers' demo timetable: 24 slots, two providers, 30-minute steps, 14 days out (as scripts/seed-demo.mjs). */
export function demoSlots(now = new Date()): NewSlot[] {
  const first = new Date(now);
  first.setUTCDate(first.getUTCDate() + 14);
  first.setUTCHours(9, 0, 0, 0);
  const providers = ["Dr Ade Okafor", "Dr Bisi Adeyemi"];
  return Array.from({ length: 24 }, (_, i) => {
    const start = new Date(first.getTime() + Math.floor(i / 12) * 86_400_000 + (i % 12) * 1_800_000);
    return { id: `demo-${String(i + 1).padStart(2, "0")}`, provider: providers[i % 2]!, start: toIso(start), end: toIso(new Date(start.getTime() + 1_800_000)) };
  });
}
