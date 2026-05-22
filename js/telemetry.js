import { auth, db } from './firebase.js';
import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { APP_VERSION } from './config.js';
import { SESSION_ID } from './logger.js';

export const Telemetry = {
  async track(event, props = {}) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await addDoc(collection(db, 'users', uid, 'events'), {
        event: String(event).slice(0, 80),
        props,
        appVersion: APP_VERSION,
        sessionId: SESSION_ID,
        timestamp: new Date().toISOString()
      });
    } catch {
      // silently ignore
    }
  }
};
