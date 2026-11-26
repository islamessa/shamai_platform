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

  const approve = (id: string, data: ParcelData, audit: AuditEntry[], overrideNote?: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const parseIssues = e.parse?.issues ?? [];
        const changed = audit.length > 0;
        const unchangedOk = e.status === 'ok' && !changed;
        return {
          ...e,
          data,
          issues: [...parseIssues, ...validateData(data)],
          audit: [...e.audit, ...audit],
          overrideNote: overrideNote || e.overrideNote,
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
      await downloadZip(entries, planNumber, (d, t) => setZipProgress(`מכין קבצים… ${d}/${t}`));
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
        <label className="plan">
          מספר תכנית (לכותרת):
          <input value={planNumber} onChange={(e) => setPlanNumber(e.target.value)} placeholder="לא חובה" />
        </label>
      </header>

      <UploadZone onFiles={addFiles} />
      {notice && <div className="notice">{notice}</div>}

      {entries.length > 0 && (
        <>
          <section className="summary">
            <span className="chip ok">תקין: {counts.ok}</span>
            <span className="chip approved">אושר ידנית: {counts.approved}</span>
            <span className="chip review">דורש בדיקה: {counts.review}</span>
            <span className="chip failed">נכשל: {counts.failed}</span>
            {counts.processing > 0 && <span className="chip processing">בעיבוד: {counts.processing}</span>}
            <span className="spacer" />
            <button className="primary" disabled={exportable === 0 || !!zipProgress || counts.processing > 0} onClick={zip}>
              {zipProgress ?? `הורדת הכל (ZIP) – ${exportable} קבצים + דוח`}
            </button>
            <button onClick={() => downloadReport(entries, planNumber)} disabled={counts.processing > 0}>
              דוח עיבוד בלבד
            </button>
            <button className="ghost" onClick={clearAll}>
              ניקוי
            </button>
          </section>
          {counts.review + counts.failed > 0 && (
            <p className="hint">
              קבצים במצב "דורש בדיקה" או "נכשל" <b>אינם נכללים</b> בהורדה עד שתבדקו ותאשרו אותם (כפתור "בדיקה ועריכה").
            </p>
          )}
          <BatchTable
            entries={entries}
            analysis={analysis}
            onReview={setReviewId}
            onDownload={(e) => downloadOne(e, entries, planNumber)}
            onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
          />
        </>
      )}

      {reviewing && (
        <ReviewPanel
          key={reviewing.id}
          entry={reviewing}
          onCancel={() => setReviewId(null)}
          onApprove={(data, audit, note) => approve(reviewing.id, data, audit, note)}
        />
      )}

      <footer className="foot">
        גרסה ראשונה: נסח רישום רגיל (בעלויות). נסחי בית משותף, חכירות ונסחים סרוקים יסומנו לבדיקה ידנית.
      </footer>
    </div>
  );
}
