import { all, get, run, tx } from '../db.js';
import { mediaOut, removeMediaFiles } from '../media.js';
import {
  briefUser,
  commentOut,
  feedSql,
  hydratePosts,
  loadComments,
} from '../present.js';
import { broadcast, sendTo } from '../realtime.js';
import {
  assert,
  cleanLine,
  cleanText,
  extractMentions,
  HttpError,
  nowIso,
  rateLimit,
  uid,
} from '../util.js';
import { bool, clampLimit, requireUser } from '../api-helpers.js';
import { notify, pushBadges, removeNotifications } from '../notify.js';

function cursorFilter(where, params, cursor) {
  if (!cursor) return;
  const [ts, id] = String(cursor).split('|');
  if (!ts) return;
  where.push(
    id
      ? '(p.created_at < ? OR (p.created_at = ? AND p.id < ?))'
      : 'p.created_at < ?',
  );
  if (id) params.push(ts, ts, id);
  else params.push(ts);
}

function nextCursor(rows, limit) {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1];
  return `${last.created_at}|${last.id}`;
}

function fetchPosts(userId, whereParts, whereParams, limit) {
  const rows = all(
    feedSql(`${whereParts.join(' AND ')}`, 'LIMIT ?'),
    userId,
    userId,
    ...whereParams,
    limit + 1,
  );
  return { rows, cursor: nextCursor(rows, limit), items: hydratePosts(rows.slice(0, limit), userId) };
}

function singlePost(postId, viewerId) {
  const rows = all(feedSql('p.id = ?', ''), viewerId, viewerId, postId);
  return hydratePosts(rows, viewerId)[0] || null;
}

function getPostRow(postId) {
  return get('SELECT * FROM posts WHERE id = ?', postId);
}

function assertVisiblePost(post, user, { allowArchived = false } = {}) {
  if (!post) throw new HttpError(404, 'Gönderi bulunamadı.');
  if (post.archived && !allowArchived && post.user_id !== user.id) {
    throw new HttpError(404, 'Gönderi bulunamadı.');
  }
  return post;
}

function notifyMentions(text, actor, { postId, entityId, exclude = [] } = {}) {
  const excluded = new Set([actor.id, ...exclude]);
  for (const username of extractMentions(text)) {
    const target = get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
    if (!target || excluded.has(target.id)) continue;
    excluded.add(target.id);
    notify(target.id, actor.id, 'mention', { entityId, postId, meta: { text: cleanText(text, 140) } });
  }
}

function commentCount(postId) {
  return Number(get('SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND deleted = 0', postId).n);
}

