import './NavSidebar.css';

export type ViewType = 'transform' | 'range-design';

interface NavSidebarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export function NavSidebar({ activeView, onViewChange }: NavSidebarProps) {
  return (
    <div className="nav-sidebar">
      <button
        className={`nav-item ${activeView === 'transform' ? 'active' : ''}`}
        onClick={() => onViewChange('transform')}
        title="Range Transformation"
      >
        <span className="nav-icon">⇄</span>
        <span className="nav-label">Transform</span>
      </button>
      <button
        className={`nav-item ${activeView === 'range-design' ? 'active' : ''}`}
        onClick={() => onViewChange('range-design')}
        title="Range Design Matrix"
      >
        <span className="nav-icon">▦</span>
        <span className="nav-label">Design</span>
      </button>
    </div>
  );
}
