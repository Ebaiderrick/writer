import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Firebase credentials are intentionally hardcoded — they are client-side config, not secrets
const firebaseConfig = {
  apiKey: "AIzaSyC6gi34BQRKkxQ77A50KPvQRIhNWcrWpmo",
  authDomain: "eya-writer.firebaseapp.com",
  projectId: "eya-writer",
  storageBucket: "eya-writer.firebasestorage.app",
  messagingSenderId: "131351915808",
  appId: "1:131351915808:web:a7b27df160c695b58cfb45"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Explicitly persist auth across browser sessions (this is the SDK default; stated for clarity)
setPersistence(auth, browserLocalPersistence).catch(() => {});
