import { create } from 'zustand';
import type { Product, Project, RangePlan, Shelf, ShelfItem, ShelfLabel, SankeyLink, CardFormat, SlideViewSize, PlanFolder } from '../types';
import { DEFAULT_CARD_FORMAT, createEmptyPlan, getActivePlan } from '../types';

// Helper: update a specific plan in the plans array
function updatePlan(project: Project, planId: string, updater: (plan: RangePlan) => RangePlan): Project {
  return {
    ...project,
    plans: project.plans.map((p) => p.id === planId ? updater(p) : p),
    updatedAt: new Date().toISOString(),
  };
}

// Helper: update a shelf within the active plan
function updateShelf(project: Project, shelfId: string, updater: (shelf: Shelf) => Shelf): Project {
  const plan = getActivePlan(project);
  if (!plan) return project;
  const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
  return updatePlan(project, plan.id, (p) => ({
    ...p,
    [shelfKey]: updater(p[shelfKey]),
  }));
}

interface ProjectStore {
  project: Project | null;
  selectedItemId: string | null;
  linkMode: boolean;
  linkSource: string | null;
  assumeContinuity: boolean;
  cardFormat: CardFormat;
  showPlanTree: boolean;
  catalogueFilters: { search: string; category: string; subCategory: string; family: string; showLive: boolean; showDev: boolean; showCore: boolean; showDuo: boolean; hideUsed: boolean };
  setCatalogueFilters: (f: Partial<{ search: string; category: string; subCategory: string; family: string; showLive: boolean; showDev: boolean; showCore: boolean; showDuo: boolean; hideUsed: boolean }>) => void;

  // Views — lifted out of App local state so the export loop can drive them
  activeView: 'transform' | 'range-design';
  designShelfId: 'current' | 'future';
  setActiveView: (view: 'transform' | 'range-design') => void;
  setDesignShelfId: (shelfId: 'current' | 'future') => void;

  // Slide canvas size — baseScale grows the logical canvas so more content
  // fits without shrinking; zoom is a visual multiplier for navigation.
  // Effective slide base scale for the active plan+view (derived from the
  // plan's slideSettings by App.tsx). Kept in the store so descendant
  // components can read it without prop-drilling, but the source of
  // truth lives on the RangePlan via `slideSettings`.
  slideBaseScale: number;        // 1, 1.25, 1.5, ...
  slideBaseScaleMode: 'auto' | 'manual';
  slideZoom: number;             // 0.5 - 2.0, default 1
  setSlideBaseScale: (scale: number) => void;
  setSlideBaseScaleMode: (mode: 'auto' | 'manual') => void;
  setSlideZoom: (zoom: number) => void;
  /** Persist a slide size override against a specific plan / view. */
  setPlanSlideSize: (
    planId: string,
    view: 'transform' | 'range',
    patch: Partial<SlideViewSize>,
  ) => void;

  // Card format
  setCardFormat: (format: Partial<CardFormat>) => void;

  // Plan tree
  setShowPlanTree: (show: boolean) => void;

  // Project actions
  createProject: (name: string, catalogue: Product[]) => void;
  loadProject: (project: Project) => void;
  updateProjectName: (name: string) => void;

  // Plan management
  addPlan: (name: string, folderId?: string) => void;
  removePlan: (planId: string) => void;
  setActivePlan: (planId: string) => void;
  renamePlan: (planId: string, name: string) => void;
  setPlanFolder: (planId: string, folderId: string | undefined) => void;

