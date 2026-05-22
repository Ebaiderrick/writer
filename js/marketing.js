import { db } from './firebase.js';
import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── FAQ accordion ──────────────────────────────────────────────────────────

document.querySelectorAll('.faq-item').forEach(item => {
  const btn = item.querySelector('.faq-question');
  const answer = item.querySelector('.faq-answer');
  if (!btn || !answer) return;

  btn.addEventListener('click', () => {
    const isOpen = item.classList.contains('is-open');
    // Close all
    document.querySelectorAll('.faq-item.is-open').forEach(o => {
      o.classList.remove('is-open');
      o.querySelector('.faq-answer').style.maxHeight = null;
    });
    if (!isOpen) {
      item.classList.add('is-open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
    }
  });
});

// ── Mobile nav toggle ──────────────────────────────────────────────────────

const nav = document.querySelector('.mkt-nav');
document.querySelector('.nav-hamburger')?.addEventListener('click', () => {
  nav?.classList.toggle('is-open');
});

document.addEventListener('click', e => {
  if (nav?.classList.contains('is-open') && !nav.contains(e.target)) {
    nav.classList.remove('is-open');
  }
});

// ── Help sidebar active state on scroll ────────────────────────────────────

const helpSections = document.querySelectorAll('.help-section[id]');
if (helpSections.length) {
  const sidebarLinks = document.querySelectorAll('.help-sidebar-nav a');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        sidebarLinks.forEach(a => {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      }
    });
  }, { rootMargin: '-20% 0px -60% 0px' });
  helpSections.forEach(s => observer.observe(s));
}

// ── Fade-up animations ─────────────────────────────────────────────────────

const fadeEls = document.querySelectorAll('.fade-up');
if (fadeEls.length) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  fadeEls.forEach(el => io.observe(el));
}

// ── Waitlist form ──────────────────────────────────────────────────────────

document.querySelectorAll('.waitlist-form').forEach(form => {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const emailInput = form.querySelector('.waitlist-input[type="email"]');
    const nameInput  = form.querySelector('.waitlist-input[name="name"]');
    const btn        = form.querySelector('button[type="submit"]');
    const success    = form.parentElement?.querySelector('.waitlist-success');
    const email      = emailInput?.value.trim().toLowerCase();
    if (!email) return;

    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }

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
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      const errEl = form.parentElement?.querySelector('.waitlist-error');
      if (errEl) errEl.textContent = 'Something went wrong — try again.';
    }
  });
});
