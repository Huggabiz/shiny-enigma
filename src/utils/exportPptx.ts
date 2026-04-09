import PptxGenJS from 'pptxgenjs';
import type { Project, Product, Shelf, ShelfItem, SankeyLink } from '../types';

// ── Slide dimensions (LAYOUT_WIDE = 13.333 × 7.5 inches) ──
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

// ── Shared colour palette (matches the web app) ──
const COLOUR_TITLE = '1A1A2E';
const COLOUR_SUB = '8892A0';
const COLOUR_CARD_BORDER = 'E0E0E0';
const COLOUR_CARD_BG = 'FFFFFF';
const COLOUR_PLACEHOLDER_BG = 'E8F6FD';
const COLOUR_PLACEHOLDER_BORDER = '0097A7';
const COLOUR_DEV_BG = 'E8F0FE';
const COLOUR_DEV_BORDER = '1565C0';
const COLOUR_X_LABEL_BG = 'DCE6F0';
const COLOUR_X_LABEL_TEXT = '2C3E50';
const COLOUR_Y_LABEL_BG = 'F0E6D6';
const COLOUR_Y_LABEL_TEXT = '5D4E37';
const COLOUR_FLOW_GROWTH = '4CAF50';
const COLOUR_FLOW_LOSS = 'F44336';
const COLOUR_FLOW_TRANSFER = '2196F3';
const COLOUR_VOL = '666666';
const COLOUR_FORECAST = '1976D2';
const COLOUR_RRP = '2E7D32';

function getProduct(catalogue: Product[], productId: string): Product | undefined {
  return catalogue.find((p) => p.id === productId);
}

// ───────────────────────────────────────────────────────────────
// Card rendering — shared between transform slides and design slides
// ───────────────────────────────────────────────────────────────

interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

