import type { Issue } from './types';

/*
 * Batch-level checks: the same extract uploaded twice, or two different extracts of the same parcel.
 * Pure functions (no DOM), so they are unit-tested directly.
 */

export interface BatchItem {
  id: string;
  fileName: string;
  nesachNumber?: string;
  issueDate?: string;
  gush?: string;
  helka?: string;
}

export interface BatchInfo {
  /** set when this file is an identical copy of an earlier file in the batch (same נסח) */
  duplicateOf?: BatchItem;
  /** other files in the batch with the same גוש/חלקה but a different נסח */
  sameParcel: BatchItem[];
}

const parcelKey = (i: BatchItem) => (i.gush && i.helka ? `${i.gush}/${i.helka}` : null);
/** An extract is identified by its number, parcel and issue date. Without a נסח number we never call files identical. */
const documentKey = (i: BatchItem) => (i.nesachNumber && parcelKey(i) ? `${i.nesachNumber}|${parcelKey(i)}|${i.issueDate ?? ''}` : null);

export function analyzeBatch(items: BatchItem[]): Map<string, BatchInfo> {
  const out = new Map<string, BatchInfo>(items.map((i) => [i.id, { sameParcel: [] }]));
  const firstByDocument = new Map<string, BatchItem>();
  const byParcel = new Map<string, BatchItem[]>();

  for (const item of items) {
    const doc = documentKey(item);
    if (doc) {
      const first = firstByDocument.get(doc);
      if (first) {
        out.get(item.id)!.duplicateOf = first;
        continue; // an identical copy does not count as "another extract of the parcel"
      }
      firstByDocument.set(doc, item);
    }
    const parcel = parcelKey(item);
    if (parcel) byParcel.set(parcel, [...(byParcel.get(parcel) ?? []), item]);
  }

  for (const group of byParcel.values()) {
    if (group.length < 2) continue;
    for (const item of group) out.get(item.id)!.sameParcel = group.filter((g) => g !== item);
  }
  return out;
}

/** Issues to show for a file, derived from the batch analysis. */
export function batchIssues(info: BatchInfo | undefined): Issue[] {
  if (!info) return [];
  const issues: Issue[] = [];
  if (info.duplicateOf) {
    const d = info.duplicateOf;
    issues.push({
      severity: 'warning',
      code: 'DUPLICATE_FILE',
      message: `קובץ כפול של "${d.fileName}" (אותו נסח${d.nesachNumber ? ` מס' ${d.nesachNumber}` : ''}). לא ייכלל בהורדה.`,
      source: 'parse',
    });
  }
  for (const other of info.sameParcel) {
    const details = [other.nesachNumber && `נסח מס' ${other.nesachNumber}`, other.issueDate && `מתאריך ${other.issueDate}`].filter(Boolean).join(' ');
    issues.push({
      severity: 'warning',
      code: 'SAME_PARCEL',
      message: `לאותה חלקה הועלה נסח נוסף: "${other.fileName}"${details ? ` (${details})` : ''}. ודאו שמשתמשים בנסח העדכני.`,
      source: 'parse',
    });
  }
  return issues;
}
