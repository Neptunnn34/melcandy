import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH, MEDIA_DIR, TMP_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const SCHEMA_VERSION = 4;

function migrate() {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (current >= SCHEMA_VERSION) return;

  if (current < 1) {
    db.exec(`
      BEGIN;

      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        bio           TEXT NOT NULL DEFAULT '',
        link          TEXT NOT NULL DEFAULT '',
        pronouns      TEXT NOT NULL DEFAULT '',
        avatar_media  TEXT,
        cover_media   TEXT,
        theme         TEXT NOT NULL DEFAULT 'system',
        together_since TEXT,
        settings      TEXT NOT NULL DEFAULT '{}',
        approved      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        last_seen_at  TEXT
      );

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash   TEXT NOT NULL UNIQUE,
        created_at   TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        user_agent   TEXT NOT NULL DEFAULT '',
        ip           TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE invites (
        id         TEXT PRIMARY KEY,
        code       TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at    TEXT,
        used_by    TEXT REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE media (
        id          TEXT PRIMARY KEY,
        owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        mime        TEXT NOT NULL,
        path        TEXT NOT NULL,
        poster_path TEXT,
        size        INTEGER NOT NULL DEFAULT 0,
        width       INTEGER NOT NULL DEFAULT 0,
        height      INTEGER NOT NULL DEFAULT 0,
        duration    REAL NOT NULL DEFAULT 0,
        attached    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_media_owner ON media(owner_id);
      CREATE INDEX idx_media_cleanup ON media(attached, created_at);

      CREATE TABLE posts (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind              TEXT NOT NULL DEFAULT 'post',
        caption           TEXT NOT NULL DEFAULT '',
        location          TEXT NOT NULL DEFAULT '',
        alt_text          TEXT NOT NULL DEFAULT '',
        music             TEXT NOT NULL DEFAULT '',
        comments_disabled INTEGER NOT NULL DEFAULT 0,
        likes_hidden      INTEGER NOT NULL DEFAULT 0,
        archived          INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX idx_posts_feed ON posts(archived, kind, created_at DESC);
      CREATE INDEX idx_posts_user ON posts(user_id, archived, created_at DESC);

      CREATE TABLE post_media (
        post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (post_id, media_id)
      );
      CREATE INDEX idx_post_media_media ON post_media(media_id);

      CREATE TABLE likes (
        post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE INDEX idx_likes_user ON likes(user_id);

      CREATE TABLE saves (
        post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE INDEX idx_saves_user ON saves(user_id, created_at DESC);

      CREATE TABLE comments (
        id         TEXT PRIMARY KEY,
        post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        edited_at  TEXT,
        deleted    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_comments_post ON comments(post_id, created_at);
      CREATE INDEX idx_comments_parent ON comments(parent_id);

      CREATE TABLE comment_likes (
        comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (comment_id, user_id)
      );

      CREATE TABLE stories (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        caption    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_stories_active ON stories(expires_at, user_id);

      CREATE TABLE story_views (
        story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TEXT NOT NULL,
        PRIMARY KEY (story_id, user_id)
      );

      CREATE TABLE messages (
        id           TEXT PRIMARY KEY,
        sender_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body         TEXT NOT NULL DEFAULT '',
        media_id     TEXT REFERENCES media(id) ON DELETE SET NULL,
        reply_to_id  TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL,
        edited_at    TEXT,
        deleted_at   TEXT,
        seen_at      TEXT
      );
      CREATE INDEX idx_messages_thread ON messages(created_at);
      CREATE INDEX idx_messages_unseen ON messages(recipient_id, seen_at);

      CREATE TABLE message_reactions (
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id)
      );

      CREATE TABLE notifications (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        entity_id  TEXT,
        post_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
        meta       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        read_at    TEXT
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
      CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at);

      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  if (current < 2) {
    db.exec(`
      BEGIN;

      CREATE TABLE IF NOT EXISTS follows (
        follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        PRIMARY KEY (follower_id, following_id)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

      -- Çok kullanıcılı yapıya geçiş: onay bekleyen hesaplar artık doğrudan aktif.
      UPDATE users SET approved = 1 WHERE approved = 0;
      DELETE FROM notifications WHERE type = 'join_request';

      PRAGMA user_version = 2;
      COMMIT;
    `);
  }

  if (current < 3) {
    db.exec(`
      BEGIN;

      CREATE TABLE IF NOT EXISTS stickers (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        media_id   TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        label      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stickers_user ON stickers(user_id, created_at DESC);

      ALTER TABLE messages ADD COLUMN sticker_media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
      ALTER TABLE messages ADD COLUMN sticker_emoji TEXT;

      PRAGMA user_version = 3;
      COMMIT;
    `);
  }

  if (current < 4) {
    db.exec(`
      BEGIN;

      CREATE TABLE IF NOT EXISTS friend_requests (
        id           TEXT PRIMARY KEY,
        from_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL,
        responded_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fr_unique ON friend_requests(from_id, to_id);
      CREATE INDEX IF NOT EXISTS idx_fr_to ON friend_requests(to_id, status);
      CREATE INDEX IF NOT EXISTS idx_fr_from ON friend_requests(from_id, status);

      CREATE TABLE IF NOT EXISTS friendships (
        user_id1   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_id2   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id1, user_id2)
      );
      CREATE INDEX IF NOT EXISTS idx_friendships_u1 ON friendships(user_id1);
      CREATE INDEX IF NOT EXISTS idx_friendships_u2 ON friendships(user_id2);

      CREATE TABLE IF NOT EXISTS spotify_accounts (
        user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        access_token  TEXT,
        refresh_token TEXT,
        token_type    TEXT,
        scope         TEXT,
        expires_at    INTEGER,
        spotify_id    TEXT,
        display_name  TEXT,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_activity (
        user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT NOT NULL DEFAULT 'none',
        title      TEXT,
        subtitle   TEXT,
        image      TEXT,
        url        TEXT,
        expires_at INTEGER,
        updated_at TEXT NOT NULL
      );

      PRAGMA user_version = 4;
      COMMIT;
    `);
  }
}

migrate();

/* ------------------------------------------------------------------ helpers */

const statementCache = new Map();

function stmt(sql) {
  let prepared = statementCache.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    statementCache.set(sql, prepared);
  }
  return prepared;
}

export function get(sql, ...params) {
  return stmt(sql).get(...params);
}

export function all(sql, ...params) {
  return stmt(sql).all(...params);
}

export function run(sql, ...params) {
  return stmt(sql).run(...params);
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', id);
}

export function getUserByUsername(username) {
  return get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
}

export function countUsers() {
  return Number(get('SELECT COUNT(*) AS n FROM users').n);
}

export function getPartner(userId) {
  return get('SELECT * FROM users WHERE id <> ? ORDER BY created_at ASC LIMIT 1', userId);
}

export function parseSettings(user) {
  try {
    return JSON.parse(user?.settings || '{}');
  } catch {
    return {};
  }
}
