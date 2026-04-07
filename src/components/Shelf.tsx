import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ProductCard } from './ProductCard';
import type { Product, Shelf as ShelfType, ShelfItem, ShelfLabel } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import './Shelf.css';

interface ShelfProps {
  shelf: ShelfType;
  catalogue: Product[];
  onAddPlaceholder: () => void;
}

const CARD_WIDTH = 100; // actual card width
const CARD_GAP = 10;    // gap between cards
const CARD_SLOT_WIDTH = CARD_WIDTH + CARD_GAP; // 110

// Pack labels into rows, compacting where possible (non-overlapping labels share a row)
function packLabelsIntoRows(labels: ShelfLabel[]): ShelfLabel[][] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.startPosition - b.startPosition);
  const rows: ShelfLabel[][] = [];

  for (const label of sorted) {
    let placed = false;
    for (const row of rows) {
      const overlaps = row.some(
        (existing) => label.startPosition <= existing.endPosition && label.endPosition >= existing.startPosition
      );
      if (!overlaps) {
        row.push(label);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([label]);
    }
  }
  return rows;
}

export function Shelf({ shelf, catalogue, onAddPlaceholder }: ShelfProps) {
  const {
    selectedItemId,
    setSelectedItem,
    removeItemFromShelf,
    linkMode,
    linkSource,
    setLinkSource,
    addLink,
    updateLabel,
    removeLabel,
    addLabel,
  } = useProjectStore();

  const { setNodeRef, isOver } = useDroppable({ id: `shelf-${shelf.id}` });
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // Label drag state
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);
  const [resizingLabel, setResizingLabel] = useState<{ id: string; side: 'left' | 'right' } | null>(null);
  const dragStartRef = useRef<{ x: number; startPos: number; endPos: number }>({ x: 0, startPos: 0, endPos: 0 });

  const getProduct = (item: ShelfItem): Product | undefined =>
    catalogue.find((p) => p.id === item.productId);

  const handleCardClick = (item: ShelfItem) => {
    if (linkMode) {
      if (!linkSource) {
        if (shelf.id === 'current') {
          setLinkSource(item.id);
        }
      } else if (shelf.id === 'future' && linkSource !== item.id) {
        const sourceItem = useProjectStore
          .getState()
          .project?.currentShelf.items.find((i) => i.id === linkSource);
        const sourceProduct = sourceItem
          ? catalogue.find((p) => p.id === sourceItem.productId)
          : null;
        addLink({
          sourceItemId: linkSource,
          targetItemId: item.id,
          volume: sourceProduct?.volume || 0,
          type: 'transfer',
        });
        setLinkSource(null);
      }
    } else {
      setSelectedItem(item.id === selectedItemId ? null : item.id);
    }
  };

  const handleAddLabel = () => {
    const text = prompt('Label text (e.g. "Good", "Better", "Best"):');
    if (!text) return;
    const itemCount = shelf.items.length;
    addLabel(shelf.id, {
      id: `label-${Date.now()}`,
      text,
      startPosition: 0,
      endPosition: Math.max(itemCount - 1, 0),
      color: '#e8e0d4',
    });
  };

  // Label dragging (reposition)
  const handleLabelDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, labelId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const label = shelf.labels.find(l => l.id === labelId);
    if (!label) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartRef.current = { x: clientX, startPos: label.startPosition, endPos: label.endPosition };
    setDraggingLabel(labelId);
  }, [shelf.labels]);

  // Label resizing
  const handleLabelResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent, labelId: string, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const label = shelf.labels.find(l => l.id === labelId);
    if (!label) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartRef.current = { x: clientX, startPos: label.startPosition, endPos: label.endPosition };
    setResizingLabel({ id: labelId, side });
  }, [shelf.labels]);

  useEffect(() => {
    if (!draggingLabel && !resizingLabel) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const dx = clientX - dragStartRef.current.x;
      const slotDelta = Math.round(dx / CARD_SLOT_WIDTH);
      const maxPos = Math.max(shelf.items.length - 1, 0);

      if (draggingLabel) {
        const newStart = Math.max(0, Math.min(dragStartRef.current.startPos + slotDelta, maxPos));
        const span = dragStartRef.current.endPos - dragStartRef.current.startPos;
        const newEnd = Math.min(newStart + span, maxPos);
        const adjustedStart = Math.max(0, newEnd - span);
        updateLabel(shelf.id, draggingLabel, { startPosition: adjustedStart, endPosition: newEnd });
      }

      if (resizingLabel) {
        if (resizingLabel.side === 'left') {
          const newStart = Math.max(0, Math.min(dragStartRef.current.startPos + slotDelta, dragStartRef.current.endPos));
          updateLabel(shelf.id, resizingLabel.id, { startPosition: newStart });
        } else {
          const newEnd = Math.max(dragStartRef.current.startPos, Math.min(dragStartRef.current.endPos + slotDelta, maxPos));
          updateLabel(shelf.id, resizingLabel.id, { endPosition: newEnd });
        }
      }
    };

    const handleUp = () => {
      setDraggingLabel(null);
      setResizingLabel(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [draggingLabel, resizingLabel, shelf.id, shelf.items.length, shelf.labels, updateLabel]);

  // Track rail width via ResizeObserver
  const [railWidth, setRailWidth] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setRailWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totalItems = shelf.items.length;
  const contentWidth = totalItems * CARD_SLOT_WIDTH;
  const offsetLeft = Math.max(0, (railWidth - contentWidth) / 2);

  // Pack labels into rows for multi-row display
  const labelRows = useMemo(() => packLabelsIntoRows(shelf.labels), [shelf.labels]);
  const LABEL_ROW_HEIGHT = 26;

  return (
    <div className={`shelf-container ${isOver ? 'shelf-over' : ''}`}>
      <div className="shelf-header">
        <h3 className="shelf-title">{shelf.name}</h3>
        <div className="shelf-actions">
          <button className="shelf-btn" onClick={onAddPlaceholder} title="Add placeholder SKU">
            + Placeholder
          </button>
          <button className="shelf-btn" onClick={handleAddLabel} title="Add section label">
            + Label
          </button>
        </div>
      </div>

      {/* Labels bar — multi-row with compaction */}
      {labelRows.length > 0 && (
        <div className="shelf-labels-bar" style={{ height: labelRows.length * LABEL_ROW_HEIGHT }}>
          {labelRows.map((row, rowIndex) =>
            row.map((label) => {
              // Left edge: align to left edge of first card in range
              const left = offsetLeft + label.startPosition * CARD_SLOT_WIDTH;
              // Width: from left edge of first card to right edge of last card
              const width = (label.endPosition - label.startPosition) * CARD_SLOT_WIDTH + CARD_WIDTH;

              return (
                <div
                  key={label.id}
                  className="shelf-label"
                  style={{
                    left: `${left}px`,
                    width: `${width}px`,
                    top: `${rowIndex * LABEL_ROW_HEIGHT}px`,
                    backgroundColor: label.color || '#e8e0d4',
                    cursor: draggingLabel === label.id ? 'grabbing' : 'grab',
                  }}
                  onMouseDown={(e) => handleLabelDragStart(e, label.id)}
                  onTouchStart={(e) => handleLabelDragStart(e, label.id)}
                >
                  <div className="label-resize-handle left"
                    onMouseDown={(e) => handleLabelResizeStart(e, label.id, 'left')}
                    onTouchStart={(e) => handleLabelResizeStart(e, label.id, 'left')}
                  />
                  {editingLabel === label.id ? (
                    <input
                      className="label-input"
                      defaultValue={label.text}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        updateLabel(shelf.id, label.id, { text: e.target.value });
                        setEditingLabel(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateLabel(shelf.id, label.id, {
                            text: (e.target as HTMLInputElement).value,
                          });
                          setEditingLabel(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="label-text" onDoubleClick={() => setEditingLabel(label.id)}>{label.text}</span>
                  )}
                  <button
                    className="label-remove"
                    onClick={(e) => { e.stopPropagation(); removeLabel(shelf.id, label.id); }}
                  >
                    ×
                  </button>
                  <div className="label-resize-handle right"
                    onMouseDown={(e) => handleLabelResizeStart(e, label.id, 'right')}
                    onTouchStart={(e) => handleLabelResizeStart(e, label.id, 'right')}
                  />
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Shelf rail with products — centered */}
      <div ref={(node) => { setNodeRef(node); (railRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }} className="shelf-rail">
        <SortableContext
          items={shelf.items.map((i) => i.id)}
          strategy={horizontalListSortingStrategy}
        >
          {shelf.items.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              product={getProduct(item)}
              isSelected={selectedItemId === item.id}
              isLinkMode={linkMode}
              isLinkSource={linkSource === item.id}
              onClick={() => handleCardClick(item)}
              onRemove={() => removeItemFromShelf(shelf.id, item.id)}
            />
          ))}
        </SortableContext>

        {shelf.items.length === 0 && (
          <div className="shelf-empty">
            Drag products here from the catalogue or the shelf above
          </div>
        )}
      </div>

      <div className="shelf-meta">
        {shelf.items.length} SKUs &middot; Total Volume:{' '}
        {shelf.items
          .reduce((sum, item) => {
            const p = getProduct(item);
            return sum + (p?.volume || 0);
          }, 0)
          .toLocaleString()}
      </div>
    </div>
  );
}
