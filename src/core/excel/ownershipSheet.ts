import ExcelJS from 'exceljs';
import { parseShare, sum, toNumber, type Fraction } from '../fraction';
import type { ParcelData } from '../types';

/*
 * Builds the "בעלות" sheet exactly like the office template:
 *   B2:J2  "תכנית ____"                 (Arial 12 bold)
 *   B3:J3  "בעלות לפי נסח טאבו עדכני"     (Arial 11 bold)
 *   row 4  yellow header
 *   rows 5..4+N  one row per owner; B..E (גוש, חלקה, שטח רשום, שטח בתכנית) merged vertically down to the total row
 *   I = share as a live formula (=970/10000), J = I×$E$5, total row with SUM formulas.
 * Sheet direction AND every cell's reading order are right-to-left.
 */

export interface OwnershipOptions {
  /** plan number for the title; empty → "תכנית _______" */
  planNumber?: string;
}

const FONT = 'Arial';
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};
const TEXT_COLOR = { theme: 1 } as unknown as Partial<ExcelJS.Color>;
const YELLOW: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

const HEADERS: Array<[col: string, label: string, wrap: boolean]> = [
  ['B', 'גוש', true],
  ['C', 'חלקה', false],
  ['D', 'שטח חלקה רשום במ"ר', true],
  ['E', 'שטח בתכנית במ"ר', true],
  ['F', 'שם בעלים רשום', true],
  ['G', "מס' זהות", true],
  ['H', 'החלקים בבעלות', true],
  ['I', 'שווי יחסי ב%', true],
  ['J', 'שטח במ"ר', true],
];
const COLUMN_WIDTHS: Record<string, number> = { B: 4.625, C: 6.375, D: 10.5, E: 11.875, F: 16.375, G: 10.5, H: 12.125, I: 9.625, J: 9.625 };
const COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export function titleText(planNumber?: string): string {
  const p = planNumber?.trim();
  return `תכנית ${p ? p : '_______'}`;
}

export function outputFileName(d: Pick<ParcelData, 'gush' | 'helka'>): string {
  return `גוש_${d.gush}_חלקה_${d.helka}.xlsx`;
}

/** Shares as Excel formula text, e.g. "970/10000"; "בשלמות" → "1/1". */
function shareFormula(share: string): { formula: string; value: number } {
  const f = parseShare(share);
  if (!f) return { formula: '0', value: 0 };
  return { formula: `${f.num}/${f.den}`, value: toNumber(f) };
}

function style(
  cell: ExcelJS.Cell,
  opts: { bold?: boolean; size?: number; color?: boolean; h?: ExcelJS.Alignment['horizontal']; v?: ExcelJS.Alignment['vertical']; wrap?: boolean; numFmt?: string; fill?: ExcelJS.Fill },
) {
  cell.font = { name: FONT, size: opts.size ?? 11, bold: opts.bold || undefined, ...(opts.color === false ? {} : { color: TEXT_COLOR }) };
  cell.alignment = {
    horizontal: opts.h,
    vertical: opts.v,
    wrapText: opts.wrap || undefined,
    readingOrder: 'rtl',
  };
  cell.border = THIN;
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.fill) cell.fill = opts.fill;
}

export function addOwnershipSheet(wb: ExcelJS.Workbook, d: ParcelData, opts: OwnershipOptions = {}, sheetName = 'בעלות'): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName, { views: [{ rightToLeft: true }] });
  for (const [col, w] of Object.entries(COLUMN_WIDTHS)) ws.getColumn(col).width = w;

  const n = d.owners.length;
  const first = 5;
  const last = first + n - 1;
  const total = last + 1;
  const planArea = d.planArea ?? d.registeredArea ?? 0;

  // titles
  ws.mergeCells('B2:J2');
  ws.mergeCells('B3:J3');
  ws.getCell('B2').value = titleText(opts.planNumber);
  ws.getCell('B3').value = 'בעלות לפי נסח טאבו עדכני';
  for (const c of COLS) {
    style(ws.getCell(`${c}2`), { bold: true, size: 12, h: 'center' });
    style(ws.getCell(`${c}3`), { bold: true, h: 'center' });
  }
  ws.getRow(2).height = 15.75;
  ws.getRow(3).height = 15;

  // header
  for (const [col, label, wrap] of HEADERS) {
    const cell = ws.getCell(`${col}4`);
    cell.value = label;
    style(cell, { bold: true, color: false, h: 'center', v: 'middle', wrap, fill: YELLOW });
  }
  ws.getRow(4).height = 37.5;

  // owners
  d.owners.forEach((o, k) => {
    const r = first + k;
    const share = shareFormula(o.share);
    ws.getCell(`F${r}`).value = o.name;
    ws.getCell(`G${r}`).value = o.idNumber ?? '-';
    ws.getCell(`H${r}`).value = o.share;
    ws.getCell(`I${r}`).value = { formula: share.formula, result: share.value };
    ws.getCell(`J${r}`).value = { formula: `I${r}*$E$${first}`, result: share.value * planArea };
    for (const c of COLS) style(ws.getCell(`${c}${r}`), { v: 'middle' });
    ws.getCell(`F${r}`).alignment = { ...ws.getCell(`F${r}`).alignment, wrapText: true };
    ws.getCell(`G${r}`).numFmt = '@';
    ws.getCell(`H${r}`).numFmt = '@';
    ws.getCell(`I${r}`).numFmt = '0.0%';
    ws.getCell(`J${r}`).numFmt = '0.0';
    ws.getRow(r).height = 16.5;
  });

  // total row
  // cached total from exact fraction arithmetic (avoids 0.9999999999999999 from float addition)
  const fractions = d.owners.map((o) => parseShare(o.share)).filter((f): f is Fraction => f !== null);
  const shareSum = toNumber(sum(fractions));
  ws.getCell(`F${total}`).value = 'סה"כ';
  ws.getCell(`I${total}`).value = { formula: `SUM(I${first}:I${last})`, result: shareSum };
  ws.getCell(`J${total}`).value = { formula: `SUM(J${first}:J${last})`, result: shareSum * planArea };
  for (const c of COLS) style(ws.getCell(`${c}${total}`), { v: 'middle', bold: ['F', 'I', 'J'].includes(c) });
  ws.getCell(`I${total}`).numFmt = '0.0%';
  ws.getCell(`J${total}`).numFmt = '0.0';
  ws.getRow(total).height = 15;

  // parcel columns merged vertically across all owner rows + the total row
  const parcel: Array<[string, number | string | null]> = [
    ['B', toNumberIfDigits(d.gush)],
    ['C', toNumberIfDigits(d.helka)],
    ['D', d.registeredArea],
    ['E', planArea],
  ];
  for (const [col, value] of parcel) {
    ws.mergeCells(`${col}${first}:${col}${total}`);
    const cell = ws.getCell(`${col}${first}`);
    cell.value = value;
    style(cell, { h: 'center', v: 'middle' });
  }
  return ws;
}

function toNumberIfDigits(s: string): number | string {
  return /^\d+$/.test(s) ? Number(s) : s;
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Shamai Platform';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

export async function buildOwnershipWorkbook(d: ParcelData, opts: OwnershipOptions = {}): Promise<Uint8Array> {
  const wb = newWorkbook();
  addOwnershipSheet(wb, d, opts);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