export function registerPostRoutes(router) {
  /* --------------------------------------------------------------------- feed */

  router.get('/api/feed', (ctx) => {
    const user = requireUser(ctx);
    const limit = clampLimit(ctx.query.get('limit'), 8, 20);
    const where = ['p.archived = 0', "p.kind = 'post'"];
    const params = [];
    cursorFilter(where, params, ctx.query.get('cursor'));
    const { items, cursor } = fetchPosts(user.id, where, params, limit);
    return { items, nextCursor: cursor };
  });

  router.get('/api/saved', (ctx) => {
    const user = requireUser(ctx);
    const limit = clampLimit(ctx.query.get('limit'), 18, 40);
    const rows = all(
      `SELECT p.*, u.username, u.display_name, u.avatar_media,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted = 0) AS comment_count,
              1 AS liked,
              1 AS saved
         FROM saves s JOIN posts p ON p.id = s.post_id JOIN users u ON u.id = p.user_id
        WHERE s.user_id = ? AND p.archived = 0
        ORDER BY s.created_at DESC LIMIT ?`,
      user.id,
      limit + 1,
    );
    return {
      items: hydratePosts(rows.slice(0, limit), user.id),
      nextCursor: nextCursor(rows, limit),
    };
  });

  router.get('/api/archive', (ctx) => {
    const user = requireUser(ctx);
    const limit = clampLimit(ctx.query.get('limit'), 18, 40);
    const rows = all(
      feedSql("p.user_id = ? AND p.archived = 1", 'LIMIT ?'),
      user.id,
      user.id,
      user.id,
      limit,
    );
    return { items: hydratePosts(rows, user.id), nextCursor: null };
  });

  router.get('/api/memories', (ctx) => {
    const user = requireUser(ctx);
    const today = new Date();
    const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const cutoff = new Date(Date.now() - 300 * 86400000).toISOString();
    const rows = all(feedSql('p.archived = 0 AND p.created_at < ?', ''), user.id, user.id, cutoff)
      .filter((row) => row.created_at.slice(5, 10) === monthDay)
      .slice(0, 8);
    return { items: hydratePosts(rows, user.id), monthDay };
  });

  /* -------------------------------------------------------------------- posts */

  router.post('/api/posts', (ctx) => {
    const user = requireUser(ctx);
    const limit = rateLimit(`post:${user.id}`, 30, 10 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Çok hızlı paylaşım yapıyorsun. Biraz bekle.', 'rate_limited');

    const kind = 'post';
    const rawIds = Array.isArray(ctx.body.mediaIds) ? ctx.body.mediaIds.map(String) : [];
    const mediaIds = [...new Set(rawIds)];
    assert(mediaIds.length >= 1, 400, 'En az bir fotoğraf veya video seçmelisin.');
    assert(mediaIds.length <= 10, 400, 'En fazla 10 medya ekleyebilirsin.');

    const mediaRows = mediaIds.map((id) => {
      const row = get('SELECT * FROM media WHERE id = ?', id);
      assert(row && row.owner_id === user.id, 400, 'Geçersiz medya seçimi.');
      assert(!row.attached, 409, 'Bu medya zaten kullanılıyor.');
      return row;
    });

    assert(mediaRows.every((row) => row.kind === 'image' || row.kind === 'video'), 400, 'Geçersiz medya türü.');

    const caption = cleanText(ctx.body.caption, 2200);
    const location = cleanLine(ctx.body.location, 100);
    const altText = cleanText(ctx.body.altText, 1200);
    const music = cleanLine(ctx.body.music, 120);
    const commentsDisabled = bool(ctx.body.commentsDisabled) ? 1 : 0;
    const likesHidden = bool(ctx.body.likesHidden) ? 1 : 0;
    const id = uid(12);
    const createdAt = nowIso();

    tx(() => {
      run(
        `INSERT INTO posts (id, user_id, kind, caption, location, alt_text, music,
                            comments_disabled, likes_hidden, archived, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        id, user.id, kind, caption, location, altText, music, commentsDisabled, likesHidden, createdAt,
      );
      mediaRows.forEach((row, index) => {
        run('UPDATE media SET attached = 1 WHERE id = ?', row.id);
        run('INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, ?)', id, row.id, index);
      });
    });

    notifyMentions(caption, user, { postId: id, entityId: id });
    broadcast('post:new', { postId: id, user: briefUser(user), kind });
    return { post: singlePost(id, user.id) };
  });

  router.get('/api/posts/:id', (ctx) => {
    const user = requireUser(ctx);
    const post = assertVisiblePost(getPostRow(ctx.params.id), user);
    return { post: singlePost(post.id, user.id) };
  });

  router.patch('/api/posts/:id', (ctx) => {
    const user = requireUser(ctx);
    const post = getPostRow(ctx.params.id);
    assert(post && post.user_id === user.id, 404, 'Gönderi bulunamadı.');

    const updates = {};
    if (ctx.body.caption !== undefined) updates.caption = cleanText(ctx.body.caption, 2200);
    if (ctx.body.location !== undefined) updates.location = cleanLine(ctx.body.location, 100);
    if (ctx.body.altText !== undefined) updates.alt_text = cleanText(ctx.body.altText, 1200);
    if (ctx.body.music !== undefined) updates.music = cleanLine(ctx.body.music, 120);
    if (ctx.body.archived !== undefined) updates.archived = bool(ctx.body.archived) ? 1 : 0;
    if (ctx.body.commentsDisabled !== undefined) updates.comments_disabled = bool(ctx.body.commentsDisabled) ? 1 : 0;
    if (ctx.body.likesHidden !== undefined) updates.likes_hidden = bool(ctx.body.likesHidden) ? 1 : 0;

    if (Object.keys(updates).length) {
      run(
        `UPDATE posts SET ${Object.keys(updates).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
        ...Object.values(updates),
        post.id,
      );
    }
    if (updates.caption) notifyMentions(updates.caption, user, { postId: post.id, entityId: post.id });

    broadcast('post:update', { postId: post.id });
    return { post: singlePost(post.id, user.id) };
  });

  router.delete('/api/posts/:id', async (ctx) => {
    const user = requireUser(ctx);
    const post = getPostRow(ctx.params.id);
    assert(post && post.user_id === user.id, 404, 'Gönderi bulunamadı.');
    const mediaRows = all(
      'SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ?',
      post.id,
    );
    tx(() => {
      run('DELETE FROM posts WHERE id = ?', post.id);
      for (const media of mediaRows) run('DELETE FROM media WHERE id = ?', media.id);
    });
    for (const media of mediaRows) await removeMediaFiles(media);
    broadcast('post:delete', { postId: post.id });
    return { ok: true };
  });

  /* -------------------------------------------------------------------- likes */

  router.post('/api/posts/:id/like', (ctx) => {
    const user = requireUser(ctx);
    const post = assertVisiblePost(getPostRow(ctx.params.id), user);
    run('INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)', post.id, user.id, nowIso());
    const likeCount = Number(get('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', post.id).n);
    notify(post.user_id, user.id, 'like', { entityId: post.id, postId: post.id });
    broadcast('like', { postId: post.id, userId: user.id, liked: true, likeCount });
    return { liked: true, likeCount };
  });

  router.delete('/api/posts/:id/like', (ctx) => {
    const user = requireUser(ctx);
    const post = getPostRow(ctx.params.id);
    assert(post, 404, 'Gönderi bulunamadı.');
    run('DELETE FROM likes WHERE post_id = ? AND user_id = ?', post.id, user.id);
    removeNotifications({ userId: post.user_id, actorId: user.id, type: 'like', entityId: post.id });
    const likeCount = Number(get('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', post.id).n);
    broadcast('like', { postId: post.id, userId: user.id, liked: false, likeCount });
    return { liked: false, likeCount };
  });

  router.get('/api/posts/:id/likes', (ctx) => {
    const user = requireUser(ctx);
    const post = assertVisiblePost(getPostRow(ctx.params.id), user);
    const users = all(
      `SELECT u.* FROM likes l JOIN users u ON u.id = l.user_id
        WHERE l.post_id = ? ORDER BY l.created_at DESC`,
      post.id,
    ).map(briefUser);
    return { users };
  });

  router.post('/api/posts/:id/save', (ctx) => {
    const user = requireUser(ctx);
    const post = assertVisiblePost(getPostRow(ctx.params.id), user);
    run('INSERT OR IGNORE INTO saves (post_id, user_id, created_at) VALUES (?, ?, ?)', post.id, user.id, nowIso());
    return { saved: true };
  });

  router.delete('/api/posts/:id/save', (ctx) => {
    const user = requireUser(ctx);
    const post = getPostRow(ctx.params.id);
    assert(post, 404, 'Gönderi bulunamadı.');
    run('DELETE FROM saves WHERE post_id = ? AND user_id = ?', post.id, user.id);
    return { saved: false };
  });

  /* ----------------------------------------------------------------- comments */

  router.get('/api/posts/:id/comments', (ctx) => {
    const user = requireUser(ctx);
    const post = assertVisiblePost(getPostRow(ctx.params.id), user);
    return { comments: loadComments(post.id, user.id) };
  });

  router.post('/api/posts/:id/comments', (ctx) => {
    const user = requireUser(ctx);
    const post = assertVisiblePost(getPostRow(ctx.params.id), user);
    if (post.comments_disabled && post.user_id !== user.id) {
      throw new HttpError(403, 'Bu gönderide yorumlar kapalı.', 'comments_disabled');
    }
    const body = cleanText(ctx.body.body, 1000);
    assert(body.length >= 1, 400, 'Yorum boş olamaz.');

    let parent = null;
    if (ctx.body.parentId) {
      parent = get('SELECT * FROM comments WHERE id = ? AND post_id = ? AND deleted = 0', String(ctx.body.parentId), post.id);
      assert(parent, 400, 'Yanıtlanan yorum bulunamadı.');
      if (parent.parent_id) parent = get('SELECT * FROM comments WHERE id = ?', parent.parent_id) || parent;
    }

    const id = uid(12);
    const createdAt = nowIso();
    run(
      `INSERT INTO comments (id, post_id, user_id, parent_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      post.id,
      user.id,
      parent?.id || null,
      body,
      createdAt,
    );

    const notified = new Set([user.id]);
    if (post.user_id !== user.id) {
      notify(post.user_id, user.id, 'comment', { entityId: id, postId: post.id, meta: { body } });
      notified.add(post.user_id);
    }
    if (parent && !notified.has(parent.user_id)) {
      notify(parent.user_id, user.id, 'reply', { entityId: id, postId: post.id, meta: { body } });
      notified.add(parent.user_id);
    }
    notifyMentions(body, user, { postId: post.id, entityId: id, exclude: [...notified] });

    const row = get(
      `SELECT c.*, u.username, u.display_name, u.avatar_media,
              (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
              0 AS liked
         FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      id,
    );
    const comment = commentOut(row, user.id);
    broadcast('comment:new', {
      postId: post.id,
      comment: {
        id: comment.id,
        parentId: comment.parentId,
        body: comment.body,
        createdAt: comment.createdAt,
        user: comment.user,
      },
      count: commentCount(post.id),
    });
    return { comment, commentCount: commentCount(post.id) };
  });

  router.patch('/api/comments/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM comments WHERE id = ?', ctx.params.id);
    assert(row && row.user_id === user.id && !row.deleted, 404, 'Yorum bulunamadı.');
    const body = cleanText(ctx.body.body, 1000);
    assert(body.length >= 1, 400, 'Yorum boş olamaz.');
    run('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?', body, nowIso(), row.id);
    broadcast('comment:update', { postId: row.post_id, commentId: row.id });
    return { ok: true };
  });

  router.delete('/api/comments/:id', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM comments WHERE id = ?', ctx.params.id);
    assert(row, 404, 'Yorum bulunamadı.');
    const post = getPostRow(row.post_id);
    assert(row.user_id === user.id || post?.user_id === user.id, 403, 'Bu yorumu silemezsin.');
    run('UPDATE comments SET deleted = 1, body = ? WHERE id = ?', '', row.id);
    broadcast('comment:delete', { postId: row.post_id, commentId: row.id, count: commentCount(row.post_id) });
    return { ok: true, commentCount: commentCount(row.post_id) };
  });

  router.post('/api/comments/:id/like', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM comments WHERE id = ? AND deleted = 0', ctx.params.id);
    assert(row, 404, 'Yorum bulunamadı.');
    run('INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)', row.id, user.id, nowIso());
    const likeCount = Number(get('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', row.id).n);
    notify(row.user_id, user.id, 'comment_like', { entityId: row.id, postId: row.post_id });
    broadcast('comment:like', { postId: row.post_id, commentId: row.id, userId: user.id, liked: true, likeCount });
    return { liked: true, likeCount };
  });

  router.delete('/api/comments/:id/like', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM comments WHERE id = ?', ctx.params.id);
    assert(row, 404, 'Yorum bulunamadı.');
    run('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?', row.id, user.id);
    removeNotifications({ userId: row.user_id, actorId: user.id, type: 'comment_like', entityId: row.id });
    const likeCount = Number(get('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', row.id).n);
    broadcast('comment:like', { postId: row.post_id, commentId: row.id, userId: user.id, liked: false, likeCount });
    return { liked: false, likeCount };
  });
}
