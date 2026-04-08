import './PillToggle.css';

interface PillToggleProps {
  value: 'current' | 'future';
  onChange: (value: 'current' | 'future') => void;
}

export function PillToggle({ value, onChange }: PillToggleProps) {
  return (
    <div className="pill-toggle">
      <div className={`pill-slider ${value === 'future' ? 'right' : 'left'}`} />
      <button
        className={`pill-option ${value === 'current' ? 'active' : ''}`}
        onClick={() => onChange('current')}
      >
        Current
      </button>
      <button
        className={`pill-option ${value === 'future' ? 'active' : ''}`}
        onClick={() => onChange('future')}
      >
        Future
      </button>
    </div>
  );
}
