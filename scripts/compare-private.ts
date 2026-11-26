/**
 * LOCAL ONLY (real data never leaves samples/private/, which is git-ignored).
 *
 *   npm run compare:private
 *
 * 1. Runs the full pipeline on every samples/private/*.pdf and writes the Excel files to samples/private/out/.
 * 2. For every samples/private/expected_<gush>_<helka>.xlsx, compares our "בעלות" sheet with the office's
 *    hand-made one, cell by cell: values, formulas, number formats, fonts, fills, borders, merges, sizes.
 * Exits with code 1 on any unexpected difference.
 */
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildOwnershipWorkbook, outputFileName } from '../src/core/excel/ownershipSheet';
import { parseNesach } from '../src/core/parseNesach';
import { autoStatus, validateData } from '../src/core/validate';
import { loadRawDocumentFromFile } from '../tests/helpers/nodePdf';

const DIR = 'samples/private';
const OUT = join(DIR, 'out');
const COLS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** Differences we introduce on purpose. */
const ALLOWED = [
  'readingOrder', // the user asked for right-to-left cell direction (template has "context")
];

function describeCell(c: ExcelJS.Cell) {
  const v = c.value as unknown;
  const value =
    v && typeof v === 'object' && 'formula' in (v as object)
      ? `=${(v as { formula: string }).formula}`
      : v && typeof v === 'object' && 'sharedFormula' in (v as object)
        ? `=<shared>`
        : v ?? null;
  const fill = c.fill && c.fill.type === 'pattern' && c.fill.pattern === 'solid' ? (c.fill.fgColor?.argb ?? 'theme') : null;
  return {
    value: typeof value === 'string' ? value.replace(/^=/, '=').trim() : value,
    numFmt: c.numFmt && c.numFmt !== 'General' ? c.numFmt : null,
    bold: !!c.font?.bold,
    size: c.font?.size ?? null,
    fontName: c.font?.name ?? null,
    fill,
    border: ['top', 'left', 'bottom', 'right'].map((s) => (c.border as Record<string, { style?: string }> | undefined)?.[s]?.style ?? '-').join(','),
    hAlign: c.alignment?.horizontal ?? null,
    vAlign: c.alignment?.vertical === 'middle' ? 'center' : (c.alignment?.vertical ?? null),
    readingOrder: c.alignment?.readingOrder ?? null,
  };
}

async function compare(ours: ExcelJS.Worksheet, theirs: ExcelJS.Worksheet): Promise<string[]> {
  const diffs: string[] = [];
  const lastRow = Math.max(ours.rowCount, theirs.rowCount);
  for (let r = 2; r <= lastRow; r++) {
    for (const col of COLS) {
      const ca = ours.getCell(`${col}${r}`);
      const cb = theirs.getCell(`${col}${r}`);
      // cells hidden under a merge (not the top-left "master") are invisible; skip them
      if (ca.isMerged && ca.master.address !== ca.address && cb.isMerged && cb.master.address !== cb.address) continue;
      const a = describeCell(ca);
      const b = describeCell(cb);
      // a numeric format on a text cell has no visible effect (the template has "0.000" on some name cells)
      if (typeof a.value === 'string' && typeof b.value === 'string' && a.numFmt !== '@' && b.numFmt !== '@') {
        a.numFmt = b.numFmt = null;
      }
      for (const k of Object.keys(a) as Array<keyof typeof a>) {
        if (ALLOWED.includes(k)) continue;
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(`${col}${r}.${k}: ours=${JSON.stringify(a[k])} expected=${JSON.stringify(b[k])}`);
      }
    }
    const ha = ours.getRow(r).height;
    const hb = theirs.getRow(r).height;
    if ((ha ?? null) !== (hb ?? null)) diffs.push(`row ${r} height: ours=${ha} expected=${hb}`);
  }
  for (const col of COLS) {
    const wa = ours.getColumn(col).width;
    const wb = theirs.getColumn(col).width;
    if ((wa ?? null) !== (wb ?? null)) diffs.push(`col ${col} width: ours=${wa} expected=${wb}`);
  }
  const ma = [...(ours.model.merges ?? [])].sort();
  const mb = [...(theirs.model.merges ?? [])].sort();
  if (JSON.stringify(ma) !== JSON.stringify(mb)) diffs.push(`merges: ours=${ma} expected=${mb}`);
  if (!ours.views[0]?.rightToLeft) diffs.push('sheet is not right-to-left');
  return diffs;
}

async function main() {
  if (!existsSync(DIR)) {
    console.log(`no ${DIR}/ folder; nothing to do (real samples are kept locally only)`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  let failed = false;
  for (const f of readdirSync(DIR).filter((x) => x.toLowerCase().endsWith('.pdf')).sort()) {
    const parsed = parseNesach(await loadRawDocumentFromFile(join(DIR, f)));
    const issues = [...parsed.issues, ...(parsed.data ? validateData(parsed.data) : [])];
    const status = autoStatus(parsed.ok, issues);
    console.log(`\n${f}: ${status}${parsed.data ? ` (גוש ${parsed.data.gush} חלקה ${parsed.data.helka}, ${parsed.data.owners.length} בעלים)` : ''}`);
    for (const i of issues.filter((x) => x.severity !== 'info')) console.log(`   [${i.severity}] ${i.message}`);
    if (!parsed.data) continue;
    // problem cells are marked (as in the app's default); files without findings stay identical to the template
    const bytes = await buildOwnershipWorkbook(parsed.data, { issues });
    const outName = outputFileName(parsed.data);
    writeFileSync(join(OUT, outName), bytes);
    console.log(`   → ${join(OUT, outName)}`);

    const expectedPath = join(DIR, `expected_${parsed.data.gush}_${parsed.data.helka}.xlsx`);
    if (!existsSync(expectedPath)) continue;
    const ours = new ExcelJS.Workbook();
    await ours.xlsx.load(bytes as unknown as ArrayBuffer);
    const theirs = new ExcelJS.Workbook();
    await theirs.xlsx.readFile(expectedPath);
    const diffs = await compare(ours.getWorksheet('בעלות')!, theirs.getWorksheet('בעלות')!);
    console.log(`   compared with ${basename(expectedPath)}: ${diffs.length === 0 ? 'IDENTICAL (apart from intended RTL reading order)' : `${diffs.length} differences`}`);
    for (const d of diffs) console.log(`      - ${d}`);
    if (diffs.length) failed = true;
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
