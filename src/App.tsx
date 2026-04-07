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
import { Shelf } from './components/Shelf';
import { Catalogue } from './components/Catalogue';
import { SankeyFlow } from './components/SankeyFlow';
import { ImportDialog } from './components/ImportDialog';
import { ProductCard } from './components/ProductCard';
import { LinkPanel } from './components/LinkPanel';
import { useProjectStore } from './store/useProjectStore';
import type { Product, ShelfItem } from './types';
import './App.css';

function findShelfForItem(project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>, itemId: string): string | null {
  if (project.currentShelf.items.some((i) => i.id === itemId)) return 'current';
  if (project.futureShelf.items.some((i) => i.id === itemId)) return 'future';
  return null;
}

function getTargetShelfId(overId: string, project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>): string | null {
  if (overId.startsWith('shelf-')) return overId.replace('shelf-', '');
  if (project.currentShelf.items.some((i) => i.id === overId)) return 'current';
  if (project.futureShelf.items.some((i) => i.id === overId)) return 'future';
  return null;
}

function isProductOnShelf(project: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>, productId: string, shelfId: string): boolean {
  if (!productId) return false;
  const shelf = shelfId === 'current' ? project.currentShelf : project.futureShelf;
  return shelf.items.some((item) => item.productId === productId);
}

