// GSAP + ScrollTrigger choreography for the marketing pages. Synced to Lenis,
// scoped with gsap.context for clean teardown, and fully disabled under
// prefers-reduced-motion.
//
// Every effect uses `gsap.from(..., { immediateRender: false })`: the natural,
// un-animated state is the readable one, so if a trigger never fires (slow
// paint, refresh race, JS hiccup) the content is simply *visible* — never stuck.

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

let ctx: gsap.Context | null = null;
let scrollHooked = false;

function build() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = window.matchMedia('(min-width: 900px)').matches;
  if (reduced) return;

  gsap.registerPlugin(ScrollTrigger);

  const lenis = (window as unknown as { __lenis?: { on: (e: string, cb: () => void) => void } }).__lenis;
  if (lenis && !scrollHooked) {
    lenis.on('scroll', ScrollTrigger.update);
    scrollHooked = true;
  }

  ctx?.revert();
  ctx = gsap.context(() => {
    const from = (
      target: gsap.TweenTarget,
      vars: gsap.TweenVars,
      st: ScrollTrigger.Vars,
    ) => gsap.from(target, { immediateRender: false, ...vars, scrollTrigger: st });

    /* --- generic depth parallax (safe: only shifts position) ---- */
    gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
      const depth = parseFloat(el.dataset.parallax || '0.2');
      gsap.fromTo(
        el,
        { yPercent: -depth * 10 },
        { yPercent: depth * 10, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } },
      );
    });

    /* --- section headers: mask-wipe + spring rise ------------- */
    gsap.utils.toArray<HTMLElement>('[data-wipe]').forEach((el) => {
      from(
        el,
        { clipPath: 'inset(0 100% 0 0)', opacity: 0, y: 40, scale: 0.94, ease: 'back.out(1.9)', duration: 1.05 },
        { trigger: el, start: 'top 86%', once: true },
      );
    });

    /* --- hero copy lifts + fades as the artifact takes over ---- */
    const hero = document.querySelector('#hero');
    if (hero) {
      gsap.to('#hero [data-hero-copy]', {
        yPercent: -14,
        opacity: 0.4,
        ease: 'none',
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    /* --- "chaos → order": fragments scatter, then settle ------- */
    const chaos = document.querySelector<HTMLElement>('#chaos');
    if (chaos) {
      const frags = gsap.utils.toArray<HTMLElement>('#chaos [data-fragment]');
      frags.forEach((f, i) => {
        const ang = (i / Math.max(1, frags.length)) * Math.PI * 2;
        from(
          f,
          {
            x: Math.cos(ang) * (desktop ? 240 : 110),
            y: Math.sin(ang) * (desktop ? 180 : 100),
            rotate: (i % 2 ? 1 : -1) * 20,
            opacity: 0.2,
            filter: 'blur(4px)',
            ease: 'power2.out',
          },
          { trigger: chaos, start: 'top 78%', end: 'top 22%', scrub: 0.8 },
        );
      });
      const line = chaos.querySelector('[data-order-line]');
      if (line) from(line, { scaleX: 0, opacity: 0 }, { trigger: chaos, start: 'top 42%', end: 'top 12%', scrub: true });
    }

    /* --- pipeline: stages activate as the camera "travels" ------ */
    const pipe = document.querySelector<HTMLElement>('#pipeline');
    const stages = gsap.utils.toArray<HTMLElement>('#pipeline [data-stage]');
    if (pipe && stages.length && desktop) {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: pipe,
          start: 'top top',
          end: `+=${stages.length * 55}%`,
          scrub: 0.6,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });
      stages.forEach((st, i) => {
        tl.from(
          st,
          { opacity: 0.18, scale: 0.9, y: 24, filter: 'blur(4px)', ease: 'back.out(2)', immediateRender: false, duration: 0.55 },
          i * 0.6,
        );
        if (i > 0) tl.to(stages[i - 1], { opacity: 0.28, scale: 0.97, filter: 'blur(2px)', duration: 0.5 }, i * 0.6);
        const flow = st.querySelector('[data-flow]');
        if (flow) tl.from(flow, { scaleX: 0, ease: 'power2.out', immediateRender: false, duration: 0.4 }, i * 0.6 + 0.2);
      });
    }

    /* --- originality: two panels glide together, overlap glows -- */
    const orig = document.querySelector<HTMLElement>('#originality');
    if (orig) {
      const tl = gsap.timeline({ scrollTrigger: { trigger: orig, start: 'top 74%', end: 'top 22%', scrub: 1 } });
      tl.from('#originality [data-panel-a]', { xPercent: -22, y: 30, rotate: -5, opacity: 0.5, immediateRender: false }, 0)
        .from('#originality [data-panel-b]', { xPercent: 22, y: 30, rotate: 5, opacity: 0.5, immediateRender: false }, 0)
        .from('#originality [data-overlap]', { opacity: 0, scaleY: 0.4, immediateRender: false }, 0.3)
        .from('#originality [data-look-closer]', { opacity: 0, y: 22, scale: 0.9, ease: 'back.out(2.4)', immediateRender: false }, 0.55);
    }

    /* --- final CTA shell resolves to clear -------------------- */
    const cta = document.querySelector<HTMLElement>('#final-cta');
    if (cta) {
      gsap.from('#final-cta [data-cta-shell]', {
        opacity: 0.2,
        immediateRender: false,
        ease: 'none',
        scrollTrigger: { trigger: cta, start: 'top 82%', end: 'top 32%', scrub: true },
      });
    }
  });

  // Refresh once layout has truly settled (fonts, islands, images).
  ScrollTrigger.refresh();
  if (document.fonts?.ready) document.fonts.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
  setTimeout(() => ScrollTrigger.refresh(), 800);
}

function teardown() {
  ctx?.revert();
  ctx = null;
}

if (typeof window !== 'undefined') {
  const start = () => {
    teardown();
    requestAnimationFrame(() => requestAnimationFrame(build));
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  document.addEventListener('astro:page-load', start);
  document.addEventListener('astro:before-swap', teardown);
}

export {};
