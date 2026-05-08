import { useState, useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useProjectStore } from '../store/useProjectStore';
import type { Product } from '../types';
import './Catalogue.css';

interface CatalogueProps {
  products: Product[];
  onImport: () => void;
  currentProductIds: Set<string>;
  futureProductIds: Set<string>;
  otherCurrentIds?: Set<string>;
  otherFutureIds?: Set<string>;
  isDropTarget?: boolean;
  dropZoneId?: string;
  /** When set the catalogue shows the "Hide Used" toggle, scoped to this shelf. */
  designShelfId?: string;
}

function UsageBadges({ productId, currentProductIds, futureProductIds, otherCurrentIds, otherFutureIds }: {
  productId: string;
  currentProductIds: Set<string>;
  futureProductIds: Set<string>;
  otherCurrentIds?: Set<string>;
  otherFutureIds?: Set<string>;
}) {
  const inCurrent = currentProductIds.has(productId);
  const inFuture = futureProductIds.has(productId);
  const inOtherCurrent = otherCurrentIds?.has(productId);
  const inOtherFuture = otherFutureIds?.has(productId);
  // Simplified: "Used" if the product is in ANY stage of this plan;
  // dotted-outline "Used" if it's in a different plan only.
  const inThisPlan = inCurrent || inFuture;
  const inOtherPlan = !inThisPlan && (inOtherCurrent || inOtherFuture);
  if (!inThisPlan && !inOtherPlan) return null;

  return (
    <div className="catalogue-usage-badges">
      {inThisPlan && <span className="usage-badge used" title="Used in this range plan">Used</span>}
      {inOtherPlan && <span className="usage-badge used other" title="Used in another range plan">Used</span>}
    </div>
  );
}

function CatalogueItem({ product, expanded, currentProductIds, futureProductIds, otherCurrentIds, otherFutureIds }: {
  product: Product;
  expanded: boolean;
  currentProductIds: Set<string>;
  futureProductIds: Set<string>;
  otherCurrentIds?: Set<string>;
  otherFutureIds?: Set<string>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `catalogue-${product.id}`,
    data: { product, type: 'catalogue-item' },
  });

  const inCurrent = currentProductIds.has(product.id);
  const inFuture = futureProductIds.has(product.id);
  const usedClass = (inCurrent || inFuture) ? 'used' : '';
  const devClass = product.source === 'dev' ? 'dev' : '';

  if (expanded) {
    return (
      <div
        ref={setNodeRef}
        className={`catalogue-item-expanded ${isDragging ? 'dragging' : ''} ${usedClass} ${devClass}`}
        {...attributes}
        {...listeners}
      >
        <UsageBadges productId={product.id} currentProductIds={currentProductIds} futureProductIds={futureProductIds} otherCurrentIds={otherCurrentIds} otherFutureIds={otherFutureIds} />
        <div className="catalogue-item-image-large">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} />
          ) : (
            <div className="catalogue-item-placeholder-large">{product.name.charAt(0)}</div>
          )}
        </div>
        <div className="catalogue-item-info-expanded">
          <div className="catalogue-item-name-expanded">{product.name}</div>
          <div className="catalogue-item-sku-expanded">{product.sku}</div>
          <div className="catalogue-item-details">
            <span>Vol: {product.volume.toLocaleString()}</span>
            {product.rrp > 0 && <span>RRP: {product.rrp}</span>}
          </div>
          {product.productFamily && (
            <div className="catalogue-item-family">{product.productFamily}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`catalogue-item ${isDragging ? 'dragging' : ''} ${usedClass} ${devClass}`}
      {...attributes}
      {...listeners}
    >
      <UsageBadges productId={product.id} currentProductIds={currentProductIds} futureProductIds={futureProductIds} otherCurrentIds={otherCurrentIds} otherFutureIds={otherFutureIds} />
      <div className="catalogue-item-image">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} />
        ) : (
          <div className="catalogue-item-placeholder">{product.name.charAt(0)}</div>
        )}
      </div>
      <div className="catalogue-item-info">
        <div className="catalogue-item-name" title={product.name}>
          {product.name}
        </div>
        <div className="catalogue-item-meta">
          <span>{product.sku}</span>
          <span>Vol: {product.volume.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

interface GroupedProducts {
  category: string;
  subCategories: {
    subCategory: string;
    products: Product[];
  }[];
}

function groupByCategory(products: Product[]): GroupedProducts[] {
  const catMap = new Map<string, Map<string, Product[]>>();
  for (const p of products) {
    const cat = p.category || 'Uncategorised';
    const sub = p.subCategory || 'General';
    if (!catMap.has(cat)) catMap.set(cat, new Map());
    const subMap = catMap.get(cat)!;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(p);
  }
  return Array.from(catMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, subMap]) => ({
      category,
      subCategories: Array.from(subMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subCategory, products]) => ({ subCategory, products })),
    }));
}

