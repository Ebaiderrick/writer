import { state } from './config.js';
import { displayAppToast } from './toast.js';

const STORAGE_KEY_MAIN = 'eyawriter-projects-v5';
const SNAPSHOT_KEY     = 'eyawriter-recovery-v1';
const CLEAN_EXIT_KEY   = 'eyawriter-clean-exit-ts';
const SESSION_TS_KEY   = 'eyawriter-session-ts';
const HISTORY_PREFIX   = 'eyawriter-history-v1-';
const OFFLINE_FLAG     = 'eyawriter-offline-sync-pending';

let _onOnline  = null;
let _onOffline = null;
let _isOnline  = navigator.onLine;
let _conflictCooldown = false;

export const Recovery = {
  init({ onOnline, onOffline } = {}) {
    _onOnline  = onOnline;
    _onOffline = onOffline;

    // Mark session as active (survives F5, cleared on clean close)
    sessionStorage.setItem(SESSION_TS_KEY, Date.now().toString());

    window.addEventListener('online',  _handleOnline);
    window.addEventListener('offline', _handleOffline);
    window.addEventListener('storage', _handleStorageConflict);
    window.addEventListener('beforeunload', _markCleanExit);
    // pagehide fires on mobile close and bfcache navigation
    window.addEventListener('pagehide', _markCleanExit);
  },

  // Called from persistProjects() on every save
  writeSnapshot(projects) {
    try {
      const snap = {
        ts: Date.now(),
        count: projects.length,
        titles: projects.slice(0, 5).map(p => p.title || 'Untitled')
      };
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
      _updateSnapshotDisplay(snap);
    } catch { /* storage full — skip */ }
  },

  // Called from boot() after loadProjects() — populates File > File Recovery
  checkAndOffer() {
    const sessionTs   = parseInt(sessionStorage.getItem(SESSION_TS_KEY) || '0', 10);
    const cleanExitTs = parseInt(localStorage.getItem(CLEAN_EXIT_KEY)   || '0', 10);
    const snapshotRaw = localStorage.getItem(SNAPSHOT_KEY);

    // Always populate snapshot display if data exists
    if (snapshotRaw) {
      try {
        const snap = JSON.parse(snapshotRaw);
        _updateSnapshotDisplay(snap);
      } catch { /* corrupt snapshot */ }
    }

    // Refresh offline indicator
    this.refreshOfflineStatus();

    // Only surface the interrupted-session alert when:
    // - sessionStorage key exists (page was refreshed, not a fresh tab open)
    // - clean-exit timestamp is older than the session start → unclean exit
    // - snapshot exists and is within 4 hours
    if (!sessionTs) return;
    if (cleanExitTs >= sessionTs) return;
    if (!snapshotRaw) return;

    try {
      const snap = JSON.parse(snapshotRaw);
      if (!snap.ts || Date.now() - snap.ts > 4 * 60 * 60 * 1000) return;

      const time = new Date(snap.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const alert = document.getElementById('recoverySessionAlert');
      if (alert) {
        alert.textContent = `Session recovered from ${time} — ${snap.count} project${snap.count !== 1 ? 's' : ''} autosaved.`;
        alert.removeAttribute('hidden');
      }
      // Auto-open the File Recovery group so the user sees it
      document.getElementById('fileRecoveryGroup')?.setAttribute('open', '');
    } catch { /* corrupt snapshot */ }
  },

  // Updates the offline/online indicator in File > File Recovery
  refreshOfflineStatus() {
    const row = document.getElementById('recoveryOfflineRow');
    if (!row) return;
    if (!_isOnline && this.hasOfflineSyncPending()) {
      row.removeAttribute('hidden');
    } else {
      row.setAttribute('hidden', '');
    }
  },

  // Persist undo history to sessionStorage for refresh resilience
  persistHistory(projectId) {
    if (!projectId || !state.history.length) return;
    try {
      sessionStorage.setItem(HISTORY_PREFIX + projectId, JSON.stringify({
        history: state.history,
        historyIndex: state.historyIndex
      }));
    } catch { /* storage full */ }
  },

  // Restore undo history for current project (call after loadProjects)
  restoreHistory(projectId) {
    if (!projectId) return false;
    try {
      const raw = sessionStorage.getItem(HISTORY_PREFIX + projectId);
      if (!raw) return false;
      const { history, historyIndex } = JSON.parse(raw);
      if (!Array.isArray(history) || typeof historyIndex !== 'number') return false;
      state.history = history;
      state.historyIndex = historyIndex;
      return true;
    } catch { return false; }
  },

  // Called from syncCurrentProjectToFirestore on network failure
  markOfflineSyncPending() {
    localStorage.setItem(OFFLINE_FLAG, Date.now().toString());
    this.refreshOfflineStatus();
  },

  clearOfflineSyncPending() {
    localStorage.removeItem(OFFLINE_FLAG);
    this.refreshOfflineStatus();
  },

  hasOfflineSyncPending: () => !!localStorage.getItem(OFFLINE_FLAG),

  isOnline: () => _isOnline,
};

// ── Internal ────────────────────────────────────────────────

function _updateSnapshotDisplay(snap) {
  if (!snap?.ts) return;
  const timeEl  = document.getElementById('recoveryLastSave');
  const countEl = document.getElementById('recoveryProjectCount');
  if (timeEl) {
    timeEl.textContent = new Date(snap.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (countEl) {
    countEl.textContent = `${snap.count} project${snap.count !== 1 ? 's' : ''}`;
  }
}

function _handleOnline() {
  _isOnline = true;
  _onOnline?.();
  Recovery.refreshOfflineStatus();
}

function _handleOffline() {
  _isOnline = false;
  _onOffline?.();
  Recovery.refreshOfflineStatus();
}

function _handleStorageConflict(event) {
  if (event.key !== STORAGE_KEY_MAIN || _conflictCooldown) return;
  try {
    const { currentProjectId } = JSON.parse(event.newValue || '{}');
    if (currentProjectId && currentProjectId === state.currentProjectId) {
      _conflictCooldown = true;
      setTimeout(() => { _conflictCooldown = false; }, 10000);
      displayAppToast('This project was saved in another tab. Reload to see those changes.', 'warning', 6000);
    }
  } catch { /* ignore */ }
}

function _markCleanExit() {
  try { localStorage.setItem(CLEAN_EXIT_KEY, Date.now().toString()); } catch { /* ignore */ }
}
