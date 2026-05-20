import { state } from './config.js';
import { showToast } from './toast.js';

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
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        ts: Date.now(),
        count: projects.length,
        titles: projects.slice(0, 5).map(p => p.title || 'Untitled')
      }));
    } catch { /* storage full — skip */ }
  },

  // Called from boot() after loadProjects()
  checkAndOffer() {
    const sessionTs    = parseInt(sessionStorage.getItem(SESSION_TS_KEY) || '0', 10);
    const cleanExitTs  = parseInt(localStorage.getItem(CLEAN_EXIT_KEY)   || '0', 10);

    // Only notify if this is a session restore (page refresh), not a new open.
    // sessionStorage persists across F5 but is cleared on tab close.
    if (!sessionTs) return;

    // If clean exit timestamp is more recent → normal close, no recovery needed
    if (cleanExitTs >= sessionTs) return;

    const snapshotRaw = localStorage.getItem(SNAPSHOT_KEY);
    if (!snapshotRaw) return;

    try {
      const snap = JSON.parse(snapshotRaw);
      // Only surface if snapshot is recent (within 4 hours)
      if (!snap.ts || Date.now() - snap.ts > 4 * 60 * 60 * 1000) return;

      const banner = document.getElementById('recoveryBanner');
      if (!banner) return;

      const time = new Date(snap.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const label = document.getElementById('recoveryBannerMsg');
      if (label) {
        label.textContent = `Session recovered from ${time} — ${snap.count} project${snap.count !== 1 ? 's' : ''} autosaved.`;
      }
      banner.classList.add('is-visible');

      document.getElementById('recoveryBannerDismiss')?.addEventListener('click', () => {
        banner.classList.remove('is-visible');
      }, { once: true });

    } catch { /* corrupt snapshot */ }
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
  },

  clearOfflineSyncPending() {
    localStorage.removeItem(OFFLINE_FLAG);
  },

  hasOfflineSyncPending: () => !!localStorage.getItem(OFFLINE_FLAG),

  isOnline: () => _isOnline,
};

// ── Internal ────────────────────────────────────────────────

function _handleOnline() {
  _isOnline = true;
  _onOnline?.();
}

function _handleOffline() {
  _isOnline = false;
  _onOffline?.();
}

function _handleStorageConflict(event) {
  if (event.key !== STORAGE_KEY_MAIN || _conflictCooldown) return;
  try {
    const { currentProjectId } = JSON.parse(event.newValue || '{}');
    if (currentProjectId && currentProjectId === state.currentProjectId) {
      _conflictCooldown = true;
      setTimeout(() => { _conflictCooldown = false; }, 10000);
      showToast('This project was saved in another tab. Reload to see those changes.', 'warning', 6000);
    }
  } catch { /* ignore */ }
}

function _markCleanExit() {
  try { localStorage.setItem(CLEAN_EXIT_KEY, Date.now().toString()); } catch { /* ignore */ }
}
