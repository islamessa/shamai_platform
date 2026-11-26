import { outputFileName } from '../core/excel/ownershipSheet';
import { parseNesach } from '../core/parseNesach';
import type { AuditEntry, FileStatus, Issue, ParcelData, ParseResult } from '../core/types';
import { autoStatus, validateData } from '../core/validate';
import { PdfReadError, readRawDocument } from './pdf';

export interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  parse?: ParseResult;
  /** data as read from the PDF (never modified) */
  original?: ParcelData;
  /** current data (may be edited in the review screen) */
  data?: ParcelData;
  /** parse issues + data issues of the current data */
  issues: Issue[];
  audit: AuditEntry[];
  overrideNote?: string;
  approvedAt?: string;
}

let counter = 0;
export function newEntry(file: File): FileEntry {
  return { id: `f${++counter}`, file, status: 'processing', issues: [], audit: [] };
}

/** Reads, parses and validates one PDF. Never throws: problems become a 'failed' status with a reason. */
export async function processEntry(e: FileEntry): Promise<FileEntry> {
  try {
    const raw = await readRawDocument(e.file);
    const parse = parseNesach(raw);
    const issues = [...parse.issues, ...(parse.data ? validateData(parse.data) : [])];
    return {
      ...e,
      parse,
      original: parse.data ? structuredClone(parse.data) : undefined,
      data: parse.data,
      issues,
      status: autoStatus(parse.ok, issues),
    };
  } catch (err) {
    const message = err instanceof PdfReadError ? err.message : `שגיאה לא צפויה: ${(err as Error)?.message ?? err}`;
    const code = err instanceof PdfReadError ? err.code : 'UNEXPECTED';
    return { ...e, status: 'failed', issues: [{ severity: 'error', code, message, source: 'parse' }] };
  }
}

export const isExportable = (e: FileEntry) => (e.status === 'ok' || e.status === 'approved') && !!e.data;

/**
 * Output file names. If the same parcel appears twice in a batch, later copies get " (2)", " (3)"...
 * so no file silently overwrites another inside the ZIP.
 */
export function outputNames(entries: FileEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  const used = new Map<string, number>();
  for (const e of entries) {
    if (!e.data) continue;
    const base = outputFileName(e.data);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    names.set(e.id, n === 1 ? base : base.replace(/\.xlsx$/, ` (${n}).xlsx`));
  }
  return names;
}

/** Field-level differences between the parsed data and the edited data, for the audit trail. */
export function diffData(before: ParcelData | undefined, after: ParcelData): AuditEntry[] {
  const time = new Date().toLocaleString('he-IL');
  const out: AuditEntry[] = [];
  const push = (field: string, a: unknown, b: unknown) => {
    const sa = a === null || a === undefined ? '' : String(a);
    const sb = b === null || b === undefined ? '' : String(b);
    if (sa !== sb) out.push({ time, field, before: sa, after: sb });
  };
  push('גוש', before?.gush, after.gush);
  push('חלקה', before?.helka, after.helka);
  push('שטח רשום', before?.registeredArea, after.registeredArea);
  push('שטח בתכנית', before?.planArea, after.planArea);
  const n = Math.max(before?.owners.length ?? 0, after.owners.length);
  for (let i = 0; i < n; i++) {
    const a = before?.owners[i];
    const b = after.owners[i];
    const label = `בעלים ${i + 1}`;
    if (!b) {
      out.push({ time, field: `${label} – נמחק`, before: `${a?.name} ${a?.idNumber ?? ''} ${a?.share}`, after: '' });
      continue;
    }
    if (!a) {
      out.push({ time, field: `${label} – נוסף`, before: '', after: `${b.name} ${b.idNumber ?? ''} ${b.share}` });
      continue;
    }
    push(`${label} – שם`, a.name, b.name);
    push(`${label} – סוג זיהוי`, a.idType, b.idType);
    push(`${label} – מס' זהות`, a.idNumber, b.idNumber);
    push(`${label} – החלק בנכס`, a.share, b.share);
  }
  return out;
}
