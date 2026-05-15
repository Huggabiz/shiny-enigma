import { useMemo, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { CloseIcon } from './Icons';
import { NameDialog } from './NameDialog';
import { LensSidebar } from './LensSidebar';
import type { PlanFolder, RangePlan } from '../types';
import './PlanTree.css';

const UNFILED_KEY = '__unfiled__';

/** Key used when dragging a plan via HTML5 DnD — kept minimal so we can
 * drop onto a folder header and just call setPlanFolder. */
const DND_MIME = 'application/x-range-plan-id';

export function PlanTree() {
  const {
    project, addPlan, removePlan, duplicatePlan, setActivePlan, setShowPlanTree,
    activeVariantId, setActiveVariant, addVariant, removeVariant,
    addFolder, removeFolder, renameFolder, setPlanFolder,
    activeView, toggleMultiplanEntry,
  } = useProjectStore();
  const isMultiplan = activeView === 'multiplan';
  // Fast lookup so each row can tell if its (planId, variantId|null)
  // pair is already in the multiplan view entries list.
  const multiplanKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const e of project?.multiplanView?.entries ?? []) {
      set.add(`${e.planId}:${e.variantId ?? ''}`);
    }
    return set;
  }, [project?.multiplanView?.entries]);
  // Track collapsed plans (not expanded) so new plans default to expanded.
  const [collapsedPlans, setCollapsedPlans] = useState<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<
    | { kind: 'plan'; folderId?: string }
    | { kind: 'folder' }
    | { kind: 'variant'; planId: string }
    | null
  >(null);
  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null);

  const folders = useMemo<PlanFolder[]>(() => {
    if (!project?.folders) return [];
    return [...project.folders].sort((a, b) => a.order - b.order);
  }, [project]);

  // Bucket plans by folder. Unknown / missing folder IDs fall through to
  // the Unfiled bucket so deleting a folder never orphans a plan visually.
  const plansByFolder = useMemo(() => {
    const map = new Map<string, RangePlan[]>();
    map.set(UNFILED_KEY, []);
    for (const f of folders) map.set(f.id, []);
    if (!project) return map;
    for (const plan of project.plans) {
      const key = plan.folderId && map.has(plan.folderId) ? plan.folderId : UNFILED_KEY;
      map.get(key)!.push(plan);
    }
    return map;
  }, [project, folders]);

  if (!project) return null;

  const handleNew = () => setNameDialog({ kind: 'plan' });
  const handleNewInFolder = (folderId: string) => setNameDialog({ kind: 'plan', folderId });
  const handleNewFolder = () => setNameDialog({ kind: 'folder' });
  const handleNewVariant = (planId: string) => setNameDialog({ kind: 'variant', planId });

  const handleNameSave = (name: string) => {
    if (!nameDialog) return;
    if (nameDialog.kind === 'plan') {
      addPlan(name, nameDialog.folderId);
    } else if (nameDialog.kind === 'folder') {
      addFolder(name);
    } else {
      addVariant(nameDialog.planId, name);
    }
    setNameDialog(null);
  };

  const existingPlanNames = project.plans.map((p) => p.name);
  const existingFolderNames = folders.map((f) => f.name);
  const variantPlan = nameDialog?.kind === 'variant'
    ? project.plans.find((p) => p.id === nameDialog.planId)
    : undefined;
  const existingVariantNames = variantPlan?.variants.map((v) => v.name) ?? [];

  const toggleExpand = (planId: string) => {
    setCollapsedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId); else next.add(planId);
      return next;
    });
  };

  const toggleFolder = (folderKey: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey); else next.add(folderKey);
      return next;
    });
  };

  const handlePlanDragStart = (e: React.DragEvent<HTMLDivElement>, planId: string) => {
    e.dataTransfer.setData(DND_MIME, planId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDragOver = (e: React.DragEvent<HTMLDivElement>, folderKey: string) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverFolderKey !== folderKey) setDragOverFolderKey(folderKey);
  };

  const handleFolderDragLeave = (folderKey: string) => {
    if (dragOverFolderKey === folderKey) setDragOverFolderKey(null);
  };

  const handleFolderDrop = (e: React.DragEvent<HTMLDivElement>, folderKey: string) => {
    const planId = e.dataTransfer.getData(DND_MIME);
    setDragOverFolderKey(null);
    if (!planId) return;
    e.preventDefault();
    setPlanFolder(planId, folderKey === UNFILED_KEY ? undefined : folderKey);
  };

  const renderPlan = (plan: RangePlan) => {
    const isActive = plan.id === project.activePlanId;
    const isExpanded = !collapsedPlans.has(plan.id);
    const itemCount = plan.currentShelf.items.length + plan.futureShelf.items.length;
    const hasVariants = plan.variants.length > 0;
    // Plan-row highlight states:
    //   - 'active'        — this plan is selected AND we're on the master (no variant active)
    //   - 'active-parent' — this plan is selected but a variant is active (de-emphasised)
    //   - ''              — not selected
    const planRowState = isActive ? (activeVariantId ? 'active-parent' : 'active') : '';

    const masterKey = `${plan.id}:`;
    const masterInMultiplan = multiplanKeySet.has(masterKey);

    return (
      <div key={plan.id}>
        <div
          className={`plan-tree-item plan-parent ${planRowState}`}
          draggable
          onDragStart={(e) => handlePlanDragStart(e, plan.id)}
        >
          {isMultiplan && (
            <input
              type="checkbox"
              className="plan-tree-multiplan-check"
              checked={masterInMultiplan}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleMultiplanEntry(plan.id, null)}
              title={`${masterInMultiplan ? 'Remove' : 'Add'} ${plan.name} (master) from multiplan view`}
            />
          )}
          {hasVariants ? (
            <button className="plan-tree-expand" onClick={() => toggleExpand(plan.id)}>
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : (
            <div className="plan-tree-expand" />
          )}
          <div className="plan-tree-item-body"
            onClick={() => { setActivePlan(plan.id); setActiveVariant(null); if (hasVariants && !isExpanded) toggleExpand(plan.id); }}>
            <div className="plan-tree-item-icon">▦</div>
            <div className="plan-tree-item-info">
              <div className="plan-tree-item-name">{plan.name}</div>
              <div className="plan-tree-item-meta">{itemCount} products</div>
            </div>
          </div>
          <div className="plan-tree-item-actions">
            <button className="plan-tree-item-add-variant" onClick={(e) => { e.stopPropagation(); handleNewVariant(plan.id); }} title="Add variant">⊕</button>
            <button className="plan-tree-item-duplicate" onClick={(e) => {
              e.stopPropagation();
              duplicatePlan(plan.id);
            }} title="Duplicate plan">⧉</button>
            {!isActive && project.plans.length > 1 && (
              <button className="plan-tree-item-delete" onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${plan.name}"?`)) removePlan(plan.id);
              }}><CloseIcon size={8} color="#fff" /></button>
            )}
          </div>
        </div>

        {isExpanded && hasVariants && plan.variants.map((variant) => {
          const isVarActive = isActive && activeVariantId === variant.id;
          const varCount = variant.includedCurrentItemIds.length + variant.includedFutureItemIds.length;
          const variantKey = `${plan.id}:${variant.id}`;
          const variantInMultiplan = multiplanKeySet.has(variantKey);
          return (
            <div key={variant.id}
              className={`plan-tree-item variant ${isVarActive ? 'active' : ''}`}
              onClick={() => { setActivePlan(plan.id); setActiveVariant(variant.id); }}>
              {isMultiplan && (
                <input
                  type="checkbox"
                  className="plan-tree-multiplan-check variant"
                  checked={variantInMultiplan}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleMultiplanEntry(plan.id, variant.id)}
                  title={`${variantInMultiplan ? 'Remove' : 'Add'} ${plan.name} (${variant.name}) from multiplan view`}
                />
              )}
              <div className="plan-tree-variant-indent" />
              <div className="plan-tree-item-icon variant-icon">○</div>
              <div className="plan-tree-item-info">
                <div className="plan-tree-item-name">{variant.name}</div>
                <div className="plan-tree-item-meta">{varCount} included</div>
              </div>
              <button className="plan-tree-item-delete" onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete variant "${variant.name}"?`)) removeVariant(plan.id, variant.id);
              }}><CloseIcon size={7} color="#fff" /></button>
            </div>
          );
        })}
      </div>
    );
  };

  const renderFolder = (
    folderKey: string,
    label: string,
    plans: RangePlan[],
    deletable: boolean,
    renamable: boolean,
  ) => {
    const isCollapsed = collapsedFolders.has(folderKey);
    const isDropTarget = dragOverFolderKey === folderKey;
    const isEditing = editingFolderId === folderKey;

    return (
      <div
        key={folderKey}
        className={`plan-tree-folder ${isDropTarget ? 'drop-target' : ''}`}
        onDragOver={(e) => handleFolderDragOver(e, folderKey)}
        onDragLeave={() => handleFolderDragLeave(folderKey)}
        onDrop={(e) => handleFolderDrop(e, folderKey)}
      >
        <div className="plan-tree-folder-header">
          <button
            className="plan-tree-expand folder-expand"
            onClick={() => toggleFolder(folderKey)}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span className="plan-tree-folder-icon">{isCollapsed ? '📁' : '📂'}</span>
          {isEditing && renamable ? (
            <input
              className="plan-tree-folder-name-input"
              defaultValue={label}
              autoFocus
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (trimmed && trimmed !== label) renameFolder(folderKey, trimmed);
                setEditingFolderId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingFolderId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="plan-tree-folder-name"
              onClick={() => { if (renamable) setEditingFolderId(folderKey); }}
              title={renamable ? 'Click to rename' : undefined}
            >
              {label}
            </span>
          )}
          <span className="plan-tree-folder-count">{plans.length}</span>
          <button
            className="plan-tree-folder-add"
            onClick={() => handleNewInFolder(folderKey === UNFILED_KEY ? '' : folderKey)}
            title="New plan in this folder"
          >+</button>
          {deletable && (
            <button
              className="plan-tree-folder-delete"
              onClick={() => {
                if (confirm(`Delete folder "${label}"? Plans inside it move to Unfiled.`)) {
                  removeFolder(folderKey);
                }
              }}
              title="Delete folder"
            ><CloseIcon size={8} color="#fff" /></button>
          )}
        </div>
        {!isCollapsed && (
          <div className="plan-tree-folder-body">
            {plans.length === 0 ? (
              <div className="plan-tree-folder-empty">Drop plans here</div>
            ) : (
              plans.map(renderPlan)
            )}
          </div>
        )}
      </div>
    );
  };

  const unfiledPlans = plansByFolder.get(UNFILED_KEY) || [];

  return (
    <div className="plan-tree-panel">
      <div className="plan-tree-header">
        <h3>Range Plans</h3>
        <div className="plan-tree-header-actions">
          <button className="plan-tree-new-folder" onClick={handleNewFolder} title="New folder">+ Folder</button>
          <button className="plan-tree-new" onClick={handleNew}>+ New</button>
          <button className="plan-tree-close" onClick={() => setShowPlanTree(false)}><CloseIcon size={10} color="#999" /></button>
        </div>
      </div>

      <div className="plan-tree-list">
        {folders.map((f) =>
          renderFolder(f.id, f.name, plansByFolder.get(f.id) || [], true, true),
        )}
        {/* Always-visible Unfiled bucket so there's a drop target when no
            user folders exist and for plans that never got filed. */}
        {renderFolder(UNFILED_KEY, 'Unfiled', unfiledPlans, false, false)}
      </div>

      {/* Lens selection bar — splits the vertical height with the
          plan list above it. See LensSidebar.tsx. */}
      <LensSidebar />

      {nameDialog && nameDialog.kind === 'plan' && (
        <NameDialog
          title="New Range Plan"
          label="Plan name"
          placeholder="e.g. AW26 Storage"
          submitLabel="Create Plan"
          existingNames={existingPlanNames}
          onSave={handleNameSave}
          onClose={() => setNameDialog(null)}
        />
      )}
      {nameDialog && nameDialog.kind === 'folder' && (
        <NameDialog
          title="New Folder"
          label="Folder name"
          placeholder="e.g. Storage, Kitchenware"
          submitLabel="Create Folder"
          existingNames={existingFolderNames}
          onSave={handleNameSave}
          onClose={() => setNameDialog(null)}
        />
      )}
      {nameDialog && nameDialog.kind === 'variant' && (
        <NameDialog
          title="New Variant"
          label="Variant name"
          placeholder='e.g. "US", "RoW", "EU"'
          submitLabel="Create Variant"
          existingNames={existingVariantNames}
          onSave={handleNameSave}
          onClose={() => setNameDialog(null)}
        />
      )}
    </div>
  );
}
