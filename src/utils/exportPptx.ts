import PptxGenJS from 'pptxgenjs';
import type { Project, Product, Shelf } from '../types';

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;
const CARD_W = 0.9;
const CARD_H = 1.2;
const CARD_GAP = 0.1;
const SHELF_MARGIN_LEFT = 0.3;

function getProduct(catalogue: Product[], productId: string): Product | undefined {
  return catalogue.find((p) => p.id === productId);
}

// Add product image to slide if URL available
function addProductImage(slide: PptxGenJS.Slide, product: Product | undefined, x: number, y: number, w: number, h: number) {
  if (product?.imageUrl) {
    try {
      slide.addImage({
        path: product.imageUrl,
        x, y, w, h,
        rounding: true,
      });
    } catch {
      // If image fails, show placeholder text
      slide.addText(product.name?.charAt(0) || '?', {
        x, y, w, h,
        fontSize: 12,
        align: 'center',
        valign: 'middle',
        color: 'BBBBBB',
      });
    }
  }
}

function drawShelfItems(
  slide: PptxGenJS.Slide,
  shelf: Shelf,
  catalogue: Product[],
  shelfY: number,
) {
  const items = shelf.items;
  const layout = shelf.matrixLayout;

  // Shelf title
  slide.addText(shelf.name, {
    x: SHELF_MARGIN_LEFT,
    y: shelfY - 0.45,
    w: 4,
    h: 0.35,
    fontSize: 12,
    bold: true,
    color: '333333',
  });

  // Compute card width to fit all items
  const maxCards = items.length;
  const availableW = SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2;
  const cardW = Math.min(CARD_W, (availableW - (maxCards - 1) * CARD_GAP) / Math.max(maxCards, 1));

  // Derive labels from matrix
  if (layout && layout.assignments.length > 0) {
    const posMap = new Map(items.map((item, idx) => [item.id, idx]));

    // X labels
    for (let col = 0; col < layout.xLabels.length; col++) {
      const positions = layout.assignments.filter((a) => a.col === col)
        .map((a) => posMap.get(a.itemId)).filter((p): p is number => p !== undefined);
      if (positions.length === 0) continue;
      const startPos = Math.min(...positions);
      const endPos = Math.max(...positions);
      const x = SHELF_MARGIN_LEFT + startPos * (cardW + CARD_GAP);
      const w = (endPos - startPos) * (cardW + CARD_GAP) + cardW;
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x, y: shelfY - 0.2, w, h: 0.17,
        fill: { color: 'DCE6F0' }, rectRadius: 0.02,
      });
      slide.addText(layout.xLabels[col], {
        x, y: shelfY - 0.2, w, h: 0.17,
        fontSize: 6, align: 'center', color: '2C3E50', bold: true,
      });
    }

    // Y labels
    for (let col = 0; col < layout.xLabels.length; col++) {
      for (let row = 0; row < layout.yLabels.length; row++) {
        const positions = layout.assignments.filter((a) => a.col === col && a.row === row)
          .map((a) => posMap.get(a.itemId)).filter((p): p is number => p !== undefined);
        if (positions.length === 0) continue;
        const startPos = Math.min(...positions);
        const endPos = Math.max(...positions);
        const x = SHELF_MARGIN_LEFT + startPos * (cardW + CARD_GAP);
        const w = (endPos - startPos) * (cardW + CARD_GAP) + cardW;
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

  // Product cards
  items.forEach((item, index) => {
    const x = SHELF_MARGIN_LEFT + index * (cardW + CARD_GAP);
    const product = getProduct(catalogue, item.productId);
    const name = item.isPlaceholder ? item.placeholderName || 'New SKU' : product?.name || 'Unknown';
    const volume = product?.volume || 0;
    const isPlaceholder = item.isPlaceholder;

    // Card background
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x, y: shelfY + 0.15, w: cardW, h: CARD_H,
      fill: { color: isPlaceholder ? 'E8F6FD' : 'FFFFFF' },
      line: { color: isPlaceholder ? '0097A7' : 'DDDDDD', width: 1 },
      rectRadius: 0.04,
    });

    // Product image
    if (product?.imageUrl) {
      const imgSize = cardW * 0.6;
      addProductImage(slide, product, x + (cardW - imgSize) / 2, shelfY + 0.2, imgSize, imgSize * 0.8);
    }

    // Product name
    slide.addText(name, {
      x, y: shelfY + 0.15 + (product?.imageUrl ? 0.55 : 0.05),
      w: cardW, h: 0.45,
      fontSize: 6, align: 'center', color: '333333', valign: 'top', wrap: true,
    });

    // Volume
    if (volume > 0) {
      slide.addText(`Vol: ${volume.toLocaleString()}`, {
        x, y: shelfY + 0.15 + CARD_H - 0.2,
        w: cardW, h: 0.18,
        fontSize: 5, align: 'center', color: '888888',
      });
    }
  });
}

