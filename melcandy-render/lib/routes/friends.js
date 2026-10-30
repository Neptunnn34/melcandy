import { all, get, run } from '../db.js';
import { badgeCounts, briefUser } from '../present.js';
import { addClient, broadcast, onlineUserIds, removeClient, sendTo } from '../realtime.js';
import {
  assert,
  cleanText,
  HttpError,
  nowIso,
  rateLimit,
  uid,
} from '../util.js';
import { approvedUserByUsername, requireUser } from '../api-helpers.js';
import { notify, pushBadges } from '../notify.js';

function isFriend(a, b) {
  if (a === b) return true;
  const row = get(
    `SELECT 1 FROM friendships WHERE (user_id1 = ? AND user_id2 = ?) OR (user_id1 = ? AND user_id2 = ?)`,
    a,
    b,
    b,
    a,
  );
  return Boolean(row);
}

function getFriendRequest(id) {
  return get('SELECT * FROM friend_requests WHERE id = ?', id);
}

export function registerFriendRoutes(router) {
  router.get('/api/friends', (ctx) => {
    const user = requireUser(ctx);
    const incoming = all(
      `SELECT fr.*, u.username, u.display_name, u.avatar_media, u.last_seen_at
         FROM friend_requests fr
         JOIN users u ON u.id = fr.from_id
        WHERE fr.to_id = ? AND fr.status = 'pending'
        ORDER BY fr.created_at DESC`,
      user.id,
    ).map((row) => ({ ...row, from: briefUser(row) }));
    const outgoing = all(
      `SELECT fr.*, u.username, u.display_name, u.avatar_media, u.last_seen_at
         FROM friend_requests fr
         JOIN users u ON u.id = fr.to_id
        WHERE fr.from_id = ? AND fr.status = 'pending'
        ORDER BY fr.created_at DESC`,
      user.id,
    ).map((row) => ({ ...row, to: briefUser(row) }));
    const friends = all(
      `SELECT u.*, f.created_at AS friends_since
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id1 = ? THEN f.user_id2 ELSE f.user_id1 END
        WHERE (f.user_id1 = ? OR f.user_id2 = ?) AND u.approved = 1
        ORDER BY f.created_at DESC`,
      user.id,
      user.id,
      user.id,
    ).map((row) => ({ ...briefUser(row), lastSeenAt: row.last_seen_at, friendsSince: row.friends_since }));

    return {
      incoming,
      outgoing,
      friends,
      counts: {
        incoming: incoming.length,
        outgoing: outgoing.length,
        friends: friends.length,
      },
    };
  });

  router.post('/api/friends/request/:username', (ctx) => {
    const user = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    assert(target.id !== user.id, 400, 'Kendine arkadaşlık isteği gönderemezsin.');
    if (isFriend(user.id, target.id)) return { status: 'friends' };
    const limit = rateLimit(`fr:${user.id}`, 30, 10 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Çok hızlı arkadaşlık isteği gönderiyorsun.', 'rate_limited');

    const existing = get(
      `SELECT * FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)`,
      user.id,
      target.id,
      target.id,
      user.id,
    );
    if (existing) {
      if (existing.status === 'pending') {
        if (existing.to_id === user.id) {
          // karşı taraf zaten göndermiş, kabul edelim
          run(
            "UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?",
            nowIso(),
            existing.id,
          );
          const a = user.id < target.id ? user.id : target.id;
          const b = user.id < target.id ? target.id : user.id;
          run('INSERT OR IGNORE INTO friendships (user_id1, user_id2, created_at) VALUES (?, ?, ?)', a, b, nowIso());
          notify(target.id, user.id, 'friend_accept', { entityId: user.id, requestId: existing.id });
          notify(user.id, target.id, 'friend_accept', { entityId: target.id, requestId: existing.id });
          pushBadges(target.id);
          pushBadges(user.id);
          return { status: 'friends' };
        }
        return { status: 'pending_outgoing' };
      }
      if (existing.status === 'declined') {
        run(
          `UPDATE friend_requests SET status = 'pending', from_id = ?, to_id = ?, created_at = ?, responded_at = NULL WHERE id = ?`,
          user.id,
          target.id,
          nowIso(),
          existing.id,
        );
        notify(target.id, user.id, 'friend_request', { entityId: user.id, requestId: existing.id });
        pushBadges(target.id);
        return { status: 'pending_outgoing' };
      }
    }

    const id = uid(12);
    run(
      `INSERT INTO friend_requests (id, from_id, to_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
      id,
      user.id,
      target.id,
      nowIso(),
    );
    notify(target.id, user.id, 'friend_request', { entityId: user.id, requestId: id });
    pushBadges(target.id);
    return { status: 'pending_outgoing', id };
  });

  router.post('/api/friends/accept/:id', (ctx) => {
    const user = requireUser(ctx);
    const req = getFriendRequest(ctx.params.id);
    assert(req && req.to_id === user.id && req.status === 'pending', 404, 'Arkadaşlık isteği bulunamadı.');
    run("UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?", nowIso(), req.id);
    const a = req.from_id < req.to_id ? req.from_id : req.to_id;
    const b = req.from_id < req.to_id ? req.to_id : req.from_id;
    run('INSERT OR IGNORE INTO friendships (user_id1, user_id2, created_at) VALUES (?, ?, ?)', a, b, nowIso());
    notify(req.from_id, user.id, 'friend_accept', { entityId: user.id, requestId: req.id });
    pushBadges(req.from_id);
    pushBadges(user.id);
    return { ok: true };
  });

  router.post('/api/friends/decline/:id', (ctx) => {
    const user = requireUser(ctx);
    const req = getFriendRequest(ctx.params.id);
    assert(req && (req.to_id === user.id || req.from_id === user.id) && req.status === 'pending', 404, 'Arkadaşlık isteği bulunamadı.');
    run("UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE id = ?", nowIso(), req.id);
    if (req.to_id === user.id) pushBadges(user.id);
    if (req.from_id === user.id) pushBadges(req.to_id);
    return { ok: true };
  });

  router.delete('/api/friends/:username', (ctx) => {
    const user = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    assert(target.id !== user.id, 400, 'Kendini arkadaşlıktan çıkaramazsın.');
    run(
      `DELETE FROM friendships WHERE (user_id1 = ? AND user_id2 = ?) OR (user_id1 = ? AND user_id2 = ?)`,
      user.id,
      target.id,
      target.id,
      user.id,
    );
    run("UPDATE friend_requests SET status = 'declined', responded_at = ? WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND status = 'accepted'", nowIso(), user.id, target.id, target.id, user.id);
    pushBadges(user.id);
    pushBadges(target.id);
    return { ok: true };
  });

  router.get('/api/friends/status/:username', (ctx) => {
    const user = requireUser(ctx);
    const target = approvedUserByUsername(ctx.params.username);
    if (target.id === user.id) return { status: 'self' };
    if (isFriend(user.id, target.id)) return { status: 'friends' };
    const fr = get(
      `SELECT * FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY created_at DESC`,
      user.id,
      target.id,
      target.id,
      user.id,
    );
    if (!fr) return { status: 'none' };
    if (fr.status !== 'pending') return { status: fr.status === 'accepted' ? 'friends' : 'none' };
    if (fr.to_id === user.id) return { status: 'pending_incoming', id: fr.id };
    return { status: 'pending_outgoing', id: fr.id };
  });
}
