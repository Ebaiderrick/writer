import { test, expect } from '@playwright/test';

const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.0/';
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Cache-Control': 'no-store' };
const FIREBASE_APP_STUB = `export function initializeApp(config) { return { name: '[DEFAULT]', options: config }; }`;
const FIREBASE_AUTH_STUB = `
export function getAuth(app) { return { app, currentUser: { uid: 'user_test', email: 'test@example.com', displayName: 'Tester', emailVerified: true, providerData: [{ providerId: 'google.com' }] } }; }
export function setPersistence() { return Promise.resolve(); }
export const browserLocalPersistence = 'local';
export function onAuthStateChanged(auth, cb) { Promise.resolve().then(() => cb(null)); return () => {}; }
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
export function getDoc() { return Promise.resolve({ exists: () => false, data: () => undefined, id: 'stub' }); }
export function collection(db, ...args) { return { _path: args.join('/') }; }
export function addDoc() { return Promise.resolve({ id: 'stub-id' }); }
export function getDocs() { return Promise.resolve({ docs: [], forEach: () => {}, empty: true, size: 0 }); }
export function query(ref) { return ref; }
export function orderBy() { return null; }
export function limit() { return null; }
export function where() { return null; }
export function onSnapshot(ref, cb) { if (cb) cb({ docs: [], forEach: () => {}, empty: true }); return () => {}; }
export function deleteDoc() { return Promise.resolve(); }
export function writeBatch(db) { return { set: () => {}, delete: () => {}, update: () => {}, commit: () => Promise.resolve() }; }
export function increment(n) { return n; }
export function updateDoc() { return Promise.resolve(); }
export const serverTimestamp = () => new Date().toISOString();
export function startAfter() { return null; }
`;

async function mockFirebase(page) {
  await page.route(`${FIREBASE_CDN}firebase-app.js`, r => r.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_APP_STUB }));
  await page.route(`${FIREBASE_CDN}firebase-auth.js`, r => r.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_AUTH_STUB }));
  await page.route(`${FIREBASE_CDN}firebase-firestore.js`, r => r.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_FIRESTORE_STUB }));
}

test('auth / landing page', async ({ page }) => {
  await mockFirebase(page);
  await page.goto('http://localhost:8000');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#authView', { state: 'visible', timeout: 10000 });
  await page.screenshot({ path: '/tmp/screenshot_auth.png', fullPage: false });
});

test('home page', async ({ page }) => {
  await mockFirebase(page);
  await page.goto('http://localhost:8000');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('eyawriter_session', JSON.stringify({
      email: 'test@example.com', loggedIn: true, userId: 'user_test', name: 'Tester', isDemoSession: true,
    }));
    localStorage.setItem('eyawriter-projects-v5', JSON.stringify({ backupPrompted: true, tourShown: true }));
  });
  await page.reload();
  await page.waitForSelector('#homeView', { state: 'visible', timeout: 15000 });
  await page.screenshot({ path: '/tmp/screenshot_home.png', fullPage: false });
});

test('home profile popup', async ({ page }) => {
  await mockFirebase(page);
  await page.goto('http://localhost:8000');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('eyawriter_session', JSON.stringify({
      email: 'test@example.com', loggedIn: true, userId: 'user_test', name: 'Tester', isDemoSession: true,
    }));
    localStorage.setItem('eyawriter-projects-v5', JSON.stringify({ backupPrompted: true, tourShown: true }));
  });
  await page.reload();
  await page.waitForSelector('#homeView', { state: 'visible', timeout: 15000 });
  await page.locator('#homeView .open-profile-btn').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/screenshot_profile_popup.png', fullPage: false });
});