function drawCard(
  slide: PptxGenJS.Slide,
  rect: CardLayout,
  item: ShelfItem,
  product: Product | undefined,
  opts: { cardId: string; compact?: boolean } = { cardId: '' },
) {
  const { x, y, w, h } = rect;
  const phData = item.placeholderData;
  const name = item.isPlaceholder
    ? (phData?.name || item.placeholderName || 'New SKU')
    : (product?.name || 'Unknown');
  const sku = item.isPlaceholder ? (phData?.sku || '') : (product?.sku || '');
  const imageUrl = item.isPlaceholder ? phData?.imageUrl : product?.imageUrl;
  const volume = item.isPlaceholder ? phData?.volume : product?.volume;
  const forecast = item.isPlaceholder ? phData?.forecastVolume : product?.forecastVolume;
  const rrp = item.isPlaceholder ? phData?.rrp : product?.rrp;
  const source = item.isPlaceholder ? (phData?.source || 'live') : (product?.source || 'live');
  const isDev = !item.isPlaceholder && source === 'dev';

  // Background
  const bg = item.isPlaceholder ? COLOUR_PLACEHOLDER_BG : (isDev ? COLOUR_DEV_BG : COLOUR_CARD_BG);
  const border = item.isPlaceholder
    ? COLOUR_PLACEHOLDER_BORDER
    : (isDev ? COLOUR_DEV_BORDER : COLOUR_CARD_BORDER);

  slide.addShape('roundRect' as PptxGenJS.ShapeType, {
    x, y, w, h,
    fill: { color: bg },
    line: { color: border, width: 1 },
    rectRadius: 0.05,
    objectName: `${opts.cardId}-bg`,
  });

  // Image zone — top portion of the card
  const pad = 0.05;
  const imgH = Math.min(h * 0.40, 0.55);
  const imgW = Math.min(w - pad * 2, imgH * 1.2);
  const imgX = x + (w - imgW) / 2;
  const imgY = y + pad;

  if (imageUrl) {
    try {
      slide.addImage({
        path: imageUrl,
        x: imgX, y: imgY, w: imgW, h: imgH,
        sizing: { type: 'contain', w: imgW, h: imgH },
        objectName: `${opts.cardId}-img`,
      });
    } catch {
      drawImagePlaceholder(slide, imgX, imgY, imgW, imgH, item.isPlaceholder ? '+' : name.charAt(0), item.isPlaceholder || isDev);
    }
  } else {
    drawImagePlaceholder(slide, imgX, imgY, imgW, imgH, item.isPlaceholder ? '+' : name.charAt(0), item.isPlaceholder || isDev);
  }

  // Name — below the image
  const nameY = y + pad + imgH + 0.02;
  const nameH = Math.max(0.22, h * 0.22);
  const nameFont = Math.max(5, Math.min(8, Math.round(w * 9)));
  slide.addText(name, {
    x: x + pad, y: nameY, w: w - pad * 2, h: nameH,
    fontSize: nameFont, bold: true, align: 'center', valign: 'top',
    color: '333333', wrap: true, fontFace: 'Calibri',
    objectName: `${opts.cardId}-name`,
  });

  // Stats stack — SKU, Vol, Fcst, £RRP — packed at the bottom of the card
  const statsTop = y + h - 0.48;
  const statsH = 0.14;
  const statsFont = Math.max(4, Math.min(7, Math.round(w * 7)));
  const statsX = x + pad;
  const statsW = w - pad * 2;

  let cursorY = statsTop;

  if (sku && !opts.compact) {
    slide.addText(sku, {
      x: statsX, y: cursorY, w: statsW, h: statsH,
      fontSize: Math.max(4, statsFont - 1), color: '999999', align: 'center', valign: 'middle',
      objectName: `${opts.cardId}-sku`, fontFace: 'Calibri',
    });
    cursorY += statsH;
  }

  if (volume && volume > 0) {
    slide.addText(`Vol: ${volume.toLocaleString()}`, {
      x: statsX, y: cursorY, w: statsW, h: statsH,
      fontSize: statsFont, color: COLOUR_VOL, align: 'center', valign: 'middle',
      objectName: `${opts.cardId}-vol`, fontFace: 'Calibri',
    });
    cursorY += statsH;
  }

  if (forecast !== undefined && forecast > 0) {
    slide.addText(`Fcst: ${forecast.toLocaleString()}`, {
      x: statsX, y: cursorY, w: statsW, h: statsH,
      fontSize: statsFont, color: COLOUR_FORECAST, align: 'center', valign: 'middle',
      objectName: `${opts.cardId}-fcst`, fontFace: 'Calibri',
    });
    cursorY += statsH;
  }

  if (rrp !== undefined && rrp > 0) {
    slide.addText(`\u00A3${rrp}`, {
      x: statsX, y: cursorY, w: statsW, h: statsH,
      fontSize: statsFont, color: COLOUR_RRP, bold: true, align: 'center', valign: 'middle',
      objectName: `${opts.cardId}-rrp`, fontFace: 'Calibri',
    });
  }

  // New / Dev corner badge
  if (item.isPlaceholder) {
    drawCornerBadge(slide, x - 0.04, y - 0.04, 'New', COLOUR_PLACEHOLDER_BORDER);
  } else if (isDev) {
    drawCornerBadge(slide, x - 0.04, y - 0.04, 'DEV', COLOUR_DEV_BORDER);
  }
}

function drawImagePlaceholder(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  letter: string,
  isNew: boolean,
) {
  slide.addShape('roundRect' as PptxGenJS.ShapeType, {
    x, y, w, h,
    fill: { color: isNew ? 'B2EBF2' : 'F5F5F5' },
    line: { type: 'none' },
    rectRadius: 0.03,
  });
  slide.addText(letter, {
    x, y, w, h,
    fontSize: Math.max(10, Math.round(w * 18)),
    align: 'center', valign: 'middle',
    color: isNew ? '00838F' : 'BBBBBB',
  });
}

