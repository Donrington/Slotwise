export function readEnv(): { ok: true; baseUrl: string; apiKey: string } | { ok: false; missing: string[] } {
  const baseUrl = process.env.API_BASE_URL?.trim();
  const apiKey = process.env.API_KEY?.trim();
  const missing = [!baseUrl && "API_BASE_URL", !apiKey && "API_KEY"].filter(Boolean) as string[];
  if (missing.length || !baseUrl || !apiKey) return { ok: false, missing };
  return { ok: true, baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
