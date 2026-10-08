export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Damped spring solved numerically. Returns progress samples (0 -> ~1, may overshoot) and duration in ms.
 * Used to build Web Animations keyframes, so the motion is real spring physics without a library.
 */
export function springSamples({ stiffness = 170, damping = 18, mass = 1 } = {}) {
  const dt = 1 / 60;
  let x = 0, v = 0, t = 0;
  const out = [0];
  for (let i = 0; i < 240; i++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; t += dt;
    out.push(x);
    if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.01) break;
  }
  out[out.length - 1] = 1;
  return { samples: out, duration: t * 1000 };
}
const SPRING = springSamples({ stiffness: 150, damping: 17, mass: 1 });
const lerp = (a, b, p) => a + (b - a) * p;

export function initReveal() {
  const items = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-in')); return; }
  // Stagger index: position among revealed children of the same [data-stagger] group.
  const idx = new Map();
  document.querySelectorAll('[data-stagger]').forEach((g) => [...g.querySelectorAll(':scope > [data-reveal]')].forEach((el, i) => idx.set(el, i)));
  const play = (el) => {
    const delay = (idx.get(el) ?? 0) * 80;
    const n = SPRING.samples.length;
    const frames = SPRING.samples.map((p, i) => ({
      offset: i / (n - 1),
      opacity: Math.min(1, Math.max(0, p * 1.15)),
      transform: `translateY(${lerp(30, 0, p).toFixed(2)}px)`,
    }));
    const anim = el.animate(frames, { duration: SPRING.duration, delay, fill: 'backwards', easing: 'linear' });
    el.classList.add('is-in');
    anim.onfinish = () => anim.cancel();
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); play(e.target); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -4% 0px' });
  items.forEach((el) => io.observe(el));
}

export function initProgress() {
  const bar = document.getElementById('progress');
  let queued = false;
  const update = () => {
    queued = false;
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, window.scrollY / h) : 0})`;
  };
  const on = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', on, { passive: true });
  window.addEventListener('resize', on);
  update();
}

export function initSpotlight() {
  if (reduced()) return;
  let target = null, x = 0, y = 0, queued = false;
  const apply = () => {
    queued = false;
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${x - r.left}px`);
    target.style.setProperty('--my', `${y - r.top}px`);
  };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-spot]');
    if (!el) return;
    target = el; x = e.clientX; y = e.clientY;
    if (!queued) { queued = true; requestAnimationFrame(apply); }
  }, { passive: true });
}

export function initParallax() {
  const root = document.getElementById('hero-visual');
  if (!root || reduced()) return;
  const layers = [...root.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth) }));
  let px = 0, py = 0, tx = 0, ty = 0, sy = 0, running = false;
  const frame = () => {
    px = lerp(px, tx, 0.08); py = lerp(py, ty, 0.08);
    for (const { el, d } of layers) el.style.translate = `${(px * d * 22).toFixed(2)}px ${(py * d * 22 + sy * d * 0.06).toFixed(2)}px`;
    if (Math.abs(px - tx) > 0.001 || Math.abs(py - ty) > 0.001) requestAnimationFrame(frame); else running = false;
  };
  const kick = () => { if (!running) { running = true; requestAnimationFrame(frame); } };
  window.addEventListener('pointermove', (e) => {
    tx = (e.clientX / window.innerWidth - 0.5) * 2; ty = (e.clientY / window.innerHeight - 0.5) * 2; kick();
  }, { passive: true });
  window.addEventListener('scroll', () => { sy = Math.min(window.scrollY, window.innerHeight); kick(); }, { passive: true });
}

export function flash(el) {
  if (reduced()) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/** Eased count between two numbers; calls render(value) each frame. Instant under reduced motion. */
export function countTo(from, to, render, ms = 700) {
  if (reduced() || !Number.isFinite(from) || from === to) { render(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    render(lerp(from, to, eased));
    if (p < 1) requestAnimationFrame(step); else render(to);
  };
  requestAnimationFrame(step);
}
