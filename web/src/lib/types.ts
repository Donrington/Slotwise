export interface Slot {
  id: string;
  provider: string;
  start: string;
  end: string;
}
export interface SlotWithAvailability extends Slot {
  available: boolean;
}
export interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
}
export interface BookingPage {
  bookings: Booking[];
  next_cursor: string | null;
}
