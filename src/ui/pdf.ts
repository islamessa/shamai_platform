import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractRawDocument, type PdfDocLike } from '../core/pdfText';
import type { RawDocument } from '../core/types';

/*
 * Browser-side pdf.js. Parsing runs inside pdf.js's own Web Worker, so the page stays responsive.
 * All assets are served from our own origin; nothing is fetched from a CDN and no file is uploaded.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = `${import.meta.env.BASE_URL}pdfjs/`;
const OPTIONS = {
  standardFontDataUrl: `${base}standard_fonts/`,
  cMapUrl: `${base}cmaps/`,
  wasmUrl: `${base}wasm/`,
  iccUrl: `${base}iccs/`,
  enableXfa: false,
};

export class PdfReadError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

/**
 * Opens PDF bytes. The caller must call destroy() on the returned task when done.
 * For on-screen rendering we draw glyph outlines straight from the PDF's embedded fonts
 * (disableFontFace), which avoids missing characters when the browser rejects a font subset.
 */
export function openPdf(bytes: Uint8Array, forRendering = false) {
  return pdfjs.getDocument({ data: bytes, ...OPTIONS, disableFontFace: forRendering });
}

/** Reads the text layer of a PDF file into our RawDocument. */
export async function readRawDocument(file: Blob): Promise<RawDocument> {
  const task = openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const doc = await task.promise;
    return await extractRawDocument(doc as unknown as PdfDocLike);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new PdfReadError('הקובץ מוגן בסיסמה.', 'PASSWORD');
    if (name === 'InvalidPDFException') throw new PdfReadError('הקובץ אינו PDF תקין או שהוא פגום.', 'INVALID_PDF');
    throw new PdfReadError(`שגיאה בקריאת הקובץ: ${(e as Error)?.message ?? e}`, 'READ_ERROR');
  } finally {
    await task.destroy();
  }
}
