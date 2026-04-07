import PptxGenJS from 'pptxgenjs';
import type { Project, Product, Shelf } from '../types';

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;
const CARD_W = 0.9;
const CARD_H = 1.2;
const CARD_GAP_PPT = 0.1;
const SHELF_MARGIN_LEFT = 0.3;

function getProduct(catalogue: Product[], productId: string): Product | undefined {
  return catalogue.find((p) => p.id === productId);
}

// ── Transform slide helpers ──

function drawShelfItems(slide: PptxGenJS.Slide, shelf: Shelf, catalogue: Product[], shelfY: number) {
  const items = shelf.items;
  const layout = shelf.matrixLayout;

  slide.addText(shelf.name, {
    x: SHELF_MARGIN_LEFT, y: shelfY - 0.45, w: 4, h: 0.35,
    fontSize: 12, bold: true, color: '333333',
  });

  const maxCards = items.length;
  const availableW = SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2;
  const cardW = Math.min(CARD_W, (availableW - (maxCards - 1) * CARD_GAP_PPT) / Math.max(maxCards, 1));

  if (layout && layout.assignments.length > 0) {
    const posMap = new Map(items.map((item, idx) => [item.id, idx]));
    for (let col = 0; col < layout.xLabels.length; col++) {
      const positions = layout.assignments.filter((a) => a.col === col)
        .map((a) => posMap.get(a.itemId)).filter((p): p is number => p !== undefined);
      if (positions.length === 0) continue;
      const x = SHELF_MARGIN_LEFT + Math.min(...positions) * (cardW + CARD_GAP_PPT);
      const w = (Math.max(...positions) - Math.min(...positions)) * (cardW + CARD_GAP_PPT) + cardW;
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x, y: shelfY - 0.2, w, h: 0.17, fill: { color: 'DCE6F0' }, rectRadius: 0.02,
      });
      slide.addText(layout.xLabels[col], {
        x, y: shelfY - 0.2, w, h: 0.17, fontSize: 6, align: 'center', color: '2C3E50', bold: true,
      });
    }
  }

  items.forEach((item, index) => {
    const x = SHELF_MARGIN_LEFT + index * (cardW + CARD_GAP_PPT);
    const product = getProduct(catalogue, item.productId);
    const name = item.isPlaceholder ? item.placeholderName || 'New SKU' : product?.name || 'Unknown';

    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x, y: shelfY + 0.15, w: cardW, h: CARD_H,
      fill: { color: item.isPlaceholder ? 'E8F6FD' : 'FFFFFF' },
      line: { color: item.isPlaceholder ? '0097A7' : 'DDDDDD', width: 1 },
      rectRadius: 0.04,
    });

    if (product?.imageUrl) {
      try {
        const imgW = cardW * 0.55;
        slide.addImage({
          path: product.imageUrl,
          x: x + (cardW - imgW) / 2, y: shelfY + 0.2, w: imgW, h: imgW * 0.85, rounding: true,
        });
      } catch { /* skip */ }
    }

    slide.addText(name, {
      x, y: shelfY + 0.15 + (product?.imageUrl ? 0.55 : 0.05), w: cardW, h: 0.45,
      fontSize: 6, align: 'center', color: '333333', valign: 'top', wrap: true,
    });

    if (product?.volume) {
      slide.addText(`Vol: ${product.volume.toLocaleString()}`, {
        x, y: shelfY + 0.15 + CARD_H - 0.2, w: cardW, h: 0.18,
        fontSize: 5, align: 'center', color: '888888',
      });
    }
  });
}

// ── Design slide ──

const D_MARGIN = 0.35;
const D_TITLE_H = 0.45;
const D_HDR_H = 0.28;
const D_ROW_HDR_W = 0.7;
const D_CELL_GAP = 0.04;
const D_CELL_PAD = 0.06;
const D_CARD_GAP = 0.06;
const D_CARD_ASPECT = 1.4;
const D_CARD_RADIUS = 0.04;
const D_MAX_CW = 0.85;
const D_MIN_CW = 0.3;
const D_EMPTY = 0.2;

