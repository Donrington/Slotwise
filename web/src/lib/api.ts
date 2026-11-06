import type { Booking, BookingPage, SlotWithAvailability } from "./types";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; retryAfter?: number };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api/clinic${path}`, { ...init, cache: "no-store" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (res.ok) return { ok: true, data: body as T };
    const error = (body as { error?: unknown } | null)?.error;
    const ra = Number(res.headers.get("retry-after"));
    return {
      ok: false,
      status: res.status,
      error: typeof error === "string" ? error : "Something went wrong",
      ...(Number.isFinite(ra) && ra > 0 ? { retryAfter: ra } : {}),
    };
  } catch {
    return { ok: false, status: 0, error: "Network error" };
  }
}

export const listSlots = (provider?: string) =>
  call<{ slots: SlotWithAvailability[] }>(`/slots${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`);

export const createBooking = (body: { slot_id: string; name: string; email: string }, idempotencyKey: string) =>
  call<Booking>("/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });

export const getBooking = (id: string) => call<Booking>(`/bookings/${encodeURIComponent(id)}`);

export const cancelBooking = (id: string) => call<Booking>(`/bookings/${encodeURIComponent(id)}`, { method: "DELETE" });

export const listBookings = (email: string, cursor?: string, limit = 10) =>
  call<BookingPage>(
    `/bookings?email=${encodeURIComponent(email)}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
