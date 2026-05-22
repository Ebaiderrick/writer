import { auth, db } from './firebase.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { Telemetry } from './telemetry.js';

const LS_KEY = 'eyawriter_ref';
const SITE_URL = 'https://eyawriter.com';

// Code is deterministic from uid — no extra Firestore write needed to generate it
function uidToCode(uid) {
  return (uid || '').slice(0, 8).toUpperCase();
}

export const Referral = {
  // Call once on page load — captures ?ref=CODE from the URL and persists it
  // until the visitor signs up.
  capture() {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref && /^[A-Z0-9]{6,12}$/i.test(ref)) {
        localStorage.setItem(LS_KEY, ref.toUpperCase());
      }
    } catch { /* silently ignore */ }
  },

  // Call after a new user account is created (before signing them out).
  // Writes the referredBy code to their profile and clears the stored code.
  async processSignup(uid) {
    if (!uid) return;
    const code = localStorage.getItem(LS_KEY);
    if (!code) return;
    try {
      await setDoc(doc(db, 'users', uid, 'profile', 'data'), { referredBy: code }, { merge: true });
      await Telemetry.track('referral_signup', { code });
      localStorage.removeItem(LS_KEY);
    } catch { /* silently ignore */ }
  },

  getCode(uid) {
    return uidToCode(uid || auth.currentUser?.uid || '');
  },

  getShareUrl() {
    const code = uidToCode(auth.currentUser?.uid || '');
    if (!code) return SITE_URL;
    return `${SITE_URL}?ref=${code}`;
  },

  async trackShare() {
    await Telemetry.track('referral_shared', { code: this.getCode() });
  },
};
