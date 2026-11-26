import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildOwnershipWorkbook, outputFileName, titleText } from '../../src/core/excel/ownershipSheet';
import { buildReportWorkbook } from '../../src/core/excel/report';
import { loadRaw, run } from '../helpers/fixtures';

async function readBack(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

describe('ownership sheet (בעלות)', () => {
  it('matches the template layout for a 10-owner parcel', async () => {
    const d = run(loadRaw('standard-2026')).parsed.data!;
    const wb = await readBack(await buildOwnershipWorkbook(d, { planNumber: '' }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['בעלות']);
    const ws = wb.getWorksheet('בעלות')!;

    expect(ws.views[0].rightToLeft).toBe(true);
    expect([...ws.model.merges].sort()).toEqual(['B2:J2', 'B3:J3', 'B5:B15', 'C5:C15', 'D5:D15', 'E5:E15'].sort());
    expect(ws.getCell('B2').value).toBe('תכנית _______');
    expect(ws.getCell('B3').value).toBe('בעלות לפי נסח טאבו עדכני');
    expect(['B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'I4', 'J4'].map((a) => ws.getCell(a).value)).toEqual([
      'גוש', 'חלקה', 'שטח חלקה רשום במ"ר', 'שטח בתכנית במ"ר', 'שם בעלים רשום', "מס' זהות", 'החלקים בבעלות', 'שווי יחסי ב%', 'שטח במ"ר',
    ]);
    expect(ws.getCell('B4').fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } });

    // parcel columns
    expect([ws.getCell('B5').value, ws.getCell('C5').value, ws.getCell('D5').value, ws.getCell('E5').value]).toEqual([7001, 118, 400, 400]);

    // owner rows
    expect(ws.getCell('F5').value).toBe('מדינת ישראל');
    expect(ws.getCell('G5').value).toBe('-');
    expect(ws.getCell('H5').value).toBe('3250/10000');
    expect(ws.getCell('I5').value).toMatchObject({ formula: '3250/10000' });
    expect(ws.getCell('J5').value).toMatchObject({ formula: 'I5*$E$5' });
    expect(ws.getCell('G6').value).toBe(d.owners[1].idNumber); // text, leading zero kept
    expect(typeof ws.getCell('G6').value).toBe('string');
    expect(ws.getCell('G6').numFmt).toBe('@');
    expect(ws.getCell('I13').value).toMatchObject({ formula: '197/2000' });
    expect(ws.getCell('I6').numFmt).toBe('0.0%');
    expect(ws.getCell('J6').numFmt).toBe('0.0');

    // totals with cached results
    expect(ws.getCell('F15').value).toBe('סה"כ');
    expect(ws.getCell('I15').value).toMatchObject({ formula: 'SUM(I5:I14)' });
    expect(ws.getCell('J15').value).toMatchObject({ formula: 'SUM(J5:J14)' });
    expect((ws.getCell('I15').value as { result: number }).result).toBeCloseTo(1, 12);
    expect((ws.getCell('J15').value as { result: number }).result).toBeCloseTo(400, 9);

    // styling + RTL text direction
    expect(ws.getCell('F6').font).toMatchObject({ name: 'Arial', size: 11 });
    expect(ws.getCell('B2').font).toMatchObject({ name: 'Arial', size: 12, bold: true });
    expect(ws.getCell('F6').alignment).toMatchObject({ readingOrder: 'rtl', vertical: 'middle' });
    expect(ws.getCell('F6').border).toMatchObject({ top: { style: 'thin' }, bottom: { style: 'thin' } });
    expect(ws.getColumn('F').width).toBe(16.375);
    expect(ws.getRow(4).height).toBe(37.5);
  });

  it('grows/shrinks with the number of owners and handles "בשלמות"', async () => {
    const d = run(loadRaw('old-whole-state')).parsed.data!;
    const ws = (await readBack(await buildOwnershipWorkbook(d, { planNumber: 'מק/123' }))).getWorksheet('בעלות')!;
    expect(ws.getCell('B2').value).toBe('תכנית מק/123');
    expect([...ws.model.merges].sort()).toEqual(['B2:J2', 'B3:J3', 'B5:B6', 'C5:C6', 'D5:D6', 'E5:E6'].sort());
    expect(ws.getCell('H5').value).toBe('בשלמות');
    expect(ws.getCell('I5').value).toMatchObject({ formula: '1/1', result: 1 });
    expect(ws.getCell('I6').value).toMatchObject({ formula: 'SUM(I5:I5)' });
    expect((ws.getCell('J6').value as { result: number }).result).toBe(417);
  });

  it('names files by parcel and formats the title', () => {
    expect(outputFileName({ gush: '1234', helka: '56' })).toBe('גוש_1234_חלקה_56.xlsx');
    expect(titleText('  ')).toBe('תכנית _______');
  });
});

describe('batch report', () => {
  it('lists every file with status, details and manual edits', async () => {
    const ok = run(loadRaw('standard-2026'));
    const rv = run(loadRaw('old-multi-owner'));
    const bytes = await buildReportWorkbook(
      [
        { fileName: 'a.pdf', status: 'ok', data: ok.parsed.data, issues: ok.issues, outputName: 'x.xlsx', audit: [] },
        {
          fileName: 'b.pdf', status: 'approved', data: rv.parsed.data, issues: rv.issues, outputName: 'y.xlsx',
          audit: [{ time: 't', field: "בעלים 1 – מס' זהות", before: '1', after: '2' }], overrideNote: 'נבדק מול הנסח',
        },
        { fileName: 'c.pdf', status: 'failed', issues: [{ severity: 'error', code: 'NO_TEXT', message: 'סרוק', source: 'parse' }], audit: [] },
      ],
      '101-0123456',
    );
    const wb = await readBack(bytes);
    const s = wb.getWorksheet('סיכום')!;
    expect(s.views[0].rightToLeft).toBe(true);
    expect(s.getCell('C2').value).toBe('תקין');
    expect(s.getCell('C3').value).toBe('אושר ידנית');
    expect(s.getCell('C4').value).toBe('נכשל');
    expect(s.getCell('H2').value).toBe('1/1');
    expect(String(s.getCell('J3').value)).toContain('נבדק מול הנסח');
    expect(s.getCell('I4').value).toBe('(לא הופק)');
    const a = wb.getWorksheet('שינויים ידניים')!;
    expect(a.getRow(2).values).toEqual(expect.arrayContaining(['b.pdf', "בעלים 1 – מס' זהות", '1', '2']));
  });
});
