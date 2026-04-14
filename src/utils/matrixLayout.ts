// Matrix layout maths — extracted from RangeDesign.tsx so the auto-tier
// resolver can run the layout fits-check without rendering the matrix.
//
// The exported entry points are:
//   - computeMatrixLayout(cellCounts, cardFormat, availW, availH, scale)
//       Pure function. Returns { fits, cardW, cardH, colWidths, rowHeights,
//       cellColsPerCol }. Used by RangeDesign at render time and by the
//       auto-tier loop below.
//   - computeMatrixAutoTier(cellCounts, cardFormat, currentAvailW,
//       currentAvailH, currentScale)
//       Walks [1, 1.25, 1.5, 1.75, 2] and returns the smallest scale at
//       which computeMatrixLayout reports fits === true and cardW >=
//       MIN_CARD_WIDTH. Falls through to 2 if nothing fits — at 2× even
//       if cards are still under MIN_CARD_WIDTH the cells `overflow:
//       hidden` keeps the render tidy.

import type { CardFormat } from '../types';

// All inter-cell gaps + cell paddings are this many CSS pixels at
// --ui-scale = 1. The CSS multiplies by var(--ui-scale, 1), so the JS
// layout maths must do the same — the scaled values are passed through
// to computeLayout so the algorithm's "how many card-slots fit per
// column" decision matches what the browser renders.
export const BASE_GAP = 3;

// Hard cap so cards never grow into "huge half-page" territory even when
// the canvas has plenty of slack to give them. v1.9.20 halved this from
// 150 to 75 so sparse plans stop showing gigantic cards with tiny
// content (image stays at 40px max regardless, so a 150px card was 73%
// empty space).
export const MAX_CARD_WIDTH = 75;

// Replaces the old 22px absoluteFloor. The binary search refuses to
// produce a layout below this width — if no `target` configuration fits
// at >= MIN_CARD_WIDTH the result is reported as fits=false, which is
// the auto-tier loop's signal to bump to a higher resolution scale.
export const MIN_CARD_WIDTH = 60;

// Playing-card minimum aspect ratio. Cards never get shorter than
// cardW * this factor, so the default-toggles card shape stays
// pleasingly tall even as the binary search grows cardW to fill
// available space. Content-heavy formats (US/EU/AUS RRP, revenue,
// forecast revenue, category) grow the card past this floor via
// estimateCardHeight — see below.
export const CARD_MIN_ASPECT = 1.4;

// Minimum column width — used as the size of empty columns AND as a
// floor for non-empty columns. Bumped from 30 → 80 in v1.9.20 so the
// matrix-col-header text ("Premium" / "Mid" / "Value") stops spilling
// past narrow columns when they only hold one small card.
export const MIN_COL_WIDTH = 80;
// Empty rows still need a small visible band.
export const MIN_ROW_H = 40;

// .matrix-cell has `border: 1px solid #e8e8e8` — unscaled, 1px each side
// regardless of the slide base scale. With box-sizing: border-box the
// cell's outer width INCLUDES this border, so the flex content area
// inside is `outerW - 2*CELL_BORDER - 2*cellPadding`. Forgetting the
// border meant computeLayout planned column widths 2px too narrow per
// cell, and the rightmost card wrapped to the next row at render time.
const CELL_BORDER = 1;

// Per-cell safety margin — a few pixels of slack baked into every
// cell's planned outer width so the flex layout has breathing room
// for sub-pixel rounding, half-pixel borders, and snap differences
// between the JS plan and the browser's actual layout. Without this
// the binary-search + slot-growth pair produces EXACT fits where
// `content area === N*cardW + (N-1)*cardGap`, and any rounding in
// any direction wraps a card to the next row. 4px (2 each side)
// is invisible visually but eliminates the wrap class entirely.
const CELL_SLACK = 4;

// Auto-tier ladder used by computeMatrixAutoTier.
export const TIER_LADDER = [1, 1.25, 1.5, 1.75, 2] as const;