// Minimum horizontal cols needed so rows fit within available height
function minColsForH(n: number, _cw: number, ch: number, cellH: number): number {
  if (n === 0) return 0;
  const maxRows = Math.max(1, Math.floor((cellH - D_CELL_PAD * 2 + D_CARD_GAP) / (ch + D_CARD_GAP)));
  return Math.max(1, Math.ceil(n / maxRows));
}

function designLayoutFits(
  cw: number, cellCounts: number[][], numCols: number, numRows: number,
  availW: number, availH: number,
): { fits: boolean; colWidths: number[]; rowHeights: number[] } {
  const ch = cw * D_CARD_ASPECT;
  const estRowH = availH / numRows;

  // Column slots: minimum cols needed in the most-packed cell per column
  const colSlots = Array.from({ length: numCols }, (_, col) => {
    let max = 0;
    for (let row = 0; row < numRows; row++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      const cols = minColsForH(n, cw, ch, estRowH);
      if (cols > max) max = cols;
    }
    return max;
  });

  const colWidths = colSlots.map((s) =>
    s === 0 ? D_EMPTY : s * (cw + D_CARD_GAP) - D_CARD_GAP + D_CELL_PAD * 2
  );
  const totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * D_CELL_GAP;
  if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };

  // Row slots: given real column widths, compute rows needed
  const rowSlots = Array.from({ length: numRows }, (_, row) => {
    let max = 0;
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      const maxHCols = Math.max(1, Math.floor((colWidths[col] - D_CELL_PAD * 2 + D_CARD_GAP) / (cw + D_CARD_GAP)));
      const c = Math.min(n, maxHCols);
      const r = Math.ceil(n / c);
      if (r > max) max = r;
    }
    return max;
  });

  const rowHeights = rowSlots.map((s) =>
    s === 0 ? D_EMPTY : s * (ch + D_CARD_GAP) - D_CARD_GAP + D_CELL_PAD * 2
  );
  const totalH = rowHeights.reduce((s, h) => s + h, 0) + (numRows - 1) * D_CELL_GAP;
  return { fits: totalH <= availH, colWidths, rowHeights };
}

function drawProductCard(
  slide: PptxGenJS.Slide, px: number, py: number, cw: number, ch: number,
  product: Product | undefined, name: string, sku: string, isPlaceholder: boolean,
  cardId: string,
) {
  // Card background
  slide.addShape('roundRect' as PptxGenJS.ShapeType, {
    x: px, y: py, w: cw, h: ch,
    fill: { color: isPlaceholder ? 'E8F6FD' : 'FFFFFF' },
    line: { color: isPlaceholder ? '0097A7' : 'D0D0D0', width: 0.75 },
    rectRadius: D_CARD_RADIUS,
    objectName: `${cardId}-bg`,
  });

  // Image zone: top 45% of card
  const imgZoneH = ch * 0.45;
  const imgW = cw * 0.55;
  const imgH = imgZoneH * 0.8;
  const imgX = px + (cw - imgW) / 2;
  const imgY = py + (imgZoneH - imgH) / 2 + 0.01;

  if (product?.imageUrl) {
    try {
      slide.addImage({
        path: product.imageUrl,
        x: imgX, y: imgY, w: imgW, h: imgH,
        rounding: true,
        objectName: `${cardId}-img`,
      });
    } catch {
      drawPlaceholderCircle(slide, imgX, imgY, imgW, imgH, name.charAt(0), isPlaceholder);
    }
  } else {
    drawPlaceholderCircle(slide, imgX, imgY, imgW, imgH, isPlaceholder ? '+' : name.charAt(0), isPlaceholder);
  }

  // Name: middle 35%
  const nameY = py + imgZoneH;
  const nameH = ch * 0.35;
  const nameFontSize = Math.max(5, Math.min(7, Math.round(cw * 8)));
  slide.addText(name, {
    x: px + 0.02, y: nameY, w: cw - 0.04, h: nameH,
    fontSize: nameFontSize, bold: true,
    align: 'center', valign: 'top', color: '333333', wrap: true,
    objectName: `${cardId}-name`,
  });

  // SKU: bottom 18%
  if (sku) {
    const skuY = py + ch - ch * 0.18;
    const skuH = ch * 0.16;
    const skuFontSize = Math.max(4, Math.min(6, Math.round(cw * 6)));
    slide.addText(sku, {
      x: px + 0.02, y: skuY, w: cw - 0.04, h: skuH,
      fontSize: skuFontSize,
      align: 'center', valign: 'middle', color: '999999',
      objectName: `${cardId}-sku`,
    });
  }
}

