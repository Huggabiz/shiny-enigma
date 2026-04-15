// Project-append import logic. Given a master Project and an
// imported Project, compute the merged result as a dry run so the
// UI can show a preview dialog before the user commits. No side
// effects — `computeImportPlan` is a pure function and returns the
// fully-merged next-project state plus a summary for display.
//
// Decisions (from spec):
//   Q1  Catalogue matched by SKU.
//   Q2  Imported products NOT found in master catalogue are left as
//       orphan shelf items (`orphanSku` set); we do NOT add them to
//       the master catalogue, and we surface the count + SKUs in the
//       summary so the caller can show a follow-up popup.
//   Q3  Master catalogue always wins — imported product data is
//       discarded when a SKU match exists.
//   Q4  Lens name collisions merge (union of productIds).
//   Q5  Custom lens assignments are preserved across import; built-in
//       Dev lens is skipped (implicit membership).
//   Q6  Folder name collisions merge into the existing folder;
//       brand-new folders are appended to the end of the list.
//   Q7  activeLensId / editingLensId / multiplanView / activePlanId
//       and the master catalogue itself are NOT touched.

import type {
  Lens,
  MatrixLayout,
  PlanFolder,
  Project,
  RangePlan,
  RangeVariant,
  SankeyLink,
  ShelfItem,
} from '../types';
import { LENS_PALETTE } from '../types';

export interface ImportPlanSummary {
  planCount: number;
  /** Plans whose name collided with an existing plan, rename record. */
  renamedPlans: Array<{ originalName: string; newName: string }>;
  newLenses: string[];      // names of lenses new to the master
  mergedLenses: string[];   // names of lenses merged into an existing master lens
  newFolders: string[];
  mergedFolders: string[];
  /** Number of shelf items whose SKU matched a master product. */
  matchedItemCount: number;
  /** Number of shelf items that had a productId but no matching SKU
   * in the master catalogue — each of these becomes an orphan. */
  orphanItemCount: number;
  /** Unique SKUs for the orphan items (deduplicated). */
  orphanSkus: string[];
}

export interface ImportPlanPreview {
  summary: ImportPlanSummary;
  /** The fully-resolved merged project. The caller sets this on the
   * store via `appendImport(nextProject)` to apply the import. */
  nextProject: Project;
}

/** Fresh id helper. Mixes a counter into the Date.now timestamp so
 * successive calls in the same tick can't collide. Mirrors the
 * existing id-generation style across the store. */
function makeIdFactory(prefix: string) {
  let counter = 0;
  return () => {
    counter++;
    return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
  };
}

