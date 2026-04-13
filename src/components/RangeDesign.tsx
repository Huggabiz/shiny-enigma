import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Catalogue } from './Catalogue';
import { useProjectStore } from '../store/useProjectStore';
import { CloseIcon } from './Icons';
import { PillToggle } from './PillToggle';
import { PlaceholderDialog } from './PlaceholderDialog';
import { EditableTitle } from './EditableTitle';
import { SlideCanvasControls } from './SlideCanvasControls';
import type { Product, Shelf, MatrixLayout, PlaceholderData, ShelfItem } from '../types';
import { getActivePlan } from '../types';
import './RangeDesign.css';

interface RangeDesignProps {
  shelfId: 'current' | 'future';
  onShelfChange: (shelfId: 'current' | 'future') => void;
  onImport: () => void;
}

const ROW_HEADER_WIDTH = 60;
const ADD_BTN_WIDTH = 28;
// All inter-cell gaps + cell paddings are this many CSS pixels at
// --ui-scale = 1. The CSS multiplies by var(--ui-scale, 1), so the JS
// layout maths must do the same — passing the scaled values through to
// computeLayout / cellGrid keeps the algorithm's "how many cards fit
// per row" decision in lockstep with what flex-wrap actually does.
const BASE_GAP = 3;
const MAX_CARD_WIDTH = 90;
const MIN_CARD_WIDTH = 40;
const CARD_ASPECT = 1.4;
const HEADER_ROW_HEIGHT = 28;
const ADD_ROW_HEIGHT = 28;
const EMPTY_SIZE = 30;
const MIN_ROW_H = 40;

// Sort-by keys for the matrix cell sort dropdown. 'manual' keeps the
// existing matrix order (the order the user dragged items into the cell).
type SortKey = 'manual' | 'name' | 'sku' | 'rrp' | 'usRrp' | 'euRrp' | 'ausRrp' | 'volume' | 'forecastVolume' | 'revenue' | 'forecastRevenue';

function itemSortValue(
  item: ShelfItem,
  catalogue: Product[],
  key: SortKey,
  isFutureShelf: boolean,
): number | string {
  if (key === 'manual') return 0;
  // Real product cards prefer future-pricing overrides on the future shelf
  // so a sort by UK RRP reflects the user's edited price, not the stale one.
  if (!item.isPlaceholder) {
    const p = catalogue.find((pp) => pp.id === item.productId);
    if (!p) return key === 'name' || key === 'sku' ? '' : 0;
    const future = isFutureShelf ? p.futurePricing?.default : undefined;
    switch (key) {
      case 'name': return p.name || '';
      case 'sku': return p.sku || '';
      case 'rrp': return future?.ukRrp ?? p.rrp ?? 0;
      case 'usRrp': return future?.usRrp ?? p.usRrp ?? 0;
      case 'euRrp': return future?.euRrp ?? p.euRrp ?? 0;
      case 'ausRrp': return future?.ausRrp ?? p.ausRrp ?? 0;
      case 'volume': return p.volume ?? 0;
      case 'forecastVolume': return p.forecastVolume ?? 0;
      case 'revenue': return p.revenue ?? 0;
      case 'forecastRevenue': return p.forecastRevenue ?? 0;
    }
  }
  // Placeholder fallback — use placeholderData if populated.
  const d = item.placeholderData;
  if (!d) return key === 'name' || key === 'sku' ? (item.placeholderName || '') : 0;
  switch (key) {
    case 'name': return d.name || item.placeholderName || '';
    case 'sku': return d.sku || '';
    case 'rrp': return d.rrp ?? 0;
    case 'usRrp': return d.usRrp ?? 0;
    case 'euRrp': return d.euRrp ?? 0;
    case 'ausRrp': return d.ausRrp ?? 0;
    case 'volume': return d.volume ?? 0;
    case 'forecastVolume': return d.forecastVolume ?? 0;
    case 'revenue': return d.revenue ?? 0;
    case 'forecastRevenue': return d.forecastRevenue ?? 0;
  }
  return 0;
}

function sortShelfItems<T extends ShelfItem>(
  items: T[],
  catalogue: Product[],
  key: SortKey,
  dir: 'asc' | 'desc',
  isFutureShelf: boolean,
): T[] {
  if (key === 'manual') return items;
  const factor = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = itemSortValue(a, catalogue, key, isFutureShelf);
    const vb = itemSortValue(b, catalogue, key, isFutureShelf);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb)) * factor;
  });
}

// For n products in a cell of given width at given card width,
// how many columns fit horizontally, and how many rows result?
// cellPadding / cardGap are passed in (already scaled by --ui-scale)
// so the maths matches the rendered CSS at any slide resolution tier.
function cellGrid(
  n: number,
  cardW: number,
  cellW: number,
  cellPadding: number,
  cardGap: number,
): { cols: number; rows: number } {
  if (n === 0) return { cols: 0, rows: 0 };
  const maxCols = Math.max(1, Math.floor((cellW - cellPadding * 2 + cardGap) / (cardW + cardGap)));
  const cols = Math.min(n, maxCols);
  return { cols, rows: Math.ceil(n / cols) };
}