function drawPlaceholderCircle(
  slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number,
  letter: string, isNew: boolean,
) {
  slide.addShape('roundRect' as PptxGenJS.ShapeType, {
    x, y, w, h,
    fill: { color: isNew ? 'B2EBF2' : 'F0F0F0' },
    rectRadius: 0.02,
  });
  slide.addText(letter, {
    x, y, w, h,
    fontSize: Math.max(8, Math.round(w * 14)),
    align: 'center', valign: 'middle',
    color: isNew ? '00838F' : 'BBBBBB',
  });
}

function addDesignSlide(pptx: PptxGenJS, shelf: Shelf, catalogue: Product[], label: string) {
  const layout = shelf.matrixLayout;
  if (!layout || layout.xLabels.length === 0 || layout.yLabels.length === 0) return;

  const slide = pptx.addSlide();
  const numCols = layout.xLabels.length;
  const numRows = layout.yLabels.length;

  slide.addText(`${layout.title} — ${label}`, {
    x: D_MARGIN, y: D_MARGIN * 0.5, w: SLIDE_WIDTH - D_MARGIN * 2, h: D_TITLE_H,
    fontSize: 18, bold: true, color: '1a1a2e', objectName: 'slide-title',
  });

  const gridTop = D_MARGIN + D_TITLE_H;
  const gridLeft = D_MARGIN + D_ROW_HDR_W + D_CELL_GAP;
  const availW = SLIDE_WIDTH - gridLeft - D_MARGIN;
  const availH = SLIDE_HEIGHT - gridTop - D_HDR_H - D_CELL_GAP - D_MARGIN;

  // Cell counts
  const cellCounts: number[][] = [];
  for (let r = 0; r < numRows; r++) {
    cellCounts.push([]);
    for (let c = 0; c < numCols; c++) {
      cellCounts[r].push(layout.assignments.filter((a) => a.row === r && a.col === c).length);
    }
  }

  // Binary search for largest uniform card width
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

  // Distribute extra space to non-empty only
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

  // Positions
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
      fill: { color: 'DCE6F0' }, rectRadius: 0.03, objectName: `x-label-${c}`,
    });
    slide.addText(layout.xLabels[c], {
      x: colXs[c], y: gridTop, w: bestColW[c], h: D_HDR_H,
      fontSize: 9, bold: true, align: 'center', valign: 'middle', color: '2C3E50',
    });
  }

  // Row headers
  for (let r = 0; r < numRows; r++) {
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x: D_MARGIN, y: rowYs[r], w: D_ROW_HDR_W, h: bestRowH[r],
      fill: { color: 'F0E6D6' }, rectRadius: 0.03, objectName: `y-label-${r}`,
    });
    slide.addText(layout.yLabels[r], {
      x: D_MARGIN, y: rowYs[r], w: D_ROW_HDR_W, h: bestRowH[r],
      fontSize: 8, bold: true, align: 'center', valign: 'middle', color: '5D4E37',
      rotate: 270,
    });
  }

  // Cells and cards
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cellX = colXs[c];
      const cellY = rowYs[r];
      const cellW = bestColW[c];
      const cellH = bestRowH[r];

      // Cell background
      slide.addShape('roundRect' as PptxGenJS.ShapeType, {
        x: cellX, y: cellY, w: cellW, h: cellH,
        fill: { color: 'FAFAFA' }, line: { color: 'E8E8E8', width: 0.5 },
        rectRadius: 0.03,
        objectName: `cell-${layout.xLabels[c]}-${layout.yLabels[r]}`.replace(/\s/g, '_'),
      });

      const assignments = layout.assignments.filter((a) => a.row === r && a.col === c);
      if (assignments.length === 0) continue;

      // 2D grid layout matching web view algorithm
      const innerW = cellW - D_CELL_PAD * 2;
      const innerH = cellH - D_CELL_PAD * 2;

      // Prefer vertical stacking: find minimum cols that fit vertically
      const maxVRows = Math.max(1, Math.floor((innerH + D_CARD_GAP) / (bestCH + D_CARD_GAP)));
      const gridCols = Math.max(1, Math.ceil(assignments.length / maxVRows));
      const gridRows = Math.ceil(assignments.length / gridCols);

      // Center the card grid within the cell
      const gridW = gridCols * bestCW + (gridCols - 1) * D_CARD_GAP;
      const gridH = gridRows * bestCH + (gridRows - 1) * D_CARD_GAP;
      const startX = cellX + D_CELL_PAD + (innerW - gridW) / 2;
      const startY = cellY + D_CELL_PAD + (innerH - gridH) / 2;

      assignments.forEach((assignment, idx) => {
        const item = shelf.items.find((i) => i.id === assignment.itemId);
        if (!item) return;
        const product = getProduct(catalogue, item.productId);
        const name = item.isPlaceholder ? (item.placeholderName || 'New SKU') : (product?.name || 'Unknown');
        const sku = product?.sku || '';

        const gc = idx % gridCols;
        const gr = Math.floor(idx / gridCols);
        const px = startX + gc * (bestCW + D_CARD_GAP);
        const py = startY + gr * (bestCH + D_CARD_GAP);

        const cardId = (sku || name).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25);

        drawProductCard(slide, px, py, bestCW, bestCH, product, name, sku, item.isPlaceholder, cardId);
      });
    }
  }
}

