import fsp from 'node:fs/promises';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { config, DATA_DIR, PUBLIC_DIR, TMP_DIR } from './lib/config.js';
import { db, all, run } from './lib/db.js';
import { resolveSession, touchUser } from './lib/auth.js';
import {
  checkSameOrigin,
  clientIp,
  readJson,
  securityHeaders,
  sendError,
  sendJson,
} from './lib/http.js';
import { cleanupUnattachedMedia, storageStats } from './lib/media.js';
import { createRouter } from './lib/router.js';
import { registerAuthRoutes } from './lib/routes/auth.js';
import { registerMediaRoutes } from './lib/routes/media.js';
import { registerPostRoutes } from './lib/routes/posts.js';
import { registerStoryRoutes } from './lib/routes/stories.js';
import { registerSocialRoutes } from './lib/routes/social.js';
import { registerFriendRoutes } from './lib/routes/friends.js';
import { registerSpotifyRoutes } from './lib/routes/spotify.js';
import { HttpError, nowIso } from './lib/util.js';

const api = createRouter();
registerAuthRoutes(api);
registerMediaRoutes(api);
registerPostRoutes(api);
registerStoryRoutes(api);
registerSocialRoutes(api);
registerFriendRoutes(api);
registerSpotifyRoutes(api);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Yöntem desteklenmiyor.');
    return;
  }

  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    sendError(res, 400, 'Geçersiz adres.');
    return;
  }

  if (!rel || rel.includes('..') || rel.startsWith('.')) {
    sendError(res, 404, 'Sayfa bulunamadı.');
    return;
  }

  let fullPath = path.resolve(PUBLIC_DIR, rel);
  if (!fullPath.startsWith(path.resolve(PUBLIC_DIR) + path.sep) && fullPath !== path.resolve(PUBLIC_DIR)) {
    sendError(res, 404, 'Sayfa bulunamadı.');
    return;
  }

  let stat = null;
  try {
    stat = await fsp.stat(fullPath);
  } catch {
    stat = null;
  }

  if (!stat || stat.isDirectory()) {
    // SPA yönlendirmeleri: uzantısız yollar index.html'e düşer.
    const accept = String(req.headers.accept || '');
    const isSpaPath = !path.extname(rel) && (accept.includes('text/html') || accept === '*/*' || accept === '');
    if (isSpaPath) {
      fullPath = path.join(PUBLIC_DIR, 'index.html');
      try {
        stat = await fsp.stat(fullPath);
      } catch {
        sendError(res, 404, 'Uygulama dosyaları bulunamadı.');
        return;
      }
    } else {
      sendError(res, 404, 'Dosya bulunamadı.');
      return;
    }
  }

  const ext = path.extname(fullPath).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  if (ext === '.js' && path.basename(fullPath) === 'sw.js') {
    headers['Service-Worker-Allowed'] = '/';
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(fullPath).pipe(res);
}

async function handleApi(req, res, url, authSnapshot) {
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (mutating) {
    checkSameOrigin(req);
    if (req.headers['x-ikimiz-client'] !== '1') {
      throw new HttpError(403, 'İstek doğrulanamadı.', 'bad_client');
    }
  }

  let body = {};
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (mutating && contentType.includes('application/json')) {
    body = await readJson(req, 2 * 1024 * 1024);
  }

  const ctx = {
    req,
    res,
    url,
    query: url.searchParams,
    params: {},
    auth: authSnapshot,
    ip: clientIp(req),
    body,
  };

  const result = await api.handle(ctx);
  if (result === undefined) {
    if (!res.headersSent && !res.writableEnded) sendError(res, 404, 'İşlem bulunamadı.');
    return;
  }
  if (!res.headersSent && !res.writableEnded) sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  securityHeaders(req, res);
  res.setHeader('X-Powered-By', 'melcandy');

  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendError(res, 400, 'Geçersiz istek.');
    return;
  }

  const pathname = url.pathname;

  try {
    if (pathname === '/health') {
      return sendJson(res, 200, { ok: true, at: nowIso(), version: config.version });
    }

    if (pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { Allow: 'GET, POST, PATCH, PUT, DELETE, OPTIONS' });
        res.end();
        return;
      }
      const authSnapshot = resolveSession(req, res);
      if (authSnapshot) touchUser(authSnapshot.user.id);
      await handleApi(req, res, url, authSnapshot);
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent && !res.writableEnded) {
        if (error.status === 413 && !res.headersSent) res.setHeader('Connection', 'close');
        sendError(res, error.status, error.message, error.code);
      }
    } else if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE' || error?.code === 'ECONNRESET') {
      // istemci yüklemeyi iptal etti
    } else {
      console.error(`[${new Date().toISOString()}] ${req.method} ${pathname} →`, error);
      if (!res.headersSent && !res.writableEnded) sendError(res, 500, 'Sunucuda beklenmeyen bir hata oluştu.');
    }
  } finally {
    const ms = Date.now() - started;
    if (ms > 1500 && pathname.startsWith('/api/')) {
      console.log(`yavaş istek: ${req.method} ${pathname} ${ms}ms`);
    }
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;
server.maxHeadersCount = 100;

/* -------------------------------------------------------------------- housekeeping */

async function housekeeping() {
  try {
    await cleanupUnattachedMedia();
    run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
    run('DELETE FROM invites WHERE expires_at <= ? AND used_at IS NULL', new Date(Date.now() - 7 * 86400000).toISOString());
    // Yarım kalmış yüklemeleri temizle.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of await fsp.readdir(TMP_DIR)) {
      const full = path.join(TMP_DIR, name);
      try {
        const stat = await fsp.stat(full);
        if (stat.mtimeMs < cutoff) await fsp.unlink(full);
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    console.error('Temizlik hatası:', error.message);
  }
}

/* ------------------------------------------------------------------------ boot */

function localAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function banner() {
  const lines = [
    '',
    '  ♥  M E L C A N D Y',
    '  Küçük ve reklamsız bir sosyal alan.',
    '',
    `  Yerel:   http://localhost:${config.port}`,
  ];
  for (const address of localAddresses()) {
    lines.push(`  Ağ:      http://${address}:${config.port}`);
  }
  lines.push('', `  Veri:    ${DATA_DIR}`);
  lines.push(`  Node:    ${process.version}`, '');
  lines.push('  Durdurmak için Ctrl+C', '');
  console.log(lines.join('\n'));
}

async function main() {
  await housekeeping();
  setInterval(housekeeping, 60 * 60 * 1000).unref();

  server.listen(config.port, config.host, () => {
    banner();
    const stats = db.prepare('SELECT COUNT(*) AS n FROM users').get();
    if (Number(stats.n) === 0) {
      console.log('  İlk kurulum: tarayıcıdan ilk hesabı oluştur.');
    } else if (Number(stats.n) === 1) {
      console.log('  Tek hesap var: giriş ekranındaki “Kayıt ol” ile yeni kişiler katılabilir.');
    }
    console.log('');
  });
}

function shutdown(signal) {
  console.log(`\n${signal}: kapatılıyor...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Yakalanmamış hata:', reason);
});

main().catch((error) => {
  console.error('Sunucu başlatılamadı:', error);
  process.exit(1);
});
