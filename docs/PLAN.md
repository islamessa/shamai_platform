# Plan & architecture

## Goal
Appraisers retype ownership data from נסח טאבו PDFs into the "בעלות" sheet of their Excel template. This tool automates it, with accuracy guarantees suitable for legal property data.

## v1 decisions
| Topic | Decision | Why |
|---|---|---|
| Users | One office, no accounts | Fastest to launch |
| Output | One Excel per PDF, sheet "בעלות" only, + ZIP + processing report | As requested |
| Flagged files | Review screen: PDF beside an editable form; approve; overrides need a written reason | Fix in place, with an audit trail |
| Hosting | Static site (GitHub Pages / Cloudflare Pages), **$0** | Free and simple |
| Processing | **In the browser** (pdf.js + ExcelJS + JSZip) | Files never leave the office PC, so there is no server-side personal data to secure or delete |

## How the PDF is read
Land Registry extracts are born-digital (Microsoft Reporting Services) with embedded Unicode fonts. pdf.js returns every table cell as a text item with coordinates and **correct logical-order Hebrew**. (pdfplumber, by contrast, returns reversed Hebrew; that was checked.) No OCR and no AI are used.

Parser (`src/core/parseNesach.ts`):
1. Group items into lines by y. The content stream is not in reading order.
2. Remove repeated page headers (up to the "גוש: … חלקה: …" line) and footers ("עמוד X מתוך Y").
3. Split into sections by standalone titles: תיאור הנכס, בעלויות, הערות, משכנתאות, חכירות, … , סוף נתונים.
4. Area: the value under the `שטח במ"ר` column header (right edges align; cells are right-aligned).
5. Owners: each block starts with a header row (מס' שטר | תאריך | מהות פעולה | הבעלים | [סוג זיהוי | מס' זיהוי]). Values are mapped to columns by x-range. The share is the value printed directly under "החלק בנכס". "הערות:" lines are owner notes.
6. Anything unexpected becomes an Issue, so the file is flagged for review instead of guessed.

## Validation (`src/core/validate.ts` + parser checks)
Errors (the file needs review): shares ≠ exactly 1 (BigInt fractions); ID not 9 digits or bad check digit; owner count ≠ "החלק בנכס" labels ≠ share values; גוש/חלקה inconsistent across pages; area missing; reversed Hebrew (final letter mid-word); missing "סוף נתונים"; unknown text in an owner block; unsupported sections (חכירות, תת-חלקה).
Failed: no text layer (scanned), not a נסח, corrupt/encrypted PDF.
Warnings/info (not blocking): an ID printed without leading zeros that is valid once padded (padded + reported); owner without ID (output "-"); notes/mortgages present; PDF title ≠ גוש_חלקה; the same parcel twice in one batch.

### Lessons from real samples (2019 format, Reporting Services 12)
- Share printed as **"בשלמות"**, which means 1/1.
- IDs printed **without leading zeros** (`12345609`). Padded only when the check digit is then valid. An old ID such as `7654300` is invalid even padded, so it is flagged for review.
- Old deed numbers look like shares (`5097/1979`), so shares are recognized by **position** (under their label), not by pattern alone.
- Notes can contain "החלק בנכס 1/3" (a lien on a share). These are outside the owners section and are not counted.
- In the review screen, PDF pages are rendered with `disableFontFace` (glyph outlines from the PDF), because some embedded font subsets lose characters when loaded as browser fonts.

### Round 2: agent vs platform (5 more extracts)
Each file was read by hand (visually) and by the platform (core code and the built web app in Chromium), then compared.
Result: **100% field-level agreement** (גוש, חלקה, area, owner names, IDs, shares).
Over 10 PDFs in total there were no reading errors. Every "needs review" was a genuine issue printed in the source document (old IDs).

Decision: keep the deterministic text-layer parser.
- OCR would only add risk on digital PDFs; it is kept for scanned files (Phase 3).
- An AI reader produced the same results, but would need a server, cost money and send personal data to a third party.

Gaps found, and how they were fixed:
- **The same extract uploaded twice.** `src/core/batch.ts` marks the copy "כפול" and leaves it out of the ZIP.
  Two *different* extracts of the same parcel get a warning on both.
- **An ID printed as "1/234560".** New message `ID_NONSTANDARD` (old ID; compare and fix by hand, or approve with a note). It is never auto-fixed.
- **Easement section (זיקות הנאה) not mentioned.** Now reported as info, together with שעבודים, צווים and הצמדות.
- **Noisy table.** Repeated "ID padded" warnings collapse into one line; the full list is in the review screen and the report.
- **New regression fixtures:** `old-easement-6-owners` (338/2815 + 45/563, easement) and `old-slash-id`.

## Excel output (`src/core/excel/ownershipSheet.ts`)
The layout was reproduced from the office file and verified **cell by cell** (values, formulas, number formats, fonts, fills, borders, merges, column widths, row heights) against the office's hand-made Excel for the sample parcel (`npm run compare:private`). It was also re-read independently with openpyxl and recalculated in LibreOffice (totals 100%, area = registered area).
Intentional difference: every cell has right-to-left reading order (as requested).

## Testing
- Unit tests: fractions, ID check digit and padding, Hebrew guards.
- Golden tests: 6 **anonymized** real extracts:
  - 2026 standard;
  - 2019 "בשלמות" person;
  - 2019 state;
  - 2019 multi-owner with notes;
  - 2019 6 owners with an easement;
  - 2019 non-standard ID.
- Unit tests for batch duplicate detection.
- Mutation tests: a removed owner, a wrong ID digit, a reversed name, a missing share, a scanned file, not a נסח, a lease section, a truncated file, a header mismatch and a missing area are all caught.
- Local-only with real data: `compare:private` (Excel diff), `e2e:private` (real browser: upload → statuses → review/approve → ZIP; asserts no external network requests).

## Roadmap
- **Phase 2:** collect 20–30 more varied extracts (companies/ח.פ, very many owners, other registry offices) and add each as an anonymized fixture. Support בית משותף (תת-חלקות, הצמדות) and חכירות. List mortgages/notes in the report.
- **Phase 3:** scanned extracts via in-browser OCR (tesseract.js, Hebrew), always forced to review.
- **Phase 4:** accounts, multiple offices and history. Add a backend (e.g. Supabase or Cloud Run, Tel Aviv region) with auth, encrypted short-lived storage, auto-delete and a privacy review. `src/core` is reused unchanged. Generate שווי קודם / טבלת הקצאה ואיזון from the same data.

## Risks
| Risk | Mitigation |
|---|---|
| Registry changes its layout | Strict structure detection (review/fail, never guess); the fixture corpus grows with every new case |
| Genuine Σ≠1 extracts | Override with a mandatory note, recorded in the report |
| Real data committed to the repo | `samples/private/` git-ignored; fixtures anonymized and checked for leaks by the capture script |
| Very large batches | Sequential queue; pdf.js parses in its own Web Worker; each PDF is released after parsing |
