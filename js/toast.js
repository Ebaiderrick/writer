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

const ICONS = { success: '✓', error: '✕', info: 'i', warning: '!', loading: '...' };
const activeToasts = new Map();

export function displayAppToast(message, type = 'success', options = {}) {
  const duration = typeof options === 'number' ? options : (options.duration ?? 3500);
  const id = options.id || `toast-${Math.random().toString(36).substr(2, 9)}`;

  if (activeToasts.has(id)) {
    return updateToast(id, message, type, options);
  }

  const container = getContainer();
  const toast = document.createElement('div');
  toast.id = id;
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<span class="toast-icon">${ICONS[type] ?? '·'}</span><span class="toast-msg">${message}</span><button class="toast-close" aria-label="Dismiss">✕</button>`;
  container.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('is-visible')));

  const dismiss = () => {
    if (!toast.isConnected) return;
    toast.classList.remove('is-visible');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      activeToasts.delete(id);
    }, { once: true });
  };

  let timer = null;
  if (duration > 0) {
    timer = setTimeout(dismiss, duration);
  }

  toast.querySelector('.toast-close').addEventListener('click', () => {
    if (timer) clearTimeout(timer);
    dismiss();
  });

  activeToasts.set(id, { toast, timer, dismiss });
  return id;
}

export function updateToast(id, message, type = 'success', options = {}) {
  const instance = activeToasts.get(id);
  if (!instance) {
    return displayAppToast(message, type, { ...options, id });
  }

  const { toast, timer, dismiss } = instance;
  if (timer) clearTimeout(timer);

  toast.className = `toast toast-${type}`;
  toast.querySelector('.toast-icon').textContent = ICONS[type] ?? '·';
  toast.querySelector('.toast-msg').textContent = message;

  const duration = typeof options === 'number' ? options : (options.duration ?? 3500);
  let newTimer = null;
  if (duration > 0) {
    newTimer = setTimeout(dismiss, duration);
  }

  activeToasts.set(id, { toast, timer: newTimer, dismiss });
  return id;
}
