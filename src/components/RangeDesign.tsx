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
import { BASE_GAP, computeMatrixLayout, computeMatrixAutoTier, MAX_CARD_WIDTH } from '../utils/matrixLayout';
import './RangeDesign.css';

interface RangeDesignProps {
  shelfId: 'current' | 'future';
  onShelfChange: (shelfId: 'current' | 'future') => void;
  onImport: () => void;
}

const ROW_HEADER_WIDTH = 60;
const ADD_BTN_WIDTH = 28;
const HEADER_ROW_HEIGHT = 28;
const ADD_ROW_HEIGHT = 28;

// Convert a #rrggbb hex colour to an `rgba(r, g, b, a)` string. Used
// by MatrixProductCard to derive a translucent lens tint from the
// lens's solid colour without needing a separate "tintColor" field.
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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

function MatrixCell({ row, col, itemIds, shelf, catalogue, cardWidth, cardHeight, cellHeight, onAddPlaceholder, onEditPlaceholder, variantIncludedIds, showGhostedProp, discontinuedItems, isFutureShelf, sortBy, sortDir }: {
  row: number; col: number; itemIds: string[];
  shelf: Shelf; catalogue: Product[];
  cardWidth: number;
  /** Hard pixel cap on each card box. Applied as an inline CSS
   * variable that the .matrix-card rule reads for its `height`. This
   * makes the JS layout estimate authoritative rather than a guess:
   * the card is exactly what the algorithm reserved space for, and
   * overflow: hidden on .matrix-card clips any excess content inside
   * the card instead of letting it leak past the cell border. */
  cardHeight: number;
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
        '--matrix-card-height': `${Math.floor(cardHeight)}px`,
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
  // Lens state — used to apply the active lens's tint and to handle
  // edit-mode click-to-toggle membership.
  const project = useProjectStore((s) => s.project);
  const toggleLensProduct = useProjectStore((s) => s.toggleLensProduct);
  const activeLens = useMemo(() => {
    if (!project?.activeLensId) return null;
    return project.lenses?.find((l) => l.id === project.activeLensId) ?? null;
  }, [project?.activeLensId, project?.lenses]);
  const editingLens = useMemo(() => {
    if (!project?.editingLensId) return null;
    return project.lenses?.find((l) => l.id === project.editingLensId) ?? null;
  }, [project?.editingLensId, project?.lenses]);
  const productInActiveLens = useMemo(() => {
    if (!activeLens || !product) return false;
    if (activeLens.builtInKind === 'dev') return product.source === 'dev';
    return activeLens.productIds.includes(product.id);
  }, [activeLens, product]);
  const productInEditingLens = useMemo(() => {
    if (!editingLens || !product) return false;
    return editingLens.productIds.includes(product.id);
  }, [editingLens, product]);

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
    productInActiveLens ? 'lens-tinted' : '',
    editingLens ? 'lens-edit-mode' : '',
    editingLens && productInEditingLens ? 'lens-edit-member' : '',
  ].filter(Boolean).join(' ');

  // When the active lens has the product, paint the card background
  // with a translucent version of the lens colour (alpha ~22%) so the
  // tint reads clearly without obscuring the card content.
  const lensTintStyle = productInActiveLens && activeLens
    ? { backgroundColor: hexToRgba(activeLens.color, 0.22), borderColor: activeLens.color }
    : undefined;

  // Click handler used when a custom lens is in edit mode — clicking
  // the card toggles the product's membership in that lens.
  const handleLensEditClick = (e: React.MouseEvent) => {
    if (!editingLens || !product || isPlaceholder) return;
    e.stopPropagation();
    e.preventDefault();
    toggleLensProduct(editingLens.id, product.id);
  };

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
      style={lensTintStyle}
      data-item-id={itemId}
      // In lens edit mode a click toggles membership instead of doing
      // any normal interaction; outside edit mode the double-click
      // still opens the placeholder editor.
      onClick={editingLens ? handleLensEditClick : undefined}
      onDoubleClick={(e) => { if (isPlaceholder && onEdit) { e.stopPropagation(); onEdit(); } }}
      {...(editingLens ? {} : attributes)}
      {...(editingLens ? {} : listeners)}>
      {/* Badges sit OUTSIDE the .matrix-card-content overflow clip so
          their negative top/left/right offsets stick out past the card
          border instead of being masked. They're absolutely positioned
          and don't affect the content layout. */}
      <button className="matrix-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><CloseIcon size={8} color="#fff" /></button>
      {isDev && <div className="matrix-card-dev-badge">DEV</div>}
      <div className="matrix-card-content">
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
    slideBaseScaleMode,
    setSlideBaseScale,
    cardFormat,
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

  // Build the per-cell product counts that drive the layout solver.
  // Includes future-shelf discontinued ghost cards when Show discontinued
  // is on, so the algorithm reserves space for them at their original cell.
  const cellCounts = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0) return [] as number[][];

    const counts: number[][] = [];
    for (let row = 0; row < numRows; row++) {
      counts.push([]);
      for (let col = 0; col < numCols; col++) {
        counts[row].push(layout.assignments.filter((a) => {
          if (a.row !== row || a.col !== col) return false;
          if (variantIncludedIds && !showGhosted) return variantIncludedIds.has(a.itemId);
          return true;
        }).length);
      }
    }

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
            counts[a.row][a.col] += 1;
          }
        }
      }
    }
    return counts;
  }, [layout.xLabels, layout.yLabels, layout.assignments, variantIncludedIds, showGhosted,
      shelfId, showDiscontinued, activePlan]);

  // Available area inside the matrix wrapper at the current uiScale.
  // Memoised separately so the auto-tier useEffect can reuse it without
  // re-deriving the chrome subtraction.
  const availArea = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0 || wrapperSize.w === 0 || wrapperSize.h === 0) {
      return { availW: 0, availH: 0, numCols, numRows };
    }
    // Ceil the scaled gap so JS over-counts chrome when CSS subpixels
    // round up at non-integer scales (1.25 / 1.5 / 1.75). Under-counting
    // chrome here leaves the layout solver with more "available" space
    // than the browser actually has, and cards wrap.
    const scaledGap = Math.ceil(BASE_GAP * uiScale);
    // NOTE: do NOT subtract a wPad constant here. ResizeObserver's
    // contentRect already excludes the .matrix-wrapper padding, so any
    // unscaled fudge subtraction makes the chrome non-linear in
    // uiScale — which made baseAvailW (currentAvailW / currentScale)
    // give different values when measured at different scales, causing
    // the v1.9.20 1↔2 auto-tier ping-pong oscillation. Linear chrome
    // means baseAvailW is stable across re-measures.
    const availW = wrapperSize.w - scaledRowHeaderW - scaledAddBtnW - (numCols + 1) * scaledGap;
    const availH = wrapperSize.h - scaledHeaderRowH - scaledAddRowH - (numRows + 1) * scaledGap;
    return { availW, availH, numCols, numRows };
  }, [layout.xLabels, layout.yLabels, wrapperSize, uiScale,
      scaledRowHeaderW, scaledAddBtnW, scaledHeaderRowH, scaledAddRowH]);

  // Run the matrix layout solver. Slot-growth slack absorption (inside
  // computeMatrixLayout) replaces the old proportional column-padding
  // distribution that produced "small cards in big cells".
  const { columnWidths, rowHeights, cardWidth, cardHeight } = useMemo(() => {
    const { availW, availH, numCols, numRows } = availArea;
    if (numCols === 0 || numRows === 0 || availW <= 0 || availH <= 0) {
      return { columnWidths: [], rowHeights: [], cardWidth: MAX_CARD_WIDTH, cardHeight: MAX_CARD_WIDTH * 1.4 };
    }
    const result = computeMatrixLayout(cellCounts, cardFormat, availW, availH, uiScale);
    return {
      columnWidths: result.colWidths,
      rowHeights: result.rowHeights,
      cardWidth: result.cardW,
      cardHeight: result.cardH,
    };
  }, [cellCounts, availArea, cardFormat, uiScale]);

  // Canonical baseAvail cache for the auto-tier projection. See the
  // comment on computeMatrixAutoTier for why this MUST be cached and
  // not derived from the live measurement: the React-effect ↔
  // ResizeObserver race feeds two slightly different baselines into
  // the auto-tier on every scale change, and on borderline layouts
  // the two flip the fit/no-fit decision and the recommended scale
  // ping-pongs. Caching once kills the feedback loop. Invalidate
  // only when the matrix dimensions actually change (axis labels
  // added/removed) — viewport resizes don't change wrapperSize because
  // .matrix-16-9 is a fixed `1100*scale × 619*scale` canvas.
  const baseAvailRef = useRef<{ baseW: number; baseH: number; numCols: number; numRows: number } | null>(null);

  // Auto-tier: when in auto mode, pick the smallest slide base scale at
  // which the layout fits with cardW >= MIN_CARD_WIDTH. Bumps the store
  // mirror via setSlideBaseScale; App.tsx steps aside for the design view
  // in auto mode (see App.tsx effective-slide-size mirror) so the two
  // resolvers don't fight.
  useEffect(() => {
    if (slideBaseScaleMode !== 'auto') return;
    const { availW, availH, numCols, numRows } = availArea;
    if (numCols === 0 || numRows === 0 || availW <= 0 || availH <= 0) return;
    const totalProducts = cellCounts.flat().reduce((s, n) => s + n, 0);
    if (totalProducts === 0) return;

    // Invalidate the cache if the matrix dimensions changed (the user
    // added/removed an axis label).
    if (baseAvailRef.current &&
        (baseAvailRef.current.numCols !== numCols ||
         baseAvailRef.current.numRows !== numRows)) {
      baseAvailRef.current = null;
    }
    // Initialize the cache from the first valid measurement at any
    // scale. Once set it stays put — every subsequent auto-tier call
    // projects from the SAME baseline so the recommendation is stable.
    if (!baseAvailRef.current) {
      baseAvailRef.current = {
        baseW: availW / uiScale,
        baseH: availH / uiScale,
        numCols,
        numRows,
      };
    }

    const { baseW, baseH } = baseAvailRef.current;
    const recommended = computeMatrixAutoTier(cellCounts, cardFormat, baseW, baseH, uiScale);
    if (recommended !== uiScale) {
      setSlideBaseScale(recommended);
    }
  }, [cellCounts, availArea, cardFormat, uiScale, slideBaseScaleMode, setSlideBaseScale]);

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
                      cardHeight={cardHeight}
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
