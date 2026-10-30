import fsp from 'node:fs/promises';
import { config, DB_PATH, RESERVED_USERNAMES, USERNAME_RE } from '../config.js';
import {
  activeInvite,
  clearPendingCookie,
  createInvite,
  createSession,
  destroyCurrentSession,
  findInvite,
  sessionListFor,
} from '../auth.js';
import {
  all,
  countUsers,
  get,
  getUserById,
  getUserByUsername,
  parseSettings,
  run,
} from '../db.js';
import { storageStats, removeMediaFiles } from '../media.js';
import {
  badgeCounts,
  briefUser,
  followCounts,
  userOut,
} from '../present.js';
import { broadcast, onlineUserIds } from '../realtime.js';
import {
  assert,
  cleanLine,
  cleanText,
  hashPassword,
  HttpError,
  normalizeUsername,
  nowIso,
  passwordProblem,
  rateLimit,
  resetRateLimit,
  uid,
  verifyPassword,
} from '../util.js';
import { originOf, requireUser } from '../api-helpers.js';

const dummyHash = await hashPassword('gecersiz-sifre-123').catch(() => null);

function setupState() {
  const users = countUsers();
  if (users === 0) return { mode: 'first', userCount: 0, canRegister: true, inviteRequired: false };
  if (users < config.maxUsers) {
    return { mode: 'open', userCount: users, canRegister: true, inviteRequired: false };
  }
  return { mode: 'closed', userCount: users, canRegister: false, inviteRequired: false };
}

function inviteInfo() {
  if (countUsers() >= config.maxUsers) return { full: true, invite: null };
  const invite = activeInvite();
  return {
    full: false,
    invite: invite
      ? { code: invite.code, expiresAt: invite.expires_at, used: Boolean(invite.used_at) }
      : null,
  };
}

function meOut(user) {
  const counts = {
    posts: Number(get(`SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND archived = 0`, user.id).n),
    saved: Number(get(`SELECT COUNT(*) AS n FROM saves WHERE user_id = ?`, user.id).n),
    archive: Number(get(`SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND archived = 1`, user.id).n),
    ...followCounts(user.id),
  };
  return userOut(user, { counts });
}

function validateUsername(raw) {
  const username = normalizeUsername(raw);
  assert(USERNAME_RE.test(username), 400, 'Kullanıcı adı 3–24 karakter olmalı; yalnızca küçük harf, rakam, nokta ve alt çizgi kullan.');
  assert(!RESERVED_USERNAMES.has(username), 400, 'Bu kullanıcı adı ayrılmış.');
  assert(!getUserByUsername(username), 409, 'Bu kullanıcı adı zaten alınmış.');
  return username;
}

function validateDisplayName(raw) {
  const displayName = cleanLine(raw, 40);
  assert(displayName.length >= 1, 400, 'Görünen ad boş olamaz.');
  return displayName;
}

function validateLink(raw) {
  const link = cleanLine(raw, 160);
  if (!link) return '';
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    throw new HttpError(400, 'Bağlantı geçerli bir adres değil.');
  }
  assert(parsed.protocol === 'http:' || parsed.protocol === 'https:', 400, 'Bağlantı http veya https ile başlamalı.');
  return link;
}

