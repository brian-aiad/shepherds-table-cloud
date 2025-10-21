// src/utils/buildEfapMonthlyPdf.jsx
// EFAP Monthly Calendar PDF generator — numbers only in cells, plus Month/Year text up top.
// Calibrated to your EFAP_Monthly_SignIn_Form.pdf.
// Requires: pdf-lib, file-saver.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { saveAs } from "file-saver";

const TEMPLATE_URL = "/forms/EFAP_Monthly_SignIn_Form.pdf";

/* ────────────────────────────────────────────────────────────────────────────
   CALIBRATION
   ↑ up = increase Y, ↓ down = decrease Y   |   → right = increase X, ← left = decrease X
──────────────────────────────────────────────────────────────────────────── */
const GRID = {
  ORIGIN_X: 38,       // whole calendar left/right
  ORIGIN_Y: 100,      // whole calendar up/down
  COL_W: 78.5,        // spacing between day columns
  ROW_H: 58.8,        // spacing between week rows
};

const OFF = {
  // Day-of-month number (top-left of each cell)
  DAY_NUM_X: 8,
  DAY_NUM_Y: 66.0,

  // Per-day values (labels are pre-printed on form)
  HH_VAL_X: 45,
  HH_VAL_Y: 51.0,
  PP_VAL_X: 45,
  PP_VAL_Y: 26,
};

// Weekly totals column (far-right); numbers only
const WEEKLY = {
  ORIGIN_X: GRID.ORIGIN_X + GRID.COL_W * 7 + 10,
  BOX_W: GRID.COL_W - 18,
  BOX_H: GRID.ROW_H,

  // Value positions inside a weekly box
  HH_VAL_X: 68,
  HH_VAL_Y: 60,
  PP_VAL_X: 68,
  PP_VAL_Y: 41.5,
};

// Footer totals (bottom-right) — numbers only
const FOOTER = {
  MONTH_HH_X: 646, MONTH_HH_Y: 113,
  MONTH_PP_X: 646, MONTH_PP_Y: 90,
  UND_HH_X:   646, UND_HH_Y:   55,
  UND_PP_X:   646, UND_PP_Y:   22,
};

/* ===== Month/Year text (top blanks) =========================================
   These rectangles match the underlined blanks next to "Month:" and "Year:".
   If you need to nudge, tweak x/y/w.
   TIP: set monthYearDebug: true when building to see the boxes.
============================================================================ */
const MONTH_BOX = { x: 115, y: 493, w: 255 }; // centered on "Month: ______" underline
const YEAR_BOX  = { x: 270, y: 493, w: 255 }; // centered on "Year:  ______" underline

/* ============================================================================
   Helpers
============================================================================ */
const fmtKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function monthGrid(year, monthIndex0) {
  const first = new Date(year, monthIndex0, 1);
  const last  = new Date(year, monthIndex0 + 1, 0);

  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // back to Sunday

  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay())); // forward to Saturday

  const grid = [];
  for (let r = 0; r < 6; r++) grid[r] = Array(7).fill(null);

  let i = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const r = Math.floor(i / 7);
    const c = i % 7;
    grid[r][c] = new Date(d);
    i++;
  }
  return grid;
}

function ensureMap(maybeMap) {
  if (maybeMap instanceof Map) return maybeMap;
  const m = new Map();
  if (maybeMap && typeof maybeMap === "object") {
    for (const [k, v] of Object.entries(maybeMap)) m.set(k, v);
  }
  return m;
}