export function Catalogue({ products, onImport, currentProductIds, futureProductIds, otherCurrentIds, otherFutureIds, isDropTarget, dropZoneId, designShelfId }: CatalogueProps) {
  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({ id: dropZoneId || 'catalogue-drop-zone' });
  const { catalogueFilters, setCatalogueFilters } = useProjectStore();
  const search = catalogueFilters.search;
  const categoryFilter = catalogueFilters.category;
  const subCategoryFilter = catalogueFilters.subCategory;
  const familyFilter = catalogueFilters.family;
  const { showLive, showDev, showCore, showDuo, hideUsed } = catalogueFilters;
  const setSearch = (v: string) => setCatalogueFilters({ search: v });
  // Changing category clears sub-category + family. Changing sub-category
  // clears family. Keeps downstream filters consistent with the cascade.
  const setCategoryFilter = (v: string) => setCatalogueFilters({ category: v, subCategory: '', family: '' });
  const setSubCategoryFilter = (v: string) => setCatalogueFilters({ subCategory: v, family: '' });
  const setFamilyFilter = (v: string) => setCatalogueFilters({ family: v });
  const [viewMode, setViewMode] = useState<'collapsed' | 'normal' | 'expanded'>('normal');

  const cycleViewMode = () => {
    setViewMode((m) => m === 'collapsed' ? 'normal' : m === 'normal' ? 'expanded' : 'collapsed');
  };
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedSubCats, setCollapsedSubCats] = useState<Set<string>>(new Set());

  const categories = useMemo(
    () => [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))].sort(),
    [products]
  );

  // Sub-categories filtered by selected category
  const subCategories = useMemo(() => {
    const source = categoryFilter
      ? products.filter((p) => (p.category || '').trim() === categoryFilter)
      : products;
    return [...new Set(source.map((p) => (p.subCategory || '').trim()).filter(Boolean))].sort();
  }, [products, categoryFilter]);

  // Families cascade off the currently-selected category + sub-category so
  // users don't see Product Family options that would yield zero results
  // under the other filters they already picked.
  const families = useMemo(() => {
    const source = products.filter((p) => {
      if (categoryFilter && (p.category || '').trim() !== categoryFilter) return false;
      if (subCategoryFilter && (p.subCategory || '').trim() !== subCategoryFilter) return false;
      return true;
    });
    return [...new Set(source.map((p) => (p.productFamily || '').trim()).filter(Boolean))].sort();
  }, [products, categoryFilter, subCategoryFilter]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        !search ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase());
      // Trim both sides of the equality so old projects with untrimmed
      // imports still behave as if they were loaded through the cleaned
      // importer — no mysterious "no match" after picking a dropdown value.
      const matchesCategory = !categoryFilter || (p.category || '').trim() === categoryFilter;
      const matchesSubCategory = !subCategoryFilter || (p.subCategory || '').trim() === subCategoryFilter;
      const matchesFamily = !familyFilter || (p.productFamily || '').trim() === familyFilter;
      // Live/Dev filter: anything without an explicit 'dev' source counts as live.
      const isDev = p.source === 'dev';
      const matchesSource = isDev ? showDev : showLive;
      // SAP Collection filter (Core / Duo). Products without a collection
      // tag stay visible regardless of the toggle state.
      let matchesCollection: boolean;
      if (p.sapCollection === 'Core') matchesCollection = showCore;
      else if (p.sapCollection === 'Duo') matchesCollection = showDuo;
      else matchesCollection = true;
      // Hide Used: only applies in range-design view (designShelfId set),
      // and hides items already placed in the shelf being designed.
      // Hide Used: for intermediate stages, check both current and
      // future product sets (products cascade forward, so if it's in
      // either it's likely on the intermediate stage too).
      const matchesHideUsed = !designShelfId || !hideUsed
        ? true
        : designShelfId === 'current'
            ? !currentProductIds.has(p.id)
            : !currentProductIds.has(p.id) && !futureProductIds.has(p.id);
      return matchesSearch && matchesCategory && matchesSubCategory && matchesFamily && matchesSource && matchesCollection && matchesHideUsed;
    });
  }, [products, search, categoryFilter, subCategoryFilter, familyFilter, showLive, showDev, showCore, showDuo, hideUsed, designShelfId, currentProductIds, futureProductIds]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const toggleSubCat = (key: string) => {
    setCollapsedSubCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div ref={setDropRef} className={`catalogue-panel ${viewMode} ${isDropTarget && isDropOver ? 'drop-active' : ''}`}>
      {viewMode === 'collapsed' ? (
        <div className="catalogue-collapsed" onClick={() => setViewMode('normal')} title="Expand catalogue">
          <span className="catalogue-collapsed-icon">📦</span>
          <span className="catalogue-collapsed-label">Catalogue</span>
        </div>
      ) : (
        <>
      <div className="catalogue-header">
        <h3>Catalogue</h3>
        <div className="catalogue-header-actions">
          <button className="catalogue-collapse-all-btn" onClick={() => {
            // Collapse-all: collapse every category AND every sub-cat so a
            // fresh expand starts from a fully closed tree. Expand-all
            // (when already collapsed) clears both sets so all
            // categories + sub-categories open at once.
            const allCats = grouped.map((g) => g.category);
            const allCollapsed = allCats.every((c) => collapsedCategories.has(c));
            if (allCollapsed) {
              setCollapsedCategories(new Set());
              setCollapsedSubCats(new Set());
            } else {
              setCollapsedCategories(new Set(allCats));
              const allSubKeys = grouped.flatMap((g) =>
                g.subCategories.map((sc) => `${g.category}::${sc.subCategory}`),
              );
              setCollapsedSubCats(new Set(allSubKeys));
            }
          }} title={collapsedCategories.size > 0 ? "Expand all" : "Collapse all"}>↕</button>
          <button
            className="catalogue-expand-btn"
            onClick={cycleViewMode}
            title={viewMode === 'expanded' ? 'Compact view' : viewMode === 'normal' ? 'Expand' : 'Collapse'}
          >
            {viewMode === 'expanded' ? '▶' : viewMode === 'normal' ? '◀' : '▶'}
          </button>
          <button
            className="catalogue-collapse-btn"
            onClick={() => setViewMode('collapsed')}
            title="Collapse catalogue to icon strip"
          >
            ▷
          </button>
          <button className="import-btn" onClick={onImport}>
            Import Data
          </button>
        </div>
      </div>

      <div className="catalogue-filters">
        <input
          type="text"
          className="catalogue-search"
          placeholder="Search by name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="catalogue-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="catalogue-select"
          value={subCategoryFilter}
          onChange={(e) => setSubCategoryFilter(e.target.value)}
        >
          <option value="">All Sub-Categories</option>
          {subCategories.map((sc) => (
            <option key={sc} value={sc}>
              {sc}
            </option>
          ))}
        </select>
        <select
          className="catalogue-select"
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
        >
          <option value="">All Families</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <div className="catalogue-source-toggles">
          <label>
            <input
              type="checkbox"
              checked={showLive}
              onChange={(e) => setCatalogueFilters({ showLive: e.target.checked })}
            />
            <span>Live</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showDev}
              onChange={(e) => setCatalogueFilters({ showDev: e.target.checked })}
            />
            <span>Dev</span>
          </label>
          <label title="Show products tagged as SAP Collection: Core">
            <input
              type="checkbox"
              checked={showCore}
              onChange={(e) => setCatalogueFilters({ showCore: e.target.checked })}
            />
            <span>Core</span>
          </label>
          <label title="Show products tagged as SAP Collection: Duo">
            <input
              type="checkbox"
              checked={showDuo}
              onChange={(e) => setCatalogueFilters({ showDuo: e.target.checked })}
            />
            <span>Duo</span>
          </label>
          {designShelfId && (
            <label title={`Hide items already placed in the ${designShelfId} shelf`}>
              <input
                type="checkbox"
                checked={hideUsed}
                onChange={(e) => setCatalogueFilters({ hideUsed: e.target.checked })}
              />
              <span>Hide Used</span>
            </label>
          )}
        </div>
      </div>

      <div className="catalogue-count">{filtered.length} of {products.length} products</div>

      <div className="catalogue-list">
        {grouped.map((group) => {
          const isCatCollapsed = collapsedCategories.has(group.category);
          const catProductCount = group.subCategories.reduce((sum, sc) => sum + sc.products.length, 0);

          return (
            <div key={group.category} className="catalogue-group">
              <div
                className="catalogue-category-header"
                onClick={() => toggleCategory(group.category)}
              >
                <span className="catalogue-collapse-icon">{isCatCollapsed ? '▸' : '▾'}</span>
                <span className="catalogue-category-name">{group.category}</span>
                <span className="catalogue-category-count">{catProductCount}</span>
              </div>

              {!isCatCollapsed && group.subCategories.map((subGroup) => {
                const subKey = `${group.category}::${subGroup.subCategory}`;
                const isSubCollapsed = collapsedSubCats.has(subKey);

                return (
                  <div key={subKey} className="catalogue-subgroup">
                    {group.subCategories.length > 1 && (
                      <div
                        className="catalogue-subcategory-header"
                        onClick={() => toggleSubCat(subKey)}
                      >
                        <span className="catalogue-collapse-icon small">{isSubCollapsed ? '▸' : '▾'}</span>
                        <span className="catalogue-subcategory-name">{subGroup.subCategory}</span>
                        <span className="catalogue-category-count">{subGroup.products.length}</span>
                      </div>
                    )}

                    {!isSubCollapsed && (
                      <div className={viewMode === 'expanded' ? 'catalogue-items-expanded' : ''}>
                        {subGroup.products.map((product) => (
                          <CatalogueItem
                            key={product.id}
                            product={product}
                            expanded={viewMode === 'expanded'}
                            currentProductIds={currentProductIds}
                            futureProductIds={futureProductIds}
                            otherCurrentIds={otherCurrentIds}
                            otherFutureIds={otherFutureIds}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="catalogue-empty">
            {products.length === 0
              ? 'Import a product file to get started'
              : 'No products match your filters'}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
