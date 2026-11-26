# Shamai Platform: נסח טאבו → Excel "בעלות"

כלי אינטרנטי לשמאי מקרקעין: מעלים נסחי טאבו (PDF), כמה שרוצים בבת אחת, ומקבלים לכל נסח קובץ Excel עם גיליון **"בעלות"** בדיוק לפי התבנית של המשרד: גוש, חלקה, שטחים, בעלים, ת.ז, חלקים, נוסחאות חיות ושורת סה"כ.

> 🔒 **פרטיות:** הקבצים מעובדים **בתוך הדפדפן במחשב שלכם**. שום קובץ או נתון אינו נשלח לשרת. האתר הוא דף סטטי בלבד; מדיניות אבטחה (CSP) בדף חוסמת טכנית כל שליחת מידע החוצה.

## איך משתמשים
1. פותחים את האתר וגוררים לתוכו קבצי נסח (PDF).
2. לכל קובץ מוצג סטטוס:
   - ✅ **תקין**: כל הבדיקות עברו.
   - ⚠️ **הופק עם הערות**: הקובץ הופק ונכלל בהורדה. הנתונים הועתקו כפי שהם מופיעים בנסח (למשל ת.ז ישנה בפורמט לא תקני).
     התא הרלוונטי מסומן באקסל בצבע ובהערה, והסיבה מפורטת בדוח. אפשר לתקן ב"בדיקה ועריכה" (הנסח מוצג לצד הטופס).
   - ❌ **לא נקרא אוטומטית**: למשל קובץ סרוק (ללא טקסט), פגום או מוגן בסיסמה. אפשר להשלים בכפתור "הזנה ידנית".
3. (לא חובה) ממלאים "מספר תכנית" לכותרת.
4. "הורדת הכל (ZIP)": קובץ Excel **לכל נסח שנקרא**, ועוד **דוח_עיבוד.xlsx** עם הסטטוס, ההערות וכל שינוי ידני.

אף קובץ לא "נתקע": כל נסח שנקרא מפיק Excel. תיקונים בטוחים נעשים אוטומטית ונרשמים בהערה בתא:
- ת.ז ללא אפסים מובילים מושלמת לפי ספרת הביקורת.
- שם שנקרא בסדר הפוך מתוקן.

ערכים שאי אפשר לתקן בוודאות נשארים כפי שהם בנסח ומסומנים, כך ששום דבר לא יוצא "בשקט".
(אפשר לכבות את הסימון באקסל בתיבת הסימון שבראש העמוד.)
אם אותו נסח הועלה פעמיים, העותק מסומן "כפול" ולא נכלל בהורדה. אם הועלו שני נסחים שונים לאותה חלקה, מוצגת אזהרה על שניהם.

## איך מובטח הדיוק
- נסחי טאבו מהאתר הממשלתי הם PDF דיגיטלי: הטקסט שמור בקובץ כתווים אמיתיים. הקוד קורא את התווים המדויקים (כמו העתק-הדבק), **בלי OCR ובלי AI**.
- **"לעולם לא לנחש"**: כל טקסט שהמערכת לא יודעת לשייך מסומן בהערה. ערך מפוקפק לא "מתוקן" לבד; הוא נשאר כמו בנסח ומסומן.
- בדיקות אוטומטיות לכל קובץ:
  - סכום החלקים חייב להיות **בדיוק 1** (חשבון שברים מדויק; גם מכנים שונים כמו 970/10000 ו-197/2000).
  - ת.ז: 9 ספרות + **ספרת ביקורת**. אפסים מובילים נשמרים (הת.ז נשמרת כטקסט).
  - **מספר הבעלים שנקרא = מספר השדות "החלק בנכס" בנסח = מספר ערכי החלקים**, בספירה בלתי תלויה.
  - גוש/חלקה זהים בכותרות כל העמודים, וקיים "סוף נתונים" (הקובץ שלם).
  - **זיהוי עברית הפוכה**: אות סופית (ך ם ן ף ץ) באמצע מילה.
- נסחים ישנים: "בשלמות" מתורגם ל-1/1. ת.ז שהודפסה בלי אפסים מובילים (למשל `12345609`) מושלמת ל-`012345609` **רק אם ספרת הביקורת תקינה**, וזה נרשם בדוח. אחרת הקובץ מסומן לבדיקה.

## מה עוד לא נתמך (מסומן לבדיקה ידנית)
נסח בית משותף (תת-חלקות), חכירות, נסחים סרוקים (OCR). ראו [docs/PLAN.md](docs/PLAN.md).

---

## Development

```bash
npm install
npm run dev          # local dev server
npm test             # unit + golden + mutation tests (anonymized fixtures, safe for CI)
npm run build        # static site in dist/
```

### Project layout
- `src/core/`: pure TypeScript, no DOM; reusable on a server later.
  - `pdfText.ts`: pdf.js → text items with positions
  - `layout.ts`: groups items into lines
  - `parseNesach.ts`: the parser
  - `validate.ts`: business rules
  - `excel/ownershipSheet.ts`: the "בעלות" sheet
  - `excel/report.ts`: the processing report
- `src/ui/`: React app (upload, batch table, review screen with the PDF beside an editable form, downloads).
- `tests/fixtures/`: **anonymized** text layers of real extracts (fake names/IDs/גוש, real geometry).
- `scripts/capture-fixture.ts`: turns a real PDF into an anonymized fixture, and aborts if any real name/ID remains.

### Real samples (never committed)
Real extracts contain names and Israeli ID numbers. Keep them in `samples/private/` (git-ignored):
```bash
npm run compare:private   # pipeline on samples/private/*.pdf; diff vs samples/private/expected_<gush>_<helka>.xlsx
npm run build
npm run e2e:private       # browser end-to-end test with the real samples
npm run capture-fixture -- samples/private/x.pdf tests/fixtures/<name>   # add a new anonymized regression fixture
```

### Deploy (free)
GitHub Pages: push to `main`, and in GitHub → Settings → Pages set Source to **GitHub Actions** (`.github/workflows/pages.yml`).
On a free GitHub plan Pages needs a public repository. That is fine because the repo holds code only, no data.
Alternatively use Cloudflare Pages (free, works with private repos): build command `npm run build`, output `dist`.