  // Folder management
  addFolder: (name: string) => void;
  removeFolder: (folderId: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  reorderFolders: (orderedFolderIds: string[]) => void;

  // Variant management
  activeVariantId: string | null;
  showGhosted: boolean;
  showDiscontinued: boolean;
  setActiveVariant: (variantId: string | null) => void;
  setShowGhosted: (show: boolean) => void;
  setShowDiscontinued: (show: boolean) => void;
  addVariant: (planId: string, name: string) => void;
  removeVariant: (planId: string, variantId: string) => void;
  renameVariant: (planId: string, variantId: string, name: string) => void;
  toggleVariantItem: (variantId: string, shelfId: string, itemId: string) => void;

  // Catalogue actions
  setCatalogue: (products: Product[]) => void;
  clearCatalogue: () => void;
  setFuturePricing: (productId: string, region: 'ukRrp' | 'usRrp' | 'euRrp' | 'ausRrp', value: number | undefined) => void;

  // Shelf actions (operate on active plan)
  addItemToShelf: (shelfId: string, item: ShelfItem) => void;
  removeItemFromShelf: (shelfId: string, itemId: string) => void;
  reorderShelfItems: (shelfId: string, items: ShelfItem[]) => void;
  updateShelfItem: (shelfId: string, itemId: string, updates: Partial<ShelfItem>) => void;

  // Label actions
  addLabel: (shelfId: string, label: ShelfLabel) => void;
  updateLabel: (shelfId: string, labelId: string, updates: Partial<ShelfLabel>) => void;
  removeLabel: (shelfId: string, labelId: string) => void;

  // Sankey actions (operate on active plan)
  addLink: (link: SankeyLink) => void;
  removeLink: (sourceId: string, targetId: string) => void;
  updateLink: (sourceId: string, targetId: string, updates: Partial<SankeyLink>) => void;
  clearLinks: () => void;
  copyCurrentToFuture: () => void;
  reorderShelfByMatrix: (shelfId: string) => void;

  // Matrix layout (operate on active plan)
  updateMatrixLayout: (shelfId: string, layout: Partial<import('../types').MatrixLayout>) => void;
  setMatrixAssignment: (shelfId: string, itemId: string, row: number, col: number) => void;
  removeMatrixAssignment: (shelfId: string, itemId: string) => void;

  // Selection
  setSelectedItem: (id: string | null) => void;
  setLinkMode: (enabled: boolean) => void;
  setLinkSource: (id: string | null) => void;
  setAssumeContinuity: (enabled: boolean) => void;

  // Manage
  clearRanges: () => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  selectedItemId: null,
  linkMode: false,
  linkSource: null,
  assumeContinuity: true,
  cardFormat: { ...DEFAULT_CARD_FORMAT },
  showPlanTree: true,
  activeVariantId: null,
  showGhosted: true,
  showDiscontinued: true,
  catalogueFilters: { search: '', category: '', subCategory: '', family: '', showLive: true, showDev: true, showCore: true, showDuo: true, hideUsed: false },
  setCatalogueFilters: (f) => set((s) => ({ catalogueFilters: { ...s.catalogueFilters, ...f } })),

  activeView: 'range-design',
  designShelfId: 'current',
  setActiveView: (view) => set({ activeView: view }),
  setDesignShelfId: (shelfId) => set({ designShelfId: shelfId }),

  slideBaseScale: 1,
  slideBaseScaleMode: 'auto',
  slideZoom: 1,
  setSlideBaseScale: (scale) => set({ slideBaseScale: scale }),
  setSlideBaseScaleMode: (mode) => set({ slideBaseScaleMode: mode }),
  setSlideZoom: (zoom) => set({ slideZoom: Math.max(0.3, Math.min(3, zoom)) }),

  setPlanSlideSize: (planId, view, patch) => {
    const { project } = get();
    if (!project) return;
    set({
      project: updatePlan(project, planId, (p) => {
        const current: SlideViewSize = p.slideSettings?.[view] ?? { scale: 1, mode: 'auto' };
        return {
          ...p,
          slideSettings: {
            ...(p.slideSettings || {}),
            [view]: { ...current, ...patch },
          },
        };
      }),
    });
  },

  setCardFormat: (updates) => {
    const state = get();
    // Always update the mirrored effective cardFormat so readers
    // immediately see the change.
    const nextMirror = { ...state.cardFormat, ...updates };
    const { project, activeVariantId } = state;
    if (!project) {
      set({ cardFormat: nextMirror });
      return;
    }
    const plan = getActivePlan(project);
    if (!plan) {
      set({ cardFormat: nextMirror });
      return;
    }
    // Persist: when a variant is active, write to the variant's
    // cardFormat override; otherwise write to the plan's cardFormat
    // override. Either way we merge on top of the existing patch so
    // partial updates stack cleanly.
    const updatedProject = updatePlan(project, plan.id, (p) => {
      if (activeVariantId) {
        return {
          ...p,
          variants: p.variants.map((v) =>
            v.id === activeVariantId
              ? { ...v, cardFormat: { ...(v.cardFormat || {}), ...updates } }
              : v,
          ),
        };
      }
      return {
        ...p,
        cardFormat: { ...(p.cardFormat || {}), ...updates },
      };
    });
    set({ project: updatedProject, cardFormat: nextMirror });
  },
  setShowPlanTree: (show) => set({ showPlanTree: show }),

  createProject: (name, catalogue) => {
    const firstPlan = createEmptyPlan('Range Plan 1');
    set({
      project: {
        name,
        plans: [firstPlan],
        activePlanId: firstPlan.id,
        catalogue,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  loadProject: (project) => {
    // Migration: if old format (no plans array), convert
    const migrated = migrateProject(project as unknown as Record<string, unknown>);
    set({ project: migrated, selectedItemId: null, linkMode: false, linkSource: null });
  },

  updateProjectName: (name) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, name, updatedAt: new Date().toISOString() } });
  },

  // Plan management
  addPlan: (name, folderId) => {
    const { project } = get();
    if (!project) return;
    const newPlan = createEmptyPlan(name);
    if (folderId) newPlan.folderId = folderId;
    set({
      project: {
        ...project,
        plans: [...project.plans, newPlan],
        activePlanId: newPlan.id,
        updatedAt: new Date().toISOString(),
      },
      linkMode: false,
      linkSource: null,
    });
  },

  setPlanFolder: (planId, folderId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: updatePlan(project, planId, (p) => {
        const { folderId: _drop, ...rest } = p;
        void _drop;
        return folderId ? { ...rest, folderId } : rest;
      }),
    });
  },

  // Folder management — pure organisational constructs, never referenced
  // by plan internals so changes are localised to Project.folders.
  addFolder: (name) => {
    const { project } = get();
    if (!project) return;
    const folders = project.folders || [];
    const nextOrder = folders.length > 0 ? Math.max(...folders.map((f) => f.order)) + 1 : 0;
    const folder: PlanFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      order: nextOrder,
    };
    set({
      project: { ...project, folders: [...folders, folder], updatedAt: new Date().toISOString() },
    });
  },

  removeFolder: (folderId) => {
    const { project } = get();
    if (!project) return;
    const folders = (project.folders || []).filter((f) => f.id !== folderId);
    // Plans in the removed folder fall back to the "Unfiled" bucket.
    const plans = project.plans.map((p) =>
      p.folderId === folderId ? (({ folderId: _drop, ...rest }) => { void _drop; return rest; })(p) : p,
    );
    set({ project: { ...project, folders, plans, updatedAt: new Date().toISOString() } });
  },

  renameFolder: (folderId, name) => {
    const { project } = get();
    if (!project) return;
    const folders = (project.folders || []).map((f) => f.id === folderId ? { ...f, name } : f);
    set({ project: { ...project, folders, updatedAt: new Date().toISOString() } });
  },

  reorderFolders: (orderedFolderIds) => {
    const { project } = get();
    if (!project) return;
    const folders = project.folders || [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const reordered = orderedFolderIds
      .map((id, idx) => {
        const f = byId.get(id);
        return f ? { ...f, order: idx } : null;
      })
      .filter((f): f is PlanFolder => f !== null);
    // Append any folders that weren't in the ordered list (defensive).
    const leftover = folders.filter((f) => !orderedFolderIds.includes(f.id));
    set({
      project: {
        ...project,
        folders: [...reordered, ...leftover.map((f, i) => ({ ...f, order: reordered.length + i }))],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removePlan: (planId) => {
    const { project } = get();
    if (!project || project.plans.length <= 1) return;
    const remaining = project.plans.filter((p) => p.id !== planId);
    set({
      project: {
        ...project,
        plans: remaining,
        activePlanId: project.activePlanId === planId ? remaining[0].id : project.activePlanId,
        updatedAt: new Date().toISOString(),
      },
      linkMode: false,
      linkSource: null,
    });
  },

  setActivePlan: (planId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, activePlanId: planId },
      linkMode: false,
      linkSource: null,
      selectedItemId: null,
      activeVariantId: null,
    });
  },

  renamePlan: (planId, name) => {
    const { project } = get();
    if (!project) return;
    set({
      project: updatePlan(project, planId, (p) => ({
        ...p,
        name,
        currentShelf: {
          ...p.currentShelf,
          matrixLayout: p.currentShelf.matrixLayout ? { ...p.currentShelf.matrixLayout, title: name } : undefined,
        },
        futureShelf: {
          ...p.futureShelf,
          matrixLayout: p.futureShelf.matrixLayout ? { ...p.futureShelf.matrixLayout, title: name } : undefined,
        },
      })),
    });
  },

  // Variant management
  setActiveVariant: (variantId) => set({ activeVariantId: variantId }),
  setShowGhosted: (show) => set({ showGhosted: show }),
  setShowDiscontinued: (show) => set({ showDiscontinued: show }),

  addVariant: (planId, name) => {
    const { project } = get();
    if (!project) return;
    const plan = project.plans.find((p) => p.id === planId);
    if (!plan) return;
    const variant: import('../types').RangeVariant = {
      id: `var-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      includedCurrentItemIds: plan.currentShelf.items.map((i) => i.id),
      includedFutureItemIds: plan.futureShelf.items.map((i) => i.id),
    };
    set({
      project: updatePlan(project, planId, (p) => ({
        ...p,
        variants: [...p.variants, variant],
      })),
      activeVariantId: variant.id,
    });
  },

  removeVariant: (planId, variantId) => {
    const { project, activeVariantId } = get();
    if (!project) return;
    set({
      project: updatePlan(project, planId, (p) => ({
        ...p,
        variants: p.variants.filter((v) => v.id !== variantId),
      })),
      activeVariantId: activeVariantId === variantId ? null : activeVariantId,
    });
  },

  renameVariant: (planId, variantId, name) => {
    const { project } = get();
    if (!project) return;
    set({
      project: updatePlan(project, planId, (p) => ({
        ...p,
        variants: p.variants.map((v) => v.id === variantId ? { ...v, name } : v),
      })),
    });
  },

  toggleVariantItem: (variantId, shelfId, itemId) => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    const key = shelfId === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
    set({
      project: updatePlan(project, plan.id, (p) => ({
        ...p,
        variants: p.variants.map((v) => {
          if (v.id !== variantId) return v;
          const ids = v[key];
          return {
            ...v,
            [key]: ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId],
          };
        }),
      })),
    });
  },

  // Catalogue
  setCatalogue: (newProducts) => {
    const { project } = get();
    if (!project) return;
    const newBySku = new Map(newProducts.map((p) => [p.sku, p]));
    const updatedCatalogue = newProducts.map((p) => {
      const existing = project.catalogue.find((old) => old.sku === p.sku);
      return existing ? { ...p, id: existing.id } : p;
    });

    // Check all plans for missing products
    const allShelfItems = project.plans.flatMap((plan) => [
      ...plan.currentShelf.items,
      ...plan.futureShelf.items,
    ]);
    const missingProducts: string[] = [];
    for (const item of allShelfItems) {
      if (item.isPlaceholder || !item.productId) continue;
      const oldProduct = project.catalogue.find((p) => p.id === item.productId);
      if (!oldProduct) continue;
      if (!newBySku.has(oldProduct.sku)) {
        missingProducts.push(oldProduct.name || oldProduct.sku);
        if (!updatedCatalogue.some((p) => p.id === oldProduct.id)) {
          updatedCatalogue.push(oldProduct);
        }
      }
    }

    set({ project: { ...project, catalogue: updatedCatalogue, updatedAt: new Date().toISOString() } });

    if (missingProducts.length > 0) {
      setTimeout(() => {
        alert(`Missing from new catalogue:\n\n${[...new Set(missingProducts)].join('\n')}\n\nKept with old data.`);
      }, 100);
    }
  },

  clearCatalogue: () => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, catalogue: [], updatedAt: new Date().toISOString() } });
  },

  // Set/clear a future pricing override on the catalogue product (default horizon)
  setFuturePricing: (productId, region, value) => {
    const { project } = get();
    if (!project) return;
    const newCatalogue = project.catalogue.map((p) => {
      if (p.id !== productId) return p;
      const existing = p.futurePricing || {};
      const defaultHorizon = { ...(existing.default || {}) };
      if (value === undefined || value === null || isNaN(value)) {
        delete defaultHorizon[region];
      } else {
        defaultHorizon[region] = value;
      }
      const newFuturePricing = { ...existing };
      if (Object.keys(defaultHorizon).length === 0) {
        delete newFuturePricing.default;
      } else {
        newFuturePricing.default = defaultHorizon;
      }
      return {
        ...p,
        futurePricing: Object.keys(newFuturePricing).length === 0 ? undefined : newFuturePricing,
      };
    });
    set({
      project: { ...project, catalogue: newCatalogue, updatedAt: new Date().toISOString() },
    });
  },

  // Shelf actions — operate on active plan
  addItemToShelf: (shelfId, item) => {
    const { project, activeVariantId } = get();
    if (!project) return;
    let updated = updateShelf(project, shelfId, (shelf) => ({
      ...shelf, items: [...shelf.items, item],
    }));
    // If adding while viewing a variant, also include the item in that variant
    if (activeVariantId) {
      const plan = getActivePlan(updated);
      if (plan) {
        const key = shelfId === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
        updated = updatePlan(updated, plan.id, (p) => ({
          ...p,
          variants: p.variants.map((v) =>
            v.id === activeVariantId ? { ...v, [key]: [...v[key], item.id] } : v
          ),
        }));
      }
    }
    set({ project: updated });
  },

  removeItemFromShelf: (shelfId, itemId) => {
    const { project, activeVariantId } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;

    // If viewing Master (no active variant), check if item is used in any variant
    if (!activeVariantId) {
      const key = shelfId === 'current' ? 'includedCurrentItemIds' : 'includedFutureItemIds';
      const usedInVariant = plan.variants.some((v) => v[key].includes(itemId));
      if (usedInVariant) {
        alert('This product is included in a variant and cannot be removed from the Master range. Remove it from variants first.');
        return;
      }
    }

    // If viewing a variant, just toggle it off instead of actually removing
    if (activeVariantId) {
      get().toggleVariantItem(activeVariantId, shelfId, itemId);
      return;
    }

    let updated = updateShelf(project, shelfId, (shelf) => ({
      ...shelf, items: shelf.items.filter((i) => i.id !== itemId),
    }));
    updated = updatePlan(updated, plan.id, (p) => ({
      ...p,
      sankeyLinks: p.sankeyLinks.filter((l) => l.sourceItemId !== itemId && l.targetItemId !== itemId),
      // Also remove from all variant inclusion lists
      variants: p.variants.map((v) => ({
        ...v,
        includedCurrentItemIds: v.includedCurrentItemIds.filter((id) => id !== itemId),
        includedFutureItemIds: v.includedFutureItemIds.filter((id) => id !== itemId),
      })),
    }));
    set({ project: updated });
  },

  reorderShelfItems: (shelfId, items) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => ({ ...shelf, items })) });
  },

  updateShelfItem: (shelfId, itemId, updates) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => ({
      ...shelf, items: shelf.items.map((i) => i.id === itemId ? { ...i, ...updates } : i),
    }))});
  },

  // Labels
  addLabel: (shelfId, label) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => ({
      ...shelf, labels: [...shelf.labels, label],
    }))});
  },

  updateLabel: (shelfId, labelId, updates) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => ({
      ...shelf, labels: shelf.labels.map((l) => l.id === labelId ? { ...l, ...updates } : l),
    }))});
  },

  removeLabel: (shelfId, labelId) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => ({
      ...shelf, labels: shelf.labels.filter((l) => l.id !== labelId),
    }))});
  },

  // Sankey
  addLink: (link) => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    if (plan.sankeyLinks.some((l) => l.sourceItemId === link.sourceItemId && l.targetItemId === link.targetItemId)) return;
    set({ project: updatePlan(project, plan.id, (p) => ({
      ...p, sankeyLinks: [...p.sankeyLinks, link],
    }))});
  },

  removeLink: (sourceId, targetId) => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    set({ project: updatePlan(project, plan.id, (p) => ({
      ...p, sankeyLinks: p.sankeyLinks.filter((l) => !(l.sourceItemId === sourceId && l.targetItemId === targetId)),
    }))});
  },

  updateLink: (sourceId, targetId, updates) => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    set({ project: updatePlan(project, plan.id, (p) => ({
      ...p, sankeyLinks: p.sankeyLinks.map((l) =>
        l.sourceItemId === sourceId && l.targetItemId === targetId ? { ...l, ...updates } : l
      ),
    }))});
  },

  clearLinks: () => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    set({ project: updatePlan(project, plan.id, (p) => ({ ...p, sankeyLinks: [] })) });
  },

  copyCurrentToFuture: () => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;

    const newItems: ShelfItem[] = [];
    const newLinks: SankeyLink[] = [...plan.sankeyLinks];
    const currentLayout = plan.currentShelf.matrixLayout;
    const newAssignments: { itemId: string; row: number; col: number }[] = [];

    for (const item of plan.currentShelf.items) {
      if (item.productId && plan.futureShelf.items.some((fi) => fi.productId === item.productId)) continue;
      const newId = `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      newItems.push({ ...item, id: newId });
      const prod = project.catalogue.find((p) => p.id === item.productId);
      newLinks.push({ sourceItemId: item.id, targetItemId: newId, percent: 100, volume: prod?.volume || 0, type: 'transfer' });
      if (currentLayout) {
        const a = currentLayout.assignments.find((a) => a.itemId === item.id);
        if (a) newAssignments.push({ itemId: newId, row: a.row, col: a.col });
      }
    }

    const futureLayout = plan.futureShelf.matrixLayout || { title: plan.name, xLabels: [], yLabels: [], assignments: [] };

    set({ project: updatePlan(project, plan.id, (p) => ({
      ...p,
      futureShelf: {
        ...p.futureShelf,
        items: [...p.futureShelf.items, ...newItems],
        matrixLayout: {
          ...futureLayout,
          xLabels: currentLayout?.xLabels || futureLayout.xLabels,
          yLabels: currentLayout?.yLabels || futureLayout.yLabels,
          assignments: [...futureLayout.assignments, ...newAssignments],
        },
      },
      sankeyLinks: newLinks,
    }))});
  },

  reorderShelfByMatrix: (shelfId) => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    const shelfKey = shelfId === 'current' ? 'currentShelf' : 'futureShelf';
    const shelf = plan[shelfKey];
    const layout = shelf.matrixLayout;
    if (!layout || layout.assignments.length === 0) return;

    const assignmentMap = new Map(layout.assignments.map((a) => [a.itemId, a]));
    const sorted = [...shelf.items].sort((a, b) => {
      const aa = assignmentMap.get(a.id);
      const ba = assignmentMap.get(b.id);
      if (!aa && !ba) return 0;
      if (!aa) return 1;
      if (!ba) return -1;
      if (aa.col !== ba.col) return aa.col - ba.col;
      return aa.row - ba.row;
    }).map((item, idx) => ({ ...item, position: idx }));

    set({ project: updateShelf(project, shelfId, () => ({ ...shelf, items: sorted })) });
  },

  // Matrix layout
  updateMatrixLayout: (shelfId, layoutUpdates) => {
    const { project } = get();
    if (!project) return;
    let updated = updateShelf(project, shelfId, (shelf) => {
      const current = shelf.matrixLayout || { title: '', xLabels: [], yLabels: [], assignments: [] };
      return { ...shelf, matrixLayout: { ...current, ...layoutUpdates } };
    });
    // Sync plan name when title changes
    if (layoutUpdates.title) {
      const plan = getActivePlan(updated);
      if (plan) {
        updated = updatePlan(updated, plan.id, (p) => ({ ...p, name: layoutUpdates.title! }));
      }
    }
    set({ project: updated });
  },

  setMatrixAssignment: (shelfId, itemId, row, col) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => {
      const layout = shelf.matrixLayout || { title: '', xLabels: [], yLabels: [], assignments: [] };
      const filtered = layout.assignments.filter((a) => a.itemId !== itemId);
      return { ...shelf, matrixLayout: { ...layout, assignments: [...filtered, { itemId, row, col }] } };
    })});
    get().reorderShelfByMatrix(shelfId);
  },

  removeMatrixAssignment: (shelfId, itemId) => {
    const { project } = get();
    if (!project) return;
    set({ project: updateShelf(project, shelfId, (shelf) => {
      const layout = shelf.matrixLayout;
      if (!layout) return shelf;
      return { ...shelf, matrixLayout: { ...layout, assignments: layout.assignments.filter((a) => a.itemId !== itemId) } };
    })});
  },

  // Selection
  setSelectedItem: (id) => set({ selectedItemId: id }),
  setLinkMode: (enabled) => set({ linkMode: enabled, linkSource: enabled ? get().linkSource : null }),
  setLinkSource: (id) => set({ linkSource: id }),
  setAssumeContinuity: (enabled) => set({ assumeContinuity: enabled }),

  clearRanges: () => {
    const { project } = get();
    if (!project) return;
    const plan = getActivePlan(project);
    if (!plan) return;
    set({
      project: updatePlan(project, plan.id, (p) => ({
        ...p,
        currentShelf: { ...p.currentShelf, items: [], labels: [],
          matrixLayout: p.currentShelf.matrixLayout ? { ...p.currentShelf.matrixLayout, assignments: [] } : undefined },
        futureShelf: { ...p.futureShelf, items: [], labels: [],
          matrixLayout: p.futureShelf.matrixLayout ? { ...p.futureShelf.matrixLayout, assignments: [] } : undefined },
        sankeyLinks: [],
      })),
      linkMode: false,
      linkSource: null,
    });
  },
}));

