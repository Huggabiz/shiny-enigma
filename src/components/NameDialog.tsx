import { useState, useEffect, useRef } from 'react';
import { CloseIcon } from './Icons';
import './NameDialog.css';

interface NameDialogProps {
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  existingNames?: string[]; // if the new name matches one of these it is rejected
  onSave: (name: string) => void;
  onClose: () => void;
}

export function NameDialog({
  title,
  label,
  placeholder,
  initialValue = '',
  submitLabel = 'Create',
  existingNames,
  onSave,
  onClose,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    const name = value.trim();
    if (!name) { setError('Name is required'); return; }
    if (existingNames && existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" already exists`);
      return;
    }
    onSave(name);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog name-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <button className="dialog-close-btn" onClick={onClose}><CloseIcon size={12} color="#999" /></button>
        </div>

        <div className="dialog-body">
          <label className="name-field">
            <span className="name-label">{label}</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
                if (e.key === 'Escape') onClose();
              }}
            />
          </label>
          {error && <div className="name-error">{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit}>{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
