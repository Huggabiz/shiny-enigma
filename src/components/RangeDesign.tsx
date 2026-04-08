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
import type { Product, Shelf, MatrixLayout } from '../types';
import { getActivePlan } from '../types';
import './RangeDesign.css';

interface RangeDesignProps {
  shelfId: 'current' | 'future';
  onShelfChange: (shelfId: 'current' | 'future') => void;
  onImport: () => void;
}

const ROW_HEADER_WIDTH = 60;
const ADD_BTN_WIDTH = 28;
const GAP = 3;
const CARD_GAP = 4;
const CELL_PADDING = 4;
const MAX_CARD_WIDTH = 90;
const MIN_CARD_WIDTH = 40;
const CARD_ASPECT = 1.4;
const HEADER_ROW_HEIGHT = 28;
const ADD_ROW_HEIGHT = 28;
const EMPTY_SIZE = 30;
const MIN_ROW_H = 40;

// For n products in a cell of given width at given card width,
// how many columns fit horizontally, and how many rows result?
function cellGrid(n: number, cardW: number, cellW: number): { cols: number; rows: number } {
  if (n === 0) return { cols: 0, rows: 0 };
  const maxCols = Math.max(1, Math.floor((cellW - CELL_PADDING * 2 + CARD_GAP) / (cardW + CARD_GAP)));
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
    slots === 0 ? EMPTY_SIZE : slots * (cardW + CARD_GAP) - CARD_GAP + CELL_PADDING * 2
  );
  let totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * GAP;

  // If too wide, increase cols per cell (pack more horizontally, fewer rows)
  if (totalW > availW) {
    // Redistribute: compute how many horizontal slots each column gets
    // proportionally to its max product count
    const totalProducts = maxPerCol.reduce((s, n) => s + n, 0) || 1;
    const usableW = availW - (numCols - 1) * GAP - maxPerCol.filter((n) => n === 0).length * EMPTY_SIZE;
    colWidths = maxPerCol.map((n) => {
      if (n === 0) return EMPTY_SIZE;
      const proportionalW = (n / totalProducts) * usableW;
      return Math.max(cardW + CELL_PADDING * 2, proportionalW);
    });
    totalW = colWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * GAP;
    if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };
  }

  // Step 3: Given column widths, compute how many card-rows each cell needs
  const cellRows: number[][] = [];
  for (let row = 0; row < numRows; row++) {
    cellRows.push([]);
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      if (n === 0) { cellRows[row].push(0); continue; }
      const { rows } = cellGrid(n, cardW, colWidths[col]);
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
    const rowH = (availH - (numRows - 1) * GAP) / numRows;
    return { fits: true, colWidths, rowHeights: Array(numRows).fill(rowH) };
  }

  // Compute natural row heights (minimum needed)
  const naturalRowH = maxCardRowsPerRow.map((r) =>
    r === 0 ? MIN_ROW_H : r * (cardH + CARD_GAP) - CARD_GAP + CELL_PADDING * 2
  );
  const totalNaturalH = naturalRowH.reduce((s, h) => s + h, 0) + (numRows - 1) * GAP;

  if (totalNaturalH > availH) return { fits: false, colWidths, rowHeights: naturalRowH };

  // Distribute extra height proportionally to rows with content
  const extraH = availH - totalNaturalH;
  const contentRows = maxCardRowsPerRow.filter((r) => r > 0).length || 1;
  const rowHeights = naturalRowH.map((h, i) =>
    maxCardRowsPerRow[i] > 0 ? h + extraH / contentRows : h
  );

  return { fits: true, colWidths, rowHeights };
}

