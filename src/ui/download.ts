import JSZip from 'jszip';
import { buildOwnershipWorkbook } from '../core/excel/ownershipSheet';
import { buildReportWorkbook, type ReportRow } from '../core/excel/report';
import { batchIssues, type BatchInfo } from '../core/batch';
import { analyzeEntries, exportList, isExportable, outputNames, type FileEntry } from './state';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const REPORT_NAME = 'דוח_עיבוד.xlsx';

/** Saves bytes as a file download. Everything is generated locally; nothing is uploaded. */
export function saveFile(bytes: Uint8Array | Blob, name: string, type = XLSX) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** All issues of a file, including batch-level ones (duplicates, same parcel twice). */
function fileIssues(e: FileEntry, analysis = new Map<string, BatchInfo>()) {
  return [...e.issues, ...batchIssues(analysis.get(e.id))];
}

export function reportRows(entries: FileEntry[]): ReportRow[] {
  const analysis = analyzeEntries(entries);
  const names = outputNames(entries, analysis);
  return entries.map((e) => {
    const outputName = isExportable(e) ? names.get(e.id) : undefined;
    const issues = fileIssues(e, analysis);
    return {
      fileName: e.file.name,
      status: e.status,
      data: e.data,
      issues,
      outputName,
      audit: e.audit,
      overrideNote: e.overrideNote,
      approvedAt: e.approvedAt,
    };
  });
}

export interface ExportOptions {
  planNumber: string;
  /** mark problem cells inside the Excel (note + colour) */
  markIssues: boolean;
}

export async function downloadOne(e: FileEntry, entries: FileEntry[], o: ExportOptions) {
  const analysis = analyzeEntries(entries);
  const name = outputNames(entries, analysis).get(e.id);
  if (!isExportable(e) || !name) return;
  saveFile(await buildOwnershipWorkbook(e.data!, { planNumber: o.planNumber, issues: o.markIssues ? fileIssues(e, analysis) : undefined }), name);
}

export async function downloadReport(entries: FileEntry[], o: ExportOptions) {
  saveFile(await buildReportWorkbook(reportRows(entries), o.planNumber), REPORT_NAME);
}

/** ZIP with one Excel per file that was read (identical copies excluded) + the processing report. */
export async function downloadZip(entries: FileEntry[], o: ExportOptions, onProgress?: (done: number, total: number) => void) {
  const { planNumber } = o;
  const zip = new JSZip();
  const analysis = analyzeEntries(entries);
  const names = outputNames(entries, analysis);
  const exportable = exportList(entries, analysis);
  let done = 0;
  for (const e of exportable) {
    zip.file(names.get(e.id)!, await buildOwnershipWorkbook(e.data!, { planNumber, issues: o.markIssues ? fileIssues(e, analysis) : undefined }));
    onProgress?.(++done, exportable.length);
    await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive on big batches
  }
  zip.file(REPORT_NAME, await buildReportWorkbook(reportRows(entries), planNumber));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().slice(0, 10);
  saveFile(blob, `בעלות_מנסחים_${stamp}.zip`, 'application/zip');
}
