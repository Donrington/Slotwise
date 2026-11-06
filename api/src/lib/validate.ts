import { z } from "zod";
import { HttpError } from "./errors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

const field = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { error: `${name} is required` });

const bookingSchema = z.object({
  slot_id: field("slot_id"),
  name: field("name"),
  email: field("email")
    .transform((s) => s.toLowerCase())
    .refine(isValidEmail, { error: "email is invalid" }),
});

export type BookingInput = z.infer<typeof bookingSchema>;

export function parseBookingBody(body: unknown): BookingInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "body must be a JSON object");
  }
  const obj = body as Record<string, unknown>;
  // report the first problem in a stable field order
  for (const key of ["slot_id", "name", "email"] as const) {
    const r = bookingSchema.shape[key].safeParse(obj[key]);
    if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? `${key} is invalid`);
  }
  return bookingSchema.parse(obj);
}
