import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function _init() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return { auth: null, db: null };
  try {
    if (!getApps().length) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    return { auth: getAuth(), db: getFirestore() };
  } catch (err) {
    console.error('[admin-init] Firebase Admin init failed:', err.message);
    return { auth: null, db: null };
  }
}

const { auth: adminAuth, db: adminDb } = _init();
export { adminAuth, adminDb };
