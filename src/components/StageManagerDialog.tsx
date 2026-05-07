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
    setCurrentLabel,
    setFutureLabel,
    addIntermediateStage,
    removeIntermediateStage,
    renameIntermediateStage,
  } = useProjectStore();

  const [newStageName, setNewStageName] = useState('');
  const activePlan = project ? getActivePlan(project) : undefined;

  if (!activePlan) return null;

  const stages = getStages(activePlan);
  const intermediates = activePlan.intermediateStages ?? [];

  const handleAdd = () => {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    addIntermediateStage(activePlan.id, trimmed);
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
              value={activePlan.currentLabel ?? ''}
              onChange={(e) => setCurrentLabel(activePlan.id, e.target.value)}
            />
            <span className="stage-mgr-badge">always first</span>
          </div>

          {/* Intermediate stages */}
          {intermediates.map((s, idx) => (
            <div key={s.id} className="stage-mgr-row intermediate">
              <span className="stage-mgr-position">Stage {idx + 1}</span>
              <input
                className="stage-mgr-input"
                value={s.name}
                onChange={(e) => renameIntermediateStage(activePlan.id, s.id, e.target.value)}
              />
              <button
                className="stage-mgr-remove"
                onClick={() => {
                  if (s.shelf.items.length > 0) {
                    if (!confirm(`"${s.name}" has ${s.shelf.items.length} products. Remove this stage?`)) return;
                  }
                  removeIntermediateStage(activePlan.id, s.id);
                }}
                title="Remove stage"
              >
                <CloseIcon size={7} color="currentColor" />
              </button>
            </div>
          ))}

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
              value={activePlan.futureLabel ?? ''}
              onChange={(e) => setFutureLabel(activePlan.id, e.target.value)}
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
