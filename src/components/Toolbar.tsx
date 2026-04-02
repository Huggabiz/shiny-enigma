import { useRef } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { saveProject, loadProjectFile } from '../utils/projectFile';
import { exportToPptx } from '../utils/exportPptx';
import { exportToExcel } from '../utils/exportExcel';
import './Toolbar.css';

interface ToolbarProps {
  onImport: () => void;
}

export function Toolbar({ onImport }: ToolbarProps) {
  const { project, loadProject, linkMode, setLinkMode, setLinkSource } = useProjectStore();
  const loadRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (project) saveProject(project);
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

            <button
              className={`toolbar-btn ${linkMode ? 'active' : ''}`}
              onClick={toggleLinkMode}
              title="Toggle link mode to connect products between shelves"
            >
              {linkMode ? 'Exit Link Mode' : 'Link Mode'}
            </button>

            <div className="toolbar-divider" />

            <button className="toolbar-btn" onClick={handleSave} title="Save project">
              Save Project
            </button>

            <button className="toolbar-btn" onClick={handleExportPptx} title="Export to PowerPoint">
              Export PPT
            </button>

            <button className="toolbar-btn" onClick={handleExportExcel} title="Export to Excel">
              Export Excel
            </button>
          </>
        )}

        <input
          ref={loadRef}
          type="file"
          accept=".json"
          onChange={handleLoad}
          hidden
        />
        <button
          className="toolbar-btn"
          onClick={() => loadRef.current?.click()}
          title="Load saved project"
        >
          Load Project
        </button>
      </div>
    </div>
  );
}
