import { describe, expect, it } from 'vitest';
import { analyzeBatch, batchIssues, type BatchItem } from '../../src/core/batch';

const item = (id: string, nesachNumber: string | undefined, helka: string, issueDate = '20/09/2019'): BatchItem => ({
  id,
  fileName: `${id}.pdf`,
  nesachNumber,
  issueDate,
  gush: '7001',
  helka,
});

describe('batch duplicates', () => {
  it('marks a later identical extract (same נסח) as a duplicate of the first, not as "another extract"', () => {
    const a = analyzeBatch([item('a', '100', '44'), item('b', '100', '44'), item('c', '101', '45')]);
    expect(a.get('a')!.duplicateOf).toBeUndefined();
    expect(a.get('b')!.duplicateOf?.id).toBe('a');
    expect(a.get('a')!.sameParcel).toEqual([]);
    expect(a.get('b')!.sameParcel).toEqual([]);
    expect(a.get('c')).toEqual({ sameParcel: [] });
    expect(batchIssues(a.get('b'))).toEqual([expect.objectContaining({ code: 'DUPLICATE_FILE', severity: 'warning' })]);
    expect(batchIssues(a.get('b'))[0].message).toContain('a.pdf');
  });

  it('warns on both files when two different extracts of the same parcel are uploaded', () => {
    const a = analyzeBatch([item('old', '100', '44', '01/01/2019'), item('new', '200', '44', '01/01/2026')]);
    expect(a.get('old')!.duplicateOf).toBeUndefined();
    expect(a.get('old')!.sameParcel.map((x) => x.id)).toEqual(['new']);
    expect(a.get('new')!.sameParcel.map((x) => x.id)).toEqual(['old']);
    const msg = batchIssues(a.get('old'))[0];
    expect(msg).toMatchObject({ code: 'SAME_PARCEL', severity: 'warning' });
    expect(msg.message).toContain("נסח מס' 200");
    expect(msg.message).toContain('01/01/2026');
  });

  it('never calls files identical without a נסח number, and ignores files that could not be read', () => {
    const a = analyzeBatch([item('a', undefined, '44'), item('b', undefined, '44'), { id: 'c', fileName: 'c.pdf' }]);
    expect(a.get('b')!.duplicateOf).toBeUndefined();
    expect(a.get('b')!.sameParcel.map((x) => x.id)).toEqual(['a']);
    expect(a.get('c')).toEqual({ sameParcel: [] });
    expect(batchIssues(undefined)).toEqual([]);
  });
});