// ---------------------------------------------------------------
// Card-height estimator
//
// Every Card Format toggle adds a visible line to the matrix card,
// and the JS layout maths has to know how tall the card actually is
// to decide how many rows of cards a cell needs. Using a fixed
// aspect-ratio constant (the pre-1.9.12 CARD_ASPECT = 1.4) worked
// when only image + name + sku + vol + uk-rrp were on, but turning
// on US/EU/AUS RRP, Revenue, Forecast Revenue, Category etc. grows
// the card by ~10px per extra line and the algorithm under-allocated
// row height, letting the bottom card clip at the cell border.
//
// Values here mirror the px / line-height in RangeDesign.css:
//   .matrix-card         padding: 4px   border: 1.5px  (chrome = 8 + 3)
//   .matrix-card-image   width: 70%; aspect-ratio: 1; max-height: 40px; margin-bottom: 2px  → ≈ 42
//   .matrix-card-name    font-size: 8px; line-height: 1.15; max-height: 2.3em              → ≈ 21
//   all other fields     font-size: 7px                                                    → ≈ 10 each
// ---------------------------------------------------------------
const CARD_PADDING_V = 8;    // .matrix-card padding: top + bottom
const CARD_BORDER_V = 3;     // .matrix-card border: 1.5 top + 1.5 bottom
const CARD_CHROME_V = CARD_PADDING_V + CARD_BORDER_V;
const CARD_LINE_H = 10;      // one line of 7px-font field content
const CARD_NAME_H = 21;      // name can wrap to 2 lines
const CARD_IMG_MAX = 40;
const CARD_IMG_MARGIN = 2;

export function estimateCardHeight(cf: CardFormat, cardW: number): number {
  // Chrome (padding + border) is part of the card's outer box. Leaving
  // the border out was a 3px drift that let borderline layouts squeak
  // past the fit check and then clip at render time.
  let h = CARD_CHROME_V;
  if (cf.showImage) {
    // Image is 70% of card width with aspect-ratio 1, capped at 40px.
    h += Math.min(CARD_IMG_MAX, cardW * 0.7) + CARD_IMG_MARGIN;
  }
  if (cf.showName) h += CARD_NAME_H;
  if (cf.showSku) h += CARD_LINE_H;
  if (cf.showRrp) h += CARD_LINE_H;
  if (cf.showUsRrp) h += CARD_LINE_H;
  if (cf.showEuRrp) h += CARD_LINE_H;
  if (cf.showAusRrp) h += CARD_LINE_H;
  if (cf.showVolume) h += CARD_LINE_H;
  if (cf.showForecastVolume) h += CARD_LINE_H;
  if (cf.showRevenue) h += CARD_LINE_H;
  if (cf.showForecastRevenue) h += CARD_LINE_H;
  if (cf.showCategory) h += CARD_LINE_H;
  // Clamp to the playing-card minimum. At the default toggle set the
  // minimum usually wins so cards keep a ~1:1.4 shape; with extra
  // fields on, content height takes over and cards grow past it.
  return Math.max(h, cardW * CARD_MIN_ASPECT);
}

