/**
 * Exact rational arithmetic with BigInt. Ownership shares must sum to exactly 1;
 * floating point (0.1 + 0.2 !== 0.3) is not acceptable for legal data.
 */
export interface Fraction {
  num: bigint;
  den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function reduce(f: Fraction): Fraction {
  if (f.den === 0n) throw new Error('denominator is zero');
  const g = gcd(f.num, f.den) || 1n;
  const sign = f.den < 0n ? -1n : 1n;
  return { num: (sign * f.num) / g, den: (sign * f.den) / g };
}

export function add(a: Fraction, b: Fraction): Fraction {
  return reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
}

export function sum(fs: Fraction[]): Fraction {
  return fs.reduce(add, { num: 0n, den: 1n });
}

export function isOne(f: Fraction): boolean {
  const r = reduce(f);
  return r.num === 1n && r.den === 1n;
}

export function toNumber(f: Fraction): number {
  return Number(f.num) / Number(f.den);
}

export function format(f: Fraction): string {
  return `${f.num}/${f.den}`;
}

const SHARE_RE = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

/** Older extracts print "בשלמות" (whole ownership) instead of a fraction. It means 1/1. */
export const WHOLE_SHARE = 'בשלמות';

/**
 * True if the text looks like a share ("970 / 10000", "1/2", "בשלמות").
 * NOTE: old-style deed numbers ("5097/1979") also match, so callers must use position too.
 */
export function looksLikeShare(text: string): boolean {
  return SHARE_RE.test(text) || text.trim() === WHOLE_SHARE;
}

/** Parses "970 / 10000" → {970n, 10000n} without reducing (we keep the registry's own denominator). */
export function parseShare(text: string): Fraction | null {
  if (text.trim() === WHOLE_SHARE) return { num: 1n, den: 1n };
  const m = SHARE_RE.exec(text);
  if (!m) return null;
  const num = BigInt(m[1]);
  const den = BigInt(m[2]);
  if (den === 0n) return null;
  return { num, den };
}

/** Normalizes "970 / 10000" → "970/10000" (the template's text format). "בשלמות" is kept as printed. */
export function normalizeShareText(text: string): string {
  if (text.trim() === WHOLE_SHARE) return WHOLE_SHARE;
  const f = parseShare(text);
  return f ? `${f.num}/${f.den}` : text.trim();
}
