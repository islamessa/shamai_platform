/** Bidi control characters that PDF text extractors sometimes insert. */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩؜]/g;

/** Normalizes text from the PDF: removes bidi controls, unifies quotes/spaces, trims. */
export function cleanText(s: string): string {
  return s
    .replace(BIDI_CONTROLS, '')
    .replace(/[  -​ ]/g, ' ')
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const FINAL_FOLLOWED_BY_LETTER = /[ךםןףץ][א-ת]/;

/**
 * Reversed-Hebrew guard. In correct (logical-order) Hebrew a final-form letter (ך ם ן ף ץ)
 * is never followed by another Hebrew letter inside a word. Reversed text such as "ןמלס"
 * (= "סלמן" backwards) breaks that rule, so we can detect it automatically.
 */
export function looksReversed(s: string): boolean {
  return FINAL_FOLLOWED_BY_LETTER.test(s);
}

export function hasHebrew(s: string): boolean {
  return /[א-ת]/.test(s);
}
