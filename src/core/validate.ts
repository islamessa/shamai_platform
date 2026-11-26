import { format, isOne, parseShare, sum, toNumber, type Fraction } from './fraction';
import { looksReversed } from './hebrew';
import { CORPORATE_ID_TYPES, isValidIsraeliIdChecksum, padIdIfValid, PERSONAL_ID_TYPES } from './israeliId';
import type { FileStatus, Issue, ParcelData } from './types';

function issue(severity: Issue['severity'], code: string, message: string, ownerIndex?: number): Issue {
  return { severity, code, message, ownerIndex, source: 'data' };
}

/** Business validation of the parcel data. Re-run live whenever the user edits data in the review screen. */
export function validateData(d: ParcelData): Issue[] {
  const out: Issue[] = [];

  if (!/^\d+$/.test(d.gush)) out.push(issue('error', 'GUSH_INVALID', `מספר גוש לא תקין: "${d.gush}"`));
  if (!/^\d+$/.test(d.helka)) out.push(issue('error', 'HELKA_INVALID', `מספר חלקה לא תקין: "${d.helka}"`));
  if (d.registeredArea === null || !(d.registeredArea > 0)) out.push(issue('error', 'AREA_INVALID', 'שטח החלקה הרשום חסר או אינו חיובי.'));
  if (d.planArea === null || !(d.planArea > 0)) out.push(issue('error', 'PLAN_AREA_INVALID', 'שטח בתכנית חסר או אינו חיובי.'));
  if (d.owners.length === 0) out.push(issue('error', 'NO_OWNERS', 'לא נמצאו בעלים.'));

  const shares: Fraction[] = [];
  const seenIds = new Map<string, number>();

  d.owners.forEach((o, i) => {
    const who = `בעלים ${i + 1}${o.name ? ` (${o.name})` : ''}`;
    if (!o.name.trim()) out.push(issue('error', 'NAME_MISSING', `חסר שם עבור בעלים ${i + 1}.`, i));
    else if (looksReversed(o.name)) {
      out.push(issue('error', 'REVERSED_TEXT', `השם "${o.name}" נראה הפוך (אות סופית באמצע מילה). יש לבדוק.`, i));
    }

    const f = parseShare(o.share);
    if (!f) out.push(issue('error', 'SHARE_INVALID', `${who}: החלק בנכס "${o.share}" אינו בפורמט מונה/מכנה.`, i));
    else if (f.num <= 0n) out.push(issue('error', 'SHARE_ZERO', `${who}: החלק בנכס הוא אפס.`, i));
    else if (f.num > f.den) out.push(issue('error', 'SHARE_GT_ONE', `${who}: החלק בנכס (${o.share}) גדול מ-1.`, i));
    else shares.push(f);

    const type = o.idType?.trim() || null;
    const num = o.idNumber?.trim() || null;
    if (!type && !num) {
      out.push(issue('info', 'NO_ID', `${who}: ללא מספר זיהוי בנסח (יוצג "-").`, i));
    } else if (!num) {
      out.push(issue('error', 'ID_MISSING', `${who}: סוג זיהוי "${type}" ללא מספר זיהוי.`, i));
    } else if (!type) {
      out.push(issue('error', 'ID_TYPE_MISSING', `${who}: מספר זיהוי ${num} ללא סוג זיהוי.`, i));
    } else if (/\D/.test(num)) {
      // e.g. "1/234560" as printed on some old registrations
      out.push(
        issue(
          'error',
          'ID_NONSTANDARD',
          `${who}: מספר הזיהוי מודפס בנסח בפורמט לא תקני (${num}), כנראה מספר ישן. יש להשוות לנסח ולתקן ידנית, או לאשר עם הערה.`,
          i,
        ),
      );
    } else if (PERSONAL_ID_TYPES.has(type)) {
      if (/^\d{1,8}$/.test(num)) {
        const padded = padIdIfValid(num);
        out.push(
          padded
            ? issue('error', 'ID_NEEDS_PADDING', `${who}: מספר ת.ז "${num}" חסר אפסים מובילים. המספר המלא הוא ${padded}.`, i)
            : issue(
                'error',
                'ID_SHORT',
                `${who}: מספר ת.ז "${num}" קצר מ-9 ספרות ואינו תקין גם לאחר השלמת אפסים מובילים. ייתכן מספר ישן ללא ספרת ביקורת; יש לבדוק מול הנסח.`,
                i,
              ),
        );
      } else if (!/^\d{9}$/.test(num)) out.push(issue('error', 'ID_FORMAT', `${who}: מספר ת.ז "${num}" אינו בן 9 ספרות.`, i));
      else if (!isValidIsraeliIdChecksum(num)) out.push(issue('error', 'ID_CHECKSUM', `${who}: ספרת הביקורת של ת.ז ${num} שגויה.`, i));
    } else if (CORPORATE_ID_TYPES.has(type)) {
      if (!/^\d{9}$/.test(num)) out.push(issue('error', 'ID_FORMAT', `${who}: מספר ${type} "${num}" אינו בן 9 ספרות.`, i));
      else if (!isValidIsraeliIdChecksum(num)) out.push(issue('warning', 'ID_CHECKSUM_CORP', `${who}: ספרת הביקורת של ${type} ${num} אינה תקינה. מומלץ לבדוק.`, i));
    } else {
      out.push(issue('error', 'ID_TYPE_UNKNOWN', `${who}: סוג זיהוי "${type}" לא מוכר. יש לבדוק ידנית.`, i));
    }
    if (num) {
      if (seenIds.has(num)) out.push(issue('info', 'DUPLICATE_ID', `${who}: מספר הזיהוי ${num} מופיע גם אצל בעלים ${seenIds.get(num)! + 1}.`, i));
      else seenIds.set(num, i);
    }
  });

  if (shares.length === d.owners.length && shares.length > 0) {
    const total = sum(shares);
    if (!isOne(total)) {
      const pct = (toNumber(total) * 100).toFixed(4).replace(/\.?0+$/, '');
      out.push(issue('error', 'SHARES_SUM', `סכום החלקים בנכס הוא ${format(total)} (${pct}%) ולא 1 בדיוק.`));
    }
  }
  return out;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Automatic status (before any human action). */
export function autoStatus(parseOk: boolean, issues: Issue[]): FileStatus {
  if (!parseOk) return 'failed';
  return hasErrors(issues) ? 'review' : 'ok';
}
