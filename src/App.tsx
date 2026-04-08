import { useState, useCallback, useMemo } from 'react';
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
import { NavSidebar, type ViewType } from './components/NavSidebar';
import { PlanTree } from './components/PlanTree';
import { Shelf } from './components/Shelf';
import { Catalogue } from './components/Catalogue';
import { SankeyFlow } from './components/SankeyFlow';
import { ImportDialog } from './components/ImportDialog';
import { ProductCard } from './components/ProductCard';
import { LinkPanel } from './components/LinkPanel';
import { RangeDesign } from './components/RangeDesign';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useProjectStore } from './store/useProjectStore';
import { getActivePlan } from './types';
import type { Product, ShelfItem } from './types';
import './App.css';

function App() {
  const {
    project,
    createProject,
    setCatalogue,
    addItemToShelf,
    removeItemFromShelf,
    reorderShelfItems,
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
  } = useProjectStore();

  const activePlan = project ? getActivePlan(project) : undefined;

  const [showImport, setShowImport] = useState(false);
  const [showNewProject, setShowNewProject] = useState(!project);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeView, setActiveView] = useState<ViewType>('range-design');
  const [designShelfId, setDesignShelfId] = useState<'current' | 'future'>('current');
  const [activeItem, setActiveItem] = useState<{
    item: ShelfItem;
    product?: Product;
    sourceShelf?: string;
  } | null>(null);
  const [overShelfId, setOverShelfId] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [shelfRailWidth, setShelfRailWidth] = useState(0);
  const [showDiscontinued, setShowDiscontinued] = useState(true);

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

  const linkSourceItem = useMemo(() => {
    if (!linkMode || !linkSource || !activePlan) return null;
    return activePlan.currentShelf.items.find((i) => i.id === linkSource) || null;
  }, [linkMode, linkSource, activePlan]);

  const linkSourceProduct = useMemo(() => {
    if (!linkSourceItem || !project) return undefined;
    return project.catalogue.find((p) => p.id === linkSourceItem.productId);
  }, [linkSourceItem, project]);

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
    const name = prompt('Placeholder name (e.g. "New Premium SKU"):');
    if (name === null) return;
    addItemToShelf(shelfId, {
      id: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      productId: '', position: activePlan?.[shelfId === 'current' ? 'currentShelf' : 'futureShelf']?.items?.length || 0,
      isPlaceholder: true, placeholderName: name || 'New SKU',
    });
  }, [activePlan, addItemToShelf]);

  const showDuplicateWarning = (productName: string) => {
    setDuplicateWarning(`"${productName}" is already in this range`);
    setTimeout(() => setDuplicateWarning(null), 2500);
  };

  const handleRailWidthChange = useCallback((width: number) => setShelfRailWidth(width), []);

  const enterLinkModeFor = useCallback((itemId: string) => {
    setLinkMode(true);
    setLinkSource(itemId);
  }, [setLinkMode, setLinkSource]);

  const handleSankeyClick = useCallback((sourceItemId: string) => enterLinkModeFor(sourceItemId), [enterLinkModeFor]);

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
        <Toolbar onImport={() => setShowImport(true)} activeView={activeView} />
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
      <Toolbar onImport={() => setShowImport(true)} activeView={activeView} />
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
                <h2 className="transform-title">
                  {activePlan.name}
                  {activeVariant && <span className="variant-badge">{activeVariant.name}</span>}
                </h2>
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
                  <button className="transform-copy-btn" onClick={copyCurrentToFuture}>Copy Current → Future</button>
                </div>
              </div>

              <Shelf shelf={activePlan.currentShelf} catalogue={project!.catalogue}
                onAddPlaceholder={() => handleAddPlaceholder('current')}
                onRailWidthChange={handleRailWidthChange}
                onDoubleClickItem={enterLinkModeFor}
                onViewDesign={() => { setDesignShelfId('current'); setActiveView('range-design'); }}
                variantIncludedIds={variantCurrentIds}
                showGhosted={showGhosted} />

              {linkMode && linkSourceItem && (
                <LinkPanel sourceItem={linkSourceItem} sourceProduct={linkSourceProduct}
                  links={activePlan.sankeyLinks} futureItems={activePlan.futureShelf.items}
                  catalogue={project!.catalogue} />
              )}

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
                onViewDesign={() => { setDesignShelfId('future'); setActiveView('range-design'); }}
                variantIncludedIds={variantFutureIds}
                showGhosted={showGhosted}
                discontinuedItems={discontinuedItems}
                showDiscontinued={showDiscontinued} />

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
        ) : null}
      </div>

      {showImport && <ImportDialog onImport={handleImport} onClose={() => setShowImport(false)} />}
    </div>
  );
}

export default App;
