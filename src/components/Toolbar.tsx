import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { saveProject, saveRangeStructure, loadProjectFile } from '../utils/projectFile';
import { computeImportPlan, type ImportPlanPreview } from '../utils/importProject';
import { exportToPptx } from '../utils/exportPptx';
import { exportToExcel } from '../utils/exportExcel';
import { APP_VERSION } from '../version';
import { ImportProjectDialog } from './ImportProjectDialog';
import './Toolbar.css';

interface ToolbarProps {
  activeView?: 'transform' | 'range-design' | 'multiplan' | 'forecast-lab';
}

export function Toolbar({ activeView }: ToolbarProps) {
  const isTransform = activeView === 'transform';
  const {
    project, loadProject, linkMode, setLinkMode, setLinkSource,
    assumeContinuity, setAssumeContinuity,
    clearCatalogue, clearRanges,
    cardFormat, setCardFormat,
    activeVariantId,
    updateProjectName,
  } = useProjectStore();
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);
  const commitProjectName = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && project && trimmed !== project.name) updateProjectName(trimmed);
    setEditingName(false);
  };
  const [exportProgress, setExportProgress] = useState<string | null>(null);

  // Resolve the scope the current format edits apply to — helps the user
  // know whether they're editing the plan default or the active variant.
  const activePlan = project ? project.plans.find((p) => p.id === project.activePlanId) : undefined;
  const activeVariant = activePlan && activeVariantId
    ? activePlan.variants.find((v) => v.id === activeVariantId)
    : undefined;
  const formatScopeLabel = activeVariant
    ? `Saving to variant: ${activeVariant.name}`
    : activePlan
      ? `Saving to plan: ${activePlan.name}`
      : 'Saving to default';
  const loadRef = useRef<HTMLInputElement>(null);
  const appendRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<'save' | 'manage' | 'format' | null>(null);
  const [appendPreview, setAppendPreview] = useState<{ fileName: string; preview: ImportPlanPreview } | null>(null);

  const closeMenus = () => setOpenMenu(null);

  const handleLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const loaded = await loadProjectFile(file);
      loadProject(loaded);
    } catch {
      alert('Failed to load project file. Please check the file format.');
    }
    e.target.value = '';
  };

  // Append import — read a project file and compute the merged
  // result as a dry run, then show the preview dialog. The actual
  // apply happens inside the dialog on confirm via `appendImport`.
  const handleAppend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!project) {
      alert('Load or create a project first before appending.');
      return;
    }
    try {
      const imported = await loadProjectFile(file);
      const preview = computeImportPlan(project, imported);
      setAppendPreview({ fileName: file.name, preview });
    } catch {
      alert('Failed to read the import file. Please check the file format.');
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <span className="toolbar-logo">Range Planner</span>
        <span className="toolbar-version">v{APP_VERSION}</span>
        {project && (
          editingName ? (
            <input
              ref={nameInputRef}
              className="toolbar-project-name-input"
              defaultValue={project.name}
              onBlur={(e) => commitProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitProjectName((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <span
              className="toolbar-project-name"
              onClick={() => setEditingName(true)}
              title="Click to rename project"
            >
              {project.name}
            </span>
          )
        )}
      </div>

      <div className="toolbar-actions">
        {project && (
          <>
            {isTransform && (
              <>
                <label className="toolbar-checkbox" title="Products added to current range auto-add to future">
                  <input type="checkbox" checked={assumeContinuity}
                    onChange={(e) => setAssumeContinuity(e.target.checked)} />
                  <span>Range continuity</span>
                </label>

                <div className="toolbar-divider" />

                <button className={`toolbar-btn ${linkMode ? 'active' : ''}`}
                  onClick={() => { setLinkMode(!linkMode); setLinkSource(null); }}>
                  {linkMode ? 'Exit Forecast' : 'Forecast'}
                </button>
              </>
            )}

            <div className="toolbar-divider" />

            {/* Card Format dropdown */}
            <div className="toolbar-dropdown-wrapper">
              <button className="toolbar-btn" onClick={() => setOpenMenu(openMenu === 'format' ? null : 'format')}>
                Card Format ▾
              </button>
              {openMenu === 'format' && (
                <div className="toolbar-dropdown format-dropdown" onMouseLeave={closeMenus}>
                  <div className="dropdown-title">Show on cards</div>
                  <div className="dropdown-scope">{formatScopeLabel}</div>
                  {([
                    ['showImage', 'Image'],
                    ['showName', 'Product Name'],
                    ['showSku', 'SKU Code'],
                    ['showVolume', 'Volume (last year)'],
                    ['showForecastVolume', 'Forecast Volume (next year)'],
                    ['showRrp', 'UK RRP'],
                    ['showUsRrp', 'US RRP'],
                    ['showEuRrp', 'EU RRP'],
                    ['showAusRrp', 'AUS RRP'],
                    ['showRevenue', 'Revenue (last year)'],
                    ['showForecastRevenue', 'Forecast Revenue (next year)'],
                    ['showCategory', 'Category'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="dropdown-checkbox">
                      <input type="checkbox" checked={cardFormat[key]}
                        onChange={(e) => setCardFormat({ [key]: e.target.checked })} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="toolbar-divider" />

            {/* Save/Export dropdown */}
            <div className="toolbar-dropdown-wrapper">
              <button className="toolbar-btn" onClick={() => setOpenMenu(openMenu === 'save' ? null : 'save')}>
                Save / Export ▾
              </button>
              {openMenu === 'save' && (
                <div className="toolbar-dropdown" onMouseLeave={closeMenus}>
                  <button onClick={async () => {
                    closeMenus();
                    if (!project) return;
                    try { await saveProject(project); }
                    catch (err) { console.error(err); alert('Failed to save project.'); }
                  }}>Save Full Project</button>
                  <button onClick={async () => {
                    closeMenus();
                    if (!project) return;
                    try { await saveRangeStructure(project); }
                    catch (err) { console.error(err); alert('Failed to save range structure.'); }
                  }}>Save Range Structure</button>
                  <hr />
                  <button
                    onClick={async () => {
                      if (!project) return;
                      closeMenus();
                      setExportProgress('Preparing export\u2026');
                      try {
                        await exportToPptx(project, setExportProgress);
                      } catch (err) {
                        console.error(err);
                        alert('PowerPoint export failed. See browser console for details.');
                      } finally {
                        setExportProgress(null);
                      }
                    }}
                  >
                    Export PowerPoint
                  </button>
                  <button onClick={() => { if (project) exportToExcel(project); closeMenus(); }}>Export Excel</button>
                </div>
              )}
            </div>

            {/* Manage dropdown */}
            <div className="toolbar-dropdown-wrapper">
              <button className="toolbar-btn" onClick={() => setOpenMenu(openMenu === 'manage' ? null : 'manage')}>
                Manage ▾
              </button>
              {openMenu === 'manage' && (
                <div className="toolbar-dropdown" onMouseLeave={closeMenus}>
                  <button onClick={() => {
                    if (confirm('Clear all ranges? Products removed from both shelves. Catalogue and matrix labels kept.')) clearRanges();
                    closeMenus();
                  }} className="danger">Clear Ranges</button>
                  <button onClick={() => {
                    if (confirm('Clear the catalogue? Range structure kept but product data lost.')) clearCatalogue();
                    closeMenus();
                  }} className="danger">Clear Catalogue</button>
                </div>
              )}
            </div>
          </>
        )}

        <input ref={loadRef} type="file" accept=".json" onChange={handleLoad} hidden />
        <button className="toolbar-btn" onClick={() => loadRef.current?.click()}>Load</button>
        <input ref={appendRef} type="file" accept=".json" onChange={handleAppend} hidden />
        <button
          className="toolbar-btn"
          onClick={() => appendRef.current?.click()}
          title="Append plans and lenses from another project file into this one"
          disabled={!project}
        >
          Append
        </button>
      </div>
      {exportProgress && (
        <div className="export-progress-overlay" role="status" aria-live="polite">
          <div className="export-progress-card">
            <div className="export-progress-spinner" aria-hidden="true" />
            <div className="export-progress-title">Exporting PowerPoint</div>
            <div className="export-progress-message">{exportProgress}</div>
            <div className="export-progress-hint">Leave this tab visible while the capture runs.</div>
          </div>
        </div>
      )}
      {appendPreview && (
        <ImportProjectDialog
          preview={appendPreview.preview}
          fileName={appendPreview.fileName}
          onClose={() => setAppendPreview(null)}
        />
      )}
    </div>
  );
}
