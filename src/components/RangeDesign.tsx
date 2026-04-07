import { useState, useCallback, useMemo } from 'react';
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
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { Catalogue } from './Catalogue';
import { useProjectStore } from '../store/useProjectStore';
import type { Product, ShelfItem, ShelfLabel } from '../types';
import './RangeDesign.css';

interface RangeDesignProps {
  onImport: () => void;
}

export interface MatrixItem {
  id: string;
  productId: string;
  row: number;
  col: number;
}

export interface RangeDesignState {
  title: string;
  xLabels: string[];
  yLabels: string[];
  items: MatrixItem[];
}

function MatrixCell({ row, col, items, catalogue, onRemoveItem }: {
  row: number;
  col: number;
  items: MatrixItem[];
  catalogue: Product[];
  onRemoveItem: (itemId: string) => void;
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''} ${items.length > 0 ? 'cell-filled' : ''}`}>
      <div className="matrix-cell-products">
        {items.map((item) => (
          <MatrixProduct key={item.id} item={item} catalogue={catalogue} onRemove={() => onRemoveItem(item.id)} />
        ))}
      </div>
    </div>
  );
}

function MatrixProduct({ item, catalogue, onRemove }: { item: MatrixItem; catalogue: Product[]; onRemove: () => void }) {
  const product = catalogue.find((p) => p.id === item.productId);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `matrix-item-${item.id}`,
    data: { matrixItem: item },
  });

  return (
    <div
      ref={setNodeRef}
      className={`matrix-product ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <button className="matrix-product-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>×</button>
      <div className="matrix-product-image">
        {product?.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} />
        ) : (
          <div className="matrix-product-placeholder">{product?.name?.charAt(0) || '?'}</div>
        )}
      </div>
      <div className="matrix-product-name">{product?.name || 'Unknown'}</div>
      <div className="matrix-product-sku">{product?.sku || ''}</div>
    </div>
  );
}

