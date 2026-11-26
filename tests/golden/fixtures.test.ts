import { describe, expect, it } from 'vitest';
import { parseNesach } from '../../src/core/parseNesach';
import { FIXTURES, loadExpected, loadRaw, mapItems, run } from '../helpers/fixtures';

/*
 * Golden tests: anonymized copies of real Land Registry extracts (see scripts/capture-fixture.ts).
 * The expected files were reviewed by hand against the original PDFs.
 */
describe('golden fixtures', () => {
  for (const name of FIXTURES) {
    it(`${name}: parse result matches the reviewed expectation`, () => {
      const parsed = parseNesach(loadRaw(name));
      const expected = loadExpected(name);
      expect({ ok: parsed.ok, data: parsed.data, meta: parsed.meta, issues: parsed.issues }).toEqual(
        JSON.parse(JSON.stringify(expected)),
      );
    });
  }

  it('standard 2026 extract: 10 owners, mixed denominators, state without ID → ok', () => {
    const r = run(loadRaw('standard-2026'));
    expect(r.status).toBe('ok');
    const d = r.parsed.data!;
    expect(d.owners).toHaveLength(10);
    expect(d.registeredArea).toBe(400);
    expect(d.planArea).toBe(400);
    expect(d.owners[0]).toMatchObject({ name: 'מדינת ישראל', idType: null, idNumber: null, share: '3250/10000' });
    expect(d.owners[8].share).toBe('197/2000');
    expect(d.owners[8].note).toBe('מכח ירושה');
    for (const o of d.owners.slice(1)) expect(o.idNumber).toMatch(/^0\d{8}$/); // leading zeros kept
  });

  it('old extract with "בשלמות" and an ID printed without leading zeros → ok, padding reported', () => {
    const r = run(loadRaw('old-whole-person'));
    expect(r.status).toBe('ok');
    expect(r.parsed.data!.owners[0].share).toBe('בשלמות');
    expect(r.parsed.data!.owners[0].idNumber).toMatch(/^\d{9}$/);
    expect(r.codes).toContain('ID_PADDED');
    expect(r.parsed.data!.registeredArea).toBe(4500); // printed "4,500.00"
  });

  it('old extract, state owns the whole parcel, extra columns in property description → ok', () => {
    const r = run(loadRaw('old-whole-state'));
    expect(r.status).toBe('ok');
    expect(r.parsed.data!.registeredArea).toBe(417);
    expect(r.parsed.data!.owners).toEqual([expect.objectContaining({ name: 'מדינת ישראל', share: 'בשלמות', idNumber: null })]);
  });

  it('old multi-owner extract: deed "5097/1979" and a "1 / 3" inside notes are not counted as shares; bad old ID → review', () => {
    const r = run(loadRaw('old-multi-owner'));
    expect(r.status).toBe('review');
    expect(r.codes).not.toContain('OWNER_COUNT_MISMATCH');
    expect(r.codes).not.toContain('SHARES_SUM');
    expect(r.codes.filter((c) => c === 'ID_PADDED')).toHaveLength(5);
    expect(r.issues.find((i) => i.severity === 'error')).toMatchObject({ code: 'ID_SHORT', ownerIndex: 0 });
    expect(r.parsed.data!.registeredArea).toBe(5689);
  });
});

describe('round 2 extracts (old format)', () => {
  it('6 owners, mixed denominators 338/2815 and 45/563, easement section reported → ok', () => {
    const r = run(loadRaw('old-easement-6-owners'));
    expect(r.status).toBe('ok');
    const d = r.parsed.data!;
    expect(d.registeredArea).toBe(5630);
    expect(d.owners.map((o) => o.share)).toEqual(['1/5', '1/5', '1/5', '1/5', '338/2815', '45/563']);
    expect(d.owners.every((o) => /^\d{9}$/.test(o.idNumber!))).toBe(true);
    expect(r.codes.filter((c) => c === 'ID_PADDED')).toHaveLength(5);
    expect(r.codes).toEqual(expect.arrayContaining(['HAS_EASEMENTS', 'HAS_NOTES']));
    expect(r.parsed.meta.sections).toContain('זיקות הנאה');
  });

  it('ID printed in a non-standard old format ("1/234560") → review with a clear message, never "fixed" automatically', () => {
    const r = run(loadRaw('old-slash-id'));
    expect(r.status).toBe('review');
    const o = r.parsed.data!.owners[0];
    expect(o.idNumber).toMatch(/^\d\/\d{6}$/); // kept exactly as printed
    expect(o.share).toBe('בשלמות');
    expect(r.parsed.data!.registeredArea).toBe(10096);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([expect.objectContaining({ code: 'ID_NONSTANDARD', ownerIndex: 0 })]);
  });
});

