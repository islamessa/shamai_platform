import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEntry, ParcelData } from '../core/types';
import { validateData } from '../core/validate';
import { BatchTable } from './BatchTable';
import { downloadOne, downloadReport, downloadZip } from './download';
import { ReviewPanel } from './ReviewPanel';
import { analyzeEntries, exportList, newEntry, processEntry, type FileEntry } from './state';
import { UploadZone } from './UploadZone';

export function App() {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [planNumber, setPlanNumber] = useState('');
  const [markIssues, setMarkIssues] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Files are processed one at a time (pdf.js parses inside its own Web Worker), so a batch of
  // 100+ files never freezes the page or exhausts memory.
  const addFiles = useCallback((files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const skipped = files.length - pdfs.length;
    setNotice(skipped ? `${skipped} קבצים שאינם PDF דולגו.` : null);
    const fresh = pdfs.map(newEntry);
    setEntries((prev) => [...prev, ...fresh]);
    for (const e of fresh) {
      queue.current = queue.current.then(async () => {
        const done = await processEntry(e);
        setEntries((prev) => prev.map((x) => (x.id === e.id ? done : x)));
      });
    }
  }, []);

  // Data lives only in this tab's memory. Warn before the user closes the tab and loses it.
  useEffect(() => {
    if (entries.length === 0) return;
    const h = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [entries.length]);

  const counts = useMemo(() => {
    const c = { processing: 0, ok: 0, review: 0, approved: 0, failed: 0 };
    for (const e of entries) c[e.status]++;
    return c;
  }, [entries]);

  const analysis = useMemo(() => analyzeEntries(entries), [entries]);
  const exportable = exportList(entries, analysis).length;
  const reviewing = entries.find((e) => e.id === reviewId) ?? null;
  const exportOptions = { planNumber, markIssues };

  const save = (id: string, data: ParcelData, audit: AuditEntry[], note?: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        // owner-specific findings from reading the PDF only still apply if the owner rows were not added/removed
        const sameRows = (e.original?.owners.length ?? -1) === data.owners.length;
        const parseIssues = (e.parse?.issues ?? []).filter((i) => i.ownerIndex === undefined || sameRows);
        const changed = audit.length > 0 || !!note;
        const unchangedOk = e.status === 'ok' && !changed;
        return {
          ...e,
          data,
          issues: [...parseIssues, ...validateData(data)],
          audit: [...e.audit, ...audit],
          overrideNote: note || e.overrideNote,
          approvedAt: unchangedOk ? e.approvedAt : new Date().toLocaleString('he-IL'),
          status: unchangedOk ? 'ok' : 'approved',
        };
      }),
    );
    setReviewId(null);
  };

  const clearAll = () => {
    if (entries.length && !confirm('לנקות את כל הקבצים מהמסך? הנתונים יימחקו.')) return;
    setEntries([]);
    setNotice(null);
  };

  const zip = async () => {
    setZipProgress('מכין קבצים…');
    try {
      await downloadZip(entries, exportOptions, (d, t) => setZipProgress(`מכין קבצים… ${d}/${t}`));
    } finally {
      setZipProgress(null);
    }
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>המרת נסח טאבו לטבלת בעלות (Excel)</h1>
          <p className="privacy">🔒 הקבצים מעובדים במחשב שלך בלבד. שום קובץ או נתון לא נשלח לשרת.</p>
        </div>
        <div className="options">
          <label className="plan">
            מספר תכנית (לכותרת):
            <input value={planNumber} onChange={(e) => setPlanNumber(e.target.value)} placeholder="לא חובה" />
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={markIssues} onChange={(e) => setMarkIssues(e.target.checked)} />
            סימון הערות בתוך קובצי האקסל (צבע + הערה בתא)
          </label>
        </div>
      </header>

      <UploadZone onFiles={addFiles} />
      {notice && <div className="notice">{notice}</div>}

      {entries.length > 0 && (
        <>
          <section className="summary">
            <span className="chip ok">תקין: {counts.ok}</span>
            <span className="chip review">הופק עם הערות: {counts.review}</span>
            <span className="chip approved">נבדק ידנית: {counts.approved}</span>
            {counts.failed > 0 && <span className="chip failed">לא נקרא אוטומטית: {counts.failed}</span>}
            {counts.processing > 0 && <span className="chip processing">בעיבוד: {counts.processing}</span>}
            <span className="spacer" />
            <button className="primary" disabled={exportable === 0 || !!zipProgress || counts.processing > 0} onClick={zip}>
              {zipProgress ?? `הורדת הכל (ZIP) – ${exportable} קבצים + דוח`}
            </button>
            <button onClick={() => downloadReport(entries, exportOptions)} disabled={counts.processing > 0}>
              דוח עיבוד בלבד
            </button>
            <button className="ghost" onClick={clearAll}>
              ניקוי
            </button>
          </section>
          {counts.review > 0 && (
            <p className="hint">
              קבצים במצב "הופק עם הערות" <b>נכללים בהורדה</b>. הנתונים הועתקו כפי שהם מופיעים בנסח, והתאים שדורשים תשומת לב מסומנים
              בצבע ובהערה בתוך קובץ האקסל ומפורטים בדוח העיבוד. אפשר לתקן בכפתור "בדיקה ועריכה".
            </p>
          )}
          {counts.failed > 0 && (
            <p className="hint">
              קובץ שלא ניתן לקרוא אוטומטית (למשל נסח סרוק) אפשר להשלים בכפתור "הזנה ידנית"; הנסח מוצג לצד הטופס.
            </p>
          )}
          <BatchTable
            entries={entries}
            analysis={analysis}
            onReview={setReviewId}
            onDownload={(e) => downloadOne(e, entries, exportOptions)}
            onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
          />
        </>
      )}

      {reviewing && (
        <ReviewPanel
          key={reviewing.id}
          entry={reviewing}
          onCancel={() => setReviewId(null)}
          onApprove={(data, audit, note) => save(reviewing.id, data, audit, note)}
        />
      )}

      <footer className="foot">
        גרסה ראשונה: נסח רישום רגיל (בעלויות). נסחי בית משותף, חכירות ונסחים סרוקים יסומנו לבדיקה ידנית.
      </footer>
    </div>
  );
}