function addDesignSlide(pptx: PptxGenJS, shelf: Shelf, catalogue: Product[], label: string) {
  const layout = shelf.matrixLayout;
  if (!layout || layout.xLabels.length === 0 || layout.yLabels.length === 0) return;

  const slide = pptx.addSlide();

  // Title
  slide.addText(`${layout.title} — ${label}`, {
    x: 0.4, y: 0.2, w: SLIDE_WIDTH - 0.8, h: 0.5,
    fontSize: 20, bold: true, color: '1a1a2e',
  });

  // Matrix dimensions
  const marginLeft = 1.0;
  const marginTop = 0.9;
  const headerH = 0.3;
  const rowHeaderW = 0.8;
  const availableW = SLIDE_WIDTH - marginLeft - rowHeaderW - 0.4;
  const availableH = SLIDE_HEIGHT - marginTop - headerH - 0.4;
  const colW = availableW / layout.xLabels.length;
  const rowH = availableH / layout.yLabels.length;

  // Column headers (X labels)
  layout.xLabels.forEach((label, i) => {
    const x = marginLeft + rowHeaderW + i * colW;
    slide.addShape('rect' as PptxGenJS.ShapeType, {
      x, y: marginTop, w: colW - 0.05, h: headerH,
      fill: { color: 'DCE6F0' }, rectRadius: 0.03,
    });
    slide.addText(label, {
      x, y: marginTop, w: colW - 0.05, h: headerH,
      fontSize: 9, bold: true, align: 'center', color: '2C3E50',
    });
  });

  // Row headers + cells
  layout.yLabels.forEach((yLabel, row) => {
    const y = marginTop + headerH + 0.05 + row * rowH;

    // Row header
    slide.addShape('rect' as PptxGenJS.ShapeType, {
      x: marginLeft, y, w: rowHeaderW - 0.05, h: rowH - 0.05,
      fill: { color: 'F0E6D6' }, rectRadius: 0.03,
    });
    slide.addText(yLabel, {
      x: marginLeft, y, w: rowHeaderW - 0.05, h: rowH - 0.05,
      fontSize: 8, bold: true, align: 'center', valign: 'middle', color: '5D4E37',
    });

    // Cells
    layout.xLabels.forEach((_, col) => {
      const cellX = marginLeft + rowHeaderW + col * colW;
      const cellItems = layout.assignments.filter((a) => a.row === row && a.col === col);

      // Cell border
      slide.addShape('rect' as PptxGenJS.ShapeType, {
        x: cellX, y, w: colW - 0.05, h: rowH - 0.05,
        fill: { color: 'FAFAFA' },
        line: { color: 'E8E8E8', width: 0.5 },
        rectRadius: 0.03,
      });

      // Products in cell
      const cellCardW = Math.min(0.8, (colW - 0.15) / Math.max(cellItems.length, 1));
      cellItems.forEach((assignment, idx) => {
        const item = shelf.items.find((i) => i.id === assignment.itemId);
        if (!item) return;
        const product = getProduct(catalogue, item.productId);
        const name = item.isPlaceholder ? item.placeholderName || 'New' : product?.name || '?';
        const px = cellX + 0.05 + idx * (cellCardW + 0.03);
        const py = y + 0.05;
        const ph = rowH - 0.15;

        // Mini card
        slide.addShape('roundRect' as PptxGenJS.ShapeType, {
          x: px, y: py, w: cellCardW, h: ph,
          fill: { color: item.isPlaceholder ? 'E8F6FD' : 'FFFFFF' },
          line: { color: 'DDDDDD', width: 0.5 },
          rectRadius: 0.03,
        });

        // Image
        if (product?.imageUrl) {
          const imgW = cellCardW * 0.7;
          addProductImage(slide, product, px + (cellCardW - imgW) / 2, py + 0.03, imgW, imgW * 0.8);
        }

        // Name
        slide.addText(name, {
          x: px, y: py + ph - 0.35, w: cellCardW, h: 0.3,
          fontSize: 5, align: 'center', color: '333333', wrap: true,
        });
      });
    });
  });
}

export function exportToPptx(project: Project): void {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Range Planner';
  pptx.title = project.name;

  // Slide 1: Transform view (Current → Future)
  const transformSlide = pptx.addSlide();
  transformSlide.addText(project.name + ' — Range Transformation', {
    x: 0.3, y: 0.15, w: SLIDE_WIDTH - 0.6, h: 0.5,
    fontSize: 20, bold: true, color: '1a1a2e',
  });

  drawShelfItems(transformSlide, project.currentShelf, project.catalogue, 1.0);
  drawShelfItems(transformSlide, project.futureShelf, project.catalogue, 4.2);

  // Sankey lines
  const currentCardW = Math.min(CARD_W, (SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2 - (project.currentShelf.items.length - 1) * CARD_GAP) / Math.max(project.currentShelf.items.length, 1));
  const futureCardW = Math.min(CARD_W, (SLIDE_WIDTH - SHELF_MARGIN_LEFT * 2 - (project.futureShelf.items.length - 1) * CARD_GAP) / Math.max(project.futureShelf.items.length, 1));

  project.sankeyLinks.forEach((link) => {
    const si = project.currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
    const ti = project.futureShelf.items.findIndex((i) => i.id === link.targetItemId);
    if (si === -1 || ti === -1) return;
    const sx = SHELF_MARGIN_LEFT + si * (currentCardW + CARD_GAP) + currentCardW / 2;
    const tx = SHELF_MARGIN_LEFT + ti * (futureCardW + CARD_GAP) + futureCardW / 2;
    const sy = 1.0 + 0.15 + CARD_H + 0.05;
    const ty = 4.2 + 0.1;
    const color = link.type === 'growth' ? '4CAF50' : link.type === 'loss' ? 'F44336' : '2196F3';
    const minX = Math.min(sx, tx);
    slide_addLine(transformSlide, minX, sy, Math.abs(tx - sx) || 0.01, ty - sy, color, link.volume);
  });

  // Slide 2: Current Range Design
  addDesignSlide(pptx, project.currentShelf, project.catalogue, 'Current Range');

  // Slide 3: Future Range Design
  addDesignSlide(pptx, project.futureShelf, project.catalogue, 'Future Range');

  pptx.writeFile({ fileName: `${project.name.replace(/\s+/g, '_')}_range_plan.pptx` });
}

function slide_addLine(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color: string, volume: number) {
  slide.addShape('line' as PptxGenJS.ShapeType, {
    x, y, w, h,
    line: { color, width: Math.max(0.5, Math.min(volume / 1000, 4)) },
  });
}
