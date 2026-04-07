import './NavSidebar.css';

export type ViewType = 'transform' | 'range-design';

interface NavSidebarProps {
  activeView: ViewType;
  designShelfId: 'current' | 'future';
  onViewChange: (view: ViewType) => void;
  onDesignShelfChange: (shelfId: 'current' | 'future') => void;
}

export function NavSidebar({ activeView, designShelfId, onViewChange, onDesignShelfChange }: NavSidebarProps) {
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

      {activeView === 'range-design' && (
        <div className="nav-shelf-toggle">
          <button
            className={`nav-shelf-btn ${designShelfId === 'current' ? 'active' : ''}`}
            onClick={() => onDesignShelfChange('current')}
          >
            Current
          </button>
          <button
            className={`nav-shelf-btn ${designShelfId === 'future' ? 'active' : ''}`}
            onClick={() => onDesignShelfChange('future')}
          >
            Future
          </button>
        </div>
      )}
    </div>
  );
}
