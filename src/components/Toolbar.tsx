import { useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { saveProject, saveRangeStructure, loadProjectFile } from '../utils/projectFile';
import { exportToPptx } from '../utils/exportPptx';
import { exportToExcel } from '../utils/exportExcel';
import { APP_VERSION } from '../version';
import './Toolbar.css';

interface ToolbarProps {
  onImport: () => void;
}

export function Toolbar({ onImport }: ToolbarProps) {
  const {
    project, loadProject, linkMode, setLinkMode, setLinkSource,
    assumeContinuity, setAssumeContinuity, clearCatalogue, clearRanges,
  } = useProjectStore();
  const loadRef = useRef<HTMLInputElement>(null);
  const [showSaveMenu, setShowSaveMenu] = useState(false);

  const handleSave = () => {
    if (project) saveProject(project);
    setShowSaveMenu(false);
  };

  const handleSaveStructure = () => {
    if (project) saveRangeStructure(project);
    setShowSaveMenu(false);
  };

  const handleClearCatalogue = () => {
    if (confirm('Clear the catalogue? Range structure will be kept but product data (volume, revenue) will be lost.')) {
      clearCatalogue();
    }
    setShowSaveMenu(false);
  };

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

  const handleExportPptx = () => {
    if (project) exportToPptx(project);
  };

  const handleExportExcel = () => {
    if (project) exportToExcel(project);
  };

  const toggleLinkMode = () => {
    setLinkMode(!linkMode);
    setLinkSource(null);
  };

  return (
    <div className="toolbar">
      <div className="toolbar-brand">
        <span className="toolbar-logo">Range Planner</span>
        <span className="toolbar-version">v{APP_VERSION}</span>
        {project && (
          <span className="toolbar-project-name">{project.name}</span>
        )}
      </div>

      <div className="toolbar-actions">
        {project && (
          <>
            <button className="toolbar-btn" onClick={onImport} title="Import product data">
              Import Data
            </button>

            <div className="toolbar-divider" />

            <label className="toolbar-checkbox" title="Products added to current range are automatically added to future range">
              <input
                type="checkbox"
                checked={assumeContinuity}
                onChange={(e) => setAssumeContinuity(e.target.checked)}
              />
              <span>Range continuity</span>
            </label>

            <div className="toolbar-divider" />

            <button
              className={`toolbar-btn ${linkMode ? 'active' : ''}`}
              onClick={toggleLinkMode}
            >
              {linkMode ? 'Exit Link Mode' : 'Link Mode'}
            </button>

            <div className="toolbar-divider" />

            {/* Save dropdown */}
            <div className="toolbar-dropdown-wrapper">
              <button className="toolbar-btn" onClick={() => setShowSaveMenu(!showSaveMenu)}>
                Save ▾
              </button>
              {showSaveMenu && (
                <div className="toolbar-dropdown" onMouseLeave={() => setShowSaveMenu(false)}>
                  <button onClick={handleSave}>Save Full Project</button>
                  <button onClick={handleSaveStructure}>Save Range Structure</button>
                  <hr />
                  <button onClick={() => {
                    if (confirm('Clear all ranges? Products will be removed from both shelves but the catalogue and matrix labels will be kept.')) {
                      clearRanges();
                    }
                    setShowSaveMenu(false);
                  }} className="danger">Clear Ranges</button>
                  <button onClick={handleClearCatalogue} className="danger">Clear Catalogue</button>
                </div>
              )}
            </div>

            <button className="toolbar-btn" onClick={handleExportPptx} title="Export to PowerPoint">
              PPT
            </button>
            <button className="toolbar-btn" onClick={handleExportExcel} title="Export to Excel">
              Excel
            </button>
          </>
        )}

        <input ref={loadRef} type="file" accept=".json" onChange={handleLoad} hidden />
        <button className="toolbar-btn" onClick={() => loadRef.current?.click()}>
          Load
        </button>
      </div>
    </div>
  );
}
