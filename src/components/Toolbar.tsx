import { useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { saveProject, saveRangeStructure, loadProjectFile } from '../utils/projectFile';
import { exportToPptx } from '../utils/exportPptx';
import { exportToExcel } from '../utils/exportExcel';
import { APP_VERSION } from '../version';
import './Toolbar.css';

interface ToolbarProps {
  activeView?: 'transform' | 'range-design';
}

export function Toolbar({ activeView }: ToolbarProps) {
  const isTransform = activeView === 'transform';
  const {
    project, loadProject, linkMode, setLinkMode, setLinkSource,
    assumeContinuity, setAssumeContinuity,
    clearCatalogue, clearRanges,
    cardFormat, setCardFormat,
  } = useProjectStore();
  const loadRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<'save' | 'manage' | 'format' | null>(null);

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

  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <span className="toolbar-logo">Range Planner</span>
        <span className="toolbar-version">v{APP_VERSION}</span>
        {project && <span className="toolbar-project-name">{project.name}</span>}
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
                  {linkMode ? 'Exit Link Mode' : 'Link Mode'}
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
                  <button onClick={() => { if (project) saveProject(project); closeMenus(); }}>Save Full Project</button>
                  <button onClick={() => { if (project) saveRangeStructure(project); closeMenus(); }}>Save Range Structure</button>
                  <hr />
                  <button
                    onClick={async () => {
                      if (!project) return;
                      closeMenus();
                      if (!document.querySelector('.transform-16-9')) {
                        alert('Switch to Transform view before exporting so the card snapshots can be captured.');
                        return;
                      }
                      try {
                        await exportToPptx(project);
                      } catch (err) {
                        console.error(err);
                        alert('PowerPoint export failed. See browser console for details.');
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
      </div>
    </div>
  );
}
