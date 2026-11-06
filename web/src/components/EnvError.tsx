export function EnvError({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-display text-3xl text-ink">Slotwise is not configured yet</h1>
      <p className="mt-3 text-muted">
        The server is missing: <strong>{missing.join(", ")}</strong>. Add these environment variables (see{" "}
        <code>.env.example</code>) and restart.
      </p>
    </main>
  );
}