function insertUser({ username, displayName, passwordHash, approved }) {
  const id = uid(12);
  const now = nowIso();
  run(
    `INSERT INTO users (id, username, display_name, password_hash, approved, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    username,
    displayName,
    passwordHash,
    approved ? 1 : 0,
    now,
    now,
  );
  return getUserById(id);
}

export function registerAuthRoutes(router) {
  /* --------------------------------------------------------------- bootstrap */

  router.get('/api/config', (ctx) => ({
    appName: config.appName,
    version: config.version,
    setup: setupState(),
    authenticated: Boolean(ctx.auth),
    pending: Boolean(ctx.auth && !ctx.auth.user.approved),  }));

  router.get('/api/bootstrap', (ctx) => {
    const base = { appName: config.appName, version: config.version, setup: setupState() };
    if (!ctx.auth) return { authenticated: false, ...base };

    const user = ctx.auth.user;
    return {
      authenticated: true,
      pending: false,
      me: meOut(user),
      badges: badgeCounts(user.id),
      online: onlineUserIds(),
      invite: inviteInfo(),
      ...base,
    };
  });

  /* ------------------------------------------------------------------- setup */

  router.post('/api/setup', async (ctx) => {
    const limit = rateLimit(`setup:${ctx.ip}`, 8, 30 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Çok fazla deneme. Lütfen biraz bekle.', 'rate_limited');

    const users = countUsers();
    assert(users < config.maxUsers, 403, 'Kayıtlar şu anda kapalı.', 'closed');

    const username = validateUsername(ctx.body.username);
    const displayName = validateDisplayName(ctx.body.displayName);
    const problem = passwordProblem(ctx.body.password);
    assert(!problem, 400, problem || 'Geçersiz şifre.');

    const passwordHash = await hashPassword(ctx.body.password);
    const user = insertUser({ username, displayName, passwordHash, approved: true });
    const invite = users === 0 ? createInvite(user.id) : null;

    destroyCurrentSession(ctx.req, ctx.res);
    createSession(user.id, ctx.req, ctx.res);
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), user.id);
    resetRateLimit(`setup:${ctx.ip}`);

    return {
      ok: true,
      pending: false,
      user: userOut(user),
      invite: invite ? { code: invite.code, expiresAt: invite.expiresAt } : null,
      setup: setupState(),
    };
  });

  /* ------------------------------------------------------------------- login */

  router.post('/api/login', async (ctx) => {
    const ip = ctx.ip || 'bilinmiyor';
    const username = normalizeUsername(ctx.body.username);
    const password = String(ctx.body.password ?? '');

    const ipLimit = rateLimit(`login-ip:${ip}`, 20, 15 * 60 * 1000);
    const userLimit = rateLimit(`login-user:${username || 'bos'}`, 10, 15 * 60 * 1000);
    if (!ipLimit.ok || !userLimit.ok) {
      const wait = Math.max(ipLimit.retryAfter, userLimit.retryAfter);
      throw new HttpError(429, `Çok fazla giriş denemesi. ${wait} saniye sonra tekrar dene.`, 'rate_limited');
    }

    const user = username ? getUserByUsername(username) : null;
    let valid = false;
    if (user) {
      valid = await verifyPassword(password, user.password_hash);
    } else if (dummyHash) {
      await verifyPassword(password, dummyHash);
    }

    if (!user || !valid) {
      throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı.', 'bad_credentials');
    }

    resetRateLimit(`login-ip:${ip}`);
    resetRateLimit(`login-user:${username}`);
    destroyCurrentSession(ctx.req, ctx.res);
    createSession(user.id, ctx.req, ctx.res);
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), user.id);
    clearPendingCookie(ctx.req, ctx.res);

    return { ok: true, pending: !user.approved, user: userOut(user) };
  });

  router.post('/api/logout', (ctx) => {
    requireUser(ctx, { allowPending: true });
    destroyCurrentSession(ctx.req, ctx.res);
    clearPendingCookie(ctx.req, ctx.res);
    return { ok: true };
  });

  /* ------------------------------------------------------------------ invite */

  router.get('/api/invite/check', (ctx) => {
    const limit = rateLimit(`invite-check:${ctx.ip}`, 30, 15 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Çok fazla deneme. Biraz bekle.', 'rate_limited');
    const invite = findInvite(ctx.query.get('code') || '');
    return {
      valid: Boolean(invite),
      expiresAt: invite?.expires_at || null,
      setup: setupState(),
    };
  });

  router.get('/api/me/invite', (ctx) => {
    requireUser(ctx);
    return inviteInfo();
  });

  router.post('/api/me/invite', (ctx) => {
    const user = requireUser(ctx);
    assert(countUsers() < config.maxUsers, 409, 'Kullanıcı sınırına ulaşıldı. Davet oluşturulamaz.', 'full');
    const invite = createInvite(user.id);
    return {
      code: invite.code,
      expiresAt: invite.expiresAt,
      link: `${originOf(ctx.req)}/?davet=${encodeURIComponent(invite.code)}`,
      full: false,
    };
  });

  /* ---------------------------------------------------------------------- me */

  router.get('/api/me', (ctx) => {
    const user = requireUser(ctx);
    return { user: meOut(user), badges: badgeCounts(user.id), online: onlineUserIds() };
  });

  router.patch('/api/me', async (ctx) => {
    const user = requireUser(ctx);
    const body = ctx.body;
    const updates = {};

    if (body.displayName !== undefined) updates.display_name = validateDisplayName(body.displayName);
    if (body.username !== undefined) {
      const next = normalizeUsername(body.username);
      if (next !== user.username) updates.username = validateUsername(next);
    }
    if (body.bio !== undefined) updates.bio = cleanText(body.bio, 220);
    if (body.link !== undefined) updates.link = validateLink(body.link);
    if (body.pronouns !== undefined) updates.pronouns = cleanLine(body.pronouns, 30);
    if (body.theme !== undefined) {
      assert(['system', 'light', 'dark'].includes(body.theme), 400, 'Geçersiz tema.');
      updates.theme = body.theme;
    }
    if (body.settings !== undefined && body.settings && typeof body.settings === 'object') {
      const current = parseSettings(user);
      const allowed = ['notifications', 'reduceMotion', 'storyAutoAdvance'];
      const next = { ...current };
      for (const key of allowed) {
        if (typeof body.settings[key] === 'boolean') next[key] = body.settings[key];
      }
      updates.settings = JSON.stringify(next);
    }

    const oldMediaRows = [];
    for (const [field, column, oldId] of [
      ['avatar', 'avatar_media', user.avatar_media],
      ['cover', 'cover_media', user.cover_media],
    ]) {
      if (body[field] === undefined) continue;
      if (body[field] === null) {
        updates[column] = null;
        if (oldId) oldMediaRows.push(get('SELECT * FROM media WHERE id = ?', oldId));
      } else {
        const media = get('SELECT * FROM media WHERE id = ?', String(body[field]));
        assert(media && media.owner_id === user.id, 400, 'Geçersiz görsel.');
        assert(media.kind === 'image', 400, 'Profil görseli bir resim olmalı.');
        updates[column] = media.id;
        run('UPDATE media SET attached = 1 WHERE id = ?', media.id);
        if (oldId && oldId !== media.id) oldMediaRows.push(get('SELECT * FROM media WHERE id = ?', oldId));
      }
    }

    if (Object.keys(updates).length) {
      const setSql = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
      run(
        `UPDATE users SET ${setSql} WHERE id = ?`,
        ...Object.values(updates),
        user.id,
      );
    }

    for (const media of oldMediaRows.filter(Boolean)) {
      const refs = get(
        `SELECT (SELECT COUNT(*) FROM users WHERE avatar_media = ? OR cover_media = ?) +
                (SELECT COUNT(*) FROM post_media WHERE media_id = ?) +
                (SELECT COUNT(*) FROM stories WHERE media_id = ?) +
                (SELECT COUNT(*) FROM messages WHERE media_id = ?) AS n`,
        media.id, media.id, media.id, media.id, media.id,
      );
      if (Number(refs.n) === 0) {
        run('DELETE FROM media WHERE id = ?', media.id);
        await removeMediaFiles(media);
      }
    }

    const fresh = getUserById(user.id);
    broadcast('profile:update', { user: briefUser(fresh) });
    return { user: meOut(fresh), invite: inviteInfo() };
  });

  router.post('/api/me/password', async (ctx) => {
    const user = requireUser(ctx);
    const problem = passwordProblem(ctx.body.newPassword);
    assert(!problem, 400, problem || 'Geçersiz şifre.');
    const valid = await verifyPassword(String(ctx.body.currentPassword ?? ''), user.password_hash);
    assert(valid, 403, 'Mevcut şifre hatalı.', 'bad_password');
    const hash = await hashPassword(ctx.body.newPassword);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
    createSession(user.id, ctx.req, ctx.res);
    return { ok: true };
  });

  router.get('/api/me/sessions', (ctx) => {
    const user = requireUser(ctx);
    return {
      sessions: sessionListFor(user.id).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        userAgent: row.user_agent,
        ip: row.ip,
        current: row.id === ctx.auth.session.id,
      })),
    };
  });

  router.delete('/api/me/sessions/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', ctx.params.id, user.id);
    assert(row, 404, 'Oturum bulunamadı.');
    run('DELETE FROM sessions WHERE id = ?', row.id);
    if (row.id === ctx.auth.session.id) destroyCurrentSession(ctx.req, ctx.res);
    return { ok: true };
  });

  router.delete('/api/me/sessions', (ctx) => {
    const user = requireUser(ctx);
    run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', user.id, ctx.auth.session.id);
    return { ok: true };
  });

  /* ----------------------------------------------------------------- export */

  router.get('/api/me/export', (ctx) => {
    const user = requireUser(ctx);
    const posts = all('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at', user.id);
    const postIds = posts.map((post) => post.id);
    const data = {
      exportedAt: nowIso(),
      app: config.appName,
      version: config.version,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        link: user.link,
        pronouns: user.pronouns,
        createdAt: user.created_at,
        settings: parseSettings(user),
      },
      follows: {
        followers: all(
          `SELECT u.username, u.display_name AS displayName FROM follows f
             JOIN users u ON u.id = f.follower_id WHERE f.following_id = ?`,
          user.id,
        ),
        following: all(
          `SELECT u.username, u.display_name AS displayName FROM follows f
             JOIN users u ON u.id = f.following_id WHERE f.follower_id = ?`,
          user.id,
        ),
      },
      posts,
      postMedia: postIds.length
        ? all(
            `SELECT pm.* FROM post_media pm WHERE pm.post_id IN (${postIds.map(() => '?').join(',')})`,
            ...postIds,
          )
        : [],
      media: all('SELECT * FROM media WHERE owner_id = ? ORDER BY created_at', user.id),
      comments: all('SELECT * FROM comments WHERE user_id = ? ORDER BY created_at', user.id),
      stories: all('SELECT * FROM stories WHERE user_id = ? ORDER BY created_at', user.id),
      messages: all(
        'SELECT * FROM messages WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at',
        user.id,
        user.id,
      ),
      likes: all('SELECT * FROM likes WHERE user_id = ?', user.id),
      saves: all('SELECT * FROM saves WHERE user_id = ?', user.id),
      notifications: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at', user.id),
      note: 'Medya dosyaları data/media klasöründe bulunur. Dosya adları media[].path alanındadır.',
    };

    const payload = Buffer.from(JSON.stringify(data, null, 2));
    ctx.res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="melcandy-${user.username}-${new Date().toISOString().slice(0, 10)}.json"`,
      'Content-Length': payload.length,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(payload);
    return undefined;
  });

  router.delete('/api/me', async (ctx) => {
    const user = requireUser(ctx);
    const valid = await verifyPassword(String(ctx.body.password ?? ''), user.password_hash);
    assert(valid, 403, 'Şifre hatalı.', 'bad_password');
    const mediaRows = all('SELECT * FROM media WHERE owner_id = ?', user.id);
    run('DELETE FROM users WHERE id = ?', user.id);
    for (const row of mediaRows) await removeMediaFiles(row);
    destroyCurrentSession(ctx.req, ctx.res);
    broadcast('users:update', { userId: user.id, deleted: true });
    return { ok: true };
  });

  /* ------------------------------------------------------------------- stats */

  router.get('/api/stats', async (ctx) => {
    requireUser(ctx);
    const storage = await storageStats();
    let dbBytes = 0;
    try {
      dbBytes = (await fsp.stat(DB_PATH)).size;
    } catch {
      /* yoksa 0 */
    }
    return {
      app: config.appName,
      version: config.version,
      node: process.version,
      uptime: Math.floor(process.uptime()),
      storage: {
        ...storage,
        dbBytes,
        mediaCount: Number(get('SELECT COUNT(*) AS n FROM media').n),
      },
      counts: {
        posts: Number(get('SELECT COUNT(*) AS n FROM posts').n),
        messages: Number(get('SELECT COUNT(*) AS n FROM messages').n),
        users: countUsers(),
      },
      online: onlineUserIds(),
      memory: process.memoryUsage().rss,
      maxUploadMb: {
        image: Math.round(config.maxImageBytes / 1024 / 1024),
        video: Math.round(config.maxVideoBytes / 1024 / 1024),
        audio: Math.round(config.maxAudioBytes / 1024 / 1024),
      },
    };
  });
}