/* ============================================================================
   Builder
============================================================================ */
export async function buildbuildEfapMonthlyPdf({
  year,
  monthIndex0, // 0-based month
  byDayMap = new Map(),           // "YYYY-MM-DD" -> { households, persons }
  monthTotals = { households: 0, persons: 0 },
  unduplicated = { households: 0, persons: 0 },
  header = {},                    // not used for Month/Year (computed from args)
  debug = false,                  // draw faint boxes for the grid
  monthYearDebug = false,         // draw faint boxes for Month/Year placement
}) {
  const bytes = await fetch(TEMPLATE_URL).then((r) => r.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPages()[0];

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const small = 9;
  const tiny  = 8;

  const draw = (x, y, text, size = small, f = font) =>
    page.drawText(String(text ?? ""), { x, y, size, font: f, color: rgb(0, 0, 0) });

  const byDay = ensureMap(byDayMap);

  // ----- Month & Year (centered inside the underlines) -----
  const monthName = new Date(year, monthIndex0, 1).toLocaleString(undefined, { month: "long" });
  const monthSize = 13;
  const yearSize  = 13;

  const monthWidth = bold.widthOfTextAtSize(monthName, monthSize);
  const yearText   = String(year);
  const yearWidth  = bold.widthOfTextAtSize(yearText, yearSize);

  const monthX = MONTH_BOX.x + (MONTH_BOX.w - monthWidth) / 2;
  const yearX  = YEAR_BOX.x  + (YEAR_BOX.w  - yearWidth)  / 2;

  if (monthYearDebug) {
    // light visual guides for the Month/Year boxes
    page.drawRectangle({ x: MONTH_BOX.x, y: MONTH_BOX.y - 3, width: MONTH_BOX.w, height: 20, opacity: 0.15, color: rgb(0.7, 0.9, 1) });
    page.drawRectangle({ x: YEAR_BOX.x,  y: YEAR_BOX.y  - 3, width: YEAR_BOX.w,  height: 20, opacity: 0.15, color: rgb(0.7, 0.9, 1) });
  }

  page.drawText(monthName, { x: monthX, y: MONTH_BOX.y, size: monthSize, font: bold, color: rgb(0,0,0) });
  page.drawText(yearText,  { x: yearX,  y: YEAR_BOX.y,  size: yearSize,  font: bold, color: rgb(0,0,0) });

  // ----- Calendar grid -----
  const grid = monthGrid(year, monthIndex0);

  for (let r = 0; r < 6; r++) {
    let weeklyHH = 0;
    let weeklyPP = 0;

    for (let c = 0; c < 7; c++) {
      const d = grid[r][c];
      if (!d) continue;

      // Bottom-left origin of this cell
      const x0 = GRID.ORIGIN_X + c * GRID.COL_W;
      const y0 = GRID.ORIGIN_Y + (5 - r) * GRID.ROW_H;

      if (debug) {
        page.drawRectangle({
          x: x0, y: y0, width: GRID.COL_W, height: GRID.ROW_H,
          color: rgb(0.95, 0.95, 0.95), opacity: 0.22,
          borderWidth: 0.25, borderColor: rgb(0.6, 0.6, 0.6),
        });
      }

      // Day number (top-left of the cell)
      draw(x0 + OFF.DAY_NUM_X, y0 + OFF.DAY_NUM_Y, d.getDate(), tiny);

      // Values for days that belong to the selected month
      if (d.getMonth() === monthIndex0) {
        const k = fmtKey(d);
        const a = byDay.get(k) || { households: 0, persons: 0 };

        // numbers only (labels are pre-printed)
        draw(x0 + OFF.HH_VAL_X, y0 + OFF.HH_VAL_Y, a.households, tiny, bold);
        draw(x0 + OFF.PP_VAL_X, y0 + OFF.PP_VAL_Y, a.persons,   tiny, bold);

        weeklyHH += Number(a.households || 0);
        weeklyPP += Number(a.persons || 0);
      }
    }

    // Weekly totals column (right side)
    const wx = WEEKLY.ORIGIN_X;
    const wy = GRID.ORIGIN_Y + (5 - r) * WEEKLY.BOX_H;

    if (debug) {
      page.drawRectangle({
        x: wx, y: wy, width: WEEKLY.BOX_W, height: WEEKLY.BOX_H,
        color: rgb(0.9, 0.95, 1), opacity: 0.2,
        borderWidth: 0.25, borderColor: rgb(0.2, 0.4, 0.8),
      });
    }

    draw(wx + WEEKLY.HH_VAL_X, wy + WEEKLY.HH_VAL_Y, weeklyHH, tiny, bold);
    draw(wx + WEEKLY.PP_VAL_X, wy + WEEKLY.PP_VAL_Y, weeklyPP, tiny, bold);
  }

  // Footer totals
  draw(FOOTER.MONTH_HH_X, FOOTER.MONTH_HH_Y, monthTotals.households, small, bold);
  draw(FOOTER.MONTH_PP_X, FOOTER.MONTH_PP_Y, monthTotals.persons,    small, bold);
  draw(FOOTER.UND_HH_X,   FOOTER.UND_HH_Y,   unduplicated.households, small, bold);
  draw(FOOTER.UND_PP_X,   FOOTER.UND_PP_Y,   unduplicated.persons,    small, bold);

  return await pdf.save();
}

/* ============================================================================
   Convenience helpers
============================================================================ */
export function efapMonthlySuggestedFileName({ year, monthIndex0, site = "ShepherdsTable" } = {}) {
  const monthName = new Date(year, monthIndex0, 1).toLocaleString(undefined, { month: "short" });
  return `EFAP_Monthly_${site}_${monthName}_${year}.pdf`;
}

export async function downloadbuildEfapMonthlyPdf(opts) {
  const bytes = await buildbuildEfapMonthlyPdf(opts);
  const name =
    opts?.suggestedName ||
    efapMonthlySuggestedFileName({
      year: opts.year,
      monthIndex0: opts.monthIndex0,
      site: opts?.site,
    });
  const blob = new Blob([bytes], { type: "application/pdf" });
  saveAs(blob, name);
}
