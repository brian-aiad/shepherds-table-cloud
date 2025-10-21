// src/utils/buildEfapDailylyPdf.js
// EFAP sign-in (fillable) PDF generator — tuned for the latest Reports.jsx
// Template must be at: public/forms/EFAP_Daily_SignIn_Form.pdf
// npm i pdf-lib

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const TEMPLATE_URL = "/forms/EFAP_Daily_SignIn_Form.pdf";

export function efapSuggestedFileName(dateKey, site = "ShepherdsTable") {
  return `EFAP_${site}_${dateKey}.pdf`;
}

/* ===========================
   TUNING KNOBS
   =========================== */

// How many numbered lines per page on the sheet
const ROWS_PER_PAGE = 20;

// Row 1 vertical position (y). Your first row is aligned; keep as tuned.
const START_Y = 465;

// Distance between rows (increase for more spacing; decrease for tighter)
const ROW_HEIGHT = 18.75;

// Text field height (visual size of each box)
const DEFAULT_FIELD_HEIGHT = 16;

/** Column X (left/right) positions */
const COL_X = {
  name: 58,
  address: 217,
  zip: 372,
  householdSize: 431,
  // Base X for the Yes/No area; we apply offsets for the two boxes
  firstTime: 471,
};

/** Text field widths */
const COL_WIDTH = {
  name: 152,
  address: 153,
  zip: 46,
  householdSize: 20,
};

/** Optional per-column height overrides (falls back to DEFAULT_FIELD_HEIGHT) */
const COL_HEIGHT = {};

/** Global Y nudges per column (applies to every row in that column) */
const COL_Y_NUDGE = {
  name: 0,
  address: 0,
  zip: 0,
  householdSize: 0,
  firstTime: +0.5, // move both Yes/No checkboxes up slightly
};

/** Per-row Y nudges (1-based). Use to tweak a single misaligned row. */
const ROW_Y_NUDGE = {
  // 7: +1,
};

/** Offsets inside the Yes/No area (distance from COL_X.firstTime) */
const YES_OFFSET_X = 1;
const NO_OFFSET_X = 59;

/** Checkbox size (the printed boxes are ~12–14pt) */
const CHECK_SIZE = 15;

/** --- Totals row (the very bottom line of the page) --- */
const TOTALS = {
  // Base Y for the totals row = the "row after #20" plus a small nudge down.
  // If the numbers sit a tad high/low, tweak this by +/- 2–5.
  yNudge: -6,
  // Widths for the three bottom boxes (Family Size total, Yes total, No total)
  hhWidth: 28,
  ynWidth: 22,
};

/** --- Food Bank Name line (appears under the totals row) ---
 * These values are tuned for the standard EFAP form (EFA 7 (1/25)).
 * If the text sits a hair off, nudge x/y/width slightly.
 */
const FOOD_BANK = {
  defaultText: "We Help (2046)",
  // Horizontal position: the blue fill box starts ~under the label "Food Bank Name:"
  x: 135.5,
  // Position relative to the totals row baseline (lower on the page → subtract)
  // Increase yOffset to move the text further *below* the totals line.
  yOffsetFromTotals: 33,
  width: 440,
  height: 16,
};

/** --- Date stamp (top-right of every page) --- */
const DATE_STAMP = {
  enabled: true,      // leave on; text only draws if a value is provided
  margin: 28,         // ~0.4in from top/right edges
  fontSize: 11,
  color: rgb(0.25, 0.25, 0.25), // subtle gray
  prefix: "",         // e.g., "EFAP Date: " if you want
};

/** --- Page counter (top-left of every page) --- */
const PAGE_STAMP = {
  enabled: true,
  margin: 28,                // ~0.4in from top/left edge
  fontSize: 11,
  color: rgb(0.25, 0.25, 0.25),
  prefix: "EFAP ",          // yields "EFAP 1 of 2"
  // If you ever want just "1 / 2", set prefix to "".
};

/** Render order (left → right) */
const COL_ORDER = ["name", "address", "zip", "householdSize", "firstTime"];

/* ===========================
   BUILDER
   =========================== */

