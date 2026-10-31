import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const APP_VERSION = '1.0.0';
export const ROOT_DIR = ROOT;
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const DB_PATH = path.join(DATA_DIR, 'ikimiz.db');

export const config = {
  appName: process.env.APP_NAME || 'MelCandy',
  host: process.env.HOST || '0.0.0.0',
  port: int(process.env.PORT, 4321),
  maxUsers: int(process.env.MAX_USERS, 5000),
  sessionDays: int(process.env.SESSION_DAYS, 30),
  inviteHours: int(process.env.INVITE_TTL_HOURS, 72),
  trustProxy: process.env.TRUST_PROXY === '1',
  forceSecureCookies: process.env.SECURE_COOKIES === '1',
  maxImageBytes: int(process.env.MAX_IMAGE_MB, 20) * 1024 * 1024,
  maxVideoBytes: int(process.env.MAX_VIDEO_MB, 200) * 1024 * 1024,
  maxAudioBytes: int(process.env.MAX_AUDIO_MB, 25) * 1024 * 1024,
  maxPostMedia: 10,
  sessionCookie: 'ikimiz_session',
  version: APP_VERSION,
};

export const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'root', 'system', 'ikimiz', 'melcandy', 'destek', 'support',
  'help', 'yardim', 'login', 'logout', 'signup', 'register', 'kayit', 'ayarlar',
  'settings', 'messages', 'mesajlar', 'bildirimler',
  'notifications', 'create', 'olustur', 'story', 'stories', 'hikayeler', 'media',
  'static', 'public', 'assets', 'saved', 'kaydedilenler', 'archive', 'arsiv',
  'user', 'users', 'me', 'ben', 'profile', 'profil', 'index', 'app', 'www', 'mail',
]);

export const USERNAME_RE = /^[a-z0-9._]{3,24}$/;
