import { cleanText } from './hebrew';
import type { RawDocument, RawItem, RawPage } from './types';

/*
 * Converts an opened pdf.js document into our RawDocument (plain JSON, easy to test and to store as a fixture).
 * Structural types are used so the same code works with the browser build and the Node "legacy" build of pdf.js.
 */

interface ViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}
interface TextItemLike {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName?: string;
}
interface PageLike {
  getViewport(o: { scale: number }): ViewportLike;
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): void;
}
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PageLike>;
  getMetadata(): Promise<{ info?: unknown }>;
}

function isTextItem(o: unknown): o is TextItemLike {
  return typeof o === 'object' && o !== null && 'str' in o && 'transform' in o;
}

export async function extractRawDocument(doc: PdfDocLike): Promise<RawDocument> {
  let title: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    if (info && typeof info.Title === 'string') title = info.Title;
  } catch {
    /* metadata is optional */
  }

  const pages: RawPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: RawItem[] = [];
    for (const it of tc.items) {
      if (!isTextItem(it)) continue;
      const str = cleanText(it.str);
      if (!str) continue;
      const [, , c, d, e, f] = it.transform;
      const [vx, vy] = vp.convertToViewportPoint(e, f);
      items.push({
        str,
        x: round(vx),
        y: round(vy),
        w: round(it.width),
        h: round(it.height || Math.hypot(c, d)),
        dir: it.dir === 'rtl' ? 'rtl' : it.dir === 'ttb' ? 'ttb' : 'ltr',
        fontName: it.fontName,
      });
    }
    pages.push({ pageNumber: n, width: round(vp.width), height: round(vp.height), items });
    page.cleanup?.();
  }
  return { title, pages };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
