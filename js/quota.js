import { auth, db } from './firebase.js';
import { doc, getDoc, setDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const FREE_MONTHLY_QUOTA     = 50;
export const PREMIUM_MONTHLY_QUOTA  = 300;
export const PREMIUM_PLUS_MONTHLY_QUOTA = 1000;

const CACHE_TTL = 2 * 60 * 1000;

let _cache = null;
let _cacheAt = 0;

function _planLimit(plan) {
  if (plan === 'premium_plus') return PREMIUM_PLUS_MONTHLY_QUOTA;
  if (plan === 'pro')          return PREMIUM_MONTHLY_QUOTA;
  return FREE_MONTHLY_QUOTA;
}

export const Quota = {
  async get() {
    const uid = auth.currentUser?.uid;
    if (!uid) return { plan: 'free', count: 0, remaining: FREE_MONTHLY_QUOTA, total: FREE_MONTHLY_QUOTA };

    if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;

    try {
      const snap = await getDoc(doc(db, 'users', uid, 'quota', 'current'));
      if (!snap.exists()) {
        _cache = { plan: 'free', count: 0, remaining: FREE_MONTHLY_QUOTA, total: FREE_MONTHLY_QUOTA };
        _cacheAt = Date.now();
        return _cache;
      }
      const d = snap.data();
      const plan = d.plan || 'free';
      const total = _planLimit(plan);
      const now = new Date();
      const pastReset = d.resetAt && now >= new Date(d.resetAt);
      const count = pastReset ? 0 : (d.count || 0);
      const remaining = Math.max(0, total - count);
      _cache = { ...d, plan, count, remaining, total };
      _cacheAt = Date.now();
      return _cache;
    } catch {
      return { plan: 'free', count: 0, remaining: FREE_MONTHLY_QUOTA, total: FREE_MONTHLY_QUOTA };
    }
  },

  async check() {
    const q = await Quota.get();
    return { allowed: q.remaining > 0, remaining: q.remaining, total: q.total, plan: q.plan };
  },

  async increment() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = _cache;
    // Pro/premium_plus users also have limits now — always increment
    try {
      const ref = doc(db, 'users', uid, 'quota', 'current');
      const now = new Date();
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const needsReset = !q?.resetAt || now >= new Date(q.resetAt);

      if (needsReset) {
        await setDoc(ref, { count: 1, resetAt: nextReset.toISOString() }, { merge: true });
      } else {
        await setDoc(ref, { count: increment(1) }, { merge: true });
      }
      _cache = null; // bust cache
    } catch { /* silent */ }
  },

  bust() { _cache = null; },

  getCached() { return _cache; },

  async renderUsageBar(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const q = await Quota.get();

    const planLabel = q.plan === 'premium_plus' ? 'Premium Plus' : q.plan === 'pro' ? 'Premium' : 'Free';
    const count = q.count || 0;
    const total = q.total;
    const pct = Math.min(100, Math.round((count / total) * 100));
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : 'var(--accent)';
    const warning = q.remaining <= 10 && q.remaining > 0
      ? `<span class="quota-warning-label">⚠ ${q.remaining} request${q.remaining !== 1 ? 's' : ''} left this month</span>`
      : '';
    el.innerHTML = `
      <div class="quota-bar-wrap">
        <div class="quota-bar-track">
          <div class="quota-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="quota-bar-label">${count} / ${total} AI requests this month (${planLabel})</span>
        ${warning}
      </div>`;
  }
};