function MatrixCell({ row, col, itemIds, shelf, catalogue, cardWidth, onAddPlaceholder, variantIncludedIds, showGhostedProp }: {
  row: number; col: number; itemIds: string[];
  shelf: Shelf; catalogue: Product[];
  cardWidth: number;
  onAddPlaceholder: (row: number, col: number) => void;
  variantIncludedIds: Set<string> | null;
  showGhostedProp: boolean;
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  const allItems = itemIds.map((id) => shelf.items.find((i) => i.id === id)).filter(Boolean);
  const { removeItemFromShelf, removeMatrixAssignment } = useProjectStore();

  // Filter items by variant
  const items = allItems.filter((item) => {
    if (!item || !variantIncludedIds) return true;
    return variantIncludedIds.has(item.id) || showGhostedProp;
  });

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''}`}
      style={{ '--matrix-card-width': `${Math.floor(cardWidth)}px` } as React.CSSProperties}>
      {items.map((item) => {
        if (!item) return null;
        const product = catalogue.find((p) => p.id === item.productId);
        const isGhosted = variantIncludedIds ? !variantIncludedIds.has(item.id) : false;
        return (
          <MatrixProductCard key={item.id} itemId={item.id} product={product}
            isPlaceholder={item.isPlaceholder} placeholderName={item.placeholderName}
            isGhosted={isGhosted}
            onRemove={() => {
              removeItemFromShelf(shelf.id, item.id);
              removeMatrixAssignment(shelf.id, item.id);
            }} />
        );
      })}
      <button className="matrix-cell-add-ph" onClick={() => onAddPlaceholder(row, col)} title="Add placeholder SKU">+</button>
    </div>
  );
}

function MatrixProductCard({ itemId, product, isPlaceholder, placeholderName, isGhosted, onRemove }: {
  itemId: string; product?: Product; isPlaceholder: boolean;
  placeholderName?: string; isGhosted?: boolean; onRemove: () => void;
}) {
  const cardFormat = useProjectStore((s) => s.cardFormat);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `matrix-item-${itemId}`, data: { itemId },
  });
  const name = isPlaceholder ? (placeholderName || 'New SKU') : (product?.name || 'Unknown');

  return (
    <div ref={setNodeRef} className={`matrix-card ${isDragging ? 'dragging' : ''} ${isPlaceholder ? 'placeholder' : ''} ${isGhosted ? 'ghosted' : ''}`}
      {...attributes} {...listeners}>
      <button className="matrix-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><CloseIcon size={8} color="#fff" /></button>
      {cardFormat.showImage && (
        <div className="matrix-card-image">
          {product?.imageUrl ? (
            <img src={product.imageUrl} alt={name} />
          ) : (
            <div className="matrix-card-image-ph">{isPlaceholder ? '+' : name.charAt(0)}</div>
          )}
        </div>
      )}
      {cardFormat.showName && <div className="matrix-card-name" title={name}>{name}</div>}
      {cardFormat.showSku && <div className="matrix-card-sku">{product?.sku || '—'}</div>}
      {cardFormat.showRrp && <div className="matrix-card-rrp">RRP: {product?.rrp || '—'}</div>}
      {cardFormat.showVolume && <div className="matrix-card-vol">Vol: {product?.volume ? product.volume.toLocaleString() : '—'}</div>}
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
    project, addItemToShelf,
    updateMatrixLayout, setMatrixAssignment,
    activeVariantId, showGhosted,
  } = useProjectStore();

  const [editingTitle, setEditingTitle] = useState(false);
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

    const wPad = 24;
    const availW = wrapperSize.w - wPad - ROW_HEADER_WIDTH - ADD_BTN_WIDTH - (numCols + 1) * GAP;
    const availH = wrapperSize.h - wPad - HEADER_ROW_HEIGHT - ADD_ROW_HEIGHT - (numRows + 1) * GAP;

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

    const totalProducts = cellCounts.flat().reduce((s, n) => s + n, 0);
    if (totalProducts === 0) {
      return {
        columnWidths: Array(numCols).fill((availW - (numCols - 1) * GAP) / numCols),
        rowHeights: Array(numRows).fill((availH - (numRows - 1) * GAP) / numRows),
        cardWidth: MAX_CARD_WIDTH,
      };
    }

    // Binary search for largest uniform card width
    let lo = MIN_CARD_WIDTH;
    let hi = MAX_CARD_WIDTH;
    let bestCW = MIN_CARD_WIDTH;
    let bestColW: number[] = [];
    let bestRowH: number[] = [];

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const result = computeLayout(mid, cellCounts, numCols, numRows, availW, availH);
      if (result.fits) {
        bestCW = mid;
        bestColW = result.colWidths;
        bestRowH = result.rowHeights;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Distribute remaining width evenly
    const totalColW = bestColW.reduce((s, w) => s + w, 0) + (numCols - 1) * GAP;
    if (totalColW < availW) {
      const extra = availW - totalColW;
      bestColW = bestColW.map((w) => w + extra / numCols);
    }

    return { columnWidths: bestColW, rowHeights: bestRowH, cardWidth: bestCW };
  }, [layout.xLabels, layout.yLabels, layout.assignments, wrapperSize, variantIncludedIds, showGhosted]);

  const gridCols = `${ROW_HEADER_WIDTH}px ${columnWidths.map((w) => `${w}px`).join(' ')} ${ADD_BTN_WIDTH}px`;

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
    const name = prompt('Placeholder name (e.g. "New Premium SKU"):');
    if (name === null) return;
    const newItemId = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    addItemToShelf(shelfId, {
      id: newItemId, productId: '', position: shelf.items.length,
      isPlaceholder: true, placeholderName: name || 'New SKU',
    });
    setTimeout(() => setMatrixAssignment(shelfId, newItemId, row, col), 0);
  }, [shelf, shelfId, addItemToShelf, setMatrixAssignment]);

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
    setEditingTitle(false);
  }, [activePlan, updateMatrixLayout]);

  if (!shelf || !project) return null;

  const assignedItemIds = new Set(layout.assignments.map((a) => a.itemId));
  const unassigned = shelf.items.filter((i) => !assignedItemIds.has(i.id));

  return (
    <div className="range-design">
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="range-design-canvas">
          <div className="range-design-title-bar">
            {editingTitle ? (
              <input className="range-design-title-input" defaultValue={activePlan?.name || layout.title} autoFocus
                onBlur={(e) => updateTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && updateTitle((e.target as HTMLInputElement).value)} />
            ) : (
              <>
                <h2 className="range-design-title" onDoubleClick={() => setEditingTitle(true)} title="Double-click to edit">
                  {activePlan?.name || layout.title}
                  {activeVariant && <span className="variant-badge">{activeVariant.name}</span>}
                </h2>
                <PillToggle value={shelfId} onChange={onShelfChange} />
              </>
            )}
          </div>

          <div className="matrix-16-9">
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
                      onAddPlaceholder={handleAddPlaceholder}
                      variantIncludedIds={variantIncludedIds}
                      showGhostedProp={showGhosted} />
                  ))}
                  <div />
                </div>
              ))}

              <div className="matrix-add-row">
                <button className="matrix-add-btn wide" onClick={() => addLabel('y')}>+ Row</button>
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
          dropZoneId="catalogue-drop-zone-design" />

        <DragOverlay>
          {activeProduct && (
            <div className="matrix-drag-preview">{activeProduct.name}</div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
