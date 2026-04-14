import { useProjectStore } from '../store/useProjectStore';
import './NavSidebar.css';

export type ViewType = 'transform' | 'range-design' | 'multiplan';

interface NavSidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export function NavSidebar({ activeView, onViewChange }: NavSidebarProps) {
  const { showPlanTree, setShowPlanTree } = useProjectStore();

  return (
    <div className="nav-sidebar">
      <button
        className={`nav-item ${showPlanTree ? 'active' : ''}`}
        onClick={() => setShowPlanTree(!showPlanTree)}
        title="Range Plans"
      >
        <span className="nav-icon">☰</span>
        <span className="nav-label">Plans</span>
      </button>

      <div className="nav-separator" />

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
      <button
        className={`nav-item ${activeView === 'transform' ? 'active' : ''}`}
        onClick={() => onViewChange('transform')}
        title="Range Transformation"
      >
        <span className="nav-icon">⇄</span>
        <span className="nav-label">Transform</span>
      </button>
    </div>
  );
}
