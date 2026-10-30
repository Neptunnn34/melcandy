import { all, get } from './db.js';
import { mediaOut } from './media.js';
import { isOnline } from './realtime.js';
import { safeJsonParse } from './util.js';

export function briefUser(row) {
  if (!row) return null;
  let activity = null;
  try {
    const id = row.id || row.user_id || row.uid;
    if (id) {
      const ua = get('SELECT * FROM user_activity WHERE user_id = ?', id);
      if (ua && ua.type && ua.type !== 'none') {
        const now = Date.now();
        if (!ua.expires_at || ua.expires_at > now) {
          activity = {
            type: ua.type,
            title: ua.title,
            subtitle: ua.subtitle,
            image: ua.image,
            url: ua.url,
            updatedAt: ua.updated_at,
          };
        }
      }
    }
  } catch {
    /* ignore */
  }
  return {
    id: row.id || row.user_id || row.uid,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar_media || null,
    online: isOnline(row.id || row.user_id || row.uid),
    activity,
  };
}

export function userOut(user, extra = {}) {
  let activity = null;
  try {
    const ua = get('SELECT * FROM user_activity WHERE user_id = ?', user.id);
    if (ua && ua.type && ua.type !== 'none') {
      const now = Date.now();
      if (!ua.expires_at || ua.expires_at > now) {
        activity = {
          type: ua.type,
          title: ua.title,
          subtitle: ua.subtitle,
          image: ua.image,
          url: ua.url,
          updatedAt: ua.updated_at,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    bio: user.bio || '',
    link: user.link || '',
    pronouns: user.pronouns || '',
    avatar: user.avatar_media || null,
    cover: user.cover_media || null,
    theme: user.theme || 'system',
    settings: safeJsonParse(user.settings, {}),
    approved: Boolean(user.approved),
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at || null,
    online: isOnline(user.id),
    activity,
    ...extra,
  };
}

export function countFor(table, userId, extraWhere = '', extraParams = []) {
  const row = get(
    `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? ${extraWhere}`,
    userId,
    ...extraParams,
  );
  return Number(row?.n || 0);
}

const FEED_COLUMNS = `
  p.*,
  u.username, u.display_name, u.avatar_media,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted = 0) AS comment_count,
  EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked,
  EXISTS(SELECT 1 FROM saves s WHERE s.post_id = p.id AND s.user_id = ?) AS saved
`;

export function feedSql(where, extra = '', columns = FEED_COLUMNS) {
  return `SELECT ${columns}
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE ${where}
    ORDER BY p.created_at DESC, p.id DESC ${extra}`;
}

export function hydratePosts(rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');

  const mediaRows = all(
    `SELECT pm.post_id, m.* FROM post_media pm
       JOIN media m ON m.id = pm.media_id
      WHERE pm.post_id IN (${placeholders})
      ORDER BY pm.post_id, pm.position`,
    ...ids,
  );
  const mediaByPost = new Map();
  for (const media of mediaRows) {
    if (!mediaByPost.has(media.post_id)) mediaByPost.set(media.post_id, []);
    mediaByPost.get(media.post_id).push(mediaOut(media));
  }

  const topRows = all(
    `SELECT * FROM (
       SELECT c.id, c.post_id, c.body, c.created_at, c.user_id,
              u.username, u.display_name, u.avatar_media,
              ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS rn
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.post_id IN (${placeholders}) AND c.deleted = 0 AND c.parent_id IS NULL
     ) WHERE rn <= 2`,
    ...ids,
  );
  const topByPost = new Map();
  for (const comment of topRows) {
    if (!topByPost.has(comment.post_id)) topByPost.set(comment.post_id, []);
    topByPost.get(comment.post_id).push({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      user: briefUser(comment),
    });
  }
  for (const list of topByPost.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    caption: row.caption,
    location: row.location,
    altText: row.alt_text,
    music: row.music,
    archived: Boolean(row.archived),
    commentsDisabled: Boolean(row.comments_disabled),
    likesHidden: Boolean(row.likes_hidden),
    createdAt: row.created_at,
    user: briefUser(row),
    media: mediaByPost.get(row.id) || [],
    likeCount: Number(row.like_count || 0),
    commentCount: Number(row.comment_count || 0),
    liked: Boolean(row.liked),
    saved: Boolean(row.saved),
    mine: row.user_id === viewerId,
    topComments: topByPost.get(row.id) || [],
  }));
}

export function loadPosts({ viewerId, where, whereParams = [], extra = '', limit = 12 }) {
  const rows = all(feedSql(where, extra), viewerId, viewerId, ...whereParams);
  return rows;
}

export function commentOut(row, viewerId) {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id || null,
    body: row.deleted ? '' : row.body,
    deleted: Boolean(row.deleted),
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    user: briefUser(row),
    likeCount: Number(row.like_count || 0),
    liked: Boolean(row.liked),
    mine: row.user_id === viewerId,
  };
}

export function loadComments(postId, viewerId) {
  const rows = all(
    `SELECT c.*, u.username, u.display_name, u.avatar_media,
            (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
            EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC`,
    viewerId,
    postId,
  );
  return rows.map((row) => commentOut(row, viewerId));
}

export function notificationOut(row) {
  let thumb = null;
  if (row.post_id) {
    const media = get(
      `SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id
        WHERE pm.post_id = ? ORDER BY pm.position LIMIT 1`,
      row.post_id,
    );
    if (media) thumb = mediaOut(media);
  }
  return {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    read: Boolean(row.read_at),
    entityId: row.entity_id || null,
    postId: row.post_id || null,
    meta: safeJsonParse(row.meta, {}),
    actor: briefUser(row),
    thumb,
  };
}