export async function buildbuildEfapDailylyPdf(rows, opts = {}) {
  // rows come from Reports.jsx shaped like:
  // { name, address, zip, householdSize: number, firstTime: boolean | "" }
  const foodBankName = opts.foodBankName ?? FOOD_BANK.defaultText;

  // Optional date label shown top-right on each page.
  // You can pass any of: opts.dateStamp, opts.dateText, opts.dateKey, or opts.date.
  // Example: "2025-10-08" (hyphens recommended). We normalize spaces/slashes/dots.
  const dateRaw =
    opts.dateStamp ?? opts.dateText ?? opts.dateKey ?? opts.date ?? "";
  const dateLabel =
    typeof dateRaw === "string" && dateRaw.trim()
      ? (DATE_STAMP.prefix || "") +
        dateRaw.trim().replace(/[./]/g, "-").replace(/\s+/g, "-")
      : "";

  // Load template
  const templateBytes = await fetch(TEMPLATE_URL).then((r) => r.arrayBuffer());
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  // Duplicate first page for all required pages
  const totalPages = Math.max(1, Math.ceil((rows?.length || 0) / ROWS_PER_PAGE));
  for (let i = 1; i < totalPages; i++) {
    const [copy] = await pdfDoc.copyPages(pdfDoc, [0]);
    pdfDoc.addPage(copy);
  }
  const pages = pdfDoc.getPages().slice(0, totalPages);

  // Default appearance for text fields (prevents /DA errors)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Helpers
  const heightFor = (key) => COL_HEIGHT[key] ?? DEFAULT_FIELD_HEIGHT;
  const widthFor = (key) => COL_WIDTH[key] ?? 80;
  const baseYForRow = (rowIdx0) =>
    START_Y - rowIdx0 * ROW_HEIGHT + (ROW_Y_NUDGE[rowIdx0 + 1] || 0);
  const yFor = (rowIdx0, key) => baseYForRow(rowIdx0) + (COL_Y_NUDGE[key] || 0);

  const addTextField = (page, fieldName, value, x, y, w, h) => {
    const tf = form.createTextField(fieldName);
    tf.setText(value ?? "");
    tf.defaultUpdateAppearances(font);
    tf.addToPage(page, { x, y, width: w, height: h });
    tf.enableReadOnly();
  };

  const addCheckBox = (page, fieldName, checked, x, y, size = CHECK_SIZE) => {
    const cb = form.createCheckBox(fieldName);
    cb.addToPage(page, { x, y, width: size, height: size });
    if (checked) cb.check();
    else cb.uncheck();
    cb.enableReadOnly();
  };

  // Build pages
  for (let p = 0; p < totalPages; p++) {
    const page = pages[p];

    // ===== Page counter (top-left) =====
    if (PAGE_STAMP.enabled && totalPages >= 1) {
      const { height } = page.getSize();
      const label = `${PAGE_STAMP.prefix}${p + 1} of ${totalPages}`;
      page.drawText(label, {
        x: PAGE_STAMP.margin,
        y: height - PAGE_STAMP.margin,
        size: PAGE_STAMP.fontSize,
        font,
        color: PAGE_STAMP.color,
      });
    }

    // ===== Date label (top-right) =====
    if (DATE_STAMP.enabled && dateLabel) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(dateLabel, DATE_STAMP.fontSize);
      const x = width - DATE_STAMP.margin - textWidth;
      const y = height - DATE_STAMP.margin;
      page.drawText(dateLabel, {
        x,
        y,
        size: DATE_STAMP.fontSize,
        font,
        color: DATE_STAMP.color,
      });
    }

    const start = p * ROWS_PER_PAGE;
    const end = Math.min(rows.length, start + ROWS_PER_PAGE);
    const slice = rows.slice(start, end);

    // Per-row entries
    slice.forEach((r, i) => {
      // NAME
      {
        const key = "name";
        const x = COL_X[key];
        const y = yFor(i, key);
        addTextField(
          page,
          `${key}_p${p + 1}_r${i + 1}`,
          (r.name ?? "").toString(),
          x,
          y,
          widthFor(key),
          heightFor(key)
        );
      }

      // ADDRESS
      {
        const key = "address";
        const x = COL_X[key];
        const y = yFor(i, key);
        addTextField(
          page,
          `${key}_p${p + 1}_r${i + 1}`,
          (r.address ?? "").toString(),
          x,
          y,
          widthFor(key),
          heightFor(key)
        );
      }

      // ZIP
      {
        const key = "zip";
        const x = COL_X[key];
        const y = yFor(i, key);
        addTextField(
          page,
          `${key}_p${p + 1}_r${i + 1}`,
          (r.zip ?? "").toString(),
          x,
          y,
          widthFor(key),
          heightFor(key)
        );
      }

      // HOUSEHOLD SIZE
      {
        const key = "householdSize";
        const x = COL_X[key];
        const y = yFor(i, key);
        addTextField(
          page,
          `${key}_p${p + 1}_r${i + 1}`,
          (r.householdSize ?? "").toString(),
          x,
          y,
          widthFor(key),
          heightFor(key)
        );
      }

      // FIRST TIME (real Yes/No checkboxes)
      {
        const key = "firstTime";
        const y = yFor(i, key);
        const yesX = COL_X[key] + YES_OFFSET_X;
        const noX = COL_X[key] + NO_OFFSET_X;

        // Reports may pass true / false / "" (empty if unknown)
        const val = r.firstTime;
        const isYes = val === true || String(val).toLowerCase() === "yes";
        const isNo = val === false || String(val).toLowerCase() === "no";

        addCheckBox(page, `${key}_yes_p${p + 1}_r${i + 1}`, isYes, yesX, y);
        addCheckBox(page, `${key}_no_p${p + 1}_r${i + 1}`, isNo, noX, y);
      }
    });

    // ===== Page totals (bottom row) =====
    // Sum only rows that appear on this page.
    const totals = slice.reduce(
      (acc, r) => {
        const n = Number(r.householdSize || 0);
        if (!Number.isNaN(n)) acc.hh += n;
        const v = r.firstTime;
        const yes = v === true || String(v).toLowerCase() === "yes";
        const no = v === false || String(v).toLowerCase() === "no";
        if (yes) acc.yes += 1;
        if (no) acc.no += 1;
        return acc;
      },
      { hh: 0, yes: 0, no: 0 }
    );

    // Coordinates for the totals boxes.
    // We place them on the "row after #20" with a small nudge so they land
    // inside the three summary boxes printed at the very bottom of the form.
    const totalsYBase = baseYForRow(ROWS_PER_PAGE) + TOTALS.yNudge;

    // Total Household
    addTextField(
      page,
      `total_household_p${p + 1}`,
      totals.hh ? String(totals.hh) : "",
      COL_X.householdSize,
      totalsYBase + (COL_Y_NUDGE.householdSize || 0),
      TOTALS.hhWidth,
      heightFor("householdSize")
    );

    // Total YES
    addTextField(
      page,
      `total_yes_p${p + 1}`,
      totals.yes ? String(totals.yes) : "",
      COL_X.firstTime + YES_OFFSET_X,
      totalsYBase + (COL_Y_NUDGE.firstTime || 0),
      TOTALS.ynWidth,
      heightFor("householdSize")
    );

    // Total NO
    addTextField(
      page,
      `total_no_p${p + 1}`,
      totals.no ? String(totals.no) : "",
      COL_X.firstTime + NO_OFFSET_X,
      totalsYBase + (COL_Y_NUDGE.firstTime || 0),
      TOTALS.ynWidth,
      heightFor("householdSize")
    );

    // ===== Food Bank Name (line under totals) =====
    // This writes into the long rectangle next to the label "Food Bank Name:"
    addTextField(
      page,
      `food_bank_name_p${p + 1}`,
      foodBankName,
      FOOD_BANK.x,
      totalsYBase - FOOD_BANK.yOffsetFromTotals, // a bit below the totals row
      FOOD_BANK.width,
      FOOD_BANK.height
    );
  }

  return await pdfDoc.save();
}

/*
QUICK TWEAKS
- If the three bottom numbers are a hair too high/low inside their boxes,
  adjust TOTALS.yNudge by +/- 1–4.
- If they’re a smidge too far left/right, tweak YES_OFFSET_X / NO_OFFSET_X or
  COL_X.householdSize.
- Spacing and column widths: ROW_HEIGHT and COL_WIDTH.* as usual.
- If the Food Bank name isn’t perfectly centered in its box, nudge:
  FOOD_BANK.x, FOOD_BANK.yOffsetFromTotals, FOOD_BANK.width, FOOD_BANK.height.

DATE STAMP
- Pass a date string when you build the PDF:
    await buildbuildEfapDailylyPdf(rows, { dateStamp: "2025-10-08" });
  (You can also pass dateKey/date/dateText; we normalize separators.)
- To change look/placement, tweak DATE_STAMP.* above.

PAGE STAMP
- The page counter prints top-left like "EFAP 1 of 3".
- Customize prefix via PAGE_STAMP.prefix (set "" for bare "1 of N").
- Disable by setting PAGE_STAMP.enabled = false.
*/
