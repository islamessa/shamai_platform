import { looksLikeShare, normalizeShareText } from './fraction';
import { cleanText } from './hebrew';
import { normalizeIdType, padIdIfValid } from './israeliId';
import { rightEdge, toLines, type Line } from './layout';
import type { ExtractMeta, Issue, Owner, ParseResult, RawDocument, RawItem } from './types';

/*
 * Parser for a standard "נסח רישום מפנקס הזכויות" (Land Registry extract), as downloaded from the
 * Israeli Land Registry website. Principle: NEVER GUESS. Anything unexpected becomes an Issue,
 * so the file is flagged for review instead of producing silently wrong data.
 */

/** Section titles appear as a standalone line between double rules. */
export const SECTION_TITLES = [
  'תיאור הנכס',
  'בעלויות',
  'חכירות',
  'משכנתאות',
  'הערות',
  'זיקות הנאה',
  'שעבודים',
  'צווים',
  'הצמדות',
  'בית משותף',
  'תת חלקות',
  'סוף נתונים',
] as const;

const END_MARKER = 'סוף נתונים';
const SHARE_LABEL = 'החלק בנכס';
const NOTE_LABEL = 'הערות:';
const AREA_LABEL = 'שטח במ"ר';

/** Column labels of an owner block header row → field. */
const OWNER_COLUMNS: Record<string, keyof ColumnCells> = {
  "מס' שטר": 'deed',
  'תאריך': 'date',
  'מהות פעולה': 'action',
  'הבעלים': 'name',
  'סוג זיהוי': 'idType',
  "מס' זיהוי": 'idNumber',
};

interface ColumnCells {
  deed: string[][];
  date: string[][];
  action: string[][];
  name: string[][];
  idType: string[][];
  idNumber: string[][];
}

const POSITION_TOLERANCE = 3;

function issue(severity: Issue['severity'], code: string, message: string, ownerIndex?: number): Issue {
  return { severity, code, message, ownerIndex, source: 'parse' };
}