export function computeImportPlan(master: Project, imported: Project): ImportPlanPreview {
  // Build the master SKU → product id map once. Any imported shelf
  // item whose product's SKU is in here gets its productId rewritten
  // to the master's value; anything else is left as an orphan.
  const skuToMasterId = new Map<string, string>();
  for (const p of master.catalogue) {
    if (p.sku) skuToMasterId.set(p.sku, p.id);
  }

  // Imported product id → { masterId: string | null, sku: string }
  // masterId is null when the imported product's SKU isn't in master.
  // sku is preserved so orphan items can display it.
  const importedProductResolution = new Map<string, { masterId: string | null; sku: string }>();
  for (const p of imported.catalogue) {
    const masterId = p.sku ? skuToMasterId.get(p.sku) ?? null : null;
    importedProductResolution.set(p.id, { masterId, sku: p.sku ?? '' });
  }

  // ------------------------------------------------------------
  // Folder merge by name.
  // ------------------------------------------------------------
  const masterFoldersByName = new Map<string, PlanFolder>();
  for (const f of master.folders ?? []) masterFoldersByName.set(f.name, f);
  const importedFolderIdToResolved = new Map<string, string>();
  const addedFolders: PlanFolder[] = [];
  const mergedFolderNames: string[] = [];
  const newFolderNames: string[] = [];
  let nextFolderOrder = (master.folders ?? []).length;
  const folderIdFactory = makeIdFactory('folder');
  for (const f of imported.folders ?? []) {
    const existing = masterFoldersByName.get(f.name);
    if (existing) {
      importedFolderIdToResolved.set(f.id, existing.id);
      mergedFolderNames.push(f.name);
    } else {
      const newId = folderIdFactory();
      addedFolders.push({ id: newId, name: f.name, order: nextFolderOrder++ });
      importedFolderIdToResolved.set(f.id, newId);
      newFolderNames.push(f.name);
    }
  }

  // ------------------------------------------------------------
  // Plan import — fresh ids everywhere, remap shelf items, variants,
  // matrix assignments, and sankey links. Rename on name collision.
  // ------------------------------------------------------------
  const existingPlanNames = new Set(master.plans.map((p) => p.name));
  const renamedPlans: ImportPlanSummary['renamedPlans'] = [];
  const newPlans: RangePlan[] = [];
  const orphanSkus = new Set<string>();
  let matchedItemCount = 0;
  let orphanItemCount = 0;
  const planIdFactory = makeIdFactory('plan');
  const variantIdFactory = makeIdFactory('var');
  const itemIdFactory = makeIdFactory('item');

  for (const plan of imported.plans) {
    // Resolve the plan's final name. If it clashes, try "<name>
    // (Import)" and fall back to "(Import 2)", "(Import 3)" etc.
    const originalName = plan.name;
    let finalName = plan.name;
    if (existingPlanNames.has(finalName)) {
      finalName = `${plan.name} (Import)`;
      let n = 2;
      while (existingPlanNames.has(finalName)) {
        finalName = `${plan.name} (Import ${n++})`;
      }
      renamedPlans.push({ originalName, newName: finalName });
    }
    existingPlanNames.add(finalName);

    // Old shelf-item id → new shelf-item id. Populated as we remap
    // current and future shelves; reused to rewrite sankey link
    // endpoints and variant inclusion lists.
    const oldItemIdToNew = new Map<string, string>();

    const remapItem = (item: ShelfItem): ShelfItem => {
      const newId = itemIdFactory();
      oldItemIdToNew.set(item.id, newId);

      // Placeholder items are self-contained — no product lookup.
      if (item.isPlaceholder || !item.productId) {
        return { ...item, id: newId };
      }
      const resolution = importedProductResolution.get(item.productId);
      if (resolution?.masterId) {
        matchedItemCount++;
        return { ...item, id: newId, productId: resolution.masterId };
      }
      // Orphan — preserve the original productId (harmless; won't
      // match anything in master) AND the SKU so the card can show
      // "(Not in catalogue)" + SKU. The id remap still applies.
      orphanItemCount++;
      const sku = resolution?.sku ?? '';
      if (sku) orphanSkus.add(sku);
      return { ...item, id: newId, orphanSku: sku };
    };

    const newCurrentItems = plan.currentShelf.items.map(remapItem);
    const newFutureItems = plan.futureShelf.items.map(remapItem);

    const remapMatrix = (layout: MatrixLayout | undefined): MatrixLayout | undefined => {
      if (!layout) return undefined;
      return {
        ...layout,
        assignments: layout.assignments
          .map((a) => {
            const newItemId = oldItemIdToNew.get(a.itemId);
            if (!newItemId) return null;
            return { ...a, itemId: newItemId };
          })
          .filter((a): a is NonNullable<typeof a> => a !== null),
      };
    };

    const newSankeyLinks: SankeyLink[] = plan.sankeyLinks
      .map((link) => {
        const sourceItemId = oldItemIdToNew.get(link.sourceItemId);
        const targetItemId = oldItemIdToNew.get(link.targetItemId);
        if (!sourceItemId || !targetItemId) return null;
        return { ...link, sourceItemId, targetItemId };
      })
      .filter((l): l is SankeyLink => l !== null);

    const newVariants: RangeVariant[] = plan.variants.map((v) => ({
      ...v,
      id: variantIdFactory(),
      includedCurrentItemIds: v.includedCurrentItemIds
        .map((id) => oldItemIdToNew.get(id))
        .filter((id): id is string => !!id),
      includedFutureItemIds: v.includedFutureItemIds
        .map((id) => oldItemIdToNew.get(id))
        .filter((id): id is string => !!id),
    }));

    const resolvedFolderId = plan.folderId
      ? importedFolderIdToResolved.get(plan.folderId)
      : undefined;

    newPlans.push({
      ...plan,
      id: planIdFactory(),
      name: finalName,
      folderId: resolvedFolderId,
      currentShelf: {
        ...plan.currentShelf,
        items: newCurrentItems,
        matrixLayout: remapMatrix(plan.currentShelf.matrixLayout),
      },
      futureShelf: {
        ...plan.futureShelf,
        items: newFutureItems,
        matrixLayout: remapMatrix(plan.futureShelf.matrixLayout),
      },
      sankeyLinks: newSankeyLinks,
      variants: newVariants,
    });
  }

  // ------------------------------------------------------------
  // Lens import — merge by name (union of productIds), remap
  // productIds via the SKU resolution map, skip built-in lenses.
  // ------------------------------------------------------------
  const masterLensesByName = new Map<string, Lens>();
  for (const l of master.lenses ?? []) masterLensesByName.set(l.name, l);
  const nextLenses: Lens[] = [...(master.lenses ?? [])];
  const mergedLensNames: string[] = [];
  const newLensNames: string[] = [];
  const lensIdFactory = makeIdFactory('lens');
  // Running count of custom (non-built-in) lenses so new imports can
  // pick a palette colour via modulo.
  let customLensCount = nextLenses.filter((l) => !l.builtInKind).length;

  for (const impLens of imported.lenses ?? []) {
    if (impLens.builtInKind) continue; // skip Dev — implicit membership
    // Remap productIds from imported space to master space. Drop ids
    // that don't have a master match (orphans can't be tagged in a
    // master-side lens since there's no master product to tag).
    const remappedProductIds: string[] = [];
    for (const pid of impLens.productIds) {
      const resolution = importedProductResolution.get(pid);
      if (resolution?.masterId) remappedProductIds.push(resolution.masterId);
    }

    const existing = masterLensesByName.get(impLens.name);
    if (existing) {
      // Merge — union the two productId lists.
      const merged = Array.from(new Set([...existing.productIds, ...remappedProductIds]));
      const idx = nextLenses.findIndex((l) => l.id === existing.id);
      if (idx >= 0) nextLenses[idx] = { ...existing, productIds: merged };
      mergedLensNames.push(impLens.name);
    } else {
      const color = LENS_PALETTE[customLensCount % LENS_PALETTE.length];
      customLensCount++;
      nextLenses.push({
        id: lensIdFactory(),
        name: impLens.name,
        color,
        productIds: remappedProductIds,
      });
      newLensNames.push(impLens.name);
    }
  }

  const summary: ImportPlanSummary = {
    planCount: newPlans.length,
    renamedPlans,
    newLenses: newLensNames,
    mergedLenses: mergedLensNames,
    newFolders: newFolderNames,
    mergedFolders: mergedFolderNames,
    matchedItemCount,
    orphanItemCount,
    orphanSkus: Array.from(orphanSkus),
  };

  const nextProject: Project = {
    ...master,
    folders: [...(master.folders ?? []), ...addedFolders],
    plans: [...master.plans, ...newPlans],
    lenses: nextLenses,
    updatedAt: new Date().toISOString(),
  };

  return { summary, nextProject };
}
