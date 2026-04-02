import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ProductCard } from './ProductCard';
import type { Product, Shelf as ShelfType, ShelfItem } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useState } from 'react';
import './Shelf.css';

interface ShelfProps {
  shelf: ShelfType;
  catalogue: Product[];
  onAddPlaceholder: () => void;
  onAddLabel: () => void;
}

export function Shelf({ shelf, catalogue, onAddPlaceholder, onAddLabel }: ShelfProps) {
  const {
    selectedItemId,
    setSelectedItem,
    removeItemFromShelf,
    linkMode,
    linkSource,
    setLinkSource,
    addLink,
  } = useProjectStore();

  const { setNodeRef, isOver } = useDroppable({ id: `shelf-${shelf.id}` });
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const { updateLabel, removeLabel } = useProjectStore();

  const getProduct = (item: ShelfItem): Product | undefined =>
    catalogue.find((p) => p.id === item.productId);

  const handleCardClick = (item: ShelfItem) => {
    if (linkMode) {
      if (!linkSource) {
        // Set as source (must be from current shelf)
        if (shelf.id === 'current') {
          setLinkSource(item.id);
        }
      } else if (shelf.id === 'future' && linkSource !== item.id) {
        // Complete the link
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

  return (
    <div className={`shelf-container ${isOver ? 'shelf-over' : ''}`}>
      <div className="shelf-header">
        <h3 className="shelf-title">{shelf.name}</h3>
        <div className="shelf-actions">
          <button className="shelf-btn" onClick={onAddPlaceholder} title="Add placeholder SKU">
            + Placeholder
          </button>
          <button className="shelf-btn" onClick={onAddLabel} title="Add section label">
            + Label
          </button>
        </div>
      </div>

      {/* Labels */}
      {shelf.labels.length > 0 && (
        <div className="shelf-labels">
          {shelf.labels.map((label) => (
            <div
              key={label.id}
              className="shelf-label"
              style={{
                left: `${label.startPosition * 115}px`,
                width: `${(label.endPosition - label.startPosition + 1) * 115 - 15}px`,
                backgroundColor: label.color || '#e8e0d4',
              }}
            >
              {editingLabel === label.id ? (
                <input
                  className="label-input"
                  defaultValue={label.text}
                  autoFocus
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
                <span onDoubleClick={() => setEditingLabel(label.id)}>{label.text}</span>
              )}
              <button
                className="label-remove"
                onClick={() => removeLabel(shelf.id, label.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Shelf rail with products */}
      <div ref={setNodeRef} className="shelf-rail">
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
            Drag products here from the catalogue, or drop between shelves to reorder
          </div>
        )}
      </div>

      {/* The shelf surface */}
      <div className="shelf-surface" />

      <div className="shelf-meta">
        {shelf.items.length} SKUs • Total Volume:{' '}
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
