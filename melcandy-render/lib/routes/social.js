import { all, get, run } from '../db.js';
import { mediaOut, removeMediaFiles } from '../media.js';
import {
  badgeCounts,
  briefUser,
  feedSql,
  followCounts,
  hydratePosts,
  messageOut,
  notificationOut,
  threadMessages,
  unreadMessageCount,
  userOut,
} from '../present.js';
import { addClient, broadcast, onlineUserIds, removeClient, sendTo } from '../realtime.js';
import {
  assert,
  cleanText,
  HttpError,
  nowIso,
  rateLimit,
  uid,
} from '../util.js';
import { approvedUserByUsername, clampLimit, requireUser } from '../api-helpers.js';
import { notify, pushBadges } from '../notify.js';

function threadRow(id) {
  return get(
    `SELECT m.*, u.username, u.display_name, u.avatar_media
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
    id,
  );
}

function stickerOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label || '',
    createdAt: row.created_at,
    media: mediaOut(get('SELECT * FROM media WHERE id = ?', row.media_id)),
  };
}

function conversationTarget(viewer, username) {
  const target = approvedUserByUsername(username);
  if (target.id === viewer.id) {
    throw new HttpError(400, 'Kendine mesaj gönderemezsin.', 'self_thread');
  }
  return target;
}

function followState(viewerId, targetId) {
  if (viewerId === targetId) return { isFollowing: false, followsMe: false };
  return {
    isFollowing: Boolean(
      get('SELECT 1 AS v FROM follows WHERE follower_id = ? AND following_id = ?', viewerId, targetId),
    ),
    followsMe: Boolean(
      get('SELECT 1 AS v FROM follows WHERE follower_id = ? AND following_id = ?', targetId, viewerId),
    ),
  };
}

export function registerSocialRoutes(router) {
  /* -------------------------------------------------------------------- users */

  router.get('/api/users', (ctx) => {
    requireUser(ctx);
    return {
      users: all('SELECT * FROM users WHERE approved = 1 ORDER BY created_at ASC').map(briefUser),
      online: onlineUserIds(),
    };
  });

  router.get('/api/users/:username', (ctx) => {
    const viewer = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);

    const limit = clampLimit(ctx.query.get('limit'), 24, 60);
    const cursor = ctx.query.get('cursor');
    const where = ['p.user_id = ?', 'p.archived = 0'];
    const params = [target.id];
    if (cursor) {
      const [ts, id] = String(cursor).split('|');
      if (ts) {
        where.push(id ? '(p.created_at < ? OR (p.created_at = ? AND p.id < ?))' : 'p.created_at < ?');
        if (id) params.push(ts, ts, id);
        else params.push(ts);
      }
    }

    const rows = all(
      feedSql(where.join(' AND '), 'LIMIT ?'),
      viewer.id,
      viewer.id,
      ...params,
      limit + 1,
    );
    const hasMore = rows.length > limit;
    const items = hydratePosts(rows.slice(0, limit), viewer.id);
    const last = items[items.length - 1];

    const profile = userOut(target, {
      counts: {
        posts: Number(get(`SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND archived = 0`, target.id).n),
        ...followCounts(target.id),
        likes: Number(get(
          `SELECT COUNT(*) AS n FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?`,
          target.id,
        ).n),
        media: Number(get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND archived = 0', target.id).n),
      },
      isMe: target.id === viewer.id,
      ...followState(viewer.id, target.id),
    });
    if (target.id !== viewer.id) delete profile.settings;
    delete profile.lastSeenAt;

    return {
      user: profile,
      posts: items,
      nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null,
    };
  });

  /* ------------------------------------------------------------------ follow */

  router.post('/api/users/:username/follow', (ctx) => {
    const viewer = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    assert(target.id !== viewer.id, 400, 'Kendini takip edemezsin.');
    run(
      `INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`,
      viewer.id,
      target.id,
      nowIso(),
    );
    notify(target.id, viewer.id, 'follow', { entityId: viewer.id });
    sendTo(target.id, 'follow:update', { user: briefUser(viewer), following: true });
    sendTo(viewer.id, 'follow:update', { user: briefUser(target), following: true });
    return { following: true, counts: followCounts(target.id) };
  });

  router.delete('/api/users/:username/follow', (ctx) => {
    const viewer = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', viewer.id, target.id);
    run(
      `DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'follow'`,
      target.id,
      viewer.id,
    );
    sendTo(target.id, 'follow:update', { user: briefUser(viewer), following: false });
    sendTo(viewer.id, 'follow:update', { user: briefUser(target), following: false });
    pushBadges(target.id);
    return { following: false, counts: followCounts(target.id) };
  });

  router.get('/api/users/:username/followers', (ctx) => {
    const viewer = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    const rows = all(
      `SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
        WHERE f.following_id = ? AND u.approved = 1
        ORDER BY f.created_at DESC`,
      target.id,
    );
    return {
      users: rows.map((row) => ({
        ...briefUser(row),
        ...followState(viewer.id, row.id),
        isMe: row.id === viewer.id,
      })),
    };
  });

  router.get('/api/users/:username/following', (ctx) => {
    const viewer = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    const rows = all(
      `SELECT u.* FROM follows f JOIN users u ON u.id = f.following_id
        WHERE f.follower_id = ? AND u.approved = 1
        ORDER BY f.created_at DESC`,
      target.id,
    );
    return {
      users: rows.map((row) => ({
        ...briefUser(row),
        ...followState(viewer.id, row.id),
        isMe: row.id === viewer.id,
      })),
    };
  });

  /* --------------------------------------------------------------- stickers */

  router.get('/api/stickers', (ctx) => {
    const user = requireUser(ctx);
    const rows = all(
      'SELECT * FROM stickers WHERE user_id = ? ORDER BY created_at DESC LIMIT 80',
      user.id,
    );
    return { stickers: rows.map(stickerOut).filter((sticker) => sticker?.media) };
  });

  router.post('/api/stickers', (ctx) => {
    const user = requireUser(ctx);
    const media = get('SELECT * FROM media WHERE id = ?', String(ctx.body.mediaId || ''));
    assert(media && media.owner_id === user.id, 400, 'Geçersiz medya.');
    assert(media.kind === 'image', 400, 'Sticker yalnızca görsel olabilir.');
    assert(!media.attached, 409, 'Bu görsel zaten başka bir yerde kullanılıyor.');
    const count = Number(get('SELECT COUNT(*) AS n FROM stickers WHERE user_id = ?', user.id).n);
    assert(count < 80, 400, 'En fazla 80 sticker kaydedebilirsin.');
    const id = uid(12);
    run(
      'INSERT INTO stickers (id, user_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      user.id,
      media.id,
      String(ctx.body.label || '').trim().slice(0, 60),
      nowIso(),
    );
    return { sticker: stickerOut(get('SELECT * FROM stickers WHERE id = ?', id)) };
  });

  router.delete('/api/stickers/:id', async (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM stickers WHERE id = ? AND user_id = ?', ctx.params.id, user.id);
    assert(row, 404, 'Sticker bulunamadı.');
    run('DELETE FROM stickers WHERE id = ?', row.id);
    const media = get('SELECT * FROM media WHERE id = ?', row.media_id);
    if (media && !media.attached) {
      const refs = get(
        `SELECT
          (SELECT COUNT(*) FROM messages WHERE sticker_media_id = ?) +
          (SELECT COUNT(*) FROM stickers WHERE media_id = ?) AS n`,
        media.id,
        media.id,
      );
      if (Number(refs.n) === 0) {
        run('DELETE FROM media WHERE id = ?', media.id);
        await removeMediaFiles(media);
      }
    }
    return { ok: true };
  });

  /* ----------------------------------------------------------- conversations */

  router.get('/api/conversations', (ctx) => {
    const user = requireUser(ctx);
    const peers = all(
      `SELECT u.*, MAX(m.created_at) AS last_at
         FROM messages m
         JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.recipient_id ELSE m.sender_id END
        WHERE (m.sender_id = ? OR m.recipient_id = ?) AND u.approved = 1
        GROUP BY u.id
        ORDER BY last_at DESC`,
      user.id,
      user.id,
      user.id,
    );
    const conversations = peers.map((peer) => {
      const last = get(
        `SELECT m.*, su.username, su.display_name, su.avatar_media
           FROM messages m JOIN users su ON su.id = m.sender_id
          WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)
          ORDER BY m.created_at DESC LIMIT 1`,
        user.id, peer.id, peer.id, user.id,
      );
      return {
        user: { ...briefUser(peer), lastSeenAt: peer.last_seen_at },
        lastMessage: last ? messageOut(last, user.id) : null,
        unreadCount: unreadMessageCount(user.id, peer.id),
        lastAt: peer.last_at,
      };
    });
    return { conversations, unreadCount: unreadMessageCount(user.id) };
  });

  router.get('/api/conversations/:username/messages', (ctx) => {
    const user = requireUser(ctx);
    const peer = conversationTarget(user, ctx.params.username);
    const limit = clampLimit(ctx.query.get('limit'), 30, 60);
    const before = ctx.query.get('before') || null;
    const list = threadMessages(user.id, peer.id, { before, limit: limit + 1 });
    const hasMore = list.length > limit;
    const messages = hasMore ? list.slice(1) : list;
    return {
      messages,
      hasMore,
      nextBefore: hasMore ? messages[0]?.createdAt || null : null,
      unreadCount: unreadMessageCount(user.id, peer.id),
      user: { ...briefUser(peer), lastSeenAt: peer.last_seen_at },
    };
  });

  router.post('/api/conversations/:username/messages', (ctx) => {
    const user = requireUser(ctx);
    const peer = conversationTarget(user, ctx.params.username);
    const limit = rateLimit(`msg:${user.id}`, 120, 5 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Çok hızlı mesaj gönderiyorsun.', 'rate_limited');

    const body = cleanText(ctx.body.body, 2000);
    let media = null;
    if (ctx.body.mediaId) {
      media = get('SELECT * FROM media WHERE id = ?', String(ctx.body.mediaId));
      assert(media && media.owner_id === user.id, 400, 'Geçersiz medya.');
      assert(!media.attached, 409, 'Bu medya zaten kullanılıyor.');
      assert(['image', 'video', 'audio'].includes(media.kind), 400, 'Geçersiz medya türü.');
    }

    const stickerEmoji = cleanText(ctx.body.stickerEmoji, 12);
    let stickerMedia = null;
    if (ctx.body.stickerMediaId) {
      const sticker = get(
        'SELECT * FROM stickers WHERE id = ? AND user_id = ?',
        String(ctx.body.stickerMediaId),
        user.id,
      );
      assert(sticker, 400, 'Sticker bulunamadı.');
      stickerMedia = get('SELECT * FROM media WHERE id = ?', sticker.media_id);
      assert(stickerMedia, 400, 'Sticker görseli bulunamadı.');
    }
    assert(body.length >= 1 || media || stickerEmoji || stickerMedia, 400, 'Mesaj boş olamaz.');
    assert(!(media && stickerMedia), 400, 'Aynı mesajda medya ve sticker gönderemezsin.');

    let replyTo = null;
    if (ctx.body.replyToId) {
      replyTo = get(
        `SELECT * FROM messages WHERE id = ?
           AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`,
        String(ctx.body.replyToId), user.id, peer.id, peer.id, user.id,
      );
      assert(replyTo, 400, 'Yanıtlanan mesaj bulunamadı.');
    }

    const id = uid(12);
    run(
      `INSERT INTO messages (id, sender_id, recipient_id, body, media_id, sticker_media_id, sticker_emoji, reply_to_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      user.id,
      peer.id,
      body,
      media?.id || null,
      stickerMedia?.id || null,
      stickerEmoji || null,
      replyTo?.id || null,
      nowIso(),
    );
    if (media) run('UPDATE media SET attached = 1 WHERE id = ?', media.id);

    const row = threadRow(id);
    sendTo(peer.id, 'message:new', { message: messageOut(row, peer.id) });
    sendTo(user.id, 'message:new', { message: messageOut(row, user.id) });
    pushBadges(peer.id);
    return { message: messageOut(row, user.id) };
  });

  router.patch('/api/messages/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM messages WHERE id = ?', ctx.params.id);
    assert(row && row.sender_id === user.id && !row.deleted_at, 404, 'Mesaj bulunamadı.');
    const body = cleanText(ctx.body.body, 2000);
    assert(body.length >= 1 || row.media_id || row.sticker_media_id || row.sticker_emoji, 400, 'Mesaj boş olamaz.');
    run('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', body, nowIso(), row.id);
    const fresh = threadRow(row.id);
    sendTo(user.id, 'message:update', { message: messageOut(fresh, user.id) });
    sendTo(row.recipient_id, 'message:update', { message: messageOut(fresh, row.recipient_id) });
    return { message: messageOut(fresh, user.id) };
  });

  router.delete('/api/messages/:id', async (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM messages WHERE id = ?', ctx.params.id);
    assert(row && row.sender_id === user.id && !row.deleted_at, 404, 'Mesaj bulunamadı.');
    const media = row.media_id ? get('SELECT * FROM media WHERE id = ?', row.media_id) : null;
    run(
      'UPDATE messages SET deleted_at = ?, body = ?, media_id = NULL, sticker_media_id = NULL, sticker_emoji = NULL WHERE id = ?',
      nowIso(),
      '',
      row.id,
    );
    if (media) {
      run('DELETE FROM media WHERE id = ?', media.id);
      await removeMediaFiles(media);
    }
    broadcast('message:delete', { id: row.id });
    return { ok: true };
  });

  router.post('/api/messages/:id/react', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM messages WHERE id = ?', ctx.params.id);
    assert(row && (row.sender_id === user.id || row.recipient_id === user.id), 404, 'Mesaj bulunamadı.');
    const emoji = cleanText(ctx.body.emoji, 8);
    assert(emoji.length >= 1, 400, 'Tepki boş olamaz.');
    const existing = get(
      'SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ?',
      row.id,
      user.id,
    );
    if (existing && existing.emoji === emoji) {
      run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', row.id, user.id);
    } else {
      run(
        `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
        row.id,
        user.id,
        emoji,
        nowIso(),
      );
    }
    const reactions = all(
      'SELECT user_id AS userId, emoji FROM message_reactions WHERE message_id = ?',
      row.id,
    );
    broadcast('message:reaction', { messageId: row.id, reactions });
    return { reactions };
  });

  router.post('/api/conversations/:username/seen', (ctx) => {
    const user = requireUser(ctx);
    const peer = conversationTarget(user, ctx.params.username);
    const at = nowIso();
    run(
      `UPDATE messages SET seen_at = ?
        WHERE recipient_id = ? AND sender_id = ? AND seen_at IS NULL`,
      at,
      user.id,
      peer.id,
    );
    sendTo(peer.id, 'message:seen', { by: user.id, at });
    sendTo(user.id, 'message:seen', { by: user.id, at });
    pushBadges(user.id);
    return { ok: true, at };
  });

  router.post('/api/conversations/:username/typing', (ctx) => {
    const user = requireUser(ctx);
    const peer = conversationTarget(user, ctx.params.username);
    const limit = rateLimit(`typing:${user.id}`, 30, 60 * 1000);
    if (limit.ok) sendTo(peer.id, 'typing', { userId: user.id, from: briefUser(user), at: Date.now() });
    return { ok: true };
  });

  /* ------------------------------------------------------------- notifications */

  router.get('/api/notifications', (ctx) => {
    const user = requireUser(ctx);
    const limit = clampLimit(ctx.query.get('limit'), 30, 50);
    const before = ctx.query.get('before') || null;
    const params = [user.id];
    let extra = '';
    if (before) {
      extra = 'AND n.created_at < ?';
      params.push(before);
    }
    params.push(limit + 1);
    const rows = all(
      `SELECT n.*, u.username, u.display_name, u.avatar_media
         FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
        WHERE n.user_id = ? ${extra}
        ORDER BY n.created_at DESC LIMIT ?`,
      ...params,
    );
    const items = rows.slice(0, limit).map(notificationOut);
    return {
      items,
      nextCursor: rows.length > limit ? rows[limit - 1].created_at : null,
      badges: badgeCounts(user.id),
    };
  });

  router.post('/api/notifications/read', (ctx) => {
    const user = requireUser(ctx);
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.map(String).slice(0, 100) : null;
    if (ids && ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      run(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
        nowIso(),
        user.id,
        ...ids,
      );
    } else {
      run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), user.id);
    }
    return { ok: true, badges: badgeCounts(user.id) };
  });

  router.delete('/api/notifications/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', ctx.params.id, user.id);
    assert(row, 404, 'Bildirim bulunamadı.');
    run('DELETE FROM notifications WHERE id = ?', row.id);
    return { ok: true, badges: badgeCounts(user.id) };
  });

  router.get('/api/badges', (ctx) => {
    const user = requireUser(ctx);
    return { badges: badgeCounts(user.id), online: onlineUserIds() };
  });

  /* -------------------------------------------------------------------- events */

  router.get('/api/events', (ctx) => {
    const user = requireUser(ctx);
    const res = ctx.res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 2500\n\n`);
    addClient(user.id, res);
    res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now(), online: onlineUserIds() })}\n\n`);
    res.write(`event: badges\ndata: ${JSON.stringify(badgeCounts(user.id))}\n\n`);

    const cleanup = () => {
      removeClient(user.id, res);
      run('UPDATE users SET last_seen_at = ? WHERE id = ?', nowIso(), user.id);
      broadcast('presence', { online: onlineUserIds() });
    };
    ctx.req.on('close', cleanup);
    ctx.req.on('aborted', cleanup);
    return undefined;
  });
}
