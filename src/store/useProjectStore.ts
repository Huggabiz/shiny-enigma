import { create } from 'zustand';
import type { Product, Project, Shelf, ShelfItem, ShelfLabel, SankeyLink } from '../types';

interface ProjectStore {
  project: Project | null;
  selectedItemId: string | null;
  linkMode: boolean;
  linkSource: string | null;
  assumeContinuity: boolean;

  // Project actions
  createProject: (name: string, catalogue: Product[]) => void;
  loadProject: (project: Project) => void;
  updateProjectName: (name: string) => void;

  // Catalogue actions
  setCatalogue: (products: Product[]) => void;
  clearCatalogue: () => void;

  // Shelf actions
  addItemToShelf: (shelfId: string, item: ShelfItem) => void;
  removeItemFromShelf: (shelfId: string, itemId: string) => void;
  reorderShelfItems: (shelfId: string, items: ShelfItem[]) => void;
  updateShelfItem: (shelfId: string, itemId: string, updates: Partial<ShelfItem>) => void;

  // Label actions
  addLabel: (shelfId: string, label: ShelfLabel) => void;
  updateLabel: (shelfId: string, labelId: string, updates: Partial<ShelfLabel>) => void;
  removeLabel: (shelfId: string, labelId: string) => void;

  // Sankey actions
  addLink: (link: SankeyLink) => void;
  removeLink: (sourceId: string, targetId: string) => void;
  updateLink: (sourceId: string, targetId: string, updates: Partial<SankeyLink>) => void;
  clearLinks: () => void;
  autoLinkMatchingProducts: () => void;
  recalculateLinkVolumes: () => void;

  // Matrix layout
  updateMatrixLayout: (shelfId: string, layout: Partial<import('../types').MatrixLayout>) => void;
  setMatrixAssignment: (shelfId: string, itemId: string, row: number, col: number) => void;
  removeMatrixAssignment: (shelfId: string, itemId: string) => void;

  // Selection
  setSelectedItem: (id: string | null) => void;
  setLinkMode: (enabled: boolean) => void;
  setLinkSource: (id: string | null) => void;
  setAssumeContinuity: (enabled: boolean) => void;
}

