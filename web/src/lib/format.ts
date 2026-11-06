// All times are shown in the viewer's own locale and time zone.
const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((p) => p.type === type)?.value ?? "";

/** "09:00" plus the locale's day period ("AM") when it uses one. */
export function timeParts(iso: string): { hm: string; period: string } {
  const parts = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  return { hm: `${part(parts, "hour")}:${part(parts, "minute")}`, period: part(parts, "dayPeriod") };
}

export function dayParts(iso: string): { day: string; month: string; weekday: string } {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(d),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(d),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d),
  };
}

export const minutes = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 60000);

const timeFmt = () => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = () => new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

export const timeRange = (start: string, end: string) =>
  `${timeFmt().format(new Date(start))} to ${timeFmt().format(new Date(end))}`;
export const dayLabel = (iso: string) => dayFmt().format(new Date(iso));
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
export const fullWhen = (start: string, end: string) => `${dayLabel(start)}, ${timeRange(start, end)}`;
