// Scroll-reveal — springy, and it covers *everything*. On each page it walks
// the DOM and tags every content element (headings, paragraphs, list items,
// cards, buttons, media) with `.reveal` + a staggered delay, then reveals each
// as it enters the viewport. Degrades to "show everything" when
// IntersectionObserver is missing or the user asked for reduced motion.

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let io: IntersectionObserver | null = null;
let scanQueued = false;

/* elements worth animating on their own */
const CONTENT_SEL =
  'h1,h2,h3,h4,p,li,dt,dd,blockquote,pre,figure,img,' +
  'a.btn,button.btn,.glass,.glass-flat,.glass-hair,.glass-interactive,.glass-pill,' +
  '[data-reveal-me]';

/* never auto-tag these (handled elsewhere by GSAP, or decorative) */
const SKIP =
  '.reveal,.stagger,[data-fragment],[data-order-line],[data-overlap],[data-look-closer],' +
  '[data-stage],[data-panel-a],[data-panel-b],[data-cta-shell],[data-no-reveal],' +
  'canvas,svg';
const SKIP_ANCESTOR =
  '.stagger, [data-no-reveal], [data-stage], [data-panel-a], [data-panel-b], nav#site-nav, #sa-mobile-nav, footer';

function isSkippable(el: Element): boolean {
  if (el.matches(SKIP)) return true;
  if (el.closest(SKIP_ANCESTOR)) return true;
  // if an ancestor is already a reveal target, let the ancestor carry it
  return !!el.parentElement?.closest('.reveal');
}

function autoReveal() {
  const main = document.querySelector('main');
  if (!main) return;

  const raw = Array.from(main.querySelectorAll<HTMLElement>(CONTENT_SEL)).filter((el) => !isSkippable(el));

  // drop candidates that contain another candidate — reveal the outer block only
  const set = new Set(raw);
  const chosen = raw.filter((el) => {
    let p = el.parentElement;
    while (p && p !== main) {
      if (set.has(p as HTMLElement)) return false;
      p = p.parentElement;
    }
    return true;
  });

  // stagger delay, reset per section so each section feels like its own beat
  let section: Element | null = null;
  let i = 0;
  for (const el of chosen) {
    const sec = el.closest('section, main > div') || main;
    if (sec !== section) {
      section = sec;
      i = 0;
    }
    el.classList.add('reveal');
    if (!el.dataset.revealVariant) {
      // give cards a bigger pop, everything else a clean rise
      if (el.matches('.glass,.glass-interactive,.glass-hair,figure,img,pre')) el.classList.add('reveal-pop');
    }
    el.style.setProperty('--rd', `${Math.min(i, 7) * 55}ms`);
    i += 1;
  }
}

function revealAll() {
  document.querySelectorAll('.reveal, .stagger').forEach((el) => el.classList.add('is-visible'));
}

/** Safety net that respects the scroll story: only force-show what's already
 *  near the viewport, so elements further down still animate in on scroll. */
function revealNearViewport() {
  const limit = window.innerHeight * 1.4;
  document.querySelectorAll<HTMLElement>('.reveal:not(.is-visible), .stagger:not(.is-visible)').forEach((el) => {
    if (el.getBoundingClientRect().top < limit) el.classList.add('is-visible');
  });
}

function scan() {
  scanQueued = false;
  if (typeof document === 'undefined') return;
  const nodes = document.querySelectorAll<HTMLElement>('.reveal:not(.is-visible), .stagger:not(.is-visible)');
  if (!nodes.length) return;

  if (REDUCED || typeof IntersectionObserver === 'undefined') {
    revealAll();
    return;
  }
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io!.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.12 },
    );
  }
  nodes.forEach((n) => io!.observe(n));
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    autoReveal();
    scan();
  });
}

/* Belt-and-suspenders: a throttled scroll handler also reveals whatever has
 * entered the viewport, so the effect works even where IntersectionObserver
 * or rAF is throttled (background tabs, some embedded webviews). Uses a
 * timer, not rAF, so it still ticks when the tab is hidden. */
let scrollTimer: ReturnType<typeof setTimeout> | null = null;
function onScroll() {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    if (document.querySelector('.reveal:not(.is-visible), .stagger:not(.is-visible)')) revealNearViewport();
  }, 90);
}

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('js');

  if (document.readyState !== 'loading') queueScan();
  else document.addEventListener('DOMContentLoaded', queueScan, { once: true });

  document.addEventListener('astro:page-load', queueScan);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      queueScan();
      revealNearViewport();
    }
  });

  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n.nodeType === 1) { queueScan(); return; }
      }
    });
    const startMo = () => document.body && mo.observe(document.body, { childList: true, subtree: true });
    if (document.body) startMo();
    else document.addEventListener('DOMContentLoaded', startMo, { once: true });
  }

  // Safety net: if IntersectionObserver is unavailable, show everything. Otherwise
  // only un-hide what's already near the viewport (twice), and keep a last-resort
  // full reveal much later in case the observer never fires at all.
  if (typeof IntersectionObserver === 'undefined') {
    window.setTimeout(revealAll, 400);
  } else {
    window.setTimeout(revealNearViewport, 1200);
    window.setTimeout(revealNearViewport, 3000);
    window.setTimeout(() => {
      // if somehow nothing has revealed, the observer is broken — show all
      if (document.querySelector('.reveal.is-visible, .stagger.is-visible')) return;
      revealAll();
    }, 6000);
  }
}
