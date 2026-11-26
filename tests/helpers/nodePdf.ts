import { readFileSync } from 'node:fs';
import { extractRawDocument, type PdfDocLike } from '../../src/core/pdfText';
import type { RawDocument } from '../../src/core/types';

/** Loads a PDF from disk with the Node ("legacy") build of pdf.js and returns our RawDocument. */
export async function loadRawDocumentFromFile(path: string): Promise<RawDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const task = pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 });
  try {
    const doc = await task.promise;
    return await extractRawDocument(doc as unknown as PdfDocLike);
  } finally {
    await task.destroy();
  }
}
