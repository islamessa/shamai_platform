import { useMemo, useState } from 'react';
import { format, parseShare, sum, toNumber } from '../core/fraction';
import { padIdIfValid } from '../core/israeliId';
import { SEVERITY_LABEL } from '../core/labels';
import type { AuditEntry, Owner, ParcelData } from '../core/types';
import { hasErrors, validateData } from '../core/validate';
import { PdfViewer } from './PdfViewer';
import { diffData, type FileEntry } from './state';

const EMPTY: ParcelData = { gush: '', helka: '', registeredArea: null, planArea: null, owners: [{ name: '', idType: 'ת.ז', idNumber: '', share: '' }] };

export function ReviewPanel(props: {
  entry: FileEntry;
  onCancel: () => void;
  onApprove: (data: ParcelData, audit: AuditEntry[], overrideNote?: string) => void;
}) {
  const { entry } = props;
  const [draft, setDraft] = useState<ParcelData>(() => structuredClone(entry.data ?? EMPTY));
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState('');

  const parseIssues = entry.parse?.issues ?? entry.issues;
  const dataIssues = useMemo(() => validateData(draft), [draft]);
  const errors = hasErrors(dataIssues);
  const issuesFor = (i: number) => dataIssues.filter((x) => x.ownerIndex === i && x.severity === 'error');

  const shareTotal = useMemo(() => {
    const fs = draft.owners.map((o) => parseShare(o.share));
    if (!fs.length || fs.some((f) => !f)) return null;
    return sum(fs as NonNullable<(typeof fs)[number]>[]);
  }, [draft.owners]);

  const setOwner = (i: number, patch: Partial<Owner>) =>
    setDraft((d) => ({ ...d, owners: d.owners.map((o, k) => (k === i ? { ...o, ...patch } : o)) }));
  const setNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

  const canApprove = verified && (!errors || note.trim().length >= 5);

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="review">
        <div className="review-head">
          <h2>בדיקה ועריכה: {entry.file.name}</h2>
          <button className="ghost" onClick={props.onCancel}>
            סגירה ✕
          </button>
        </div>
        <div className="review-body">
          <div className="review-form">
            {parseIssues.length > 0 && (
              <div className="box">
                <h3>ממצאים מקריאת הקובץ</h3>
                {parseIssues.map((i, k) => (
                  <div key={k} className={`issue ${i.severity}`}>
                    <b>{SEVERITY_LABEL[i.severity]}:</b> {i.message}
                  </div>
                ))}
              </div>
            )}

            <div className="grid4">
              <label>
                גוש
                <input value={draft.gush} onChange={(e) => setDraft({ ...draft, gush: e.target.value.trim() })} />
              </label>
              <label>
                חלקה
                <input value={draft.helka} onChange={(e) => setDraft({ ...draft, helka: e.target.value.trim() })} />
              </label>
              <label>
                שטח רשום (מ"ר)
                <input
                  value={draft.registeredArea ?? ''}
                  onChange={(e) => {
                    const v = setNum(e.target.value);
                    // plan area follows the registered area unless the user changed it separately
                    setDraft((d) => ({ ...d, registeredArea: v, planArea: d.planArea === d.registeredArea ? v : d.planArea }));
                  }}
                />
              </label>
              <label>
                שטח בתכנית (מ"ר)
                <input value={draft.planArea ?? ''} onChange={(e) => setDraft({ ...draft, planArea: setNum(e.target.value) })} />
              </label>
            </div>

            <table className="owners">
              <thead>
                <tr>
                  <th>#</th>
                  <th>שם בעלים</th>
                  <th>סוג זיהוי</th>
                  <th>מס' זיהוי</th>
                  <th>החלק בנכס</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.owners.map((o, i) => (
                  <tr key={i} className={issuesFor(i).length ? 'bad' : ''} title={issuesFor(i).map((x) => x.message).join('\n')}>
                    <td>{i + 1}</td>
                    <td>
                      <input value={o.name} onChange={(e) => setOwner(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <input className="short" value={o.idType ?? ''} placeholder="—" onChange={(e) => setOwner(i, { idType: e.target.value.trim() || null })} />
                    </td>
                    <td>
                      <input
                        className="mono"
                        value={o.idNumber ?? ''}
                        placeholder="—"
                        onChange={(e) => setOwner(i, { idNumber: e.target.value.replace(/\D/g, '') || null })}
                        onBlur={(e) => {
                          const p = padIdIfValid(e.target.value);
                          if (p) setOwner(i, { idNumber: p });
                        }}
                      />
                    </td>
                    <td>
                      <input className="mono" value={o.share} placeholder="970/10000" onChange={(e) => setOwner(i, { share: e.target.value.replace(/\s+/g, '') })} />
                    </td>
                    <td>
                      <button className="ghost" title="מחיקת שורה" onClick={() => setDraft((d) => ({ ...d, owners: d.owners.filter((_, k) => k !== i) }))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="owners-foot">
              <button onClick={() => setDraft((d) => ({ ...d, owners: [...d.owners, { name: '', idType: 'ת.ז', idNumber: '', share: '' }] }))}>
                + הוספת בעלים
              </button>
              <span className={shareTotal && format(shareTotal) === '1/1' ? 'sum ok' : 'sum bad'}>
                סכום החלקים: {shareTotal ? `${format(shareTotal)} (${(toNumber(shareTotal) * 100).toFixed(3)}%)` : '—'}
              </span>
            </div>
            <p className="hint">ללא מספר זיהוי (למשל מדינת ישראל): השאירו את סוג הזיהוי ומספר הזיהוי ריקים; בקובץ יופיע "-".</p>

            <div className="box">
              <h3>בדיקת הנתונים</h3>
              {dataIssues.filter((i) => i.severity !== 'info').length === 0 ? (
                <div className="issue ok">לא נמצאו שגיאות בנתונים.</div>
              ) : (
                dataIssues
                  .filter((i) => i.severity !== 'info')
                  .map((i, k) => (
                    <div key={k} className={`issue ${i.severity}`}>
                      <b>{SEVERITY_LABEL[i.severity]}:</b> {i.message}
                    </div>
                  ))
              )}
            </div>

            <div className="approve">
              <label className="check">
                <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="verified" />
                בדקתי את הנתונים מול הנסח המקורי
              </label>
              {errors && (
                <label className="override">
                  נותרו שגיאות. כדי לאשר בכל זאת יש לנמק (יירשם בדוח העיבוד):
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="לדוגמה: מספר ת.ז ישן ללא ספרת ביקורת, תואם לנסח" />
                </label>
              )}
              <div className="buttons">
                <button
                  className="primary"
                  disabled={!canApprove}
                  data-testid="approve"
                  onClick={() => props.onApprove(draft, diffData(entry.original, draft), errors ? note.trim() : undefined)}
                >
                  אישור והכללה בהורדה
                </button>
                <button className="ghost" onClick={props.onCancel}>
                  ביטול
                </button>
              </div>
            </div>
          </div>
          <PdfViewer file={entry.file} />
        </div>
      </div>
    </div>
  );
}
