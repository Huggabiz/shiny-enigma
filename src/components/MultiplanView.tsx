import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useProjectStore } from '../store/useProjectStore';
import { ProductCard } from './ProductCard';
import { computeShelfLayout, RAIL_PADDING, CARD_GAP } from '../utils/layout';
import { deriveLabelsFromMatrix, packLabelsIntoRows } from '../utils/shelfLabels';
import { getActivePlan, getStages } from '../types';
import type { Product, RangePlan, Shelf, ShelfItem } from '../types';
import './MultiplanView.css';

const DERIVED_LABEL_ROW_HEIGHT = 18;

/** Stable sortable id for a multiplan entry. Keeps master and a
 * variant on the same plan distinguishable. */
function entryKey(entry: { planId: string; variantId: string | null }): string {
  return `${entry.planId}:${entry.variantId ?? 'master'}`;
}

export function MultiplanView() {
  const {
    project,
    setActivePlan,
    setActiveVariant,
    setActiveView,
    setMultiplanShelfSide,
    setDesignShelfId,
    toggleMultiplanEntry,
    reorderMultiplanEntries,
    clearMultiplanEntries,
    showGhosted,
    setShowGhosted,
    exclusiveLensFilter,
    setExclusiveLensFilter,
  } = useProjectStore();

  const activeLensesForFilter = useMemo(() => {
    const ids = project?.activeLensIds ?? [];
    if (ids.length === 0) return [];
    return ids.map((id) => (project?.lenses ?? []).find((l) => l.id === id)).filter((l): l is import('../types').Lens => !!l);
  }, [project?.activeLensIds, project?.lenses]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const railWidth = useRailWidth();

  const firstPlan = project ? getActivePlan(project) : undefined;
  const stagesForToggle = useMemo(() => {
    const all = firstPlan && project ? getStages(firstPlan, project) : [];
    const vk = project?.visibleStageKeys;
    if (!vk || vk.length === 0) return all;
    const filtered = all.filter((s) => vk.includes(s.key));
    return filtered.length > 0 ? filtered : all;
  }, [firstPlan, project]);

  const multiplanView = project?.multiplanView ?? { shelfSide: 'current' as const, entries: [] };
  const shelfSide = multiplanView.shelfSide;
  const entries = multiplanView.entries;

  const resolvedRows = useMemo(() => {
    if (!project) return [];
    return entries
      .map((entry) => {
        const plan = project.plans.find((p) => p.id === entry.planId);
        if (!plan) return null;
        const variant = entry.variantId
          ? plan.variants.find((v) => v.id === entry.variantId) ?? null
          : null;
        if (entry.variantId && !variant) return null;
        let shelf: Shelf;
        if (shelfSide === 'current') {
          shelf = plan.currentShelf;
        } else if (shelfSide === 'future') {
          shelf = plan.futureShelf;
        } else {
          const stageId = shelfSide.replace('stage-', '');
          const entry = (plan.intermediateShelves ?? []).find((s) => s.stageId === stageId);
          if (!entry) return null;
          shelf = entry.shelf;
        }
        const variantIncludedKey = shelfSide === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
        const includedIds = variant ? new Set(variant[variantIncludedKey]) : null;
        let rowItems: Array<{ item: ShelfItem; ghosted: boolean }> = includedIds
          ? shelf.items
              .filter((i) => includedIds.has(i.id) || showGhosted)
              .map((i) => ({ item: i, ghosted: !includedIds.has(i.id) }))
          : shelf.items.map((i) => ({ item: i, ghosted: false }));
        if (exclusiveLensFilter && activeLensesForFilter.length > 0) {
          rowItems = rowItems.filter(({ item }) => {
            const prod = project.catalogue.find((p) => p.id === item.productId);
            if (!prod) return true;
            return activeLensesForFilter.some((lens) => {
              if (lens.builtInKind) return false;
              if (lens.scope === 'per-stage') return lens.stageProductIds?.[shelfSide]?.includes(prod.id) ?? false;
              return lens.productIds.includes(prod.id);
            });
          });
        }
        return { plan, variant, shelf, rowItems };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [entries, project, shelfSide, showGhosted, exclusiveLensFilter, activeLensesForFilter]);

  if (!project) return null;

  const handleOpenInRangeDesign = (plan: RangePlan, variantId: string | null) => {
    setActivePlan(plan.id);
    setActiveVariant(variantId);
    setDesignShelfId(shelfSide);
    setActiveView('range-design');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = entries.findIndex((e) => entryKey(e) === active.id);
    const newIdx = entries.findIndex((e) => entryKey(e) === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    reorderMultiplanEntries(arrayMove(entries, oldIdx, newIdx));
  };

  const sortableIds = useMemo(
    () => resolvedRows.map(({ plan, variant }) => entryKey({ planId: plan.id, variantId: variant?.id ?? null })),
    [resolvedRows],
  );

  return (
    <div className="multiplan-view">
      <div className="multiplan-toolbar">
        <h2 className="multiplan-title">Multiplan</h2>
        <div className="multiplan-shelf-toggle" role="tablist">
          {stagesForToggle.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={shelfSide === s.key}
              className={shelfSide === s.key ? 'active' : ''}
              onClick={() => setMultiplanShelfSide(s.key)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="multiplan-toolbar-actions">
          {activeLensesForFilter.length > 0 && (
            <label className="multiplan-show-excluded" title="Show only products in the active lens">
              <input type="checkbox" checked={exclusiveLensFilter} onChange={(e) => setExclusiveLensFilter(e.target.checked)} />
              Lens only
            </label>
          )}
          <label className="multiplan-show-excluded" title="Show items excluded from variants as ghost cards (global toggle — also affects the range view)">
            <input
              type="checkbox"
              checked={showGhosted}
              onChange={(e) => setShowGhosted(e.target.checked)}
            />
            Show excluded
          </label>
          <span className="multiplan-toolbar-meta">
            {resolvedRows.length} row{resolvedRows.length === 1 ? '' : 's'}
          </span>
          {entries.length > 0 && (
            <button className="multiplan-clear" onClick={() => {
              if (confirm('Clear all selected plans from multiplan view?')) clearMultiplanEntries();
            }}>Clear</button>
          )}
        </div>
      </div>

      {resolvedRows.length === 0 ? (
        <div className="multiplan-empty">
          <h3>No plans selected</h3>
          <p>
            Tick the checkboxes in the <strong>Range Plans</strong> sidebar
            on the left to add a plan's master or a variant to this view.
            Each selection becomes a stacked row below.
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className="multiplan-rows">
              {resolvedRows.map(({ plan, variant, shelf, rowItems }, rowIdx) => (
                <MultiplanRow
                  key={entryKey({ planId: plan.id, variantId: variant?.id ?? null })}
                  sortId={entryKey({ planId: plan.id, variantId: variant?.id ?? null })}
                  plan={plan}
                  variant={variant}
                  shelf={shelf}
                  rowItems={rowItems}
                  catalogue={project.catalogue}
                  stageKey={shelfSide}
                  railWidth={railWidth.width}
                  firstRow={rowIdx === 0}
                  onRailRef={rowIdx === 0 ? railWidth.attachRef : undefined}
                  onRemove={() => toggleMultiplanEntry(plan.id, variant?.id ?? null)}
                  onDoubleClick={() => handleOpenInRangeDesign(plan, variant?.id ?? null)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function useRailWidth() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const attachRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    const obs = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    obs.observe(el);
    observerRef.current = obs;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return { width, attachRef };
}

interface MultiplanRowItem {
  item: ShelfItem;
  ghosted: boolean;
}

interface MultiplanRowProps {
  sortId: string;
  plan: RangePlan;
  variant: { id: string; name: string } | null;
  shelf: Shelf;
  rowItems: MultiplanRowItem[];
  catalogue: Product[];
  stageKey: string;
  railWidth: number;
  firstRow: boolean;
  onRailRef?: (el: HTMLDivElement | null) => void;
  onRemove: () => void;
  onDoubleClick: () => void;
}

function MultiplanRow({
  sortId,
  plan,
  variant,
  shelf,
  rowItems,
  catalogue,
  stageKey,
  railWidth,
  firstRow,
  onRailRef,
  onRemove,
  onDoubleClick,
}: MultiplanRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortId });

  const rowStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  const layout = useMemo(
    () => computeShelfLayout(rowItems.length, railWidth),
    [rowItems.length, railWidth],
  );
  const MULTIPLAN_MIN_CARD = 60;
  const cardWidth = Math.max(MULTIPLAN_MIN_CARD, layout.cardWidth);
  const slotWidth = cardWidth + CARD_GAP;
  const offsetLeft = RAIL_PADDING;

  const visibleItemIds = useMemo(() => rowItems.map((r) => r.item.id), [rowItems]);
  const { xLabels, yLabels } = useMemo(
    () => deriveLabelsFromMatrix(shelf, visibleItemIds),
    [shelf, visibleItemIds],
  );
  const xLabelRows = useMemo(() => packLabelsIntoRows(xLabels), [xLabels]);
  const yLabelRows = useMemo(() => packLabelsIntoRows(yLabels), [yLabels]);
  const isWrapping = cardWidth > layout.cardWidth;
  const hasMatrixLabels = !isWrapping && (xLabelRows.length > 0 || yLabelRows.length > 0);
  const nonGhostedCount = useMemo(() => rowItems.filter((r) => !r.ghosted).length, [rowItems]);

  return (
    <div
      ref={setNodeRef}
      className={`multiplan-row ${isDragging ? 'dragging' : ''}`}
      style={rowStyle}
      onDoubleClick={onDoubleClick}
      title="Drag the label column to reorder — double-click to open in Range view"
    >
      <div
        className="multiplan-row-label"
        {...attributes}
        {...listeners}
      >
        <div className="multiplan-row-drag-hint" aria-hidden>⋮⋮</div>
        <div className="multiplan-row-plan-name" title={plan.name}>{plan.name}</div>
        <div className="multiplan-row-variant-name">
          {variant ? variant.name : 'Master'}
        </div>
        <div className="multiplan-row-count">{nonGhostedCount} SKUs</div>
        <button
          className="multiplan-row-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Remove from multiplan view"
        >×</button>
      </div>
      <div
        className="multiplan-row-rail"
        ref={firstRow ? onRailRef : undefined}
      >
        {rowItems.length === 0 ? (
          <div className="multiplan-row-empty">No products on this shelf</div>
        ) : (
          <>
            {hasMatrixLabels && (
              <div className="multiplan-row-derived-labels shelf-derived-labels">
                {xLabelRows.map((row, rowIndex) => (
                  <div key={`x-${rowIndex}`} className="shelf-label-row" style={{ height: DERIVED_LABEL_ROW_HEIGHT }}>
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
                {yLabelRows.map((row, rowIndex) => (
                  <div key={`y-${rowIndex}`} className="shelf-label-row" style={{ height: DERIVED_LABEL_ROW_HEIGHT }}>
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
            <div className="multiplan-row-cards" style={{ paddingLeft: offsetLeft }}>
              {rowItems.map(({ item, ghosted }, idx) => {
                const product = item.isPlaceholder
                  ? undefined
                  : catalogue.find((p) => p.id === item.productId);
                return (
                  <div
                    key={item.id}
                    className="multiplan-card-slot"
                    style={{ width: cardWidth, marginRight: idx === rowItems.length - 1 ? 0 : slotWidth - cardWidth }}
                  >
                    <ProductCard
                      item={item}
                      product={product}
                      overlay
                      cardWidth={cardWidth}
                      isGhosted={ghosted}
                      stageKey={stageKey}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
