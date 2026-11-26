import { useEffect, useMemo, useRef, useState } from 'react';
import { openPdf } from './pdf';

/**
 * Shows the original extract next to the form.
 * Preferred: the browser's own PDF viewer (the same one that opens a PDF on double-click). It renders the
 * extract exactly, with zoom and search. The file stays local (a blob: URL), nothing is uploaded.
 * Fallback for browsers without a built-in viewer: pages drawn with pdf.js.
 */
export function PdfViewer({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([file], { type: 'application/pdf' })), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const native = typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === true;

  return (
    <div className="pdf-pane">
      <div className="pdf-toolbar">
        <a href={url} target="_blank" rel="noopener noreferrer">
          פתיחת הנסח בלשונית חדשה ↗
        </a>
      </div>
      {native ? <iframe className="pdf-frame" src={`${url}#navpanes=0&view=FitH`} title="הנסח המקורי" /> : <CanvasPages file={file} />}
    </div>
  );
}

/** Fallback preview: every page drawn to a canvas with pdf.js. */
function CanvasPages({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof openPdf> | null = null;
    (async () => {
      try {
        task = openPdf(new Uint8Array(await file.arrayBuffer()), true);
        const doc = await task.promise;
        const width = (host.current?.clientWidth ?? 600) - 24;
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const dpr = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
          canvas.className = 'pdf-page';
          host.current?.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(`לא ניתן להציג את הקובץ: ${(e as Error)?.message ?? e}`);
      }
    })();
    return () => {
      cancelled = true;
      host.current?.replaceChildren();
      task?.destroy();
    };
  }, [file]);

  return (
    <div className="pdf-viewer" ref={host}>
      {error && <div className="issue error">{error}</div>}
    </div>
  );
}
