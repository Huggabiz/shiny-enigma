import { useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import './LensSidebar.css';

/**
 * LensSidebar — sits at the bottom of the .plan-tree-panel and lists
 * the catalogue lenses for the current project. See types/Lens for the
 * data model and the project README for the feature overview.
 *
 * Behaviour:
 *   - Click a lens row to activate / deactivate it. The active lens
 *     tints every product card whose product is "in" the lens.
 *   - Click the pencil button on a custom lens to enter edit mode.
 *     While edit mode is on, clicking matrix cards toggles their
 *     product's membership in the lens. Edit also force-activates
 *     the lens so the user sees the tint feedback.
 *   - Built-in lenses (Dev) can't be deleted, renamed, or edited.
 *     The Dev lens has implicit membership: any product with
 *     `source === 'dev'`.
 */
export function LensSidebar() {
  const {
    project,
    createLens,
    removeLens,
    renameLens,
    setActiveLens,
    setEditingLens,
    cycleLensColor,
  } = useProjectStore();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'per-stage'>('global');
  const [renamingId, setRenamingId] = useState<string | null>(null);

  if (!project) return null;
  const lenses = project.lenses ?? [];
  const activeLensId = project.activeLensId ?? null;
  const editingLensId = project.editingLensId ?? null;

  const commitNew = () => {
    const trimmed = newName.trim();
    if (trimmed) createLens(trimmed, newScope);
    setNewName('');
    setNewScope('global');
    setAdding(false);
  };

  const commitRename = (lensId: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) renameLens(lensId, trimmed);
    setRenamingId(null);
  };

  return (
    <div className="lens-sidebar">
      <div className="lens-sidebar-header">
        <h3><span className="lens-icon" aria-hidden>⌕</span> Lenses</h3>
        <button className="lens-add-btn" onClick={() => setAdding(true)} title="New lens">+ New</button>
      </div>
      <div className="lens-list">
        {lenses.map((lens) => {
          const isActive = activeLensId === lens.id;
          const isEditing = editingLensId === lens.id;
          const isBuiltIn = !!lens.builtInKind;
          const isPerStage = lens.scope === 'per-stage';
          // For global lenses show productIds count; for per-stage show
          // unique SKU count across all stages.
          let memberCount: number | null = null;
          if (!isBuiltIn) {
            if (isPerStage && lens.stageProductIds) {
              const unique = new Set<string>();
              for (const ids of Object.values(lens.stageProductIds)) {
                for (const id of ids) unique.add(id);
              }
              memberCount = unique.size;
            } else {
              memberCount = lens.productIds.length;
            }
          }
          // Built-in lenses (currently just Dev) are always-on and not
          // selectable — clicking the row is a no-op so the lens entry
          // is just a label in the list.
          const handleRowClick = isBuiltIn
            ? undefined
            : () => setActiveLens(isActive ? null : lens.id);
          return (
            <div
              key={lens.id}
              className={`lens-item ${isBuiltIn ? 'built-in' : ''} ${isActive ? 'active' : ''} ${isEditing ? 'editing' : ''}`}
              onClick={handleRowClick}
              title={isBuiltIn ? 'Always on' : (isActive ? 'Click to deactivate' : 'Click to activate')}
            >
              <span
                className={`lens-swatch ${isEditing ? 'cyclable' : ''}`}
                style={{ background: lens.color }}
                onClick={isEditing ? (e) => { e.stopPropagation(); cycleLensColor(lens.id); } : undefined}
                title={isEditing ? 'Click to cycle colour' : undefined}
              />
              {renamingId === lens.id ? (
                <input
                  className="lens-name-input"
                  defaultValue={lens.name}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => commitRename(lens.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span
                  className="lens-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!isBuiltIn) setRenamingId(lens.id);
                  }}
                  title={isBuiltIn ? 'Built-in lens' : 'Double-click to rename'}
                >
                  {lens.name}
                  {isPerStage && <span className="lens-scope-tag">per-stage</span>}
                  {memberCount !== null && <span className="lens-member-count"> · {memberCount}</span>}
                </span>
              )}
              {isBuiltIn && (
                <span className="lens-builtin-tag">always on</span>
              )}
              {!isBuiltIn && (
                <>
                  <button
                    className={`lens-edit ${isEditing ? 'on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingLens(isEditing ? null : lens.id);
                    }}
                    title={isEditing ? 'Stop editing membership' : 'Click cards to add/remove from this lens'}
                  >✎</button>
                  <button
                    className="lens-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete lens "${lens.name}"?`)) removeLens(lens.id);
                    }}
                    title="Delete lens"
                  >×</button>
                </>
              )}
            </div>
          );
        })}
        {adding && (
          <div className="lens-item adding">
            <span className="lens-swatch placeholder" />
            <input
              className="lens-name-input"
              placeholder="Lens name…"
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNew();
                if (e.key === 'Escape') { setAdding(false); setNewName(''); setNewScope('global'); }
              }}
            />
            <select
              className="lens-scope-select"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as 'global' | 'per-stage')}
              onClick={(e) => e.stopPropagation()}
              title="Scope: global applies everywhere; per-stage applies independently per stage"
            >
              <option value="global">Global</option>
              <option value="per-stage">Per-stage</option>
            </select>
            <button className="lens-add-confirm" onClick={commitNew} disabled={!newName.trim()} title="Create lens">✓</button>
            <button className="lens-add-cancel" onClick={() => { setAdding(false); setNewName(''); setNewScope('global'); }} title="Cancel">×</button>
          </div>
        )}
      </div>
    </div>
  );
}
