import fsp from 'node:fs/promises';
import { config, MEDIA_DIR } from '../config.js';
import { get, run } from '../db.js';
import { HttpError, assert } from '../util.js';
import {
  attachPoster,
  finalizeMedia,
  inspectTemp,
  mediaOut,
  receiveToTemp,
  removeMediaFiles,
  serveMedia,
} from '../media.js';
import { requireUser } from '../api-helpers.js';

const LIMITS = {
  image: () => config.maxImageBytes,
  video: () => config.maxVideoBytes,
  audio: () => config.maxAudioBytes,
  poster: () => 8 * 1024 * 1024,
};

export function registerMediaRoutes(router) {
  router.post('/api/media', async (ctx) => {
    const user = requireUser(ctx);
    const kind = String(ctx.req.headers['x-media-kind'] || '').toLowerCase();
    assert(kind === 'image' || kind === 'video' || kind === 'audio', 400, 'Geçersiz medya türü.');

    const maxBytes = LIMITS[kind]();
    const { tempPath, size } = await receiveToTemp(ctx.req, maxBytes);
    let inspected;
    try {
      inspected = await inspectTemp(tempPath);
      if (!inspected.sniff) throw new HttpError(415, 'Dosya tanınamadı. Geçerli bir görsel, video veya ses yükle.', 'bad_type');
      const row = await finalizeMedia({
        tempPath,
        size,
        sniff: inspected.sniff,
        imageSize: {
          width: Number.parseInt(ctx.req.headers['x-width'] || '', 10) || inspected.imageSize?.width || 0,
          height: Number.parseInt(ctx.req.headers['x-height'] || '', 10) || inspected.imageSize?.height || 0,
        },
        ownerId: user.id,
        kind,
        width: Number.parseInt(ctx.req.headers['x-width'] || '', 10) || 0,
        height: Number.parseInt(ctx.req.headers['x-height'] || '', 10) || 0,
        duration: Number.parseFloat(ctx.req.headers['x-duration'] || '') || 0,
      });
      return { media: mediaOut(row) };
    } catch (error) {
      const fsp = await import('node:fs/promises');
      await fsp.unlink(tempPath).catch(() => {});
      throw error;
    }
  });

  router.post('/api/media/:id/poster', async (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM media WHERE id = ?', ctx.params.id);
    assert(row && row.owner_id === user.id, 404, 'Medya bulunamadı.');
    assert(row.kind === 'video', 400, 'Kapak yalnızca videolara eklenebilir.');

    const { tempPath } = await receiveToTemp(ctx.req, LIMITS.poster());
    try {
      const inspected = await inspectTemp(tempPath);
      if (inspected.sniff?.family !== 'image') throw new HttpError(415, 'Kapak görseli geçersiz.');
      await attachPoster(row, tempPath, inspected.sniff);
    } catch (error) {
      const fsp = await import('node:fs/promises');
      await fsp.unlink(tempPath).catch(() => {});
      throw error;
    }
    return { media: mediaOut(get('SELECT * FROM media WHERE id = ?', row.id)) };
  });

  router.get('/api/media/:id', async (ctx) => {
    requireUser(ctx);
    const row = get('SELECT * FROM media WHERE id = ?', ctx.params.id);
    if (!row) throw new HttpError(404, 'Medya bulunamadı.');
    await serveMedia(ctx.req, ctx.res, row);
    return undefined;
  });

  router.get('/api/media/:id/poster', async (ctx) => {
    requireUser(ctx);
    const row = get('SELECT * FROM media WHERE id = ?', ctx.params.id);
    if (!row || !row.poster_path) throw new HttpError(404, 'Kapak bulunamadı.');
    await serveMedia(ctx.req, ctx.res, row, row.poster_path);
    return undefined;
  });

  router.delete('/api/media/:id', async (ctx) => {
    const user = requireUser(ctx);
    const row = get('SELECT * FROM media WHERE id = ?', ctx.params.id);
    assert(row && row.owner_id === user.id, 404, 'Medya bulunamadı.');
    assert(!row.attached, 409, 'Kullanılan bir medya doğrudan silinemez.');
    run('DELETE FROM media WHERE id = ?', row.id);
    await removeMediaFiles(row);
    return { ok: true };
  });
}
