import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Toolbar } from './components/Toolbar';
import { NavSidebar } from './components/NavSidebar';
import { PlanTree } from './components/PlanTree';
import { Shelf } from './components/Shelf';
import { Catalogue } from './components/Catalogue';
import { SankeyFlow } from './components/SankeyFlow';
import { ImportDialog } from './components/ImportDialog';
import { ProductCard } from './components/ProductCard';
import { ForecastPanel } from './components/ForecastPanel';
import { RangeDesign } from './components/RangeDesign';
import { MultiplanView } from './components/MultiplanView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PlaceholderDialog } from './components/PlaceholderDialog';
import { EditableTitle } from './components/EditableTitle';
import { useProjectStore } from './store/useProjectStore';
import { getActivePlan } from './types';
import type { Product, ShelfItem, PlaceholderData } from './types';
import { SlideCanvasControls, fitSlideToWidth } from './components/SlideCanvasControls';
import { resolvePlanSlideSize } from './utils/slideSize';
import { resolveEffectiveCardFormat } from './utils/cardFormat';
import './App.css';

function App() {
  const {
    project,
    createProject,
    setCatalogue,
    addItemToShelf,
    removeItemFromShelf,
    reorderShelfItems,
    updateShelfItem,
    addLink,
    linkMode,
    linkSource,
    setLinkMode,
    setLinkSource,
    assumeContinuity,
    copyCurrentToFuture,
    showPlanTree,
    activeVariantId,
    showGhosted,
    setShowGhosted,
    showDiscontinued,
    setShowDiscontinued,
    renamePlan,
    activeView,
    setActiveView,
    designShelfId,
    setDesignShelfId,
    slideBaseScale,
    slideBaseScaleMode,
    setSlideBaseScale,
    slideZoom,
  } = useProjectStore();

  const activePlan = project ? getActivePlan(project) : undefined;

  const [showImport, setShowImport] = useState(false);
  const [showNewProject, setShowNewProject] = useState(!project);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeItem, setActiveItem] = useState<{
    item: ShelfItem;
    product?: Product;
    sourceShelf?: string;
  } | null>(null);
  const [overShelfId, setOverShelfId] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [shelfRailWidth, setShelfRailWidth] = useState(0);

  // Resolve the effective slide size for the currently-visible plan+view.
  // Each plan persists its own transform-view and range-view sizes via
  // plan.slideSettings; if the plan doesn't have an explicit override the
  // auto-tier picks a scale from the busiest shelf relevant to the view.
  // The derived value is mirrored into the store's slideBaseScale /
  // slideBaseScaleMode so descendant components (Shelf, RangeDesign,
  // SlideCanvasControls) can keep reading it without prop-drilling.
  const effectiveSlideSize = useMemo(() => {
    if (!activePlan) return { scale: 1, mode: 'auto' as const };
    if (activeView === 'transform') {
      const autoCount = Math.max(
        activePlan.currentShelf.items.length,
        activePlan.futureShelf.items.length,
      );
      return resolvePlanSlideSize(activePlan, 'transform', autoCount);
    }
    const shelf = designShelfId === 'current' ? activePlan.currentShelf : activePlan.futureShelf;
    return resolvePlanSlideSize(activePlan, 'range', shelf.items.length);
  }, [activePlan, activeView, designShelfId]);

  useEffect(() => {
    // Mode mirror always runs — SlideCanvasControls reads slideBaseScaleMode
    // to render the auto/manual toggle correctly.
    if (effectiveSlideSize.mode !== slideBaseScaleMode) {
      useProjectStore.getState().setSlideBaseScaleMode(effectiveSlideSize.mode);
    }
    // For Range Design view in auto mode, RangeDesign owns slideBaseScale
    // via its own fit-driven auto-tier loop (see computeMatrixAutoTier).
    // Skip the App-level item-count-based assignment so the two resolvers
    // don't fight when the auto-tier wants to upgrade or downgrade.
    if (activeView === 'range-design' && effectiveSlideSize.mode === 'auto') return;
    if (effectiveSlideSize.scale !== slideBaseScale) {
      setSlideBaseScale(effectiveSlideSize.scale);
    }
  }, [effectiveSlideSize, slideBaseScale, slideBaseScaleMode, setSlideBaseScale, activeView]);

  // Keep store.cardFormat in sync with the effective plan+variant format
  // so the Toolbar dropdown and every card reading the mirror reflect
  // the current context. Writing happens inside the store's setCardFormat
  // action; this effect covers the read side when the user switches
  // plans or variants.
  useEffect(() => {
    if (!activePlan) return;
    const effective = resolveEffectiveCardFormat(activePlan, activeVariantId);
    const current = useProjectStore.getState().cardFormat;
    const effectiveRec = effective as unknown as Record<string, boolean>;
    const currentRec = current as unknown as Record<string, boolean>;
    const changed = Object.keys(effectiveRec).some((k) => effectiveRec[k] !== currentRec[k]);
    if (changed) {
      useProjectStore.setState({ cardFormat: effective });
    }
  }, [activePlan, activeVariantId]);

  // Apply the computed canvas scale + zoom as CSS custom properties on the
  // root <html> element so both .transform-16-9 and .matrix-16-9 read them.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--slide-base-scale', String(slideBaseScale));
    root.style.setProperty('--slide-zoom', String(slideZoom));
    return () => {
      root.style.removeProperty('--slide-base-scale');
      root.style.removeProperty('--slide-zoom');
    };
  }, [slideBaseScale, slideZoom]);

  // Auto-fit the slide to the viewport width whenever the user switches
  // views, changes the resolution tier, or opens/loads/creates a project
  // (project?.activePlanId flips from undefined → a real id on first
  // open). Matches the desktop slide tool convention where the canvas
  // snaps to fit when something big happens to the layout.
  useEffect(() => {
    if (!project) return;
    // Multiplan view has no fixed slide canvas, so there's nothing to
    // auto-fit. Skip the snap-to-width entirely when it's active.
    if (activeView === 'multiplan') return;
    const selector = activeView === 'transform' ? '.transform-view-scroll' : '.range-view-scroll';
    // Wait for the new view's DOM to mount and CSS vars to commit. Two
    // RAFs is enough for the initial render; on a fresh project we add a
    // small fallback timeout so RangeDesign's own measure-and-layout has
    // a chance to finish before we read clientWidth.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => fitSlideToWidth(selector));
    });
    const t = window.setTimeout(() => fitSlideToWidth(selector), 80);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [activeView, slideBaseScale, project?.activePlanId]);

  // Ctrl + scroll zooms the slide, anchored to the cursor position so the
  // point under the mouse stays put (PowerPoint-style). Attached at the
  // window level with non-passive so we can preventDefault the native
  // wheel event and scroll manually afterwards.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const scrollArea = (e.target as HTMLElement | null)?.closest('.slide-scroll-area') as HTMLElement | null;
      if (!scrollArea) return;
      e.preventDefault();

      const rect = scrollArea.getBoundingClientRect();
      const mx = e.clientX - rect.left; // cursor x relative to scroll viewport
      const my = e.clientY - rect.top;
      const C = rect.width;
      const R = rect.height;

      const current = useProjectStore.getState().slideZoom;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.max(0.3, Math.min(3, current * factor));
      if (Math.abs(next - current) < 1e-4) return;
      const ratio = next / current;

      const oldScrollLeft = scrollArea.scrollLeft;
      const oldScrollTop = scrollArea.scrollTop;
      // Canvas sits at (C/2, R/2) inside the spacer so the (ratio - 1)
      // term gets multiplied by cursor offset from viewport centre.
      const newScrollLeft = ratio * oldScrollLeft + (ratio - 1) * (mx - C / 2);
      const newScrollTop = ratio * oldScrollTop + (ratio - 1) * (my - R / 2);

      useProjectStore.getState().setSlideZoom(next);
      // Apply scroll after React commits the zoom and the DOM reflows so
      // the new scroll bounds are in place. Two RAFs is conservative but
      // rock-solid across browsers.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollArea.scrollLeft = newScrollLeft;
          scrollArea.scrollTop = newScrollTop;
        });
      });
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);
  const [placeholderDialog, setPlaceholderDialog] = useState<
    | { mode: 'create'; shelfId: string }
    | { mode: 'edit'; shelfId: string; itemId: string; data: PlaceholderData }
    | null
  >(null);

  // Build usage sets across ALL plans for catalogue badges
  const { currentPlanProductIds, futurePlanProductIds, otherPlansCurrentIds, otherPlansFutureIds } = useMemo(() => {
    if (!project || !activePlan) return {
      currentPlanProductIds: new Set<string>(),
      futurePlanProductIds: new Set<string>(),
      otherPlansCurrentIds: new Set<string>(),
      otherPlansFutureIds: new Set<string>(),
    };
    const curIds = new Set(activePlan.currentShelf.items.map((i) => i.productId).filter(Boolean));
    const futIds = new Set(activePlan.futureShelf.items.map((i) => i.productId).filter(Boolean));
    const otherCur = new Set<string>();
    const otherFut = new Set<string>();
    for (const plan of project.plans) {
      if (plan.id === activePlan.id) continue;
      for (const item of plan.currentShelf.items) if (item.productId) otherCur.add(item.productId);
      for (const item of plan.futureShelf.items) if (item.productId) otherFut.add(item.productId);
    }
    return { currentPlanProductIds: curIds, futurePlanProductIds: futIds, otherPlansCurrentIds: otherCur, otherPlansFutureIds: otherFut };
  }, [project, activePlan]);

  // Variant filter: which items are included in the active variant
  const activeVariant = useMemo(() => {
    if (!activeVariantId || !activePlan) return null;
    return activePlan.variants.find((v) => v.id === activeVariantId) || null;
  }, [activeVariantId, activePlan]);

  const variantCurrentIds = useMemo(() =>
    activeVariant ? new Set(activeVariant.includedCurrentItemIds) : null,
    [activeVariant]
  );
  const variantFutureIds = useMemo(() =>
    activeVariant ? new Set(activeVariant.includedFutureItemIds) : null,
    [activeVariant]
  );

  // Discontinued items: current shelf products not in future shelf
  const discontinuedItems = useMemo(() => {
    if (!activePlan) return [];
    const futureProductIds = new Set(activePlan.futureShelf.items.map((i) => i.productId));
    return activePlan.currentShelf.items.filter((item) => {
      if (item.isPlaceholder || !item.productId) return false;
      return !futureProductIds.has(item.productId);
    });
  }, [activePlan]);

  // In forecast mode, linkSource stores the FUTURE item being
  // forecasted (the reverse of the old forward-link direction).
  const forecastTargetItem = useMemo(() => {
    if (!linkMode || !linkSource || !activePlan) return null;
    return activePlan.futureShelf.items.find((i) => i.id === linkSource) || null;
  }, [linkMode, linkSource, activePlan]);

  const forecastTargetProduct = useMemo(() => {
    if (!forecastTargetItem || !project) return undefined;
    return project.catalogue.find((p) => p.id === forecastTargetItem.productId);
  }, [forecastTargetItem, project]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleCreateProject = () => {
    createProject(newProjectName.trim() || 'Untitled Project', []);
    setShowNewProject(false);
  };

  const handleImport = (products: Product[]) => {
    if (!project) {
      createProject(newProjectName || 'Untitled Project', products);
      setShowNewProject(false);
    } else {
      setCatalogue(products);
    }
  };

  const handleAddPlaceholder = useCallback((shelfId: string) => {
    setPlaceholderDialog({ mode: 'create', shelfId });
  }, []);

  const handleEditPlaceholder = useCallback((shelfId: string, itemId: string) => {
    if (!activePlan) return;
    const shelf = shelfId === 'current' ? activePlan.currentShelf : activePlan.futureShelf;
    const item = shelf.items.find((i) => i.id === itemId);
    if (!item || !item.isPlaceholder) return;
    const data: PlaceholderData = item.placeholderData || {
      sku: '', name: item.placeholderName || '', category: '', subCategory: '',
      productFamily: '', volume: 0, forecastVolume: 0, rrp: 0, revenue: 0, source: 'live',
    };
    setPlaceholderDialog({ mode: 'edit', shelfId, itemId, data });
  }, [activePlan]);

  // Build set of existing SKUs for placeholder validation (catalogue + other placeholders, excluding the one being edited)
  const existingSkusForDialog = useMemo(() => {
    if (!project) return new Set<string>();
    const skus = new Set<string>();
    project.catalogue.forEach((p) => p.sku && skus.add(p.sku));
    project.plans.forEach((plan) => {
      [...plan.currentShelf.items, ...plan.futureShelf.items].forEach((item) => {
        if (!item.isPlaceholder || !item.placeholderData) return;
        // Exclude the item being edited
        if (placeholderDialog?.mode === 'edit' && placeholderDialog.itemId === item.id) return;
        if (item.placeholderData.sku) skus.add(item.placeholderData.sku);
      });
    });
    return skus;
  }, [project, placeholderDialog]);

  const handlePlaceholderSave = (data: PlaceholderData) => {
    if (!placeholderDialog) return;
    if (placeholderDialog.mode === 'create') {
      const shelfId = placeholderDialog.shelfId;
      const shelfItems = activePlan?.[shelfId === 'current' ? 'currentShelf' : 'futureShelf']?.items || [];
      addItemToShelf(shelfId, {
        id: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: '',
        position: shelfItems.length,
        isPlaceholder: true,
        placeholderName: data.name,
        placeholderData: data,
      });
    } else {
      updateShelfItem(placeholderDialog.shelfId, placeholderDialog.itemId, {
        placeholderName: data.name,
        placeholderData: data,
      });
    }
    setPlaceholderDialog(null);
  };

  const showDuplicateWarning = (productName: string) => {
    setDuplicateWarning(`"${productName}" is already in this range`);
    setTimeout(() => setDuplicateWarning(null), 2500);
  };

  const handleRailWidthChange = useCallback((width: number) => setShelfRailWidth(width), []);

  const enterForecastModeFor = useCallback((futureItemId: string) => {
    setLinkMode(true);
    setLinkSource(futureItemId);
  }, [setLinkMode, setLinkSource]);

  // Double-click on a current shelf item: edit if placeholder
  const handleCurrentDoubleClick = useCallback((itemId: string) => {
    const item = activePlan?.currentShelf.items.find((i) => i.id === itemId);
    if (item?.isPlaceholder) {
      handleEditPlaceholder('current', itemId);
    }
  }, [activePlan, handleEditPlaceholder]);

  // Double-click on a future shelf item: edit if placeholder,
  // otherwise enter forecast mode for that product.
  const handleFutureDoubleClick = useCallback((itemId: string) => {
    const item = activePlan?.futureShelf.items.find((i) => i.id === itemId);
    if (item?.isPlaceholder) {
      handleEditPlaceholder('future', itemId);
    } else {
      enterForecastModeFor(itemId);
    }
  }, [activePlan, enterForecastModeFor, handleEditPlaceholder]);

  // Clicking a sankey flow enters forecast mode for the TARGET
  // (the future product receiving the flow) so the user sees
  // "what feeds this?" rather than "where does this go?".
  const handleSankeyClick = useCallback((sourceItemId: string) => {
    // Find the first link from this source to get a target.
    const link = activePlan?.sankeyLinks.find((l) => l.sourceItemId === sourceItemId);
    if (link) {
      enterForecastModeFor(link.targetItemId);
    }
  }, [activePlan, enterForecastModeFor]);

  // Drag handlers
  const findShelfForItem = (itemId: string): string | null => {
    if (!activePlan) return null;
    if (activePlan.currentShelf.items.some((i) => i.id === itemId)) return 'current';
    if (activePlan.futureShelf.items.some((i) => i.id === itemId)) return 'future';
    return null;
  };

  const getTargetShelfId = (overId: string): string | null => {
    if (!activePlan) return null;
    if (overId.startsWith('shelf-')) return overId.replace('shelf-', '');
    if (overId === 'catalogue-drop-zone') return null;
    if (activePlan.currentShelf.items.some((i) => i.id === overId)) return 'current';
    if (activePlan.futureShelf.items.some((i) => i.id === overId)) return 'future';
    return null;
  };

  const isProductOnShelf = (productId: string, shelfId: string): boolean => {
    if (!productId || !activePlan) return false;
    const shelf = shelfId === 'current' ? activePlan.currentShelf : activePlan.futureShelf;
    return shelf.items.some((item) => item.productId === productId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (activeId.startsWith('catalogue-')) {
      const data = event.active.data.current as { product: Product };
      if (data?.product) setActiveItem({ item: { id: activeId, productId: data.product.id, position: 0, isPlaceholder: false }, product: data.product });
      return;
    }
    if (!activePlan) return;
    const sourceShelf = findShelfForItem(activeId);
    const allItems = [...activePlan.currentShelf.items, ...activePlan.futureShelf.items];
    const item = allItems.find((i) => i.id === activeId);
    if (item) {
      const product = project?.catalogue.find((p) => p.id === item.productId);
      setActiveItem({ item, product, sourceShelf: sourceShelf || undefined });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) { setOverShelfId(null); return; }
    const overId = String(over.id);
    setOverShelfId(overId === 'catalogue-drop-zone' ? 'catalogue' : getTargetShelfId(overId));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const draggedItem = activeItem;
    setActiveItem(null);
    setOverShelfId(null);
    const { active, over } = event;
    if (!over || !activePlan || !project) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (overId === 'catalogue-drop-zone' && draggedItem?.sourceShelf && draggedItem.item) {
      removeItemFromShelf(draggedItem.sourceShelf, draggedItem.item.id);
      return;
    }

    const targetShelfId = getTargetShelfId(overId);

    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product || !targetShelfId) return;
      if (isProductOnShelf(data.product.id, targetShelfId)) { showDuplicateWarning(data.product.name); return; }
      const newItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      addItemToShelf(targetShelfId, { id: newItemId, productId: data.product.id, position: activePlan[targetShelfId === 'current' ? 'currentShelf' : 'futureShelf'].items.length, isPlaceholder: false });
      if (targetShelfId === 'current' && assumeContinuity && !isProductOnShelf(data.product.id, 'future')) {
        const futureItemId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        addItemToShelf('future', { id: futureItemId, productId: data.product.id, position: activePlan.futureShelf.items.length, isPlaceholder: false });
        addLink({ sourceItemId: newItemId, targetItemId: futureItemId, percent: 100, volume: data.product.volume || 0, type: 'transfer' });
      }
      return;
    }

    const sourceShelf = draggedItem?.sourceShelf;
    if (sourceShelf && targetShelfId && sourceShelf !== targetShelfId) {
      const sourceItem = draggedItem?.item;
      if (!sourceItem) return;
      if (sourceItem.productId && isProductOnShelf(sourceItem.productId, targetShelfId)) { showDuplicateWarning(draggedItem?.product?.name || 'This product'); return; }
      addItemToShelf(targetShelfId, { id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId: sourceItem.productId, position: activePlan[targetShelfId === 'current' ? 'currentShelf' : 'futureShelf'].items.length, isPlaceholder: sourceItem.isPlaceholder, placeholderName: sourceItem.placeholderName });
      return;
    }

    if (sourceShelf && targetShelfId === sourceShelf) {
      const shelfKey = sourceShelf === 'current' ? 'currentShelf' : 'futureShelf';
      const items = activePlan[shelfKey].items;
      const oldIndex = items.findIndex((i) => i.id === activeId);
      const newIndex = items.findIndex((i) => i.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        reorderShelfItems(sourceShelf, arrayMove(items, oldIndex, newIndex).map((item, idx) => ({ ...item, position: idx })));
      }
    }
  };

  // Welcome screen
  if (showNewProject && !project) {
    return (
      <div className="app">
        <Toolbar activeView={activeView} />
        <div className="welcome-screen">
          <div className="welcome-card">
            <h1>Range Planner</h1>
            <p>Visualise, map and plan your product range rationalisation</p>
            <div className="welcome-form">
              <input type="text" placeholder="Project name..." value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} autoFocus />
              <button className="btn-primary" onClick={handleCreateProject}>Create Project</button>
            </div>
            <p className="welcome-hint">Or load an existing project file from the toolbar</p>
          </div>
        </div>
        {showImport && <ImportDialog onImport={handleImport} onClose={() => setShowImport(false)} />}
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar activeView={activeView} />
      <div className="workspace">
        <NavSidebar activeView={activeView} onViewChange={setActiveView} />

        {showPlanTree && <PlanTree />}

        {activeView === 'transform' ? (
          activePlan ? (
          <ErrorBoundary>
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
            <div className="shelves-area">
              <div className="transform-title-bar">
                <div className="transform-title-actions">
                  {activeVariant && (
                    <label className="ghost-toggle" title="Show products not in this variant">
                      <input type="checkbox" checked={showGhosted} onChange={(e) => setShowGhosted(e.target.checked)} />
                      <span>Show excluded</span>
                    </label>
                  )}
                  <label className="ghost-toggle" title="Show discontinued products in future range">
                    <input type="checkbox" checked={showDiscontinued} onChange={(e) => setShowDiscontinued(e.target.checked)} />
                    <span>Show discontinued</span>
                  </label>
                  <SlideCanvasControls scrollAreaSelector=".transform-view-scroll" />
                  <button className="transform-copy-btn" onClick={copyCurrentToFuture}>Copy Current → Future</button>
                </div>
              </div>

              <div className="slide-scroll-area transform-view-scroll">
                <div className="slide-scroll-spacer">
                  <div className="slide-canvas-wrapper">
                  <div className="transform-16-9">
                    <div className="slide-title">
                      <EditableTitle
                        className="transform-title"
                        value={activePlan.name}
                        onSave={(next) => renamePlan(activePlan.id, next)}
                        trailing={activeVariant ? <span className="variant-badge">{activeVariant.name}</span> : null}
                      />
                </div>

                <Shelf shelf={activePlan.currentShelf} catalogue={project!.catalogue}
                  onAddPlaceholder={() => handleAddPlaceholder('current')}
                  onRailWidthChange={handleRailWidthChange}
                  onDoubleClickItem={handleCurrentDoubleClick}
                  variantIncludedIds={variantCurrentIds}
                  showGhosted={showGhosted} />

                <SankeyFlow currentShelf={activePlan.currentShelf} futureShelf={activePlan.futureShelf}
                  links={activePlan.sankeyLinks} catalogue={project!.catalogue}
                  railWidth={shelfRailWidth}
                  variantCurrentIds={variantCurrentIds} variantFutureIds={variantFutureIds}
                  showGhosted={showGhosted}
                  discontinuedItems={discontinuedItems}
                  showDiscontinued={showDiscontinued}
                  onClickFlow={handleSankeyClick} />

                <Shelf shelf={activePlan.futureShelf} catalogue={project!.catalogue}
                  onAddPlaceholder={() => handleAddPlaceholder('future')}
                  onDoubleClickItem={handleFutureDoubleClick}
                  variantIncludedIds={variantFutureIds}
                  showGhosted={showGhosted}
                  editableFuturePricing={true}
                  discontinuedItems={discontinuedItems}
                  showDiscontinued={showDiscontinued}
                  flipped={true} />
                  </div>
                  </div>
                </div>
              </div>

              {linkMode && forecastTargetItem && (
                <ForecastPanel targetItem={forecastTargetItem} targetProduct={forecastTargetProduct}
                  links={activePlan.sankeyLinks} currentItems={activePlan.currentShelf.items}
                  catalogue={project!.catalogue} />
              )}

              {activeItem?.sourceShelf && overShelfId === 'catalogue' && (
                <div className="cross-shelf-hint remove-hint">Drop to remove from range</div>
              )}
              {activeItem?.sourceShelf && overShelfId && overShelfId !== 'catalogue' && overShelfId !== activeItem.sourceShelf && (
                <div className="cross-shelf-hint">Drop to duplicate into {overShelfId === 'current' ? 'Current' : 'Future'} Range</div>
              )}
              {duplicateWarning && <div className="duplicate-warning">{duplicateWarning}</div>}
            </div>

            <Catalogue products={project?.catalogue || []} onImport={() => setShowImport(true)}
              currentProductIds={currentPlanProductIds} futureProductIds={futurePlanProductIds}
              otherCurrentIds={otherPlansCurrentIds} otherFutureIds={otherPlansFutureIds}
              isDropTarget={!!activeItem?.sourceShelf}
              dropZoneId="catalogue-drop-zone" />

            <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
              {activeItem && <ProductCard item={activeItem.item} product={activeItem.product} overlay />}
            </DragOverlay>
          </DndContext>
          </ErrorBoundary>
          ) : (
            <div className="shelves-area"><div className="shelf-empty">No active range plan. Create one from the Plans panel.</div></div>
          )
        ) : activeView === 'range-design' ? (
          <RangeDesign shelfId={designShelfId} onShelfChange={setDesignShelfId} onImport={() => setShowImport(true)} />
        ) : activeView === 'multiplan' ? (
          <MultiplanView />
        ) : null}
      </div>

      {showImport && <ImportDialog onImport={handleImport} onClose={() => setShowImport(false)} />}
      {placeholderDialog && (
        <PlaceholderDialog
          mode={placeholderDialog.mode}
          initialData={placeholderDialog.mode === 'edit' ? placeholderDialog.data : undefined}
          existingSkus={existingSkusForDialog}
          onSave={handlePlaceholderSave}
          onClose={() => setPlaceholderDialog(null)}
        />
      )}
    </div>
  );
}

export default App;
