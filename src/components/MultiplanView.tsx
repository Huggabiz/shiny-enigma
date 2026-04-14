import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { ProductCard } from './ProductCard';
import { computeShelfLayout } from '../utils/layout';
import type { Product, RangePlan, Shelf, ShelfItem } from '../types';
import './MultiplanView.css';

/**
 * MultiplanView — stacked horizontal strips, one per selected
 * (plan, variant|master) pair. Read-only: click is selection only,
 * double-click jumps into that plan's transform view with the right
 * variant active.
 *
 * Selection happens via checkboxes in the PlanTree sidebar (shown
 * only when this view is active). The global Current/Future toggle
 * lives in the toolbar above the rows.
 *
 * Card sizing reuses computeShelfLayout so each row's cards shrink to
 * fit the available rail width — exactly like the transform-view
 * shelves. Lens tinting uses the existing .product-card.lens-* classes
 * once wired there (out of scope for this ship).
 */
export function MultiplanView() {
  const {
    project,
    setActivePlan,
    setActiveVariant,
    setActiveView,
    setMultiplanShelfSide,
    toggleMultiplanEntry,
    clearMultiplanEntries,
  } = useProjectStore();

  // Container width for computeShelfLayout — the multiplan rows share
  // the same flex column so one width serves every row. Measured via
  // a ref set on the first row's cards area (simpler than a dedicated
  // ResizeObserver since every row has the same width).
  const railWidth = useRailWidth();

  const multiplanView = project?.multiplanView ?? { shelfSide: 'current' as const, entries: [] };
  const shelfSide = multiplanView.shelfSide;
  const entries = multiplanView.entries;

  // Resolve each entry to a concrete (plan, variant|null, visibleItems)
  // tuple. Entries that reference a deleted plan/variant are filtered
  // out silently so stale state doesn't crash the render. The early
  // null-project case falls through as an empty list so the hook
  // order stays stable regardless of load state.
  const resolvedRows = useMemo(() => {
    if (!project) return [];
    return entries
      .map((entry) => {
        const plan = project.plans.find((p) => p.id === entry.planId);
        if (!plan) return null;
        const variant = entry.variantId
          ? plan.variants.find((v) => v.id === entry.variantId) ?? null
          : null;
        // Entry's variantId was non-null but the variant is gone →
        // drop the row instead of silently falling back to master.
        if (entry.variantId && !variant) return null;
        const shelf: Shelf = shelfSide === 'current' ? plan.currentShelf : plan.futureShelf;
        const variantIncludedKey = shelfSide === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
        const includedIds = variant ? new Set(variant[variantIncludedKey]) : null;
        const visibleItems: ShelfItem[] = includedIds
          ? shelf.items.filter((i) => includedIds.has(i.id))
          : shelf.items;
        return { plan, variant, shelf, visibleItems };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [entries, project, shelfSide]);

  if (!project) return null;

  const handleOpenInTransform = (plan: RangePlan, variantId: string | null) => {
    setActivePlan(plan.id);
    setActiveVariant(variantId);
    setActiveView('transform');
  };

  return (
    <div className="multiplan-view">
      <div className="multiplan-toolbar">
        <h2 className="multiplan-title">Multiplan</h2>
        <div className="multiplan-shelf-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={shelfSide === 'current'}
            className={shelfSide === 'current' ? 'active' : ''}
            onClick={() => setMultiplanShelfSide('current')}
          >
            Current
          </button>
          <button
            role="tab"
            aria-selected={shelfSide === 'future'}
            className={shelfSide === 'future' ? 'active' : ''}
            onClick={() => setMultiplanShelfSide('future')}
          >
            Future
          </button>
        </div>
        <div className="multiplan-toolbar-actions">
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
        <div className="multiplan-rows">
          {resolvedRows.map(({ plan, variant, shelf, visibleItems }, rowIdx) => (
            <MultiplanRow
              key={`${plan.id}:${variant?.id ?? 'master'}`}
              plan={plan}
              variant={variant}
              shelf={shelf}
              visibleItems={visibleItems}
              catalogue={project.catalogue}
              railWidth={railWidth.width}
              firstRow={rowIdx === 0}
              onRailRef={rowIdx === 0 ? railWidth.attachRef : undefined}
              onRemove={() => toggleMultiplanEntry(plan.id, variant?.id ?? null)}
              onDoubleClick={() => handleOpenInTransform(plan, variant?.id ?? null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Hook: measures the container width of the first multiplan row so
 * computeShelfLayout can size cards. All rows share one width — only
 * one ResizeObserver needed. The callback ref is stabilised with
 * useCallback so React doesn't tear down the observer on every render.
 */
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

interface MultiplanRowProps {
  plan: RangePlan;
  variant: { id: string; name: string } | null;
  /** The shelf is resolved upstream (current vs future) and only the
   * visible items list is actually consumed inside the row — the
   * shelf object itself is kept in the prop signature so future
   * features (labels, sankey hints) have it to hand without a
   * breaking refactor. */
  shelf: Shelf;
  visibleItems: ShelfItem[];
  catalogue: Product[];
  railWidth: number;
  firstRow: boolean;
  onRailRef?: (el: HTMLDivElement | null) => void;
  onRemove: () => void;
  onDoubleClick: () => void;
}

function MultiplanRow({
  plan,
  variant,
  visibleItems,
  catalogue,
  railWidth,
  firstRow,
  onRailRef,
  onRemove,
  onDoubleClick,
}: MultiplanRowProps) {
  const layout = useMemo(
    () => computeShelfLayout(visibleItems.length, railWidth),
    [visibleItems.length, railWidth],
  );
  const { cardWidth, slotWidth, offsetLeft } = layout;

  return (
    <div className="multiplan-row" onDoubleClick={onDoubleClick} title="Double-click to open in Transform view">
      <div className="multiplan-row-label">
        <div className="multiplan-row-plan-name" title={plan.name}>{plan.name}</div>
        <div className="multiplan-row-variant-name">
          {variant ? variant.name : 'Master'}
        </div>
        <div className="multiplan-row-count">{visibleItems.length} SKUs</div>
        <button
          className="multiplan-row-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from multiplan view"
        >×</button>
      </div>
      <div
        className="multiplan-row-rail"
        ref={firstRow ? onRailRef : undefined}
      >
        {visibleItems.length === 0 ? (
          <div className="multiplan-row-empty">No products on this shelf</div>
        ) : (
          <div className="multiplan-row-cards" style={{ paddingLeft: offsetLeft }}>
            {visibleItems.map((item, idx) => {
              const product = item.isPlaceholder
                ? undefined
                : catalogue.find((p) => p.id === item.productId);
              return (
                <div
                  key={item.id}
                  className="multiplan-card-slot"
                  style={{ width: cardWidth, marginRight: idx === visibleItems.length - 1 ? 0 : slotWidth - cardWidth }}
                >
                  <ProductCard
                    item={item}
                    product={product}
                    overlay
                    cardWidth={cardWidth}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
