import { CHAIN, DEX_SEARCH, DEX_BOOSTS, DEX_TOKENS, TRENDING_COUNT, POLL, FALLBACK_BLOCKS_PER_SEC } from './config.js';
import { Poller } from './poller.js';
import { flash, countTo, reduced } from './motion.js';
import { copyWithFeedback } from './toast.js';

const DASH = '—';
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

/* ---------- tiles ---------- */
const tiles = {};
function tile(id) {
  if (!tiles[id]) {
    const root = $(id);
    tiles[id] = { root, val: root.querySelector('[data-val]'), note: root.querySelector('[data-note]'), last: null, hadValue: false };
  }
  return tiles[id];
}
function setReady(id, text, note) {
  const t = tile(id);
  const changed = t.val.textContent !== text;
  t.val.textContent = text;
  if (note !== undefined) t.note.textContent = note;
  t.root.dataset.state = 'ready';
  if (changed && t.hadValue) flash(t.val);
  t.hadValue = true;
}
function setNumber(id, to, fmt, note) {
  const t = tile(id);
  const from = t.last;
  t.last = to;
  t.root.dataset.state = 'ready';
  if (note !== undefined) t.note.textContent = note;
  countTo(from, to, (v) => { t.val.textContent = fmt(v); }, 700);
  if (from !== null && from !== to) flash(t.val);
  t.hadValue = true;
}
function setError(id, message) {
  const t = tile(id);
  t.last = null; t.hadValue = false;
  t.val.textContent = DASH;
  t.note.textContent = message;
  t.root.dataset.state = 'error';
}

/* ---------- status pill ---------- */
function pill(state, text) {
  $('status-pill').dataset.state = state;
  $('status-text').textContent = text;
}

/* ---------- block height ---------- */
const ticker = { height: null, at: 0, rate: FALLBACK_BLOCKS_PER_SEC, raf: 0, shown: null, samples: [] };

async function fetchBlockHeight(signal) {
  const res = await fetch(CHAIN.rpc, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [{ commitment: CHAIN.commitment }] }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  if (!Number.isSafeInteger(json.result) || json.result < 0) throw new Error('RPC returned a malformed height');
  return json.result;
}

function tickBlock() {
  if (ticker.height === null) return;
  const est = ticker.height + Math.floor(ticker.rate * ((performance.now() - ticker.at) / 1000));
  if (est !== ticker.shown) { ticker.shown = est; tile('tile-height').val.textContent = nf.format(est); }
  ticker.raf = requestAnimationFrame(tickBlock);
}

function onBlock(h) {
  const now = performance.now();
  // Rate = real blocks gained over a sliding window (up to 30s), so one jittery poll cannot skew the interpolation.
  ticker.samples.push({ h, t: now });
  ticker.samples = ticker.samples.filter((s) => now - s.t <= 30000);
  const first = ticker.samples[0];
  const span = (now - first.t) / 1000;
  if (span >= 6 && h >= first.h) {
    const measured = (h - first.h) / span;
    if (measured > 0 && measured < 10) ticker.rate = measured;
  }
  ticker.height = h; ticker.at = now;
  const t = tile('tile-height');
  const firstShow = t.root.dataset.state !== 'ready';
  ticker.shown = h;
  t.val.textContent = nf.format(h);          // snap to the real value on every poll
  t.root.dataset.state = 'ready';
  t.note.textContent = `Confirmed commitment · ${span >= 6 ? ticker.rate.toFixed(1) + ' blocks/s measured' : 'measuring rate'}`;
  if (!firstShow) flash(t.val);
  if (!reduced()) { cancelAnimationFrame(ticker.raf); ticker.raf = requestAnimationFrame(tickBlock); }
  pill('live', `${CHAIN.name} mainnet · confirmed`);
}

function onBlockFail(err, waitMs) {
  cancelAnimationFrame(ticker.raf);
  ticker.height = null; ticker.shown = null; ticker.samples = [];
  const secs = Math.round(waitMs / 1000);
  setError('tile-height', `${CHAIN.name} RPC unreachable. Retrying in ${secs}s`);
  pill('retry', `${CHAIN.name} RPC unreachable · retry in ${secs}s`);
}

