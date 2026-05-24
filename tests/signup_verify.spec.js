import { test, expect } from '@playwright/test';

const FIREBASE_CDN = 'https://www.gstatic.com/firebasejs/10.12.0/';
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Cache-Control': 'no-store' };

const FIREBASE_APP_STUB = `export function initializeApp(config) { return { name: '[DEFAULT]', options: config }; }`;

const FIREBASE_AUTH_STUB = `
export function getAuth(app) { return { app, currentUser: null }; }
export function setPersistence(auth, p) { return Promise.resolve(); }
export const browserLocalPersistence = 'local';
export function onAuthStateChanged(auth, callback) {
  Promise.resolve().then(() => callback(null));
  return () => {};
}
export class GoogleAuthProvider { addScope() {} setCustomParameters() {} static credentialFromResult() { return null; } }
export function createUserWithEmailAndPassword(auth, email, password) {
  return Promise.resolve({ user: { uid: 'new-user-123', email, displayName: null } });
}
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
export function getDoc(ref) { return Promise.resolve({ exists: () => false, data: () => undefined, id: 'stub' }); }
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

async function goToSignUpForm(page) {
  await page.route(`${FIREBASE_CDN}firebase-app.js`, route =>
    route.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_APP_STUB })
  );
  await page.route(`${FIREBASE_CDN}firebase-auth.js`, route =>
    route.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_AUTH_STUB })
  );
  await page.route(`${FIREBASE_CDN}firebase-firestore.js`, route =>
    route.fulfill({ contentType: 'text/javascript', headers: CORS_HEADERS, body: FIREBASE_FIRESTORE_STUB })
  );

  await page.goto('http://localhost:8000');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.locator('#authView')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-tab="signup"]').click();
  await expect(page.locator('#signup-form')).toBeVisible({ timeout: 5000 });
}

test('sign-up form is visible with all fields', async ({ page }) => {
  await goToSignUpForm(page);

  await expect(page.locator('#signup-name')).toBeVisible();
  await expect(page.locator('#signup-email')).toBeVisible();
  await expect(page.locator('#signup-pass')).toBeVisible();
  await expect(page.locator('#signup-pass2')).toBeVisible();
  await expect(page.locator('#signup-form button[type="submit"]')).toBeVisible();
});

test('sign-up password mismatch sets native validation', async ({ page }) => {
  await goToSignUpForm(page);

  await page.fill('#signup-name', 'Test User');
  await page.fill('#signup-email', 'newuser@example.com');
  await page.fill('#signup-pass', 'SecurePass1');
  await page.fill('#signup-pass2', 'WrongPass99');

  // setCustomValidity fires on input — check that the field is marked invalid
  const isInvalid = await page.locator('#signup-pass2').evaluate(el => !el.validity.valid);
  expect(isInvalid).toBe(true);

  const validationMsg = await page.locator('#signup-pass2').evaluate(el => el.validationMessage);
  console.log('Validation message:', validationMsg);
  expect(validationMsg).toMatch(/Passwords don't match/i);
});

test('sign-up flow shows account-created confirmation modal', async ({ page }) => {
  await goToSignUpForm(page);

  await page.fill('#signup-name', 'Test User');
  await page.fill('#signup-email', 'newuser@example.com');
  await page.fill('#signup-pass', 'SecurePass1');
  await page.fill('#signup-pass2', 'SecurePass1');
  await page.locator('#signup-form .checkbox-group input[type="checkbox"]').check();

  await page.locator('#signup-form button[type="submit"]').click();

  // App uses <dialog> element for alerts, not window.alert
  await expect(page.locator('#modalMessage')).toHaveText(/Account created|Verify/i, { timeout: 8000 });
  const modalText = await page.locator('#modalMessage').textContent();
  console.log('Modal text:', modalText);

  // Dismiss the modal
  await page.click('#modalConfirmBtn');

  // User stays on auth view — must verify email before signing in
  await expect(page.locator('#authView')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#homeView')).toBeHidden();
});
