import { useState, useCallback } from 'react';
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
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Toolbar } from './components/Toolbar';
import { Shelf } from './components/Shelf';
import { Catalogue } from './components/Catalogue';
import { SankeyFlow } from './components/SankeyFlow';
import { ImportDialog } from './components/ImportDialog';
import { ProductCard } from './components/ProductCard';
import { useProjectStore } from './store/useProjectStore';
import type { Product, ShelfItem } from './types';
import './App.css';

function App() {
  const {
    project,
    createProject,
    setCatalogue,
    addItemToShelf,
    reorderShelfItems,
    addLabel,
    removeLink,
  } = useProjectStore();

  const [showImport, setShowImport] = useState(false);
  const [showNewProject, setShowNewProject] = useState(!project);
  const [newProjectName, setNewProjectName] = useState('');
  const [activeItem, setActiveItem] = useState<{
    item: ShelfItem;
    product?: Product;
  } | null>(null);

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

  const handleAddLabel = useCallback(
    (shelfId: string) => {
      const text = prompt('Label text (e.g. "Good", "Better", "Best"):');
      if (!text) return;
      const shelf = project?.[shelfId === 'current' ? 'currentShelf' : 'futureShelf'];
      if (!shelf) return;
      const itemCount = shelf.items.length;
      addLabel(shelfId, {
        id: `label-${Date.now()}`,
        text,
        startPosition: 0,
        endPosition: Math.max(itemCount - 1, 0),
        color: '#e8e0d4',
      });
    },
    [project, addLabel]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeId = String(active.id);

    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (data?.product) {
        setActiveItem({
          item: {
            id: activeId,
            productId: data.product.id,
            position: 0,
            isPlaceholder: false,
          },
          product: data.product,
        });
      }
      return;
    }

    const allItems = [
      ...(project?.currentShelf.items || []),
      ...(project?.futureShelf.items || []),
    ];
    const item = allItems.find((i) => i.id === activeId);
    if (item) {
      const product = project?.catalogue.find((p) => p.id === item.productId);
      setActiveItem({ item, product });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || !project) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Dropping a catalogue item onto a shelf
    if (activeId.startsWith('catalogue-')) {
      const data = active.data.current as { product: Product };
      if (!data?.product) return;

      let targetShelfId: string | null = null;
      if (overId.startsWith('shelf-')) {
        targetShelfId = overId.replace('shelf-', '');
      } else {
        if (project.currentShelf.items.some((i) => i.id === overId)) {
          targetShelfId = 'current';
        } else if (project.futureShelf.items.some((i) => i.id === overId)) {
          targetShelfId = 'future';
        }
      }

      if (targetShelfId) {
        const newItem: ShelfItem = {
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          productId: data.product.id,
          position:
            project[targetShelfId === 'current' ? 'currentShelf' : 'futureShelf'].items.length,
          isPlaceholder: false,
        };
        addItemToShelf(targetShelfId, newItem);
      }
      return;
    }

    // Reordering within a shelf
    const currentItems = project.currentShelf.items;
    const futureItems = project.futureShelf.items;

    let shelfId: string | null = null;
    let items: ShelfItem[] = [];

    if (currentItems.some((i) => i.id === activeId)) {
      shelfId = 'current';
      items = currentItems;
    } else if (futureItems.some((i) => i.id === activeId)) {
      shelfId = 'future';
      items = futureItems;
    }

    if (shelfId && items.length > 0) {
      const oldIndex = items.findIndex((i) => i.id === activeId);
      const newIndex = items.findIndex((i) => i.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
          ...item,
          position: idx,
        }));
        reorderShelfItems(shelfId, reordered);
      }
    }
  };

  // Welcome / New Project screen
  if (showNewProject && !project) {
    return (
      <div className="app">
        <Toolbar onImport={() => setShowImport(true)} />
        <div className="welcome-screen">
          <div className="welcome-card">
            <h1>Range Planner</h1>
            <p>Visualise, map and plan your product range rationalisation</p>
            <div className="welcome-form">
              <input
                type="text"
                placeholder="Project name..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                autoFocus
              />
              <button className="btn-primary" onClick={handleCreateProject}>
                Create Project
              </button>
            </div>
            <p className="welcome-hint">Or load an existing project file from the toolbar</p>
          </div>
        </div>
        {showImport && (
          <ImportDialog onImport={handleImport} onClose={() => setShowImport(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar onImport={() => setShowImport(true)} />

      <div className="workspace">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="shelves-area">
            {project && (
              <>
                <Shelf
                  shelf={project.currentShelf}
                  catalogue={project.catalogue}
                  onAddPlaceholder={() => handleAddPlaceholder('current')}
                  onAddLabel={() => handleAddLabel('current')}
                />

                <SankeyFlow
                  currentShelf={project.currentShelf}
                  futureShelf={project.futureShelf}
                  links={project.sankeyLinks}
                  catalogue={project.catalogue}
                  onRemoveLink={removeLink}
                />

                <Shelf
                  shelf={project.futureShelf}
                  catalogue={project.catalogue}
                  onAddPlaceholder={() => handleAddPlaceholder('future')}
                  onAddLabel={() => handleAddLabel('future')}
                />
              </>
            )}
          </div>

          <Catalogue
            products={project?.catalogue || []}
            onImport={() => setShowImport(true)}
          />

          <DragOverlay>
            {activeItem && (
              <ProductCard
                item={activeItem.item}
                product={activeItem.product}
                overlay
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {showImport && (
        <ImportDialog onImport={handleImport} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}

export default App;
