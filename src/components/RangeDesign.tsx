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
import type { Product, Shelf, MatrixLayout } from '../types';
import './RangeDesign.css';

interface RangeDesignProps {
  shelfId: 'current' | 'future';
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

// For n products at a given card width, how many columns and rows needed in a cell?
function cellGridForCardWidth(n: number, cardW: number, cellW: number): { cols: number; rows: number } {
  if (n === 0) return { cols: 0, rows: 0 };
  const maxCols = Math.max(1, Math.floor((cellW - CELL_PADDING * 2 + CARD_GAP) / (cardW + CARD_GAP)));
  const cols = Math.min(n, maxCols);
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

// Check if a given card width fits all cells within available space
function layoutFits(
  cardW: number,
  cellCounts: number[][], // [row][col] = product count
  numCols: number,
  numRows: number,
  availW: number,
  availH: number,
): { fits: boolean; colWidths: number[]; rowHeights: number[] } {
  const cardH = cardW * CARD_ASPECT;

  // For each column, find the max horizontal slots needed across all rows
  const colSlots = Array.from({ length: numCols }, (_, col) => {
    let maxCols = 1;
    for (let row = 0; row < numRows; row++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      // With unlimited width, how many cols would this cell use?
      // We want to allow wrapping, so compute cols for this card width
      // given that the column width = maxCols * (cardW + gap)
      // Start with a single row (cols = n) and see if we need fewer
      const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n / CARD_ASPECT))));
      if (cols > maxCols) maxCols = cols;
    }
    return maxCols;
  });

  // Column widths
  const colWidths = colSlots.map((slots) => slots * (cardW + CARD_GAP) - CARD_GAP + CELL_PADDING * 2);
  const totalW = colWidths.reduce((sum, w) => sum + w, 0) + (numCols - 1) * GAP;

  if (totalW > availW) return { fits: false, colWidths, rowHeights: [] };

  // For each row, find the max vertical slots needed
  const rowSlots = Array.from({ length: numRows }, (_, row) => {
    let maxRows = 1;
    for (let col = 0; col < numCols; col++) {
      const n = cellCounts[row][col];
      if (n === 0) continue;
      const { rows } = cellGridForCardWidth(n, cardW, colWidths[col]);
      if (rows > maxRows) maxRows = rows;
    }
    return maxRows;
  });

  const rowHeights = rowSlots.map((slots) => slots * (cardH + CARD_GAP) - CARD_GAP + CELL_PADDING * 2);
  const totalH = rowHeights.reduce((sum, h) => sum + h, 0) + (numRows - 1) * GAP;

  return { fits: totalH <= availH, colWidths, rowHeights };
}