const createEmptyShelf = (id: string, name: string, projectName: string): Shelf => ({
  id,
  name,
  items: [],
  labels: [],
  matrixLayout: {
    title: projectName,
    xLabels: ['Entry', 'Core', 'Premium'],
    yLabels: ['Category 1', 'Category 2'],
    assignments: [],
  },
});

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  selectedItemId: null,
  linkMode: false,
  linkSource: null,
  assumeContinuity: true,

  createProject: (name, catalogue) => {
    set({
      project: {
        name,
        currentShelf: createEmptyShelf('current', 'Current Range', name),
        futureShelf: createEmptyShelf('future', 'Future Range', name),
        sankeyLinks: [],
        catalogue,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  loadProject: (project) => {
    set({ project, selectedItemId: null, linkMode: false, linkSource: null });
  },

  updateProjectName: (name) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, name, updatedAt: new Date().toISOString() } });
  },

  setCatalogue: (newProducts) => {
    const { project } = get();
    if (!project) return;

    // Build lookup of new products by SKU
    const newBySku = new Map(newProducts.map((p) => [p.sku, p]));

    // Update existing catalogue products with new data, keeping IDs stable
    const updatedCatalogue = newProducts.map((p) => {
      // Check if this SKU already existed in the old catalogue
      const existing = project.catalogue.find((old) => old.sku === p.sku);
      if (existing) {
        // Preserve the old ID so shelf references remain valid
        return { ...p, id: existing.id };
      }
      return p;
    });

    // Find products on shelves whose SKU is missing from the new import
    const allShelfItems = [...project.currentShelf.items, ...project.futureShelf.items];
    const missingProducts: string[] = [];
    for (const item of allShelfItems) {
      if (item.isPlaceholder || !item.productId) continue;
      const oldProduct = project.catalogue.find((p) => p.id === item.productId);
      if (!oldProduct) continue;
      if (!newBySku.has(oldProduct.sku)) {
        missingProducts.push(oldProduct.name || oldProduct.sku);
        // Keep the old product in catalogue so the shelf reference doesn't break
        if (!updatedCatalogue.some((p) => p.id === oldProduct.id)) {
          updatedCatalogue.push(oldProduct);
        }
      }
    }

    set({
      project: { ...project, catalogue: updatedCatalogue, updatedAt: new Date().toISOString() },
    });

    // Return missing products for notification
    if (missingProducts.length > 0) {
      setTimeout(() => {
        alert(`The following products are in your ranges but missing from the new catalogue:\n\n${missingProducts.join('\n')}\n\nThey have been kept with their old data.`);
      }, 100);
    }
  },

  clearCatalogue: () => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, catalogue: [], updatedAt: new Date().toISOString() } });
  },

  addItemToShelf: (shelfId, item) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: { ...shelf, items: [...shelf.items, item] },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removeItemFromShelf: (shelfId, itemId) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: { ...shelf, items: shelf.items.filter((i) => i.id !== itemId) },
        sankeyLinks: project.sankeyLinks.filter(
          (l) => l.sourceItemId !== itemId && l.targetItemId !== itemId
        ),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  reorderShelfItems: (shelfId, items) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: { ...shelf, items },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  updateShelfItem: (shelfId, itemId, updates) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: {
          ...shelf,
          items: shelf.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
        },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  addLabel: (shelfId, label) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: { ...shelf, labels: [...shelf.labels, label] },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  updateLabel: (shelfId, labelId, updates) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: {
          ...shelf,
          labels: shelf.labels.map((l) => (l.id === labelId ? { ...l, ...updates } : l)),
        },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removeLabel: (shelfId, labelId) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    set({
      project: {
        ...project,
        [shelfKey]: { ...shelf, labels: shelf.labels.filter((l) => l.id !== labelId) },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  addLink: (link) => {
    const { project } = get();
    if (!project) return;
    const exists = project.sankeyLinks.some(
      (l) => l.sourceItemId === link.sourceItemId && l.targetItemId === link.targetItemId
    );
    if (exists) return;
    set({
      project: {
        ...project,
        sankeyLinks: [...project.sankeyLinks, link],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removeLink: (sourceId, targetId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        sankeyLinks: project.sankeyLinks.filter(
          (l) => !(l.sourceItemId === sourceId && l.targetItemId === targetId)
        ),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  updateLink: (sourceId, targetId, updates) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        sankeyLinks: project.sankeyLinks.map((l) =>
          l.sourceItemId === sourceId && l.targetItemId === targetId ? { ...l, ...updates } : l
        ),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  clearLinks: () => {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, sankeyLinks: [], updatedAt: new Date().toISOString() },
    });
  },

  // Auto-link: if a productId exists in both current and future, create a 100% transfer link
  autoLinkMatchingProducts: () => {
    const { project } = get();
    if (!project) return;
    const newLinks: SankeyLink[] = [...project.sankeyLinks];

    for (const currentItem of project.currentShelf.items) {
      if (!currentItem.productId) continue;
      const futureItem = project.futureShelf.items.find(
        (fi) => fi.productId === currentItem.productId
      );
      if (!futureItem) continue;
      // Skip if link already exists
      const exists = newLinks.some(
        (l) => l.sourceItemId === currentItem.id && l.targetItemId === futureItem.id
      );
      if (exists) continue;

      const product = project.catalogue.find((p) => p.id === currentItem.productId);
      const volume = product?.volume || 0;
      newLinks.push({
        sourceItemId: currentItem.id,
        targetItemId: futureItem.id,
        percent: 100,
        volume,
        type: 'transfer',
      });
    }

    set({
      project: { ...project, sankeyLinks: newLinks, updatedAt: new Date().toISOString() },
    });
  },

  // Recalculate all link volumes based on source product volume and link percentage
  recalculateLinkVolumes: () => {
    const { project } = get();
    if (!project) return;

    const updatedLinks = project.sankeyLinks.map((link) => {
      const sourceItem = project.currentShelf.items.find((i) => i.id === link.sourceItemId);
      if (!sourceItem) return link;
      const product = project.catalogue.find((p) => p.id === sourceItem.productId);
      const baseVolume = product?.volume || 0;
      return {
        ...link,
        volume: Math.round(baseVolume * (link.percent ?? 100) / 100),
      };
    });

    set({
      project: { ...project, sankeyLinks: updatedLinks, updatedAt: new Date().toISOString() },
    });
  },

  updateMatrixLayout: (shelfId, layoutUpdates) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    const current = shelf.matrixLayout || { title: shelf.name, xLabels: [], yLabels: [], assignments: [] };
    set({
      project: {
        ...project,
        [shelfKey]: { ...shelf, matrixLayout: { ...current, ...layoutUpdates } },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  setMatrixAssignment: (shelfId, itemId, row, col) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    const layout = shelf.matrixLayout || { title: shelf.name, xLabels: [], yLabels: [], assignments: [] };
    const filtered = layout.assignments.filter((a) => a.itemId !== itemId);
    set({
      project: {
        ...project,
        [shelfKey]: {
          ...shelf,
          matrixLayout: { ...layout, assignments: [...filtered, { itemId, row, col }] },
        },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removeMatrixAssignment: (shelfId, itemId) => {
    const { project } = get();
    if (!project) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = project[shelfKey];
    const layout = shelf.matrixLayout;
    if (!layout) return;
    set({
      project: {
        ...project,
        [shelfKey]: {
          ...shelf,
          matrixLayout: { ...layout, assignments: layout.assignments.filter((a) => a.itemId !== itemId) },
        },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLinkMode: (enabled) => set({ linkMode: enabled, linkSource: enabled ? get().linkSource : null }),
  setLinkSource: (id) => set({ linkSource: id }),
  setAssumeContinuity: (enabled) => set({ assumeContinuity: enabled }),
}));
