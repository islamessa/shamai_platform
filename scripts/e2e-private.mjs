/**
 * LOCAL ONLY end-to-end test with the real (private) samples.
 *
 *   npm run build && npm run e2e:private
 *
 * Serves dist/, opens it in Chromium, uploads every samples/private/*.pdf, waits for the statuses,
 * approves one flagged file through the review screen, downloads the ZIP and checks its contents.
 * Screenshots are written to samples/private/e2e/ (git-ignored, they contain real data).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const DIR = 'samples/private';
const OUT = join(DIR, 'e2e');
const PORT = 4173;
mkdirSync(OUT, { recursive: true });

const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const server = spawn('npx', ['vite', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 60) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 250));
}

const problems = [];
// A UTF-8 locale is needed for Chromium to keep Hebrew download file names (minimal containers have none).
// channel 'chromium' = the full browser (has the built-in PDF viewer used by the review screen)
const browser = await chromium.launch({ channel: 'chromium', env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  // Simulate a browser that is NOT the very latest version: remove the newest JavaScript features from the page and
  // from the pdf.js worker. (The modern pdf.js build needed them and hung on such browsers; this guards against regressions.)
  const STRIP = `delete Promise.try; delete Map.prototype.getOrInsertComputed; delete Map.prototype.getOrInsert;
    delete WeakMap.prototype.getOrInsertComputed; delete WeakMap.prototype.getOrInsert; delete Math.sumPrecise;
    delete Uint8Array.prototype.toHex; delete Uint8Array.fromBase64; delete Uint8Array.prototype.toBase64;`;
  await page.addInitScript(STRIP);
  await page.route(/pdf\.worker.*\.mjs/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `${STRIP}\n${await res.text()}` });
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(`${BASE}/`);
  const pdfs = readdirSync(DIR).filter((f) => f.endsWith('.pdf')).sort().map((f) => join(DIR, f));
  await page.getByTestId('file-input').setInputFiles(pdfs);
  await page.waitForFunction((n) => {
    const badges = [...document.querySelectorAll('[data-testid="status"]')];
    return badges.length === n && badges.every((b) => !b.textContent.includes('בעיבוד'));
  }, pdfs.length, { timeout: 60_000 });

  const rows = await page.$$eval('table.batch tbody tr', (trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].slice(1, 5).map((td) => td.textContent.trim())),
  );
  console.log('Statuses after upload:');
  for (const r of rows) console.log('  ', r.join(' | '));
  await page.screenshot({ path: join(OUT, '1-batch.png'), fullPage: true });

  // open the first file that needs review, approve it with a note
  const reviewRow = page.locator('tr.row-review').first();
  if (await reviewRow.count()) {
    await reviewRow.getByRole('button', { name: 'בדיקה ועריכה' }).click();
    await page.locator('.pdf-frame, .pdf-page').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(OUT, '2-review.png') });
    await page.locator('.override textarea').fill('מספר ת.ז ישן ללא ספרת ביקורת; נבדק מול הנסח');
    await page.getByTestId('approve').click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: join(OUT, '3-after-approve.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /הורדת הכל/ }).click()]);
  const zipPath = join(OUT, 'download.zip');
  await download.saveAs(zipPath);
  console.log(`\nZIP: ${download.suggestedFilename()}`);
  if (!/^בעלות_מנסחים_\d{4}-\d{2}-\d{2}\.zip$/.test(download.suggestedFilename())) problems.push('unexpected ZIP file name');
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  for (const name of Object.keys(zip.files).sort()) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await zip.files[name].async('nodebuffer'));
    const ws = wb.worksheets[0];
    if (name.startsWith('דוח')) {
      console.log(`  ${name}: sheets=${wb.worksheets.map((w) => w.name).join(', ')}, rows=${ws.actualRowCount}`);
      continue;
    }
    const total = [...Array(ws.rowCount).keys()].map((i) => ws.getRow(i + 1)).find((r) => r.getCell('F').value === 'סה"כ');
    let marked = 0;
    ws.eachRow((row) => row.eachCell((c) => c.note && marked++));
    console.log(`  ${name}: sheet=${ws.name} rtl=${ws.views[0]?.rightToLeft} owners=${total.number - 5} total=${total.getCell('I').value.result} marked-cells=${marked}`);
  }
  // only real network traffic counts (chrome:// and chrome-extension:// are the browser's own built-in PDF viewer)
  const external = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(BASE));
  console.log(`\nNetwork requests to other hosts: ${external.length === 0 ? 'none' : external.join(', ')}`);
  if (external.length) problems.push('external requests made');
} finally {
  await browser.close();
  server.kill();
}
if (problems.length) {
  console.error('\nPROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('\nE2E OK');
