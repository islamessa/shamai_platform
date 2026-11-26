import { useEffect, useRef, useState } from 'react';
import { openPdf } from './pdf';

/** Renders every page of the PDF to canvases, so the user can compare the form with the original extract. */
export function PdfViewer({ file }: { file: File }) {
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
