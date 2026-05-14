import { useMemo, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import type { StageEntry } from '../types';
import { exportToPptx, type PlanExportConfig } from '../utils/exportPptxSimple';
import { CloseIcon } from './Icons';
import './ExportDialog.css';

interface ExportDialogProps {
  onClose: () => void;
}

interface PlanSelection {
  planId: string;
  planName: string;
  includeRange: boolean;
  includeTransform: boolean;
  /** Stage keys to export in range view (default: all). */
  rangeStageKeys: string[];
  /** Transform from/to stage keys. */
  transformFromKey: string;
  transformToKey: string;
  stages: StageEntry[];
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const { project } = useProjectStore();

  const initialSelections = useMemo(() => {
    if (!project) return [];
    const activePlan = getActivePlan(project);
    return project.plans.map((plan) => {
      const stages = getStages(plan, project);
      const isActive = plan.id === activePlan?.id;
      return {
        planId: plan.id,
        planName: plan.name,
        includeRange: isActive,
        includeTransform: isActive,
        rangeStageKeys: stages.map((s) => s.key),
        transformFromKey: stages[0]?.key ?? 'current',
        transformToKey: stages[stages.length - 1]?.key ?? 'future',
        stages,
      };
    });
  }, [project]);

  const [selections, setSelections] = useState<PlanSelection[]>(initialSelections);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // All stage keys across any plan (they're project-level so all the same)
  const allStages = selections[0]?.stages ?? [];

  // Global toggles — apply to all plans at once
  const toggleGlobalRangeStage = (stageKey: string) => {
    setSelections((prev) => {
      // If ALL plans have this stage, remove it from all; otherwise add to all
      const allHave = prev.every((s) => s.rangeStageKeys.includes(stageKey));
      return prev.map((s) => ({
        ...s,
        rangeStageKeys: allHave
          ? s.rangeStageKeys.filter((k) => k !== stageKey)
          : s.rangeStageKeys.includes(stageKey) ? s.rangeStageKeys : [...s.rangeStageKeys, stageKey],
      }));
    });
  };
  const setGlobalTransform = (fromKey: string, toKey: string) => {
    setSelections((prev) => prev.map((s) => ({ ...s, transformFromKey: fromKey, transformToKey: toKey })));
  };
  const setAllRange = (on: boolean) => {
    setSelections((prev) => prev.map((s) => ({ ...s, includeRange: on })));
  };
  const setAllTransform = (on: boolean) => {
    setSelections((prev) => prev.map((s) => ({ ...s, includeTransform: on })));
  };

  if (!project) return null;

  const updatePlan = (planId: string, patch: Partial<PlanSelection>) => {
    setSelections((prev) => prev.map((s) => s.planId === planId ? { ...s, ...patch } : s));
  };

  const toggleRangeStage = (planId: string, stageKey: string) => {
    setSelections((prev) => prev.map((s) => {
      if (s.planId !== planId) return s;
      const keys = s.rangeStageKeys.includes(stageKey)
        ? s.rangeStageKeys.filter((k) => k !== stageKey)
        : [...s.rangeStageKeys, stageKey];
      return { ...s, rangeStageKeys: keys };
    }));
  };

  const hasAnythingToExport = selections.some((s) =>
    (s.includeRange && s.rangeStageKeys.length > 0) || s.includeTransform,
  );

  const handleExport = async () => {
    if (!hasAnythingToExport) return;
    setExporting(true);
    try {
      const configs: PlanExportConfig[] = selections
        .filter((s) => s.includeRange || s.includeTransform)
        .map((s) => ({
          planId: s.planId,
          includeRange: s.includeRange,
          includeTransform: s.includeTransform,
          rangeStageKeys: s.rangeStageKeys,
          transformFromKey: s.transformFromKey,
          transformToKey: s.transformToKey,
        }));
      await exportToPptx(project, configs, setProgress);
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
          {/* Global defaults — apply to all plans */}
          <div className="export-section">
            <div className="export-section-title">Global defaults (applies to all plans)</div>
            <div className="export-global-row">
              <span className="export-stage-label">Views:</span>
              <label className="export-stage-check">
                <input type="checkbox"
                  checked={selections.every((s) => s.includeRange)}
                  onChange={(e) => setAllRange(e.target.checked)} />
                All Range
              </label>
              <label className="export-stage-check">
                <input type="checkbox"
                  checked={selections.every((s) => s.includeTransform)}
                  onChange={(e) => setAllTransform(e.target.checked)} />
                All Transform
              </label>
            </div>
            <div className="export-global-row">
              <span className="export-stage-label">Range stages:</span>
              <div className="export-stage-checks">
                {allStages.map((s) => {
                  const allHave = selections.every((sel) => sel.rangeStageKeys.includes(s.key));
                  return (
                    <label key={s.key} className="export-stage-check">
                      <input type="checkbox" checked={allHave}
                        onChange={() => toggleGlobalRangeStage(s.key)} />
                      {s.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="export-global-row">
              <span className="export-stage-label">Transform:</span>
              <select className="export-stage-select"
                value={selections[0]?.transformFromKey ?? 'current'}
                onChange={(e) => setGlobalTransform(e.target.value, selections[0]?.transformToKey ?? 'future')}>
                {allStages.slice(0, -1).map((s) => (
                  <option key={s.key} value={s.key}>{s.name}</option>
                ))}
              </select>
              <span className="export-stage-arrow">→</span>
              <select className="export-stage-select"
                value={selections[0]?.transformToKey ?? 'future'}
                onChange={(e) => setGlobalTransform(selections[0]?.transformFromKey ?? 'current', e.target.value)}>
                {allStages.slice(1).map((s) => (
                  <option key={s.key} value={s.key}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Per-plan overrides */}
          <div className="export-section">
            <div className="export-section-title">Per-plan overrides</div>
            <div className="export-plan-header-row">
              <span className="export-plan-col-name">Plan</span>
              <span className="export-plan-col-check">Range</span>
              <span className="export-plan-col-check">Transform</span>
            </div>
            {selections.map((sel) => (
              <div key={sel.planId} className="export-plan-row">
                <div className="export-plan-name">{sel.planName}</div>
                <input type="checkbox" checked={sel.includeRange}
                  onChange={(e) => updatePlan(sel.planId, { includeRange: e.target.checked })} />
                <input type="checkbox" checked={sel.includeTransform}
                  onChange={(e) => updatePlan(sel.planId, { includeTransform: e.target.checked })} />

                {/* Stage details when expanded */}
                {(sel.includeRange || sel.includeTransform) && (
                  <div className="export-plan-details">
                    {sel.includeRange && (
                      <div className="export-stage-row">
                        <span className="export-stage-label">Range stages:</span>
                        <div className="export-stage-checks">
                          {sel.stages.map((s) => (
                            <label key={s.key} className="export-stage-check">
                              <input type="checkbox"
                                checked={sel.rangeStageKeys.includes(s.key)}
                                onChange={() => toggleRangeStage(sel.planId, s.key)} />
                              {s.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {sel.includeTransform && (
                      <div className="export-stage-row">
                        <span className="export-stage-label">Transform:</span>
                        <select className="export-stage-select" value={sel.transformFromKey}
                          onChange={(e) => updatePlan(sel.planId, { transformFromKey: e.target.value })}>
                          {sel.stages.slice(0, -1).map((s) => (
                            <option key={s.key} value={s.key}>{s.name}</option>
                          ))}
                        </select>
                        <span className="export-stage-arrow">→</span>
                        <select className="export-stage-select" value={sel.transformToKey}
                          onChange={(e) => updatePlan(sel.planId, { transformToKey: e.target.value })}>
                          {sel.stages.slice(1).map((s) => (
                            <option key={s.key} value={s.key}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="export-dialog-footer">
          {progress && <span className="export-progress-text">{progress}</span>}
          <button className="export-dialog-cancel" onClick={onClose} disabled={exporting}>Cancel</button>
          <button className="export-dialog-go" onClick={handleExport}
            disabled={exporting || !hasAnythingToExport}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
