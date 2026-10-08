import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import octicons from '@primer/octicons';
import { siX } from 'simple-icons';
import { parse } from 'node-html-parser';
import { build, ROOT } from './build.mjs';
import { loadRegister, validateRegister, byId, isStated, deriveHandle, deriveBuyUrl, STATES } from './lib/register.mjs';

const TMP = path.join(ROOT, '.gate-tmp');
const FIX = path.join(ROOT, 'scripts', 'fixtures');
const read = (f) => fs.readFileSync(f, 'utf8');
const walk = (dir, skip = () => false) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  if (skip(p, d)) return [];
  return d.isDirectory() ? walk(p, skip) : [p];
});
const isText = (f) => /\.(html|css|js|mjs|json|svg|txt|md)$/.test(f) || /_headers$/.test(f);

/* ================= shared detectors (also what the mutation harness aims at) ================= */
const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const FUNC_COLOUR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const colourLiterals = (text) => [...(text.match(HEX_LITERAL) || []), ...(text.match(FUNC_COLOUR) || [])];

const ADDR_EVM = /\b0x[0-9a-fA-F]{40}\b/g;
const ADDR_B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
/** Address-shaped = 0x+40 hex, or a 32-44 char base58 run that mixes digits, upper and lower case (identifiers are not). */
const addressShaped = (text) => [
  ...(text.match(ADDR_EVM) || []),
  ...(text.match(ADDR_B58) || []).filter((s) => /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s)),
];

// Exact, user-mandated wording only: the pairs board label "Trending on Solana" was specified verbatim.
const ALLOWED_BIGRAMS = new Set(['on solana']);
const stopwords = new Set('a an and are as at be but by for from has have in is it its of on or our that the their them they this to was we were what when where which who will with you your not no nor so than then there these those if into over out up down can do does did just more most other some such very been being while about also how'.split(' '));
const words = (t) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const bigrams = (t) => { const w = words(t), out = new Set(); for (let i = 0; i < w.length - 1; i++) out.add(w[i] + ' ' + w[i + 1]); return out; };

