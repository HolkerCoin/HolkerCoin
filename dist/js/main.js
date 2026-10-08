import { initReveal, initProgress, initSpotlight, initParallax } from './motion.js';
import { copyWithFeedback } from './toast.js';
import { startLive } from './live.js';

function readRegister() {
  try { return JSON.parse(document.getElementById('register').textContent); } catch { return { records: [] }; }
}

function initCa() {
  const rec = readRegister().records.find((r) => r.id === 'ca');
  const btn = document.querySelector('button[data-copy-ca]');
  // Inert until the CA is stated: no button exists in the absent state, and a stated record must carry a value.
  if (!btn || !rec || rec.state !== 'stated' || !rec.value) return;
  const label = btn.querySelector('.ca-action-text');
  btn.addEventListener('click', () => copyWithFeedback(btn, rec.value, 'Token address', label));
}

initCa();
initReveal();
initProgress();
initSpotlight();
initParallax();
startLive();
