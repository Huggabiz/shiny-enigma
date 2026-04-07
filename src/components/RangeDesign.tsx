import { useCallback, useMemo } from 'react';
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
import { useState } from 'react';
import './RangeDesign.css';

interface RangeDesignProps {
  shelfId: 'current' | 'future';
  onImport: () => void;
}

function MatrixCell({ row, col, itemIds, shelf, catalogue, onRemoveItem }: {
  row: number;
  col: number;
  itemIds: string[];
  shelf: Shelf;
  catalogue: Product[];
  onRemoveItem: (itemId: string) => void;
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });
  const items = itemIds.map((id) => shelf.items.find((i) => i.id === id)).filter(Boolean);

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''}`}>
      {items.map((item) => {
        if (!item) return null;
        const product = catalogue.find((p) => p.id === item.productId);
        return (
          <MatrixProductCard key={item.id} itemId={item.id} product={product}
            isPlaceholder={item.isPlaceholder} placeholderName={item.placeholderName}
            onRemove={() => onRemoveItem(item.id)} />
        );
      })}
    </div>
  );
}

function MatrixProductCard({ itemId, product, isPlaceholder, placeholderName, onRemove }: {
  itemId: string;
  product?: Product;
  isPlaceholder: boolean;
  placeholderName?: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `matrix-item-${itemId}`,
    data: { itemId },
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
      {product && <div className="matrix-card-vol">Vol: {product.volume.toLocaleString()}</div>}
    </div>
  );
}

export function RangeDesign({ shelfId, onImport }: RangeDesignProps) {
  const {
    project, addItemToShelf, removeItemFromShelf,
    updateMatrixLayout, setMatrixAssignment, removeMatrixAssignment,
  } = useProjectStore();

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingAxis, setEditingAxis] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

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

  // Build cell lookup: row,col -> list of item IDs
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

    // Catalogue item → add to shelf + assign to cell
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;
      // Check not already on shelf
      if (shelf.items.some((i) => i.productId === data.product.id)) return;
      const newItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      addItemToShelf(shelfId, {
        id: newItemId,
        productId: data.product.id,
        position: shelf.items.length,
        isPlaceholder: false,
      });
      // Use setTimeout so the store has updated
      setTimeout(() => setMatrixAssignment(shelfId, newItemId, row, col), 0);
      return;
    }

    // Matrix item → move to new cell
    if (activeId.startsWith('matrix-item-')) {
      const data = active.data.current as { itemId: string };
      if (data?.itemId) {
        setMatrixAssignment(shelfId, data.itemId, row, col);
      }
    }
  };

  const handleRemoveItem = useCallback((itemId: string) => {
    removeItemFromShelf(shelfId, itemId);
    removeMatrixAssignment(shelfId, itemId);
  }, [shelfId, removeItemFromShelf, removeMatrixAssignment]);

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
        assignments: layout.assignments
          .filter((a) => a.col !== index)
          .map((a) => a.col > index ? { ...a, col: a.col - 1 } : a),
      });
    } else {
      updateMatrixLayout(shelfId, {
        yLabels: layout.yLabels.filter((_, i) => i !== index),
        assignments: layout.assignments
          .filter((a) => a.row !== index)
          .map((a) => a.row > index ? { ...a, row: a.row - 1 } : a),
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

  // Products on shelf but not assigned to any cell
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
                <span className="range-design-shelf-tag">{shelfId === 'current' ? 'Current Range' : 'Future Range'}</span>
              </h2>
            )}
          </div>

          <div className="matrix-16-9">
            <div className="matrix-wrapper">
              {/* X headers */}
              <div className="matrix-header-row" style={{ gridTemplateColumns: `72px repeat(${layout.xLabels.length}, 1fr) 28px` }}>
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

              {/* Rows */}
              {layout.yLabels.map((yLabel, row) => (
                <div key={row} className="matrix-row" style={{ gridTemplateColumns: `72px repeat(${layout.xLabels.length}, 1fr) 28px` }}>
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
                      onRemoveItem={handleRemoveItem} />
                  ))}
                  <div />
                </div>
              ))}

              <div className="matrix-add-row">
                <button className="matrix-add-btn wide" onClick={() => addLabel('y')}>+ Row</button>
              </div>
            </div>
          </div>

          {/* Unassigned products tray */}
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
