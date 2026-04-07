import { useState, useCallback } from 'react';
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
import type { Product } from '../types';
import './RangeDesign.css';

interface RangeDesignProps {
  onImport: () => void;
}

interface MatrixItem {
  id: string;
  productId: string;
  row: number;
  col: number;
}

function MatrixCell({ row, col, item, catalogue }: {
  row: number;
  col: number;
  item?: MatrixItem;
  catalogue: Product[];
}) {
  const cellId = `matrix-cell-${row}-${col}`;
  const { setNodeRef, isOver } = useDroppable({ id: cellId });

  return (
    <div ref={setNodeRef} className={`matrix-cell ${isOver ? 'cell-over' : ''} ${item ? 'cell-filled' : ''}`}>
      {item && <MatrixProduct item={item} catalogue={catalogue} />}
    </div>
  );
}

function MatrixProduct({ item, catalogue }: { item: MatrixItem; catalogue: Product[] }) {
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
  const { project } = useProjectStore();
  const [xLabels, setXLabels] = useState<string[]>(['Entry', 'Core', 'Premium', 'Luxury']);
  const [yLabels, setYLabels] = useState<string[]>(['Skincare', 'Haircare', 'Bodycare']);
  const [matrixItems, setMatrixItems] = useState<MatrixItem[]>([]);
  const [editingAxis, setEditingAxis] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

  const currentProductIds = new Set(
    project?.currentShelf.items.map((i) => i.productId).filter(Boolean) || []
  );
  const futureProductIds = new Set(
    project?.futureShelf.items.map((i) => i.productId).filter(Boolean) || []
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeId = String(active.id);
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (data?.product) setActiveProduct(data.product);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProduct(null);
    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    const activeId = String(active.id);

    // Parse target cell
    const cellMatch = overId.match(/^matrix-cell-(\d+)-(\d+)$/);
    if (!cellMatch) return;
    const row = parseInt(cellMatch[1]);
    const col = parseInt(cellMatch[2]);

    // Catalogue item dropped on matrix
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;
      // Remove any existing item at this cell
      setMatrixItems((prev) => {
        const filtered = prev.filter((i) => !(i.row === row && i.col === col));
        return [...filtered, {
          id: `mi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          productId: data.product.id,
          row,
          col,
        }];
      });
    }

    // Matrix item moved to new cell
    if (activeId.startsWith('matrix-item-')) {
      const data = active.data.current as { matrixItem: MatrixItem };
      if (!data?.matrixItem) return;
      setMatrixItems((prev) => {
        const filtered = prev.filter((i) => i.id !== data.matrixItem.id && !(i.row === row && i.col === col));
        return [...filtered, { ...data.matrixItem, row, col }];
      });
    }
  };

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

  return (
    <div className="range-design">
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="range-design-canvas">
          <div className="matrix-wrapper" style={{ aspectRatio: '16/9' }}>
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
                    item={matrixItems.find((i) => i.row === row && i.col === col)}
                    catalogue={project?.catalogue || []}
                  />
                ))}
                <div />
              </div>
            ))}

            {/* Add row button */}
            <div className="matrix-add-row">
              <button className="matrix-add-btn" onClick={() => addLabel('y')} title="Add row">+ Row</button>
            </div>
          </div>
        </div>

        <Catalogue products={project?.catalogue || []} onImport={onImport}
          currentProductIds={currentProductIds} futureProductIds={futureProductIds} />

        <DragOverlay>
          {activeProduct && (
            <div className="matrix-drag-preview">
              <div className="matrix-product-name">{activeProduct.name}</div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
