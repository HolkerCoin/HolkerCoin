// Paste into the browser console (or run through a browser tool) on a loaded page. Returns a plain report object.
(() => {
  const vw = document.documentElement.clientWidth;
  const rect = (e) => e.getBoundingClientRect();
  const name = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''));
  const out = { vw, docScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth };
  out.horizontalOverflow = document.documentElement.scrollWidth > vw;

  // Elements poking past the viewport (ignoring things that are intentionally clipped by an overflow:hidden ancestor, e.g. the marquee)
  const clippedByAncestor = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'hidden' || o === 'clip' || o === 'auto') return true; } return false; };
  out.offscreen = [...document.querySelectorAll('body *')].filter((e) => { const r = rect(e); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5) && !clippedByAncestor(e) && getComputedStyle(e).position !== 'fixed'; }).slice(0, 8).map(name);

  // Text clipped by its own box
  out.textClipped = [...document.querySelectorAll('.ca-value, .val, .h2, .display, .tile-note, .pair-name strong, .notice, .btn, .status')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && !e.matches('.pair-name strong')).map(name);

  // Tap targets
  const targets = [...document.querySelectorAll('a[href], button, [role="button"], .social, .ca-btn, .btn')].filter((e) => { const r = rect(e); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
  out.tapTargets = targets.length;
  out.tapTooSmall = targets.filter((e) => { const r = rect(e); return r.width < 43.5 || r.height < 43.5; }).map((e) => `${name(e)} ${Math.round(rect(e).width)}x${Math.round(rect(e).height)}`);

  // Social icons: both present, visible, in the top-right of the header bar
  const soc = [...document.querySelectorAll('.socials .social')].map((e) => { const r = rect(e); return { rec: e.dataset.record, x: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), inert: e.classList.contains('is-inert'), tag: e.tagName.toLowerCase(), hasHref: e.hasAttribute('href') }; });
  out.socials = soc;
  out.socialsTopRight = soc.length === 2 && soc.every((s) => s.top < 80 && s.right <= vw && s.x > vw / 2);

  // CA slot
  const ca = document.querySelector('.ca-value'), cb = document.querySelector('.ca-btn'), chrome = document.querySelector('header.chrome');
  out.ca = { text: ca.textContent, fontPx: parseFloat(getComputedStyle(ca).fontSize), lines: Math.round(rect(ca).height / parseFloat(getComputedStyle(ca).lineHeight)), inView: rect(cb).top >= 0 && rect(cb).bottom <= innerHeight, fitsWidth: rect(cb).right <= vw + 0.5 && rect(cb).left >= -0.5, stickyTop: Math.round(rect(chrome).top), chromeH: Math.round(rect(chrome).height) };

  // Hero visual and key blocks inside viewport width
  out.heroVisual = (() => { const r = rect(document.getElementById('hero-visual')); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; })();
  out.tiles = [...document.querySelectorAll('.tile')].map((e) => { const r = rect(e); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
  out.pairRows = document.querySelectorAll('#pairs .pair').length;
  out.tileStates = [...document.querySelectorAll('.tile')].map((e) => e.dataset.state);
  return out;
})()