function drawCornerBadge(
  slide: PptxGenJS.Slide,
  x: number, y: number, text: string, fillColor: string,
) {
  const size = 0.28;
  slide.addShape('ellipse' as PptxGenJS.ShapeType, {
    x, y, w: size, h: size,
    fill: { color: fillColor },
    line: { color: fillColor, width: 0 },
  });
  slide.addText(text, {
    x, y, w: size, h: size,
    fontSize: 6, bold: true, align: 'center', valign: 'middle',
    color: 'FFFFFF', fontFace: 'Calibri',
  });
}

// ───────────────────────────────────────────────────────────────
// Transform slide — Current + Future shelves + Sankey flows
// ───────────────────────────────────────────────────────────────

interface ShelfLayout {
  cardWidth: number;
  slotWidth: number;
  offsetLeft: number;
  railLeft: number;
  railWidth: number;
  cardHeight: number;
  topY: number;
  bottomY: number;
}

function computeShelfLayout(itemCount: number, railLeft: number, railWidth: number, topY: number, cardHeight: number): ShelfLayout {
  const baseCardW = 0.85;
  const minCardW = 0.22;
  const cardGap = 0.06;

  let cardWidth = baseCardW;
  if (itemCount > 0) {
    const naturalWidth = itemCount * (baseCardW + cardGap) - cardGap;
    if (naturalWidth > railWidth) {
      cardWidth = Math.max(minCardW, (railWidth - (itemCount - 1) * cardGap) / itemCount);
    }
  }
  const slotWidth = cardWidth + cardGap;
  const contentWidth = itemCount > 0 ? itemCount * slotWidth - cardGap : 0;
  const offsetLeft = railLeft + Math.max(0, (railWidth - contentWidth) / 2);

  return {
    cardWidth,
    slotWidth,
    offsetLeft,
    railLeft,
    railWidth,
    cardHeight,
    topY,
    bottomY: topY + cardHeight,
  };
}

function drawShelfRow(
  slide: PptxGenJS.Slide,
  shelf: Shelf,
  catalogue: Product[],
  layout: ShelfLayout,
  labelY: number,
  labelBelow: boolean,
  shelfName: string,
) {
  // Shelf name — sub-heading, lower authority than the main slide title
  slide.addText(shelfName.toUpperCase(), {
    x: layout.railLeft, y: labelY, w: layout.railWidth, h: 0.22,
    fontSize: 10, bold: false, color: COLOUR_SUB,
    align: 'left', valign: 'middle', charSpacing: 1.5,
    objectName: `${shelf.id}-shelf-label`,
  });

  // Matrix-derived label bars above (or below, for flipped future shelf) the cards
  const matrixLayout = shelf.matrixLayout;
  if (matrixLayout && matrixLayout.assignments.length > 0) {
    const posMap = new Map(shelf.items.map((item, idx) => [item.id, idx]));
    const labelBarH = 0.18;
    const barY = labelBelow ? layout.bottomY + 0.04 : layout.topY - labelBarH - 0.04;

    for (let col = 0; col < matrixLayout.xLabels.length; col++) {
      const positions = matrixLayout.assignments
        .filter((a) => a.col === col)
        .map((a) => posMap.get(a.itemId))
        .filter((p): p is number => p !== undefined);
      if (positions.length === 0) continue;
      const minP = Math.min(...positions);
      const maxP = Math.max(...positions);
      const barX = layout.offsetLeft + minP * layout.slotWidth;
      const barW = (maxP - minP) * layout.slotWidth + layout.cardWidth;
      slide.addShape('roundRect' as PptxGenJS.ShapeType, {
        x: barX, y: barY, w: barW, h: labelBarH,
        fill: { color: COLOUR_X_LABEL_BG },
        line: { type: 'none' },
        rectRadius: 0.03,
        objectName: `${shelf.id}-xlabel-${col}`,
      });
      slide.addText(matrixLayout.xLabels[col], {
        x: barX, y: barY, w: barW, h: labelBarH,
        fontSize: 8, bold: true, align: 'center', valign: 'middle',
        color: COLOUR_X_LABEL_TEXT, fontFace: 'Calibri',
      });
    }
  }

  // Cards
  shelf.items.forEach((item, idx) => {
    const cardX = layout.offsetLeft + idx * layout.slotWidth;
    const cardId = `${shelf.id}-${idx}-${(item.id || '').slice(0, 8).replace(/[^a-zA-Z0-9]/g, '_')}`;
    drawCard(
      slide,
      { x: cardX, y: layout.topY, w: layout.cardWidth, h: layout.cardHeight },
      item,
      getProduct(catalogue, item.productId),
      { cardId, compact: layout.cardWidth < 0.5 },
    );
  });
}

