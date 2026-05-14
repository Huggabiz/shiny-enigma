import { useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan } from '../types';
import { exportToPptx } from '../utils/exportPptxSimple';
import { CloseIcon } from './Icons';
import './ExportDialog.css';

interface ExportDialogProps {
  onClose: () => void;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const { project } = useProjectStore();
  const [includeRange, setIncludeRange] = useState(true);
  const [includeTransform, setIncludeTransform] = useState(true);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(() => {
    const plan = project ? getActivePlan(project) : undefined;
    return new Set(plan ? [plan.id] : []);
  });
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  if (!project) return null;

  const togglePlan = (planId: string) => {
    setSelectedPlanIds((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedPlanIds.size === 0) return;
    setExporting(true);
    try {
      await exportToPptx(project, {
        includeRange,
        includeTransform,
        planIds: Array.from(selectedPlanIds),
      }, setProgress);
    } catch (err) {
      console.error(err);
      alert('Export failed. See browser console for details.');
    } finally {
      setExporting(false);
      setProgress(null);
      onClose();
    }
  };

  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="export-dialog-header">
          <h2>Export PowerPoint</h2>
          <button className="export-dialog-close" onClick={onClose}><CloseIcon size={10} color="#999" /></button>
        </div>

        <div className="export-dialog-body">
          <div className="export-section">
            <div className="export-section-title">Views to export</div>
            <label className="export-checkbox">
              <input type="checkbox" checked={includeRange} onChange={(e) => setIncludeRange(e.target.checked)} />
              Range View (one slide per stage)
            </label>
            <label className="export-checkbox">
              <input type="checkbox" checked={includeTransform} onChange={(e) => setIncludeTransform(e.target.checked)} />
              Transform View (one slide per stage pair)
            </label>
          </div>

          <div className="export-section">
            <div className="export-section-title">Plans to include</div>
            {project.plans.map((plan) => (
              <label key={plan.id} className="export-checkbox">
                <input type="checkbox" checked={selectedPlanIds.has(plan.id)}
                  onChange={() => togglePlan(plan.id)} />
                {plan.name}
                <span className="export-plan-count">
                  {plan.currentShelf.items.length + plan.futureShelf.items.length} SKUs
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="export-dialog-footer">
          {progress && <span className="export-progress-text">{progress}</span>}
          <button className="export-dialog-cancel" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="export-dialog-go" onClick={handleExport}
            disabled={exporting || selectedPlanIds.size === 0 || (!includeRange && !includeTransform)}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