// ---------------------------------------------------------------
// Inner fits-check
//
// Given an explicit cellColsPerCol (how many cards per row each matrix
// column fits) compute concrete column widths + row heights and report
// whether the layout fits within availW × availH.
// ---------------------------------------------------------------
export function computeLayout(
  cardW: number,
  cardH: number,
  cellCounts: number[][], // [row][col]
  cellColsPerCol: number[], // [col]  — explicit horizontal slots per col
  numCols: number,
  numRows: number,
  availW: number,
  availH: number,
  gap: number,
  cardGap: number,
  cellPadding: number,
): { fits: boolean; colWidths: number[]; rowHeights: number[] } {

  // Column widths from the explicit cellCols. The +CELL_BORDER*2
  // accounts for the unscaled 1px cell border. The +CELL_SLACK gives
  // every cell a few pixels of horizontal breathing room so cards
  // never wrap due to subpixel rounding (see CELL_SLACK comment).
  // Math.max enforces MIN_COL_WIDTH on every column — including
  // single-card columns — so the matrix-col-header titles never spill.
  const colWidths = cellColsPerCol.map((cols) => {
    if (cols === 0) return MIN_COL_WIDTH;
    const natural = cols * (cardW + cardGap) - cardGap + cellPadding * 2 + CELL_BORDER * 2 + CELL_SLACK;
    return Math.max(MIN_COL_WIDTH, natural);
  });
  const totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * gap;
  if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };

  // Cell row count = ceil(cellCount / cellCols) for each cell. Using
  // cellColsPerCol directly (instead of deriving from cellGrid on the
  // already-sized column) guarantees the actual render matches what
  // this function planned for.
  const cellRows: number[][] = [];
  for (let row = 0; row < numRows; row++) {
    cellRows.push([]);
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      const cols = cellColsPerCol[col];
      if (n === 0 || cols === 0) { cellRows[row].push(0); continue; }
      cellRows[row].push(Math.ceil(n / cols));
    }
  }

  const maxCardRowsPerRow = Array.from({ length: numRows }, (_, row) => {
    const max = Math.max(...cellRows[row]);
    return max > 0 ? max : 0;
  });

  const totalCardRows = maxCardRowsPerRow.reduce((s, r) => s + r, 0);

  if (totalCardRows === 0) {
    // All empty
    const rowH = (availH - (numRows - 1) * gap) / numRows;
    return { fits: true, colWidths, rowHeights: Array(numRows).fill(rowH) };
  }

  // Compute natural row heights (minimum needed). +CELL_BORDER*2 mirrors
  // the column-width fix — the cell's vertical content area is also
  // shrunk by its 1px top + 1px bottom border under box-sizing: border-box.
  // +CELL_SLACK gives vertical breathing room so a tall cell never clips
  // its bottom row of cards.
  const naturalRowH = maxCardRowsPerRow.map((r) =>
    r === 0 ? MIN_ROW_H : r * (cardH + cardGap) - cardGap + cellPadding * 2 + CELL_BORDER * 2 + CELL_SLACK
  );
  const totalNaturalH = naturalRowH.reduce((s, h) => s + h, 0) + (numRows - 1) * gap;

  if (totalNaturalH > availH) return { fits: false, colWidths, rowHeights: naturalRowH };

  // Distribute extra height proportionally to rows with content
  const extraH = availH - totalNaturalH;
  const contentRows = maxCardRowsPerRow.filter((r) => r > 0).length || 1;
  const rowHeights = naturalRowH.map((h, i) =>
    maxCardRowsPerRow[i] > 0 ? h + extraH / contentRows : h
  );

  return { fits: true, colWidths, rowHeights };
}

// ---------------------------------------------------------------
// computeMatrixLayout — top-level layout solver
//
// Returns the largest cardW it can fit at MIN_CARD_WIDTH..MAX_CARD_WIDTH
// across every "target max card-rows per cell" configuration, then tries
// to absorb leftover horizontal slack by growing cellColsPerCol[i] in
// the column with the most slack (slot-growth instead of column-padding,
// fixing the v1.9.16 "small cards in big cells" bug).
// ---------------------------------------------------------------
export interface MatrixLayoutResult {
  fits: boolean;
  cardW: number;
  cardH: number;
  colWidths: number[];
  rowHeights: number[];
  cellColsPerCol: number[];
}

