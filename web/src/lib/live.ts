import type { SlotWithAvailability } from "./types";

// Live slot availability over Neon Realtime. The API seals a read-only query (POST /slots/live,
// reached through our proxy so the API key stays on the server); the browser subscribes to it.
// Any failure returns control to the caller, which keeps polling GET /slots.

type Sealed = { expiresAt: number };
const RENEW_EARLY_MS = 10_000;
const RETRY_MS = 1_000;

async function fetchSealed(): Promise<{ url: string; sealed: Sealed } | null> {
  try {
    const res = await fetch("/api/clinic/slots/live", { method: "POST", cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.url === "string" && body?.sealed ? body : null;
  } catch {
    return null;
  }
}

export interface LiveHandle {
  stop(): void;
}

/**
 * Starts a live subscription. Resolves to null when Realtime is unavailable. `onRows` receives the
 * full, ordered list on every committed change; `onLost` fires once if the subscription stops.
 */
export async function startLiveSlots(
  onRows: (rows: SlotWithAvailability[]) => void,
  onLost: () => void,
): Promise<LiveHandle | null> {
  const first = await fetchSealed();
  if (!first) return null;
  let client: import("@neon/realtime/client").RealtimeClient;
  let sub: import("@neon/realtime/client").MaterializedLiveQuerySubscription<SlotWithAvailability>;
  try {
    const { createRealtimeClient } = await import("@neon/realtime/client");
    client = createRealtimeClient({ url: first.url });
    sub = client.subscribe(first.sealed as never) as typeof sub;
  } catch {
    return null;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      sub.unsubscribe();
      client.close();
    } catch {
      /* already closed */
    }
  };

  // Sealed queries are short-lived: renew 10 s before expiry, retrying a failed fetch after 1 s.
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(renew, delay);
  };
  const scheduleBeforeExpiry = (expiresAt: number) => schedule(Math.max(0, expiresAt - Date.now() - RENEW_EARLY_MS));
  async function renew() {
    const next = await fetchSealed();
    if (!next) return schedule(RETRY_MS);
    scheduleBeforeExpiry(next.sealed.expiresAt);
    sub.renew(next.sealed as never).catch(() => {
      stop();
      onLost();
    });
  }
  scheduleBeforeExpiry(first.sealed.expiresAt);

  sub.onChange((snap) => {
    if (stopped) return;
    if (snap.status === "error") {
      stop();
      onLost();
      return;
    }
    if (snap.data && (snap.status === "live" || snap.status === "stale")) onRows([...snap.data]);
  });

  return { stop };
}
