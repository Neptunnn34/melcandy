import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR, TMP_DIR, config } from './config.js';
import { all, get, run } from './db.js';
import { HttpError } from './util.js';
import { uid } from './util.js';

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/* -------------------------------------------------------------------- sniffing */

function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function ascii(buf, start, length) {
  return buf.subarray(start, start + length).toString('latin1');
}

export function sniffMedia(buf) {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { family: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { family: 'image', mime: 'image/png', ext: 'png' };
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') {
    return { family: 'image', mime: 'image/webp', ext: 'webp' };
  }
  if (ascii(buf, 0, 4) === 'GIF8') return { family: 'image', mime: 'image/gif', ext: 'gif' };

  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4).toLowerCase();
    if (brand.includes('qt')) return { family: 'video', mime: 'video/quicktime', ext: 'mov' };
    if (brand.startsWith('m4a') || brand.startsWith('mp4a')) {
      return { family: 'audio', mime: 'audio/mp4', ext: 'm4a' };
    }
    return { family: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { family: 'video', mime: 'video/webm', ext: 'webm', webm: true };
  }
  if (ascii(buf, 0, 4) === 'OggS') return { family: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') {
    return { family: 'audio', mime: 'audio/wav', ext: 'wav' };
  }
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { family: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  }
  return null;
}

/* ---------------------------------------------------------------------- upload */

export async function receiveToTemp(req, maxBytes) {
  const declared = Number.parseInt(req.headers['content-length'] || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, `Dosya çok büyük. En fazla ${Math.round(maxBytes / 1024 / 1024)} MB olabilir.`, 'too_large');
  }

  const tempPath = path.join(TMP_DIR, `${uid(16)}.part`);
  const handle = await fsp.open(tempPath, 'w');
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new HttpError(413, `Dosya çok büyük. En fazla ${Math.round(maxBytes / 1024 / 1024)} MB olabilir.`, 'too_large');
      }
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }
  await handle.close();
  if (size === 0) {
    await fsp.unlink(tempPath).catch(() => {});
    throw new HttpError(400, 'Boş dosya yüklenemez.');
  }
  return { tempPath, size };
}

export async function inspectTemp(tempPath) {
  const handle = await fsp.open(tempPath, 'r');
  const buffer = Buffer.alloc(512 * 1024);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  await handle.close();
  const head = buffer.subarray(0, bytesRead);
  return { head, sniff: sniffMedia(head), imageSize: imageSize(head) };
}

