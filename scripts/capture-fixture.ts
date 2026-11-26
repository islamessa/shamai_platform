/**
 * Turns a REAL נסח PDF into an ANONYMIZED test fixture that is safe to commit.
 *
 *   npm run capture-fixture -- samples/private/nesach.pdf tests/fixtures/<name>
 *
 * Writes <name>.raw.json (pdf.js text items with geometry) and <name>.expected.json (parsed result).
 * - Owner names → fake names; ID numbers → fake IDs with the same "shape" (valid 9 digits, short-but-paddable,
 *   or short-and-invalid), so the same validation paths are exercised.
 * - Free text in sections other than the parcel description and the owners (notes, easements, mortgages; these
 *   may contain names of other people) → placeholder; numbers are kept.
 * - גוש/חלקה → fake numbers.
 * Text geometry is preserved (right edges stay aligned with their columns).
 * The script aborts if any original name or ID number is still present in the output.
 */
import { writeFileSync } from 'node:fs';
import { isValidIsraeliIdChecksum } from '../src/core/israeliId';
import { toLines } from '../src/core/layout';
import { parseNesach, SECTION_TITLES } from '../src/core/parseNesach';
import type { RawDocument, RawItem } from '../src/core/types';
import { loadRawDocumentFromFile } from '../tests/helpers/nodePdf';

const FAKE_NAMES = [
  'ישראלי ישראל', 'כהן דנה', 'לוי יוסף', 'מזרחי רונית', 'פרץ אברהם', 'ביטון מיכל', 'דהן משה', 'אברהם נועה',
  'פרידמן איתן', 'אזולאי שרה', 'גבאי עומר', 'חדד יעל', 'שלום דוד', 'עמר תמר', 'אוחיון רון', 'בן דוד ליאת',
];
/** Public bodies are not personal data, and keeping them exercises the "no ID" path. */
const KEEP_NAMES = new Set(['מדינת ישראל', 'רשות הפיתוח', 'קרן קיימת לישראל']);
/** Structural labels of the notes section that are kept as-is. */
const NOTE_LABELS = new Set([
  "מס' שטר", 'תאריך', 'מהות פעולה', 'שם המוטב', 'הערות:', 'החלק בנכס', 'סכום', 'על הבעלות של:',
  'מהות פעולה מקורית', 'בתנאי שטר מקורי', 'על כל הבעלים',
]);

/** A valid 9-digit fake ID that starts with 0 (exercises leading-zero preservation). */
function fakeId(k: number): string {
  const base = '0' + String(3141590 + k * 7).padStart(7, '0');
  for (let d = 0; d <= 9; d++) if (isValidIsraeliIdChecksum(base + d)) return base + d;
  throw new Error('unreachable');
}
/** A short fake ID that stays INVALID even after zero-padding (like old IDs without a check digit). */
function fakeInvalidShort(len: number, k: number): string {
  for (let n = 1234560 + k * 11; ; n++) {
    const s = String(n).slice(0, len).padStart(len, '1');
    if (!isValidIsraeliIdChecksum(s.padStart(9, '0'))) return s;
  }
}

/** Replaces the digits of e.g. "1/234560" with fake digits, keeping non-digit characters in place. */
function keepShape(printed: string, fakeDigits: string): string {
  let k = 0;
  return printed.replace(/\d/g, () => fakeDigits[k++] ?? '0');
}

