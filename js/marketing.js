import { db } from './firebase.js';
import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const SESSION_KEY = 'eyawriter_session';
const THEME_KEY = 'eyawriter-theme';

function applyMarketingTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'cedar';
  const normalizedTheme = savedTheme === 'rose' ? 'cedar' : savedTheme;
  document.documentElement.dataset.theme = normalizedTheme;
}

function getAppHomeHref() {
  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? '/'
    : '/app';
}

function getCachedSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function syncMarketingNavForSession() {
  const session = getCachedSession();
  if (!session?.loggedIn) return;

  document.querySelectorAll('.nav-actions').forEach(actions => {
    const signInBtn = actions.querySelector('.btn-ghost');
    const primaryBtn = actions.querySelector('.btn-primary');
    const homeHref = getAppHomeHref();

    if (signInBtn) {
      signInBtn.hidden = true;
      signInBtn.classList.add('is-session-hidden');
      signInBtn.setAttribute('aria-hidden', 'true');
      signInBtn.tabIndex = -1;
    }

    if (primaryBtn) {
      primaryBtn.textContent = 'Home';
      primaryBtn.setAttribute('href', homeHref);
    }
  });
}

applyMarketingTheme();
syncMarketingNavForSession();

document.querySelectorAll('.faq-item').forEach(item => {
  const btn = item.querySelector('.faq-question');
  const answer = item.querySelector('.faq-answer');
  if (!btn || !answer) return;

  btn.addEventListener('click', () => {
    const isOpen = item.classList.contains('is-open');
    document.querySelectorAll('.faq-item.is-open').forEach(openItem => {
      openItem.classList.remove('is-open');
      openItem.querySelector('.faq-answer').style.maxHeight = null;
    });
    if (!isOpen) {
      item.classList.add('is-open');
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    }
  });
});

const nav = document.querySelector('.mkt-nav');
document.querySelector('.nav-hamburger')?.addEventListener('click', () => {
  nav?.classList.toggle('is-open');
});

document.addEventListener('click', event => {
  if (nav?.classList.contains('is-open') && !nav.contains(event.target)) {
    nav.classList.remove('is-open');
  }
});

const helpSections = document.querySelectorAll('.help-section[id]');
if (helpSections.length) {
  const sidebarLinks = document.querySelectorAll('.help-sidebar-nav a');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        sidebarLinks.forEach(link => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      }
    });
  }, { rootMargin: '-20% 0px -60% 0px' });
  helpSections.forEach(section => observer.observe(section));
}

const fadeEls = document.querySelectorAll('.fade-up');
if (fadeEls.length) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  fadeEls.forEach(el => observer.observe(el));
}

document.querySelectorAll('.waitlist-form').forEach(form => {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const emailInput = form.querySelector('.waitlist-input[type="email"]');
    const nameInput = form.querySelector('.waitlist-input[name="name"]');
    const btn = form.querySelector('button[type="submit"]');
    const success = form.parentElement?.querySelector('.waitlist-success');
    const email = emailInput?.value.trim().toLowerCase();
    if (!email) return;

    const originalText = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Joining...';
    }

    try {
      await addDoc(collection(db, 'waitlist'), {
        email,
        name: nameInput?.value.trim() || '',
        source: location.pathname,
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent.slice(0, 120)
      });
      form.style.display = 'none';
      if (success) success.style.display = 'block';
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
      const errEl = form.parentElement?.querySelector('.waitlist-error');
      if (errEl) errEl.textContent = 'Something went wrong - try again.';
    }
  });
});
