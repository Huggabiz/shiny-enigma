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

  // Selection
  setSelectedItem: (id: string | null) => void;
  setLinkMode: (enabled: boolean) => void;
  setLinkSource: (id: string | null) => void;
  setAssumeContinuity: (enabled: boolean) => void;
}

const createEmptyShelf = (id: string, name: string): Shelf => ({
  id,
  name,
  items: [],
  labels: [],
});

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  selectedItemId: null,
  linkMode: false,
  linkSource: null,
  assumeContinuity: false,

  createProject: (name, catalogue) => {
    set({
      project: {
        name,
        currentShelf: createEmptyShelf('current', 'Current Range'),
        futureShelf: createEmptyShelf('future', 'Future Range'),
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

  setCatalogue: (products) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, catalogue: products, updatedAt: new Date().toISOString() } });
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

  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLinkMode: (enabled) => set({ linkMode: enabled, linkSource: enabled ? get().linkSource : null }),
  setLinkSource: (id) => set({ linkSource: id }),
  setAssumeContinuity: (enabled) => set({ assumeContinuity: enabled }),
}));
