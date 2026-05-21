import { auth, db } from './firebase.js';
import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { APP_VERSION } from './config.js';

const LS_KEY = 'eyawriter_nps_v1';
const MIN_DAYS_BEFORE_SHOW = 7;

export const NPS = {
  init() {
    const dialog = document.getElementById('npsDialog');
    if (!dialog) return;

    // Score selection
    dialog.querySelectorAll('.nps-score-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        dialog.querySelectorAll('.nps-score-btn').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        dialog.querySelector('.nps-submit-btn')?.removeAttribute('disabled');
      });
    });

    dialog.querySelector('.nps-submit-btn')?.addEventListener('click', async () => {
      const score = parseInt(dialog.querySelector('.nps-score-btn.is-selected')?.dataset.score ?? '-1', 10);
      if (score < 0) return;
      const comment = dialog.querySelector('.nps-comment')?.value.trim() || '';
      await NPS.submit(score, comment);
    });

    dialog.querySelector('.nps-dismiss-btn')?.addEventListener('click', () => NPS.dismiss());
  },

  async maybeShow() {
    if (localStorage.getItem(LS_KEY)) return;
    if (!auth.currentUser) return;

    try {
      const session = _getSession();
      const createdAt = session?.loggedInAt;
      if (!createdAt) return;
      const daysSince = (Date.now() - new Date(createdAt)) / (1000 * 60 * 60 * 24);
      if (daysSince < MIN_DAYS_BEFORE_SHOW) return;
    } catch { return; }

    setTimeout(() => NPS.show(), 4000);
  },

  show() {
    document.getElementById('npsDialog')?.showModal();
  },

  dismiss() {
    document.getElementById('npsDialog')?.close();
    localStorage.setItem(LS_KEY, 'dismissed');
  },

  async submit(score, comment) {
    localStorage.setItem(LS_KEY, 'submitted');
    document.getElementById('npsDialog')?.close();

    const uid = auth.currentUser?.uid;
    try {
      await addDoc(collection(db, 'adminFeedback'), {
        type: 'nps',
        subject: `NPS Score: ${score}/10`,
        body: comment,
        score,
        uid: uid || null,
        appVersion: APP_VERSION,
        timestamp: new Date().toISOString()
      });
    } catch { /* silent */ }
  }
};

function _getSession() {
  try { return JSON.parse(localStorage.getItem('eyawriter_session') || 'null'); } catch { return null; }
}
