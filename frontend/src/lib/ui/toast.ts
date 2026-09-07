// Tiny dependency-free toast singleton. Usable from any Astro island or inline
// script — it owns its own DOM container and cleans up after itself.

type ToastType = 'info' | 'success' | 'error' | 'warn';

interface ToastOptions {
  type?: ToastType;
  /** ms before auto-dismiss; 0 keeps it until clicked. */
  duration?: number;
}

const ICONS: Record<ToastType, string> = {
  info: 'i',
  success: 'OK',
  error: 'ERR',
  warn: '!',
};

let container: HTMLElement | null = null;
const recent = new Map<string, number>(); // message -> last-shown timestamp (de-dupe)

function ensureContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (container && document.body.contains(container)) return container;
  container = document.createElement('div');
  container.id = 'sa-toaster';
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

export function toast(message: string, opts: ToastOptions = {}): void {
  const root = ensureContainer();
  if (!root || !message) return;

  const type = opts.type ?? 'info';
  const key = `${type}:${message}`;
  const now = Date.now();
  // Swallow the same toast fired again within 2.5s (e.g. a retry loop).
  if ((recent.get(key) ?? 0) > now - 2500) return;
  recent.set(key, now);

  const duration = opts.duration ?? (type === 'error' ? 6000 : 4000);

  const el = document.createElement('div');
  el.className = 'sa-toast';
  el.dataset.type = type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'sa-toast-icon';
  icon.textContent = ICONS[type];
  const msg = document.createElement('span');
  msg.className = 'sa-toast-msg';
  msg.textContent = message;
  el.append(icon, msg);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add('sa-out');
    window.setTimeout(() => el.remove(), 220);
  };
  const arm = () => {
    if (duration > 0) timer = setTimeout(dismiss, duration);
  };

  el.addEventListener('click', dismiss);
  el.addEventListener('mouseenter', () => timer && clearTimeout(timer));
  el.addEventListener('mouseleave', arm);

  root.appendChild(el);
  // Cap the stack.
  while (root.childElementCount > 4) root.firstElementChild?.remove();
  arm();
}

toast.success = (m: string, o: Omit<ToastOptions, 'type'> = {}) => toast(m, { ...o, type: 'success' });
toast.error = (m: string, o: Omit<ToastOptions, 'type'> = {}) => toast(m, { ...o, type: 'error' });
toast.warn = (m: string, o: Omit<ToastOptions, 'type'> = {}) => toast(m, { ...o, type: 'warn' });
toast.info = (m: string, o: Omit<ToastOptions, 'type'> = {}) => toast(m, { ...o, type: 'info' });
