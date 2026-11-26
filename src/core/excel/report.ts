import ExcelJS from 'exceljs';
import { format, parseShare, sum } from '../fraction';
import { SEVERITY_LABEL, STATUS_LABEL } from '../labels';
import type { AuditEntry, FileStatus, Issue, ParcelData } from '../types';
import { newWorkbook } from './ownershipSheet';

/** One processed file, as summarized in the batch report ("דוח עיבוד"). */
export interface ReportRow {
  fileName: string;
  status: FileStatus;
  data?: ParcelData;
  issues: Issue[];
  outputName?: string;
  /** manual edits made in the review screen */
  audit: AuditEntry[];
  /** note entered when approving despite remaining errors */
  overrideNote?: string;
  approvedAt?: string;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const STATUS_FILL: Partial<Record<FileStatus, string>> = { ok: 'FFC6EFCE', approved: 'FFDDEBF7', review: 'FFFFEB9C', failed: 'FFFFC7CE' };

function sheet(wb: ExcelJS.Workbook, name: string, headers: Array<[string, number]>) {
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = headers.map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell((c) => {
    c.font = { name: 'Arial', bold: true };
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  });
  return ws;
}

export async function buildReportWorkbook(rows: ReportRow[], planNumber?: string): Promise<Uint8Array> {
  const wb = newWorkbook();

  const s = sheet(wb, 'סיכום', [
    ['#', 5], ['קובץ PDF', 28], ['סטטוס', 12], ['גוש', 8], ['חלקה', 8], ['שטח רשום במ"ר', 12],
    ["מס' בעלים", 9], ['סכום החלקים', 12], ['קובץ Excel', 26], ['פירוט (שגיאות / אזהרות / מידע)', 90],
  ]);
  rows.forEach((r, k) => {
    const shares = r.data?.owners.map((o) => parseShare(o.share)) ?? [];
    const total = shares.length && shares.every(Boolean) ? format(sum(shares as NonNullable<(typeof shares)[number]>[])) : '';
    const details = r.issues.map((i) => `[${SEVERITY_LABEL[i.severity]}] ${i.message}`);
    if (r.overrideNote) details.push(`[אישור ידני חרף שגיאות] ${r.overrideNote}`);
    const row = s.addRow([
      k + 1, r.fileName, STATUS_LABEL[r.status], r.data?.gush ?? '', r.data?.helka ?? '', r.data?.registeredArea ?? '',
      r.data?.owners.length ?? '', total, r.status === 'ok' || r.status === 'approved' ? r.outputName ?? '' : '(לא הופק)',
      details.join('\n'),
    ]);
    row.eachCell((c) => {
      c.font = { name: 'Arial' };
      c.alignment = { vertical: 'top', wrapText: true, readingOrder: 'rtl' };
    });
    const fill = STATUS_FILL[r.status];
    if (fill) row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  });
  s.addRow([]);
  s.addRow(['', `תכנית: ${planNumber?.trim() || '—'}`]);
  s.addRow(['', `הופק: ${new Date().toLocaleString('he-IL')}`]);
  s.addRow(['', 'הקבצים עובדו במחשב המשתמש בלבד ולא נשלחו לשום שרת.']);

  const a = sheet(wb, 'שינויים ידניים', [['קובץ PDF', 28], ['שדה', 24], ['לפני', 30], ['אחרי', 30], ['זמן', 20]]);
  for (const r of rows) {
    for (const e of r.audit) a.addRow([r.fileName, e.field, e.before, e.after, e.time]);
    if (r.overrideNote) a.addRow([r.fileName, 'אישור חרף שגיאות', '', r.overrideNote, r.approvedAt ?? '']);
  }
  a.eachRow((row, i) => {
    if (i > 1) row.eachCell((c) => (c.alignment = { wrapText: true, vertical: 'top', readingOrder: 'rtl' }));
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
