export function EnvError({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-16 sm:px-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Configuration</p>
      <h1 className="mt-4 font-display text-5xl font-medium leading-none tracking-[-0.04em]">
        Slotwise is not <em className="font-serif font-normal">configured</em> yet.
      </h1>
      <p className="mt-6 text-lg text-muted">
        The server is missing <strong className="text-ink">{missing.join(", ")}</strong>. Add these environment variables (see{" "}
        <code className="font-mono text-base">.env.example</code>) and restart.
      </p>
    </main>
  );
}