// Convert (x, y) pairs into a rotated-rectangle flow ribbon
function addFlowRibbon(
  slide: PptxGenJS.Slide,
  sx: number, sy: number,
  tx: number, ty: number,
  ribbonWidth: number,
  fillColor: string,
  label: string,
  cardId: string,
) {
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.01) return;
  const angleRad = Math.atan2(dy, dx);
  const angleDeg = angleRad * (180 / Math.PI);
  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;

  const ribbonX = midX - length / 2;
  const ribbonY = midY - ribbonWidth / 2;

  slide.addShape('rect' as PptxGenJS.ShapeType, {
    x: ribbonX, y: ribbonY, w: length, h: ribbonWidth,
    fill: { color: fillColor, transparency: 55 },
    line: { type: 'none' },
    rotate: angleDeg,
    objectName: `${cardId}-ribbon`,
  });

  // Label in the middle of the ribbon, rotated along the flow direction
  if (label) {
    slide.addText(label, {
      x: ribbonX, y: midY - 0.15, w: length, h: 0.3,
      fontSize: 8, color: '555555', align: 'center', valign: 'middle',
      rotate: angleDeg, fontFace: 'Calibri',
      objectName: `${cardId}-label`,
    });
  }
}

function addTransformSlide(pptx: PptxGenJS, plan: { name: string; currentShelf: Shelf; futureShelf: Shelf; sankeyLinks: SankeyLink[] }, catalogue: Product[]) {
  const slide = pptx.addSlide();

  // Slide title — editable text object
  slide.addText(plan.name, {
    x: 0.4, y: 0.25, w: SLIDE_W - 0.8, h: 0.55,
    fontSize: 24, bold: true, color: COLOUR_TITLE,
    align: 'left', valign: 'middle', fontFace: 'Calibri',
    objectName: 'slide-title',
  });

  const railLeft = 0.4;
  const railWidth = SLIDE_W - 0.8;
  const cardH = 1.25;

  // Current range — pinned near the top
  const currentY = 1.2;
  const currentLayout = computeShelfLayout(plan.currentShelf.items.length, railLeft, railWidth, currentY, cardH);
  drawShelfRow(slide, plan.currentShelf, catalogue, currentLayout, currentY - 0.48, false, 'Current Range');

  // Future range — pinned near the bottom
  const futureCardY = SLIDE_H - 0.4 - cardH;
  const futureLayout = computeShelfLayout(plan.futureShelf.items.length, railLeft, railWidth, futureCardY, cardH);
  drawShelfRow(slide, plan.futureShelf, catalogue, futureLayout, futureCardY + cardH + 0.26, true, 'Future Range');

  // Sankey ribbons bridging the middle
  const sankeyTop = currentLayout.bottomY + 0.05;
  const sankeyBottom = futureLayout.topY - 0.05;

  // Scale ribbon width by volume, normalised against the max volume in play
  const allVolumes = plan.sankeyLinks.map((l) => l.volume);
  const maxVolume = Math.max(1, ...allVolumes);
  const minRibbon = 0.04;
  const maxRibbon = 0.22;

  plan.sankeyLinks.forEach((link, idx) => {
    const si = plan.currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
    const ti = plan.futureShelf.items.findIndex((i) => i.id === link.targetItemId);
    if (si === -1 || ti === -1) return;

    const sx = currentLayout.offsetLeft + si * currentLayout.slotWidth + currentLayout.cardWidth / 2;
    const tx = futureLayout.offsetLeft + ti * futureLayout.slotWidth + futureLayout.cardWidth / 2;
    const sy = sankeyTop;
    const ty = sankeyBottom;

    const ribbonWidth = minRibbon + (link.volume / maxVolume) * (maxRibbon - minRibbon);
    const color = link.type === 'growth'
      ? COLOUR_FLOW_GROWTH
      : link.type === 'loss'
        ? COLOUR_FLOW_LOSS
        : COLOUR_FLOW_TRANSFER;
    const pct = link.percent ?? 100;
    const label = `${pct}% (${link.volume.toLocaleString()})`;

    addFlowRibbon(slide, sx, sy, tx, ty, ribbonWidth, color, label, `flow-${idx}`);
  });
}

