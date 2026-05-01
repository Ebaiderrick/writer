import { state } from './config.js';
import { getCurrentProject } from './project.js';
import { refs } from './dom.js';
import { slugify } from './utils.js';

const IDB_NAME = 'eyawriter-handles';
const IDB_STORE = 'handles';
const IDB_KEY = 'localSaveFile';

export function isLocalSaveSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensureWritePermission(handle) {
  if (!handle?.queryPermission) return false;
  const opts = { mode: 'readwrite' };
  const current = await handle.queryPermission(opts);
  if (current === 'granted') return true;
  const next = await handle.requestPermission(opts);
  return next === 'granted';
}

function updateFileLabel() {
  if (!refs.localSaveFileLabel) return;
  refs.localSaveFileLabel.textContent = state.localSaveFileHandle
    ? `Backup folder: ${state.localSaveFileHandle.name}`
    : 'No folder selected';
}

export async function chooseLocalSaveFile() {
  if (!isLocalSaveSupported()) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const handle = await window.showDirectoryPicker();
    state.localSaveFileHandle = handle;
    await idbPut(handle);
    updateFileLabel();
    await writeLocalSaveFile();
    return { ok: true };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, reason: 'cancelled' };
    console.error('Failed to choose local backup folder', error);
    return { ok: false, reason: 'error', error };
  }
}

export async function restoreLocalSaveFile() {
  if (!isLocalSaveSupported()) return false;
  try {
    const handle = await idbGet();
    if (!handle) return false;
    const granted = await ensureWritePermission(handle);
    if (!granted) {
      state.localSaveFileHandle = null;
      updateFileLabel();
      return false;
    }
    state.localSaveFileHandle = handle;
    updateFileLabel();
    return true;
  } catch (error) {
    console.error('Failed to restore local save handle', error);
    return false;
  }
}

export async function clearLocalSaveFile() {
  state.localSaveFileHandle = null;
  await idbDelete().catch(() => {});
  updateFileLabel();
}

export async function writeLocalSaveFile(targetProject = null) {
  const directoryHandle = state.localSaveFileHandle;
  if (!directoryHandle) return false;

  const projectsToSave = targetProject ? [targetProject] : state.projects;
  if (!projectsToSave.length) return false;

  try {
    const granted = await ensureWritePermission(directoryHandle);
    if (!granted) return false;

    for (const project of projectsToSave) {
      const fileName = `${slugify(project.title)}.json`;
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(project, null, 2));
      await writable.close();
    }
    return true;
  } catch (error) {
    console.error('Local backup failed', error);
    return false;
  }
}

export function startLocalSaveTimer() {
  stopLocalSaveTimer();
  const minutes = [5, 10, 60].includes(state.localSaveIntervalMinutes)
    ? state.localSaveIntervalMinutes
    : 5;
  state.localSaveTimer = window.setInterval(writeLocalSaveFile, minutes * 60 * 1000);
}

export function stopLocalSaveTimer() {
  if (state.localSaveTimer) {
    window.clearInterval(state.localSaveTimer);
    state.localSaveTimer = null;
  }
}
