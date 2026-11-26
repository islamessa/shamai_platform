import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNesach } from '../../src/core/parseNesach';
import type { Issue, ParseResult, RawDocument, RawItem } from '../../src/core/types';
import { autoStatus, validateData } from '../../src/core/validate';

export const FIXTURES = ['standard-2026', 'old-whole-person', 'old-whole-state', 'old-multi-owner'] as const;

const dir = resolve(import.meta.dirname, '../fixtures');

export function loadRaw(name: string): RawDocument {
  return JSON.parse(readFileSync(resolve(dir, `${name}.raw.json`), 'utf8'));
}
export function loadExpected(name: string): Pick<ParseResult, 'ok' | 'data' | 'meta' | 'issues'> {
  return JSON.parse(readFileSync(resolve(dir, `${name}.expected.json`), 'utf8'));
}

/** Full pipeline: parse + data validation → status and all issues. */
export function run(doc: RawDocument) {
  const parsed = parseNesach(doc);
  const issues: Issue[] = [...parsed.issues, ...(parsed.data ? validateData(parsed.data) : [])];
  return { parsed, issues, status: autoStatus(parsed.ok, issues), codes: issues.map((i) => i.code) };
}

/** Deep-cloned document with every item passed through fn (return null to delete the item). */
export function mapItems(doc: RawDocument, fn: (it: RawItem, page: number) => RawItem | null): RawDocument {
  const copy: RawDocument = structuredClone(doc);
  for (const p of copy.pages) p.items = p.items.map((it) => fn(it, p.pageNumber)).filter((x): x is RawItem => x !== null);
  return copy;
}
