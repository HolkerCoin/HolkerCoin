import fs from 'node:fs';

export const STATES = ['stated', 'absent', 'unconfirmed'];
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HOSTS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };

export function loadRegister(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const byId = (reg, id) => reg.records.find((r) => r.id === id);

/** Schema check. Returns a list of problems (empty list = valid). */
export function validateRegister(reg) {
  const errs = [];
  const seen = new Set();
  for (const r of reg.records) {
    const tag = `record "${r.id}"`;
    if (seen.has(r.id)) errs.push(`${tag}: duplicate id`);
    seen.add(r.id);
    if (!STATES.includes(r.state)) { errs.push(`${tag}: state "${r.state}" not one of ${STATES}`); continue; }
    if (r.state !== 'stated') {
      if (r.value !== null) errs.push(`${tag}: inert (${r.state}) but value is not null`);
      if (r.url !== null) errs.push(`${tag}: inert (${r.state}) but url is not null`);
      continue;
    }
    if (r.id === 'ca') {
      if (typeof r.value !== 'string' || !BASE58.test(r.value)) errs.push(`${tag}: stated value is not a base58 Solana address`);
      if (r.url !== null) errs.push(`${tag}: ca stores value only, url must be null`);
    } else {
      if (r.value !== null) errs.push(`${tag}: link record stores url only, value must be null (handle is derived)`);
      let u;
      try { u = new URL(r.url); } catch { errs.push(`${tag}: stated url is not a URL`); continue; }
      if (u.protocol !== 'https:') errs.push(`${tag}: url must be https`);
      if (HOSTS[r.id] && !HOSTS[r.id].includes(u.hostname.replace(/^www\./, ''))) errs.push(`${tag}: host ${u.hostname} not expected`);
      if (!deriveHandle(r)) errs.push(`${tag}: no handle derivable from url`);
    }
  }
  return errs;
}

/** Link rule: store url, derive the handle. Never stored. */
export function deriveHandle(rec) {
  if (rec.state !== 'stated' || !rec.url) return null;
  try {
    const seg = new URL(rec.url).pathname.split('/').filter(Boolean)[0];
    return seg ? `@${seg}` : null;
  } catch { return null; }
}

export const isStated = (rec) => rec && rec.state === 'stated';

/** Derived, never stored: the buy link exists only while the CA is stated. */
export function deriveBuyUrl(reg) {
  const ca = byId(reg, 'ca');
  return isStated(ca) ? `https://jup.ag/swap/SOL-${ca.value}` : null;
}
