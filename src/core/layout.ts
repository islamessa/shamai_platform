import type { RawItem, RawPage } from './types';

export interface Line {
  page: number;
  /** baseline y from page top */
  y: number;
  /** items sorted right-to-left (Hebrew reading order of table cells) */
  items: RawItem[];
  /** items joined with a space, right-to-left */
  text: string;
}

export const rightEdge = (it: RawItem): number => it.x + it.w;

/**
 * Groups a page's items into visual lines. The PDF content stream is NOT in reading order
 * (e.g. the "הערות" section is drawn before the owners on page 2), so we sort by position.
 */
export function toLines(page: RawPage, tolerance = 2): Line[] {
  const items = [...page.items].sort((a, b) => a.y - b.y || rightEdge(b) - rightEdge(a));
  const lines: Line[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(it.y - last.y) <= tolerance) {
      last.items.push(it);
    } else {
      lines.push({ page: page.pageNumber, y: it.y, items: [it], text: '' });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => rightEdge(b) - rightEdge(a));
    l.text = l.items.map((i) => i.str).join(' ');
  }
  return lines;
}
