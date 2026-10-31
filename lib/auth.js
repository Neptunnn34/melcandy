import { config } from './config.js';
import { all, get, run } from './db.js';
import { cookieHeader, isHttps, parseCookies, setCookie } from './http.js';
import {
  addDays,
  addMs,
  inviteCode as makeInviteCode,
  normalizeInvite,
  nowIso,
  sha256,
  uid,
} from './util.js';

const PENDING_COOKIE = 'ikimiz_pending';

export function sessionCookieOptions(req, maxAgeSeconds) {
  return {
    maxAge: maxAgeSeconds,
    httpOnly: true,
    secure: isHttps(req),
    sameSite: 'Lax',
    path: '/',
  };
}

export function createSession(userId, req, res) {
  const token = uid(32);
  const id = uid(12);
  const now = nowIso();
  const expiresAt = addDays(config.sessionDays);

  run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_used_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    sha256(token),
    now,
    now,
    expiresAt,
    String(req.headers['user-agent'] || '').slice(0, 300),
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').slice(0, 100),
  );

  // Aynı kullanıcı için çok fazla cihaz oturumu birikmesin.
  run(
    `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 12
     )`,
    userId,
    userId,
  );

  setCookie(res, config.sessionCookie, token, sessionCookieOptions(req, config.sessionDays * 86400));
  setCookie(res, PENDING_COOKIE, '', { ...sessionCookieOptions(req, 0), maxAge: 0 });
  return { id, token, expiresAt };
}

export function destroyCurrentSession(req, res) {
  const token = parseCookies(req)[config.sessionCookie];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setCookie(res, config.sessionCookie, '', { ...sessionCookieOptions(req, 0), maxAge: 0 });
}

export function resolveSession(req, res) {
  const token = parseCookies(req)[config.sessionCookie];
  if (!token) return null;

  const row = get(
    `SELECT s.id AS session_id, s.token_hash, s.created_at AS session_created_at,
            s.last_used_at, s.expires_at, s.user_agent, s.ip,
            u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;

  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    run('DELETE FROM sessions WHERE id = ?', row.session_id);
    return null;
  }

  // Oturumu kullanıldıkça tazele (en fazla saatte bir yaz).
  if (now - Date.parse(row.last_used_at) > 60 * 60 * 1000) {
    const newExpiry = addDays(config.sessionDays);
    run('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?', nowIso(), newExpiry, row.session_id);
    setCookie(res, config.sessionCookie, token, sessionCookieOptions(req, config.sessionDays * 86400));
    row.expires_at = newExpiry;
    row.last_used_at = nowIso();
  }

  const session = {
    id: row.session_id,
    created_at: row.session_created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    user_agent: row.user_agent,
    ip: row.ip,
    current: true,
  };

  const user = {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    password_hash: row.password_hash,
    bio: row.bio,
    link: row.link,
    pronouns: row.pronouns,
    avatar_media: row.avatar_media,
    cover_media: row.cover_media,
    theme: row.theme,
    settings: row.settings,
    approved: row.approved,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  };

  return { user, session, token };
}

export function touchUser(userId) {
  run('UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), userId);
}

/* ------------------------------------------------------------------- invites */

export function activeInvite() {
  const rows = all(
    `SELECT * FROM invites
      WHERE used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
    nowIso(),
  );
  return rows[0] || null;
}

export function createInvite(userId) {
  const code = makeInviteCode();
  const now = nowIso();
  const expiresAt = addMs(config.inviteHours * 60 * 60 * 1000);
  // Aynı anda tek geçerli davet olsun.
  run('DELETE FROM invites WHERE used_at IS NULL');
  run(
    'INSERT INTO invites (id, code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    uid(12),
    code,
    userId,
    now,
    expiresAt,
  );
  return { code, expiresAt };
}

export function findInvite(input) {
  const normalized = normalizeInvite(input);
  if (!normalized) return null;
  const rows = all(
    `SELECT * FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
    nowIso(),
  );
  return rows.find((row) => normalizeInvite(row.code) === normalized) || null;
}

export function consumeInvite(invite, userId) {
  run('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ?', nowIso(), userId, invite.id);
}

export function clearPendingCookie(req, res) {
  setCookie(res, PENDING_COOKIE, '', { ...sessionCookieOptions(req, 0), maxAge: 0 });
}

export function setPendingCookie(req, res, username) {
  setCookie(res, PENDING_COOKIE, username, {
    ...sessionCookieOptions(req, 15 * 60),
    maxAge: 15 * 60,
  });
}

export function pendingUsername(req) {
  return parseCookies(req)[PENDING_COOKIE] || null;
}

export function sessionListFor(userId) {
  return all(
    `SELECT id, created_at, last_used_at, expires_at, user_agent, ip
       FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC`,
    userId,
  );
}

export function cookieDebug(req) {
  return cookieHeader(config.sessionCookie, 'x', { secure: isHttps(req) });
}
