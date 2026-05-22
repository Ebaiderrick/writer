import { auth, db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './toast.js';

// Free plan: max 2 owned scripts
export const FREE_SCRIPT_LIMIT = 2;

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

  getPlan() {
    return _status?.plan || 'free';
  },

  isPro() {
    const plan = _status?.plan;
    const active = _status?.status !== 'canceled';
    return (plan === 'pro' || plan === 'premium_plus') && active;
  },

  isPremiumPlus() {
    return _status?.plan === 'premium_plus' && _status?.status !== 'canceled';
  },

  // Returns true if user can create another script (enforced client-side; also enforced server-side via Firestore rules)
  canCreateScript(ownedScriptCount) {
    if (Billing.isPro()) return true;
    return ownedScriptCount < FREE_SCRIPT_LIMIT;
  },

  async startCheckout(tier = 'pro') {
    const user = auth.currentUser;
    if (!user) { showToast('Please sign in to upgrade', 'warning'); return; }

    const validTier = tier === 'premium_plus' ? 'premium_plus' : 'pro';
    const label = validTier === 'premium_plus' ? 'Premium Plus — $25/mo' : 'Premium — $10/mo';

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
        body: JSON.stringify({ uid: user.uid, email: user.email, tier: validTier })
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Checkout failed — try again', 'error');
        btns.forEach(b => { b.disabled = false; b.textContent = `Upgrade to ${label}`; });
      }
    } catch {
      showToast('Network error — try again', 'error');
      btns.forEach(b => { b.disabled = false; b.textContent = `Upgrade to ${label}`; });
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

  showUpgradeModal(reason = '', tier = 'pro') {
    const modal = document.getElementById('upgradeModal');
    if (!modal) return;
    const reasonEl = document.getElementById('upgradeModalReason');
    if (reasonEl) reasonEl.textContent = reason || "Unlock unlimited AI requests and Premium features.";
    // Wire upgrade button to correct tier if present
    const upgradeBtn = modal.querySelector('.billing-upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.onclick = () => { modal.close(); Billing.startCheckout(tier); };
    }
    modal.showModal();
  },

  // Populate billing settings tab
  async populateSettings() {
    const uid = auth.currentUser?.uid;
    const status = uid ? await _loadStatus(uid) : { plan: 'free' };
    const isPro = Billing.isPro();
    const isPremiumPlus = Billing.isPremiumPlus();

    const planEl = document.getElementById('billingCurrentPlan');
    const statusEl = document.getElementById('billingSubStatus');
    const renewEl = document.getElementById('billingRenewDate');
    const cancelEl = document.getElementById('billingCanceledDate');
    const cancelRow = document.getElementById('billingCanceledRow');
    const upgradeBtn = document.getElementById('billingUpgradeBtn');
    const upgradePlusBtn = document.getElementById('billingUpgradePlusBtn');
    const portalBtn = document.getElementById('billingPortalBtn');
    const proHint = document.getElementById('billingProHint');
    const freeSection = document.getElementById('billingFreeSection');
    const proSection = document.getElementById('billingProSection');

    const planLabel = isPremiumPlus ? 'Premium Plus' : isPro ? 'Premium' : 'Free';
    if (planEl) planEl.textContent = planLabel;
    if (statusEl) statusEl.textContent = isPro ? (status.status || 'active') : '—';
    if (renewEl) renewEl.textContent = status.currentPeriodEnd
      ? new Date(status.currentPeriodEnd).toLocaleDateString() : '—';
    if (cancelEl) cancelEl.textContent = status.canceledAt
      ? new Date(status.canceledAt).toLocaleDateString() : '—';
    if (cancelRow) cancelRow.hidden = !status.canceledAt;

    if (freeSection) freeSection.hidden = isPro;
    if (proSection) proSection.hidden = !isPro;

    // Premium Plus upgrade button only shown to Pro (not Premium Plus) subscribers
    if (upgradePlusBtn) upgradePlusBtn.hidden = isPremiumPlus;
    if (proHint) proHint.textContent = isPremiumPlus
      ? 'You\'re on Premium Plus — 1,000 AI requests/month and unlimited projects.'
      : 'You\'re on Premium — 300 AI requests/month and unlimited projects. Upgrade to Premium Plus for 1,000 AI requests/month.';

    if (upgradeBtn) upgradeBtn.addEventListener('click', () => Billing.startCheckout('pro'));
    if (upgradePlusBtn) upgradePlusBtn.addEventListener('click', () => Billing.startCheckout('premium_plus'));
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
  const isPremiumPlus = Billing.isPremiumPlus();
  const planLabel = isPremiumPlus ? 'Premium Plus' : isPro ? 'Premium' : 'Free';

  document.querySelectorAll('[data-pro-only]').forEach(el => { el.hidden = !isPro; });
  document.querySelectorAll('[data-free-only]').forEach(el => { el.hidden = isPro; });
  document.querySelectorAll('[data-premium-plus-only]').forEach(el => { el.hidden = !isPremiumPlus; });
  document.querySelectorAll('.plan-badge-current').forEach(el => {
    el.textContent = planLabel;
    el.className = `plan-badge-current ${isPremiumPlus ? 'plan-badge-plus-active' : isPro ? 'plan-badge-pro-active' : ''}`;
  });
  const proBadge = document.getElementById('headerProBadge');
  if (proBadge) {
    proBadge.hidden = !isPro;
    proBadge.textContent = isPremiumPlus ? 'Plus' : 'Pro';
  }
}

async function _handleUpgradeReturn(sessionId) {
  if (!sessionId) return;
  try {
    let token = '';
    try { if (auth.currentUser) token = await auth.currentUser.getIdToken(); } catch { /* best-effort */ }
    const res = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();
    if (data.success) {
      _status = { plan: data.plan || 'pro', status: 'active' };
      _applyPlanUI();
      const planLabel = data.plan === 'premium_plus' ? 'Premium Plus' : 'Premium';
      showToast(`Welcome to ${planLabel}! All features unlocked.`, 'success', 6000);
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
