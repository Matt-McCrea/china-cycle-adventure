import type { Stop } from "./types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
};

/** "9–11 OCT", "8 OCT", "30 SEP–2 OCT" */
export function dateRange(start: string, end: string = start): string {
  const a = parts(start), b = parts(end);
  if (start === end) return `${a.d} ${MONTHS[a.m]}`;
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS[a.m]}`;
  return `${a.d} ${MONTHS[a.m]}–${b.d} ${MONTHS[b.m]}`;
}

export const stopDates = (s: Stop) => dateRange(s.dateStart, s.dateEnd);

/** Screen-reader friendly: "9 to 11 October" */
export function dateRangeLong(start: string, end: string = start): string {
  const a = parts(start), b = parts(end);
  if (start === end) return `${a.d} ${MONTHS_LONG[a.m]}`;
  if (a.m === b.m) return `${a.d} to ${b.d} ${MONTHS_LONG[a.m]}`;
  return `${a.d} ${MONTHS_LONG[a.m]} to ${b.d} ${MONTHS_LONG[b.m]}`;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Round a measured distance and mark it approximate. */
export const approxKm = (km: number) =>
  `≈ ${(km >= 1000 ? Math.round(km / 10) * 10 : Math.round(km / 5) * 5).toLocaleString("en-GB")} km`;
