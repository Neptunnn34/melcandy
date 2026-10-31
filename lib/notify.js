import { get, run } from './db.js';
import { badgeCounts, loadNotification, notificationOut } from './present.js';
import { sendTo } from './realtime.js';
import { nowIso, uid } from './util.js';

export function removeNotifications({ userId, actorId, type, entityId }) {
  run(
    `DELETE FROM notifications
      WHERE user_id = ? AND type = ? AND actor_id = ? AND (entity_id = ? OR (? IS NULL AND entity_id IS NULL))`,
    userId,
    type,
    actorId,
    entityId ?? null,
    entityId ?? null,
  );
}

export function notify(userId, actorId, type, extra = {}) {
  if (!userId || !actorId) return null;
  if (type !== 'friend_request' && type !== 'friend_accept') {
    if (userId === actorId) return null;
  }
  const entityId = extra.entityId ?? extra.requestId ?? null;
  const postId = extra.postId ?? null;
  const meta = extra.meta ?? {};
  try {
    if (type === 'friend_request' || type === 'friend_accept') {
      const existing = get(
        `SELECT id FROM notifications
           WHERE user_id = ? AND actor_id = ? AND type = ? AND COALESCE(entity_id,'') = COALESCE(?, '')
           AND read_at IS NULL
           LIMIT 1`,
        userId,
        actorId,
        type,
        entityId,
      );
      if (existing) return null;
    }
  } catch {
    /* ignore */
  }
  const id = uid(12);
  try {
    run(
      `INSERT INTO notifications (id, user_id, actor_id, type, entity_id, post_id, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      actorId,
      type,
      entityId,
      postId,
      JSON.stringify(meta),
      nowIso(),
    );
    const row = loadNotification(id);
    if (row) sendTo(userId, 'notification', { notification: notificationOut(row) });
    pushBadges(userId);
    return row ? notificationOut(row) : null;
  } catch {
    pushBadges(userId);
    return null;
  }
}

export function badgesFor(userId) {
  return badgeCounts(userId);
}

export function pushBadges(userId) {
  try {
    sendTo(userId, 'badges', badgeCounts(userId));
  } catch {
    /* ignore */
  }
}
