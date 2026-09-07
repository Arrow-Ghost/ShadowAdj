// Global keyboard navigation + a "?" help overlay. Attaches one document
// listener that survives Astro view transitions.

type Route = { keys: string; label: string; href: string };

const ROUTES: Route[] = [
  { keys: 'd', label: 'Home / dashboard', href: '/' },
  { keys: 'c', label: 'Practice console', href: '/console' },
  { keys: 'j', label: 'Judge HUD', href: '/judge' },
  { keys: 'r', label: 'Case review', href: '/review' },
  { keys: 'o', label: 'Coach', href: '/coach' },
  { keys: 'a', label: 'Admin', href: '/admin' },
  { keys: 'h', label: 'History', href: '/history' },
  { keys: 's', label: 'Product spec', href: '/about' },
];

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  const tag = n.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable;
}

/* ------------------------------- help overlay ------------------------------ */

let overlay: HTMLElement | null = null;

function buildOverlay(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.id = 'sa-keys-overlay';
  wrap.hidden = true;
  const rows = ROUTES.map(
    (r) => `<div class="sa-keys-row"><span>${r.label}</span><span><kbd>g</kbd> <kbd>${r.keys}</kbd></span></div>`,
  ).join('');
  wrap.innerHTML = `
    <div class="sa-keys-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <div class="sa-keys-row"><span>Show / hide this panel</span><span><kbd>?</kbd></span></div>
      <div class="sa-keys-row"><span>Go to a page</span><span><kbd>g</kbd> then a key below</span></div>
      ${rows}
      <div class="sa-keys-row"><span>Close</span><span><kbd>Esc</kbd></span></div>
    </div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) hideOverlay();
  });
  document.body.appendChild(wrap);
  return wrap;
}

function showOverlay() {
  overlay = overlay && document.body.contains(overlay) ? overlay : buildOverlay();
  overlay.hidden = false;
}
function hideOverlay() {
  if (overlay) overlay.hidden = true;
}
function toggleOverlay() {
  if (overlay && !overlay.hidden) hideOverlay();
  else showOverlay();
}

/* --------------------------------- chord --------------------------------- */

let chordActive = false;
let chordTimer: ReturnType<typeof setTimeout> | undefined;
let hintEl: HTMLElement | null = null;

function showChordHint() {
  hintEl = hintEl && document.body.contains(hintEl) ? hintEl : null;
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.id = 'sa-chord-hint';
    hintEl.textContent = 'g …';
    document.body.appendChild(hintEl);
  }
  hintEl.hidden = false;
}
function clearChord() {
  chordActive = false;
  if (chordTimer) clearTimeout(chordTimer);
  if (hintEl) hintEl.hidden = true;
}

/* -------------------------------- listener ------------------------------- */

function onKeydown(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Escape') {
    if (overlay && !overlay.hidden) {
      hideOverlay();
      e.preventDefault();
    }
    clearChord();
    return;
  }

  if (isTyping(e.target)) return;

  if (e.key === '?') {
    e.preventDefault();
    toggleOverlay();
    return;
  }

  if (chordActive) {
    const route = ROUTES.find((r) => r.keys === e.key.toLowerCase());
    clearChord();
    if (route) {
      e.preventDefault();
      if (location.pathname !== route.href) location.href = route.href;
    }
    return;
  }

  if (e.key.toLowerCase() === 'g') {
    chordActive = true;
    showChordHint();
    chordTimer = setTimeout(clearChord, 1400);
  }
}

if (typeof document !== 'undefined' && !(window as unknown as { __saHotkeys?: boolean }).__saHotkeys) {
  (window as unknown as { __saHotkeys?: boolean }).__saHotkeys = true;
  document.addEventListener('keydown', onKeydown);
}