export function RangeDesign({ onImport }: RangeDesignProps) {
  const { project, addItemToShelf, addLabel: addShelfLabel } = useProjectStore();
  const [title, setTitle] = useState('Range Design');
  const [editingTitle, setEditingTitle] = useState(false);
  const [xLabels, setXLabels] = useState<string[]>(['Entry', 'Core', 'Premium', 'Luxury']);
  const [yLabels, setYLabels] = useState<string[]>(['Skincare', 'Haircare', 'Bodycare']);
  const [matrixItems, setMatrixItems] = useState<MatrixItem[]>([]);
  const [editingAxis, setEditingAxis] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [activeDragType, setActiveDragType] = useState<'catalogue' | 'matrix' | null>(null);

  const currentProductIds = useMemo(() => new Set(
    project?.currentShelf.items.map((i) => i.productId).filter(Boolean) || []
  ), [project?.currentShelf.items]);

  const futureProductIds = useMemo(() => new Set(
    project?.futureShelf.items.map((i) => i.productId).filter(Boolean) || []
  ), [project?.futureShelf.items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeId = String(active.id);
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (data?.product) {
        setActiveProduct(data.product);
        setActiveDragType('catalogue');
      }
    } else if (activeId.startsWith('matrix-item-')) {
      setActiveDragType('matrix');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProduct(null);
    setActiveDragType(null);
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    const activeId = String(active.id);

    // Parse target cell
    const cellMatch = overId.match(/^matrix-cell-(\d+)-(\d+)$/);
    if (!cellMatch) return;
    const row = parseInt(cellMatch[1]);
    const col = parseInt(cellMatch[2]);

    // Catalogue item dropped on matrix — add to cell (allow multiple)
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;
      // Don't add duplicate product to same cell
      const alreadyInCell = matrixItems.some((i) => i.row === row && i.col === col && i.productId === data.product.id);
      if (alreadyInCell) return;
      setMatrixItems((prev) => [...prev, {
        id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: data.product.id,
        row,
        col,
      }]);
    }

    // Matrix item moved to new cell
    if (activeId.startsWith('matrix-item-')) {
      const data = active.data.current as { matrixItem: MatrixItem };
      if (!data?.matrixItem) return;
      setMatrixItems((prev) =>
        prev.map((i) => i.id === data.matrixItem.id ? { ...i, row, col } : i)
      );
    }
  };

  const removeItem = useCallback((itemId: string) => {
    setMatrixItems((prev) => prev.filter((i) => i.id !== itemId));
  }, []);

  const addLabel = useCallback((axis: 'x' | 'y') => {
    const text = prompt(`New ${axis === 'x' ? 'column' : 'row'} label:`);
    if (!text) return;
    if (axis === 'x') setXLabels((prev) => [...prev, text]);
    else setYLabels((prev) => [...prev, text]);
  }, []);

  const removeLabel = useCallback((axis: 'x' | 'y', index: number) => {
    if (axis === 'x') {
      setXLabels((prev) => prev.filter((_, i) => i !== index));
      setMatrixItems((prev) => prev.filter((i) => i.col !== index).map((i) => i.col > index ? { ...i, col: i.col - 1 } : i));
    } else {
      setYLabels((prev) => prev.filter((_, i) => i !== index));
      setMatrixItems((prev) => prev.filter((i) => i.row !== index).map((i) => i.row > index ? { ...i, row: i.row - 1 } : i));
    }
  }, []);

  const updateLabel = useCallback((axis: 'x' | 'y', index: number, text: string) => {
    if (axis === 'x') setXLabels((prev) => prev.map((l, i) => i === index ? text : l));
    else setYLabels((prev) => prev.map((l, i) => i === index ? text : l));
    setEditingAxis(null);
  }, []);

  // Pull design into a shelf (current or future) with X>Y label grouping
  const pullToShelf = useCallback((shelfId: 'current' | 'future') => {
    if (!project) return;

    // Build items ordered: for each X label (column), then each Y label (row)
    let position = 0;
    const newItems: ShelfItem[] = [];
    const newLabels: ShelfLabel[] = [];

    for (let col = 0; col < xLabels.length; col++) {
      const xLabel = xLabels[col];
      const colStart = position;

      for (let row = 0; row < yLabels.length; row++) {
        const cellItems = matrixItems.filter((i) => i.row === row && i.col === col);
        if (cellItems.length === 0) continue;

        for (const mi of cellItems) {
          // Check not already on shelf
          const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
          const alreadyOnShelf = project[shelfKey].items.some((si) => si.productId === mi.productId);
          if (alreadyOnShelf) continue;

          newItems.push({
            id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            productId: mi.productId,
            position: position++,
            isPlaceholder: false,
          });
        }
      }

      // Create X label spanning from colStart to position-1
      if (position > colStart) {
        newLabels.push({
          id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text: xLabel,
          startPosition: colStart,
          endPosition: position - 1,
          color: '#dce6f0',
        });
      }
    }

    // Add all items and labels to the shelf
    for (const item of newItems) {
      addItemToShelf(shelfId, item);
    }
    for (const label of newLabels) {
      addShelfLabel(shelfId, label);
    }

    const count = newItems.length;
    if (count > 0) {
      alert(`Added ${count} products to ${shelfId === 'current' ? 'Current' : 'Future'} Range with ${newLabels.length} section labels.`);
    } else {
      alert('No new products to add (all already on shelf or no products in design).');
    }
  }, [project, matrixItems, xLabels, yLabels, addItemToShelf, addShelfLabel]);

  return (
    <div className="range-design">
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="range-design-canvas">
          {/* Title */}
          <div className="range-design-title-bar">
            {editingTitle ? (
              <input
                className="range-design-title-input"
                defaultValue={title}
                autoFocus
                onBlur={(e) => { setTitle(e.target.value || 'Range Design'); setEditingTitle(false); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { setTitle((e.target as HTMLInputElement).value || 'Range Design'); setEditingTitle(false); }
                }}
              />
            ) : (
              <h2 className="range-design-title" onDoubleClick={() => setEditingTitle(true)} title="Double-click to edit">
                {title}
              </h2>
            )}
            <div className="range-design-actions">
              <button className="rd-action-btn" onClick={() => pullToShelf('current')}>
                Pull to Current Range
              </button>
              <button className="rd-action-btn" onClick={() => pullToShelf('future')}>
                Pull to Future Range
              </button>
            </div>
          </div>

          <div className="matrix-wrapper">
            {/* Top header row with X labels */}
            <div className="matrix-header-row" style={{ gridTemplateColumns: `80px repeat(${xLabels.length}, 1fr) 32px` }}>
              <div className="matrix-corner" />
              {xLabels.map((label, i) => (
                <div key={i} className="matrix-col-header" onDoubleClick={() => setEditingAxis({ axis: 'x', index: i })}>
                  {editingAxis?.axis === 'x' && editingAxis.index === i ? (
                    <input className="matrix-label-input" defaultValue={label} autoFocus
                      onBlur={(e) => updateLabel('x', i, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && updateLabel('x', i, (e.target as HTMLInputElement).value)} />
                  ) : (
                    <span>{label}</span>
                  )}
                  <button className="matrix-label-remove" onClick={() => removeLabel('x', i)}>×</button>
                </div>
              ))}
              <button className="matrix-add-btn" onClick={() => addLabel('x')} title="Add column">+</button>
            </div>

            {/* Grid rows */}
            {yLabels.map((yLabel, row) => (
              <div key={row} className="matrix-row" style={{ gridTemplateColumns: `80px repeat(${xLabels.length}, 1fr) 32px` }}>
                <div className="matrix-row-header" onDoubleClick={() => setEditingAxis({ axis: 'y', index: row })}>
                  {editingAxis?.axis === 'y' && editingAxis.index === row ? (
                    <input className="matrix-label-input" defaultValue={yLabel} autoFocus
                      onBlur={(e) => updateLabel('y', row, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && updateLabel('y', row, (e.target as HTMLInputElement).value)} />
                  ) : (
                    <span>{yLabel}</span>
                  )}
                  <button className="matrix-label-remove" onClick={() => removeLabel('y', row)}>×</button>
                </div>
                {xLabels.map((_, col) => (
                  <MatrixCell
                    key={`${row}-${col}`}
                    row={row}
                    col={col}
                    items={matrixItems.filter((i) => i.row === row && i.col === col)}
                    catalogue={project?.catalogue || []}
                    onRemoveItem={removeItem}
                  />
                ))}
                <div />
              </div>
            ))}

            {/* Add row button */}
            <div className="matrix-add-row">
              <button className="matrix-add-btn wide" onClick={() => addLabel('y')} title="Add row">+ Row</button>
            </div>
          </div>
        </div>

        <Catalogue products={project?.catalogue || []} onImport={onImport}
          currentProductIds={currentProductIds} futureProductIds={futureProductIds} />

        <DragOverlay>
          {activeProduct && activeDragType === 'catalogue' && (
            <div className="matrix-drag-preview">
              <div className="matrix-product-name">{activeProduct.name}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
