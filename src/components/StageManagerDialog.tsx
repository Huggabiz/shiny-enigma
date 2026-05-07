import { useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import { CloseIcon } from './Icons';
import './StageManagerDialog.css';

interface StageManagerDialogProps {
  onClose: () => void;
}

export function StageManagerDialog({ onClose }: StageManagerDialogProps) {
  const {
    project,
    setCurrentStageLabel,
    setFutureStageLabel,
    addIntermediateStage,
    removeIntermediateStage,
    renameIntermediateStage,
  } = useProjectStore();

  const [newStageName, setNewStageName] = useState('');
  const activePlan = project ? getActivePlan(project) : undefined;

  if (!activePlan || !project) return null;

  const stages = getStages(activePlan, project);
  const stageDefs = project.stageDefinitions ?? [];

  const handleAdd = () => {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    addIntermediateStage(trimmed);
    setNewStageName('');
  };

  return (
    <div className="stage-mgr-overlay" onClick={onClose}>
      <div className="stage-mgr-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="stage-mgr-header">
          <h2>Manage Stages</h2>
          <button className="stage-mgr-close" onClick={onClose}><CloseIcon size={10} color="#999" /></button>
        </div>

        <div className="stage-mgr-body">
          <div className="stage-mgr-hint">
            Stages flow left-to-right: Current → stepping stones → Future goal.
          </div>

          {/* Current label */}
          <div className="stage-mgr-row current">
            <span className="stage-mgr-position">Current</span>
            <input
              className="stage-mgr-input"
              placeholder="e.g. SS26"
              value={project.currentStageLabel ?? ''}
              onChange={(e) => setCurrentStageLabel(e.target.value)}
            />
            <span className="stage-mgr-badge">always first</span>
          </div>

          {/* Intermediate stages — from project-level definitions */}
          {stageDefs.map((def, idx) => {
            const planShelf = (activePlan.intermediateShelves ?? []).find((s) => s.stageId === def.id);
            const itemCount = planShelf?.shelf.items.length ?? 0;
            return (
              <div key={def.id} className="stage-mgr-row intermediate">
                <span className="stage-mgr-position">Stage {idx + 1}</span>
                <input
                  className="stage-mgr-input"
                  value={def.name}
                  onChange={(e) => renameIntermediateStage(def.id, e.target.value)}
                />
                <button
                  className="stage-mgr-remove"
                  onClick={() => {
                    if (itemCount > 0) {
                      if (!confirm(`"${def.name}" has products across ${project.plans.length} plan(s). Remove this stage from all plans?`)) return;
                    }
                    removeIntermediateStage(def.id);
                  }}
                  title="Remove stage from all plans"
                >
                  <CloseIcon size={7} color="currentColor" />
                </button>
              </div>
            );
          })}

          {/* Add new stage */}
          <div className="stage-mgr-add">
            <input
              className="stage-mgr-input"
              placeholder="New stage name (e.g. AW26 Launch)"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button className="stage-mgr-add-btn" onClick={handleAdd} disabled={!newStageName.trim()}>
              + Add Stage
            </button>
          </div>

          {/* Future label */}
          <div className="stage-mgr-row future">
            <span className="stage-mgr-position">Future</span>
            <input
              className="stage-mgr-input"
              placeholder="e.g. Goal Range"
              value={project.futureStageLabel ?? ''}
              onChange={(e) => setFutureStageLabel(e.target.value)}
            />
            <span className="stage-mgr-badge">always last</span>
          </div>

          {/* Visual preview of stage order */}
          <div className="stage-mgr-preview">
            {stages.map((s, i) => (
              <span key={s.key} className={`stage-mgr-preview-item ${s.position}`}>
                {s.name}
                {i < stages.length - 1 && <span className="stage-mgr-preview-arrow"> → </span>}
              </span>
            ))}
          </div>
        </div>

        <div className="stage-mgr-footer">
          <button className="stage-mgr-done" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
