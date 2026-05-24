import { test, expect } from '@playwright/test';

const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.0/';

const FIREBASE_APP_STUB = `
export function initializeApp(config) { return { name: '[DEFAULT]', options: config }; }
`;

const FIREBASE_AUTH_STUB = `
export function getAuth(app) { return { app, currentUser: null }; }
export function setPersistence(auth, p) { return Promise.resolve(); }
export const browserLocalPersistence = 'local';
export function onAuthStateChanged(auth, callback) {
  Promise.resolve().then(() => callback(null));
  return () => {};
}
export class GoogleAuthProvider { addScope() {} setCustomParameters() {} static credentialFromResult() { return null; } }
export function createUserWithEmailAndPassword() { return Promise.reject(new Error('stub')); }
export function signInWithEmailAndPassword() { return Promise.reject(new Error('stub')); }
export function signInWithPopup() { return Promise.reject(new Error('stub')); }
export function signInWithRedirect() { return Promise.resolve(); }
export function getRedirectResult() { return Promise.resolve(null); }
export function sendPasswordResetEmail() { return Promise.resolve(); }
export function sendEmailVerification() { return Promise.resolve(); }
export const signOut = () => Promise.resolve();
export function updateProfile() { return Promise.resolve(); }
`;

const FIREBASE_FIRESTORE_STUB = `
export function getFirestore(app) { return { app }; }
export function doc(db, ...args) { return { _path: args.join('/') }; }
export function setDoc() { return Promise.resolve(); }
export function getDoc(ref) {
  return Promise.resolve({ exists: () => false, data: () => undefined, id: 'stub' });
}
export function collection(db, ...args) { return { _path: args.join('/') }; }
export function addDoc() { return Promise.resolve({ id: 'stub-id' }); }
export function getDocs() {
  return Promise.resolve({ docs: [], forEach: () => {}, empty: true, size: 0 });
}
export function query(ref) { return ref; }
export function orderBy() { return null; }
export function limit() { return null; }
export function where() { return null; }
export function onSnapshot(ref, cb) { if (cb) cb({ docs: [], forEach: () => {}, empty: true }); return () => {}; }
export function deleteDoc() { return Promise.resolve(); }
export function writeBatch(db) {
  return { set: () => {}, delete: () => {}, update: () => {}, commit: () => Promise.resolve() };
}
export function increment(n) { return n; }
export function updateDoc() { return Promise.resolve(); }
export const serverTimestamp = () => new Date().toISOString();
export function startAfter() { return null; }
`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
};

async function mockFirebase(page) {
  await page.route(`${FIREBASE_CDN}firebase-app.js`, route =>
    route.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_APP_STUB })
  );
  await page.route(`${FIREBASE_CDN}firebase-auth.js`, route =>
    route.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_AUTH_STUB })
  );
  await page.route(`${FIREBASE_CDN}firebase-firestore.js`, route =>
    route.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_FIRESTORE_STUB })
  );
}

export async function login(page) {
  await mockFirebase(page);

  await page.goto('http://localhost:8000');

  // Inject mock user and session
  await page.evaluate(() => {
    const user = { id: 'user_test', email: 'test@example.com', name: 'Tester', password: 'password' };
    localStorage.setItem('eyawriter_users', JSON.stringify([user]));
    localStorage.setItem('eyawriter_session', JSON.stringify({
      email: 'test@example.com',
      loggedIn: true,
      userId: 'user_test',
      name: 'Tester',
      isDemoSession: true // Prevent onAuthStateChanged from clearing the session
    }));
    // Bypass backup prompt modal and tour by setting it in the main storage object
    const storageKey = "eyawriter-projects-v5";
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');
    localStorage.setItem(storageKey, JSON.stringify({
      ...existing,
      backupPrompted: true,
      tourShown: true
    }));
  });

  await page.reload();

  // Wait for the app to detect session and show homeView
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
}
