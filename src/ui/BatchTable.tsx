import { useState } from 'react';
import { batchIssues, type BatchInfo } from '../core/batch';
import { STATUS_LABEL } from '../core/labels';
import type { FileStatus, Issue } from '../core/types';
import { isExportable, type FileEntry } from './state';

type Filter = 'all' | 'attention' | 'done';

const ICON: Record<FileStatus, string> = { processing: '⏳', ok: '✅', approved: '☑️', review: '⚠️', failed: '❌' };

export function BatchTable(props: {
  entries: FileEntry[];
  analysis: Map<string, BatchInfo>;
  onReview: (id: string) => void;
  onDownload: (e: FileEntry) => void;
  onRemove: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const isDuplicate = (e: FileEntry) => !!props.analysis.get(e.id)?.duplicateOf;
  const rows = props.entries.filter((e) =>
    filter === 'all' ? true : filter === 'attention' ? e.status === 'review' || e.status === 'failed' : isExportable(e) && !isDuplicate(e),
  );

  return (
    <section>
      <div className="filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          הכל ({props.entries.length})
        </button>
        <button className={filter === 'attention' ? 'active' : ''} onClick={() => setFilter('attention')}>
          דורשים טיפול
        </button>
        <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>
          מוכנים להורדה
        </button>
      </div>
      <table className="batch">
        <thead>
          <tr>
            <th>#</th>
            <th>קובץ</th>
            <th>גוש / חלקה</th>
            <th>בעלים</th>
            <th>סטטוס</th>
            <th>פירוט</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const idx = props.entries.indexOf(e) + 1;
            const duplicate = isDuplicate(e);
            const shown = summarize([...batchIssues(props.analysis.get(e.id)), ...e.issues]);
            return (
              <tr key={e.id} className={`row-${e.status}`} data-testid={`row-${idx}`}>
                <td>{idx}</td>
                <td className="fname" title={e.file.name}>
                  {e.file.name}
                </td>
                <td>{e.data ? `${e.data.gush} / ${e.data.helka}` : '—'}</td>
                <td>{e.data?.owners.length ?? '—'}</td>
                <td>
                  <span className={`badge ${e.status}`} data-testid="status">
                    {ICON[e.status]} {STATUS_LABEL[e.status]}
                  </span>
                  {duplicate && <span className="badge dup">כפול</span>}
                </td>
                <td className="details">
                  {shown.slice(0, 3).map((i, k) => (
                    <div key={k} className={`issue ${i.severity}`}>
                      {i.message}
                    </div>
                  ))}
                  {shown.length > 3 && <div className="more">ועוד {shown.length - 3}…</div>}
                  {e.overrideNote && <div className="issue info">אושר חרף שגיאות: {e.overrideNote}</div>}
                </td>
                <td className="actions">
                  {e.status !== 'processing' && (
                    <button onClick={() => props.onReview(e.id)} className={e.status === 'review' || e.status === 'failed' ? 'primary' : ''}>
                      {e.status === 'review' || e.status === 'failed' ? 'בדיקה ועריכה' : 'צפייה / עריכה'}
                    </button>
                  )}
                  {isExportable(e) && !duplicate && <button onClick={() => props.onDownload(e)}>הורדה</button>}
                  <button className="ghost" title="הסרה" onClick={() => props.onRemove(e.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function rank(s: string) {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}

/**
 * Issues for the compact table view: errors first, info hidden, and the repetitive
 * "ID completed with leading zeros" warnings collapsed into one line (full list: review screen + report).
 */
function summarize(issues: Issue[]): Issue[] {
  const padded = issues.filter((i) => i.code === 'ID_PADDED').length;
  const rest = issues.filter((i) => i.code !== 'ID_PADDED' && i.severity !== 'info');
  if (padded) {
    rest.push({
      severity: 'warning',
      code: 'ID_PADDED_SUMMARY',
      message:
        padded === 1
          ? 'מספר ת.ז אחד הושלם באפסים מובילים (ספרת הביקורת תקינה).'
          : `${padded} מספרי ת.ז הושלמו באפסים מובילים (ספרת הביקורת תקינה).`,
      source: 'parse',
    });
  }
  return rest.sort((a, b) => rank(a.severity) - rank(b.severity));
}