function visibleCopy(distDir, srcDir) {
  const root = parse(read(path.join(distDir, 'index.html')));
  root.querySelectorAll('script,style,template').forEach((n) => n.remove());
  const parts = [root.textContent.replace(/<!doctype[^>]*>/gi, '')];
  root.querySelectorAll('[alt],[title],[aria-label],[content]').forEach((n) => parts.push(n.getAttribute('alt') || '', n.getAttribute('title') || '', n.getAttribute('aria-label') || '', n.getAttribute('content') || ''));
  for (const f of walk(path.join(srcDir, 'js'))) for (const m of read(f).match(/(['"`])(?:(?!\1)[^\\\n]|\\.){12,}\1/g) || []) { const t = m.slice(1, -1); if (/\s/.test(t) && !/https?:|[{}();=]/.test(t)) parts.push(t); }
  return parts.join('\n');
}

/* ================= gate catalogue ================= */
// Each gate: (ctx) => string[] of problems. ctx = { dist, src, reg, regFile, root }
const staticGates = {
  'register: schema and inert-null rule (source register)': (c) => validateRegister(c.reg),

  'palette: colour literals only in src/tokens.css': (c) => {
    const errs = [];
    for (const f of walk(c.src)) {
      if (!isText(f) || path.basename(f) === 'tokens.css') continue;
      const hits = colourLiterals(read(f));
      if (hits.length) errs.push(`${path.relative(c.root, f)}: ${hits.slice(0, 3).join(', ')}`);
    }
    return errs;
  },

  'palette: every token equals the real brand pixel it cites': async (c) => {
    const css = read(path.join(c.src, 'tokens.css'));
    const png = path.join(c.root, 'brand', 'LOGO HOLKERCOIN PNG.png');
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const errs = [], rx = /^\s+(bg|accent|mid|deep)\s+(#[0-9a-f]{6})\s+share[^\n]*pixel \((\d+),(\d+)\)/gm;
    const seen = new Set();
    for (const m of css.matchAll(rx)) {
      const [, name, hex, x, y] = m; seen.add(name);
      const i = (Number(y) * info.width + Number(x)) * 4;
      const real = '#' + [0, 1, 2].map((k) => data[i + k].toString(16).padStart(2, '0')).join('');
      if (real !== hex) errs.push(`provenance ${name}: comment says ${hex}, pixel(${x},${y}) is ${real}`);
      const decl = css.match(new RegExp(`--hk-${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!decl || decl[1].toLowerCase() !== hex) errs.push(`token --hk-${name} (${decl && decl[1]}) differs from provenance ${hex}`);
    }
    for (const n of ['bg', 'accent', 'mid', 'deep']) if (!seen.has(n)) errs.push(`token ${n} has no provenance line`);
    return errs;
  },

  'repo hygiene: no agent-config files, no AI attribution': (c) => {
    const errs = [];
    const skip = (p, d) => ['node_modules', '.gate-tmp', '.git'].includes(d.name);
    const AGENT_MD = 'CLA' + 'UDE.md', AGENT_DIR = '.cla' + 'ude';
    const needle = new RegExp(['cla' + 'ude', 'anth' + 'ropic', 'co-?authored-?by', 'generated (?:with|by) (?:an? )?(?:ai|llm)', 'ai[- ]generated'].join('|'), 'i');
    for (const f of walk(c.root, skip)) {
      const rel = path.relative(c.root, f);
      if (path.basename(rel).toLowerCase() === AGENT_MD.toLowerCase() || rel.split(path.sep).includes(AGENT_DIR)) errs.push(`forbidden file ${rel}`);
      if (isText(f) && !rel.includes('package-lock') && needle.test(read(f))) errs.push(`attribution text in ${rel}`);
    }
    if (fs.existsSync(path.join(c.root, AGENT_DIR))) errs.push(`${AGENT_DIR}/ exists`);
    return errs;
  },

  'css: no ch units, tap-target token >= 44px': (c) => {
    const css = ['styles.css', 'tokens.css'].map((f) => read(path.join(c.src, f))).join('\n');
    const errs = [];
    if (/\d\s*ch\b/.test(css)) errs.push('ch unit found in css');
    const tap = css.match(/--tap:\s*(\d+)px/);
    if (!tap || Number(tap[1]) < 44) errs.push('--tap token missing or below 44px');
    return errs;
  },

  'motion: reduced-motion kills animation, transition, parallax, spotlight tracking': (c) => {
    const css = read(path.join(c.src, 'styles.css'));
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*$/);
    const errs = [];
    if (!block) return ['no prefers-reduced-motion block'];
    if (!/animation:\s*none\s*!important/.test(block[0])) errs.push('reduce block does not disable animation');
    if (!/transition:\s*none\s*!important/.test(block[0])) errs.push('reduce block does not disable transition');
    const motion = read(path.join(c.src, 'js', 'motion.js'));
    for (const fn of ['initReveal', 'initSpotlight', 'initParallax', 'flash', 'countTo']) {
      const body = motion.slice(motion.indexOf('function ' + fn));
      if (!/reduced\(\)/.test(body.slice(0, 400))) errs.push(`${fn} does not check reduced()`);
    }
    if (!/reduced\(\)/.test(read(path.join(c.src, 'js', 'toast.js')))) errs.push('toast ignores reduced motion');
    if (!/reduced\(\)/.test(read(path.join(c.src, 'js', 'live.js')))) errs.push('live ignores reduced motion');
    return errs;
  },

  'copy: zero shared 2-grams with the reference site': (c) => {
    const ref = bigrams(read(path.join(FIX, 'reference-copy.txt')));
    const mine = bigrams(visibleCopy(c.dist, c.src));
    const shared = [...mine].filter((g) => ref.has(g) && !ALLOWED_BIGRAMS.has(g) && !g.split(' ').every((w) => stopwords.has(w)));
    return shared.map((g) => `shared 2-gram: "${g}"`);
  },

  'live: pollers use backoff, endpoints are the specified ones': (c) => {
    const errs = [];
    const poller = read(path.join(c.src, 'js', 'poller.js')), cfg = read(path.join(c.src, 'js', 'config.js')), live = read(path.join(c.src, 'js', 'live.js'));
    if (!/2 \*\* this\.fails/.test(poller) || !/backoffMaxMs/.test(poller)) errs.push('poller lacks exponential backoff');
    if (!/blockMs:\s*2000/.test(cfg)) errs.push('block poll is not 2000ms');
    for (const u of ['https://solana-rpc.publicnode.com', 'q=holker', 'token-boosts/top/v1', 'tokens/v1/solana/']) if (!cfg.includes(u)) errs.push(`config missing ${u}`);
    if (!/getBlockHeight/.test(live) || !/commitment/.test(live)) errs.push('block height request not confirmed-commitment');
    if (!/imageUrl/.test(live) || !/logoURI/.test(live)) errs.push('logo sources missing');
    return errs;
  },
};

const branchGates = {
  'dist: index.html present, every local reference resolves': (c) => {
    const errs = [];
    if (!fs.existsSync(path.join(c.dist, 'index.html'))) return ['dist/index.html missing'];
    const html = read(path.join(c.dist, 'index.html'));
    const refs = new Set([...html.matchAll(/\b(?:src|href|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])).filter((u) => u.startsWith('/') && !u.startsWith('//')));
    for (const r of refs) if (!fs.existsSync(path.join(c.dist, r.replace(/^\//, '')))) errs.push(`missing ${r}`);
    for (const m of read(path.join(c.dist, 'js', 'main.js')).matchAll(/from '(\.\/[^']+)'/g)) if (!fs.existsSync(path.join(c.dist, 'js', m[1]))) errs.push(`missing js/${m[1]}`);
    return errs;
  },

  'register: dist copy equals source and validates': (c) => {
    const j = JSON.parse(parse(read(path.join(c.dist, 'index.html'))).querySelector('#register').textContent);
    const errs = validateRegister(j);
    if (JSON.stringify(j) !== JSON.stringify(c.reg)) errs.push('embedded register differs from source register');
    return errs;
  },

  'link rule: stated -> href = stored url, handle derived; inert -> no href': (c) => {
    const root = parse(read(path.join(c.dist, 'index.html'))), errs = [];
    for (const rec of c.reg.records.filter((r) => r.id !== 'ca')) {
      const els = root.querySelectorAll(`[data-record="${rec.id}"]`);
      if (!els.length) errs.push(`${rec.id}: no element carries data-record`);
      for (const e of els) {
        const href = e.getAttribute('href');
        if (isStated(rec)) {
          if (href !== rec.url) errs.push(`${rec.id}: href ${href} != stored url ${rec.url}`);
          if (!(e.getAttribute('aria-label') || '').includes(deriveHandle(rec))) errs.push(`${rec.id}: derived handle missing from label`);
        } else {
          if (href !== undefined) errs.push(`${rec.id}: inert element carries href`);
          if (e.tagName === 'A') errs.push(`${rec.id}: inert element is an <a>`);
          if (e.getAttribute('aria-disabled') !== 'true' && e.getAttribute('role') !== 'img') errs.push(`${rec.id}: inert element not marked inert`);
        }
      }
    }
    const buy = deriveBuyUrl(c.reg);
    for (const e of root.querySelectorAll('[data-derived="buy"]')) {
      if (buy ? e.getAttribute('href') !== buy : e.getAttribute('href') !== undefined) errs.push('buy: href does not follow the CA state');
    }
    for (const a of root.querySelectorAll('a')) { const h = a.getAttribute('href') || ''; if (h === '#' || /^javascript:/i.test(h)) errs.push(`dead link ${h}`); }
    return errs;
  },

  'gate warning: address-shaped strings must match a stated record (CA slot exempt)': (c) => {
    const allowed = new Set(c.reg.records.filter(isStated).flatMap((r) => [r.value, r.url]).filter(Boolean));
    const errs = [];
    for (const f of walk(c.dist).filter(isText)) {
      let text = read(f);
      if (f.endsWith('index.html')) { const r = parse(text); r.querySelectorAll('[data-record="ca"]').forEach((n) => n.remove()); text = r.toString(); }
      for (const s of addressShaped(text)) if (!allowed.has(s)) errs.push(`${path.relative(c.dist, f)}: unmatched address-shaped string ${s.slice(0, 12)}...`);
    }
    return errs;
  },

  'CA slot: top of page, full address, copy only when stated, inert otherwise': (c) => {
    const ca = byId(c.reg, 'ca'), root = parse(read(path.join(c.dist, 'index.html'))), errs = [];
    const slot = root.querySelector('[data-record="ca"]');
    if (!slot) return ['no CA slot'];
    const chrome = root.querySelector('header.chrome');
    if (!chrome || !chrome.querySelector('[data-record="ca"]')) errs.push('CA slot is not inside the sticky header');
    const btn = slot.querySelector('button[data-copy-ca]'), val = slot.querySelector('.ca-value');
    if (isStated(ca)) {
      if (!btn) errs.push('stated CA has no copy button');
      if (!val || val.textContent !== ca.value) errs.push('stated CA slot does not show the full address');
      if (slot.getAttribute('data-state') !== 'stated') errs.push('slot state attribute wrong');
    } else {
      if (btn) errs.push('inert CA slot has a copy button');
      if (slot.querySelector('[data-copy-ca]')) errs.push('inert CA slot has a copy hook');
      if (addressShaped(slot.toString().replace(/<[^>]+>/g, ' ')).length) errs.push('inert CA slot carries an address');
      if (slot.getAttribute('data-state') === 'stated') errs.push('slot claims stated');
    }
    return errs;
  },

  'social: X and GitHub icons present at all breakpoints, top-right, icon only, official marks': (c) => {
    const root = parse(read(path.join(c.dist, 'index.html'))), errs = [];
    const group = root.querySelector('header.chrome .bar .socials');
    if (!group) return ['socials group not in header bar'];
    const x = group.querySelector('[data-record="x"]'), g = group.querySelector('[data-record="github"]');
    if (!x || !g) errs.push('missing X or GitHub icon in header');
    if (x && !x.innerHTML.includes(siX.path)) errs.push('X icon is not the official simple-icons X mark');
    const octPath = octicons['mark-github'].heights[24].path.match(/d="([^"]+)"/)[1];
    if (g && !g.innerHTML.includes(octPath)) errs.push('GitHub icon is not the official Octicon mark-github');
    for (const e of [x, g].filter(Boolean)) {
      if (e.text.trim() !== '') errs.push('social icon carries visible text');
      if (!e.getAttribute('aria-label')) errs.push('social icon lacks accessible name');
    }
    const css = read(path.join(c.dist, 'styles.css'));
    if (/\.socials[^{]*\{[^}]*display:\s*none/.test(css)) errs.push('socials hidden by css at some breakpoint');
    return errs;
  },

  'palette (dist): no stray colour literals; favicon colours are tokens': (c) => {
    const css = read(path.join(c.dist, 'tokens.css'));
    const tokens = new Set([...css.matchAll(/--hk-(?:bg|accent|mid|deep):\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase()));
    const errs = [];
    for (const f of walk(c.dist).filter(isText)) {
      if (path.basename(f) === 'tokens.css') continue;
      const text = f.endsWith('favicon.svg') ? '' : read(f);
      // A literal is tolerated only in index.html (theme-color) and only when it equals a token value.
      const hits = colourLiterals(text).filter((h) => !(f.endsWith('index.html') && tokens.has(h.toLowerCase())));
      if (hits.length) errs.push(`${path.relative(c.dist, f)}: ${hits[0]}`);
    }
    const fav = read(path.join(c.dist, 'favicon.svg'));
    for (const h of fav.match(HEX_LITERAL) || []) if (!tokens.has(h.toLowerCase())) errs.push(`favicon colour ${h} not a token`);
    return errs;
  },

  'favicon: svg 32x32, traced path, no comments, no double hyphen': (c) => {
    const fav = read(path.join(c.dist, 'favicon.svg')), errs = [];
    if (!/viewBox="0 0 32 32"/.test(fav) || !/width="32"/.test(fav) || !/height="32"/.test(fav)) errs.push('not 32x32');
    if (/<!--/.test(fav) || /--/.test(fav)) errs.push('contains comment or double hyphen');
    if (!/<path[^>]* d="M[^"]{400,}"/.test(fav)) errs.push('no traced path of real complexity');
    if (!fs.existsSync(path.join(c.dist, 'favicon.svg'))) errs.push('missing');
    return errs;
  },

  'assets: premultiplied resize left no dark halo on mark edges': async (c) => {
    const { data, info } = await sharp(path.join(c.dist, 'assets', 'mark-560.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let edge = 0, dark = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const a = data[i * 4 + 3];
      if (a > 40 && a < 240) { edge++; if (data[i * 4 + 1] < 200) dark++; }
    }
    return edge < 100 ? ['no edge pixels sampled'] : dark ? [`${dark}/${edge} edge pixels are darker than the accent (black bleed)`] : [];
  },

  'security: CSP present, no inline style attributes, no inline scripts': (c) => {
    const errs = [], html = read(path.join(c.dist, 'index.html'));
    if (!/Content-Security-Policy/.test(read(path.join(c.dist, '_headers')))) errs.push('no CSP in _headers');
    if (/\sstyle="/.test(html)) errs.push('inline style attribute in html');
    if (/<script(?![^>]*(?:src=|type="application\/json"))[^>]*>/.test(html)) errs.push('inline executable script');
    return errs;
  },

  'live: skeletons on all four tiles, pairs board and marquee': (c) => {
    const root = parse(read(path.join(c.dist, 'index.html'))), errs = [];
    for (const id of ['tile-height', 'tile-pairs', 'tile-price', 'tile-volume']) {
      const t = root.querySelector('#' + id);
      if (!t || !t.querySelector('.skel') || t.getAttribute('data-state') !== 'loading') errs.push(`${id}: no skeleton/loading state`);
    }
    if (!root.querySelector('#pairs .pair-skel')) errs.push('pairs board has no skeleton rows');
    if (!root.querySelector('#marquee')) errs.push('no marquee');
    if (!root.querySelector('#progress')) errs.push('no scroll progress bar');
    if (!root.querySelector('#status-pill .dot')) errs.push('no status pill with live dot');
    return errs;
  },
};

/* ================= runner ================= */
let total = 0, failed = 0;
async function run(label, gates, ctx) {
  for (const [name, fn] of Object.entries(gates)) {
    total++;
    let errs;
    try { errs = await fn(ctx); } catch (e) { errs = [`threw: ${e.message}`]; }
    if (errs.length) { failed++; console.log(`  FAIL [${label}] ${name}`); errs.slice(0, 6).forEach((e) => console.log(`        - ${e}`)); } else console.log(`  pass [${label}] ${name}`);
  }
}
const ctxFor = (dist, regFile) => ({ dist, src: path.join(ROOT, 'src'), reg: loadRegister(regFile), regFile, root: ROOT });

/* ================= mutation harness =================
   Every anchor is state-independent: elements are found by data-record / data-derived attributes and
   values are read from the register at runtime. Nothing here hardcodes expected text or a branch.
   A mutation passes when the targeted gate FAILS on the mutated copy. */
function cloneDist(dist, name) {
  const to = path.join(TMP, 'mut-' + name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(dist, to, { recursive: true });
  return to;
}
const patchHtml = (dir, fn) => { const f = path.join(dir, 'index.html'); const r = parse(read(f), { comment: true }); fn(r); fs.writeFileSync(f, r.toString()); };

const mutations = [
  { name: 'toggle href on every link record (adds if inert, strips if stated)', gate: 'link rule: stated -> href = stored url, handle derived; inert -> no href',
    mutate: (d, c) => patchHtml(d, (r) => { for (const rec of c.reg.records.filter((x) => x.id !== 'ca')) for (const e of r.querySelectorAll(`[data-record="${rec.id}"]`)) { if (e.getAttribute('href') === undefined) e.setAttribute('href', 'https://example.invalid/x'); else e.removeAttribute('href'); } }) },
  { name: 'rewrite stored url on a link record at the element (stated) or add one (inert)', gate: 'link rule: stated -> href = stored url, handle derived; inert -> no href',
    mutate: (d) => patchHtml(d, (r) => { const e = r.querySelector('[data-record="x"]'); e.setAttribute('href', (e.getAttribute('href') || 'https://x.com/') + 'zz'); }) },
  { name: 'break register: keep value/url but flip the state of every record', gate: 'register: schema and inert-null rule (source register)',
    mutate: (d, c) => { for (const r of c.reg.records) r.state = r.state === 'stated' ? 'absent' : 'stated'; }, onRegister: true },
  { name: 'break register: put the current value into an inert record, or null out a stated one', gate: 'register: schema and inert-null rule (source register)',
    mutate: (d, c) => { const r = byId(c.reg, 'ca'); if (r.state === 'stated') { r.value = null; r.url = null; } else { r.value = 'leak'; } }, onRegister: true },
  { name: 'plant an address-shaped string outside the CA slot', gate: 'gate warning: address-shaped strings must match a stated record (CA slot exempt)',
    mutate: (d, c) => { const taken = new Set(c.reg.records.map((r) => r.value)); const probe = 'So11111111111111111111111111111111111111112'; if (taken.has(probe)) throw new Error('probe collides'); patchHtml(d, (r) => r.querySelector('footer .fine').insertAdjacentHTML('beforeend', ` ${probe}`)); } },
  { name: 'plant a 0x address outside the CA slot', gate: 'gate warning: address-shaped strings must match a stated record (CA slot exempt)',
    mutate: (d) => fs.appendFileSync(path.join(d, 'js', 'main.js'), "\nconst x = '0x52908400098527886E0F7030069857D2E4169EE7';\n") },
  { name: 'strip or inject the CA slot value (whichever the current state is not)', gate: 'CA slot: top of page, full address, copy only when stated, inert otherwise',
    mutate: (d, c) => patchHtml(d, (r) => { const v = r.querySelector('[data-record="ca"] .ca-value'); v.set_content(byId(c.reg, 'ca').state === 'stated' ? 'truncated' : 'So11111111111111111111111111111111111111112'); }) },
  { name: 'give an inert CA slot a copy hook / drop the stated one', gate: 'CA slot: top of page, full address, copy only when stated, inert otherwise',
    mutate: (d) => patchHtml(d, (r) => { const b = r.querySelector('[data-record="ca"] button[data-copy-ca]'); if (b) b.remove(); else r.querySelector('[data-record="ca"] .ca-btn').setAttribute('data-copy-ca', ''); }) },
  { name: 'hide the social group', gate: 'social: X and GitHub icons present at all breakpoints, top-right, icon only, official marks',
    mutate: (d) => patchHtml(d, (r) => r.querySelector('.socials').remove()) },
  { name: 'stray colour literal in dist css', gate: 'palette (dist): no stray colour literals; favicon colours are tokens',
    mutate: (d) => fs.appendFileSync(path.join(d, 'styles.css'), '\n.x{color:#12abef}\n') },
  { name: 'favicon with a comment containing a double hyphen', gate: 'favicon: svg 32x32, traced path, no comments, no double hyphen',
    mutate: (d) => { const f = path.join(d, 'favicon.svg'); fs.writeFileSync(f, read(f).replace('<rect', '<!-- a -- b --><rect')); } },
  { name: 'remove reduced-motion block from source css', gate: 'motion: reduced-motion kills animation, transition, parallax, spotlight tracking',
    mutate: () => {}, srcMutate: (srcDir) => { const f = path.join(srcDir, 'styles.css'); fs.writeFileSync(f, read(f).replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, '')); } },
  { name: 'introduce a ch unit in source css', gate: 'css: no ch units, tap-target token >= 44px',
    mutate: () => {}, srcMutate: (srcDir) => fs.appendFileSync(path.join(srcDir, 'styles.css'), '\n.y{width:20ch}\n') },
  { name: 'paste a reference phrase into the page copy', gate: 'copy: zero shared 2-grams with the reference site',
    mutate: (d) => patchHtml(d, (r) => r.querySelector('footer .fine').insertAdjacentHTML('beforeend', ' Hardened radio equipment can survive electromagnetic pulses.')) },
  { name: 'forbidden project files appear', gate: 'repo hygiene: no agent-config files, no AI attribution',
    mutate: () => {}, rootMutate: (root) => { fs.writeFileSync(path.join(root, 'CLA' + 'UDE.md'), 'x'); fs.mkdirSync(path.join(root, '.cla' + 'ude')); } },
];

async function mutationHarness(label, dist, regFile) {
  for (const m of mutations) {
    total++;
    const base = ctxFor(dist, regFile);
    const mdir = cloneDist(dist, 'work');
    let ctx = { ...base, dist: mdir, reg: JSON.parse(JSON.stringify(base.reg)) };
    let tmpSrc = null, tmpRoot = null;
    try {
      if (m.srcMutate) { tmpSrc = path.join(TMP, 'mut-src'); fs.rmSync(tmpSrc, { recursive: true, force: true }); fs.cpSync(base.src, tmpSrc, { recursive: true }); m.srcMutate(tmpSrc); ctx.src = tmpSrc; }
      if (m.rootMutate) { tmpRoot = path.join(TMP, 'mut-root'); fs.rmSync(tmpRoot, { recursive: true, force: true }); fs.mkdirSync(tmpRoot, { recursive: true }); fs.cpSync(path.join(ROOT, 'src'), path.join(tmpRoot, 'src'), { recursive: true }); m.rootMutate(tmpRoot); ctx.root = tmpRoot; ctx.src = path.join(tmpRoot, 'src'); }
      m.mutate(mdir, ctx);
      if (m.onRegister) ctx.reg = ctx.reg; // mutated in place
      const gate = staticGates[m.gate] || branchGates[m.gate];
      const errs = await gate(ctx);
      if (errs.length) console.log(`  pass [${label}] mutation caught: ${m.name}`);
      else { failed++; console.log(`  FAIL [${label}] mutation SURVIVED: ${m.name}`); }
    } catch (e) {
      failed++; console.log(`  FAIL [${label}] mutation harness error (${m.name}): ${e.message}`);
    }
  }
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const t0 = Date.now();
  try {
    console.log('== static gates (source) ==');
    await run('static', staticGates, ctxFor(path.join(ROOT, 'dist'), path.join(ROOT, 'src', 'register.json')));

    const branches = [
      { label: 'live dist', dist: path.join(ROOT, 'dist'), regFile: path.join(ROOT, 'src', 'register.json') },
      { label: 'absent', regFile: path.join(FIX, 'register.absent.json') },
      { label: 'stated', regFile: path.join(FIX, 'register.stated.json') },
    ];
    for (const b of branches) {
      if (!b.dist) { b.dist = path.join(TMP, b.label); await build({ registerFile: b.regFile, out: b.dist, quiet: true }); }
      console.log(`== branch: ${b.label} (${path.relative(ROOT, b.regFile)}) ==`);
      await run(b.label, branchGates, ctxFor(b.dist, b.regFile));
    }
    for (const b of branches.slice(1)) {
      console.log(`== mutation harness: ${b.label} ==`);
      await mutationHarness(b.label, b.dist, b.regFile);
    }
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n${total} gates run, ${total - failed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(failed ? 1 : 0);
})();
