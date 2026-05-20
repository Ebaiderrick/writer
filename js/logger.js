import { auth, db } from './firebase.js';
import { collection, addDoc, getDocs, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { APP_VERSION } from './config.js';

export const SESSION_ID = Math.random().toString(36).slice(2, 10).toUpperCase();
const SESSION_START = Date.now();

function _buildMeta(extra = {}) {
  return {
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    sessionId: SESSION_ID,
    sessionAge: Math.round((Date.now() - SESSION_START) / 1000),
    url: location.pathname + location.search,
    ...extra
  };
}

async function _persist(collName, entry) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await addDoc(collection(db, 'users', uid, collName), entry);
  } catch {
    // silently ignore persistence failures to avoid infinite loops
  }
}

export const Logger = {
  sessionStart: SESSION_START,
  sessionId: SESSION_ID,

  capture(context, error, meta = {}) {
    const entry = {
      ..._buildMeta(meta),
      context: String(context).slice(0, 100),
      message: (error?.message || String(error || '')).slice(0, 500),
      stack: (error?.stack || '').slice(0, 1500),
    };
    console.error(`[Logger:${context}]`, error, meta);
    _persist('errorLog', entry);
  },

  info(context, message, meta = {}) {
    console.info(`[Logger:${context}]`, message, meta);
  },

  async getRecentErrors(n = 10) {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    try {
      const snap = await getDocs(
        query(collection(db, 'users', uid, 'errorLog'), orderBy('timestamp', 'desc'), limit(n))
      );
      return snap.docs.map(d => d.data());
    } catch {
      return [];
    }
  }
};

// Global uncaught error handler
window.addEventListener('error', (event) => {
  if (!event.error && !event.message) return;
  Logger.capture('window.onerror', event.error || { message: event.message }, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

// Global unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (!reason) return;
  Logger.capture('unhandledrejection', reason instanceof Error ? reason : { message: String(reason) });
});
