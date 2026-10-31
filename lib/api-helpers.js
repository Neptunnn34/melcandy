import { get } from './db.js';
import { HttpError } from './util.js';

export function requireUser(ctx, { allowPending = false } = {}) {
  if (!ctx.auth) throw new HttpError(401, 'Giriş yapman gerekiyor.', 'unauthorized');
  if (!allowPending && !ctx.auth.user.approved) {
    throw new HttpError(403, 'Hesabın henüz onaylanmadı.', 'pending_approval');
  }
  return ctx.auth.user;
}

export function approvedUserByUsername(username) {
  const user = get(
    'SELECT * FROM users WHERE username = ? COLLATE NOCASE AND approved = 1',
    String(username || ''),
  );
  if (!user) throw new HttpError(404, 'Kullanıcı bulunamadı.');
  return user;
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function getMediaOwned(mediaId, userId) {
  const row = get('SELECT * FROM media WHERE id = ?', mediaId);
  if (!row) throw new HttpError(404, 'Medya bulunamadı.');
  if (row.owner_id !== userId) throw new HttpError(403, 'Bu medya sana ait değil.');
  return row;
}

export function postForViewer(postId, user, { includeArchived = false } = {}) {
  const row = get('SELECT * FROM posts WHERE id = ?', postId);
  if (!row) throw new HttpError(404, 'Gönderi bulunamadı.');
  if (row.archived && !includeArchived && row.user_id !== user.id) {
    throw new HttpError(404, 'Gönderi bulunamadı.');
  }
  return row;
}

export function clampLimit(value, fallback = 12, max = 40) {
  const n = Number.parseInt(value || '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function pageResult(items, cursorField, limit) {
  let nextCursor = null;
  if (items.length > limit) {
    items = items.slice(0, limit);
    const last = items[items.length - 1];
    nextCursor = last?.[cursorField] || null;
  }
  return { items, nextCursor };
}

export function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
    (req.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers.host || 'localhost'}`;
}