/* ---------- DexScreener: two-tier ---------- */
async function search(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.pairs)) throw new Error('DexScreener returned an unexpected shape');
  return json.pairs.filter((p) => p && p.chainId === 'solana' && p.baseToken && typeof p.baseToken.address === 'string');
}
/** Two steps: top boosted Solana token addresses, then one pair per token (first pair returned). */
async function fetchTrending(signal) {
  const res = await fetch(DEX_BOOSTS, { signal });
  if (!res.ok) throw new Error(`DexScreener boosts HTTP ${res.status}`);
  const boosts = await res.json();
  if (!Array.isArray(boosts)) throw new Error('DexScreener boosts returned an unexpected shape');
  const addrs = [...new Set(boosts.filter((b) => b && b.chainId === 'solana' && typeof b.tokenAddress === 'string').map((b) => b.tokenAddress))].slice(0, TRENDING_COUNT);
  if (!addrs.length) return [];
  const res2 = await fetch(DEX_TOKENS + addrs.join(','), { signal });
  if (!res2.ok) throw new Error(`DexScreener tokens HTTP ${res2.status}`);
  const pairs = await res2.json();
  if (!Array.isArray(pairs)) throw new Error('DexScreener tokens returned an unexpected shape');
  const first = new Map();
  for (const p of pairs) {
    if (p && p.chainId === 'solana' && p.baseToken && typeof p.baseToken.address === 'string' && !first.has(p.baseToken.address)) first.set(p.baseToken.address, p);
  }
  return addrs.map((a) => first.get(a)).filter(Boolean);   // keep boost ranking order
}
const vol = (p) => Number(p.volume && p.volume.h24) || 0;
const byVolume = (a, b) => vol(b) - vol(a);

/** Tier 1: our own search. Tier 2 (only when tier 1 is empty): Solana trending, so the board is never blank. */
async function fetchBoard(signal) {
  const own = (await search(DEX_SEARCH, signal)).sort(byVolume);
  if (own.length) return { own, trending: [], trendingFailed: false };
  try {
    const trending = await fetchTrending(signal);
    return { own, trending, trendingFailed: false };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { own, trending: [], trendingFailed: true };
  }
}

function fmtPrice(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return DASH;
  if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 0.01) return '$' + n.toFixed(4);
  const digits = Math.min(12, 2 - Math.floor(Math.log10(n)) + 2);
  return '$' + n.toFixed(digits).replace(/0+$/, '');
}
const fmtUsd = (n) => (Number.isFinite(n) && n > 0 ? '$' + compact.format(n) : DASH);

