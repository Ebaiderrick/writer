import { setTheme } from './ui.js';

const STORAGE_KEY = 'eyawriter_onboarded_v1';

let overlay, stepEls, dots, currentStep = 0;

export const Onboarding = {
  maybeShow() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;
    stepEls = Array.from(overlay.querySelectorAll('.ob-step'));
    dots = Array.from(overlay.querySelectorAll('.ob-dot'));
    _bindEvents();
    _goTo(0);
    overlay.classList.add('is-active');
  },

  dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    overlay?.classList.remove('is-active');
  }
};

function _goTo(n) {
  currentStep = n;
  stepEls.forEach((el, i) => el.classList.toggle('is-active', i === n));
  dots.forEach((dot, i) => dot.classList.toggle('is-active', i === n));
}

function _bindEvents() {
  overlay.querySelectorAll('[data-ob-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = parseInt(btn.dataset.obNext, 10);
      if (next < stepEls.length) {
        _goTo(next);
      } else {
        Onboarding.dismiss();
      }
    });
  });

  overlay.querySelectorAll('[data-ob-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.obTheme;
      overlay.querySelectorAll('[data-ob-theme]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      setTheme(theme);
    });
  });

  overlay.querySelector('.ob-skip')?.addEventListener('click', () => Onboarding.dismiss());

  overlay.querySelector('[data-ob-new-project]')?.addEventListener('click', () => {
    Onboarding.dismiss();
    document.querySelector('[data-menu-action="new-project"]')?.click();
  });

  overlay.querySelector('[data-ob-demo]')?.addEventListener('click', () => {
    Onboarding.dismiss();
    document.getElementById('demo-login-btn')?.click();
  });
}
