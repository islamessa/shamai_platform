import JSZip from 'jszip';
import { buildOwnershipWorkbook } from '../core/excel/ownershipSheet';
import { buildReportWorkbook, type ReportRow } from '../core/excel/report';
import { isExportable, outputNames, type FileEntry } from './state';

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

export function reportRows(entries: FileEntry[]): ReportRow[] {
  const names = outputNames(entries);
  return entries.map((e) => {
    const outputName = names.get(e.id);
    const issues = [...e.issues];
    if (outputName && / \(\d+\)\.xlsx$/.test(outputName)) {
      issues.push({ severity: 'info', code: 'DUPLICATE_PARCEL', message: 'חלקה זו מופיעה ביותר מקובץ אחד בקבוצה.', source: 'parse' });
    }
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

export async function downloadOne(e: FileEntry, entries: FileEntry[], planNumber: string) {
  if (!isExportable(e)) return;
  const name = outputNames(entries).get(e.id)!;
  saveFile(await buildOwnershipWorkbook(e.data!, { planNumber }), name);
}

export async function downloadReport(entries: FileEntry[], planNumber: string) {
  saveFile(await buildReportWorkbook(reportRows(entries), planNumber), REPORT_NAME);
}

/** ZIP with one Excel per exportable file (ok / approved) + the processing report. */
export async function downloadZip(entries: FileEntry[], planNumber: string, onProgress?: (done: number, total: number) => void) {
  const zip = new JSZip();
  const names = outputNames(entries);
  const exportable = entries.filter(isExportable);
  let done = 0;
  for (const e of exportable) {
    zip.file(names.get(e.id)!, await buildOwnershipWorkbook(e.data!, { planNumber }));
    onProgress?.(++done, exportable.length);
    await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive on big batches
  }
  zip.file(REPORT_NAME, await buildReportWorkbook(reportRows(entries), planNumber));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const stamp = new Date().toISOString().slice(0, 10);
  saveFile(blob, `בעלות_מנסחים_${stamp}.zip`, 'application/zip');
}
