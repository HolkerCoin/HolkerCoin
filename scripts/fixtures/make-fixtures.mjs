// One-off helper: regenerates test registers and the reference-copy corpus used by the copy gate.
// Usage: node scripts/fixtures/make-fixtures.mjs <path-to-fetched-reference-index.html> <path-to-reference-page-bundle.js>
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } return s; };

const rec = (id, label, state, value, url) => ({ id, label, state, value, url });
const write = (name, records) => fs.writeFileSync(path.join(here, name), JSON.stringify({ schema: 1, records }, null, 2) + '\n');

write('register.absent.json', [rec('ca', 'Contract address', 'absent', null, null), rec('x', 'X', 'absent', null, null), rec('github', 'GitHub', 'absent', null, null)]);
let ca;
do { ca = b58(crypto.randomBytes(32)); } while (ca.length !== 44 || !/[0-9]/.test(ca));
write('register.stated.json', [rec('ca', 'Contract address', 'stated', ca, null), rec('x', 'X', 'stated', null, 'https://x.com/holker_fixture'), rec('github', 'GitHub', 'stated', null, 'https://github.com/holker-fixture')]);

const [htmlFile, jsFile] = process.argv.slice(2);
if (htmlFile) {
  const root = parse(fs.readFileSync(htmlFile, 'utf8'));
  root.querySelectorAll('script,style,template').forEach((n) => n.remove());
  const out = [root.textContent];
  root.querySelectorAll('[alt],[title],[aria-label]').forEach((n) => out.push(n.getAttribute('alt') || '', n.getAttribute('title') || '', n.getAttribute('aria-label') || ''));
  if (jsFile) {
    const bundle = fs.readFileSync(jsFile, 'utf8');
    for (const m of bundle.match(/"[^"\\]{20,}"/g) || []) {
      const t = m.slice(1, -1);
      if (/\s/.test(t) && !/[{}();=]|https?:/.test(t)) out.push(t);
    }
  }
  fs.writeFileSync(path.join(here, 'reference-copy.txt'), out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n'));
}
