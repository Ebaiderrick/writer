import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './toast.js';

let _status = null;

export const Billing = {
  async init() {
    // Handle redirect back from Stripe Checkout
    const params = new URLSearchParams(location.search);
    if (params.get('upgraded') === 'true') {
      const sessionId = params.get('session_id');
      history.replaceState({}, '', location.pathname);
      await _handleUpgradeReturn(sessionId);
    }

    const uid = auth.currentUser?.uid;
    if (uid) {
      await _loadStatus(uid);
      _applyPlanUI();
      await _checkAnnouncement();
    }
  },

  async getStatus() {
    const uid = auth.currentUser?.uid;
    if (!uid) return { plan: 'free' };
    if (_status) return _status;
    return _loadStatus(uid);
  },

  isPro() {
    return _status?.plan === 'pro' && _status?.status !== 'canceled';
  },

  async startCheckout() {
    const user = auth.currentUser;
    if (!user) { showToast('Please sign in to upgrade', 'warning'); return; }

    const btns = document.querySelectorAll('.billing-upgrade-btn');
    btns.forEach(b => { b.disabled = true; b.textContent = 'Redirecting to checkout…'; });

    try {
      let token = '';
      try { token = await user.getIdToken(); } catch { /* send uid/email fallback */ }

      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ uid: user.uid, email: user.email })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Checkout failed — try again', 'error');
        btns.forEach(b => { b.disabled = false; b.textContent = 'Upgrade to Premium — $10/mo'; });
      }
    } catch {
      showToast('Network error — try again', 'error');
      btns.forEach(b => { b.disabled = false; b.textContent = 'Upgrade to Premium — $10/mo'; });
    }
  },

  async openPortal() {
    const user = auth.currentUser;
    const customerId = _status?.stripeCustomerId;
    if (!customerId) { showToast('No billing account found', 'warning'); return; }
    try {
      let token = '';
      try { if (user) token = await user.getIdToken(); } catch { /* use customerId fallback */ }

      const res = await fetch('/api/billing-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ customerId })
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else showToast(data.error || 'Could not open portal', 'error');
    } catch {
      showToast('Network error — try again', 'error');
    }
  },

  showUpgradeModal(reason = '') {
    const modal = document.getElementById('upgradeModal');
    if (!modal) return;
    const reasonEl = document.getElementById('upgradeModalReason');
    if (reasonEl) reasonEl.textContent = reason || "Unlock unlimited AI requests and Premium features.";
    modal.showModal();
  },

  // Populate billing settings tab
  async populateSettings() {
    const uid = auth.currentUser?.uid;
    const status = uid ? await _loadStatus(uid) : { plan: 'free' };
    const isPro = Billing.isPro();

    const planEl = document.getElementById('billingCurrentPlan');
    const statusEl = document.getElementById('billingSubStatus');
    const renewEl = document.getElementById('billingRenewDate');
    const upgradeBtn = document.getElementById('billingUpgradeBtn');
    const portalBtn = document.getElementById('billingPortalBtn');
    const freeSection = document.getElementById('billingFreeSection');
    const proSection = document.getElementById('billingProSection');

    if (planEl) planEl.textContent = isPro ? 'Premium' : 'Free';
    if (statusEl) statusEl.textContent = isPro ? (status.status || 'active') : '—';
    if (renewEl) renewEl.textContent = status.currentPeriodEnd
      ? new Date(status.currentPeriodEnd).toLocaleDateString() : '—';

    if (freeSection) freeSection.hidden = isPro;
    if (proSection) proSection.hidden = !isPro;

    if (upgradeBtn) upgradeBtn.addEventListener('click', () => Billing.startCheckout());
    if (portalBtn) portalBtn.addEventListener('click', () => Billing.openPortal());
  }
};

async function _loadStatus(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'billing', 'data'));
    _status = snap.exists() ? snap.data() : { plan: 'free' };
  } catch {
    _status = { plan: 'free' };
  }
  return _status;
}

function _applyPlanUI() {
  const isPro = Billing.isPro();
  document.querySelectorAll('[data-pro-only]').forEach(el => { el.hidden = !isPro; });
  document.querySelectorAll('[data-free-only]').forEach(el => { el.hidden = isPro; });
  document.querySelectorAll('.plan-badge-current').forEach(el => {
    el.textContent = isPro ? 'Premium' : 'Free';
    el.className = `plan-badge-current ${isPro ? 'plan-badge-pro-active' : ''}`;
  });
  const proBadge = document.getElementById('headerProBadge');
  if (proBadge) proBadge.hidden = !isPro;
}

async function _handleUpgradeReturn(sessionId) {
  if (!sessionId) return;
  try {
    const res = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();
    if (data.success) {
      _status = { plan: 'pro', status: 'active' };
      _applyPlanUI();
      showToast('Welcome to Premium! All features unlocked.', 'success', 6000);
    }
  } catch {
    // Silent — subscription will sync via webhook
  }
}

async function _checkAnnouncement() {
  try {
    const snap = await getDoc(doc(db, 'config', 'announcement'));
    if (!snap.exists()) return;
    const ann = snap.data();
    if (!ann.enabled) return;

    const dismissKey = `eyawriter_ann_${ann.dismissKey || 'default'}`;
    if (localStorage.getItem(dismissKey)) return;

    const banner = document.getElementById('announcementBanner');
    const msg = document.getElementById('announcementMsg');
    if (!banner || !msg) return;
    msg.textContent = ann.message || '';
    banner.dataset.type = ann.type || 'info';
    banner.hidden = false;

    document.getElementById('announcementDismiss')?.addEventListener('click', () => {
      banner.hidden = true;
      if (ann.dismissible !== false) localStorage.setItem(dismissKey, '1');
    }, { once: true });
  } catch { /* optional */ }
}