export function parseNesach(doc: RawDocument): ParseResult {
  const issues: Issue[] = [];
  const meta: ExtractMeta = {
    pdfTitle: doc.title,
    pageCount: doc.pages.length,
    sections: [],
    ownerHeaderCount: 0,
    shareLabelCount: 0,
    hasEndMarker: false,
    pageHeaders: [],
  };
  const fail = (code: string, message: string): ParseResult => ({
    ok: false,
    meta,
    issues: [...issues, issue('error', code, message)],
  });

  const charCount = doc.pages.reduce((n, p) => n + p.items.reduce((m, i) => m + i.str.length, 0), 0);
  if (doc.pages.length === 0 || charCount < 20) {
    return fail('NO_TEXT', 'לא נמצא טקסט בקובץ. כנראה נסח סרוק (תמונה); קריאת נסחים סרוקים (OCR) עדיין לא נתמכת.');
  }

  const pageLines = doc.pages.map((p) => toLines(p));
  const allText = pageLines.flat().map((l) => l.text).join('\n');
  if (!allText.includes('פנקס הזכויות')) {
    return fail('NOT_NESACH', 'הקובץ אינו נראה כנסח רישום מפנקס הזכויות (לא נמצאה הכותרת "העתק רישום מפנקס הזכויות").');
  }

  // ---- 1. page headers (repeated on every page) and footers -------------------------------
  const body: Line[] = [];
  let subParcelFound = false;
  pageLines.forEach((lines, idx) => {
    const pageNo = idx + 1;
    const headerIdx = lines.findIndex((l) => /גוש\s*:/.test(l.text) && /חלקה\s*:/.test(l.text));
    if (headerIdx < 0) {
      meta.pageHeaders.push({ page: pageNo });
      issues.push(issue('error', 'PAGE_HEADER_MISSING', `לא נמצאה כותרת גוש/חלקה בעמוד ${pageNo}.`));
    } else {
      const t = lines[headerIdx].text;
      const gush = /גוש\s*:\s*(\d+)/.exec(t)?.[1];
      const helka = /(?<!תת\s?)חלקה\s*:\s*(\d+)/.exec(t)?.[1];
      if (/תת\s*-?\s*חלקה\s*:/.test(t)) subParcelFound = true;
      meta.pageHeaders.push({ page: pageNo, gush, helka });
      if (pageNo === 1) {
        for (const l of lines.slice(0, headerIdx)) {
          meta.nesachNumber ??= /נסח מס'\s*(\d+)/.exec(l.text)?.[1];
          meta.issueDate ??= /תאריך\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(l.text)?.[1];
          meta.registryOffice ??= /לשכת רישום מקרקעין\s*:\s*(.+)$/.exec(l.text)?.[1]?.trim();
        }
      }
    }
    for (const l of lines.slice(headerIdx + 1)) {
      if (/^עמוד\s*\d+\s*מתוך\s*\d+$/.test(l.text)) continue; // footer
      body.push(l);
    }
  });

  const first = meta.pageHeaders[0];
  if (!first?.gush || !first?.helka) {
    return fail('GUSH_HELKA_MISSING', 'לא ניתן לקרוא גוש וחלקה מכותרת הנסח.');
  }
  for (const h of meta.pageHeaders.slice(1)) {
    if (h.gush && (h.gush !== first.gush || h.helka !== first.helka)) {
      issues.push(
        issue('error', 'HEADER_MISMATCH', `בעמוד ${h.page} מופיעים גוש ${h.gush} חלקה ${h.helka}, שונים מעמוד 1 (${first.gush}/${first.helka}).`),
      );
    }
  }
  if (subParcelFound) {
    issues.push(issue('error', 'UNSUPPORTED_CONDO', 'נסח בית משותף (תת-חלקה) עדיין לא נתמך. יש לבדוק ידנית.'));
  }

  // ---- 2. split body into sections ----------------------------------------------------------
  const sections = new Map<string, Line[]>();
  let current = '__preamble__';
  sections.set(current, []);
  for (const l of body) {
    const title = l.items.length === 1 ? (SECTION_TITLES as readonly string[]).find((s) => s === l.text) : undefined;
    if (title) {
      meta.sections.push(title);
      if (title === END_MARKER) {
        meta.hasEndMarker = true;
        break; // everything after "סוף נתונים" is the signature/fee notice
      }
      current = title;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)!.push(l);
  }
  if (!meta.hasEndMarker) {
    issues.push(issue('error', 'END_MARKER_MISSING', 'לא נמצא "סוף נתונים" בסוף הנסח. ייתכן שהקובץ חלקי.'));
  }
  if (meta.sections.includes('חכירות')) {
    issues.push(issue('error', 'UNSUPPORTED_LEASE', 'הנסח כולל פרק חכירות, שעדיין לא נתמך. יש לבדוק ידנית.'));
  }
  if (meta.sections.includes('משכנתאות')) {
    issues.push(issue('info', 'HAS_MORTGAGES', 'בנסח רשומות משכנתאות (אינן משפיעות על טבלת הבעלות).'));
  }
  if (meta.sections.includes('הערות')) {
    issues.push(issue('info', 'HAS_NOTES', 'בנסח רשומות הערות (אינן משפיעות על טבלת הבעלות).'));
  }

  // ---- 3. registered area ("תיאור הנכס" → column "שטח במ"ר") --------------------------------
  const registeredArea = parseArea(sections.get('תיאור הנכס') ?? [], issues);

  // ---- 4. owners ("בעלויות") ------------------------------------------------------------------
  const ownerLines = sections.get('בעלויות');
  if (!ownerLines || ownerLines.length === 0) {
    return fail('NO_OWNERS_SECTION', 'לא נמצא פרק "בעלויות" בנסח.');
  }
  const owners = parseOwners(ownerLines, meta, issues);

  // Independent count check (does not reuse the block logic): every "החלק בנכס" label must have a
  // share value printed directly under it, and their number must equal the number of owners read.
  const shareValueCount = countSharesUnderLabels(ownerLines);
  if (meta.shareLabelCount !== owners.length || shareValueCount !== owners.length) {
    issues.push(
      issue(
        'error',
        'OWNER_COUNT_MISMATCH',
        `מספר הבעלים שנקראו (${owners.length}) אינו תואם למספר השדות "החלק בנכס" (${meta.shareLabelCount}) או לערכי החלקים (${shareValueCount}) בנסח.`,
      ),
    );
  }

  // ---- 5. PDF title metadata cross-check (Land Registry sets Title = "<gush>_<helka>") ------
  const tm = /^(\d+)_(\d+)/.exec(doc.title ?? '');
  if (tm && (tm[1] !== first.gush || tm[2] !== first.helka)) {
    issues.push(
      issue('warning', 'TITLE_MISMATCH', `כותרת קובץ ה-PDF (${doc.title}) אינה תואמת לגוש/חלקה שנקראו (${first.gush}/${first.helka}).`),
    );
  }

  return {
    ok: true,
    meta,
    issues,
    data: {
      gush: first.gush,
      helka: first.helka,
      registeredArea,
      planArea: registeredArea,
      owners,
    },
  };
}