// Core layout algorithm: for a given card width, compute column widths and row heights
// Strategy:
//   1. Compute column widths from the max product count per column (assume single-row packing initially)
//   2. Refine: given column widths, compute actual row counts per cell
//   3. Row heights proportional to the max row-count in each row
function computeLayout(
  cardW: number,
  cellCounts: number[][], // [row][col]
  numCols: number,
  numRows: number,
  availW: number,
  availH: number,
  gap: number,
  cardGap: number,
  cellPadding: number,
): { fits: boolean; colWidths: number[]; rowHeights: number[] } {
  const cardH = cardW * CARD_ASPECT;

  // Step 1: For each column, find the max products in any cell
  const maxPerCol = Array.from({ length: numCols }, (_, col) => {
    let max = 0;
    for (let row = 0; row < numRows; row++) {
      if (cellCounts[row][col] > max) max = cellCounts[row][col];
    }
    return max;
  });

  // Step 2: Compute column widths iteratively
  // Start by assuming we can stack as many rows as needed (use sqrt-based cols estimate)
  // Then refine based on available height
  const idealColSlots = maxPerCol.map((n) => {
    if (n === 0) return 0;
    // Ideal: use enough cols so rows are roughly square-ish
    return Math.max(1, Math.ceil(Math.sqrt(n)));
  });

  let colWidths = idealColSlots.map((slots) =>
    slots === 0 ? EMPTY_SIZE : slots * (cardW + cardGap) - cardGap + cellPadding * 2
  );
  let totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * gap;

  // If too wide, increase cols per cell (pack more horizontally, fewer rows)
  if (totalW > availW) {
    // Redistribute: compute how many horizontal slots each column gets
    // proportionally to its max product count
    const totalProducts = maxPerCol.reduce((s, n) => s + n, 0) || 1;
    const usableW = availW - (numCols - 1) * gap - maxPerCol.filter((n) => n === 0).length * EMPTY_SIZE;
    colWidths = maxPerCol.map((n) => {
      if (n === 0) return EMPTY_SIZE;
      const proportionalW = (n / totalProducts) * usableW;
      return Math.max(cardW + cellPadding * 2, proportionalW);
    });
    totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * gap;
    if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };
  }

  // Step 3: Given column widths, compute how many card-rows each cell needs
  const cellRows: number[][] = [];
  for (let row = 0; row < numRows; row++) {
    cellRows.push([]);
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      if (n === 0) { cellRows[row].push(0); continue; }
      const { rows } = cellGrid(n, cardW, colWidths[col], cellPadding, cardGap);
      cellRows[row].push(rows);
    }
  }

  // Step 4: Row heights proportional to max card-rows in each row
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

  // Compute natural row heights (minimum needed)
  const naturalRowH = maxCardRowsPerRow.map((r) =>
    r === 0 ? MIN_ROW_H : r * (cardH + cardGap) - cardGap + cellPadding * 2
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

function MatrixCell({ row, col, itemIds, shelf, catalogue, cardWidth, cellHeight, onAddPlaceholder, onEditPlaceholder, variantIncludedIds, showGhostedProp, discontinuedItems, isFutureShelf, sortBy, sortDir }: {
  row: number; col: number; itemIds: string[];
  shelf: Shelf; catalogue: Product[];
  cardWidth: number;
  /** Hard pixel cap on the cell box. Combined with overflow: hidden
   * and box-sizing: border-box this prevents the cell from auto-sizing
   * past its row height — without this, CSS grid's auto track ignores
   * the row container's explicit style.height and lets cells extend
   * past the row's bottom edge (the v1.9.x discontinued-spillover). */
  cellHeight: number;
  onAddPlaceholder: (row: number, col: number) => void;
  onEditPlaceholder?: (itemId: string) => void;
  variantIncludedIds: Set<string> | null;
  showGhostedProp: boolean;
  /** Current-shelf ShelfItems that aren't in the future shelf. Only
   * rendered when this cell is in the future matrix. */
  discontinuedItems?: ShelfItem[];
  isFutureShelf: boolean;
  sortBy: SortKey;
  sortDir: 'asc' | 'desc';
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  const allItems = itemIds.map((id) => shelf.items.find((i) => i.id === id)).filter(Boolean);
  const { removeItemFromShelf, removeMatrixAssignment, activeVariantId: storeVariantId, toggleVariantItem } = useProjectStore();

  // Filter items by variant
  const filtered = allItems.filter((item): item is ShelfItem => {
    if (!item) return false;
    if (!variantIncludedIds) return true;
    return variantIncludedIds.has(item.id) || showGhostedProp;
  });
  // Sort by the chosen key — 'manual' preserves the original matrix order.
  const items = sortShelfItems(filtered, catalogue, sortBy, sortDir, isFutureShelf);
  const sortedDiscontinued = discontinuedItems
    ? sortShelfItems(discontinuedItems, catalogue, sortBy, sortDir, isFutureShelf)
    : undefined;

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''}`}
      style={{
        '--matrix-card-width': `${Math.floor(cardWidth)}px`,
        height: `${cellHeight}px`,
      } as React.CSSProperties}>
      {items.map((item) => {
        if (!item) return null;
        const product = catalogue.find((p) => p.id === item.productId);
        const isGhosted = variantIncludedIds ? !variantIncludedIds.has(item.id) : false;
        return (
          <MatrixProductCard key={item.id} itemId={item.id} product={product}
            isPlaceholder={item.isPlaceholder} placeholderName={item.placeholderName}
            placeholderData={item.placeholderData}
            isGhosted={isGhosted}
            isFutureShelf={isFutureShelf}
            onEdit={item.isPlaceholder && onEditPlaceholder ? () => onEditPlaceholder(item.id) : undefined}
            onRemove={() => {
              if (storeVariantId) {
                toggleVariantItem(storeVariantId, shelf.id, item.id);
              } else {
                removeItemFromShelf(shelf.id, item.id);
                removeMatrixAssignment(shelf.id, item.id);
              }
            }} />
        );
      })}
      {/* Discontinued ghost cards — rendered at the current-shelf position
          but styled red so the user can see what dropped out of the range. */}
      {sortedDiscontinued?.map((item) => {
        const product = catalogue.find((p) => p.id === item.productId);
        return (
          <MatrixProductCard key={`disc-${item.id}`} itemId={item.id} product={product}
            isPlaceholder={false}
            isDiscontinued={true}
            isFutureShelf={true}
            onRemove={() => { /* discontinued cards are read-only */ }} />
        );
      })}
      <button className="matrix-cell-add-ph" onClick={() => onAddPlaceholder(row, col)} title="Add placeholder SKU">+</button>
    </div>
  );
}

function MatrixProductCard({ itemId, product, isPlaceholder, placeholderName, placeholderData, isGhosted, isDiscontinued, isFutureShelf, onRemove, onEdit }: {
  itemId: string; product?: Product; isPlaceholder: boolean;
  placeholderName?: string; placeholderData?: import('../types').PlaceholderData;
  isGhosted?: boolean;
  isDiscontinued?: boolean;
  isFutureShelf?: boolean;
  onRemove: () => void; onEdit?: () => void;
}) {
  const cardFormat = useProjectStore((s) => s.cardFormat);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `matrix-item-${itemId}`, data: { itemId },
  });
  const displayName = isPlaceholder
    ? (placeholderData?.name || placeholderName || 'New SKU')
    : (product?.name || 'Unknown');
  const displaySku = isPlaceholder ? (placeholderData?.sku || '') : (product?.sku || '');
  const displayImageUrl = isPlaceholder ? placeholderData?.imageUrl : product?.imageUrl;
  const displayVolume = isPlaceholder ? placeholderData?.volume : product?.volume;
  const displayForecast = isPlaceholder ? placeholderData?.forecastVolume : product?.forecastVolume;
  // Future-shelf cards read the future-pricing override when present so
  // edits made in the transform view's future shelf ripple through here.
  const futureOverride = !isPlaceholder && isFutureShelf ? product?.futurePricing?.default : undefined;
  const displayRrp = isPlaceholder
    ? placeholderData?.rrp
    : (futureOverride?.ukRrp ?? product?.rrp);
  const displayUsRrp = isPlaceholder
    ? placeholderData?.usRrp
    : (futureOverride?.usRrp ?? product?.usRrp);
  const displayEuRrp = isPlaceholder
    ? placeholderData?.euRrp
    : (futureOverride?.euRrp ?? product?.euRrp);
  const displayAusRrp = isPlaceholder
    ? placeholderData?.ausRrp
    : (futureOverride?.ausRrp ?? product?.ausRrp);
  const displayRevenue = isPlaceholder ? placeholderData?.revenue : product?.revenue;
  const displayFcstRev = isPlaceholder ? placeholderData?.forecastRevenue : product?.forecastRevenue;
  const displayCategory = isPlaceholder ? placeholderData?.category : product?.category;
  const isDev = !isPlaceholder && product?.source === 'dev';

  // Compute RRP deltas vs the catalogue (live) price when a future
  // override is in play, so the future matrix card highlights price
  // moves the same way the transform view card does.
  const rrpDelta = (current: number | undefined, original: number | undefined): number | null => {
    if (current === undefined || original === undefined) return null;
    if (current === 0 || original === 0) return null;
    if (current === original) return null;
    return current - original;
  };
  const ukDelta = isFutureShelf && !isPlaceholder ? rrpDelta(displayRrp, product?.rrp) : null;
  const usDelta = isFutureShelf && !isPlaceholder ? rrpDelta(displayUsRrp, product?.usRrp) : null;
  const euDelta = isFutureShelf && !isPlaceholder ? rrpDelta(displayEuRrp, product?.euRrp) : null;
  const ausDelta = isFutureShelf && !isPlaceholder ? rrpDelta(displayAusRrp, product?.ausRrp) : null;

  const cardClasses = [
    'matrix-card',
    isDragging ? 'dragging' : '',
    isPlaceholder ? 'placeholder' : '',
    isDev ? 'dev-product' : '',
    isGhosted ? 'ghosted' : '',
    isDiscontinued ? 'ghosted-discontinued' : '',
  ].filter(Boolean).join(' ');

  // Reusable delta chip renderer — matches the transform view's
  // RrpRow styling (small up/down arrow + absolute delta in green/red).
  const renderDelta = (delta: number | null, symbol: string) => {
    if (delta === null) return null;
    const up = delta > 0;
    return (
      <span className={`matrix-card-rrp-delta ${up ? 'up' : 'down'}`}>
        {' '}{up ? '\u2191' : '\u2193'}{symbol}{Math.abs(delta).toFixed(2)}
      </span>
    );
  };

  return (
    <div ref={setNodeRef} className={cardClasses}
      data-item-id={itemId}
      onDoubleClick={(e) => { if (isPlaceholder && onEdit) { e.stopPropagation(); onEdit(); } }}
      {...attributes} {...listeners}>
      <button className="matrix-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><CloseIcon size={8} color="#fff" /></button>
      {isDev && <div className="matrix-card-dev-badge">DEV</div>}
      {cardFormat.showImage && (
        <div className="matrix-card-image">
          {displayImageUrl ? (
            <img src={displayImageUrl} alt={displayName} />
          ) : (
            <div className="matrix-card-image-ph">{isPlaceholder ? '+' : displayName.charAt(0)}</div>
          )}
        </div>
      )}
      {cardFormat.showName && <div className="matrix-card-name" title={displayName}>{displayName}</div>}
      {cardFormat.showSku && <div className="matrix-card-sku">{displaySku || '—'}</div>}
      {cardFormat.showRrp && <div className="matrix-card-rrp">{displayRrp ? `\u00A3${displayRrp}` : '\u2014'}{renderDelta(ukDelta, '\u00A3')}</div>}
      {cardFormat.showUsRrp && displayUsRrp !== undefined && (
        <div className="matrix-card-rrp matrix-card-us">${displayUsRrp}{renderDelta(usDelta, '$')}</div>
      )}
      {cardFormat.showEuRrp && displayEuRrp !== undefined && (
        <div className="matrix-card-rrp matrix-card-eu">{'\u20AC'}{displayEuRrp}{renderDelta(euDelta, '\u20AC')}</div>
      )}
      {cardFormat.showAusRrp && displayAusRrp !== undefined && (
        <div className="matrix-card-rrp matrix-card-aus">A${displayAusRrp}{renderDelta(ausDelta, 'A$')}</div>
      )}
      {cardFormat.showVolume && <div className="matrix-card-vol">Vol: {displayVolume ? displayVolume.toLocaleString() : '—'}</div>}
      {cardFormat.showForecastVolume && displayForecast !== undefined && (
        <div className="matrix-card-forecast">Fcst: {displayForecast.toLocaleString()}</div>
      )}
      {cardFormat.showRevenue && displayRevenue !== undefined && displayRevenue > 0 && (
        <div className="matrix-card-rev">Rev: {displayRevenue.toLocaleString()}</div>
      )}
      {cardFormat.showForecastRevenue && displayFcstRev !== undefined && (
        <div className="matrix-card-forecast">Fcst Rev: {displayFcstRev.toLocaleString()}</div>
      )}
      {cardFormat.showCategory && displayCategory && (
        <div className="matrix-card-category">{displayCategory}</div>
      )}
    </div>
  );
}

function UnassignedDraggable({ itemId, name }: { itemId: string; name: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `matrix-item-${itemId}`, data: { itemId },
  });
  return (
    <span ref={setNodeRef} className={`unassigned-item draggable ${isDragging ? 'dragging' : ''}`}
      {...attributes} {...listeners}>
      {name}
    </span>
  );
}

export function RangeDesign({ shelfId, onShelfChange, onImport }: RangeDesignProps) {
  const {
    project, addItemToShelf, updateShelfItem,
    updateMatrixLayout, setMatrixAssignment,
    activeVariantId, showGhosted, setShowGhosted,
    showDiscontinued, setShowDiscontinued,
    slideBaseScale,
  } = useProjectStore();

  // Scale the chrome dimensions (row/column headers, gaps) with the
  // slide resolution tier so the labels keep their visual proportions
  // when the canvas grows.
  const uiScale = slideBaseScale;
  const scaledRowHeaderW = Math.round(ROW_HEADER_WIDTH * uiScale);
  const scaledAddBtnW = Math.round(ADD_BTN_WIDTH * uiScale);
  const scaledHeaderRowH = Math.round(HEADER_ROW_HEIGHT * uiScale);
  const scaledAddRowH = Math.round(ADD_ROW_HEIGHT * uiScale);

  const [sortBy, setSortBy] = useState<SortKey>('manual');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [placeholderDialog, setPlaceholderDialog] = useState<
    | { mode: 'create'; row: number; col: number }
    | { mode: 'edit'; itemId: string; data: PlaceholderData }
    | null
  >(null);
  const [editingAxis, setEditingAxis] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });

  const activePlan = project ? getActivePlan(project) : undefined;
  const shelf = activePlan?.[shelfId === 'current' ? 'currentShelf' : 'futureShelf'];
  const catalogue = project?.catalogue || [];
  const layout: MatrixLayout = useMemo(() =>
    shelf?.matrixLayout || { title: shelf?.name || '', xLabels: [], yLabels: [], assignments: [] },
    [shelf?.matrixLayout, shelf?.name]
  );

  const { currentProductIds, futureProductIds, otherCurrentIds, otherFutureIds } = useMemo(() => {
    if (!project || !activePlan) return {
      currentProductIds: new Set<string>(), futureProductIds: new Set<string>(),
      otherCurrentIds: new Set<string>(), otherFutureIds: new Set<string>(),
    };
    const cur = new Set<string>(activePlan.currentShelf.items.map((i) => i.productId).filter(Boolean));
    const fut = new Set<string>(activePlan.futureShelf.items.map((i) => i.productId).filter(Boolean));
    const oCur = new Set<string>();
    const oFut = new Set<string>();
    for (const plan of project.plans) {
      if (plan.id === activePlan.id) continue;
      for (const item of plan.currentShelf.items) if (item.productId) oCur.add(item.productId);
      for (const item of plan.futureShelf.items) if (item.productId) oFut.add(item.productId);
    }
    return { currentProductIds: cur, futureProductIds: fut, otherCurrentIds: oCur, otherFutureIds: oFut };
  }, [project, activePlan]);

  // Variant filter for the current shelf view
  const activeVariant = useMemo(() => {
    if (!activeVariantId || !activePlan) return null;
    return activePlan.variants.find((v) => v.id === activeVariantId) || null;
  }, [activeVariantId, activePlan]);

  const variantIncludedIds = useMemo(() => {
    if (!activeVariant) return null;
    const key = shelfId === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
    return new Set(activeVariant[key]);
  }, [activeVariant, shelfId]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWrapperSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build cell counts and compute layout
  const { columnWidths, rowHeights, cardWidth } = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0 || wrapperSize.w === 0 || wrapperSize.h === 0) {
      return { columnWidths: [], rowHeights: [], cardWidth: MAX_CARD_WIDTH };
    }

    // Scaled gap / padding values that match what the CSS actually
    // renders at the current --ui-scale. JS used to use literal 3/4
    // constants which drifted from the stylesheet at scale > 1, causing
    // cellGrid to think more cards fit per row than reality and
    // under-allocating row height (cells then spilled vertically).
    const scaledGap = BASE_GAP * uiScale;
    const scaledCardGap = BASE_GAP * uiScale;
    const scaledCellPadding = BASE_GAP * uiScale;

    const wPad = 24;
    const availW = wrapperSize.w - wPad - scaledRowHeaderW - scaledAddBtnW - (numCols + 1) * scaledGap;
    const availH = wrapperSize.h - wPad - scaledHeaderRowH - scaledAddRowH - (numRows + 1) * scaledGap;

    const cellCounts: number[][] = [];
    for (let row = 0; row < numRows; row++) {
      cellCounts.push([]);
      for (let col = 0; col < numCols; col++) {
        cellCounts[row].push(layout.assignments.filter((a) => {
          if (a.row !== row || a.col !== col) return false;
          // If variant active without ghost, only count included items
          if (variantIncludedIds && !showGhosted) return variantIncludedIds.has(a.itemId);
          return true;
        }).length);
      }
    }

    // When the user is designing the future shelf and Show discontinued
    // is on, the view ALSO renders current-shelf products that dropped
    // out of the future range as ghost cards at their original cell
    // position. Add them to the cell counts so the layout algorithm
    // reserves the right amount of space per cell instead of shrinking
    // them on top of the existing future items.
    if (shelfId === 'future' && showDiscontinued && activePlan) {
      const futureProductIds = new Set(activePlan.futureShelf.items.map((i) => i.productId));
      const currentLayout = activePlan.currentShelf.matrixLayout;
      if (currentLayout) {
        const discIds = new Set(
          activePlan.currentShelf.items
            .filter((i) => !i.isPlaceholder && i.productId && !futureProductIds.has(i.productId))
            .map((i) => i.id),
        );
        for (const a of currentLayout.assignments) {
          if (!discIds.has(a.itemId)) continue;
          if (a.row >= 0 && a.row < numRows && a.col >= 0 && a.col < numCols) {
            cellCounts[a.row][a.col] += 1;
          }
        }
      }
    }

    const totalProducts = cellCounts.flat().reduce((s, n) => s + n, 0);
    if (totalProducts === 0) {
      return {
        columnWidths: Array(numCols).fill((availW - (numCols - 1) * scaledGap) / numCols),
        rowHeights: Array(numRows).fill((availH - (numRows - 1) * scaledGap) / numRows),
        cardWidth: MAX_CARD_WIDTH,
      };
    }

    // Binary search for largest uniform card width that fits everything.
    // When the user has Show discontinued on, cells can be carrying a lot
    // of extra ghost cards, so the regular floor (MIN_CARD_WIDTH = 40) is
    // sometimes too large to fit. Fall back to an absolute floor of 22px
    // for the dense case so the sizer always has room to find a fit
    // before spilling over the canvas.
    const absoluteFloor = shelfId === 'future' && showDiscontinued ? 22 : MIN_CARD_WIDTH;
    let lo = absoluteFloor;
    let hi = MAX_CARD_WIDTH;
    let bestCW = absoluteFloor;
    let bestColW: number[] = [];
    let bestRowH: number[] = [];
    let foundFit = false;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const result = computeLayout(mid, cellCounts, numCols, numRows, availW, availH, scaledGap, scaledCardGap, scaledCellPadding);
      if (result.fits) {
        bestCW = mid;
        bestColW = result.colWidths;
        bestRowH = result.rowHeights;
        foundFit = true;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Absolute fallback: if even the floor didn't fit (dense plan with
    // lots of discontinued overlays) accept the layout at the floor so
    // the render stays inside the canvas bounds instead of spilling.
    if (!foundFit) {
      const fallback = computeLayout(absoluteFloor, cellCounts, numCols, numRows, availW, availH, scaledGap, scaledCardGap, scaledCellPadding);
      bestCW = absoluteFloor;
      bestColW = fallback.colWidths.length ? fallback.colWidths : Array(numCols).fill((availW - (numCols - 1) * scaledGap) / numCols);
      bestRowH = fallback.rowHeights.length ? fallback.rowHeights : Array(numRows).fill((availH - (numRows - 1) * scaledGap) / numRows);
      // Clamp row heights so their total doesn't exceed available space
      // — combined with the explicit cell-height fix below, individual
      // cells get hard-clipped via overflow: hidden so the matrix stays
      // inside the canvas even in dense-overflow scenarios.
      const rowSum = bestRowH.reduce((s, h) => s + h, 0) + (numRows - 1) * scaledGap;
      if (rowSum > availH) {
        const scale = (availH - (numRows - 1) * scaledGap) / bestRowH.reduce((s, h) => s + h, 0);
        bestRowH = bestRowH.map((h) => Math.max(MIN_ROW_H, h * scale));
      }
    }

    // Distribute remaining width evenly
    const totalColW = bestColW.reduce((s, w) => s + w, 0) + (numCols - 1) * scaledGap;
    if (totalColW < availW) {
      const extra = availW - totalColW;
      bestColW = bestColW.map((w) => w + extra / numCols);
    }

    return { columnWidths: bestColW, rowHeights: bestRowH, cardWidth: bestCW };
  }, [layout.xLabels, layout.yLabels, layout.assignments, wrapperSize, variantIncludedIds, showGhosted,
      scaledRowHeaderW, scaledAddBtnW, scaledHeaderRowH, scaledAddRowH, uiScale,
      shelfId, showDiscontinued, activePlan]);

  const gridCols = `${scaledRowHeaderW}px ${columnWidths.map((w) => `${w}px`).join(' ')} ${scaledAddBtnW}px`;

  const cellMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of layout.assignments) {
      const key = `${a.row}-${a.col}`;
      const arr = map.get(key) || [];
      arr.push(a.itemId);
      map.set(key, arr);
    }
    return map;
  }, [layout.assignments]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (activeId.startsWith('catalogue-')) {
      const data = event.active.data.current as { product: Product };
      if (data?.product) setActiveProduct(data.product);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProduct(null);
    const { active, over } = event;
    if (!over || !shelf) return;
    const overId = String(over.id);
    const activeId = String(active.id);
    const cellMatch = overId.match(/^matrix-cell-(\d+)-(\d+)$/);
    if (!cellMatch) return;
    const row = parseInt(cellMatch[1]);
    const col = parseInt(cellMatch[2]);

    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;
      if (shelf.items.some((i) => i.productId === data.product.id)) return;
      const newItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      addItemToShelf(shelfId, {
        id: newItemId, productId: data.product.id,
        position: shelf.items.length, isPlaceholder: false,
      });
      setTimeout(() => setMatrixAssignment(shelfId, newItemId, row, col), 0);
      return;
    }

    if (activeId.startsWith('matrix-item-')) {
      const data = active.data.current as { itemId: string };
      if (data?.itemId) setMatrixAssignment(shelfId, data.itemId, row, col);
    }
  };

  const handleAddPlaceholder = useCallback((row: number, col: number) => {
    if (!shelf) return;
    setPlaceholderDialog({ mode: 'create', row, col });
  }, [shelf]);

  const handleEditPlaceholder = useCallback((itemId: string) => {
    if (!shelf) return;
    const item = shelf.items.find((i) => i.id === itemId);
    if (!item || !item.isPlaceholder) return;
    const data: PlaceholderData = item.placeholderData || {
      sku: '', name: item.placeholderName || '', category: '', subCategory: '',
      productFamily: '', volume: 0, forecastVolume: 0, rrp: 0, revenue: 0, source: 'live',
    };
    setPlaceholderDialog({ mode: 'edit', itemId, data });
  }, [shelf]);

  const handlePlaceholderSave = useCallback((data: PlaceholderData) => {
    if (!placeholderDialog || !shelf) return;
    if (placeholderDialog.mode === 'create') {
      const newItemId = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      addItemToShelf(shelfId, {
        id: newItemId, productId: '', position: shelf.items.length,
        isPlaceholder: true, placeholderName: data.name, placeholderData: data,
      });
      setTimeout(() => setMatrixAssignment(shelfId, newItemId, placeholderDialog.row, placeholderDialog.col), 0);
    } else {
      updateShelfItem(shelfId, placeholderDialog.itemId, {
        placeholderName: data.name,
        placeholderData: data,
      });
    }
    setPlaceholderDialog(null);
  }, [placeholderDialog, shelf, shelfId, addItemToShelf, setMatrixAssignment, updateShelfItem]);

  const addLabel = useCallback((axis: 'x' | 'y') => {
    const text = prompt(`New ${axis === 'x' ? 'column' : 'row'} label:`);
    if (!text) return;
    if (axis === 'x') updateMatrixLayout(shelfId, { xLabels: [...layout.xLabels, text] });
    else updateMatrixLayout(shelfId, { yLabels: [...layout.yLabels, text] });
  }, [shelfId, layout, updateMatrixLayout]);

  const removeLabel = useCallback((axis: 'x' | 'y', index: number) => {
    if (axis === 'x') {
      updateMatrixLayout(shelfId, {
        xLabels: layout.xLabels.filter((_, i) => i !== index),
        assignments: layout.assignments.filter((a) => a.col !== index).map((a) => a.col > index ? { ...a, col: a.col - 1 } : a),
      });
    } else {
      updateMatrixLayout(shelfId, {
        yLabels: layout.yLabels.filter((_, i) => i !== index),
        assignments: layout.assignments.filter((a) => a.row !== index).map((a) => a.row > index ? { ...a, row: a.row - 1 } : a),
      });
    }
  }, [shelfId, layout, updateMatrixLayout]);

  const updateLabel = useCallback((axis: 'x' | 'y', index: number, text: string) => {
    if (axis === 'x') updateMatrixLayout(shelfId, { xLabels: layout.xLabels.map((l, i) => i === index ? text : l) });
    else updateMatrixLayout(shelfId, { yLabels: layout.yLabels.map((l, i) => i === index ? text : l) });
    setEditingAxis(null);
  }, [shelfId, layout, updateMatrixLayout]);

  const updateTitle = useCallback((text: string) => {
    const newTitle = text || activePlan?.name || '';
    // Sync title to both shelves and plan name
    updateMatrixLayout('current', { title: newTitle });
    updateMatrixLayout('future', { title: newTitle });
  }, [activePlan, updateMatrixLayout]);

  // Build set of existing SKUs for placeholder validation
  const existingSkusForDialog = useMemo(() => {
    if (!project) return new Set<string>();
    const skus = new Set<string>();
    project.catalogue.forEach((p) => p.sku && skus.add(p.sku));
    project.plans.forEach((plan) => {
      [...plan.currentShelf.items, ...plan.futureShelf.items].forEach((item) => {
        if (!item.isPlaceholder || !item.placeholderData) return;
        if (placeholderDialog?.mode === 'edit' && placeholderDialog.itemId === item.id) return;
        if (item.placeholderData.sku) skus.add(item.placeholderData.sku);
      });
    });
    return skus;
  }, [project, placeholderDialog]);

  if (!shelf || !project) return null;

  const assignedItemIds = new Set(layout.assignments.map((a) => a.itemId));
  const unassigned = shelf.items.filter((i) => !assignedItemIds.has(i.id));

  // Discontinued: products in the current shelf whose productId is absent
  // from the future shelf. Only surfaced when the user is looking at the
  // future matrix AND the Show discontinued toggle is on.
  const discontinuedItems = useMemo(() => {
    if (!activePlan || shelfId !== 'future' || !showDiscontinued) return [];
    const futureProductIds = new Set(activePlan.futureShelf.items.map((i) => i.productId));
    return activePlan.currentShelf.items.filter((item) => {
      if (item.isPlaceholder || !item.productId) return false;
      return !futureProductIds.has(item.productId);
    });
  }, [activePlan, shelfId, showDiscontinued]);

  // Group discontinued items by the cell they occupied in the CURRENT
  // shelf's matrix so we can render them as ghost cards in the future
  // matrix at their original (row, col) positions.
  const discontinuedByCell = useMemo(() => {
    const map = new Map<string, ShelfItem[]>();
    if (discontinuedItems.length === 0 || !activePlan) return map;
    const currentLayout = activePlan.currentShelf.matrixLayout;
    if (!currentLayout) return map;
    const byId = new Map<string, ShelfItem>(discontinuedItems.map((i) => [i.id, i]));
    for (const a of currentLayout.assignments) {
      const item = byId.get(a.itemId);
      if (!item) continue;
      const key = `${a.row}-${a.col}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    }
    return map;
  }, [discontinuedItems, activePlan]);

  return (
    <div className="range-design">
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="range-design-canvas">
          <div className="range-design-title-bar">
            <PillToggle value={shelfId} onChange={onShelfChange} />
            <div className="range-design-canvas-controls">
              {activeVariant && (
                <label className="ghost-toggle" title="Show products excluded from this variant as ghost cards">
                  <input type="checkbox" checked={showGhosted} onChange={(e) => setShowGhosted(e.target.checked)} />
                  <span>Show excluded</span>
                </label>
              )}
              <label className="ghost-toggle" title="Show discontinued products (in current range but not future)">
                <input type="checkbox" checked={showDiscontinued} onChange={(e) => setShowDiscontinued(e.target.checked)} />
                <span>Show discontinued</span>
              </label>
              <div className="slide-size-control" title="Sort cards within each matrix cell">
                <span>Sort</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                  <option value="manual">Manual</option>
                  <option value="name">Name</option>
                  <option value="sku">SKU</option>
                  <option value="rrp">UK RRP</option>
                  <option value="usRrp">US RRP</option>
                  <option value="euRrp">EU RRP</option>
                  <option value="ausRrp">AUS RRP</option>
                  <option value="volume">Volume</option>
                  <option value="forecastVolume">Forecast Volume</option>
                  <option value="revenue">Revenue</option>
                  <option value="forecastRevenue">Forecast Revenue</option>
                </select>
                {sortBy !== 'manual' && (
                  <button
                    type="button"
                    className="sort-dir-btn"
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    title={sortDir === 'asc' ? 'Ascending — click to flip' : 'Descending — click to flip'}
                    aria-label="Toggle sort direction"
                  >
                    {sortDir === 'asc' ? '\u2191' : '\u2193'}
                  </button>
                )}
              </div>
              <SlideCanvasControls scrollAreaSelector=".range-view-scroll" />
            </div>
          </div>

          <div className="slide-scroll-area range-view-scroll">
            <div className="slide-scroll-spacer">
              <div className="slide-canvas-wrapper">
              <div className="matrix-16-9">
            <div className="slide-title">
              <EditableTitle
                className="range-design-title"
                value={activePlan?.name || layout.title}
                onSave={(next) => updateTitle(next)}
                trailing={activeVariant ? <span className="variant-badge">{activeVariant.name}</span> : null}
              />
            </div>
            <div className="matrix-wrapper" ref={wrapperRef}>
              <div className="matrix-header-row" style={{ gridTemplateColumns: gridCols }}>
                <div />
                {layout.xLabels.map((label, i) => (
                  <div key={i} className="matrix-col-header" onDoubleClick={() => setEditingAxis({ axis: 'x', index: i })}>
                    {editingAxis?.axis === 'x' && editingAxis.index === i ? (
                      <input className="matrix-label-input" defaultValue={label} autoFocus
                        onBlur={(e) => updateLabel('x', i, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && updateLabel('x', i, (e.target as HTMLInputElement).value)} />
                    ) : <span>{label}</span>}
                    <button className="matrix-label-remove" onClick={() => removeLabel('x', i)}><CloseIcon size={7} color="#fff" /></button>
                  </div>
                ))}
                <button className="matrix-add-btn" onClick={() => addLabel('x')}>+</button>
              </div>

              {layout.yLabels.map((yLabel, row) => (
                <div key={row} className="matrix-row"
                  style={{ gridTemplateColumns: gridCols, height: `${rowHeights[row] || 80}px` }}>
                  <div className="matrix-row-header" onDoubleClick={() => setEditingAxis({ axis: 'y', index: row })}>
                    {editingAxis?.axis === 'y' && editingAxis.index === row ? (
                      <input className="matrix-label-input" defaultValue={yLabel} autoFocus
                        onBlur={(e) => updateLabel('y', row, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && updateLabel('y', row, (e.target as HTMLInputElement).value)} />
                    ) : <span>{yLabel}</span>}
                    <button className="matrix-label-remove" onClick={() => removeLabel('y', row)}><CloseIcon size={7} color="#fff" /></button>
                  </div>
                  {layout.xLabels.map((_, col) => (
                    <MatrixCell key={`${row}-${col}`} row={row} col={col}
                      itemIds={cellMap.get(`${row}-${col}`) || []}
                      shelf={shelf} catalogue={catalogue}
                      cardWidth={cardWidth}
                      cellHeight={rowHeights[row] || 80}
                      onAddPlaceholder={handleAddPlaceholder}
                      onEditPlaceholder={handleEditPlaceholder}
                      variantIncludedIds={variantIncludedIds}
                      showGhostedProp={showGhosted}
                      discontinuedItems={discontinuedByCell.get(`${row}-${col}`)}
                      isFutureShelf={shelfId === 'future'}
                      sortBy={sortBy}
                      sortDir={sortDir} />
                  ))}
                  <div />
                </div>
              ))}

              <div className="matrix-add-row">
                <button className="matrix-add-btn wide" onClick={() => addLabel('y')}>+ Row</button>
              </div>
            </div>
              </div>
              </div>
            </div>
          </div>

          {unassigned.length > 0 && (
            <div className="unassigned-tray">
              <span className="unassigned-label">On shelf but not placed in matrix ({unassigned.length}):</span>
              <div className="unassigned-items">
                {unassigned.map((item) => {
                  const product = catalogue.find((p) => p.id === item.productId);
                  return (
                    <UnassignedDraggable key={item.id} itemId={item.id}
                      name={item.isPlaceholder ? (item.placeholderName || 'New SKU') : (product?.name || item.productId)} />
                  );
                })}
              </div>
            </div>
          )}



        </div>

        <Catalogue products={catalogue} onImport={onImport}
          currentProductIds={currentProductIds} futureProductIds={futureProductIds}
          otherCurrentIds={otherCurrentIds} otherFutureIds={otherFutureIds}
          designShelfId={shelfId}
          dropZoneId="catalogue-drop-zone-design" />

        <DragOverlay>
          {activeProduct && (
            <div className="matrix-drag-preview">{activeProduct.name}</div>
          )}
        </DragOverlay>
      </DndContext>
      {placeholderDialog && (
        <PlaceholderDialog
          mode={placeholderDialog.mode}
          initialData={placeholderDialog.mode === 'edit' ? placeholderDialog.data : undefined}
          existingSkus={existingSkusForDialog}
          onSave={handlePlaceholderSave}
          onClose={() => setPlaceholderDialog(null)}
        />
      )}
    </div>
  );
}