async function main() {
  const [pdfPath, outBase] = process.argv.slice(2);
  if (!pdfPath || !outBase) {
    console.error('usage: capture-fixture <pdf> <out-base-path>');
    process.exit(1);
  }
  const raw = await loadRawDocumentFromFile(pdfPath);
  const real = parseNesach(raw);
  if (!real.ok || !real.data) throw new Error('cannot parse the real PDF; nothing to capture');

  const map = new Map<string, string>();
  const secrets: string[] = [];
  const padded = new Set(real.issues.filter((i) => i.code === 'ID_PADDED').map((i) => i.ownerIndex));
  real.data.owners.forEach((o, k) => {
    if (o.name && !KEEP_NAMES.has(o.name)) {
      map.set(o.name, FAKE_NAMES[k % FAKE_NAMES.length]);
      secrets.push(o.name);
    }
    if (o.idNumber) {
      const printed = padded.has(k) ? o.idNumber.replace(/^0+/, '') : o.idNumber;
      let fake: string;
      if (padded.has(k)) fake = fakeId(k).replace(/^0+/, '');
      else if (/^\d{9}$/.test(printed)) fake = fakeId(k);
      else if (/\D/.test(printed)) fake = keepShape(printed, fakeInvalidShort(printed.replace(/\D/g, '').length, k));
      else fake = fakeInvalidShort(printed.length, k);
      map.set(printed, fake);
      secrets.push(printed, o.idNumber);
    }
  });
  // the extract's serial number is not personal, but there is no reason to publish it either
  if (real.meta.nesachNumber) {
    map.set(real.meta.nesachNumber, '100001');
    secrets.push(real.meta.nesachNumber);
  }
  const fakeGush = '7001';
  const fakeHelka = String(100 + Number(real.data.helka) % 50);
  const { gush, helka } = real.data;

  // free text outside the parcel description and the owners (notes, easements, mortgages...) can name
  // other people (lawyers, lenders, beneficiaries), so it is replaced
  const noteItems = new Set<RawItem>();
  let section = '';
  for (const page of raw.pages) {
    const lines = toLines(page);
    const headerIdx = lines.findIndex((l) => /גוש\s*:/.test(l.text) && /חלקה\s*:/.test(l.text));
    for (const l of lines.slice(headerIdx + 1)) {
      if (l.items.length === 1 && (SECTION_TITLES as readonly string[]).includes(l.text)) {
        section = l.text;
        continue;
      }
      if (/^עמוד\s*\d+\s*מתוך\s*\d+$/.test(l.text)) continue; // page footer
      // after "סוף נתונים" only the fixed signature/fee notice follows
      if (section && !['תיאור הנכס', 'בעלויות', 'סוף נתונים'].includes(section)) for (const it of l.items) noteItems.add(it);
    }
  }

  const replaceItem = (it: RawItem): RawItem => {
    let str = map.get(it.str) ?? it.str;
    if (noteItems.has(it) && !NOTE_LABELS.has(str) && /[א-ת]/.test(str)) {
      str = str.startsWith('הערות:') ? 'הערות: טקסט' : 'טקסט';
    }
    str = str.split(gush).join(fakeGush);
    if (it.str === helka && it.y < 160) str = fakeHelka; // "חלקה: 18" in the page header
    if (str === it.str) return it;
    const w = Math.round(((it.w * str.length) / Math.max(1, it.str.length)) * 100) / 100;
    return { ...it, str, x: Math.round((it.x + it.w - w) * 100) / 100, w }; // keep the RIGHT edge
  };

  const anon: RawDocument = {
    title: raw.title?.replace(`${gush}_${helka}`, `${fakeGush}_${fakeHelka}`),
    pages: raw.pages.map((p) => ({ ...p, items: p.items.map(replaceItem) })),
  };

  const rawJson = JSON.stringify(anon, null, 1);
  const parsed = parseNesach(anon);
  const expectedJson = JSON.stringify({ ok: parsed.ok, data: parsed.data, meta: parsed.meta, issues: parsed.issues }, null, 1);
  for (const s of secrets) {
    if (rawJson.includes(s) || expectedJson.includes(s)) throw new Error('anonymization failed: a real value is still present');
  }
  writeFileSync(`${outBase}.raw.json`, rawJson + '\n');
  writeFileSync(`${outBase}.expected.json`, expectedJson + '\n');
  console.log(`wrote ${outBase}.{raw,expected}.json (${parsed.data?.owners.length} owners, anonymized)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