describe('mutations of a good extract are caught (never silently wrong)', () => {
  const base = loadRaw('standard-2026');
  const owners = run(base).parsed.data!.owners;

  it('a missing owner block → shares do not sum to 1', () => {
    // delete every item on the value/share lines of owner #2 and its header (y band of that block on page 1)
    const victim = owners[1];
    const doc = structuredClone(base);
    const p1 = doc.pages[0];
    const nameItem = p1.items.find((i) => i.str === victim.name)!;
    p1.items = p1.items.filter((i) => i.y < nameItem.y - 20 || i.y > nameItem.y + 40);
    const r = run(doc);
    expect(r.status).toBe('review');
    expect(r.codes).toContain('SHARES_SUM');
  });

  it('one wrong ID digit → check digit error', () => {
    const id = owners[1].idNumber!;
    const bad = id.slice(0, 8) + String((Number(id[8]) + 1) % 10);
    const r = run(mapItems(base, (it) => (it.str === id ? { ...it, str: bad } : it)));
    expect(r.status).toBe('review');
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'ID_CHECKSUM', ownerIndex: 1 }));
  });

  it('reversed Hebrew name → fixed automatically and reported', () => {
    const name = owners[2].name;
    const reversed = [...name].reverse().join('');
    const r = run(mapItems(base, (it) => (it.str === name ? { ...it, str: reversed } : it)));
    expect(r.parsed.data!.owners[2].name).toBe(name);
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'NAME_REVERSED_FIXED', severity: 'warning', ownerIndex: 2 }));
    expect(r.codes).not.toContain('REVERSED_TEXT');
    expect(r.status).toBe('ok');
  });

  it('a missing share value → share missing + count mismatch', () => {
    let removed = false;
    const r = run(
      mapItems(base, (it) => {
        if (!removed && it.str === '323 / 10000') {
          removed = true;
          return null;
        }
        return it;
      }),
    );
    expect(r.codes).toEqual(expect.arrayContaining(['SHARE_MISSING', 'OWNER_COUNT_MISMATCH']));
    expect(r.status).toBe('review');
  });

  it('scanned PDF (no text layer) → failed', () => {
    const r = run(mapItems(base, () => null));
    expect(r.status).toBe('failed');
    expect(r.codes).toContain('NO_TEXT');
  });

  it('not a Land Registry extract → failed', () => {
    const r = run(mapItems(base, (it) => (it.str.includes('פנקס הזכויות') ? { ...it, str: 'מסמך אחר' } : it)));
    expect(r.status).toBe('failed');
    expect(r.codes).toContain('NOT_NESACH');
  });

  it('unsupported lease section → review', () => {
    const doc = structuredClone(base);
    const end = doc.pages[1].items.find((i) => i.str === 'סוף נתונים')!;
    doc.pages[1].items.push({ ...end, str: 'חכירות', y: end.y - 8 });
    const r = run(doc);
    expect(r.codes).toContain('UNSUPPORTED_LEASE');
    expect(r.status).toBe('review');
  });

  it('missing "סוף נתונים" (truncated file) → review', () => {
    const r = run(mapItems(base, (it) => (it.str === 'סוף נתונים' ? null : it)));
    expect(r.codes).toContain('END_MARKER_MISSING');
  });

  it('page header with a different גוש → review', () => {
    const gush = run(base).parsed.data!.gush;
    const r = run(mapItems(base, (it, page) => (page === 2 && it.str === gush ? { ...it, str: '9999' } : it)));
    expect(r.codes).toContain('HEADER_MISMATCH');
  });

  it('missing area → review', () => {
    const r = run(mapItems(base, (it) => (it.str === '400' ? null : it)));
    expect(r.codes).toContain('AREA_MISSING');
    expect(r.status).toBe('review');
  });
});