export async function finalizeMedia({ tempPath, size, sniff, imageSize, ownerId, kind, width, height, duration }) {
  const allowed =
    (kind === 'image' && sniff?.family === 'image') ||
    (kind === 'video' && (sniff?.family === 'video' || (sniff?.family === 'audio' && sniff?.webm))) ||
    (kind === 'audio' && (sniff?.family === 'audio' || sniff?.family === 'video')) ||
    (kind === 'poster' && sniff?.family === 'image');

  if (!allowed) {
    await fsp.unlink(tempPath).catch(() => {});
    throw new HttpError(415, 'Bu dosya türü desteklenmiyor ya da içerik türüyle uyuşmuyor.', 'bad_type');
  }

  const id = uid(12);
  const ext = sniff.ext;
  const filename = `${id}.${ext}`;
  const finalPath = path.join(MEDIA_DIR, filename);

  await fsp.rename(tempPath, finalPath);
  // Dosya sisteminde adı geçse bile dışarıdan erişilemez; yalnızca API sunar.

  const mime =
    sniff.mime === 'video/webm' && kind === 'audio'
      ? 'audio/webm'
      : sniff.mime === 'video/mp4' && kind === 'audio'
        ? 'audio/mp4'
        : sniff.mime;

  const finalKind = kind === 'poster' ? 'image' : kind;
  const w = Number.isFinite(Number(width)) && Number(width) > 0 ? Math.round(Number(width)) : imageSize?.width || 0;
  const h = Number.isFinite(Number(height)) && Number(height) > 0 ? Math.round(Number(height)) : imageSize?.height || 0;
  const dur = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 0;

  run(
    `INSERT INTO media (id, owner_id, kind, mime, path, size, width, height, duration, attached, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    id,
    ownerId,
    finalKind,
    mime,
    filename,
    size,
    w,
    h,
    dur,
    new Date().toISOString(),
  );

  return get('SELECT * FROM media WHERE id = ?', id);
}

export async function attachPoster(videoRow, tempPath, sniff) {
  if (!videoRow || videoRow.kind !== 'video') throw new HttpError(400, 'Kapak yalnızca videolara eklenebilir.');
  if (sniff?.family !== 'image') throw new HttpError(415, 'Kapak görseli geçersiz.');
  const filename = `${videoRow.id}.poster.jpg`;
  const target = path.join(MEDIA_DIR, filename);
  // Ham dosya .part uzantılı olabilir; yeniden adlandırmak yerine taşı.
  await fsp.rename(tempPath, target);
  const old = videoRow.poster_path;
  run('UPDATE media SET poster_path = ? WHERE id = ?', filename, videoRow.id);
  if (old && old !== filename) await fsp.unlink(path.join(MEDIA_DIR, old)).catch(() => {});
  return filename;
}

export async function replacePoster(videoRow, buffer) {
  if (!videoRow || videoRow.kind !== 'video') throw new HttpError(400, 'Kapak yalnızca videolara eklenebilir.');
  const sniff = sniffMedia(buffer);
  if (sniff?.family !== 'image') throw new HttpError(415, 'Kapak görseli geçersiz.');
  const filename = `${videoRow.id}.poster.${sniff.ext}`;
  await fsp.writeFile(path.join(MEDIA_DIR, filename), buffer);
  const old = videoRow.poster_path;
  run('UPDATE media SET poster_path = ? WHERE id = ?', filename, videoRow.id);
  if (old && old !== filename) await fsp.unlink(path.join(MEDIA_DIR, old)).catch(() => {});
  return filename;
}

/* -------------------------------------------------------------------- serving */

function safeMediaPath(filename) {
  if (!filename || !SAFE_NAME.test(filename)) throw new HttpError(404, 'Dosya bulunamadı.');
  const resolved = path.resolve(MEDIA_DIR, filename);
  if (!resolved.startsWith(path.resolve(MEDIA_DIR) + path.sep)) {
    throw new HttpError(404, 'Dosya bulunamadı.');
  }
  return resolved;
}

export async function serveMedia(req, res, row, filename = row.path) {
  const filePath = safeMediaPath(filename);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    throw new HttpError(404, 'Dosya bulunamadı.');
  }

  const total = stat.size;
  const headers = {
    'Content-Type': row.poster_path && filename === row.poster_path ? 'image/jpeg' : row.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  };

  const range = String(req.headers.range || '');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      let start = match[1] === '' ? null : Number(match[1]);
      let end = match[2] === '' ? null : Number(match[2]);
      if (start === null && end !== null) {
        start = Math.max(0, total - end);
        end = total - 1;
      } else {
        if (start === null) start = 0;
        if (end === null) end = total - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      end = Math.min(end, total - 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  headers['Content-Length'] = total;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

/* -------------------------------------------------------------------- deleting */

export async function removeMediaFiles(row) {
  if (!row) return;
  const files = new Set([row.path, row.poster_path].filter(Boolean));
  for (const file of files) {
    try {
      await fsp.unlink(safeMediaPath(file));
    } catch {
      /* yoksa sorun değil */
    }
  }
}

export async function deleteMediaRow(row) {
  run('DELETE FROM media WHERE id = ?', row.id);
  await removeMediaFiles(row);
}

export function mediaOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    width: row.width,
    height: row.height,
    duration: row.duration,
    size: row.size,
    url: `/api/media/${row.id}`,
    posterUrl: row.poster_path ? `/api/media/${row.id}/poster` : null,
  };
}

/* ------------------------------------------------------------------- cleanup */

export async function cleanupUnattachedMedia() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = all(
    'SELECT * FROM media WHERE attached = 0 AND created_at < ? LIMIT 200',
    cutoff,
  );
  for (const row of rows) {
    // Profil resmi gibi yerlerden referans verilmiş olabilir.
    const refs = get(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE avatar_media = ? OR cover_media = ?) +
        (SELECT COUNT(*) FROM post_media WHERE media_id = ?) +
        (SELECT COUNT(*) FROM stories WHERE media_id = ?) +
        (SELECT COUNT(*) FROM messages WHERE media_id = ? OR sticker_media_id = ?) +
        (SELECT COUNT(*) FROM stickers WHERE media_id = ?) AS n`,
      row.id, row.id, row.id, row.id, row.id, row.id, row.id,
    );
    if (Number(refs.n) > 0) {
      run('UPDATE media SET attached = 1 WHERE id = ?', row.id);
      continue;
    }
    await deleteMediaRow(row);
  }
}

export async function storageStats() {
  let files = 0;
  let bytes = 0;
  try {
    const entries = await fsp.readdir(MEDIA_DIR);
    files = entries.length;
    for (const name of entries) {
      try {
        const stat = await fsp.stat(path.join(MEDIA_DIR, name));
        bytes += stat.size;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return { files, bytes };
}

/* ------------------------------------------------------------------ image size */

export function imageSize(buf) {
  if (!buf || buf.length < 24) return null;

  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // GIF
  if (ascii(buf, 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }

  // WebP
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') {
    const type = ascii(buf, 12, 4);
    if (type === 'VP8X' && buf.length >= 30) {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
    if (type === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (type === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }

  // JPEG — SOF işaretlerini tara
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      if (length < 2) break;
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }

  return null;
}
