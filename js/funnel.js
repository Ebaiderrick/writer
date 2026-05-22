import { auth, db } from './firebase.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { Telemetry } from './telemetry.js';

// Ordered activation milestones — used by analytics dashboards to measure drop-off
export const FUNNEL_MILESTONES = [
  'signed_up',
  'first_login',
  'onboarding_started',
  'onboarding_completed',
  'first_project_created',
  'first_line_typed',
  'ai_first_used',
  'first_export',
  'collab_first_invite',
];

// Idempotent milestone recorder.
// Accepts an explicit uid for flows where auth.currentUser is unavailable (e.g. post-signup signout).
export const Funnel = {
  async milestone(name, uid) {
    const resolvedUid = uid || auth.currentUser?.uid;
    if (!resolvedUid) return;
    try {
      const ref = doc(db, 'users', resolvedUid, 'funnel', 'activation');
      const snap = await getDoc(ref);
      const existing = snap.exists() ? snap.data() : {};
      if (existing[name]) return; // already recorded — skip to stay idempotent
      await setDoc(ref, {
        [name]: new Date().toISOString(),
        lastMilestone: name,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      Telemetry.track(`funnel_${name}`, { milestone: name });
    } catch {
      // silently ignore — funnel tracking is non-blocking
    }
  },
};
