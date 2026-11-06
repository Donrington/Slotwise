import { expect, test } from "@playwright/test";

// Needs a running web app (WEB_URL) and the API it points at. API_BASE_URL and API_KEY are used
// only to seed slots directly; the browser only ever talks to the web app.
const API = process.env.API_BASE_URL!;
const KEY = process.env.API_KEY!;

test.beforeAll(async () => {
  const start = Date.now() + 24 * 3600 * 1000;
  const slots = Array.from({ length: 4 }, (_, i) => ({
    id: `e2e${i + 1}`,
    provider: "Dr Ade",
    start: new Date(start + i * 1800_000).toISOString(),
    end: new Date(start + (i + 1) * 1800_000).toISOString(),
  }));
  const res = await fetch(`${API}/reset`, {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ slots }),
  });
  expect(res.status).toBe(200);
});

test("list slots, book one, see the confirmation", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("[data-slot='e2e1'] button");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await card.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Smoke Test");
  await dialog.getByLabel("Email").fill(`smoke${Date.now()}@example.com`);
  await dialog.getByRole("button", { name: "Confirm booking" }).click();
  await expect(dialog.getByText("You are booked")).toBeVisible();
  await expect(dialog.getByText("Confirmed", { exact: true })).toBeVisible();
});
