/**
 * Israeli ID (ת.ז) check digit. Also used for corporate numbers (ח.פ etc.), which follow the same scheme.
 * The number must be exactly 9 digits; we never pad silently. A short number is reported, not "fixed".
 */
export function isValidIsraeliIdChecksum(id: string): boolean {
  if (!/^\d{9}$/.test(id)) return false;
  let total = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * (i % 2 === 0 ? 1 : 2);
    if (d > 9) d -= 9;
    total += d;
  }
  return total % 10 === 0;
}

/**
 * Older extracts print IDs without leading zeros ("12345609" for 012345609).
 * Padding with zeros to 9 digits is the standard Israeli ID rule; we only accept the padded
 * value when its check digit is valid. Returns null when padding is not applicable or not valid.
 */
export function padIdIfValid(id: string): string | null {
  if (!/^\d{1,8}$/.test(id)) return null;
  const padded = id.padStart(9, '0');
  return isValidIsraeliIdChecksum(padded) ? padded : null;
}

/** Normalizes an ID type label: "ת.ז", "ת\"ז", "ת. ז" → "ת.ז". */
export function normalizeIdType(t: string): string {
  return t.replace(/\s+/g, '').replace(/["״׳']/g, '.').replace(/\.+/g, '.');
}

/** Personal ID types: 9 digits + valid check digit is mandatory. */
export const PERSONAL_ID_TYPES = new Set(['ת.ז']);

/** Corporate / registered-entity number types (9 digits mandatory; check digit failure is a warning). */
export const CORPORATE_ID_TYPES = new Set(['ח.פ', 'ח.צ', 'ע.ר', 'ש.מ', 'ש.ר', 'תאגיד', 'חברה', 'עמותה']);
