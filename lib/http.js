import { config } from './config.js';
import { HttpError } from './util.js';

/* ------------------------------------------------------------------- cookies */

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = Object.create(null);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

export function cookieHeader(name, value, options = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`];
  bits.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) bits.push('HttpOnly');
  if (options.secure) bits.push('Secure');
  bits.push(`SameSite=${options.sameSite || 'Strict'}`);
  return bits.join('; ');
}

export function setCookie(res, name, value, options = {}) {
  const existing = res.getHeader('Set-Cookie');
  const cookie = cookieHeader(name, value, options);
  if (!existing) res.setHeader('Set-Cookie', cookie);
  else res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
}

/* --------------------------------------------------------------------- http */

export function isHttps(req) {
  if (config.forceSecureCookies) return true;
  if (req.socket?.encrypted) return true;
  if (config.trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (proto === 'https') return true;
  }
  return false;
}

export function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return normalizeIp(forwarded);
  }
  return normalizeIp(req.socket?.remoteAddress || '');
}

function normalizeIp(ip) {
  return String(ip).replace(/^::ffff:/, '').replace(/^\[|\]$/g, '') || 'bilinmiyor';
}

export function securityHeaders(req, res) {
  const https = isHttps(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      "font-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      https ? 'upgrade-insecure-requests' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJson(res, status, payload) {
  if (res.writableEnded || res.headersSent) return;
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(res, status, message, code) {
  sendJson(res, status, { error: message, code });
}

export async function readJson(req, limit = 1024 * 1024) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'İstek biçimi desteklenmiyor.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'İstek çok büyük.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object expected');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'Geçersiz istek gövdesi.');
  }
}

export function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Geçersiz istek kaynağı.');
    }
    if (host !== req.headers.host) throw new HttpError(403, 'Geçersiz istek kaynağı.');
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'Bu istek yalnızca uygulama içinden yapılabilir.');
  }
}

export function wantsJson(req) {
  return String(req.headers.accept || '').includes('application/json') ||
    String(req.url || '').startsWith('/api/');
}
