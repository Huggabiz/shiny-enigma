import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { saveProject, saveRangeStructure, loadProjectFile } from '../utils/projectFile';
import {
  openViaPicker, setHandle, getHandle, readCurrent, writeCurrent, saveAsViaPicker,
  readFileMeta, myCheckOut, isMyLock, lockIsStale, lockAgeLabel,
  getUserName, setUserName, startHeartbeat, stopHeartbeat,
} from '../utils/fileSession';
import type { FileMeta, Project } from '../types';
import { computeImportPlan, type ImportPlanPreview } from '../utils/importProject';
import { exportToExcelEnriched } from '../utils/exportExcelEnriched';
import { APP_VERSION } from '../version';
import { ImportProjectDialog } from './ImportProjectDialog';
import { ExportDialog } from './ExportDialog';
import { DashboardDialog } from './DashboardDialog';
import { StageManagerDialog } from './StageManagerDialog';
import { LockDialog } from './LockDialog';
import { ExportHtmlDialog } from './ExportHtmlDialog';
import './Toolbar.css';

interface ToolbarProps {
  activeView?: 'transform' | 'range-design' | 'multiplan' | 'multiplan-list' | 'analyse' | 'forecast-lab' | 'set-lab';
}

export function Toolbar({ activeView }: ToolbarProps) {
  const isTransform = activeView === 'transform';
  const {
    project, loadProject, linkMode, setLinkMode, setLinkSource,
    assumeContinuity, setAssumeContinuity,
    clearCatalogue, clearRanges,
    cardFormat, setCardFormat,
    activeVariantId,
    updateProjectName,
    isUnlocked, removeLock,
    viewerMode,
    fileSession, setFileSession, setProjectFileMeta,
  } = useProjectStore();
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);
  const commitProjectName = (next: string) => {
    const trimmed = next.trim();
    if (trimmed && project && trimmed !== project.name) updateProjectName(trimmed);
    setEditingName(false);
  };
  

  // Resolve the scope the current format edits apply to — helps the user
  // know whether they're editing the plan default or the active variant.
  const activePlan = project ? project.plans.find((p) => p.id === project.activePlanId) : undefined;
  const activeVariant = activePlan && activeVariantId
    ? activePlan.variants.find((v) => v.id === activeVariantId)
    : undefined;
  const formatScopeLabel = activeVariant
    ? `Saving to variant: ${activeVariant.name}`
    : activePlan
      ? `Saving to plan: ${activePlan.name}`
      : 'Saving to default';
  const loadRef = useRef<HTMLInputElement>(null);
  const appendRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<'save' | 'manage' | 'format' | 'tools' | null>(null);
  const [appendPreview, setAppendPreview] = useState<{ fileName: string; preview: ImportPlanPreview } | null>(null);
  const [showStageManager, setShowStageManager] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [lockDialog, setLockDialog] = useState<'set' | 'unlock' | null>(null);
  const [showHtmlExport, setShowHtmlExport] = useState(false);
  const isLocked = (!!project?.lockHash && !isUnlocked) || viewerMode;

  const closeMenus = () => setOpenMenu(null);

  const handleLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const loaded = await loadProjectFile(file);
      loadProject(loaded);
    } catch {
      alert('Failed to load project file. Please check the file format.');
    }
    e.target.value = '';
  };

  // Append import — read a project file and compute the merged
  // result as a dry run, then show the preview dialog. The actual
  // apply happens inside the dialog on confirm via `appendImport`.
  const handleAppend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!project) {
      alert('Load or create a project first before appending.');
      return;
    }
    try {
      const imported = await loadProjectFile(file);
      const preview = computeImportPlan(project, imported);
      setAppendPreview({ fileName: file.name, preview });
    } catch {
      alert('Failed to read the import file. Please check the file format.');
    }
  };

  const exportedAt = project?.exportedAt;
  const snapshotDate = exportedAt ? new Date(exportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

  // ---------- Shared-file collaboration (Chrome/Edge only) ----------
  // See utils/fileSession.ts. The advisory check-out lock plus the
  // revision counter give lock-then-verify pessimism with an
  // optimistic-concurrency safety net for lock races / take-overs.

  const [namePrompt, setNamePrompt] = useState<{ cont: () => void } | null>(null);

  const ensureUserName = (cont: () => void) => {
    if (getUserName()) cont();
    else setNamePrompt({ cont });
  };

  // Heartbeat: refresh our lock timestamp on disk without touching the
  // file's project content (unsaved in-memory edits must NOT leak out).
  const heartbeatBeat = async () => {
    try {
      const cur = await readCurrent();
      if (!cur) return;
      const meta = readFileMeta(cur.data);
      if (!isMyLock(meta.checkOut)) {
        stopHeartbeat();
        useProjectStore.getState().setFileSession({
          checkout: meta.checkOut ? 'other' : 'none',
          checkedOutBy: meta.checkOut?.userName,
        });
        return;
      }
      const refreshed: FileMeta = { ...meta, checkOut: myCheckOut() };
      await writeCurrent(JSON.stringify({ ...cur.data, fileMeta: refreshed }, null, 2));
    } catch (err) {
      console.warn('Lock heartbeat failed', err);
    }
  };

  const handleOpenShared = async () => {
    try {
      const res = await openViaPicker();
      if (!res) return;
      let data: Record<string, unknown>;
      try { data = JSON.parse(res.text) as Record<string, unknown>; }
      catch { alert('Failed to load project file. Please check the file format.'); return; }
      if (data.type === 'range-structure') {
        // Structure exports aren't collaborative files — legacy load.
        const loaded = await loadProjectFile(res.file);
        loadProject(loaded);
        return;
      }
      loadProject(data as unknown as Project); // clears any previous session
      setHandle(res.handle);
      const meta = readFileMeta(data);
      const lock = meta.checkOut ?? null;
      const heldByOther = !!lock && !isMyLock(lock) && !lockIsStale(lock);
      setFileSession({
        active: true,
        fileName: res.file.name,
        loadedRevision: meta.revision,
        checkout: heldByOther ? 'other' : 'none',
        checkedOutBy: heldByOther ? lock!.userName : undefined,
      });
    } catch (err) {
      console.error(err);
      alert('Failed to open project file.');
    }
  };

  const handleCheckOut = () => ensureUserName(async () => {
    try {
      const cur = await readCurrent();
      if (!cur) return;
      let meta = readFileMeta(cur.data);
      if (meta.revision !== fileSession.loadedRevision) {
        const ok = confirm(
          `This file was saved${meta.lastSavedBy ? ` by ${meta.lastSavedBy}` : ''} since you opened it ` +
          `(revision ${meta.revision}, you loaded ${fileSession.loadedRevision}).\n\n` +
          'The latest version must be loaded before checking out. Load it now?');
        if (!ok) return;
        // loadProject clears the module handle — capture and re-attach.
        const h = getHandle();
        loadProject(cur.data as unknown as Project);
        if (h) setHandle(h);
        meta = readFileMeta(cur.data);
        setFileSession({ active: true, fileName: fileSession.fileName, loadedRevision: meta.revision, checkout: 'none' });
      }
      const lock = meta.checkOut ?? null;
      if (lock && !isMyLock(lock)) {
        if (!lockIsStale(lock)) {
          alert(`Checked out by ${lock.userName} (${lockAgeLabel(lock)}). The file is read-only until they check it back in.`);
          setFileSession({ checkout: 'other', checkedOutBy: lock.userName });
          return;
        }
        const takeOver = confirm(
          `The check-out by ${lock.userName} looks abandoned (last active ${lockAgeLabel(lock)}).\n\nTake over the check-out?`);
        if (!takeOver) return;
      }
      // Write the lock onto the file's CURRENT content (not our
      // in-memory copy), then verify we won any race.
      const newMeta: FileMeta = { ...meta, checkOut: myCheckOut() };
      await writeCurrent(JSON.stringify({ ...cur.data, fileMeta: newMeta }, null, 2));
      await new Promise((r) => setTimeout(r, 600));
      const verify = await readCurrent();
      const vLock = verify ? readFileMeta(verify.data).checkOut : null;
      if (isMyLock(vLock)) {
        setProjectFileMeta(newMeta);
        setFileSession({ checkout: 'mine', checkedOutBy: undefined });
        startHeartbeat(heartbeatBeat);
      } else {
        alert(`Someone else checked out at the same moment${vLock ? ` (${vLock.userName})` : ''}. The file stays read-only for you.`);
        setFileSession({ checkout: vLock ? 'other' : 'none', checkedOutBy: vLock?.userName ?? undefined });
      }
    } catch (err) {
      console.error(err);
      alert('Check-out failed — could not read or write the file.');
    }
  });

  // Shared save core: verify lock + revision against the disk, then
  // write. keepLock=false checks the file back in.
  const sharedSave = async (keepLock: boolean) => {
    if (!project) return;
    try {
      const cur = await readCurrent();
      if (!cur) return;
      const meta = readFileMeta(cur.data);
      if (!isMyLock(meta.checkOut)) {
        const who = meta.checkOut?.userName;
        const ok = confirm(
          `Your check-out is no longer active${who ? ` — the file is now checked out by ${who}` : ''}.\n\n` +
          'Saving may overwrite their work. Save anyway?');
        if (!ok) return;
      }
      if (meta.revision !== fileSession.loadedRevision) {
        const ok = confirm(
          `Conflict: the file is at revision ${meta.revision}` +
          `${meta.lastSavedBy ? ` (saved by ${meta.lastSavedBy})` : ''}, but you loaded revision ${fileSession.loadedRevision}.\n\n` +
          'Saving will overwrite their changes. Continue?');
        if (!ok) return;
      }
      const newMeta: FileMeta = {
        revision: Math.max(meta.revision, fileSession.loadedRevision) + 1,
        lastSavedBy: getUserName() ?? undefined,
        lastSavedAt: new Date().toISOString(),
        checkOut: keepLock ? myCheckOut() : null,
      };
      await writeCurrent(JSON.stringify({ ...project, fileMeta: newMeta, updatedAt: new Date().toISOString() }, null, 2));
      setProjectFileMeta(newMeta);
      setFileSession({ loadedRevision: newMeta.revision, checkout: keepLock ? 'mine' : 'none', checkedOutBy: undefined });
      if (!keepLock) stopHeartbeat();
    } catch (err) {
      console.error(err);
      alert('Save failed — could not write the file.');
    }
  };

  const handleSharedSave = () => ensureUserName(() => { void sharedSave(true); });
  const handleCheckIn = () => ensureUserName(() => { void sharedSave(false); });

  // Save As on a supported browser: write a NEW file via the picker,
  // retain its handle, and start a fresh checked-out session on it.
  const handleSaveAs = () => {
    if (!project) return;
    if (!fileSession.supported) {
      void saveProject(project).catch((err) => { console.error(err); alert('Failed to save project.'); });
      return;
    }
    ensureUserName(async () => {
      try {
        const newMeta: FileMeta = {
          revision: (project.fileMeta?.revision ?? 0) + 1,
          lastSavedBy: getUserName() ?? undefined,
          lastSavedAt: new Date().toISOString(),
          checkOut: myCheckOut(),
        };
        const content = JSON.stringify({ ...project, fileMeta: newMeta, updatedAt: new Date().toISOString() }, null, 2);
        const suggested = `${project.name.replace(/\s+/g, '_')}_project.json`;
        const ok = await saveAsViaPicker(content, suggested);
        if (!ok) return;
        setProjectFileMeta(newMeta);
        setFileSession({ active: true, fileName: suggested, loadedRevision: newMeta.revision, checkout: 'mine', checkedOutBy: undefined });
        startHeartbeat(heartbeatBeat);
      } catch (err) {
        console.error(err);
        alert('Failed to save project.');
      }
    });
  };


  return (
    <>
    <div className={`toolbar ${viewerMode ? 'toolbar-viewer' : ''}`}>
      <div className="toolbar-brand">
        <span className="toolbar-logo">Range Planner</span>
        <span className="toolbar-version">v{APP_VERSION}</span>
        {project && (
          editingName ? (
            <input
              ref={nameInputRef}
              className="toolbar-project-name-input"
              defaultValue={project.name}
              onBlur={(e) => commitProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitProjectName((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <span
              className="toolbar-project-name"
              onClick={isLocked ? undefined : () => setEditingName(true)}
              title={isLocked ? undefined : "Click to rename project"}
            >
              {project.name}
            </span>
          )
        )}
        {isLocked && !viewerMode && (
          <span className="toolbar-lock-badge" onClick={() => setLockDialog('unlock')} title="Project is locked — click to unlock">
            🔒 Locked
          </span>
        )}
        {/* Shared-file check-out status + actions */}
        {project && !viewerMode && fileSession.active && (
          <span className="toolbar-file-session">
            {fileSession.checkout === 'mine' ? (
              <>
                <span className="file-status mine" title={`Checked out by you · ${fileSession.fileName ?? ''} · rev ${fileSession.loadedRevision}`}>
                  ✓ Checked out by you
                </span>
                <button className="toolbar-btn small" onClick={handleSharedSave} title="Save to the open file (keeps your check-out)">Save</button>
                <button className="toolbar-btn small" onClick={handleCheckIn} title="Save and release the file for others to edit">Check In</button>
              </>
            ) : fileSession.checkout === 'other' ? (
              <>
                <span className="file-status other" title="The file is checked out by someone else — read-only until they check in">
                  🔒 {fileSession.checkedOutBy ?? 'Someone'} has this checked out
                </span>
                <button className="toolbar-btn small" onClick={handleCheckOut} title="Re-check the lock (offers take-over if it has gone stale)">Check Out</button>
              </>
            ) : (
              <>
                <span className="file-status readonly" title="Shared file — read-only until you check it out">
                  Read-only
                </span>
                <button className="toolbar-btn small primary" onClick={handleCheckOut} title="Check the file out so you can edit it">Check Out</button>
              </>
            )}
          </span>
        )}
        {project && !viewerMode && !fileSession.supported && (
          <span
            className="file-status limited"
            title="This browser cannot keep a connection to the project file, so Save-in-place and check-out locking are unavailable. Use Chrome or Edge for shared-file collaboration."
          >
            ⚠ Solo mode
          </span>
        )}
        {viewerMode && (
          <span className="toolbar-lock-badge" style={{ cursor: 'default' }}>
            📄 Viewer
          </span>
        )}
      </div>

      <div className="toolbar-actions">
        {project && (
          <>
            {isTransform && !viewerMode && (
              <>
                <label className="toolbar-checkbox" title="Products added to current range auto-add to future">
                  <input type="checkbox" checked={assumeContinuity}
                    onChange={(e) => setAssumeContinuity(e.target.checked)} />
                  <span>Range continuity</span>
                </label>

                <div className="toolbar-divider" />

                <button className={`toolbar-btn ${linkMode ? 'active' : ''}`}
                  onClick={() => { setLinkMode(!linkMode); setLinkSource(null); }}>
                  {linkMode ? 'Exit Forecast' : 'Forecast'}
                </button>
              </>
            )}

            <div className="toolbar-divider" />

            {/* Card Format dropdown — hidden in list view (has its own Columns dropdown) */}
            {activeView !== 'multiplan-list' && <div className="toolbar-dropdown-wrapper">
              <button className="toolbar-btn" onClick={() => setOpenMenu(openMenu === 'format' ? null : 'format')}>
                Card Format ▾
              </button>
              {openMenu === 'format' && (
                <div className="toolbar-dropdown format-dropdown" onMouseLeave={closeMenus}>
                  <div className="dropdown-title">Show on cards</div>
                  <div className="dropdown-scope">{formatScopeLabel}</div>
                  {([
                    ['showImage', 'Image'],
                    ['showName', 'Product Name'],
                    ['showSku', 'SKU Code'],
                    ['showVolume', 'Volume (last year)'],
                    ['showForecastVolume', 'Forecast Volume (next year)'],
                    ['showRrp', 'UK RRP'],
                    ['showUsRrp', 'US RRP'],
                    ['showEuRrp', 'EU RRP'],
                    ['showAusRrp', 'AUS RRP'],
                    ['showRevenue', 'Revenue (last year)'],
                    ['showForecastRevenue', 'Forecast Revenue (next year)'],
                    ['showCategory', 'Category'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="dropdown-checkbox">
                      <input type="checkbox" checked={cardFormat[key]}
                        onChange={(e) => setCardFormat({ [key]: e.target.checked })} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>}

            <div className="toolbar-divider" />

            {/* Save/Export dropdown — hidden in viewer mode */}
            {!viewerMode && (
              <div className="toolbar-dropdown-wrapper">
                <button className="toolbar-btn" onClick={() => setOpenMenu(openMenu === 'save' ? null : 'save')}>
                  Save / Export ▾
                </button>
                {openMenu === 'save' && (
                  <div className="toolbar-dropdown" onMouseLeave={closeMenus}>
                    {fileSession.active && fileSession.checkout === 'mine' && (
                      <button onClick={() => { closeMenus(); handleSharedSave(); }}>
                        Save{fileSession.fileName ? ` (${fileSession.fileName})` : ''}
                      </button>
                    )}
                    <button onClick={() => { closeMenus(); handleSaveAs(); }}>Save As…</button>
                    <button onClick={async () => {
                      closeMenus();
                    if (!project) return;
                    try { await saveRangeStructure(project); }
                    catch (err) { console.error(err); alert('Failed to save range structure.'); }
                  }}>Save Range Structure</button>
                  <hr />
                  <button onClick={() => { closeMenus(); setShowExportDialog(true); }}>Export PowerPoint</button>
                  <button onClick={() => { if (project) exportToExcelEnriched(project); closeMenus(); }}>Export Excel (SKU List)</button>
                  <button onClick={() => { closeMenus(); setShowHtmlExport(true); }}>Export Viewer (HTML)</button>
                  </div>
                )}
              </div>
            )}

            {/* Tools dropdown */}
            <div className="toolbar-dropdown-wrapper">
              <button className="toolbar-btn" onClick={() => setOpenMenu(openMenu === 'tools' ? null : 'tools')}>
                Tools ▾
              </button>
              {openMenu === 'tools' && (
                <div className="toolbar-dropdown" onMouseLeave={closeMenus}>
                  <button onClick={() => { closeMenus(); setShowDashboard(true); }}>Dashboard</button>
                  {!viewerMode && (
                    <>
                      <hr />
                      {!project?.lockHash ? (
                        <button onClick={() => { closeMenus(); setLockDialog('set'); }}>Lock Project</button>
                      ) : isLocked ? (
                        <button onClick={() => { closeMenus(); setLockDialog('unlock'); }}>Unlock Project</button>
                      ) : (
                        <button onClick={() => { closeMenus(); removeLock(); }}>Remove Lock</button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Manage dropdown */}
            {!viewerMode && (
              <div className="toolbar-dropdown-wrapper">
                <button className="toolbar-btn" disabled={isLocked} onClick={() => setOpenMenu(openMenu === 'manage' ? null : 'manage')}>
                  Manage ▾
                </button>
                {openMenu === 'manage' && (
                  <div className="toolbar-dropdown" onMouseLeave={closeMenus}>
                    <button onClick={() => { closeMenus(); setShowStageManager(true); }}>Manage Stages</button>
                    <hr />
                    <button onClick={() => {
                      if (confirm('Clear all ranges? Products removed from both shelves. Catalogue and matrix labels kept.')) clearRanges();
                      closeMenus();
                    }} className="danger">Clear Ranges</button>
                    <button onClick={() => {
                      if (confirm('Clear the catalogue? Range structure kept but product data lost.')) clearCatalogue();
                      closeMenus();
                    }} className="danger">Clear Catalogue</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!viewerMode && (
          <>
            <input ref={loadRef} type="file" accept=".json" onChange={handleLoad} hidden />
            <button
              className="toolbar-btn"
              onClick={() => { if (fileSession.supported) void handleOpenShared(); else loadRef.current?.click(); }}
              title={fileSession.supported
                ? 'Open a project file — keeps the file connected for Save and check-out'
                : 'Load a project file (this browser cannot keep the file connected — use Chrome or Edge for Save and check-out)'}
            >
              Load
            </button>
            <input ref={appendRef} type="file" accept=".json" onChange={handleAppend} hidden />
            <button
              className="toolbar-btn"
              onClick={() => appendRef.current?.click()}
              title="Append plans and lenses from another project file into this one"
              disabled={!project || isLocked}
            >
              Append
            </button>
          </>
        )}
      </div>
      {appendPreview && (
        <ImportProjectDialog
          preview={appendPreview.preview}
          fileName={appendPreview.fileName}
          onClose={() => setAppendPreview(null)}
        />
      )}
      {showStageManager && (
        <StageManagerDialog onClose={() => setShowStageManager(false)} />
      )}
      {showExportDialog && (
        <ExportDialog onClose={() => setShowExportDialog(false)} />
      )}
      {showDashboard && (
        <DashboardDialog onClose={() => setShowDashboard(false)} />
      )}
      {lockDialog && (
        <LockDialog mode={lockDialog} onClose={() => setLockDialog(null)} />
      )}
      {showHtmlExport && project && (
        <ExportHtmlDialog project={project} onClose={() => setShowHtmlExport(false)} />
      )}
      {namePrompt && (
        <UserNameDialog
          onSave={(name) => { setUserName(name); const cont = namePrompt.cont; setNamePrompt(null); cont(); }}
          onClose={() => setNamePrompt(null)}
        />
      )}
    </div>
    {viewerMode && snapshotDate && (
      <div className="viewer-snapshot-banner">
        Static snapshot exported {snapshotDate} — this is a read-only viewer
      </div>
    )}
    </>
  );
}

/** One-time display-name prompt for shared-file check-out identity.
 * Reuses the .slab-dialog modal styling (global CSS). */
function UserNameDialog({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const submit = () => { const v = value.trim(); if (v) onSave(v); };
  return (
    <div className="slab-dialog-overlay" onClick={onClose}>
      <div className="slab-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Your name</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#666' }}>
          Shown to colleagues while you have the file checked out.
        </p>
        <input
          className="slab-dialog-input"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          placeholder="e.g. Hugo"
        />
        <div className="slab-dialog-actions">
          <button className="slab-dialog-btn cancel" onClick={onClose}>Cancel</button>
          <button className="slab-dialog-btn primary" onClick={submit} disabled={!value.trim()}>Continue</button>
        </div>
      </div>
    </div>
  );
}