function App() {
  const {
    project,
    createProject,
    setCatalogue,
    addItemToShelf,
    reorderShelfItems,
    removeLink,
    linkMode,
    linkSource,
  } = useProjectStore();

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

  const currentProductIds = useMemo(() => new Set(
    project?.currentShelf.items.map((i) => i.productId).filter(Boolean) || []
  ), [project?.currentShelf.items]);

  const futureProductIds = useMemo(() => new Set(
    project?.futureShelf.items.map((i) => i.productId).filter(Boolean) || []
  ), [project?.futureShelf.items]);

  // Link panel source data
  const linkSourceItem = useMemo(() => {
    if (!linkMode || !linkSource || !project) return null;
    return project.currentShelf.items.find((i) => i.id === linkSource) || null;
  }, [linkMode, linkSource, project]);

  const linkSourceProduct = useMemo(() => {
    if (!linkSourceItem || !project) return undefined;
    return project.catalogue.find((p) => p.id === linkSourceItem.productId);
  }, [linkSourceItem, project]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleCreateProject = () => {
    const name = newProjectName.trim() || 'Untitled Project';
    createProject(name, []);
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

  const handleAddPlaceholder = useCallback(
    (shelfId: string) => {
      const name = prompt('Placeholder name (e.g. "New Premium SKU"):');
      if (name === null) return;
      const item: ShelfItem = {
        id: `placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: '',
        position: project?.[shelfId === 'current' ? 'currentShelf' : 'futureShelf'].items.length || 0,
        isPlaceholder: true,
        placeholderName: name || 'New SKU',
      };
      addItemToShelf(shelfId, item);
    },
    [project, addItemToShelf]
  );

  const showDuplicateWarning = (productName: string) => {
    setDuplicateWarning(`"${productName}" is already in this range`);
    setTimeout(() => setDuplicateWarning(null), 2500);
  };

  const handleRailWidthChange = useCallback((width: number) => {
    setShelfRailWidth(width);
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeId = String(active.id);

    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (data?.product) {
        setActiveItem({
          item: { id: activeId, productId: data.product.id, position: 0, isPlaceholder: false },
          product: data.product,
        });
      }
      return;
    }

    if (!project) return;
    const sourceShelf = findShelfForItem(project, activeId);
    const allItems = [...project.currentShelf.items, ...project.futureShelf.items];
    const item = allItems.find((i) => i.id === activeId);
    if (item) {
      const product = project.catalogue.find((p) => p.id === item.productId);
      setActiveItem({ item, product, sourceShelf: sourceShelf || undefined });
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over || !project) { setOverShelfId(null); return; }
    setOverShelfId(getTargetShelfId(String(over.id), project));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const draggedItem = activeItem;
    setActiveItem(null);
    setOverShelfId(null);
    const { active, over } = event;
    if (!over || !project) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const targetShelfId = getTargetShelfId(overId, project);

    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product || !targetShelfId) return;
      if (isProductOnShelf(project, data.product.id, targetShelfId)) {
        showDuplicateWarning(data.product.name); return;
      }
      addItemToShelf(targetShelfId, {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: data.product.id,
        position: project[targetShelfId === 'current' ? 'currentShelf' : 'futureShelf'].items.length,
        isPlaceholder: false,
      });
      return;
    }

    const sourceShelf = draggedItem?.sourceShelf;
    if (sourceShelf && targetShelfId && sourceShelf !== targetShelfId) {
      const sourceItem = draggedItem?.item;
      if (!sourceItem) return;
      if (sourceItem.productId && isProductOnShelf(project, sourceItem.productId, targetShelfId)) {
        showDuplicateWarning(draggedItem?.product?.name || 'This product'); return;
      }
      addItemToShelf(targetShelfId, {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: sourceItem.productId,
        position: project[targetShelfId === 'current' ? 'currentShelf' : 'futureShelf'].items.length,
        isPlaceholder: sourceItem.isPlaceholder,
        placeholderName: sourceItem.placeholderName,
      });
      return;
    }

    if (sourceShelf && targetShelfId === sourceShelf) {
      const shelfKey = sourceShelf === 'current' ? 'currentShelf' : 'futureShelf';
      const items = project[shelfKey].items;
      const oldIndex = items.findIndex((i) => i.id === activeId);
      const newIndex = items.findIndex((i) => i.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        reorderShelfItems(sourceShelf, arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
          ...item, position: idx,
        })));
      }
    }
  };

  if (showNewProject && !project) {
    return (
      <div className="app">
        <Toolbar onImport={() => setShowImport(true)} />
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
      <Toolbar onImport={() => setShowImport(true)} />

      <div className="workspace">
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="shelves-area">
            {project && (
              <>
                <Shelf shelf={project.currentShelf} catalogue={project.catalogue}
                  onAddPlaceholder={() => handleAddPlaceholder('current')}
                  onRailWidthChange={handleRailWidthChange} />

                {/* Link panel — shown when a source is selected in link mode */}
                {linkMode && linkSourceItem && (
                  <LinkPanel
                    sourceItem={linkSourceItem}
                    sourceProduct={linkSourceProduct}
                    links={project.sankeyLinks}
                    futureItems={project.futureShelf.items}
                    catalogue={project.catalogue}
                  />
                )}

                <SankeyFlow
                  currentShelf={project.currentShelf} futureShelf={project.futureShelf}
                  links={project.sankeyLinks} catalogue={project.catalogue}
                  railWidth={shelfRailWidth} onRemoveLink={removeLink} />

                <Shelf shelf={project.futureShelf} catalogue={project.catalogue}
                  onAddPlaceholder={() => handleAddPlaceholder('future')} />

                {activeItem?.sourceShelf && overShelfId && overShelfId !== activeItem.sourceShelf && (
                  <div className="cross-shelf-hint">
                    Drop to duplicate into {overShelfId === 'current' ? 'Current' : 'Future'} Range
                  </div>
                )}
                {duplicateWarning && <div className="duplicate-warning">{duplicateWarning}</div>}
              </>
            )}
          </div>

          <Catalogue products={project?.catalogue || []} onImport={() => setShowImport(true)}
            currentProductIds={currentProductIds} futureProductIds={futureProductIds} />

          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activeItem && <ProductCard item={activeItem.item} product={activeItem.product} overlay />}
          </DragOverlay>
        </DndContext>
      </div>

      {showImport && <ImportDialog onImport={handleImport} onClose={() => setShowImport(false)} />}
    </div>
  );
}

export default App;
