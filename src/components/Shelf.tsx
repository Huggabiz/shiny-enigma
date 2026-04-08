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
  discontinuedItems?: ShelfItem[];
  showDiscontinued?: boolean;
}

interface DerivedLabel {
  text: string;
  startPosition: number;
  endPosition: number;
  color: string;
  level: 'x' | 'y';
}

// Pack labels into rows, compacting non-overlapping onto same row
function packLabelsIntoRows(labels: DerivedLabel[]): DerivedLabel[][] {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.startPosition - b.startPosition);
  const rows: DerivedLabel[][] = [];
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

// Derive labels from matrix layout based on VISIBLE item order
function deriveLabelsFromMatrix(
  shelf: ShelfType,
  visibleItemIds: string[],
): { xLabels: DerivedLabel[]; yLabels: DerivedLabel[] } {
  const layout = shelf.matrixLayout;
  if (!layout || layout.assignments.length === 0) return { xLabels: [], yLabels: [] };

  const xLabels: DerivedLabel[] = [];
  const yLabels: DerivedLabel[] = [];

  // Build a map of itemId -> position in the VISIBLE items list
  const posMap = new Map(visibleItemIds.map((id, idx) => [id, idx]));

  // Only consider assignments for visible items
  const visibleAssignments = layout.assignments.filter((a) => posMap.has(a.itemId));

  for (let col = 0; col < layout.xLabels.length; col++) {
    const positions = visibleAssignments
      .filter((a) => a.col === col)
      .map((a) => posMap.get(a.itemId))
      .filter((p): p is number => p !== undefined);
    if (positions.length === 0) continue;
    xLabels.push({
      text: layout.xLabels[col],
      startPosition: Math.min(...positions),
      endPosition: Math.max(...positions),
      color: '#dce6f0',
      level: 'x',
    });
  }

  for (let col = 0; col < layout.xLabels.length; col++) {
    for (let row = 0; row < layout.yLabels.length; row++) {
      const positions = visibleAssignments
        .filter((a) => a.col === col && a.row === row)
        .map((a) => posMap.get(a.itemId))
        .filter((p): p is number => p !== undefined);
      if (positions.length === 0) continue;
      yLabels.push({
        text: layout.yLabels[row],
        startPosition: Math.min(...positions),
        endPosition: Math.max(...positions),
        color: '#f0e6d6',
        level: 'y',
      });
    }
  }

  return { xLabels, yLabels };
}

export function Shelf({ shelf, catalogue, onAddPlaceholder, onRailWidthChange, onDoubleClickItem, onViewDesign, variantIncludedIds, showGhosted: showGhostedProp, discontinuedItems, showDiscontinued }: ShelfProps) {
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

  // Track rail width
  const [railWidth, setRailWidth] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
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

  // Layout based on visible regular items only — used for card sizing, labels, and sankey
  const layout = useMemo(
    () => computeShelfLayout(visibleRegularItems.length, railWidth),
    [visibleRegularItems.length, railWidth]
  );
  const { cardWidth, slotWidth, offsetLeft } = layout;

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
  const LABEL_ROW_HEIGHT = 22;

  return (
    <div className={`shelf-container ${isOver ? 'shelf-over' : ''}`}>
      <div className="shelf-header">
        <h3 className="shelf-title">{shelf.name}</h3>
        <div className="shelf-actions">
          <button className="shelf-btn" onClick={onAddPlaceholder} title="Add placeholder SKU">
            + Placeholder
          </button>
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
        style={{ justifyContent: 'flex-start', paddingLeft: `${offsetLeft}px` }}
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
                onClick={() => handleCardClick(item)}
                onDoubleClick={() => {
                  if (shelf.id === 'current' && onDoubleClickItem) onDoubleClickItem(item.id);
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
      </div>

      <div className="shelf-meta">
        {shelf.items.length} SKUs &middot; Total Volume:{' '}
        {shelf.items.reduce((sum, item) => sum + (getProduct(item)?.volume || 0), 0).toLocaleString()}
      </div>
    </div>
  );
}