export function computeMatrixLayout(
  cellCounts: number[][],
  cardFormat: CardFormat,
  availW: number,
  availH: number,
  scale: number,
): MatrixLayoutResult {
  const numRows = cellCounts.length;
  const numCols = numRows > 0 ? cellCounts[0].length : 0;

  if (numRows === 0 || numCols === 0 || availW <= 0 || availH <= 0) {
    return {
      fits: false,
      cardW: MAX_CARD_WIDTH,
      cardH: estimateCardHeight(cardFormat, MAX_CARD_WIDTH),
      colWidths: [],
      rowHeights: [],
      cellColsPerCol: [],
    };
  }

  // Math.ceil the scaled gap / padding so JS slightly OVER-allocates
  // space when the browser snaps fractional CSS pixels (at scale 1.25 /
  // 1.5 / 1.75) — under-allocation by even 0.5px wraps a card to the
  // next row. Erring on the side of "JS plans for slightly more space"
  // is harmless: the slack just becomes a sub-pixel gap.
  const scaledGap = Math.ceil(BASE_GAP * scale);
  const scaledCardGap = Math.ceil(BASE_GAP * scale);
  const scaledCellPadding = Math.ceil(BASE_GAP * scale);

  const totalProducts = cellCounts.flat().reduce((s, n) => s + n, 0);
  if (totalProducts === 0) {
    return {
      fits: true,
      cardW: MAX_CARD_WIDTH,
      cardH: estimateCardHeight(cardFormat, MAX_CARD_WIDTH),
      colWidths: Array(numCols).fill((availW - (numCols - 1) * scaledGap) / numCols),
      rowHeights: Array(numRows).fill((availH - (numRows - 1) * scaledGap) / numRows),
      cellColsPerCol: Array(numCols).fill(0),
    };
  }

  // Max product count in any single column, used to bound the target
  // "max card rows per cell" loop below.
  const maxPerCol = Array.from({ length: numCols }, (_, col) => {
    let max = 0;
    for (let row = 0; row < numRows; row++) {
      if (cellCounts[row][col] > max) max = cellCounts[row][col];
    }
    return max;
  });
  const absoluteMaxCount = Math.max(1, ...maxPerCol);

  // Outer loop: iterate over "target max card rows per cell".
  // For each target we derive cellCols[col] = ceil(maxPerCol[col] / target)
  // — i.e. how many horizontal slots each column needs so every cell in
  // that column fits its contents in `target` rows or less. Then we
  // binary search the biggest cardW that still fits this configuration,
  // and keep whichever (target, cardW) pair yields the largest cardW.
  let bestCW = 0;
  let bestColW: number[] = [];
  let bestRowH: number[] = [];
  let bestCellColsPerCol: number[] = [];

  for (let target = 1; target <= absoluteMaxCount; target++) {
    const cellColsPerCol = maxPerCol.map((n) =>
      n === 0 ? 0 : Math.ceil(n / target),
    );

    let lo = MIN_CARD_WIDTH;
    let hi = MAX_CARD_WIDTH;
    let targetBestCW = 0;
    let targetBestColW: number[] = [];
    let targetBestRowH: number[] = [];

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const cardH = estimateCardHeight(cardFormat, mid);
      const result = computeLayout(
        mid, cardH, cellCounts, cellColsPerCol,
        numCols, numRows, availW, availH,
        scaledGap, scaledCardGap, scaledCellPadding,
      );
      if (result.fits) {
        targetBestCW = mid;
        targetBestColW = result.colWidths;
        targetBestRowH = result.rowHeights;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (targetBestCW > bestCW) {
      bestCW = targetBestCW;
      bestColW = targetBestColW;
      bestRowH = targetBestRowH;
      bestCellColsPerCol = cellColsPerCol.slice();
    }
  }

  // Nothing fit at MIN_CARD_WIDTH — caller (auto-tier loop) bumps the scale.
  if (bestCW === 0) {
    return {
      fits: false,
      cardW: MIN_CARD_WIDTH,
      cardH: estimateCardHeight(cardFormat, MIN_CARD_WIDTH),
      colWidths: [],
      rowHeights: [],
      cellColsPerCol: maxPerCol.map((n) => (n === 0 ? 0 : 1)),
    };
  }

  // Slot-growth slack absorption — the v1.9.17 fix.
  //
  // After the binary search picks the best (target, cardW, cellColsPerCol),
  // try to grow cellColsPerCol[i] by +1 in the column with the most
  // utilised slack (high maxPerCol[i] / cellColsPerCol[i] ratio). Each
  // successful grow packs more cards per row in that column and absorbs
  // leftover horizontal width as actual cards instead of as cell padding.
  // Bail when no column can grow without losing the fit.
  let grewSomething = true;
  let growIterations = 0;
  while (grewSomething && growIterations < 32) {
    grewSomething = false;
    growIterations++;

    // Sort candidate columns by current density (descending). Skip
    // empty columns and columns that already have one slot per item
    // (no benefit from adding another).
    const candidates = bestCellColsPerCol
      .map((cols, i) => ({ i, cols, density: maxPerCol[i] / Math.max(1, cols) }))
      .filter((c) => c.cols > 0 && maxPerCol[c.i] > c.cols)
      .sort((a, b) => b.density - a.density);

    for (const cand of candidates) {
      const trial = bestCellColsPerCol.slice();
      trial[cand.i] = cand.cols + 1;
      const cardH = estimateCardHeight(cardFormat, bestCW);
      const result = computeLayout(
        bestCW, cardH, cellCounts, trial,
        numCols, numRows, availW, availH,
        scaledGap, scaledCardGap, scaledCellPadding,
      );
      if (result.fits) {
        bestCellColsPerCol = trial;
        bestColW = result.colWidths;
        bestRowH = result.rowHeights;
        grewSomething = true;
        break; // re-run the outer while with the grown config
      }
    }
  }

  // Distribute leftover horizontal slack uniformly across all columns
  // so the matrix fills the canvas instead of leaving an empty band on
  // the right. The optimisation logic upstream is untouched (cardW and
  // cellColsPerCol are already locked); the slack just becomes extra
  // cell padding, growing the cells without changing the cards inside.
  // v1.9.20 — the user explicitly asked for "let them fill" after
  // tightening MAX_CARD_WIDTH so cells don't end up gigantic.
  const totalColW = bestColW.reduce((s, w) => s + w, 0) + (numCols - 1) * scaledGap;
  if (totalColW < availW) {
    const extra = (availW - totalColW) / numCols;
    bestColW = bestColW.map((w) => w + extra);
  }

  // Final cardH from the chosen cardW. Same value the caller will pass
  // down via --matrix-card-height so JS and CSS can never drift.
  const finalCardH = estimateCardHeight(cardFormat, bestCW);

  return {
    fits: true,
    cardW: bestCW,
    cardH: finalCardH,
    colWidths: bestColW,
    rowHeights: bestRowH,
    cellColsPerCol: bestCellColsPerCol,
  };
}

// ---------------------------------------------------------------
// computeMatrixAutoTier — fit-driven scale picker
//
// Walks the TIER_LADDER and returns the smallest scale at which
// computeMatrixLayout reports fits=true. When the canvas dimensions
// scale linearly with the slide base scale (which they do — see
// .matrix-16-9 in RangeDesign.css), the available width and height at
// scale s are (s / currentScale) × the currently-measured dimensions.
// Caller passes the currently-measured availW / availH and the current
// scale they were measured at; this helper takes care of the back-out.
//
// Hysteresis: when the *smallest* fitting scale is BELOW the current
// scale (a downgrade), require the layout at that scale to clear
// MIN_CARD_WIDTH by at least HYSTERESIS_MARGIN before committing.
// Otherwise tiny sub-pixel measurement drift between calls (e.g. 1px
// from Math.ceil-ed gap rounding at non-integer scales, or unscaled
// chrome elements making wrapperSize non-linear in scale) can
// ping-pong the recommended scale forever on borderline layouts.
// Hysteresis is one-directional: upgrades happen the moment the
// current scale stops fitting, so dense plans still bump promptly.
//
// Margin bumped 4 → 8 in v1.9.22 — 4 wasn't enough on borderline
// layouts where wrapperSize.h drifted up to ~3px between scales due
// to the unscaled .editable-title-pencil button. The CSS
// slide-title min-height fix in v1.9.22 also addresses that root
// cause; 8 is the belt-and-braces safety net.
// ---------------------------------------------------------------
const HYSTERESIS_MARGIN = 8;

export function computeMatrixAutoTier(
  cellCounts: number[][],
  cardFormat: CardFormat,
  currentAvailW: number,
  currentAvailH: number,
  currentScale: number,
): number {
  if (currentScale <= 0 || currentAvailW <= 0 || currentAvailH <= 0) {
    return 1;
  }
  const baseAvailW = currentAvailW / currentScale;
  const baseAvailH = currentAvailH / currentScale;

  for (const scale of TIER_LADDER) {
    const availW = baseAvailW * scale;
    const availH = baseAvailH * scale;
    const result = computeMatrixLayout(cellCounts, cardFormat, availW, availH, scale);
    // Downgrades require comfortable cardW headroom; upgrades only
    // require the bare minimum.
    const minCardW = scale < currentScale ? MIN_CARD_WIDTH + HYSTERESIS_MARGIN : MIN_CARD_WIDTH;
    if (result.fits && result.cardW >= minCardW) {
      return scale;
    }
  }
  return TIER_LADDER[TIER_LADDER.length - 1];
}
