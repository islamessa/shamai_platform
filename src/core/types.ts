/** One text item as produced by pdf.js, normalized. Coordinates are PDF points, y measured from the page top (baseline). */
export interface RawItem {
  str: string;
  /** left edge */
  x: number;
  /** baseline distance from the page top */
  y: number;
  /** item width */
  w: number;
  /** font size / height */
  h: number;
  dir: 'ltr' | 'rtl' | 'ttb';
  fontName?: string;
}

export interface RawPage {
  pageNumber: number;
  width: number;
  height: number;
  items: RawItem[];
}

/** Everything the parser needs from a PDF. Produced by pdfText.ts (browser or Node) or loaded from a test fixture. */
export interface RawDocument {
  /** PDF "Title" metadata, e.g. "1234_56" (גוש_חלקה) for Land Registry extracts */
  title?: string;
  pages: RawPage[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** stable machine code, e.g. SHARES_SUM */
  code: string;
  /** Hebrew, user facing */
  message: string;
  /** 0-based owner index when the issue concerns a specific owner */
  ownerIndex?: number;
  /** 'parse' issues come from reading the PDF structure; 'data' issues are recomputed whenever the data changes */
  source: 'parse' | 'data';
}

export interface Owner {
  name: string;
  /** e.g. "ת.ז", "ח.פ"; null when the extract shows no ID columns (e.g. מדינת ישראל) */
  idType: string | null;
  /** digits as text, leading zeros preserved; null when none */
  idNumber: string | null;
  /** share as written, normalized to "970/10000" */
  share: string;
  deed?: string;
  date?: string;
  action?: string;
  note?: string;
}

export interface ParcelData {
  gush: string;
  helka: string;
  /** registered area (שטח במ"ר) */
  registeredArea: number | null;
  /** area in the plan; defaults to registeredArea */
  planArea: number | null;
  owners: Owner[];
}

export interface ExtractMeta {
  pdfTitle?: string;
  pageCount: number;
  nesachNumber?: string;
  issueDate?: string;
  registryOffice?: string;
  /** section titles in document order */
  sections: string[];
  /** number of owner header rows ("הבעלים" + "מס' שטר") found */
  ownerHeaderCount: number;
  /** number of "החלק בנכס" labels found inside the owners section */
  shareLabelCount: number;
  hasEndMarker: boolean;
  /** gush/helka read from each page header */
  pageHeaders: Array<{ page: number; gush?: string; helka?: string }>;
}

export interface ParseResult {
  /** 'failed' = the file could not be read as a standard נסח at all */
  ok: boolean;
  data?: ParcelData;
  meta: ExtractMeta;
  /** parse-stage issues (structure, counts, unsupported sections ...) */
  issues: Issue[];
}

export type FileStatus = 'processing' | 'ok' | 'review' | 'approved' | 'failed';

export interface AuditEntry {
  time: string;
  field: string;
  before: string;
  after: string;
}
