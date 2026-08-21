// Shared-file collaboration session — retains the File System Access
// API handle for the currently-open project file so the app can:
//   - Save back to the same file with no dialog ("Save" vs "Save As")
//   - silently re-read the file for check-out / conflict verification
//   - write the advisory check-out lock and heartbeat refreshes
//
// The handle lives in module state (not the Zustand store) because it
// is a live browser object, not serializable app state. Only Chromium
// browsers support showOpenFilePicker; everywhere else the app falls
// back to the legacy download / file-input flow with no locking.

import type { FileCheckOut, FileMeta } from '../types';

export interface FsFileHandle {
  name?: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}

interface FsWindow extends Window {
  showOpenFilePicker?: (opts?: unknown) => Promise<FsFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FsFileHandle>;
}

export function fsApiSupported(): boolean {
  const w = window as FsWindow;
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

// ---------- identity ----------

const NAME_KEY = 'rangeplanner-user-name';
const SESSION_KEY = 'rangeplanner-session-id';

export function getUserName(): string | null {
  try { return localStorage.getItem(NAME_KEY); } catch { return null; }
}

export function setUserName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
}

export function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return '-s-ephemeral';
  }
}

// ---------- lock staleness ----------

/** A lock whose heartbeat hasn't refreshed for this long is
 * considered abandoned and can be taken over. The heartbeat writes
 * every HEARTBEAT_MS, so this allows ~3 missed beats. */
export const STALE_LOCK_MS = 15 * 60 * 1000;
export const HEARTBEAT_MS = 5 * 60 * 1000;

export function lockIsStale(lock: FileCheckOut): boolean {
  const t = Date.parse(lock.checkedOutAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_LOCK_MS;
}

export function lockAgeLabel(lock: FileCheckOut): string {
  const t = Date.parse(lock.checkedOutAt);
  if (Number.isNaN(t)) return 'unknown';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'moments ago';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// ---------- handle session ----------

let handle: FsFileHandle | null = null;

export function hasHandle(): boolean { return handle !== null; }
export function getHandle(): FsFileHandle | null { return handle; }
export function getHandleName(): string | null { return handle?.name ?? null; }

export function setHandle(h: FsFileHandle | null): void {
  handle = h;
}

export function clearSession(): void {
  handle = null;
  stopHeartbeat();
}

/** Open a project file via the native picker. Returns the handle
 * WITHOUT retaining it — the caller attaches it via setHandle() after
 * loadProject() (which clears any previous session) has run.
 * Returns null if the user cancelled. */
export async function openViaPicker(): Promise<{ handle: FsFileHandle; file: File; text: string } | null> {
  const w = window as FsWindow;
  if (!w.showOpenFilePicker) return null;
  try {
    const [h] = await w.showOpenFilePicker({
      types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    if (!h) return null;
    const file = await h.getFile();
    const text = await file.text();
    return { handle: h, file, text };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
}

/** Re-read the current file from disk (lock checks, conflict checks). */
export async function readCurrent(): Promise<{ text: string; data: Record<string, unknown> } | null> {
  if (!handle) return null;
  const file = await handle.getFile();
  const text = await file.text();
  try {
    return { text, data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { text, data: {} };
  }
}

/** Write content to the retained handle. */
export async function writeCurrent(content: string): Promise<void> {
  if (!handle) throw new Error('No file handle');
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Save-as via the native picker, retaining the new handle.
 * Returns false if the user cancelled. */
export async function saveAsViaPicker(content: string, suggestedName: string): Promise<boolean> {
  const w = window as FsWindow;
  if (!w.showSaveFilePicker) return false;
  try {
    const h = await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
    });
    const writable = await h.createWritable();
    await writable.write(content);
    await writable.close();
    handle = h;
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return false;
    throw err;
  }
}

// ---------- fileMeta helpers ----------

export function readFileMeta(data: Record<string, unknown>): FileMeta {
  const m = data.fileMeta as FileMeta | undefined;
  return { revision: m?.revision ?? 0, lastSavedBy: m?.lastSavedBy, lastSavedAt: m?.lastSavedAt, checkOut: m?.checkOut ?? null };
}

export function myCheckOut(): FileCheckOut {
  return {
    userName: getUserName() ?? 'Unknown',
    sessionId: getSessionId(),
    checkedOutAt: new Date().toISOString(),
  };
}

export function isMyLock(lock: FileCheckOut | null | undefined): boolean {
  return !!lock && lock.sessionId === getSessionId();
}

// ---------- heartbeat ----------

let hbTimer: number | null = null;

/** While checked out, periodically refresh the lock timestamp on disk
 * so other users' stale-lock detection stays accurate. The callback
 * owns the actual read-verify-write cycle. */
export function startHeartbeat(beat: () => void): void {
  stopHeartbeat();
  hbTimer = window.setInterval(beat, HEARTBEAT_MS);
}

export function stopHeartbeat(): void {
  if (hbTimer !== null) {
    window.clearInterval(hbTimer);
    hbTimer = null;
  }
}
