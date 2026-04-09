import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PencilIcon } from './Icons';
import './EditableTitle.css';

interface EditableTitleProps {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  /** Element rendered to the right of the title inside the <h2>, e.g. a variant badge. */
  trailing?: ReactNode;
}

/**
 * An <h2>-style title that shows a pencil on hover. Click the title or the
 * pencil to switch to an inline <input>; pressing Enter or blurring saves.
 * Empty input reverts to the original value.
 */
export function EditableTitle({ value, onSave, className, trailing }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <h2 className={className || ''}>
        <span className="editable-title-row editing">
          <input
            ref={inputRef}
            className="editable-title-input"
            defaultValue={value}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        </span>
      </h2>
    );
  }

  return (
    <h2 className={className || ''}>
      <span
        className="editable-title-row"
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        <span className="editable-title-text">{value}</span>
        {trailing}
        <button
          type="button"
          className="editable-title-pencil"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          aria-label="Edit title"
          title="Edit title"
        >
          <PencilIcon size={12} color="currentColor" />
        </button>
      </span>
    </h2>
  );
}
