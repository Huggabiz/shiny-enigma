import { create } from 'zustand';
import type { Product, Project, RangePlan, Shelf, ShelfItem, ShelfLabel, SankeyLink, CardFormat, SlideViewSize, PlanFolder, Lens } from '../types';
import { DEFAULT_CARD_FORMAT, createEmptyPlan, getActivePlan, getStages, DEFAULT_DEV_LENS, LENS_PALETTE } from '../types';

// Helper: update a specific plan in the plans array
function updatePlan(project: Project, planId: string, updater: (plan: RangePlan) => RangePlan): Project {
  return {
    ...project,
    plans: project.plans.map((p) => p.id === planId ? updater(p) : p),
    updatedAt: new Date().toISOString(),
  };
}

// Helper: update a shelf within the active plan. Handles 'current',
// 'future', and 'stage-<id>' keys for intermediate stages.
function updateShelf(project: Project, shelfId: string, updater: (shelf: Shelf) => Shelf): Project {
  const plan = getActivePlan(project);
  if (!plan) return project;
  if (shelfId === 'current') {
    return updatePlan(project, plan.id, (p) => ({
      ...p,
      currentShelf: updater(p.currentShelf),
    }));
  }
  if (shelfId === 'future') {
    return updatePlan(project, plan.id, (p) => ({
      ...p,
      futureShelf: updater(p.futureShelf),
    }));
  }
  // Intermediate stage: key is 'stage-<id>' where id = StageDefinition.id
  const stageId = shelfId.replace('stage-', '');
  return updatePlan(project, plan.id, (p) => ({
    ...p,
    intermediateShelves: (p.intermediateShelves ?? []).map((s) =>
      s.stageId === stageId ? { ...s, shelf: updater(s.shelf) } : s,
    ),
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
  activeView: 'transform' | 'range-design' | 'multiplan' | 'forecast-lab';
  designShelfId: string;
  /** Transform view stage selection — which two stages to compare.
   * Defaults to 'current' and 'future'. Must satisfy from < to in
   * the getStages() order. */
  transformFromKey: string;
  transformToKey: string;
  setActiveView: (view: 'transform' | 'range-design' | 'multiplan' | 'forecast-lab') => void;
  setDesignShelfId: (shelfId: string) => void;
  setTransformStages: (fromKey: string, toKey: string) => void;

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
  /** Replace the current project with a merged state produced by
   * `computeImportPlan` (see src/utils/importProject.ts). Used by
   * the Append import flow — the caller shows a preview dialog and
   * calls this on confirm. */
  appendImport: (nextProject: Project) => void;
  updateProjectName: (name: string) => void;

  // Plan management
  addPlan: (name: string, folderId?: string) => void;
  removePlan: (planId: string) => void;
  /** Deep-clone a plan with fresh IDs for everything (plan, shelves,
   * items, variants, sankey links, matrix assignments). The clone
   * lands in the same folder and becomes the active plan. Name gets
   * a "(Copy)" suffix. */
  duplicatePlan: (planId: string) => void;
  setActivePlan: (planId: string) => void;
  renamePlan: (planId: string, name: string) => void;
  setPlanFolder: (planId: string, folderId: string | undefined) => void;

  // Folder management
  addFolder: (name: string) => void;
  removeFolder: (folderId: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  reorderFolders: (orderedFolderIds: string[]) => void;

  // Multiplan view — ordered list of (plan, variant|master) rows and
  // a global Current/Future shelf-side toggle. See types/MultiplanViewState.
  setMultiplanShelfSide: (side: string) => void;
  toggleMultiplanEntry: (planId: string, variantId: string | null) => void;
  reorderMultiplanEntries: (entries: import('../types').MultiplanEntry[]) => void;
  clearMultiplanEntries: () => void;

  // Lens management — see types/Lens for the data model.
  createLens: (name: string, scope?: 'global' | 'per-stage') => void;
  removeLens: (lensId: string) => void;
  renameLens: (lensId: string, name: string) => void;
  /** Toggle a lens in/out of the active set. Pass null to clear all. */
  setActiveLens: (lensId: string | null) => void;
  setEditingLens: (lensId: string | null) => void;
  toggleLensProduct: (lensId: string, productId: string, stageKey?: string) => void;
  /** Cycle a custom lens's colour to the next palette entry that
   * isn't already in use by another lens. No-op for built-in lenses. */
  cycleLensColor: (lensId: string) => void;

  // Stage management — stages are PROJECT-level (shared across all plans).
  // Each plan stores its own shelf for each stage.
  setCurrentStageLabel: (label: string) => void;
  setFutureStageLabel: (label: string) => void;
  addIntermediateStage: (name: string) => void;
  removeIntermediateStage: (stageId: string) => void;
  renameIntermediateStage: (stageId: string, name: string) => void;

  // Variant management
  activeVariantId: string | null;
  showGhosted: boolean;
  showDiscontinued: boolean;
  exclusiveLensFilter: boolean;
  setActiveVariant: (variantId: string | null) => void;
  setShowGhosted: (show: boolean) => void;
  setShowDiscontinued: (show: boolean) => void;
  setExclusiveLensFilter: (on: boolean) => void;
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

  // Default range assignment (SKU → plan)
  setDefaultPlan: (sku: string, planId: string) => void;

  // Forecast pipeline — now stored per-SKU at project level
  setForecastPipeline: (sku: string, pipeline: import('../types').ForecastPipeline | undefined) => void;

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
  exclusiveLensFilter: false,
  setExclusiveLensFilter: (on) => set({ exclusiveLensFilter: on }),
  catalogueFilters: { search: '', category: '', subCategory: '', family: '', showLive: true, showDev: true, showCore: true, showDuo: true, hideUsed: false },
  setCatalogueFilters: (f) => set((s) => ({ catalogueFilters: { ...s.catalogueFilters, ...f } })),

  activeView: 'range-design',
  designShelfId: 'current',
  transformFromKey: 'current',
  transformToKey: 'future',
  setActiveView: (view) => set({ activeView: view }),
  setDesignShelfId: (shelfId) => set({ designShelfId: shelfId }),
  setTransformStages: (fromKey, toKey) => set({ transformFromKey: fromKey, transformToKey: toKey }),

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
        lenses: [{ ...DEFAULT_DEV_LENS }],
        activeLensIds: [],
        editingLensId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  loadProject: (project) => {
    // Migration: if old format (no plans array), convert
    const migrated = migrateProject(project as unknown as Record<string, unknown>);
    // Lens migration — older projects (pre-1.10) have no lenses field;
    // ensure the built-in Dev lens always exists at index 0 so the UI
    // never has to special-case its presence.
    const ensured = ensureLenses(migrated);
    set({ project: ensured, selectedItemId: null, linkMode: false, linkSource: null });
  },

  appendImport: (nextProject) => {
    // Caller has already produced the fully-merged state via
    // computeImportPlan; just swap it in. selectedItemId / linkMode
    // get reset since the plan/item ids all changed in the merge.
    set({ project: { ...nextProject, updatedAt: new Date().toISOString() }, selectedItemId: null, linkMode: false, linkSource: null });
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

    // Inherit intermediate shelves for any existing project-level
    // stage definitions. Each gets an empty shelf (the user can
    // populate it via the range view). Without this, a new plan in
    // a project that already has stages would be missing shelves
    // for those stages.
    const defs = project.stageDefinitions ?? [];
    if (defs.length > 0) {
      newPlan.intermediateShelves = defs.map((def) => ({
        stageId: def.id,
        shelf: {
          id: `shelf-${def.id}-${newPlan.id}`,
          name: def.name,
          items: [],
          labels: [],
        },
      }));
    }

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

  duplicatePlan: (planId) => {
    const { project } = get();
    if (!project) return;
    const source = project.plans.find((p) => p.id === planId);
    if (!source) return;

    // Build a name that doesn't clash.
    const existingNames = new Set(project.plans.map((p) => p.name));
    let name = `${source.name} (Copy)`;
    let n = 2;
    while (existingNames.has(name)) { name = `${source.name} (Copy ${n++})`; }

    // Fresh ids for every internal entity. A counter + random suffix
    // prevents collisions even in a tight loop.
    let counter = 0;
    const freshId = (prefix: string) => {
      counter++;
      return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
    };

    // Map old shelf-item ids → new ids (used to rewrite links,
    // matrix assignments, and variant inclusion lists).
    const itemIdMap = new Map<string, string>();
    const cloneItems = (items: ShelfItem[]): ShelfItem[] =>
      items.map((item) => {
        const newId = freshId('item');
        itemIdMap.set(item.id, newId);
        return { ...item, id: newId };
      });

    const currentItems = cloneItems(source.currentShelf.items);
    const futureItems = cloneItems(source.futureShelf.items);

    const cloneMatrix = (ml: import('../types').MatrixLayout | undefined) => {
      if (!ml) return undefined;
      return {
        ...ml,
        title: name,
        assignments: ml.assignments
          .map((a) => {
            const newId = itemIdMap.get(a.itemId);
            return newId ? { ...a, itemId: newId } : null;
          })
          .filter((a): a is NonNullable<typeof a> => a !== null),
      };
    };

    const newPlanId = freshId('plan');

    const clonedPlan: RangePlan = {
      ...source,
      id: newPlanId,
      name,
      currentShelf: {
        ...source.currentShelf,
        items: currentItems,
        matrixLayout: cloneMatrix(source.currentShelf.matrixLayout),
      },
      futureShelf: {
        ...source.futureShelf,
        items: futureItems,
        matrixLayout: cloneMatrix(source.futureShelf.matrixLayout),
      },
      sankeyLinks: source.sankeyLinks
        .map((link) => {
          const s = itemIdMap.get(link.sourceItemId);
          const t = itemIdMap.get(link.targetItemId);
          return s && t ? { ...link, sourceItemId: s, targetItemId: t } : null;
        })
        .filter((l): l is NonNullable<typeof l> => l !== null),
      variants: source.variants.map((v) => ({
        ...v,
        id: freshId('var'),
        includedCurrentItemIds: v.includedCurrentItemIds
          .map((id) => itemIdMap.get(id))
          .filter((id): id is string => !!id),
        includedFutureItemIds: v.includedFutureItemIds
          .map((id) => itemIdMap.get(id))
          .filter((id): id is string => !!id),
      })),
    };

    set({
      project: {
        ...project,
        plans: [...project.plans, clonedPlan],
        activePlanId: newPlanId,
        updatedAt: new Date().toISOString(),
      },
      activeVariantId: null,
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

  // Multiplan view — the shelf side is a global Current/Future toggle
  // and the entries are an ordered list of (plan, variant|master)
  // pairs. Entries are stored on the project so they persist across
  // sessions. A (null) variantId means the plan's master range.
  setMultiplanShelfSide: (side) => {
    const { project } = get();
    if (!project) return;
    const current = project.multiplanView ?? { shelfSide: 'current', entries: [] };
    set({
      project: {
        ...project,
        multiplanView: { ...current, shelfSide: side },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  toggleMultiplanEntry: (planId, variantId) => {
    const { project } = get();
    if (!project) return;
    const current = project.multiplanView ?? { shelfSide: 'current' as const, entries: [] };
    const exists = current.entries.some(
      (e) => e.planId === planId && e.variantId === variantId,
    );
    const entries = exists
      ? current.entries.filter((e) => !(e.planId === planId && e.variantId === variantId))
      : [...current.entries, { planId, variantId }];
    set({
      project: {
        ...project,
        multiplanView: { ...current, entries },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  reorderMultiplanEntries: (entries) => {
    const { project } = get();
    if (!project) return;
    const current = project.multiplanView ?? { shelfSide: 'current' as const, entries: [] };
    set({
      project: {
        ...project,
        multiplanView: { ...current, entries },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  clearMultiplanEntries: () => {
    const { project } = get();
    if (!project) return;
    const current = project.multiplanView ?? { shelfSide: 'current' as const, entries: [] };
    set({
      project: {
        ...project,
        multiplanView: { ...current, entries: [] },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  // Lens management — Lens is project-level state. The built-in Dev
  // lens is guaranteed by ensureLenses() at load time and can't be
  // deleted or renamed.
  createLens: (name, scope) => {
    const { project } = get();
    if (!project) return;
    const lenses = project.lenses ?? [];
    const customCount = lenses.filter((l) => !l.builtInKind).length;
    const color = LENS_PALETTE[customCount % LENS_PALETTE.length];
    const newLens: Lens = {
      id: `lens-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      color,
      productIds: [],
      ...(scope === 'per-stage' ? { scope: 'per-stage' as const, stageProductIds: {} } : {}),
    };
    set({
      project: {
        ...project,
        lenses: [...lenses, newLens],
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removeLens: (lensId) => {
    const { project } = get();
    if (!project) return;
    const lens = (project.lenses ?? []).find((l) => l.id === lensId);
    if (!lens || lens.builtInKind) return; // can't delete built-ins
    const lenses = (project.lenses ?? []).filter((l) => l.id !== lensId);
    set({
      project: {
        ...project,
        lenses,
        activeLensIds: (project.activeLensIds ?? []).filter((id) => id !== lensId),
        editingLensId: project.editingLensId === lensId ? null : project.editingLensId,
        updatedAt: new Date().toISOString(),
      },
    });
  },

  renameLens: (lensId, name) => {
    const { project } = get();
    if (!project) return;
    const lenses = (project.lenses ?? []).map((l) =>
      l.id === lensId && !l.builtInKind ? { ...l, name } : l,
    );
    set({ project: { ...project, lenses, updatedAt: new Date().toISOString() } });
  },

  setActiveLens: (lensId) => {
    const { project } = get();
    if (!project) return;
    const current = project.activeLensIds ?? [];
    if (lensId === null) {
      // Clear all
      set({ project: { ...project, activeLensIds: [], editingLensId: null } });
      return;
    }
    const lens = (project.lenses ?? []).find((l) => l.id === lensId);
    if (!lens || lens.builtInKind) return;
    // Toggle in/out of the active set
    const isActive = current.includes(lensId);
    const next = isActive ? current.filter((id) => id !== lensId) : [...current, lensId];
    // If the lens being edited was toggled off, exit edit mode
    const editingLensId = project.editingLensId;
    const shouldClearEditing = editingLensId && !next.includes(editingLensId);
    set({
      project: {
        ...project,
        activeLensIds: next,
        editingLensId: shouldClearEditing ? null : editingLensId,
      },
    });
  },

  setEditingLens: (lensId) => {
    const { project } = get();
    if (!project) return;
    // Built-in lenses can't be in edit mode (implicit membership rules).
    if (lensId) {
      const lens = (project.lenses ?? []).find((l) => l.id === lensId);
      if (!lens || lens.builtInKind) return;
    }
    // Edit mode also activates the lens so the user sees the tint
    // while toggling membership — otherwise it's invisible feedback.
    set({
      project: {
        ...project,
        editingLensId: lensId,
        activeLensIds: lensId ? Array.from(new Set([...(project.activeLensIds ?? []), lensId])) : project.activeLensIds,
      },
    });
  },

  toggleLensProduct: (lensId, productId, stageKey) => {
    const { project } = get();
    if (!project) return;
    const lens = (project.lenses ?? []).find((l) => l.id === lensId);
    if (!lens || lens.builtInKind) return;
    const lenses = (project.lenses ?? []).map((l) => {
      if (l.id !== lensId) return l;
      // Per-stage lens: toggle in stageProductIds[stageKey]
      if (l.scope === 'per-stage' && stageKey) {
        const current = l.stageProductIds?.[stageKey] ?? [];
        const has = current.includes(productId);
        return {
          ...l,
          stageProductIds: {
            ...(l.stageProductIds ?? {}),
            [stageKey]: has ? current.filter((id) => id !== productId) : [...current, productId],
          },
        };
      }
      // Global lens: toggle in productIds (existing behaviour)
      const has = l.productIds.includes(productId);
      return {
        ...l,
        productIds: has
          ? l.productIds.filter((id) => id !== productId)
          : [...l.productIds, productId],
      };
    });
    set({ project: { ...project, lenses, updatedAt: new Date().toISOString() } });
  },

  cycleLensColor: (lensId) => {
    const { project } = get();
    if (!project) return;
    const lenses = project.lenses ?? [];
    const lens = lenses.find((l) => l.id === lensId);
    if (!lens || lens.builtInKind) return; // built-in lens colours are locked
    // Skip colours used by any OTHER lens (excluding self) so cycling
    // never lands on a duplicate. Falls back to the current colour if
    // the palette is exhausted.
    const usedByOthers = new Set(
      lenses.filter((l) => l.id !== lensId).map((l) => l.color),
    );
    const palette = LENS_PALETTE;
    const currentIdx = palette.indexOf(lens.color);
    let nextColor = lens.color;
    for (let i = 1; i <= palette.length; i++) {
      const candidate = palette[(currentIdx + i + palette.length) % palette.length];
      if (!usedByOthers.has(candidate)) {
        nextColor = candidate;
        break;
      }
    }
    if (nextColor === lens.color) return;
    set({
      project: {
        ...project,
        lenses: lenses.map((l) => l.id === lensId ? { ...l, color: nextColor } : l),
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

  // Stage management — stages are PROJECT-level. When a new intermediate
  // is added, every plan in the project gets a shelf for it, seeded from
  // each plan's current shelf (items + matrix layout carried forward).
  setCurrentStageLabel: (label) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, currentStageLabel: label || undefined, updatedAt: new Date().toISOString() } });
  },

  setFutureStageLabel: (label) => {
    const { project } = get();
    if (!project) return;
    set({ project: { ...project, futureStageLabel: label || undefined, updatedAt: new Date().toISOString() } });
  },

  addIntermediateStage: (name) => {
    const { project } = get();
    if (!project) return;
    const stageId = `stage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Add the definition project-level
    const defs = [...(project.stageDefinitions ?? []), { id: stageId, name }];

    // For every plan, create a shelf seeded from the plan's current
    // shelf — items + matrix layout (labels + assignments) so the
    // new stage inherits the full range structure.
    let counter = 0;
    const updatedPlans = project.plans.map((plan) => {
      const itemIdMap = new Map<string, string>();
      const seededItems: ShelfItem[] = plan.currentShelf.items.map((item) => {
        counter++;
        const newId = `item-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
        itemIdMap.set(item.id, newId);
        return { ...item, id: newId };
      });
      // Copy matrix layout with remapped item ids so assignments
      // point at the new shelf items, not the current-shelf ones.
      const sourceLayout = plan.currentShelf.matrixLayout;
      const seededLayout = sourceLayout ? {
        ...sourceLayout,
        title: name,
        assignments: sourceLayout.assignments
          .map((a) => {
            const newId = itemIdMap.get(a.itemId);
            return newId ? { ...a, itemId: newId } : null;
          })
          .filter((a): a is NonNullable<typeof a> => a !== null),
      } : undefined;

      const newShelfEntry = {
        stageId,
        shelf: {
          id: `shelf-${stageId}-${plan.id}`,
          name,
          items: seededItems,
          labels: [],
          matrixLayout: seededLayout,
        } as import('../types').Shelf,
      };
      return {
        ...plan,
        intermediateShelves: [...(plan.intermediateShelves ?? []), newShelfEntry],
      };
    });

    set({
      project: {
        ...project,
        stageDefinitions: defs,
        plans: updatedPlans,
        updatedAt: new Date().toISOString(),
      },
    });
  },

  removeIntermediateStage: (stageId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        stageDefinitions: (project.stageDefinitions ?? []).filter((d) => d.id !== stageId),
        plans: project.plans.map((plan) => ({
          ...plan,
          intermediateShelves: (plan.intermediateShelves ?? []).filter((s) => s.stageId !== stageId),
        })),
        updatedAt: new Date().toISOString(),
      },
    });
  },

  renameIntermediateStage: (stageId, name) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        stageDefinitions: (project.stageDefinitions ?? []).map((d) =>
          d.id === stageId ? { ...d, name } : d,
        ),
        // Also update the shelf name on each plan for consistency
        plans: project.plans.map((plan) => ({
          ...plan,
          intermediateShelves: (plan.intermediateShelves ?? []).map((s) =>
            s.stageId === stageId ? { ...s, shelf: { ...s.shelf, name } } : s,
          ),
        })),
        updatedAt: new Date().toISOString(),
      },
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

    // Orphan re-link — any shelf item left as an orphan by a previous
    // Append import is silently reconnected when the newly-loaded
    // catalogue contains its SKU. productId is rewritten to the
    // new master id and orphanSku is dropped, so the card goes back
    // to rendering normally.
    let relinkedOrphanCount = 0;
    const reanchorItem = (item: import('../types').ShelfItem): import('../types').ShelfItem => {
      if (!item.orphanSku) return item;
      const match = newBySku.get(item.orphanSku);
      if (!match) return item;
      relinkedOrphanCount++;
      // Use the updatedCatalogue's id for this product (which may have
      // been preserved from an existing master product or freshly
      // minted) so plans remain consistent with the catalogue.
      const catalogueEntry = updatedCatalogue.find((p) => p.sku === match.sku);
      const { orphanSku: _dropSku, ...rest } = item;
      void _dropSku;
      return { ...rest, productId: catalogueEntry?.id ?? match.id };
    };
    const relinkedPlans = project.plans.map((p) => ({
      ...p,
      currentShelf: { ...p.currentShelf, items: p.currentShelf.items.map(reanchorItem) },
      futureShelf: { ...p.futureShelf, items: p.futureShelf.items.map(reanchorItem) },
    }));

    set({
      project: {
        ...project,
        plans: relinkedPlans,
        catalogue: updatedCatalogue,
        updatedAt: new Date().toISOString(),
      },
    });

    if (missingProducts.length > 0) {
      setTimeout(() => {
        alert(`Missing from new catalogue:\n\n${[...new Set(missingProducts)].join('\n')}\n\nKept with old data.`);
      }, 100);
    }
    if (relinkedOrphanCount > 0) {
      setTimeout(() => {
        alert(`${relinkedOrphanCount} imported item${relinkedOrphanCount === 1 ? '' : 's'} reconnected to the new catalogue (they were previously marked "(Not in catalogue)").`);
      }, 150);
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

    // Auto-assign default plan: when a product is first placed in any
    // range, tag it as belonging to this plan so the forecast lab
    // knows where to read launch timing from. Keyed by SKU so the
    // mapping survives catalogue reimports.
    if (item.productId) {
      const product = project.catalogue.find((p) => p.id === item.productId);
      const plan = getActivePlan(updated);
      if (product?.sku && plan) {
        const existing = updated.defaultPlanBySku?.[product.sku];
        if (!existing) {
          updated = {
            ...updated,
            defaultPlanBySku: { ...(updated.defaultPlanBySku ?? {}), [product.sku]: plan.id },
          };
        }
      }
    }

    // Cascade forward: when adding a product to a stage, also add it
    // to all SUBSEQUENT stages (including future) so products carry
    // forward through the timeline. Skip if the product is already on
    // the target stage. Each cascade item gets a fresh id.
    if (item.productId) {
      const plan = getActivePlan(updated);
      if (plan) {
        const stages = getStages(plan, updated);
        const sourceIdx = stages.findIndex((s) => s.key === shelfId);
        let counter = 0;
        for (let i = sourceIdx + 1; i < stages.length; i++) {
          const stage = stages[i];
          if (stage.shelf.items.some((si) => si.productId === item.productId)) continue;
          counter++;
          const cascadeItem: ShelfItem = {
            ...item,
            id: `item-${Date.now()}-cascade-${counter}-${Math.random().toString(36).slice(2, 7)}`,
          };
          updated = updateShelf(updated, stage.key, (shelf) => ({
            ...shelf, items: [...shelf.items, cascadeItem],
          }));
        }
      }
    }

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

    // Find the product ID so we can cascade removal to subsequent stages
    const stageList = getStages(plan, project);
    const sourceStage = stageList.find((s) => s.key === shelfId);
    const removedItem = sourceStage?.shelf.items.find((i) => i.id === itemId);
    const removedProductId = removedItem?.productId;

    let updated = updateShelf(project, shelfId, (shelf) => ({
      ...shelf, items: shelf.items.filter((i) => i.id !== itemId),
    }));
    updated = updatePlan(updated, plan.id, (p) => ({
      ...p,
      sankeyLinks: p.sankeyLinks.filter((l) => l.sourceItemId !== itemId && l.targetItemId !== itemId),
      variants: p.variants.map((v) => ({
        ...v,
        includedCurrentItemIds: v.includedCurrentItemIds.filter((id) => id !== itemId),
        includedFutureItemIds: v.includedFutureItemIds.filter((id) => id !== itemId),
      })),
    }));

    // Cascade: remove the same product from all SUBSEQUENT stages
    if (removedProductId) {
      const sourceIdx = stageList.findIndex((s) => s.key === shelfId);
      for (let i = sourceIdx + 1; i < stageList.length; i++) {
        const stage = stageList[i];
        const matchItem = stage.shelf.items.find((si) => si.productId === removedProductId);
        if (!matchItem) continue;
        updated = updateShelf(updated, stage.key, (shelf) => ({
          ...shelf, items: shelf.items.filter((si) => si.id !== matchItem.id),
        }));
        // Also clean up sankey links + variant refs for the cascaded item
        const updatedPlan = getActivePlan(updated);
        if (updatedPlan) {
          updated = updatePlan(updated, updatedPlan.id, (p) => ({
            ...p,
            sankeyLinks: p.sankeyLinks.filter((l) => l.sourceItemId !== matchItem.id && l.targetItemId !== matchItem.id),
            variants: p.variants.map((v) => ({
              ...v,
              includedCurrentItemIds: v.includedCurrentItemIds.filter((id) => id !== matchItem.id),
              includedFutureItemIds: v.includedFutureItemIds.filter((id) => id !== matchItem.id),
            })),
          }));
        }
      }
    }

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
    // Resolve the shelf via the same stage-key logic updateShelf uses.
    const stageList = getStages(plan, project);
    const stage = stageList.find((s) => s.key === shelfId);
    if (!stage) return;
    const shelf = stage.shelf;
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

  // Default range assignment
  setDefaultPlan: (sku, planId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        defaultPlanBySku: { ...(project.defaultPlanBySku ?? {}), [sku]: planId },
        updatedAt: new Date().toISOString(),
      },
    });
  },

  // Forecast pipeline — stored per-SKU at project level so the
  // forecast is global (not tied to a specific shelf placement).
  setForecastPipeline: (sku, pipeline) => {
    const { project } = get();
    if (!project) return;
    const pipelines = { ...(project.forecastPipelines ?? {}) };
    if (pipeline) {
      pipelines[sku] = pipeline;
    } else {
      delete pipelines[sku];
    }
    set({
      project: {
        ...project,
        forecastPipelines: pipelines,
        updatedAt: new Date().toISOString(),
      },
    });
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
    let updated = updateShelf(project, shelfId, (shelf) => {
      const layout = shelf.matrixLayout || { title: '', xLabels: [], yLabels: [], assignments: [] };
      const filtered = layout.assignments.filter((a) => a.itemId !== itemId);
      return { ...shelf, matrixLayout: { ...layout, assignments: [...filtered, { itemId, row, col }] } };
    });

    // Cascade the matrix placement forward: if subsequent stages
    // have the same product (matched by productId) and that item
    // isn't already placed in the matrix, give it the same (row, col).
    const plan = getActivePlan(updated);
    if (plan) {
      const stageList = getStages(plan, updated);
      const sourceIdx = stageList.findIndex((s) => s.key === shelfId);
      const sourceItem = stageList[sourceIdx]?.shelf.items.find((i) => i.id === itemId);
      if (sourceItem?.productId) {
        for (let i = sourceIdx + 1; i < stageList.length; i++) {
          const stage = stageList[i];
          const match = stage.shelf.items.find((si) => si.productId === sourceItem.productId);
          if (!match) continue;
          const alreadyPlaced = stage.shelf.matrixLayout?.assignments.some((a) => a.itemId === match.id);
          if (alreadyPlaced) continue;
          updated = updateShelf(updated, stage.key, (shelf) => {
            const ml = shelf.matrixLayout || { title: '', xLabels: [], yLabels: [], assignments: [] };
            return { ...shelf, matrixLayout: { ...ml, assignments: [...ml.assignments, { itemId: match.id, row, col }] } };
          });
        }
      }
    }

    set({ project: updated });
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

// Lens migration: guarantees the project has a `lenses` array with the
// built-in Dev lens at index 0. Called after migrateProject so older
// files without the field load cleanly. Idempotent — running it on a
// project that already has the Dev lens leaves it alone.
function ensureLenses(project: Project): Project {
  const lenses = project.lenses ?? [];
  const hasDev = lenses.some((l) => l.builtInKind === 'dev');
  if (hasDev) return project;
  return {
    ...project,
    lenses: [{ ...DEFAULT_DEV_LENS }, ...lenses],
    activeLensIds: project.activeLensIds ?? [],
    editingLensId: project.editingLensId ?? null,
  };
}

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
