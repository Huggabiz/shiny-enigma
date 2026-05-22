import { useMemo, useState } from 'react';
import { CloseIcon } from './Icons';
import { exportStandaloneHtml } from '../utils/exportHtml';
import type { Project } from '../types';
import { getActivePlan, getStages } from '../types';
import './LockDialog.css';

interface ExportHtmlDialogProps {
  project: Project;
  onClose: () => void;
}

export function ExportHtmlDialog({ project, onClose }: ExportHtmlDialogProps) {
  const hasDevProducts = project.catalogue.some((p) => p.source === 'dev');
  const [anonymise, setAnonymise] = useState(project.anonymiseDev ?? false);
  const [busy, setBusy] = useState(false);

  const activePlan = getActivePlan(project);
  const stages = useMemo(
    () => activePlan ? getStages(activePlan, project) : [],
    [activePlan, project],
  );

  const [selectedStageKeys, setSelectedStageKeys] = useState<Set<string>>(
    () => new Set(stages.map((s) => s.key)),
  );

  const toggleStage = (key: string) => {
    setSelectedStageKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleExport = async () => {
    setBusy(true);
    const visibleStageKeys = stages
      .filter((s) => selectedStageKeys.has(s.key))
      .map((s) => s.key);
    const exportProject: Project = {
      ...project,
      anonymiseDev: anonymise,
      lockHash: project.lockHash || 'viewer',
      visibleStageKeys,
    };
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
            Read-only — no editing, no catalogue, no forecast lab.
          </p>

          {stages.length > 1 && (
            <>
              <div className="export-stage-header">
                <label className="lock-label">Stages to include</label>
                <button
                  type="button"
                  className="export-stage-toggle-all"
                  onClick={() => {
                    if (selectedStageKeys.size === stages.length) {
                      setSelectedStageKeys(new Set([stages[0].key]));
                    } else {
                      setSelectedStageKeys(new Set(stages.map((s) => s.key)));
                    }
                  }}
                >
                  {selectedStageKeys.size === stages.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="export-stage-list">
                {stages.map((s) => (
                  <label key={s.key} className="export-stage-check">
                    <input
                      type="checkbox"
                      checked={selectedStageKeys.has(s.key)}
                      onChange={() => toggleStage(s.key)}
                    />
                    <span>{s.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}

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