// ───────────────────────────────────────────────────────────────
// Design (matrix) slide — one slide per shelf
// ───────────────────────────────────────────────────────────────

const D_MARGIN = 0.4;
const D_TITLE_H = 0.55;
const D_HDR_H = 0.32;
const D_ROW_HDR_W = 0.7;
const D_CELL_GAP = 0.06;
const D_CELL_PAD = 0.08;
const D_CARD_GAP = 0.06;
const D_CARD_ASPECT = 1.45;
const D_CARD_RADIUS = 0.05;
const D_MAX_CW = 0.85;
const D_MIN_CW = 0.3;
const D_EMPTY = 0.2;
const D_MIN_ROW_H = 0.3;

function pptCellGrid(n: number, cw: number, cellW: number): { cols: number; rows: number } {
  if (n === 0) return { cols: 0, rows: 0 };
  const maxCols = Math.max(1, Math.floor((cellW - D_CELL_PAD * 2 + D_CARD_GAP) / (cw + D_CARD_GAP)));
  const cols = Math.min(n, maxCols);
  return { cols, rows: Math.ceil(n / cols) };
}

function designLayoutFits(
  cw: number, cellCounts: number[][], numCols: number, numRows: number,
  availW: number, availH: number,
): { fits: boolean; colWidths: number[]; rowHeights: number[] } {
  const ch = cw * D_CARD_ASPECT;

  const maxPerCol = Array.from({ length: numCols }, (_, col) => {
    let max = 0;
    for (let row = 0; row < numRows; row++) {
      if (cellCounts[row][col] > max) max = cellCounts[row][col];
    }
    return max;
  });

  const idealColSlots = maxPerCol.map((n) => n === 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(n))));
  let colWidths = idealColSlots.map((s) =>
    s === 0 ? D_EMPTY : s * (cw + D_CARD_GAP) - D_CARD_GAP + D_CELL_PAD * 2
  );
  let totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * D_CELL_GAP;

  if (totalW > availW) {
    const totalProducts = maxPerCol.reduce((s, n) => s + n, 0) || 1;
    const usableW = availW - (numCols - 1) * D_CELL_GAP - maxPerCol.filter((n) => n === 0).length * D_EMPTY;
    colWidths = maxPerCol.map((n) =>
      n === 0 ? D_EMPTY : Math.max(cw + D_CELL_PAD * 2, (n / totalProducts) * usableW)
    );
    totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * D_CELL_GAP;
    if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };
  }

  const maxCardRowsPerRow = Array.from({ length: numRows }, (_, row) => {
    let max = 0;
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      const { rows } = pptCellGrid(n, cw, colWidths[col]);
      if (rows > max) max = rows;
    }
    return max;
  });

  const naturalRowH = maxCardRowsPerRow.map((r) =>
    r === 0 ? D_MIN_ROW_H : r * (ch + D_CARD_GAP) - D_CARD_GAP + D_CELL_PAD * 2
  );
  const totalNaturalH = naturalRowH.reduce((s, h) => s + h, 0) + (numRows - 1) * D_CELL_GAP;

  if (totalNaturalH > availH) return { fits: false, colWidths, rowHeights: naturalRowH };

  const extraH = availH - totalNaturalH;
  const contentRows = maxCardRowsPerRow.filter((r) => r > 0).length || 1;
  const rowHeights = naturalRowH.map((h, i) =>
    maxCardRowsPerRow[i] > 0 ? h + extraH / contentRows : h
  );

  return { fits: true, colWidths, rowHeights };
}