/** Max vertical distance (pt) between the "החלק בנכס" label and its value. */
const SHARE_BELOW_LABEL_MAX = 30;

function countSharesUnderLabels(lines: Line[]): number {
  const all = lines.flatMap((l) => l.items.map((it) => ({ it, page: l.page })));
  const labels = all.filter((a) => a.it.str === SHARE_LABEL);
  return labels.filter((lab) =>
    all.some(
      (a) =>
        a.page === lab.page &&
        looksLikeShare(a.it.str) &&
        Math.abs(rightEdge(a.it) - rightEdge(lab.it)) <= POSITION_TOLERANCE &&
        a.it.y > lab.it.y &&
        a.it.y - lab.it.y <= SHARE_BELOW_LABEL_MAX,
    ),
  ).length;
}

function parseArea(lines: Line[], issues: Issue[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].items.find((it) => it.str === AREA_LABEL);
    if (!label) continue;
    const r = rightEdge(label);
    const values: string[] = [];
    for (const l of lines.slice(i + 1)) {
      for (const it of l.items) {
        if (Math.abs(rightEdge(it) - r) <= POSITION_TOLERANCE && /^[\d,]+(\.\d+)?$/.test(it.str)) values.push(it.str);
      }
    }
    if (values.length === 0) break;
    if (values.length > 1) {
      issues.push(issue('error', 'AREA_MULTIPLE', `נמצאו כמה ערכי שטח (${values.join(', ')}). יש לבדוק ידנית.`));
    }
    return Number(values[0].replace(/,/g, ''));
  }
  issues.push(issue('error', 'AREA_MISSING', 'לא נמצא שטח החלקה (שטח במ"ר) בפרק "תיאור הנכס".'));
  return null;
}

interface Column {
  field: keyof ColumnCells;
  right: number;
  left: number;
}