// Migration: convert old single-plan projects to multi-plan format.
//
// Backwards-compat contract: projects saved by v1.9.0+ already use the
// multi-plan shape below, so they pass straight through. Any *additive*
// fields introduced since (e.g. `folders`, `folderId`, `slideSettings`,
// per-plan/per-variant `cardFormat`) are optional in the Project/RangePlan
// types, so an older file that omits them still type-checks and every
// reader guards against `undefined`. Newer readers therefore continue to
// load older files without needing explicit version coercion.
function migrateProject(data: Record<string, unknown>): Project {
  // Already new format
  if (Array.isArray(data.plans)) return data as unknown as Project;

  // Old format: has currentShelf/futureShelf at top level
  const old = data as {
    name: string;
    currentShelf: Shelf;
    futureShelf: Shelf;
    sankeyLinks: SankeyLink[];
    catalogue: Product[];
    createdAt: string;
    updatedAt: string;
  };

  const plan: RangePlan = {
    id: `plan-${Date.now()}`,
    name: old.currentShelf.matrixLayout?.title || old.name || 'Range Plan 1',
    currentShelf: old.currentShelf,
    futureShelf: old.futureShelf,
    sankeyLinks: old.sankeyLinks || [],
    variants: [],
  };

  return {
    name: old.name,
    plans: [plan],
    activePlanId: plan.id,
    catalogue: old.catalogue || [],
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
  };
}
