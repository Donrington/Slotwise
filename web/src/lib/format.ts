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
