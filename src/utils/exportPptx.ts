import PptxGenJS from 'pptxgenjs';
import type { Project, Product, ShelfItem, ShelfLabel } from '../types';

const SLIDE_WIDTH = 13.333; // inches (16:9 at 96dpi)
const SLIDE_HEIGHT = 7.5;
const CARD_W = 1.0;
const CARD_H = 1.4;
const SHELF_Y_CURRENT = 1.2;
const SHELF_Y_FUTURE = 4.5;
const SHELF_MARGIN_LEFT = 0.5;
const CARD_GAP = 0.15;

function getProduct(catalogue: Product[], productId: string): Product | undefined {
  return catalogue.find((p) => p.id === productId);
}

function drawShelfItems(
  slide: PptxGenJS.Slide,
  items: ShelfItem[],
  labels: ShelfLabel[],
  catalogue: Product[],
  shelfY: number,
  shelfName: string
) {
  // Shelf title
  slide.addText(shelfName, {
    x: SHELF_MARGIN_LEFT,
    y: shelfY - 0.5,
    w: 3,
    h: 0.4,
    fontSize: 14,
    bold: true,
    color: '333333',
  });

  // Shelf line
  const shelfLineY = shelfY + CARD_H + 0.05;
  const shelfWidth = Math.max(items.length * (CARD_W + CARD_GAP) + SHELF_MARGIN_LEFT, 6);
  slide.addShape('rect' as PptxGenJS.ShapeType, {
    x: SHELF_MARGIN_LEFT,
    y: shelfLineY,
    w: Math.min(shelfWidth, SLIDE_WIDTH - 1),
    h: 0.04,
    fill: { color: '8B7355' },
  });

  // Labels
  labels.forEach((label) => {
    const x = SHELF_MARGIN_LEFT + label.startPosition * (CARD_W + CARD_GAP);
    const w = (label.endPosition - label.startPosition + 1) * (CARD_W + CARD_GAP) - CARD_GAP;
    slide.addShape('rect' as PptxGenJS.ShapeType, {
      x,
      y: shelfY - 0.25,
      w,
      h: 0.2,
      fill: { color: (label.color || '#E8E0D4').replace('#', '') },
    });
    slide.addText(label.text, {
      x,
      y: shelfY - 0.25,
      w,
      h: 0.2,
      fontSize: 8,
      align: 'center',
      color: '666666',
    });
  });

  // Product cards
  items.forEach((item, index) => {
    const x = SHELF_MARGIN_LEFT + index * (CARD_W + CARD_GAP);
    const product = getProduct(catalogue, item.productId);
    const name = item.isPlaceholder
      ? item.placeholderName || 'New SKU'
      : product?.name || 'Unknown';
    const volume = product?.volume || 0;

    // Card background
    slide.addShape('roundRect' as PptxGenJS.ShapeType, {
      x,
      y: shelfY,
      w: CARD_W,
      h: CARD_H,
      fill: { color: item.isPlaceholder ? 'FFF3E0' : 'FFFFFF' },
      line: { color: item.isPlaceholder ? 'FF9800' : 'DDDDDD', width: 1 },
      rectRadius: 0.05,
    });

    // Product name
    slide.addText(name, {
      x,
      y: shelfY + 0.05,
      w: CARD_W,
      h: 0.6,
      fontSize: 7,
      align: 'center',
      color: '333333',
      valign: 'top',
      wrap: true,
    });

    // Volume
    if (volume > 0) {
      slide.addText(`Vol: ${volume.toLocaleString()}`, {
        x,
        y: shelfY + CARD_H - 0.35,
        w: CARD_W,
        h: 0.3,
        fontSize: 6,
        align: 'center',
        color: '888888',
      });
    }
  });
}

export function exportToPptx(project: Project): void {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 (16:9)
  pptx.author = 'Range Planner';
  pptx.title = project.name;

  const slide = pptx.addSlide();

  // Title
  slide.addText(project.name, {
    x: 0.5,
    y: 0.2,
    w: SLIDE_WIDTH - 1,
    h: 0.6,
    fontSize: 24,
    bold: true,
    color: '1a1a2e',
  });

  // Current shelf
  drawShelfItems(
    slide,
    project.currentShelf.items,
    project.currentShelf.labels,
    project.catalogue,
    SHELF_Y_CURRENT,
    project.currentShelf.name
  );

  // Future shelf
  drawShelfItems(
    slide,
    project.futureShelf.items,
    project.futureShelf.labels,
    project.catalogue,
    SHELF_Y_FUTURE,
    project.futureShelf.name
  );

  // Sankey connections (simplified as arrows in PPT)
  project.sankeyLinks.forEach((link) => {
    const sourceIndex = project.currentShelf.items.findIndex((i) => i.id === link.sourceItemId);
    const targetIndex = project.futureShelf.items.findIndex((i) => i.id === link.targetItemId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const sourceX = SHELF_MARGIN_LEFT + sourceIndex * (CARD_W + CARD_GAP) + CARD_W / 2;
    const targetX = SHELF_MARGIN_LEFT + targetIndex * (CARD_W + CARD_GAP) + CARD_W / 2;
    const sourceY = SHELF_Y_CURRENT + CARD_H + 0.15;
    const targetY = SHELF_Y_FUTURE - 0.1;

    const color =
      link.type === 'growth' ? '4CAF50' : link.type === 'loss' ? 'F44336' : '2196F3';

    // Draw a line connecting source to target
    const minX = Math.min(sourceX, targetX);
    const lineW = Math.abs(targetX - sourceX) || 0.01;
    const lineH = targetY - sourceY;

    slide.addShape('line' as PptxGenJS.ShapeType, {
      x: minX,
      y: sourceY,
      w: lineW,
      h: lineH,
      line: { color, width: Math.max(1, Math.min(link.volume / 1000, 5)) },
    });
  });

  pptx.writeFile({ fileName: `${project.name.replace(/\s+/g, '_')}_range_plan.pptx` });
}
