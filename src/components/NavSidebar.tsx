import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { getActivePlan, getStages } from '../types';
import './NavSidebar.css';

export type ViewType = 'transform' | 'range-design' | 'multiplan' | 'multiplan-list' | 'analyse' | 'forecast-lab' | 'set-lab';

/** Views where the range-plan navigator is meaningful. The Plans button
 * returns here when clicked from a lab view. */
const LAB_VIEWS: ViewType[] = ['set-lab', 'forecast-lab'];

interface NavSidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export function NavSidebar({ activeView, onViewChange }: NavSidebarProps) {
  const { showPlanTree, setShowPlanTree, viewerMode, project } = useProjectStore();

  // Remember the last non-lab view so the Plans button can return to it
  // from the Set Lab (where the plan tree has nothing meaningful to show).
  const lastMainViewRef = useRef<ViewType>('range-design');
  useEffect(() => {
    if (!LAB_VIEWS.includes(activeView)) lastMainViewRef.current = activeView;
  }, [activeView]);

  const handlePlansClick = () => {
    if (activeView === 'set-lab') {
      onViewChange(lastMainViewRef.current);
      setShowPlanTree(true);
      return;
    }
    setShowPlanTree(!showPlanTree);
  };

  const visibleStageCount = (() => {
    if (!project) return 0;
    const plan = getActivePlan(project);
    if (!plan) return 0;
    const all = getStages(plan, project);
    const vk = project.visibleStageKeys;
    if (!vk || vk.length === 0) return all.length;
    return all.filter((s) => vk.includes(s.key)).length || all.length;
  })();
  const showTransform = visibleStageCount >= 2;

  return (
    <div className="nav-sidebar">
      <button
        className={`nav-item ${showPlanTree && activeView !== 'set-lab' ? 'active' : ''}`}
        onClick={handlePlansClick}
        title={activeView === 'set-lab' ? 'Back to range planning' : 'Range Plans'}
      >
        <span className="nav-icon">☰</span>
        <span className="nav-label">Plans</span>
      </button>

      <div className="nav-separator" />

      <button
        className={`nav-item ${activeView === 'analyse' ? 'active' : ''}`}
        onClick={() => onViewChange('analyse')}
        title="Analyse — category breakdown dashboards"
      >
        <span className="nav-icon">◔</span>
        <span className="nav-label">Analyse</span>
      </button>
      <button
        className={`nav-item ${activeView === 'multiplan-list' ? 'active' : ''}`}
        onClick={() => onViewChange('multiplan-list')}
        title="Multiplan List — tabular SKU list across plans"
      >
        <span className="nav-icon">☷</span>
        <span className="nav-label">List</span>
      </button>
      <button
        className={`nav-item ${activeView === 'multiplan' ? 'active' : ''}`}
        onClick={() => onViewChange('multiplan')}
        title="Multiplan — compare shelves across plans/variants"
      >
        <span className="nav-icon">▤</span>
        <span className="nav-label">Multiplan</span>
      </button>
      <button
        className={`nav-item ${activeView === 'range-design' ? 'active' : ''}`}
        onClick={() => onViewChange('range-design')}
        title="Range View"
      >
        <span className="nav-icon">▦</span>
        <span className="nav-label">Range</span>
      </button>
      {showTransform && (
        <button
          className={`nav-item ${activeView === 'transform' ? 'active' : ''}`}
          onClick={() => onViewChange('transform')}
          title="Range Transformation"
        >
          <span className="nav-icon">⇄</span>
          <span className="nav-label">Transform</span>
        </button>
      )}

      {!viewerMode && (
        <>
          <div className="nav-separator" />
          <button
            className={`nav-item ${activeView === 'forecast-lab' ? 'active' : ''}`}
            onClick={() => onViewChange('forecast-lab')}
            title="Forecast Lab — build SKU-level forecasts"
          >
            <span className="nav-icon">🧪</span>
            <span className="nav-label">Forecast</span>
          </button>
          <button
            className={`nav-item ${activeView === 'set-lab' ? 'active' : ''}`}
            onClick={() => onViewChange('set-lab')}
            title="Set & Bundle Lab — experiment with product combinations"
          >
            <span className="nav-icon">🧩</span>
            <span className="nav-label">Sets</span>
          </button>
        </>
      )}
    </div>
  );
}