function addDesignSlide(pptx: PptxGenJS, shelf: Shelf, catalogue: Product[], planName: string, label: string) {
  const layout = shelf.matrixLayout;
  if (!layout || layout.xLabels.length === 0 || layout.yLabels.length === 0) return;

  const slide = pptx.addSlide();
  const numCols = layout.xLabels.length;
  const numRows = layout.yLabels.length;

  // Slide title — plan name in the main authority, shelf label as a subhead
  slide.addText(planName, {
    x: D_MARGIN, y: D_MARGIN * 0.5, w: SLIDE_W - D_MARGIN * 2, h: D_TITLE_H,
    fontSize: 22, bold: true, color: COLOUR_TITLE, fontFace: 'Calibri',
    align: 'left', valign: 'middle', objectName: 'slide-title',
  });
  slide.addText(label.toUpperCase(), {
    x: D_MARGIN, y: D_MARGIN * 0.5 + D_TITLE_H - 0.05, w: SLIDE_W - D_MARGIN * 2, h: 0.2,
    fontSize: 10, bold: false, color: COLOUR_SUB, charSpacing: 1.5, fontFace: 'Calibri',
    align: 'left', valign: 'middle', objectName: 'slide-subtitle',
  });

  const gridTop = D_MARGIN + D_TITLE_H + 0.2;
  const gridLeft = D_MARGIN + D_ROW_HDR_W + D_CELL_GAP;
  const availW = SLIDE_W - gridLeft - D_MARGIN;
  const availH = SLIDE_H - gridTop - D_HDR_H - D_CELL_GAP - D_MARGIN;

  const cellCounts: number[][] = [];
  for (let r = 0; r < numRows; r++) {
    cellCounts.push([]);
    for (let c = 0; c < numCols; c++) {
      cellCounts[r].push(layout.assignments.filter((a) => a.row === r && a.col === c).length);
    }
  }

  let lo = Math.round(D_MIN_CW * 100);
  let hi = Math.round(D_MAX_CW * 100);
  let bestCW = D_MIN_CW;
  let bestColW: number[] = Array(numCols).fill(0.5);
  let bestRowH: number[] = Array(numRows).fill(0.5);

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const result = designLayoutFits(mid / 100, cellCounts, numCols, numRows, availW, availH);
    if (result.fits) {
      bestCW = mid / 100;
      bestColW = result.colWidths;
      bestRowH = result.rowHeights;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const bestCH = bestCW * D_CARD_ASPECT;

  const totalColW = bestColW.reduce((s, w) => s + w, 0) + (numCols - 1) * D_CELL_GAP;
  if (totalColW < availW) {
    const ne = bestColW.filter((w) => w > D_EMPTY).length || 1;
    const ex = (availW - totalColW) / ne;
    bestColW = bestColW.map((w) => w > D_EMPTY ? w + ex : w);
  }
  const totalRowH = bestRowH.reduce((s, h) => s + h, 0) + (numRows - 1) * D_CELL_GAP;
  if (totalRowH < availH) {
    const ne = bestRowH.filter((h) => h > D_EMPTY).length || 1;
    const ex = (availH - totalRowH) / ne;
    bestRowH = bestRowH.map((h) => h > D_EMPTY ? h + ex : h);
  }

  const colXs: number[] = [];
  let cx = gridLeft;
  for (let c = 0; c < numCols; c++) { colXs.push(cx); cx += bestColW[c] + D_CELL_GAP; }

  const rowYs: number[] = [];
  let ry = gridTop + D_HDR_H + D_CELL_GAP;
  for (let r = 0; r < numRows; r++) { rowYs.push(ry); ry += bestRowH[r] + D_CELL_GAP; }

  // Column headers
  for (let c = 0; c < numCols; c++) {
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x: colXs[c], y: gridTop, w: bestColW[c], h: D_HDR_H,
      fill: { color: COLOUR_X_LABEL_BG },
      line: { type: 'none' },
      rectRadius: 0.04, objectName: `x-label-${c}`,
    });
    slide.addText(layout.xLabels[c], {
      x: colXs[c], y: gridTop, w: bestColW[c], h: D_HDR_H,
      fontSize: 10, bold: true, align: 'center', valign: 'middle',
      color: COLOUR_X_LABEL_TEXT, fontFace: 'Calibri',
    });
  }

  // Row headers
  for (let r = 0; r < numRows; r++) {
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x: D_MARGIN, y: rowYs[r], w: D_ROW_HDR_W, h: bestRowH[r],
      fill: { color: COLOUR_Y_LABEL_BG },
      line: { type: 'none' },
      rectRadius: 0.04, objectName: `y-label-${r}`,
    });
    slide.addText(layout.yLabels[r], {
      x: D_MARGIN, y: rowYs[r], w: D_ROW_HDR_W, h: bestRowH[r],
      fontSize: 9, bold: true, align: 'center', valign: 'middle',
      color: COLOUR_Y_LABEL_TEXT, rotate: 270, fontFace: 'Calibri',
    });
  }

  // Cells and cards
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cellX = colXs[c];
      const cellY = rowYs[r];
      const cellW = bestColW[c];
      const cellH = bestRowH[r];

      slide.addShape('roundRect' as PptxGenJS.ShapeType, {
        x: cellX, y: cellY, w: cellW, h: cellH,
        fill: { color: 'FAFAFA' }, line: { color: 'E8E8E8', width: 0.5 },
        rectRadius: 0.04,
        objectName: `cell-${layout.xLabels[c]}-${layout.yLabels[r]}`.replace(/\s/g, '_'),
      });

      const assignments = layout.assignments.filter((a) => a.row === r && a.col === c);
      if (assignments.length === 0) continue;

      const innerW = cellW - D_CELL_PAD * 2;
      const innerH = cellH - D_CELL_PAD * 2;

      const maxVRows = Math.max(1, Math.floor((innerH + D_CARD_GAP) / (bestCH + D_CARD_GAP)));
      const gridCols = Math.max(1, Math.ceil(assignments.length / maxVRows));
      const gridRows = Math.ceil(assignments.length / gridCols);

      const gridW = gridCols * bestCW + (gridCols - 1) * D_CARD_GAP;
      const gridH = gridRows * bestCH + (gridRows - 1) * D_CARD_GAP;
      const startX = cellX + D_CELL_PAD + (innerW - gridW) / 2;
      const startY = cellY + D_CELL_PAD + (innerH - gridH) / 2;

      assignments.forEach((assignment, idx) => {
        const item = shelf.items.find((i) => i.id === assignment.itemId);
        if (!item) return;
        const product = getProduct(catalogue, item.productId);

        const gc = idx % gridCols;
        const gr = Math.floor(idx / gridCols);
        const px = startX + gc * (bestCW + D_CARD_GAP);
        const py = startY + gr * (bestCH + D_CARD_GAP);
        const cardId = `d-${r}-${c}-${idx}`;

        drawCard(slide, { x: px, y: py, w: bestCW, h: bestCH }, item, product, { cardId });
      });
    }
  }
}

// ───────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────

export function exportToPptx(project: Project): void {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Range Planner';
  pptx.title = project.name;

  for (const plan of project.plans) {
    addTransformSlide(pptx, plan, project.catalogue);
    addDesignSlide(pptx, plan.currentShelf, project.catalogue, plan.name, 'Current Range');
    addDesignSlide(pptx, plan.futureShelf, project.catalogue, plan.name, 'Future Range');
  }

  pptx.writeFile({ fileName: `${project.name.replace(/\s+/g, '_')}_range_plan.pptx` });
}

// Avoid "unused" TS errors on the card-radius constant which is referenced in templates above.
void D_CARD_RADIUS;
