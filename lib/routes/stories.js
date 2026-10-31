import { all, get, run, tx } from '../db.js';
import { removeMediaFiles } from '../media.js';
import { briefUser, messageOut, storyOut } from '../present.js';
import { broadcast, sendTo } from '../realtime.js';
import { assert, cleanText, HttpError, nowIso, rateLimit, uid } from '../util.js';
import { requireUser } from '../api-helpers.js';
import { notify, pushBadges } from '../notify.js';

function activeStory(id) {
  return get('SELECT * FROM stories WHERE id = ? AND expires_at > ?', id, nowIso());
}

function insertMessage(sender, recipient, body) {
  const id = uid(12);
  run(
    `INSERT INTO messages (id, sender_id, recipient_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    sender.id,
    recipient.id,
    body,
    nowIso(),
  );
  const row = get(
    `SELECT m.*, u.username, u.display_name, u.avatar_media
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
    id,
  );
  sendTo(recipient.id, 'message:new', { message: messageOut(row, recipient.id) });
  sendTo(sender.id, 'message:new', { message: messageOut(row, sender.id) });
  pushBadges(recipient.id);
  return messageOut(row, sender.id);
}

export function registerStoryRoutes(router) {
  router.get('/api/stories', (ctx) => {
    const user = requireUser(ctx);
    const now = nowIso();
    const rows = all(
      `SELECT * FROM stories WHERE expires_at > ? ORDER BY created_at ASC`,
      now,
    );
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.user_id)) {
        const owner = get('SELECT * FROM users WHERE id = ?', row.user_id);
        if (!owner) continue;
        groups.set(row.user_id, { user: briefUser(owner), stories: [] });
      }
      groups.get(row.user_id).stories.push(storyOut(row, user.id));
    }
    const list = [...groups.values()].map((group) => ({
      ...group,
      allViewed: group.stories.every((story) => story.viewed || story.mine),
      latestAt: group.stories[group.stories.length - 1]?.createdAt || null,
    }));
    list.sort((a, b) => {
      if (a.user.id === user.id) return -1;
      if (b.user.id === user.id) return 1;
      if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
      return (b.latestAt || '').localeCompare(a.latestAt || '');
    });
    return { groups: list };
  });

  router.get('/api/stories/archive', (ctx) => {
    const user = requireUser(ctx);
    const rows = all(
      'SELECT * FROM stories WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      user.id,
    );
    return {
      stories: rows.map((row) => ({
        ...storyOut(row, user.id, { includeViewers: true }),
        active: Date.parse(row.expires_at) > Date.now(),
      })),
    };
  });

  router.post('/api/stories', (ctx) => {
    const user = requireUser(ctx);
    const limit = rateLimit(`story:${user.id}`, 25, 10 * 60 * 1000);
    if (!limit.ok) throw new HttpError(429, 'Çok fazla hikâye paylaştın. Biraz bekle.', 'rate_limited');

    const media = get('SELECT * FROM media WHERE id = ?', String(ctx.body.mediaId || ''));
    assert(media && media.owner_id === user.id, 400, 'Geçersiz medya.');
    assert(!media.attached, 409, 'Bu medya zaten kullanılıyor.');
    assert(media.kind === 'image' || media.kind === 'video', 400, 'Hikâye için görsel veya video seç.');

    const caption = cleanText(ctx.body.caption, 300);
    const id = uid(12);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    tx(() => {
      run('UPDATE media SET attached = 1 WHERE id = ?', media.id);
      run(
        `INSERT INTO stories (id, user_id, media_id, caption, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        user.id,
        media.id,
        caption,
        createdAt,
        expiresAt,
      );
    });

    const row = get('SELECT * FROM stories WHERE id = ?', id);
    const story = storyOut(row, user.id);
    const recipients = all('SELECT id FROM users WHERE approved = 1 AND id <> ?', user.id);
    for (const recipient of recipients) {
      sendTo(recipient.id, 'story:new', { story, user: briefUser(user) });
      pushBadges(recipient.id);
    }
    broadcast('story:update', {});
    return { story };
  });

  router.post('/api/stories/:id/view', (ctx) => {
    const user = requireUser(ctx);
    const story = activeStory(ctx.params.id);
    if (!story) throw new HttpError(404, 'Hikâye bulunamadı veya süresi dolmuş.');
    if (story.user_id === user.id) return { ok: true, viewCount: null };
    run(
      `INSERT INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, ?)
       ON CONFLICT(story_id, user_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
      story.id,
      user.id,
      nowIso(),
    );
    const viewCount = Number(get('SELECT COUNT(*) AS n FROM story_views WHERE story_id = ?', story.id).n);
    sendTo(story.user_id, 'story:view', {
      storyId: story.id,
      viewer: briefUser(user),
      viewCount,
    });
    return { ok: true, viewCount };
  });

  router.get('/api/stories/:id/viewers', (ctx) => {
    const user = requireUser(ctx);
    const story = get('SELECT * FROM stories WHERE id = ?', ctx.params.id);
    assert(story && story.user_id === user.id, 404, 'Hikâye bulunamadı.');
    const viewers = all(
      `SELECT u.*, v.viewed_at FROM story_views v JOIN users u ON u.id = v.user_id
        WHERE v.story_id = ? ORDER BY v.viewed_at DESC`,
      story.id,
    ).map((row) => ({ ...briefUser(row), viewedAt: row.viewed_at }));
    return { viewers };
  });

  router.delete('/api/stories/:id', async (ctx) => {
    const user = requireUser(ctx);
    const story = get('SELECT * FROM stories WHERE id = ?', ctx.params.id);
    assert(story && story.user_id === user.id, 404, 'Hikâye bulunamadı.');
    const media = get('SELECT * FROM media WHERE id = ?', story.media_id);
    tx(() => {
      run('DELETE FROM stories WHERE id = ?', story.id);
      if (media) run('DELETE FROM media WHERE id = ?', media.id);
    });
    if (media) await removeMediaFiles(media);
    broadcast('story:update', {});
    return { ok: true };
  });

  router.post('/api/stories/:id/react', (ctx) => {
    const user = requireUser(ctx);
    const story = activeStory(ctx.params.id);
    assert(story, 404, 'Hikâye bulunamadı.');
    assert(story.user_id !== user.id, 400, 'Kendi hikâyene tepki veremezsin.');
    const emoji = cleanText(ctx.body.emoji, 8);
    assert(emoji.length >= 1, 400, 'Tepki boş olamaz.');
    const owner = get('SELECT * FROM users WHERE id = ?', story.user_id);
    assert(owner, 404, 'Hikâye sahibi bulunamadı.');
    const message = insertMessage(user, owner, emoji);
    notify(owner.id, user.id, 'story_reaction', {
      entityId: story.id,
      meta: { emoji, body: emoji },
    });
    return { message };
  });

  router.post('/api/stories/:id/reply', (ctx) => {
    const user = requireUser(ctx);
    const story = activeStory(ctx.params.id);
    assert(story, 404, 'Hikâye bulunamadı.');
    assert(story.user_id !== user.id, 400, 'Kendi hikâyene yanıt veremezsin.');
    const body = cleanText(ctx.body.body, 1000);
    assert(body.length >= 1, 400, 'Yanıt boş olamaz.');
    const owner = get('SELECT * FROM users WHERE id = ?', story.user_id);
    assert(owner, 404, 'Hikâye sahibi bulunamadı.');
    const message = insertMessage(user, owner, body);
    notify(owner.id, user.id, 'story_reply', {
      entityId: story.id,
      meta: { body: body.slice(0, 120) },
    });
    return { message };
  });
}
