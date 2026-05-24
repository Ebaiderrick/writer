import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
