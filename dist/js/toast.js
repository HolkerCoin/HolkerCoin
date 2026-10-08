import { reduced, springSamples } from './motion.js';

const spring = springSamples({ stiffness: 260, damping: 20 });
let hideTimer = null, current = null;

export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-on');
  if (!reduced()) {
    if (current) current.cancel();
    const n = spring.samples.length;
    current = el.animate(spring.samples.map((p, i) => ({
      offset: i / (n - 1), opacity: Math.min(1, p * 1.2), transform: `translate(-50%, ${(24 * (1 - p)).toFixed(2)}px)`,
    })), { duration: spring.duration, easing: 'linear' });
  }
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to legacy path */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Shared copy action: copies, raises the toast, flips the trigger's label for a moment. */
export async function copyWithFeedback(btn, text, label, labelEl) {
  const ok = await copyText(text);
  toast(ok ? `${label} copied` : 'Copy failed. Select the text and copy it by hand.');
  if (ok && btn) {
    btn.classList.add('is-copied');
    const prev = labelEl ? labelEl.textContent : null;
    if (labelEl) labelEl.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('is-copied'); if (labelEl) labelEl.textContent = prev; }, 1600);
  }
  return ok;
}
