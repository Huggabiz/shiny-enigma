import { useState } from 'react';
import { CloseIcon } from './Icons';
import { exportStandaloneHtml } from '../utils/exportHtml';
import type { Project } from '../types';
import './LockDialog.css';

interface ExportHtmlDialogProps {
  project: Project;
  onClose: () => void;
}

export function ExportHtmlDialog({ project, onClose }: ExportHtmlDialogProps) {
  const hasDevProducts = project.catalogue.some((p) => p.source === 'dev');
  const [anonymise, setAnonymise] = useState(project.anonymiseDev ?? false);
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    const exportProject = { ...project, anonymiseDev: anonymise, lockHash: project.lockHash || 'viewer' };
    await exportStandaloneHtml(exportProject);
    setBusy(false);
    onClose();
  };

  return (
    <div className="lock-overlay" onClick={onClose}>
      <div className="lock-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="lock-header">
          <h3>Export Viewer (HTML)</h3>
          <button className="lock-close" onClick={onClose}><CloseIcon size={10} color="#999" /></button>
        </div>
        <div className="lock-body">
          <p className="lock-hint">
            Creates a standalone HTML file that anyone can open in a browser.
            The file is read-only — no editing, no catalogue, no forecast lab.
          </p>
          {hasDevProducts && (
            <label className="lock-anon-toggle">
              <input
                type="checkbox"
                checked={anonymise}
                onChange={(e) => setAnonymise(e.target.checked)}
              />
              <span>Anonymise Dev products</span>
            </label>
          )}
          {hasDevProducts && anonymise && (
            <p className="lock-anon-hint">Dev product names will be replaced and images hidden in the exported viewer.</p>
          )}
        </div>
        <div className="lock-footer">
          <button className="lock-cancel" onClick={onClose}>Cancel</button>
          <button className="lock-submit" onClick={handleExport} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
