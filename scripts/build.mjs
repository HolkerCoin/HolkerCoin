import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import octicons from '@primer/octicons';
import { siX } from 'simple-icons';
import { loadRegister, validateRegister, byId, isStated, deriveHandle, deriveBuyUrl } from './lib/register.mjs';
import { traceMask, alphaBBox } from './lib/trace.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGO_ALPHA = path.join(ROOT, 'brand', 'LOGO HOLKERCOIN PNG...png'); // RGBA, pure-black transparent regions

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function readTokens() {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'tokens.css'), 'utf8');
  const get = (n) => css.match(new RegExp(`--hk-${n}:\\s*(#[0-9a-fA-F]{6})`))[1].toLowerCase();
  return { bg: get('bg'), accent: get('accent'), mid: get('mid'), deep: get('deep') };
}

/** Favicon: trace the real alpha grid of the logo, no hand-drawn approximation. No XML comments emitted. */
async function buildFavicon(tokens) {
  const bbox = await alphaBBox(LOGO_ALPHA);
  const W = 416;
  const H = Math.round((W * bbox.height) / bbox.width);
  const alpha = await sharp(LOGO_ALPHA).extract(bbox).extractChannel(3).resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer();
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= 128 ? 1 : 0;
  const loops = traceMask(mask, W, H, 0.62);
  const s = 24 / W;
  const ox = (32 - W * s) / 2, oy = (32 - H * s) / 2;
  const f = (n) => +n.toFixed(2);
  const d = loops.map((l) => 'M' + l.map(([x, y]) => `${f(ox + x * s)} ${f(oy + y * s)}`).join('L') + 'Z').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="7" fill="${tokens.bg}"/><path fill="${tokens.accent}" fill-rule="evenodd" d="${d}"/></svg>\n`;
}

async function buildImages(out, tokens) {
  const dir = path.join(out, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const bbox = await alphaBBox(LOGO_ALPHA);
  const { data: src, info } = await sharp(LOGO_ALPHA).ensureAlpha().extract(bbox).raw().toBuffer({ resolveWithObject: true });
  // Premultiplied resize, done explicitly. The transparent areas are pure black (0,0,0), so resizing straight-alpha
  // RGB would bleed black into every edge. Each channel is premultiplied, resized alone, then unpremultiplied.
  const N = info.width * info.height;
  const chan = (c, premult) => { const b = Buffer.alloc(N); for (let i = 0; i < N; i++) { const a = src[i * 4 + 3]; b[i] = c === 3 ? a : premult ? Math.round((src[i * 4 + c] * a) / 255) : src[i * 4 + c]; } return b; };
  const planes = [0, 1, 2, 3].map((c) => chan(c, true));
  const markBuf = async (w) => {
    const h = Math.round((w * info.height) / info.width);
    const rs = await Promise.all(planes.map((p) => sharp(p, { raw: { width: info.width, height: info.height, channels: 1 } }).resize(w, h, { kernel: 'lanczos3' }).toColourspace('b-w').raw().toBuffer()));
    const out = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = rs[3][i];
      for (let c = 0; c < 3; c++) out[i * 4 + c] = a ? Math.min(255, Math.round((rs[c][i] * 255) / a)) : 0;
      out[i * 4 + 3] = a;
    }
    return { out, w, h };
  };
  const markSharp = async (w) => { const { out, w: ww, h } = await markBuf(w); return sharp(out, { raw: { width: ww, height: h, channels: 4 } }); };
  for (const w of [114, 560, 1120]) {
    await (await markSharp(w)).png({ compressionLevel: 9 }).toFile(path.join(dir, `mark-${w}.png`));
    await (await markSharp(w)).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(dir, `mark-${w}.webp`));
  }
  const bgRaw = (w, h) => ({ create: { width: w, height: h, channels: 4, background: tokens.bg } });
  const place = async (w, h, markW, file) => {
    const m = await (await markSharp(markW)).png().toBuffer();
    const meta = await sharp(m).metadata();
    await sharp(bgRaw(w, h)).composite([{ input: m, left: Math.round((w - meta.width) / 2), top: Math.round((h - meta.height) / 2) }]).png({ compressionLevel: 9 }).toFile(path.join(dir, file));
  };
  await place(180, 180, 128, 'apple-touch-icon.png');
  await place(1200, 630, 560, 'og.png');
}

const iconSvg = (path_d, cls) => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path_d}"/></svg>`;
const ICONS = {
  x: iconSvg(siX.path, 'icon-x'),
  github: octicons['mark-github'].toSVG({ height: 24, class: 'icon icon-github', 'aria-hidden': 'true', focusable: 'false' }).replace(/ width="[^"]*"| height="[^"]*"/g, ''),
};
const COPY_ICON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

function social(rec, id, name) {
  if (isStated(rec)) {
    const h = deriveHandle(rec);
    return `<a class="social" data-record="${id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${name} (${esc(h)})" title="${name} (${esc(h)})" data-spot>${ICONS[id]}</a>`;
  }
  return `<span class="social is-inert" data-record="${id}" data-state="${esc(rec.state)}" role="img" aria-label="${name}: link not published yet" title="${name}: not published yet">${ICONS[id]}</span>`;
}

function caSlot(rec) {
  if (isStated(rec)) {
    return `<div class="ca" data-record="ca" data-state="stated"><div class="wrap ca-inner"><span class="ca-label" id="ca-label">Token address</span>` +
      `<button type="button" class="ca-btn" data-copy-ca data-spot aria-labelledby="ca-label" aria-describedby="ca-hint"><code class="ca-value">${esc(rec.value)}</code>` +
      `<span class="ca-action">${COPY_ICON}<span class="ca-action-text">Copy</span></span></button><span id="ca-hint" hidden>Click to copy the full address</span></div></div>`;
  }
  return `<div class="ca" data-record="ca" data-state="${esc(rec.state)}"><div class="wrap ca-inner"><span class="ca-label" id="ca-label">Token address</span>` +
    `<div class="ca-btn is-inert" role="group" aria-labelledby="ca-label" aria-disabled="true"><code class="ca-value">Not announced yet. Copy opens once it is.</code>` +
    `<span class="ca-action">${COPY_ICON}<span class="ca-action-text">Copy</span></span></div></div></div>`;
}

function buy(url) {
  if (url) return `<a class="btn btn-primary" data-derived="buy" data-state="stated" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-spot><span>Get Holker</span></a>`;
  return `<span class="btn btn-primary is-inert" data-derived="buy" data-state="absent" aria-disabled="true"><span>Get Holker</span><small>Opens with the token address</small></span>`;
}

function githubCta(rec) {
  if (isStated(rec)) return `<a class="text-link" data-record="github" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="Read the code on GitHub (${esc(deriveHandle(rec))})">${ICONS.github}<span>Read the code on GitHub</span></a>`;
  return `<span class="text-link is-inert" data-record="github" data-state="${esc(rec.state)}" aria-disabled="true">${ICONS.github}<span>Repository not published yet</span></span>`;
}

const NOTICE_ABSENT = 'No token address has been announced, so no pair on this list is ours. Treat every result as unverified and every look-alike as suspect.';
const NOTICE_STATED = 'These are name-search results, so look-alikes appear. Match each token address against the pinned token address at the top of the page before you trade.';

export async function build({ registerFile = path.join(ROOT, 'src', 'register.json'), out = path.join(ROOT, 'dist'), quiet = false } = {}) {
  const reg = loadRegister(registerFile);
  const errs = validateRegister(reg);
  if (errs.length) throw new Error('Register invalid:\n  ' + errs.join('\n  '));
  const tokens = readTokens();

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const f of ['tokens.css', 'styles.css']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(out, f));
  fs.cpSync(path.join(ROOT, 'src', 'js'), path.join(out, 'js'), { recursive: true });
  fs.writeFileSync(path.join(out, 'favicon.svg'), await buildFavicon(tokens));
  await buildImages(out, tokens);

  const ca = byId(reg, 'ca');
  const map = {
    BG: tokens.bg,
    SOCIAL_X: social(byId(reg, 'x'), 'x', 'X'),
    SOCIAL_GITHUB: social(byId(reg, 'github'), 'github', 'GitHub'),
    CA_SLOT: caSlot(ca),
    BUY_BUTTON: buy(deriveBuyUrl(reg)),
    GITHUB_CTA: githubCta(byId(reg, 'github')),
    PAIRS_NOTICE: isStated(ca) ? NOTICE_STATED : NOTICE_ABSENT,
    REGISTER_JSON: JSON.stringify(reg).replace(/</g, '\\u003c'),
  };
  let html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => { if (!(k in map)) throw new Error(`Unknown placeholder ${m}`); return map[k]; });
  fs.writeFileSync(path.join(out, 'index.html'), html);

  fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  fs.writeFileSync(path.join(out, '_headers'), [
    '/*',
    "  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src https://solana-rpc.publicnode.com https://api.dexscreener.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'));

  if (!quiet) console.log(`built -> ${path.relative(ROOT, out) || out} (ca=${ca.state}, x=${byId(reg, 'x').state}, github=${byId(reg, 'github').state})`);
  return { out, reg };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? path.resolve(a[i + 1]) : undefined; };
  build({ registerFile: opt('--register'), out: opt('--out') }).catch((e) => { console.error(e.message); process.exit(1); });
}
