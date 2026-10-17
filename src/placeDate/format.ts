// Text rules for place/date elements. Pure: no DOM, no fonts.

/** The text drawn for a place/date element: "<place>, <date>", or just the part that is given. */
export function formatPlaceDate(place: string, date: string): string {
  const p = place.trim();
  const d = date.trim();
  if (p && d) return `${p}, ${d}`;
  return p || d;
}

/** Whether a place/date element with these parts would show no text at all. */
export function isEmptyPlaceDate(place: string, date: string): boolean {
  return formatPlaceDate(place, date) === "";
}

const pad = (value: number, length: number) => String(value).padStart(length, "0");

/** `now`'s local date as DD.MM.YYYY. */
export function todayDdMmYyyy(now: Date): string {
  return `${pad(now.getDate(), 2)}.${pad(now.getMonth() + 1, 2)}.${pad(now.getFullYear(), 4)}`;
}

/**
 * Converts the value of an `<input type="date">` ("YYYY-MM-DD") to DD.MM.YYYY.
 * Anything else (an empty or incomplete input) gives "".
 */
export function isoToDdMmYyyy(iso: string): string {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/** Converts DD.MM.YYYY to the value of an `<input type="date">`; anything else gives "". */
export function ddMmYyyyToIso(date: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4,})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}
