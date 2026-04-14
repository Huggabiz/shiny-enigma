import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ProductCard } from './ProductCard';
import type { Product, Shelf as ShelfType, ShelfItem } from '../types';
import { getActivePlan } from '../types';
import { useProjectStore } from '../store/useProjectStore';
import { useState, useRef, useEffect, useMemo } from 'react';
import { computeShelfLayout } from '../utils/layout';
import { deriveLabelsFromMatrix, packLabelsIntoRows } from '../utils/shelfLabels';
import './Shelf.css';

interface ShelfProps {
  shelf: ShelfType;
  catalogue: Product[];
  onAddPlaceholder: () => void;
  onRailWidthChange?: (width: number) => void;
  onDoubleClickItem?: (itemId: string) => void;
  onViewDesign?: () => void;
  variantIncludedIds?: Set<string> | null;
  showGhosted?: boolean;
  editableFuturePricing?: boolean;
  discontinuedItems?: ShelfItem[];
  showDiscontinued?: boolean;
  flipped?: boolean;
}

export function Shelf({ shelf, catalogue, onAddPlaceholder, onRailWidthChange, onDoubleClickItem, onViewDesign, variantIncludedIds, showGhosted: showGhostedProp, editableFuturePricing, discontinuedItems, showDiscontinued, flipped }: ShelfProps) {
  const {
    selectedItemId,
    setSelectedItem,
    removeItemFromShelf,
    linkMode,
    linkSource,
    setLinkSource,
    addLink,
    removeLink,
  } = useProjectStore();

  const { setNodeRef, isOver } = useDroppable({ id: `shelf-${shelf.id}` });
  const railRef = useRef<HTMLDivElement>(null);

  const getProduct = (item: ShelfItem): Product | undefined =>
    catalogue.find((p) => p.id === item.productId);

  const handleCardClick = (item: ShelfItem) => {
    if (linkMode) {
      if (shelf.id === 'current') {
        setLinkSource(item.id);
      } else if (shelf.id === 'future' && linkSource) {
        const plan = useProjectStore.getState().project ? getActivePlan(useProjectStore.getState().project!) : undefined;
        const existingLinks = plan?.sankeyLinks.filter(
          (l: { sourceItemId: string }) => l.sourceItemId === linkSource
        ) || [];
        const existingLink = existingLinks.find((l: { targetItemId: string }) => l.targetItemId === item.id);
        if (existingLink) {
          removeLink(linkSource, item.id);
        } else {
          const sourceItem = plan?.currentShelf.items.find((i: { id: string }) => i.id === linkSource);
          const sourceProduct = sourceItem ? catalogue.find((p) => p.id === sourceItem.productId) : null;
          const usedPercent = existingLinks.reduce((sum, l) => sum + (l.percent ?? 100), 0);
          const remaining = Math.max(0, 100 - usedPercent);
          const sourceVolume = sourceProduct?.volume || 0;
          addLink({
            sourceItemId: linkSource,
            targetItemId: item.id,
            percent: remaining,
            volume: Math.round(sourceVolume * remaining / 100),
            type: 'transfer',
          });
        }
        setLinkSource(linkSource); // stay on same source
      }
    } else {
      setSelectedItem(item.id === selectedItemId ? null : item.id);
    }
  };

  // Track rail width using the border box so the inline paddingLeft we apply
  // below does not feed back into the measured width (which would left-shift
  // the cards). borderBoxSize is stable under padding changes.
  const [railWidth, setRailWidth] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.borderBoxSize?.[0]?.inlineSize ?? el.offsetWidth;
      setRailWidth(w);
      onRailWidthChange?.(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onRailWidthChange]);

  // Compute visible regular items (excluding discontinued)
  const visibleRegularItems = useMemo(() =>
    shelf.items.filter((item) => {
      if (!variantIncludedIds) return true;
      return variantIncludedIds.has(item.id) || showGhostedProp;
    }),
    [shelf.items, variantIncludedIds, showGhostedProp]
  );

  // Total visible items including discontinued (for card sizing)
  const discCount = (showDiscontinued && discontinuedItems?.length) || 0;
  const totalVisibleCount = visibleRegularItems.length + (discCount > 0 ? discCount + 1 : 0); // +1 for separator

  // Layout based on ALL visible items — used for card sizing
  const fullLayout = useMemo(
    () => computeShelfLayout(totalVisibleCount, railWidth),
    [totalVisibleCount, railWidth]
  );

  const { cardWidth, slotWidth, offsetLeft } = fullLayout;

  // Compute visible item IDs for label derivation (respects variant filter)
  const visibleItemIds = useMemo(() => {
    return shelf.items
      .filter((item) => {
        if (!variantIncludedIds) return true;
        return variantIncludedIds.has(item.id) || showGhostedProp;
      })
      .map((item) => item.id);
  }, [shelf.items, variantIncludedIds, showGhostedProp]);

  // Derive labels from matrix layout based on visible items
  const { xLabels: derivedXLabels, yLabels: derivedYLabels } = useMemo(
    () => deriveLabelsFromMatrix(shelf, visibleItemIds),
    [shelf, visibleItemIds]
  );

  const hasMatrixLabels = derivedXLabels.length > 0 || derivedYLabels.length > 0;

  // Pack X labels (top row) and Y labels (second row)
  const xLabelRows = useMemo(() => packLabelsIntoRows(derivedXLabels), [derivedXLabels]);
  const yLabelRows = useMemo(() => packLabelsIntoRows(derivedYLabels), [derivedYLabels]);
  const slideBaseScale = useProjectStore((s) => s.slideBaseScale);
  const LABEL_ROW_HEIGHT = Math.round(18 * slideBaseScale);

  return (
    <div className={`shelf-container ${isOver ? 'shelf-over' : ''} ${flipped ? 'flipped' : ''}`}>
      <div className="shelf-header">
        <h3 className="shelf-title">{shelf.name}</h3>
        <div className="shelf-actions">
          {onViewDesign && (
            <button className="shelf-btn view-range-btn" onClick={onViewDesign} title="View in Range matrix">
              View Range
            </button>
          )}
        </div>
      </div>

      {/* Matrix-derived labels */}
      {hasMatrixLabels && (
        <div className="shelf-derived-labels">
          {/* X labels (primary — blue) */}
          {xLabelRows.map((row, rowIndex) => (
            <div key={`x-${rowIndex}`} className="shelf-label-row" style={{ height: LABEL_ROW_HEIGHT }}>
              {row.map((label, i) => {
                const left = offsetLeft + label.startPosition * slotWidth;
                const width = (label.endPosition - label.startPosition) * slotWidth + cardWidth;
                return (
                  <div key={i} className="shelf-derived-label x-label" style={{ left, width, backgroundColor: label.color }}>
                    {label.text}
                  </div>
                );
              })}
            </div>
          ))}
          {/* Y labels (secondary — tan) */}
          {yLabelRows.map((row, rowIndex) => (
            <div key={`y-${rowIndex}`} className="shelf-label-row" style={{ height: LABEL_ROW_HEIGHT }}>
              {row.map((label, i) => {
                const left = offsetLeft + label.startPosition * slotWidth;
                const width = (label.endPosition - label.startPosition) * slotWidth + cardWidth;
                return (
                  <div key={i} className="shelf-derived-label y-label" style={{ left, width, backgroundColor: label.color }}>
                    {label.text}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Shelf rail */}
      <div
        ref={(node) => { setNodeRef(node); (railRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
        className="shelf-rail"
        style={{
          justifyContent: 'flex-start',
          paddingLeft: totalVisibleCount === 0 ? '0px' : `${offsetLeft}px`,
          // Consumed by .shelf-rail:hover .shelf-discontinued-separator to
          // squeeze open a gap for the add-placeholder tile when the user
          // hovers a shelf that already has discontinued ghost cards.
          ['--add-gap' as string]: `${cardWidth + 6}px`,
        }}
      >
        <SortableContext items={shelf.items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
          {shelf.items
            .filter((item) => {
              if (!variantIncludedIds) return true; // Master: show all
              if (variantIncludedIds.has(item.id)) return true; // Included in variant
              return showGhostedProp; // Ghosted toggle
            })
            .map((item) => {
            const isSourceSelected = !!(linkMode && linkSource);
            const isDimmed = isSourceSelected && shelf.id === 'current' && item.id !== linkSource;
            const isLinkHighlight = isSourceSelected && item.id === linkSource;
            const isGhosted = variantIncludedIds ? !variantIncludedIds.has(item.id) : false;

            return (
              <ProductCard
                key={item.id}
                item={item}
                product={getProduct(item)}
                isSelected={selectedItemId === item.id}
                isLinkMode={linkMode}
                isLinkSource={linkSource === item.id}
                isDimmed={isDimmed}
                isGhosted={isGhosted}
                isLinkHighlight={isLinkHighlight}
                editableFuturePricing={editableFuturePricing}
                onClick={() => handleCardClick(item)}
                onDoubleClick={() => {
                  if (onDoubleClickItem) onDoubleClickItem(item.id);
                }}
                onRemove={() => removeItemFromShelf(shelf.id, item.id)}
                cardWidth={cardWidth}
              />
            );
          })}
        </SortableContext>

        {/* Discontinued ghost cards */}
        {showDiscontinued && discontinuedItems && discontinuedItems.length > 0 && (
          <>
            {discontinuedItems.length > 0 && <div className="shelf-discontinued-separator" />}
            {discontinuedItems.map((item) => (
              <ProductCard
                key={`disc-${item.id}`}
                item={item}
                product={getProduct(item)}
                isDiscontinued={true}
                cardWidth={cardWidth}
              />
            ))}
          </>
        )}

        {shelf.items.length === 0 && !discontinuedItems?.length && (
          <div className="shelf-empty">
            Drag products here from the catalogue or use Design view
          </div>
        )}

        {/* Hover-only add-placeholder tile. Absolutely positioned after the
            last visible card so it doesn't push the existing cards off their
            centred position in the rail. */}
        {visibleRegularItems.length > 0 && (
          <button
            type="button"
            className="shelf-add-placeholder"
            onClick={(e) => { e.stopPropagation(); onAddPlaceholder(); }}
            style={{
              left: offsetLeft + visibleRegularItems.length * slotWidth,
              width: cardWidth,
              height: cardWidth < 75 ? 92 : 112,
            }}
            title="Add placeholder SKU"
          >
            <span>+</span>
          </button>
        )}
      </div>
    </div>
  );
}
