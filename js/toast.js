const CONTAINER_ID = 'toastContainer';

function getContainer() {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

const ICONS = { success: '✓', error: '✕', info: 'i', warning: '!' };

export function showToast(message, type = 'success', duration = 3500) {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<span class="toast-icon">${ICONS[type] ?? '·'}</span><span class="toast-msg">${message}</span><button class="toast-close" aria-label="Dismiss">✕</button>`;
  container.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('is-visible')));

  const dismiss = () => {
    if (!toast.isConnected) return;
    toast.classList.remove('is-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };

  const timer = setTimeout(dismiss, duration);
  toast.querySelector('.toast-close').addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });

  return { dismiss };
}
