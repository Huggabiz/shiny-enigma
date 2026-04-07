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
const MIN_CARD_WIDTH = 46;
const CARD_ASPECT = 1.4; // height/width ratio for cards
const HEADER_ROW_HEIGHT = 28;
const ADD_ROW_HEIGHT = 28;

// For a cell with `n` products and given cell width/height, find the best cols count
// that maximizes card size while fitting everything
function bestGridLayout(n: number, cellW: number, cellH: number): { cols: number; cardW: number } {
  if (n === 0) return { cols: 1, cardW: MAX_CARD_WIDTH };
  let bestCardW = 0;
  let bestCols = 1;

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cardW = Math.min(MAX_CARD_WIDTH, (cellW - CELL_PADDING * 2 - (cols - 1) * CARD_GAP) / cols);
    const cardH = cardW * CARD_ASPECT;
    const totalH = rows * cardH + (rows - 1) * CARD_GAP + CELL_PADDING * 2;
    if (totalH <= cellH && cardW >= MIN_CARD_WIDTH && cardW > bestCardW) {
      bestCardW = cardW;
      bestCols = cols;
    }
  }

  // If nothing fit within height, fall back to single row (horizontal)
  if (bestCardW === 0) {
    const cardW = Math.max(MIN_CARD_WIDTH, (cellW - CELL_PADDING * 2 - (n - 1) * CARD_GAP) / n);
    return { cols: n, cardW };
  }

  return { cols: bestCols, cardW: bestCardW };
}

function MatrixCell({ row, col, itemIds, shelf, catalogue, cellWidth, cellHeight }: {
  row: number; col: number; itemIds: string[];
  shelf: Shelf; catalogue: Product[];
  cellWidth: number; cellHeight: number;
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  const items = itemIds.map((id) => shelf.items.find((i) => i.id === id)).filter(Boolean);
  const { removeItemFromShelf, removeMatrixAssignment } = useProjectStore();

  const { cardW } = bestGridLayout(items.length, cellWidth, cellHeight);

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''}`}
      style={{ '--matrix-card-width': `${Math.floor(cardW)}px` } as React.CSSProperties}>
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

  // Track wrapper dimensions
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWrapperSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute column widths considering both X and Y space
  const { columnWidths, rowHeight } = useMemo(() => {
    const numCols = layout.xLabels.length;
    const numRows = layout.yLabels.length;
    if (numCols === 0 || numRows === 0 || wrapperSize.w === 0 || wrapperSize.h === 0) {
      return { columnWidths: [], rowHeight: 0 };
    }

    const padding = 24; // wrapper padding
    const availW = wrapperSize.w - padding - ROW_HEADER_WIDTH - ADD_BTN_WIDTH - (numCols + 1) * GAP;
    const availH = wrapperSize.h - padding - HEADER_ROW_HEIGHT - ADD_ROW_HEIGHT - (numRows + 1) * GAP;
    const cellH = Math.max(60, availH / numRows);

    // For each column, find the max products in any cell and compute how many
    // horizontal slots that needs given the available cell height
    const colSlots = layout.xLabels.map((_, col) => {
      let maxSlots = 1;
      for (let row = 0; row < numRows; row++) {
        const count = layout.assignments.filter((a) => a.col === col && a.row === row).length;
        if (count === 0) continue;
        // How many columns needed in this cell given cell height?
        const { cols } = bestGridLayout(count, 999, cellH); // unlimited width to get ideal cols
        // But we need at least this many horizontal slots
        if (cols > maxSlots) maxSlots = cols;
      }
      return maxSlots;
    });

    const totalSlots = colSlots.reduce((sum, n) => sum + n, 0) || numCols;

    // Distribute available width proportionally to slots
    const slotWidth = availW / totalSlots;
    const colWidths = colSlots.map((slots) => Math.max(slots * slotWidth, 60));

    return { columnWidths: colWidths, rowHeight: cellH };
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
                <div key={row} className="matrix-row" style={{ gridTemplateColumns: gridCols, height: `${rowHeight}px` }}>
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
                      cellWidth={columnWidths[col] || 100}
                      cellHeight={rowHeight} />
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
