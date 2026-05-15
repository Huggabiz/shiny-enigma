import { useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { CloseIcon } from './Icons';
import './LockDialog.css';

interface LockDialogProps {
  mode: 'set' | 'unlock';
  onClose: () => void;
}

export function LockDialog({ mode, onClose }: LockDialogProps) {
  const { lockProject, unlockProject } = useProjectStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (mode === 'set') {
      if (password.length < 1) { setError('Password required'); return; }
      if (password !== confirm) { setError('Passwords do not match'); return; }
      setBusy(true);
      await lockProject(password);
      onClose();
    } else {
      setBusy(true);
      const ok = await unlockProject(password);
      if (ok) { onClose(); }
      else { setError('Incorrect password'); setBusy(false); }
    }
  };

  return (
    <div className="lock-overlay" onClick={onClose}>
      <div className="lock-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="lock-header">
          <h3>{mode === 'set' ? 'Lock Project' : 'Unlock Project'}</h3>
          <button className="lock-close" onClick={onClose}><CloseIcon size={10} color="#999" /></button>
        </div>
        <div className="lock-body">
          {mode === 'set' && (
            <p className="lock-hint">Set a password to prevent accidental edits. You can still navigate and view the project.</p>
          )}
          <label className="lock-label">Password</label>
          <input
            type="password"
            className="lock-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
          {mode === 'set' && (
            <>
              <label className="lock-label">Confirm password</label>
              <input
                type="password"
                className="lock-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </>
          )}
          {error && <div className="lock-error">{error}</div>}
        </div>
        <div className="lock-footer">
          <button className="lock-cancel" onClick={onClose}>Cancel</button>
          <button className="lock-submit" onClick={handleSubmit} disabled={busy}>
            {mode === 'set' ? 'Lock' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}
