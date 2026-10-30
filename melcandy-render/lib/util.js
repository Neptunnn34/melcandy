import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

/* ------------------------------------------------------------------ ids/random */

export function uid(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function inviteCode() {
  // Okunması kolay, karışmayan karakterlerden oluşan kod: IKM-XXXX-XXXX
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => {
    let out = '';
    const bytes = crypto.randomBytes(n);
    for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  return `IKM-${pick(4)}-${pick(4)}`;
}

export function normalizeInvite(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^IKM/, '');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ------------------------------------------------------------------- passwords */

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password).normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return [
    's1',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [tag, N, r, p, salt, hash] = String(stored || '').split('$');
    if (tag !== 's1') return false;
    const expected = Buffer.from(hash, 'base64');
    const derived = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(password) {
  const pw = String(password ?? '');
  if (pw.length < 8) return 'Şifre en az 8 karakter olmalı.';
  if (pw.length > 200) return 'Şifre çok uzun.';
  if (!/[a-zA-ZğüşıöçĞÜŞİÖÇ]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Şifre en az bir harf ve bir rakam içermeli.';
  }
  const weak = new Set([
    '12345678', '123456789', 'password', 'parola123', 'qwerty123', 'ikimiz123',
    '12345678a', 'sifre123', 'askim123', 'sevgilim',
  ]);
  if (weak.has(pw.toLowerCase())) return 'Bu şifre çok tahmin edilebilir. Biraz daha özgün bir şey seç.';
  return null;
}

/* ----------------------------------------------------------------------- text */

export function cleanText(value, max = 2000) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    // kontrol karakterlerini at (yeni satır ve tab hariç)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function cleanLine(value, max = 100) {
  return cleanText(value, max).replace(/\s+/g, ' ').trim();
}

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/^@/, '');
}

export function hasHashtag(text, tag) {
  const re = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[.,!?])`, 'i');
  return re.test(text);
}

export function extractMentions(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/(?:^|\s)@([a-z0-9._]{3,24})/gi)) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

/* ---------------------------------------------------------------------- dates */

export function nowIso() {
  return new Date().toISOString();
}

export function addMs(ms) {
  return new Date(Date.now() + ms).toISOString();
}

export function addDays(days) {
  return addMs(days * 24 * 60 * 60 * 1000);
}

/* --------------------------------------------------------------------- errors */

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function assert(condition, status, message, code) {
  if (!condition) throw new HttpError(status, message, code);
}

/* ------------------------------------------------------------------ rate limit */

const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfter: 0 };
}

export function resetRateLimit(key) {
  buckets.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

/* --------------------------------------------------------------- misc helpers */

export function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function toBoolInt(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