export function exportToPptx(project: Project): void {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Range Planner';
  pptx.title = project.name;

  // Slide 1: Transform
  const tSlide = pptx.addSlide();
  tSlide.addText(project.name + ' — Range Transformation', {
    x: 0.3, y: 0.15, w: SLIDE_WIDTH - 0.6, h: 0.5,
    fontSize: 20, bold: true, color: '1a1a2e', objectName: 'transform-title',
  });
  drawShelfItems(tSlide, project.currentShelf, project.catalogue, 1.0);
  drawShelfItems(tSlide, project.futureShelf, project.catalogue, 4.2);

  const cCardW = Math.min(CARD_W, (SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2 - (project.currentShelf.items.length - 1) * CARD_GAP_PPT) / Math.max(project.currentShelf.items.length, 1));
  const fCardW = Math.min(CARD_W, (SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2 - (project.futureShelf.items.length - 1) * CARD_GAP_PPT) / Math.max(project.futureShelf.items.length, 1));

  project.sankeyLinks.forEach((link) => {
    const si = project.currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
    const ti = project.futureShelf.items.findIndex((i) => i.id === link.targetItemId);
    if (si === -1 || ti === -1) return;
    const sx = SHELF_MARGIN_LEFT + si * (cCardW + CARD_GAP_PPT) + cCardW / 2;
    const tx = SHELF_MARGIN_LEFT + ti * (fCardW + CARD_GAP_PPT) + fCardW / 2;
    const color = link.type === 'growth' ? '4CAF50' : link.type === 'loss' ? 'F44336' : '2196F3';
    tSlide.addShape('line' as PptxGenJS.ShapeType, {
      x: Math.min(sx, tx), y: 1.0 + 0.15 + CARD_H + 0.05,
      w: Math.abs(tx - sx) || 0.01, h: 4.2 + 0.1 - (1.0 + 0.15 + CARD_H + 0.05),
      line: { color, width: Math.max(0.5, Math.min(link.volume / 1000, 4)) },
    });
  });

  // Design slides
  addDesignSlide(pptx, project.currentShelf, project.catalogue, 'Current Range');
  addDesignSlide(pptx, project.futureShelf, project.catalogue, 'Future Range');

  pptx.writeFile({ fileName: `${project.name.replace(/\s+/g, '_')}_range_plan.pptx` });
}