export function loadNotification(id) {
  return get(
    `SELECT n.*, u.username, u.display_name, u.avatar_media
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.id = ?`,
    id,
  );
}

export function messageOut(row, viewerId) {
  return {
    id: row.id,
    body: row.deleted_at ? '' : row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deleted: Boolean(row.deleted_at),
    seenAt: row.seen_at || null,
    sender: {
      id: row.sender_id,
      username: row.username || '',
      displayName: row.display_name || '',
      avatar: row.avatar_media || null,
      online: isOnline(row.sender_id),
    },
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    mine: row.sender_id === viewerId,
    media: row.media_id
      ? mediaOut(
          get(
            'SELECT * FROM media WHERE id = ?',
            row.media_id,
          ),
        )
      : null,
    sticker: row.deleted_at
      ? null
      : (row.sticker_emoji || row.sticker_media_id)
        ? {
            emoji: row.sticker_emoji || null,
            media: row.sticker_media_id
              ? mediaOut(get('SELECT * FROM media WHERE id = ?', row.sticker_media_id))
              : null,
          }
        : null,
    replyTo: row.reply_to_id
      ? (() => {
          const parent = get('SELECT * FROM messages WHERE id = ?', row.reply_to_id);
          if (!parent) return null;
          const parentUser = get('SELECT username, display_name FROM users WHERE id = ?', parent.sender_id);
          return {
            id: parent.id,
            body: parent.deleted_at ? '' : parent.body,
            username: parentUser?.username || '',
            hasMedia: Boolean(parent.media_id),
            hasSticker: Boolean(parent.sticker_emoji || parent.sticker_media_id),
            stickerEmoji: parent.sticker_emoji || null,
          };
        })()
      : null,
  };
}

export function threadMessages(viewerId, partnerId, { before = null, limit = 40, after = null } = {}) {
  const params = [viewerId, partnerId, partnerId, viewerId];
  let extra = '';
  if (before) {
    extra += ' AND m.created_at < ?';
    params.push(before);
  }
  if (after) {
    extra += ' AND m.created_at > ?';
    params.push(after);
  }
  params.push(limit);

  const rows = all(
    `SELECT m.*, u.username, u.display_name, u.avatar_media
       FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
        ${extra}
      ORDER BY m.created_at DESC LIMIT ?`,
    ...params,
  ).reverse();

  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactions = all(
    `SELECT * FROM message_reactions WHERE message_id IN (${placeholders})`,
    ...ids,
  );
  const byMessage = new Map();
  for (const reaction of reactions) {
    if (!byMessage.has(reaction.message_id)) byMessage.set(reaction.message_id, []);
    byMessage.get(reaction.message_id).push({ userId: reaction.user_id, emoji: reaction.emoji });
  }

  return rows.map((row) => ({
    ...messageOut(row, viewerId),
    reactions: byMessage.get(row.id) || [],
  }));
}

export function unreadMessageCount(userId, partnerId = null) {
  const row = partnerId
    ? get(
        `SELECT COUNT(*) AS n FROM messages
          WHERE recipient_id = ? AND sender_id = ? AND seen_at IS NULL AND deleted_at IS NULL`,
        userId,
        partnerId,
      )
    : get(
        `SELECT COUNT(*) AS n FROM messages
          WHERE recipient_id = ? AND seen_at IS NULL AND deleted_at IS NULL`,
        userId,
      );
  return Number(row?.n || 0);
}

export function followCounts(userId) {
  const followers = get('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?', userId);
  const following = get('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', userId);
  return {
    followers: Number(followers?.n || 0),
    following: Number(following?.n || 0),
  };
}

export function badgeCounts(userId) {
  const notifications = get(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    userId,
  );
  const messages = unreadMessageCount(userId);
  const stories = get(
    `SELECT COUNT(*) AS n FROM stories s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id <> ? AND u.approved = 1 AND s.expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = ?)`,
    userId,
    new Date().toISOString(),
    userId,
  );
  const friendRequests = get(
    "SELECT COUNT(*) AS n FROM friend_requests WHERE to_id = ? AND status = 'pending'",
    userId,
  );
  return {
    notifications: Number(notifications.n || 0),
    messages: Number(messages || 0),
    stories: Number(stories.n || 0),
    requests: Number(friendRequests?.n || 0),
  };
}

export function storyOut(row, viewerId, { includeViewers = false } = {}) {
  const viewCount = get('SELECT COUNT(*) AS n FROM story_views WHERE story_id = ?', row.id);
  const viewed = Boolean(
    get('SELECT 1 AS v FROM story_views WHERE story_id = ? AND user_id = ?', row.id, viewerId),
  );
  let viewers = null;
  if (includeViewers) {
    viewers = all(
      `SELECT u.id, u.username, u.display_name, u.avatar_media, v.viewed_at
         FROM story_views v JOIN users u ON u.id = v.user_id
        WHERE v.story_id = ? ORDER BY v.viewed_at DESC`,
      row.id,
    ).map((viewer) => ({ ...briefUser(viewer), viewedAt: viewer.viewed_at }));
  }
  return {
    id: row.id,
    caption: row.caption,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    mine: row.user_id === viewerId,
    viewed,
    viewCount: Number(viewCount.n || 0),
    media: mediaOut(get('SELECT * FROM media WHERE id = ?', row.media_id)),
    viewers,
  };
}
