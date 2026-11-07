import type { ApiResult } from "./api";
import type { NewSlot } from "./schedule";

export interface AdminSlot {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
  booking: { id: string; name: string; email: string; created_at: string } | null;
}
export interface AdminBooking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
  slot: { provider: string; start: string; end: string };
}
export interface Overview {
  slots_total: number;
  slots_open_upcoming: number;
  bookings_confirmed: number;
  bookings_cancelled: number;
  providers: string[];
}

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/admin${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...(init?.method && init.method !== "GET" ? { "x-slotwise-admin": "1" } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* empty */
    }
    if (res.ok) return { ok: true, data: body as T };
    const error = (body as { error?: unknown } | null)?.error;
    return { ok: false, status: res.status, error: typeof error === "string" ? error : "Something went wrong" };
  } catch {
    return { ok: false, status: 0, error: "Network error" };
  }
}

export const signIn = async (password: string): Promise<ApiResult<{ ok: true }>> => {
  try {
    const res = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: body } : { ok: false, status: res.status, error: body?.error ?? "Sign-in failed" };
  } catch {
    return { ok: false, status: 0, error: "Network error" };
  }
};
export const signOut = () => fetch("/api/admin/session", { method: "DELETE" });

export const getOverview = () => call<Overview>("/overview");
export const getSlots = () => call<{ slots: AdminSlot[] }>("/slots");
export const addSlots = (slots: NewSlot[]) => call<{ added: number }>("/slots", { method: "POST", body: JSON.stringify({ slots }) });
export const deleteSlot = (id: string) => call<{ deleted: string }>(`/slots/${encodeURIComponent(id)}`, { method: "DELETE" });
export const cancelBooking = (id: string) => call<unknown>(`/bookings/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getBookings = (status: "all" | "confirmed" | "cancelled", cursor?: string) =>
  call<{ bookings: AdminBooking[]; next_cursor: string | null }>(
    `/bookings?limit=20${status === "all" ? "" : `&status=${status}`}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
export const resetTimetable = (slots: NewSlot[]) => call<{ ok: true; slots: number }>("/reset", { method: "POST", body: JSON.stringify({ slots }) });
