import { describe, expect, it } from 'vitest';
import { format, isOne, looksLikeShare, normalizeShareText, parseShare, sum } from '../../src/core/fraction';
import { cleanText, looksReversed } from '../../src/core/hebrew';
import { isValidIsraeliIdChecksum, normalizeIdType, padIdIfValid } from '../../src/core/israeliId';

describe('fraction', () => {
  it('parses registry shares without reducing', () => {
    expect(parseShare('970 / 10000')).toEqual({ num: 970n, den: 10000n });
    expect(parseShare('197/2000')).toEqual({ num: 197n, den: 2000n });
    expect(parseShare('בשלמות')).toEqual({ num: 1n, den: 1n });
    expect(parseShare('1/0')).toBeNull();
    expect(parseShare('22/10/2009')).toBeNull();
  });
  it('sums mixed denominators exactly', () => {
    const shares = ['3250/10000', '970/10000', '970/10000', '323/10000', '323/10000', '323/10000', '970/10000', '901/10000', '197/2000', '197/2000'];
    expect(isOne(sum(shares.map((s) => parseShare(s)!)))).toBe(true);
    const old = ['1/3', '1/12', '1/12', '1/12', '1/12', '833/5689', '3190/17067'];
    expect(isOne(sum(old.map((s) => parseShare(s)!)))).toBe(true);
    expect(format(sum([parseShare('1/3')!, parseShare('1/3')!]))).toBe('2/3');
  });
  it('normalizes share text to the template format', () => {
    expect(normalizeShareText('970 / 10000')).toBe('970/10000');
    expect(normalizeShareText('בשלמות')).toBe('בשלמות');
    expect(looksLikeShare('5097/1979')).toBe(true); // why share detection must also use position
    expect(looksLikeShare('36367/2009/37')).toBe(false);
  });
});

describe('israeli id', () => {
  it('validates check digits', () => {
    // synthetic IDs only. Never put real ID numbers in the repository.
    for (const id of ['012345674', '012345682', '123456782', '007654304']) expect(isValidIsraeliIdChecksum(id)).toBe(true);
    expect(isValidIsraeliIdChecksum('012345675')).toBe(false);
    expect(isValidIsraeliIdChecksum('12345674')).toBe(false); // never pads implicitly
  });
  it('pads old IDs only when the padded check digit is valid', () => {
    expect(padIdIfValid('12345609')).toBe('012345609');
    expect(padIdIfValid('7654304')).toBe('007654304');
    expect(padIdIfValid('7654300')).toBeNull();
    expect(padIdIfValid('012345674')).toBeNull(); // already 9 digits
  });
  it('normalizes ID type labels', () => {
    expect(normalizeIdType('ת.ז')).toBe('ת.ז');
    expect(normalizeIdType('ת"ז')).toBe('ת.ז');
    expect(normalizeIdType('ח. פ')).toBe('ח.פ');
  });
});

describe('hebrew', () => {
  it('detects reversed Hebrew via final letters', () => {
    expect(looksReversed('כהן משה אברהם')).toBe(false);
    expect(looksReversed('םהרבא השמ ןהכ')).toBe(true);
    expect(looksReversed("ג'ורג' חדד סמיר")).toBe(false);
    expect(looksReversed('מדינת ישראל')).toBe(false);
  });
  it('cleans bidi marks and quotes', () => {
    expect(cleanText('‫שטח במ״ר‬')).toBe('שטח במ"ר');
    expect(cleanText('  a  b ')).toBe('a b');
  });
});
