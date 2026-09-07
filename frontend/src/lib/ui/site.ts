// Site chrome: Lenis smooth scroll, scroll-progress rail, magnetic custom
// cursor, and nav scroll-state. One module, attaches once, re-syncs on Astro
// view transitions, and stands down entirely under prefers-reduced-motion.

import Lenis from 'lenis';

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const COARSE =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

let lenis: Lenis | null = null;
let rafId = 0;

/* ------------------------------- Lenis -------------------------------- */
function initLenis() {
  if (REDUCED || lenis) return;
  lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    touchMultiplier: 1.6,
  });
  const raf = (time: number) => {
    lenis?.raf(time);
    rafId = requestAnimationFrame(raf);
  };
  rafId = requestAnimationFrame(raf);

  // expose for GSAP ScrollTrigger sync + anchor links
  (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
  document.addEventListener('click', onAnchorClick);
}

function onAnchorClick(e: MouseEvent) {
  const a = (e.target as HTMLElement)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
  if (!a) return;
  const id = a.getAttribute('href')!.slice(1);
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  if (lenis) lenis.scrollTo(el, { offset: -80, duration: 1.3 });
  else el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

/* -------------------------- scroll progress -------------------------- */
function initProgress() {
  const bar = document.getElementById('scroll-progress');
  if (!bar) return;
  const update = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const p = h > 0 ? Math.min(1, window.scrollY / h) : 0;
    bar.style.transform = `scaleX(${p})`;
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
}

/* ---------------------------- nav state ----------------------------- */
function initNavState() {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  const update = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

/* --------------------------- custom cursor -------------------------- */
function initCursor() {
  if (REDUCED || COARSE) return;
  const dot = document.getElementById('cursor-dot');
  const ring = document.getElementById('cursor-ring');
  if (!dot || !ring) return;

  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let rx = mx;
  let ry = my;

  window.addEventListener(
    'mousemove',
    (e) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
    },
    { passive: true },
  );

  const tick = () => {
    rx += (mx - rx) * 0.16;
    ry += (my - ry) * 0.16;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    requestAnimationFrame(tick);
  };
  tick();

  const HOVER = 'a,button,[role="button"],input,select,textarea,summary,.glass-interactive,[data-cursor="hover"]';
  document.addEventListener(
    'pointerover',
    (e) => {
      if ((e.target as HTMLElement)?.closest?.(HOVER)) ring.classList.add('is-hover');
    },
    true,
  );
  document.addEventListener(
    'pointerout',
    (e) => {
      if ((e.target as HTMLElement)?.closest?.(HOVER)) ring.classList.remove('is-hover');
    },
    true,
  );
  window.addEventListener('mousedown', () => ring.classList.add('is-down'));
  window.addEventListener('mouseup', () => ring.classList.remove('is-down'));
}

/* ------------------------ magnetic buttons ------------------------- */
function initMagnetic() {
  if (REDUCED || COARSE) return;
  const wire = (el: HTMLElement) => {
    if ((el as unknown as { _mag?: boolean })._mag) return;
    (el as unknown as { _mag?: boolean })._mag = true;
    const strength = Number(el.dataset.magnetic) || 0.28;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * strength;
      const y = (e.clientY - (r.top + r.height / 2)) * strength;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  };
  document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach(wire);
}

/* ----------------------- 3D tilt on hover ------------------------- */
function initTilt() {
  if (REDUCED || COARSE) return;
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    if ((el as unknown as { _tilt?: boolean })._tilt) return;
    (el as unknown as { _tilt?: boolean })._tilt = true;
    const max = Number(el.dataset.tilt) || 7;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.classList.add('is-tilting');
      el.style.setProperty('--tx', `${px * max}deg`);
      el.style.setProperty('--ty', `${-py * max}deg`);
    });
    el.addEventListener('pointerleave', () => {
      el.classList.remove('is-tilting');
      el.style.setProperty('--tx', '0deg');
      el.style.setProperty('--ty', '0deg');
    });
  });
}

/* ---------- scroll velocity → --sv (subtle stretch) ------------- */
function initVelocity() {
  if (REDUCED) return;
  const root = document.documentElement;
  if (lenis) {
    lenis.on('scroll', (e: { velocity?: number }) => {
      const v = Math.max(-1, Math.min(1, (e.velocity ?? 0) / 40));
      root.style.setProperty('--sv', v.toFixed(3));
    });
  } else {
    let last = window.scrollY;
    let raf = 0;
    const loop = () => {
      const now = window.scrollY;
      const v = Math.max(-1, Math.min(1, (now - last) / 60));
      last = now;
      root.style.setProperty('--sv', v.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    void raf;
  }
}

/* ------------------------------ boot ------------------------------- */
function boot() {
  initProgress();
  initNavState();
  initMagnetic();
  initTilt();
}

if (typeof window !== 'undefined' && !(window as unknown as { __siteChrome?: boolean }).__siteChrome) {
  (window as unknown as { __siteChrome?: boolean }).__siteChrome = true;
  document.documentElement.classList.add('js');
  initLenis();
  initCursor();
  initVelocity();
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
  document.addEventListener('astro:page-load', boot);
  // Lenis must be told to recalculate after a view transition swaps the DOM.
  document.addEventListener('astro:after-swap', () => lenis?.resize());
}

export {};