function parseOwners(lines: Line[], meta: ExtractMeta, issues: Issue[]): Owner[] {
  const owners: Owner[] = [];
  let i = 0;

  const isHeaderLine = (l: Line) => l.items.some((it) => it.str === 'הבעלים') && l.items.some((it) => it.str === "מס' שטר");

  // text before the first owner header is unexpected
  while (i < lines.length && !isHeaderLine(lines[i])) {
    issues.push(issue('error', 'UNEXPECTED_TEXT', `טקסט לא צפוי בפרק הבעלויות: "${lines[i].text}"`));
    i++;
  }

  while (i < lines.length) {
    const header = lines[i];
    meta.ownerHeaderCount++;
    const ownerIndex = owners.length;
    const columns = buildColumns(header.items, ownerIndex, issues);
    i++;
    const blockLines: Line[] = [];
    while (i < lines.length && !isHeaderLine(lines[i])) blockLines.push(lines[i++]);

    const cells: ColumnCells = { deed: [], date: [], action: [], name: [], idType: [], idNumber: [] };
    let shareLabels = 0;
    let shareLabelRight = 0;
    let share: string | undefined;
    let noteMode = false;
    const noteParts: string[] = [];

    for (const line of blockLines) {
      const perField = new Map<keyof ColumnCells, string[]>();
      for (const it of line.items) {
        const t = it.str;
        if (t === SHARE_LABEL) {
          shareLabels++;
          shareLabelRight = rightEdge(it);
          meta.shareLabelCount++;
          continue;
        }
        // the share value is printed directly under its label, in the same column
        if (
          looksLikeShare(t) &&
          shareLabels > 0 &&
          share === undefined &&
          Math.abs(rightEdge(it) - shareLabelRight) <= POSITION_TOLERANCE
        ) {
          share = normalizeShareText(t);
          continue;
        }
        if (t.startsWith(NOTE_LABEL)) {
          noteMode = true;
          const rest = t.slice(NOTE_LABEL.length).trim();
          if (rest) noteParts.push(rest);
          continue;
        }
        if (noteMode) {
          noteParts.push(t);
          continue;
        }
        const col = columns.find((c) => rightEdge(it) <= c.right + POSITION_TOLERANCE && rightEdge(it) > c.left + POSITION_TOLERANCE);
        if (!col) {
          issues.push(issue('error', 'UNASSIGNED_TEXT', `טקסט לא מזוהה בבלוק בעלים ${ownerIndex + 1}: "${t}"`, ownerIndex));
          continue;
        }
        if (!perField.has(col.field)) perField.set(col.field, []);
        perField.get(col.field)!.push(t);
      }
      for (const [field, parts] of perField) cells[field].push(parts);
    }

    const joined = (f: keyof ColumnCells) => cleanText(cells[f].map((p) => p.join(' ')).join(' '));
    const hasCol = (f: keyof ColumnCells) => columns.some((c) => c.field === f);

    if (shareLabels !== 1) {
      issues.push(issue('error', 'SHARE_LABEL_COUNT', `בבלוק בעלים ${ownerIndex + 1} נמצאו ${shareLabels} שדות "החלק בנכס" (צפוי 1).`, ownerIndex));
    }
    if (share === undefined) {
      issues.push(issue('error', 'SHARE_MISSING', `לא נמצא "החלק בנכס" עבור בעלים ${ownerIndex + 1}.`, ownerIndex));
    }
    const idType = hasCol('idType') ? joined('idType') : '';
    let idNumber = hasCol('idNumber') ? joined('idNumber').replace(/\s+/g, '') : '';
    if (hasCol('idNumber') && !idNumber) {
      issues.push(issue('error', 'ID_EMPTY', `לבעלים ${ownerIndex + 1} יש עמודת מספר זיהוי אך היא ריקה.`, ownerIndex));
    }
    const padded = padIdIfValid(idNumber);
    if (padded) {
      issues.push(
        issue(
          'warning',
          'ID_PADDED',
          `בעלים ${ownerIndex + 1}: מספר הזיהוי מופיע בנסח כ-${idNumber} (ללא אפסים מובילים). הושלם ל-${padded}; ספרת הביקורת תקינה.`,
          ownerIndex,
        ),
      );
      idNumber = padded;
    }

    owners.push({
      name: joined('name'),
      idType: idType ? normalizeIdType(idType) : null,
      idNumber: idNumber || null,
      share: share ?? '',
      deed: joined('deed') || undefined,
      date: joined('date') || undefined,
      action: joined('action') || undefined,
      note: noteParts.length ? cleanText(noteParts.join(' ')) : undefined,
    });
  }
  return owners;
}

/** Column x-ranges from a header row. Cells are right-aligned (RTL), so a value's right edge matches its header's. */
function buildColumns(headerItems: RawItem[], ownerIndex: number, issues: Issue[]): Column[] {
  const cols: Array<{ field: keyof ColumnCells; right: number }> = [];
  for (const it of headerItems) {
    const field = OWNER_COLUMNS[it.str];
    if (field) cols.push({ field, right: rightEdge(it) });
    else issues.push(issue('error', 'UNKNOWN_COLUMN', `עמודה לא מוכרת בבלוק בעלים ${ownerIndex + 1}: "${it.str}"`, ownerIndex));
  }
  cols.sort((a, b) => b.right - a.right);
  const gaps = cols.slice(1).map((c, k) => cols[k].right - c.right);
  const maxWidth = gaps.length ? Math.max(...gaps) : 120;
  return cols.map((c, k) => ({
    ...c,
    left: k + 1 < cols.length ? cols[k + 1].right : c.right - maxWidth,
  }));
}