function safeImg(url) {
  if (typeof url !== 'string') return null;
  try { const u = new URL(url); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
}
const logoUrl = (pair) => safeImg(pair.info && pair.info.imageUrl) || safeImg(pair.baseToken.logoURI);

/** Symbol hash picks one of four palette-derived tones (defined in CSS from tokens). */
function toneOf(symbol) {
  let h = 0;
  for (const ch of String(symbol)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 4;
}
/** Logo: the real image when there is one, otherwise a tone circle with two initials. Size comes from the class. */
function tokenLogo(pair, sizeClass) {
  const symbol = pair.baseToken.symbol || pair.baseToken.name || '?';
  const wrap = document.createElement('span');
  wrap.className = `tlogo ${sizeClass} tone-${toneOf(symbol)}`;
  wrap.textContent = Array.from(symbol.replace(/[^\p{L}\p{N}]/gu, '') || '?').slice(0, 2).join('').toUpperCase();
  const src = logoUrl(pair);
  if (src) {
    const img = document.createElement('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove());   // initials stay underneath
    img.src = src;
    wrap.appendChild(img);
  }
  return wrap;
}
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
function stat(label, valueNode) {
  const d = document.createElement('div');
  d.append(el('small', label), valueNode);
  return d;
}

function pairRow(pair) {
  const li = document.createElement('li');
  li.className = 'pair'; li.setAttribute('data-spot', '');
  const sym = pair.baseToken.symbol || 'token';
  const name = el('div', undefined, 'pair-name');
  name.append(el('strong', sym), el('span', `${pair.baseToken.name || sym} · ${pair.dexId || 'dex'}`));

  const ch = Number(pair.priceChange && pair.priceChange.h24);
  const hasCh = Number.isFinite(ch);
  const chNode = el('span', hasCh ? `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}%` : DASH, 'mono' + (hasCh ? (ch >= 0 ? ' up' : ' down') : ''));
  const stats = el('div', undefined, 'pair-stats');
  stats.append(stat('Price', el('span', fmtPrice(pair.priceUsd), 'mono')), stat('24h', chNode), stat('Volume 24h', el('span', fmtUsd(vol(pair)), 'mono')));

  const btn = el('button', undefined, 'icon-btn pair-copy');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Copy token address for ${sym}`);
  btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="lbl">Copy</span>';
  const lbl = btn.querySelector('.lbl');
  btn.addEventListener('click', () => copyWithFeedback(btn, pair.baseToken.address, `${sym} address`, lbl));

  li.append(tokenLogo(pair, 'tlogo-row'), name, stats, btn);
  return li;
}

/** Chip: [logo 24] [symbol] · [price]. Content-addressed so it never repeats a token inside one set. */
function renderMarquee(pairs) {
  const m = $('marquee'); const track = m.querySelector('[data-track]');
  track.textContent = '';
  const seen = new Set(); const toks = [];
  for (const p of pairs) { if (!seen.has(p.baseToken.address)) { seen.add(p.baseToken.address); toks.push(p); } }
  if (!toks.length) { m.querySelector('[data-empty]').textContent = 'No pairs to scroll right now.'; m.dataset.state = 'empty'; return; }
  const still = reduced();
  let set = toks.slice();
  while (!still && set.length < 8) set = set.concat(toks);
  const make = (hidden) => set.forEach((p) => {
    const chip = el('span', undefined, 'logo-chip');
    if (hidden) chip.setAttribute('aria-hidden', 'true');
    chip.append(tokenLogo(p, 'tlogo-chip'), el('span', p.baseToken.symbol || '?', 'chip-sym'), el('span', '·', 'chip-dot'), el('span', fmtPrice(p.priceUsd), 'mono chip-price'));
    track.appendChild(chip);
  });
  make(false);
  if (!still) make(true);
  m.style.setProperty('--marquee-s', `${Math.max(28, set.length * 4)}s`);
  m.dataset.state = 'ready';
}

function setBoardHeading(trending) {
  const h = $('pairs-title'); const note = $('pairs-extra');
  h.textContent = trending ? 'Trending on Solana' : 'Trading pairs';
  note.hidden = !trending;
}

function onBoard({ own, trending, trendingFailed }) {
  const section = $('pairs'); const list = section.querySelector('[data-list]'); const msg = section.querySelector('[data-message]');
  list.querySelectorAll('.pair-skel, .pair').forEach((n) => n.remove());
  section.dataset.state = 'ready';
  const usingFallback = own.length === 0;
  setBoardHeading(usingFallback && trending.length > 0);

  // Tiles always describe the holker search itself, never the fallback.
  setNumber('tile-pairs', own.length, (v) => nf.format(Math.round(v)), 'Search: “holker”');
  if (own.length) {
    const top = own[0];
    setReady('tile-price', fmtPrice(top.priceUsd), `${top.baseToken.symbol || 'Top pair'} · highest 24h volume`);
    setReady('tile-volume', fmtUsd(own.reduce((s, p) => s + vol(p), 0)), `Across ${own.length} listed ${own.length === 1 ? 'pair' : 'pairs'}`);
    msg.hidden = true;
    own.slice(0, 12).forEach((p) => list.appendChild(pairRow(p)));
    renderMarquee(own);
    return;
  }
  setReady('tile-price', DASH, 'No Holker pair to price yet');
  setReady('tile-volume', DASH, 'Nothing to total yet');
  if (trending.length) {
    msg.hidden = true;
    trending.forEach((p) => list.appendChild(pairRow(p)));
    renderMarquee(trending);
  } else {
    msg.textContent = trendingFailed
      ? 'No Holker pair exists yet, and the Solana trending feed is not answering. This board retries on its own.'
      : 'No Holker pair exists yet. This board fills in on its own once one does.';
    msg.hidden = false;
    renderMarquee([]);
  }
}

function onBoardFail(err, waitMs) {
  const secs = Math.round(waitMs / 1000);
  const section = $('pairs'); const list = section.querySelector('[data-list]'); const msg = section.querySelector('[data-message]');
  list.querySelectorAll('.pair-skel, .pair').forEach((n) => n.remove());
  section.dataset.state = 'error';
  setBoardHeading(false);
  msg.textContent = `DexScreener is not answering (${err.name === 'AbortError' ? 'timed out' : err.message}). Retrying in ${secs}s.`;
  msg.hidden = false;
  for (const id of ['tile-pairs', 'tile-price', 'tile-volume']) setError(id, `DexScreener unreachable. Retrying in ${secs}s`);
  const m = $('marquee');
  m.querySelector('[data-track]').textContent = '';
  m.querySelector('[data-empty]').textContent = 'Pair feed unavailable. Retrying.';
  m.dataset.state = 'error';
}

export function startLive() {
  new Poller({ run: fetchBlockHeight, intervalMs: POLL.blockMs, onData: onBlock, onFail: onBlockFail }).start();
  new Poller({ run: fetchBoard, intervalMs: POLL.dexMs, onData: onBoard, onFail: onBoardFail }).start();
}
