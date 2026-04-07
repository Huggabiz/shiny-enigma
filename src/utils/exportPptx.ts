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

function drawShelfItems(
  slide: PptxGenJS.Slide,
  shelf: Shelf,
  catalogue: Product[],
  shelfY: number,
) {
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
      const startPos = Math.min(...positions);
      const endPos = Math.max(...positions);
      const x = SHELF_MARGIN_LEFT + startPos * (cardW + CARD_GAP_PPT);
      const w = (endPos - startPos) * (cardW + CARD_GAP_PPT) + cardW;
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x, y: shelfY - 0.2, w, h: 0.17,
        fill: { color: 'DCE6F0' }, rectRadius: 0.02,
      });
      slide.addText(layout.xLabels[col], {
        x, y: shelfY - 0.2, w, h: 0.17,
        fontSize: 6, align: 'center', color: '2C3E50', bold: true,
      });
    }
    for (let col = 0; col < layout.xLabels.length; col++) {
      for (let row = 0; row < layout.yLabels.length; row++) {
        const positions = layout.assignments.filter((a) => a.col === col && a.row === row)
          .map((a) => posMap.get(a.itemId)).filter((p): p is number => p !== undefined);
        if (positions.length === 0) continue;
        const startPos = Math.min(...positions);
        const endPos = Math.max(...positions);
        const x = SHELF_MARGIN_LEFT + startPos * (cardW + CARD_GAP_PPT);
        const w = (endPos - startPos) * (cardW + CARD_GAP_PPT) + cardW;
        slide.addShape('rect' as PptxGenJS.ShapeType, {
          x, y: shelfY - 0.02, w, h: 0.14,
          fill: { color: 'F0E6D6' }, rectRadius: 0.02,
        });
        slide.addText(layout.yLabels[row], {
          x, y: shelfY - 0.02, w, h: 0.14,
          fontSize: 5, align: 'center', color: '5D4E37',
        });
      }
    }
  }

  items.forEach((item, index) => {
    const x = SHELF_MARGIN_LEFT + index * (cardW + CARD_GAP_PPT);
    const product = getProduct(catalogue, item.productId);
    const name = item.isPlaceholder ? item.placeholderName || 'New SKU' : product?.name || 'Unknown';
    const isPlaceholder = item.isPlaceholder;

    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x, y: shelfY + 0.15, w: cardW, h: CARD_H,
      fill: { color: isPlaceholder ? 'E8F6FD' : 'FFFFFF' },
      line: { color: isPlaceholder ? '0097A7' : 'DDDDDD', width: 1 },
      rectRadius: 0.04,
      objectName: `shelf-card-${item.id}`,
    });

    if (product?.imageUrl) {
      const imgW = cardW * 0.55;
      const imgH = imgW * 0.85;
      try {
        slide.addImage({
          path: product.imageUrl,
          x: x + (cardW - imgW) / 2, y: shelfY + 0.2,
          w: imgW, h: imgH, rounding: true,
          objectName: `shelf-img-${item.id}`,
        });
      } catch { /* skip failed images */ }
    }

    slide.addText(name, {
      x, y: shelfY + 0.15 + (product?.imageUrl ? 0.55 : 0.05),
      w: cardW, h: 0.45,
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

// ── Design slide: replicates the on-screen matrix layout ──

const DESIGN_MARGIN = 0.35;
const DESIGN_TITLE_H = 0.45;
const DESIGN_HEADER_H = 0.28;
const DESIGN_ROW_HEADER_W = 0.7;
const DESIGN_CELL_GAP = 0.04;
const DESIGN_CELL_PAD = 0.05;
const DESIGN_CARD_GAP = 0.05;
const DESIGN_CARD_ASPECT = 1.4;
const DESIGN_CARD_RADIUS = 0.04;
const DESIGN_MAX_CARD_W = 0.85;
const DESIGN_MIN_CARD_W = 0.35;

// Same algorithm as the on-screen layout: find largest uniform card width that fits
function computeDesignLayout(
  cellCounts: number[][],
  numCols: number,
  numRows: number,
  availW: number,
  availH: number,
): { cardW: number; colWidths: number[]; rowHeights: number[] } {
  // Binary search for largest card width
  let lo = Math.round(DESIGN_MIN_CARD_W * 100);
  let hi = Math.round(DESIGN_MAX_CARD_W * 100);
  let bestCW = DESIGN_MIN_CARD_W;
  let bestColWidths: number[] = Array(numCols).fill(0.5);
  let bestRowHeights: number[] = Array(numRows).fill(0.5);

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cw = mid / 100;
    const ch = cw * DESIGN_CARD_ASPECT;
    const result = tryDesignFit(cw, ch, cellCounts, numCols, numRows, availW, availH);
    if (result.fits) {
      bestCW = cw;
      bestColWidths = result.colWidths;
      bestRowHeights = result.rowHeights;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { cardW: bestCW, colWidths: bestColWidths, rowHeights: bestRowHeights };
}

function tryDesignFit(
  cardW: number, cardH: number,
  cellCounts: number[][], numCols: number, numRows: number,
  availW: number, availH: number,
): { fits: boolean; colWidths: number[]; rowHeights: number[] } {
  const estRowH = availH / numRows;

  // For each column: compute minimum cols needed in the most-packed cell
  const colSlots = Array.from({ length: numCols }, (_, col) => {
    let maxCols = 0;
    for (let row = 0; row < numRows; row++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      const maxVertSlots = Math.max(1, Math.floor((estRowH - DESIGN_CELL_PAD * 2 + DESIGN_CARD_GAP) / (cardH + DESIGN_CARD_GAP)));
      const cols = Math.max(1, Math.ceil(n / maxVertSlots));
      if (cols > maxCols) maxCols = cols;
    }
    return maxCols;
  });

  const emptyColW = 0.2;
  const colWidths = colSlots.map((slots) =>
    slots === 0 ? emptyColW : slots * (cardW + DESIGN_CARD_GAP) - DESIGN_CARD_GAP + DESIGN_CELL_PAD * 2
  );
  const totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * DESIGN_CELL_GAP;
  if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };

  // Row heights from actual column widths
  const rowSlots = Array.from({ length: numRows }, (_, row) => {
    let maxRows = 0;
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      const maxHorzSlots = Math.max(1, Math.floor((colWidths[col] - DESIGN_CELL_PAD * 2 + DESIGN_CARD_GAP) / (cardW + DESIGN_CARD_GAP)));
      const cols = Math.min(n, maxHorzSlots);
      const rows = Math.ceil(n / cols);
      if (rows > maxRows) maxRows = rows;
    }
    return maxRows;
  });

  const rowHeights = rowSlots.map((slots) =>
    slots === 0 ? emptyColW : slots * (cardH + DESIGN_CARD_GAP) - DESIGN_CARD_GAP + DESIGN_CELL_PAD * 2
  );
  const totalH = rowHeights.reduce((s, h) => s + h, 0) + (numRows - 1) * DESIGN_CELL_GAP;

  return { fits: totalH <= availH, colWidths, rowHeights };
}

function addDesignSlide(pptx: PptxGenJS, shelf: Shelf, catalogue: Product[], label: string) {
  const layout = shelf.matrixLayout;
  if (!layout || layout.xLabels.length === 0 || layout.yLabels.length === 0) return;

  const slide = pptx.addSlide();
  const numCols = layout.xLabels.length;
  const numRows = layout.yLabels.length;

  // Title
  slide.addText(`${layout.title} — ${label}`, {
    x: DESIGN_MARGIN, y: DESIGN_MARGIN * 0.5, w: SLIDE_WIDTH - DESIGN_MARGIN * 2, h: DESIGN_TITLE_H,
    fontSize: 18, bold: true, color: '1a1a2e',
    objectName: 'slide-title',
  });

  const gridTop = DESIGN_MARGIN + DESIGN_TITLE_H;
  const gridLeft = DESIGN_MARGIN + DESIGN_ROW_HEADER_W + DESIGN_CELL_GAP;
  const availW = SLIDE_WIDTH - gridLeft - DESIGN_MARGIN;
  const availH = SLIDE_HEIGHT - gridTop - DESIGN_HEADER_H - DESIGN_CELL_GAP - DESIGN_MARGIN;

  // Cell counts
  const cellCounts: number[][] = [];
  for (let row = 0; row < numRows; row++) {
    cellCounts.push([]);
    for (let col = 0; col < numCols; col++) {
      cellCounts[row].push(layout.assignments.filter((a) => a.row === row && a.col === col).length);
    }
  }

  const { cardW, colWidths, rowHeights } = computeDesignLayout(cellCounts, numCols, numRows, availW, availH);
  const cardH = cardW * DESIGN_CARD_ASPECT;

  // Distribute extra space to non-empty cols/rows
  const totalColW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * DESIGN_CELL_GAP;
  if (totalColW < availW) {
    const nonEmpty = colWidths.filter((w) => w > 0.25).length || 1;
    const extra = (availW - totalColW) / nonEmpty;
    for (let i = 0; i < colWidths.length; i++) {
      if (colWidths[i] > 0.25) colWidths[i] += extra;
    }
  }
  const totalRowH = rowHeights.reduce((s, h) => s + h, 0) + (numRows - 1) * DESIGN_CELL_GAP;
  if (totalRowH < availH) {
    const nonEmpty = rowHeights.filter((h) => h > 0.25).length || 1;
    const extra = (availH - totalRowH) / nonEmpty;
    for (let i = 0; i < rowHeights.length; i++) {
      if (rowHeights[i] > 0.25) rowHeights[i] += extra;
    }
  }

  // Column X positions
  const colXs: number[] = [];
  let cx = gridLeft;
  for (let col = 0; col < numCols; col++) {
    colXs.push(cx);
    cx += colWidths[col] + DESIGN_CELL_GAP;
  }

  // Row Y positions
  const rowYs: number[] = [];
  let ry = gridTop + DESIGN_HEADER_H + DESIGN_CELL_GAP;
  for (let row = 0; row < numRows; row++) {
    rowYs.push(ry);
    ry += rowHeights[row] + DESIGN_CELL_GAP;
  }

  // ── Draw column headers (X labels) ──
  for (let col = 0; col < numCols; col++) {
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x: colXs[col], y: gridTop, w: colWidths[col], h: DESIGN_HEADER_H,
      fill: { color: 'DCE6F0' }, rectRadius: 0.03,
      objectName: `x-label-${col}`,
    });
    slide.addText(layout.xLabels[col], {
      x: colXs[col], y: gridTop, w: colWidths[col], h: DESIGN_HEADER_H,
      fontSize: 9, bold: true, align: 'center', valign: 'middle', color: '2C3E50',
    });
  }

  // ── Draw row headers (Y labels) ──
  for (let row = 0; row < numRows; row++) {
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x: DESIGN_MARGIN, y: rowYs[row], w: DESIGN_ROW_HEADER_W, h: rowHeights[row],
      fill: { color: 'F0E6D6' }, rectRadius: 0.03,
      objectName: `y-label-${row}`,
    });
    slide.addText(layout.yLabels[row], {
      x: DESIGN_MARGIN, y: rowYs[row], w: DESIGN_ROW_HEADER_W, h: rowHeights[row],
      fontSize: 8, bold: true, align: 'center', valign: 'middle', color: '5D4E37',
      rotate: 270,
    });
  }

  // ── Draw cells and product cards ──
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      const cellX = colXs[col];
      const cellY = rowYs[row];
      const cellW = colWidths[col];
      const cellH2 = rowHeights[row];
      const cellName = `cell-${layout.xLabels[col]}-${layout.yLabels[row]}`;

      // Cell background
      slide.addShape('roundRect' as PptxGenJS.ShapeType, {
        x: cellX, y: cellY, w: cellW, h: cellH2,
        fill: { color: 'FAFAFA' },
        line: { color: 'E8E8E8', width: 0.5 },
        rectRadius: 0.03,
        objectName: cellName,
      });

      // Products in this cell
      const cellAssignments = layout.assignments.filter((a) => a.row === row && a.col === col);
      if (cellAssignments.length === 0) continue;

      // Compute grid layout within cell
      const innerW = cellW - DESIGN_CELL_PAD * 2;
      const innerH = cellH2 - DESIGN_CELL_PAD * 2;
      const maxHCols = Math.max(1, Math.floor((innerW + DESIGN_CARD_GAP) / (cardW + DESIGN_CARD_GAP)));
      const gridCols = Math.min(cellAssignments.length, maxHCols);
      const gridRows = Math.ceil(cellAssignments.length / gridCols);

      // Center the grid within the cell
      const gridW = gridCols * (cardW + DESIGN_CARD_GAP) - DESIGN_CARD_GAP;
      const gridH = gridRows * (cardH + DESIGN_CARD_GAP) - DESIGN_CARD_GAP;
      const startX = cellX + DESIGN_CELL_PAD + (innerW - gridW) / 2;
      const startY = cellY + DESIGN_CELL_PAD + (innerH - gridH) / 2;

      cellAssignments.forEach((assignment, idx) => {
        const item = shelf.items.find((i) => i.id === assignment.itemId);
        if (!item) return;
        const product = getProduct(catalogue, item.productId);
        const name = item.isPlaceholder ? (item.placeholderName || 'New SKU') : (product?.name || 'Unknown');
        const sku = product?.sku || '';
        const isPlaceholder = item.isPlaceholder;

        const gridCol = idx % gridCols;
        const gridRow = Math.floor(idx / gridCols);
        const px = startX + gridCol * (cardW + DESIGN_CARD_GAP);
        const py = startY + gridRow * (cardH + DESIGN_CARD_GAP);

        const cardName = `${sku || name}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);

        // Card background — rounded rectangle
        slide.addShape('roundRect' as PptxGenJS.ShapeType, {
          x: px, y: py, w: cardW, h: cardH,
          fill: { color: isPlaceholder ? 'E8F6FD' : 'FFFFFF' },
          line: { color: isPlaceholder ? '0097A7' : 'D0D0D0', width: 0.75 },
          rectRadius: DESIGN_CARD_RADIUS,
          objectName: `card-bg-${cardName}`,
        });

        // Image area (top portion of card)
        const imgAreaH = cardH * 0.48;
        const imgW = cardW * 0.6;
        const imgH = imgAreaH * 0.85;

        if (product?.imageUrl) {
          try {
            slide.addImage({
              path: product.imageUrl,
              x: px + (cardW - imgW) / 2,
              y: py + (imgAreaH - imgH) / 2 + 0.02,
              w: imgW, h: imgH,
              rounding: true,
              objectName: `card-img-${cardName}`,
            });
          } catch {
            // Image placeholder
            slide.addText(name.charAt(0), {
              x: px + (cardW - imgW) / 2,
              y: py + (imgAreaH - imgH) / 2 + 0.02,
              w: imgW, h: imgH,
              fontSize: Math.round(imgW * 18),
              align: 'center', valign: 'middle',
              color: 'CCCCCC',
            });
          }
        } else {
          // Placeholder initial
          slide.addShape('roundRect' as PptxGenJS.ShapeType, {
            x: px + (cardW - imgW) / 2,
            y: py + (imgAreaH - imgH) / 2 + 0.02,
            w: imgW, h: imgH,
            fill: { color: isPlaceholder ? 'B2EBF2' : 'F0F0F0' },
            rectRadius: 0.02,
          });
          slide.addText(isPlaceholder ? '+' : name.charAt(0), {
            x: px + (cardW - imgW) / 2,
            y: py + (imgAreaH - imgH) / 2 + 0.02,
            w: imgW, h: imgH,
            fontSize: Math.round(imgW * 16),
            align: 'center', valign: 'middle',
            color: isPlaceholder ? '00838F' : 'BBBBBB',
          });
        }

        // Product name (middle portion)
        const nameY = py + imgAreaH + 0.01;
        const nameH = cardH * 0.32;
        slide.addText(name, {
          x: px + 0.02, y: nameY, w: cardW - 0.04, h: nameH,
          fontSize: Math.max(5, Math.min(7, Math.round(cardW * 9))),
          align: 'center', valign: 'top', color: '333333',
          bold: true, wrap: true,
          objectName: `card-name-${cardName}`,
        });

        // SKU (bottom portion)
        const skuY = py + cardH - cardH * 0.18;
        const skuH = cardH * 0.16;
        if (sku) {
          slide.addText(sku, {
            x: px + 0.02, y: skuY, w: cardW - 0.04, h: skuH,
            fontSize: Math.max(4, Math.min(5, Math.round(cardW * 6))),
            align: 'center', valign: 'middle', color: '999999',
            objectName: `card-sku-${cardName}`,
          });
        }
      });
    }
  }
}

export function exportToPptx(project: Project): void {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Range Planner';
  pptx.title = project.name;

  // Slide 1: Transform view
  const transformSlide = pptx.addSlide();
  transformSlide.addText(project.name + ' — Range Transformation', {
    x: 0.3, y: 0.15, w: SLIDE_WIDTH - 0.6, h: 0.5,
    fontSize: 20, bold: true, color: '1a1a2e',
    objectName: 'transform-title',
  });

  drawShelfItems(transformSlide, project.currentShelf, project.catalogue, 1.0);
  drawShelfItems(transformSlide, project.futureShelf, project.catalogue, 4.2);

  const currentCardW = Math.min(CARD_W, (SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2 - (project.currentShelf.items.length - 1) * CARD_GAP_PPT) / Math.max(project.currentShelf.items.length, 1));
  const futureCardW = Math.min(CARD_W, (SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2 - (project.futureShelf.items.length - 1) * CARD_GAP_PPT) / Math.max(project.futureShelf.items.length, 1));

  project.sankeyLinks.forEach((link) => {
    const si = project.currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
    const ti = project.futureShelf.items.findIndex((i) => i.id === link.targetItemId);
    if (si === -1 || ti === -1) return;
    const sx = SHELF_MARGIN_LEFT + si * (currentCardW + CARD_GAP_PPT) + currentCardW / 2;
    const tx = SHELF_MARGIN_LEFT + ti * (futureCardW + CARD_GAP_PPT) + futureCardW / 2;
    const sy = 1.0 + 0.15 + CARD_H + 0.05;
    const ty = 4.2 + 0.1;
    const color = link.type === 'growth' ? '4CAF50' : link.type === 'loss' ? 'F44336' : '2196F3';
    const minX = Math.min(sx, tx);
    addSankeyLine(transformSlide, minX, sy, Math.abs(tx - sx) || 0.01, ty - sy, color, link.volume);
  });

  // Slide 2 & 3: Design views
  addDesignSlide(pptx, project.currentShelf, project.catalogue, 'Current Range');
  addDesignSlide(pptx, project.futureShelf, project.catalogue, 'Future Range');

  pptx.writeFile({ fileName: `${project.name.replace(/\s+/g, '_')}_range_plan.pptx` });
}

function addSankeyLine(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color: string, volume: number) {
  s.addShape('line' as PptxGenJS.ShapeType, {
    x, y, w, h,
    line: { color, width: Math.max(0.5, Math.min(volume / 1000, 4)) },
  });
}
