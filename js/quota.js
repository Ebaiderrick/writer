import { auth, db } from './firebase.js';
import { doc, getDoc, setDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const FREE_MONTHLY_QUOTA = 50;
const CACHE_TTL = 2 * 60 * 1000;

let _cache = null;
let _cacheAt = 0;

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
      const now = new Date();
      const pastReset = d.resetAt && now >= new Date(d.resetAt);
      const count = pastReset ? 0 : (d.count || 0);
      const remaining = d.plan === 'pro' ? Infinity : Math.max(0, FREE_MONTHLY_QUOTA - count);
      _cache = { ...d, count, remaining, total: FREE_MONTHLY_QUOTA };
      _cacheAt = Date.now();
      return _cache;
    } catch {
      return { plan: 'free', count: 0, remaining: FREE_MONTHLY_QUOTA, total: FREE_MONTHLY_QUOTA };
    }
  },

  async check() {
    const q = await Quota.get();
    if (q.plan === 'pro') return { allowed: true, remaining: Infinity, isPro: true };
    return { allowed: q.remaining > 0, remaining: q.remaining, total: q.total };
  },

  async increment() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = _cache;
    if (q?.plan === 'pro') return;

    try {
      const ref = doc(db, 'users', uid, 'quota', 'current');
      const now = new Date();
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const needsReset = !q?.resetAt || now >= new Date(q.resetAt);

      if (needsReset) {
        await setDoc(ref, { count: 1, resetAt: nextReset.toISOString(), plan: q?.plan || 'free' }, { merge: true });
      } else {
        await setDoc(ref, { count: increment(1) }, { merge: true });
      }
      _cache = null; // bust cache
    } catch { /* silent */ }
  },

  bust() { _cache = null; },

  async renderUsageBar(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const q = await Quota.get();
    if (q.plan === 'pro') {
      el.innerHTML = '<span class="quota-pro-label">Pro — Unlimited AI</span>';
      return;
    }
    const pct = Math.min(100, Math.round(((q.count || 0) / FREE_MONTHLY_QUOTA) * 100));
    const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : 'var(--accent)';
    el.innerHTML = `
      <div class="quota-bar-wrap">
        <div class="quota-bar-track">
          <div class="quota-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="quota-bar-label">${q.count || 0} / ${FREE_MONTHLY_QUOTA} AI requests this month</span>
      </div>`;
  }
};
