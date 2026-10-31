import { get, run } from '../db.js';
import { assert, HttpError, nowIso, uid } from '../util.js';
import { requireUser } from '../api-helpers.js';
import { originOf } from '../api-helpers.js';

const SPOTIFY_AUTH = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN = 'https://accounts.spotify.com/api/token';
const SPOTIFY_NOW = 'https://api.spotify.com/v1/me/player/currently-playing';

function getConfig() {
  return {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || '',
  };
}

async function exchange(code, redirectUri, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(SPOTIFY_TOKEN, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body,
  });
  if (!res.ok) throw new HttpError(400, 'Spotify bağlantısı başarısız.');
  return res.json();
}

async function refresh(refreshToken, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(SPOTIFY_TOKEN, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body,
  });
  if (!res.ok) throw new HttpError(400, 'Spotify yenileme hatası.');
  return res.json();
}

async function getNowPlaying(accessToken) {
  const res = await fetch(`${SPOTIFY_NOW}?market=from_token`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) return null;
  return res.json();
}

export function registerSpotifyRoutes(router) {
  router.get('/api/spotify/login', (ctx) => {
    const user = requireUser(ctx);
    const { clientId } = getConfig();
    assert(clientId, 400, 'Spotify Client ID ayarlı değil.');
    const origin = originOf(ctx.req);
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `${origin}/api/spotify/callback`;
    const state = uid(16);
    run('CREATE TABLE IF NOT EXISTS spotify_state (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)');
    run('DELETE FROM spotify_state WHERE created_at < ?', new Date(Date.now() - 10 * 60 * 1000).toISOString());
    run('INSERT INTO spotify_state (state, user_id, created_at) VALUES (?, ?, ?)', state, user.id, nowIso());
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'user-read-currently-playing user-read-playback-state',
      redirect_uri: redirectUri,
      state,
    });
    ctx.res.writeHead(302, { Location: `${SPOTIFY_AUTH}?${params.toString()}` });
    ctx.res.end();
    return undefined;
  });

  router.get('/api/spotify/callback', async (ctx) => {
    const { code, state } = ctx.query;
    const { clientId, clientSecret } = getConfig();
    const origin = originOf(ctx.req);
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || `${origin}/api/spotify/callback`;
    run('CREATE TABLE IF NOT EXISTS spotify_state (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)');
    const row = get('SELECT * FROM spotify_state WHERE state = ?', String(state || ''));
    assert(row, 400, 'Geçersiz Spotify bağlantısı.');
    run('DELETE FROM spotify_state WHERE state = ?', String(state || ''));
    const user = requireUser(ctx);
    assert(user.id === row.user_id, 403, 'Bağlantı eşleşmiyor.');
    assert(code && clientId && clientSecret, 400, 'Spotify yapılandırması eksik.');
    const token = await exchange(String(code), redirectUri, clientId, clientSecret);
    const expiresAt = Date.now() + (Number(token.expires_in || 3600) * 1000) - 60000;
    run(
      `INSERT INTO spotify_accounts (user_id, access_token, refresh_token, token_type, scope, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, spotify_accounts.refresh_token),
         token_type = excluded.token_type,
         scope = excluded.scope,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      user.id,
      token.access_token || null,
      token.refresh_token || null,
      token.token_type || null,
      token.scope || null,
      expiresAt,
      nowIso(),
    );
    ctx.res.writeHead(302, { Location: '/ayarlar?spotify=ok' });
    ctx.res.end();
    return undefined;
  });

  router.delete('/api/spotify', (ctx) => {
    const user = requireUser(ctx);
    run('DELETE FROM spotify_accounts WHERE user_id = ?', user.id);
    run('DELETE FROM user_activity WHERE user_id = ? AND type = ?', user.id, 'listening');
    return { ok: true };
  });

  router.get('/api/spotify/status', (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM spotify_accounts WHERE user_id = ?', user.id);
    const { clientId } = getConfig();
    return { connected: Boolean(row?.access_token), configured: Boolean(clientId), needsSetup: !clientId };
  });

  router.get('/api/spotify/now', async (ctx) => {
    const user = requireUser(ctx);
    let row = get('SELECT * FROM spotify_accounts WHERE user_id = ?', user.id);
    if (!row?.access_token) return { playing: null };
    const { clientId, clientSecret } = getConfig();
    if (row.expires_at && row.expires_at < Date.now() && row.refresh_token && clientId && clientSecret) {
      try {
        const token = await refresh(row.refresh_token, clientId, clientSecret);
        const expiresAt = Date.now() + (Number(token.expires_in || 3600) * 1000) - 60000;
        run(
          `UPDATE spotify_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ?, updated_at = ? WHERE user_id = ?`,
          token.access_token,
          token.refresh_token || null,
          expiresAt,
          nowIso(),
          user.id,
        );
        row = get('SELECT * FROM spotify_accounts WHERE user_id = ?', user.id);
      } catch {
        /* ignore */
      }
    }
    const data = await getNowPlaying(row.access_token);
    if (!data?.item || !data.is_playing) {
      run(
        `INSERT INTO user_activity (user_id, type, title, subtitle, image, url, expires_at, updated_at)
         VALUES (?, 'none', NULL, NULL, NULL, NULL, NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET type = 'none', title = NULL, subtitle = NULL, image = NULL, url = NULL, expires_at = NULL, updated_at = excluded.updated_at`,
        user.id,
        nowIso(),
      );
      return { playing: null };
    }
    const item = data.item;
    const artists = Array.isArray(item.artists) ? item.artists.map((a) => a.name).join(', ') : '';
    const title = item.name || '';
    const image = item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null;
    const url = item.external_urls?.spotify || null;
    run(
      `INSERT INTO user_activity (user_id, type, title, subtitle, image, url, expires_at, updated_at)
       VALUES (?, 'listening', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET type = 'listening', title = excluded.title, subtitle = excluded.subtitle, image = excluded.image, url = excluded.url, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      user.id,
      title,
      artists,
      image,
      url,
      Date.now() + 90000,
      nowIso(),
    );
    return {
      playing: {
        title,
        artist: artists,
        album: item.album?.name || '',
        image,
        url,
        progressMs: data.progress_ms || 0,
        durationMs: item.duration_ms || 0,
      },
    };
  });

  router.post('/api/me/activity', (ctx) => {
    const user = requireUser(ctx);
    const type = ctx.body.type === 'playing' ? 'playing' : 'custom';
    const title = cleanText(ctx.body.title, 80);
    assert(title.length >= 1, 400, 'Aktivite boş olamaz.');
    const subtitle = cleanText(ctx.body.subtitle, 80);
    const url = cleanText(ctx.body.url, 200);
    const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
    run(
      `INSERT INTO user_activity (user_id, type, title, subtitle, image, url, expires_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET type = excluded.type, title = excluded.title, subtitle = excluded.subtitle, image = NULL, url = excluded.url, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      user.id,
      type,
      title,
      subtitle || null,
      url || null,
      expiresAt,
      nowIso(),
    );
    return { ok: true };
  });

  router.delete('/api/me/activity', (ctx) => {
    const user = requireUser(ctx);
    run(
      `INSERT INTO user_activity (user_id, type, title, subtitle, image, url, expires_at, updated_at)
       VALUES (?, 'none', NULL, NULL, NULL, NULL, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET type = 'none', title = NULL, subtitle = NULL, image = NULL, url = NULL, expires_at = NULL, updated_at = excluded.updated_at`,
      user.id,
      nowIso(),
    );
    return { ok: true };
  });

  router.get('/api/presence/activities', (ctx) => {
    const user = requireUser(ctx);
    const now = Date.now();
    const rows = all(
      `SELECT ua.*, u.id AS uid, u.username, u.display_name, u.avatar_media, u.last_seen_at
         FROM user_activity ua
         JOIN users u ON u.id = ua.user_id
        WHERE ua.type <> 'none'
          AND (ua.expires_at IS NULL OR ua.expires_at > ?)
          AND u.approved = 1
        ORDER BY ua.updated_at DESC
        LIMIT 100`,
      now,
    );
    const out = rows
      .map((row) => {
        const activity = {
          type: row.type,
          title: row.title,
          subtitle: row.subtitle,
          image: row.image,
          url: row.url,
          updatedAt: row.updated_at,
        };
        if (activity.type === 'listening' && row.expires_at && row.expires_at < now) return null;
        return {
          user: { ...briefUser(row), lastSeenAt: row.last_seen_at },
          activity,
        };
      })
      .filter(Boolean);
    return { activities: out };
  });
}

function cleanText(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n?/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function briefUser(row) {
  if (!row) return null;
  return {
    id: row.uid || row.id || row.user_id,
    username: row.username,
    display_name: row.display_name,
    avatar: row.avatar_media || null,
    online: false,
  };
}
