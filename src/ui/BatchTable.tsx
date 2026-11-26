import { useState } from 'react';
import { STATUS_LABEL } from '../core/labels';
import type { FileStatus } from '../core/types';
import { isExportable, type FileEntry } from './state';

type Filter = 'all' | 'attention' | 'done';

const ICON: Record<FileStatus, string> = { processing: '⏳', ok: '✅', approved: '☑️', review: '⚠️', failed: '❌' };

export function BatchTable(props: {
  entries: FileEntry[];
  onReview: (id: string) => void;
  onDownload: (e: FileEntry) => void;
  onRemove: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const rows = props.entries.filter((e) =>
    filter === 'all' ? true : filter === 'attention' ? e.status === 'review' || e.status === 'failed' : isExportable(e),
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
            const shown = [...e.issues].sort((a, b) => rank(a.severity) - rank(b.severity)).filter((i) => i.severity !== 'info');
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
                  {isExportable(e) && <button onClick={() => props.onDownload(e)}>הורדה</button>}
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