function MatrixCell({ row, col, itemIds, shelf, catalogue, cardWidth }: {
  row: number; col: number; itemIds: string[];
  shelf: Shelf; catalogue: Product[];
  cardWidth: number;
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  const items = itemIds.map((id) => shelf.items.find((i) => i.id === id)).filter(Boolean);
  const { removeItemFromShelf, removeMatrixAssignment } = useProjectStore();

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''}`}
      style={{ '--matrix-card-width': `${Math.floor(cardWidth)}px` } as React.CSSProperties}>
      {items.map((item) => {
        if (!item) return null;
        const product = catalogue.find((p) => p.id === item.productId);
        return (
          <MatrixProductCard key={item.id} itemId={item.id} product={product}
            isPlaceholder={item.isPlaceholder} placeholderName={item.placeholderName}
            onRemove={() => {
              removeItemFromShelf(shelf.id, item.id);
              removeMatrixAssignment(shelf.id, item.id);
            }} />
        );
      })}
    </div>
  );
}

function MatrixProductCard({ itemId, product, isPlaceholder, placeholderName, onRemove }: {
  itemId: string; product?: Product; isPlaceholder: boolean;
  placeholderName?: string; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `matrix-item-${itemId}`, data: { itemId },
  });
  const name = isPlaceholder ? (placeholderName || 'New SKU') : (product?.name || 'Unknown');

  return (
    <div ref={setNodeRef} className={`matrix-card ${isDragging ? 'dragging' : ''} ${isPlaceholder ? 'placeholder' : ''}`}
      {...attributes} {...listeners}>
      <button className="matrix-card-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
      <div className="matrix-card-image">
        {product?.imageUrl ? (
          <img src={product.imageUrl} alt={name} />
        ) : (
          <div className="matrix-card-image-ph">{isPlaceholder ? '+' : name.charAt(0)}</div>
        )}
      </div>
      <div className="matrix-card-name" title={name}>{name}</div>
      {product && <div className="matrix-card-sku">{product.sku}</div>}
    </div>
  );
}

export function RangeDesign({ shelfId, onImport }: RangeDesignProps) {
  const {
    project, addItemToShelf,
    updateMatrixLayout, setMatrixAssignment,
  } = useProjectStore();

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingAxis, setEditingAxis] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });

  const shelf = project?.[shelfId === 'current' ? 'currentShelf' : 'futureShelf'];
  const catalogue = project?.catalogue || [];
  const layout: MatrixLayout = useMemo(() =>
    shelf?.matrixLayout || { title: shelf?.name || '', xLabels: [], yLabels: [], assignments: [] },
    [shelf?.matrixLayout, shelf?.name]
  );

  const currentProductIds = useMemo(() => new Set(
    project?.currentShelf.items.map((i) => i.productId).filter(Boolean) || []
  ), [project?.currentShelf.items]);
  const futureProductIds = useMemo(() => new Set(
    project?.futureShelf.items.map((i) => i.productId).filter(Boolean) || []
  ), [project?.futureShelf.items]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWrapperSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build cell counts grid and compute uniform card size
  const { columnWidths, rowHeights, cardWidth } = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0 || wrapperSize.w === 0 || wrapperSize.h === 0) {
      return { columnWidths: [], rowHeights: [], cardWidth: MAX_CARD_WIDTH };
    }

    const wPad = 24;
    const availW = wrapperSize.w - wPad - ROW_HEADER_WIDTH - ADD_BTN_WIDTH - (numCols + 1) * GAP;
    const availH = wrapperSize.h - wPad - HEADER_ROW_HEIGHT - ADD_ROW_HEIGHT - (numRows + 1) * GAP;

    // Cell counts: [row][col]
    const cellCounts: number[][] = [];
    for (let row = 0; row < numRows; row++) {
      cellCounts.push([]);
      for (let col = 0; col < numCols; col++) {
        cellCounts[row].push(
          layout.assignments.filter((a) => a.row === row && a.col === col).length
        );
      }
    }

    // Binary search for the largest card width that fits
    let lo = MIN_CARD_WIDTH;
    let hi = MAX_CARD_WIDTH;
    let bestCW = MIN_CARD_WIDTH;
    let bestColWidths: number[] = [];
    let bestRowHeights: number[] = [];

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const result = layoutFits(mid, cellCounts, numCols, numRows, availW, availH);
      if (result.fits) {
        bestCW = mid;
        bestColWidths = result.colWidths;
        bestRowHeights = result.rowHeights;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // If extra space, distribute it to columns and rows proportionally
    const totalColW = bestColWidths.reduce((s, w) => s + w, 0) + (numCols - 1) * GAP;
    if (totalColW < availW) {
      const extra = availW - totalColW;
      const perCol = extra / numCols;
      bestColWidths = bestColWidths.map((w) => w + perCol);
    }
    const totalRowH = bestRowHeights.reduce((s, h) => s + h, 0) + (numRows - 1) * GAP;
    if (totalRowH < availH) {
      const extra = availH - totalRowH;
      const perRow = extra / numRows;
      bestRowHeights = bestRowHeights.map((h) => h + perRow);
    }

    return { columnWidths: bestColWidths, rowHeights: bestRowHeights, cardWidth: bestCW };
  }, [layout.xLabels, layout.yLabels, layout.assignments, wrapperSize]);

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
    updateMatrixLayout(shelfId, { title: text || layout.title });
    setEditingTitle(false);
  }, [shelfId, layout, updateMatrixLayout]);

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
              <input className="range-design-title-input" defaultValue={layout.title} autoFocus
                onBlur={(e) => updateTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && updateTitle((e.target as HTMLInputElement).value)} />
            ) : (
              <h2 className="range-design-title" onDoubleClick={() => setEditingTitle(true)} title="Double-click to edit">
                {layout.title}
                <span className="range-design-shelf-tag">{shelfId === 'current' ? 'Current' : 'Future'}</span>
              </h2>
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
                    <button className="matrix-label-remove" onClick={() => removeLabel('x', i)}>×</button>
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
                    <button className="matrix-label-remove" onClick={() => removeLabel('y', row)}>×</button>
                  </div>
                  {layout.xLabels.map((_, col) => (
                    <MatrixCell key={`${row}-${col}`} row={row} col={col}
                      itemIds={cellMap.get(`${row}-${col}`) || []}
                      shelf={shelf} catalogue={catalogue}
                      cardWidth={cardWidth} />
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
                    <span key={item.id} className="unassigned-item">
                      {item.isPlaceholder ? item.placeholderName : product?.name || item.productId}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Catalogue products={catalogue} onImport={onImport}
          currentProductIds={currentProductIds} futureProductIds={futureProductIds} />

        <DragOverlay>
          {activeProduct && (
            <div className="matrix-drag-preview">{activeProduct.name}</div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
