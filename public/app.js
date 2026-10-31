/* ==========================================================================
   MelCandy — istemci uygulaması
   Sıfır bağımlılık, tek dosya, modül. Sunucu API'si ile konuşur.
   ========================================================================== */

const S = {
  me: null,
  people: [],
  badges: { notifications: 0, messages: 0, stories: 0, requests: 0 },
  online: [],
  setup: { mode: 'closed', canRegister: false, inviteRequired: false },
  invite: null,
  route: null,
  userPicks: {},
  feedFresh: false,
  es: null,
  typingTimer: 0,
  currentView: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const byId = (id) => document.getElementById(id);

/* --------------------------------------------------------------- escaping */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function icon(name, className = 'ico') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function initials(name) {
  const clean = String(name || '?').trim();
  return clean ? clean.slice(0, 1).toLocaleUpperCase('tr') : '?';
}

function avatarHTML(user, size = '', { dot = false, className = '' } = {}) {
  const safe = user || {};
  const cls = ['avatar', size, className].filter(Boolean).join(' ');
  const inner = safe.avatar
    ? `<img src="/api/media/${esc(safe.avatar)}" alt="" loading="lazy">`
    : `<span class="avatar-initial">${esc(initials(safe.displayName || safe.username))}</span>`;
  const online = dot && safe.online ? '<i class="online-dot" aria-label="çevrimiçi"></i>' : '';
  return `<span class="${cls}"><span class="avatar-media">${inner}</span>${online}</span>`;
}

function activityHTML(user) {
  const activity = user?.activity;
  if (!activity || activity.type === 'none') return '';
  if (activity.type === 'listening') {
    const text = activity.subtitle ? `${activity.subtitle} – ${activity.title}` : activity.title;
    return `<div class="presence-activity"><span class="presence-dot pulse"></span><span class="presence-text">Şu an dinliyor · ${esc(text)}</span></div>`;
  }
  const text = activity.subtitle ? `${activity.title} – ${activity.subtitle}` : activity.title;
  return `<div class="presence-activity"><span class="presence-dot pulse"></span><span class="presence-text">Oynuyor: ${esc(text)}</span></div>`;
}

function presenceHTML(user) {
  const online = Boolean(user && user.online);
  const act = activityHTML(user);
  if (act) return act;
  return `<span class="presence-text ${online ? 'online' : ''}"><i class="presence-dot"></i>${online ? 'şu an çevrimiçi' : 'son görülme bilinmiyor'}</span>`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function fmtCount(n) {
  const value = Number(n) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace('.0', '')} mn`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.0', '')} b`;
  return String(value);
}

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function dateObj(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtDate(value) {
  const date = dateObj(value);
  if (!date) return '';
  return `${date.getDate()} ${TR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function fmtDateShort(value) {
  const date = dateObj(value);
  if (!date) return '';
  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) return `${date.getDate()} ${TR_MONTHS[date.getMonth()]}`;
  return `${date.getDate()} ${TR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function fmtTime(value) {
  const date = dateObj(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fmtDateTime(value) {
  const date = dateObj(value);
  if (!date) return '';
  return `${fmtDate(date)} · ${fmtTime(date)}`;
}

function timeAgo(value) {
  const date = dateObj(value);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 45000) return 'şimdi';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} gün`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} hafta`;
  return fmtDateShort(date);
}

function timeAgoText(value) {
  const label = timeAgo(value);
  if (!label) return '';
  return label === 'şimdi' ? 'az önce' : `${label} önce`;
}

function sameDay(a, b) {
  const da = dateObj(a);
  const db = dateObj(b);
  if (!da || !db) return false;
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function dayLabel(value) {
  const date = dateObj(value);
  if (!date) return '';
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  if (sameDay(date, now)) return 'Bugün';
  if (sameDay(date, yesterday)) return 'Dün';
  const diffDays = Math.round((now - date) / 86400000);
  if (diffDays < 7) return TR_DAYS[date.getDay()];
  return fmtDate(date);
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '');
}

function linkify(text, { tags = true } = {}) {
  let out = esc(text);
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const trimmed = url.replace(/[),.!?]+$/, '');
    const tail = url.slice(trimmed.length);
    return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer nofollow">${trimmed}</a>${tail}`;
  });
  if (tags) {
    out = out.replace(/(^|[\s(])#([\p{L}\p{N}_]{1,40})/gu, (all, pre, tag) => `${pre}<span class="tag">#${tag}</span>`);
    out = out.replace(/(^|[\s(])@([a-zA-Z0-9._]{3,24})/g, (all, pre, user) => `${pre}<a class="tag" href="/u/${encodeURIComponent(user)}" data-go="/u/${encodeURIComponent(user)}">@${user}</a>`);
  }
  return out;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function durationText(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function uid(prefix = 'x') {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

/* -------------------------------------------------------------------- API */

class ApiError extends Error {
  constructor(status, message, code) {
    super(message || 'Bir şeyler ters gitti.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { 'x-ikimiz-client': '1', ...headers },
    signal,
  };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Bağlantı kurulamadı. İnternetini kontrol et.');
  }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) {
    const message = (data && data.error) || (typeof data === 'string' && data) || 'İstek tamamlanamadı.';
    if (response.status === 401 && S.me) sessionLost();
    throw new ApiError(response.status, message, data && data.code);
  }
  return data;
}

function sessionLost() {
  if (S.lost) return;
  S.lost = true;
  S.me = null;
  closeAllOverlays();
  if (S.es) {
    try { S.es.close(); } catch { /* ignore */ }
    S.es = null;
  }
  renderAuth({ message: 'Oturumun sona erdi. Yeniden giriş yap.' });
}

/* ------------------------------------------------------------- local prefs */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.remove();
}

function applySettings(settings = {}) {
  document.documentElement.dataset.reduce = settings.reduceMotion ? '1' : '0';
}

function bootPrefs() {
  try {
    const raw = localStorage.getItem('ikimiz:prefs');
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (prefs.theme) applyTheme(prefs.theme);
    if (prefs.reduce) document.documentElement.dataset.reduce = '1';
  } catch { /* ignore */ }
}

function savePrefs(patch) {
  try {
    const raw = localStorage.getItem('ikimiz:prefs');
    const prefs = raw ? JSON.parse(raw) : {};
    localStorage.setItem('ikimiz:prefs', JSON.stringify({ ...prefs, ...patch }));
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------ notifications */

function toast(message, type = '') {
  const root = byId('toasts');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  const iconName = type === 'success' ? 'check-circle' : type === 'error' ? 'alert' : 'info';
  node.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  root.appendChild(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 240);
  }, type === 'error' ? 5200 : 3400);
}

function haptic(strength = 8) {
  try { navigator.vibrate?.(strength); } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- overlays */

const overlays = [];

function openOverlay(html, { layerClass = '', onClose = null, closeOnBackdrop = true, lock = true } = {}) {
  const layer = document.createElement('div');
  layer.className = `layer open ${layerClass}`.trim();
  layer.innerHTML = `${closeOnBackdrop ? '<div class="layer-backdrop" data-overlay-close></div>' : ''}${html}`;
  document.body.appendChild(layer);
  if (lock) document.body.classList.add('no-scroll');
  const entry = { layer, onClose };
  overlays.push(entry);
  window.dispatchEvent(new CustomEvent('ikimiz:overlay', { detail: { open: true, count: overlays.length } }));
  if (closeOnBackdrop) {
    layer.addEventListener('click', (event) => {
      if (event.target.closest('[data-overlay-close]')) closeOverlay(entry);
    });
  }
  return entry;
}

function closeOverlay(entry) {
  const target = entry || overlays[overlays.length - 1];
  if (!target) return;
  const index = overlays.indexOf(target);
  if (index >= 0) overlays.splice(index, 1);
  target.layer.remove();
  try { target.onClose?.(); } catch (error) { console.error(error); }
  if (!overlays.length) document.body.classList.remove('no-scroll');
  window.dispatchEvent(new CustomEvent('ikimiz:overlay', { detail: { open: false, count: overlays.length } }));
}

function closeAllOverlays() {
  while (overlays.length) closeOverlay(overlays[overlays.length - 1]);
}

function openSheet({ title, sub = '', body = '', foot = '', size = '', className = '', onMount = null, onClose = null, closeOnBackdrop = true }) {
  const entry = openOverlay(
    `<section class="sheet ${size} ${className}" role="dialog" aria-modal="true" aria-label="${esc(stripHtml(title))}">
      <div class="sheet-drag"></div>
      <header class="sheet-head">
        <h2>${esc(title)}</h2>
        ${sub ? `<span class="sheet-sub">${esc(sub)}</span>` : ''}
        <button class="sheet-close" data-overlay-close aria-label="Kapat">${icon('close')}</button>
      </header>
      <div class="sheet-body">${body}</div>
      ${foot ? `<footer class="sheet-foot">${foot}</footer>` : ''}
    </section>`,
    { onClose, closeOnBackdrop },
  );
  if (onMount) onMount(entry.layer, entry);
  return entry;
}

function confirmDialog({ title = 'Emin misin?', message = '', confirmText = 'Onayla', cancelText = 'Vazgeç', danger = false, iconName = 'alert' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeOverlay(entry);
      resolve(value);
    };
    const entry = openSheet({
      title,
      size: 'sheet-sm',
      body: `<div class="confirm-body">
        <div class="empty-icon" style="width:54px;height:54px;border-radius:16px">${icon(iconName, 'ico')}</div>
        <p>${esc(message)}</p>
      </div>`,
      foot: `<div class="form-actions">
        <button class="btn btn-ghost" data-confirm="0">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm="1">${esc(confirmText)}</button>
      </div>`,
      onClose: () => finish(false),
      closeOnBackdrop: true,
    });
    entry.layer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm]');
      if (!button) return;
      finish(button.dataset.confirm === '1');
    });
  });
}

function promptDialog({ title, message = '', label = '', value = '', placeholder = '', confirmText = 'Kaydet', type = 'text', maxlength = 220 }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      closeOverlay(entry);
      resolve(result);
    };
    const entry = openSheet({
      title,
      size: 'sheet-sm',
      body: `<form class="confirm-body" data-prompt-form>
        <p>${esc(message)}</p>
        <div class="field"><label>${esc(label)}</label>
          <div class="input-wrap"><input type="${esc(type)}" name="value" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${Number(maxlength)}" required></div>
        </div>
      </form>`,
      foot: `<div class="form-actions">
        <button class="btn btn-ghost" data-prompt-cancel>Vazgeç</button>
        <button class="btn btn-primary" data-prompt-ok>${esc(confirmText)}</button>
      </div>`,
      onMount: (layer) => {
        const input = layer.querySelector('input');
        setTimeout(() => input?.focus(), 40);
        layer.addEventListener('submit', (event) => {
          event.preventDefault();
          finish(layer.querySelector('input')?.value?.trim() || null);
        });
      },
      onClose: () => finish(null),
    });
    entry.layer.addEventListener('click', (event) => {
      if (event.target.closest('[data-prompt-ok]')) {
        finish(entry.layer.querySelector('input')?.value?.trim() || null);
      } else if (event.target.closest('[data-prompt-cancel]')) {
        finish(null);
      }
    });
  });
}

function choiceSheet({ title, sub = '', items }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeOverlay(entry);
      resolve(value);
    };
    const body = `<div class="menu-list">${items.map((item, index) => `
      <button class="menu-item ${item.danger ? 'danger' : ''}" data-choice="${index}">
        ${item.icon ? icon(item.icon) : ''}<span>${esc(item.label)}</span>
      </button>`).join('')}</div>`;
    const entry = openSheet({
      title,
      sub,
      size: 'sheet-sm',
      body,
      onClose: () => finish(null),
    });
    entry.layer.addEventListener('click', (event) => {
      const button = event.target.closest('[data-choice]');
      if (!button) return;
      const item = items[Number(button.dataset.choice)];
      finish(item ? item.value ?? item.label : null);
    });
  });
}

async function copyText(text, message = 'Bağlantı kopyalandı') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    area.remove();
  }
  toast(message, 'success');
}

async function shareURL(path, title = 'MelCandy') {
  const url = new URL(path, location.origin).href;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  await copyText(url);
}

/* ------------------------------------------------------------------ picker */

function pickFiles({ accept = 'image/*,video/*', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.remove();
      resolve(files);
    }, { once: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    }, { once: true });
    input.click();
  });
}

function fileKind(file) {
  if (!file) return '';
  const type = String(file.type || '');
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const name = String(file.name || '').toLowerCase();
  if (/\.(jpe?g|png|webp|gif|avif|heic)$/.test(name)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(name)) return 'video';
  if (/\.(m4a|mp3|wav|ogg|aac|opus)$/.test(name)) return 'audio';
  return '';
}

/* ------------------------------------------------------------------- media */

const FILTERS = {
  none: { label: 'Orijinal', css: 'none' },
  warm: { label: 'Sıcak', css: 'sepia(.22) saturate(1.18) contrast(1.03)' },
  cool: { label: 'Soğuk', css: 'hue-rotate(-12deg) saturate(1.12) brightness(1.03)' },
  mono: { label: 'Siyah beyaz', css: 'grayscale(1) contrast(1.08)' },
  fade: { label: 'Soluk', css: 'saturate(.72) contrast(.9) brightness(1.06)' },
  vivid: { label: 'Canlı', css: 'saturate(1.42) contrast(1.08)' },
};

function imageFiltersStrip(url) {
  return Object.entries(FILTERS).map(([key, filter]) => `
    <button type="button" class="filter-chip" data-filter="${key}">
      <span class="filter-thumb"><img src="${esc(url)}" alt="" style="filter:${filter.css}"></span>
      <span>${esc(filter.label)}</span>
    </button>`).join('');
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fallback */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('Görsel açılamadı.'));
      node.src = url;
    });
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function cropRect(width, height, ratio) {
  if (!ratio || ratio === 'original') return { x: 0, y: 0, width, height };
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh) return { x: 0, y: 0, width, height };
  const target = rw / rh;
  const current = width / height;
  if (current > target) {
    const nextWidth = Math.round(height * target);
    return { x: Math.round((width - nextWidth) / 2), y: 0, width: nextWidth, height };
  }
  const nextHeight = Math.round(width / target);
  return { x: 0, y: Math.round((height - nextHeight) / 2), width, height: nextHeight };
}

async function processImage(file, { ratio = 'original', filter = 'none', max = 2048, quality = 0.9 } = {}) {
  const bitmap = await loadBitmap(file);
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  if (!width || !height) throw new Error('Görsel boyutu okunamadı.');
  const crop = cropRect(width, height, ratio);
  const scale = Math.min(1, max / Math.max(crop.width, crop.height));
  const outWidth = Math.max(1, Math.round(crop.width * scale));
  const outHeight = Math.max(1, Math.round(crop.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outWidth, outHeight);
  const cssFilter = FILTERS[filter]?.css || 'none';
  if (cssFilter !== 'none') ctx.filter = cssFilter;
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, outWidth, outHeight);
  if (typeof bitmap.close === 'function') bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Görsel işlenemedi.');
  return { blob, width: outWidth, height: outHeight };
}

function adjustImage(file, { ratio = '1:1', title = 'Fotoğrafı ayarla', max = 1024, quality = 0.92, format = 'jpeg' } = {}) {
  return new Promise(async (resolve) => {
    let bitmap;
    try {
      bitmap = await loadBitmap(file);
    } catch (error) {
      toast(error.message || 'Görsel açılamadı.', 'error');
      resolve(null);
      return;
    }
    const naturalW = bitmap.width || bitmap.naturalWidth;
    const naturalH = bitmap.height || bitmap.naturalHeight;
    if (!naturalW || !naturalH) {
      if (typeof bitmap.close === 'function') bitmap.close();
      resolve(null);
      return;
    }

    const parts = String(ratio).split(':').map(Number);
    const ratioValue = parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 1;

    let settled = false;
    let entry = null;
    let sheet = null;
    let stage = null;
    let image = null;
    let slider = null;
    let stageW = 320;
    let stageH = 320;
    let baseScale = 1;
    let zoom = 1;
    let tx = 0;
    let ty = 0;
    let drag = null;
    let cleanupResize = null;

    const geom = () => {
      const scale = baseScale * zoom;
      const drawW = naturalW * scale;
      const drawH = naturalH * scale;
      return { scale, drawW, drawH, maxX: Math.max(0, (drawW - stageW) / 2), maxY: Math.max(0, (drawH - stageH) / 2) };
    };

    const clampOffsets = () => {
      const { maxX, maxY } = geom();
      tx = Math.min(maxX, Math.max(-maxX, tx));
      ty = Math.min(maxY, Math.max(-maxY, ty));
    };

    const paint = () => {
      if (!image) return;
      const { drawW, drawH } = geom();
      image.style.width = `${drawW}px`;
      image.style.height = `${drawH}px`;
      image.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
    };

    const layout = () => {
      if (!stage) return;
      const host = sheet?.clientWidth || 520;
      const maxW = Math.max(160, Math.min(host - 40, 520));
      const maxH = Math.min(window.innerHeight * 0.46, 520);
      stageW = maxW;
      stageH = Math.round(stageW / ratioValue);
      if (stageH > maxH) {
        stageH = Math.max(80, Math.round(maxH));
        stageW = Math.round(stageH * ratioValue);
      }
      stage.style.width = `${stageW}px`;
      stage.style.height = `${stageH}px`;
      baseScale = Math.max(stageW / naturalW, stageH / naturalH);
      clampOffsets();
      paint();
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (typeof bitmap.close === 'function') bitmap.close();
      if (entry) closeOverlay(entry);
      resolve(value);
    };

    const setZoom = (next) => {
      zoom = Math.min(3, Math.max(1, Number(next) || 1));
      if (slider && Number(slider.value) !== zoom) slider.value = String(zoom);
      clampOffsets();
      paint();
    };

    const resetView = () => {
      zoom = 1;
      tx = 0;
      ty = 0;
      if (slider) slider.value = '1';
      paint();
    };

    const applyCrop = async () => {
      if (settled) return;
      const button = entry?.layer.querySelector('[data-crop-apply]');
      if (button) button.disabled = true;
      try {
        const { scale } = geom();
        const cropW = stageW / scale;
        const cropH = stageH / scale;
        const cropX = (naturalW - cropW) / 2 - tx / scale;
        const cropY = (naturalH - cropH) / 2 - ty / scale;
        const outScale = Math.min(1, max / Math.max(cropW, cropH));
        const outW = Math.max(1, Math.round(cropW * outScale));
        const outH = Math.max(1, Math.round(cropH * outScale));
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        if (mime === 'image/png') ctx.clearRect(0, 0, outW, outH);
        ctx.drawImage(bitmap, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
        const blob = await new Promise((done) => canvas.toBlob(done, mime, quality));
        if (!blob) throw new Error('Görsel işlenemedi.');
        finish({ blob, width: outW, height: outH });
      } catch (error) {
        if (button) button.disabled = false;
        toast(error.message || 'Görsel işlenemedi.', 'error');
      }
    };

    entry = openSheet({
      title,
      sub: ratio === '1:1' ? 'kare' : ratio,
      className: 'crop-sheet',
      closeOnBackdrop: false,
      body: `<div class="crop-body">
        <div class="crop-stage" data-crop-stage>
          <img alt="" draggable="false" data-crop-image>
        </div>
        <div class="crop-toolbar">
          <span class="crop-hint">${icon('move')} Sürükleyerek konumlandır</span>
          <label class="crop-zoom">
            ${icon('minus')}
            <input type="range" min="1" max="3" step="0.01" value="1" data-crop-zoom aria-label="Yakınlaştır">
            ${icon('plus')}
          </label>
        </div>
      </div>`,
      foot: `<div class="form-actions">
        <button type="button" class="btn btn-ghost" data-crop-reset>Sıfırla</button>
        <button type="button" class="btn btn-primary" data-crop-apply>${icon('check')} Uygula</button>
      </div>`,
      onMount: (layer) => {
        sheet = layer.querySelector('.sheet');
        stage = layer.querySelector('[data-crop-stage]');
        image = layer.querySelector('[data-crop-image]');
        slider = layer.querySelector('[data-crop-zoom]');
        const url = URL.createObjectURL(file);
        image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        image.src = url;

        layout();
        requestAnimationFrame(layout);

        image.addEventListener('pointerdown', (event) => {
          if (event.button && event.button !== 0) return;
          event.preventDefault();
          drag = { id: event.pointerId, x: event.clientX, y: event.clientY, tx, ty };
          stage.classList.add('dragging');
          try { stage.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        });
        stage.addEventListener('pointermove', (event) => {
          if (!drag || event.pointerId !== drag.id) return;
          event.preventDefault();
          tx = drag.tx + (event.clientX - drag.x);
          ty = drag.ty + (event.clientY - drag.y);
          clampOffsets();
          paint();
        });
        const endDrag = (event) => {
          if (!drag || event.pointerId !== drag.id) return;
          drag = null;
          stage.classList.remove('dragging');
          try { stage.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
        };
        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);

        stage.addEventListener('wheel', (event) => {
          event.preventDefault();
          setZoom(zoom - event.deltaY * 0.0018);
        }, { passive: false });

        slider.addEventListener('input', () => setZoom(slider.value));

        layer.addEventListener('click', (event) => {
          if (event.target.closest('[data-overlay-close]')) {
            finish(null);
            return;
          }
          if (event.target.closest('[data-crop-reset]')) resetView();
          if (event.target.closest('[data-crop-apply]')) applyCrop();
        });

        window.addEventListener('resize', layout);
        cleanupResize = () => window.removeEventListener('resize', layout);
      },
      onClose: () => {
        cleanupResize?.();
        finish(null);
      },
    });
  });
}

function videoFallbackPoster(width = 720, height = 1280) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#34363c');
  gradient.addColorStop(1, '#1a1b1e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const radius = Math.min(canvas.width, canvas.height) * 0.09;
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
  ctx.fill();
  const size = radius * 0.75;
  ctx.fillStyle = '#1e1f22';
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2 - size * 0.55, canvas.height / 2 - size);
  ctx.lineTo(canvas.width / 2 + size * 1.05, canvas.height / 2);
  ctx.lineTo(canvas.width / 2 - size * 0.55, canvas.height / 2 + size);
  ctx.closePath();
  ctx.fill();
  return canvas.toDataURL('image/jpeg', 0.82);
}

function readVideo(file, { seek = 0.3 } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    let done = false;
    let seekTimer = 0;
    let hardTimer = 0;

    const cleanup = () => {
      clearTimeout(seekTimer);
      clearTimeout(hardTimer);
      video.removeAttribute('src');
      video.load?.();
      URL.revokeObjectURL(url);
    };

    const finish = () => {
      if (done) return;
      done = true;
      const width = video.videoWidth || 720;
      const height = video.videoHeight || 1280;
      const rawDuration = Number(video.duration);
      const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
      let poster = '';
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 1280 / Math.max(width, height || 1));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        poster = canvas.toDataURL('image/jpeg', 0.82);
      } catch {
        poster = '';
      }
      if (!poster || poster.length < 128) poster = videoFallbackPoster(width, height);
      cleanup();
      resolve({ width, height, duration, poster });
    };

    video.addEventListener('error', finish, { once: true });
    video.addEventListener('seeked', finish, { once: true });
    video.addEventListener('loadedmetadata', () => {
      const rawDuration = Number(video.duration);
      const finite = Number.isFinite(rawDuration) && rawDuration > 0;
      const time = finite
        ? Math.min(Math.max(seek, 0.05), Math.max(0.05, rawDuration * 0.35))
        : 0.05;
      try {
        video.currentTime = time;
      } catch {
        /* bazı tarayıcılar ilk karede kalmayı reddeder */
      }
      // MediaRecorder kayıtlarında duration Infinity olabilir ve seeked hiç gelmeyebilir.
      video.addEventListener('loadeddata', finish, { once: true });
      seekTimer = setTimeout(finish, finite ? 3200 : 1800);
    });
    hardTimer = setTimeout(finish, 12000);
  });
}

function uploadMedia(blob, { kind, width = 0, height = 0, duration = 0, name = 'dosya', onProgress = null }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-ikimiz-client', '1');
    xhr.setRequestHeader('x-media-kind', kind);
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    if (width) xhr.setRequestHeader('x-width', String(width));
    if (height) xhr.setRequestHeader('x-height', String(height));
    if (duration) xhr.setRequestHeader('x-duration', String(duration));
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total, name);
    });
    xhr.addEventListener('load', () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.media) resolve(data.media);
      else reject(new ApiError(xhr.status, data?.error || 'Yükleme başarısız oldu.', data?.code));
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, 'Yükleme sırasında bağlantı kesildi.')));
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'Yükleme iptal edildi.')));
    xhr.send(blob);
  });
}

function uploadPoster(mediaId, blob) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/media/${encodeURIComponent(mediaId)}/poster`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-ikimiz-client', '1');
    xhr.setRequestHeader('content-type', 'image/jpeg');
    xhr.addEventListener('load', () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data?.media || null);
      else reject(new ApiError(xhr.status, data?.error || 'Kapak yüklenemedi.'));
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, 'Kapak yüklenemedi.')));
    xhr.send(blob);
  });
}

async function dataURLtoBlob(dataUrl) {
  const text = String(dataUrl || '');
  if (!text.startsWith('data:')) {
    const response = await fetch(text);
    return response.blob();
  }
  const comma = text.indexOf(',');
  if (comma < 0) throw new Error('Geçersiz veri adresi.');
  const header = text.slice(5, comma);
  const payload = text.slice(comma + 1);
  const mime = header.split(';')[0] || 'application/octet-stream';
  if (/;base64/i.test(header)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

/* --------------------------------------------------------------- progress */

function progressOverlay(title = 'Paylaşılıyor') {
  const entry = openOverlay(
    `<div class="upload-overlay">
      <div class="upload-card">
        <div class="empty-icon" style="width:54px;height:54px;border-radius:16px">${icon('sparkle')}</div>
        <h3>${esc(title)}</h3>
        <p data-progress-label>Hazırlanıyor…</p>
        <div class="upload-track"><i data-progress-bar></i></div>
        <div class="upload-steps">
          <div class="upload-step active" data-step="0">${icon('check')}<span>Medya hazırlanıyor</span></div>
          <div class="upload-step" data-step="1">${icon('check')}<span>Yükleniyor</span></div>
          <div class="upload-step" data-step="2">${icon('check')}<span>Paylaşılıyor</span></div>
        </div>
      </div>
    </div>`,
    { closeOnBackdrop: false },
  );
  const layer = entry.layer;
  return {
    entry,
    step(index, text) {
      $$('.upload-step', layer).forEach((node) => {
        const n = Number(node.dataset.step);
        node.classList.toggle('done', n < index);
        node.classList.toggle('active', n === index);
      });
      if (text) $('[data-progress-label]', layer).textContent = text;
      $('[data-progress-bar]', layer).style.width = index === 0 ? '8%' : index === 1 ? '38%' : '82%';
    },
    progress(value, text) {
      const pct = Math.max(4, Math.min(96, Math.round(value * 100)));
      $('[data-progress-bar]', layer).style.width = `${pct}%`;
      if (text) $('[data-progress-label]', layer).textContent = text;
    },
    done() {
      $('[data-progress-bar]', layer).style.width = '100%';
      $$('.upload-step', layer).forEach((node) => node.classList.add('done'));
      closeOverlay(entry);
    },
    fail(message) {
      closeOverlay(entry);
      toast(message || 'Yükleme başarısız oldu.', 'error');
    },
  };
}

/* ------------------------------------------------------------- misc shared */

function assetFor(media, { thumb = false } = {}) {
  if (!media) return '';
  return thumb && media.posterUrl ? media.posterUrl : media.url;
}

function mediaPreviewHTML(media, { controls = false, className = '', autoplay = false, muted = true, fit = 'cover' } = {}) {
  if (!media) return '';
  if (media.kind === 'video') {
    return `<video class="${className}" src="${esc(media.url)}" ${media.posterUrl ? `poster="${esc(media.posterUrl)}"` : ''} controls playsinline preload="metadata" ${autoplay ? 'autoplay' : ''} ${muted ? 'muted' : ''} style="object-fit:${fit}"></video>`;
  }
  return `<img class="${className}" src="${esc(media.url)}" alt="" loading="lazy" style="object-fit:${fit}">`;
}

function postThumb(post) {
  const media = post.media?.[0];
  if (!media) return '';
  if (media.kind === 'video') {
    return `${media.posterUrl ? `<img src="${esc(media.posterUrl)}" alt="" loading="lazy">` : `<video src="${esc(media.url)}" muted playsinline preload="metadata"></video>`}`;
  }
  return `<img src="${esc(media.url)}" alt="" loading="lazy">`;
}

function setNavBadges() {
  $$('[data-badge]').forEach((node) => {
    const key = node.dataset.badge;
    const count = Number(S.badges?.[key] || 0);
    node.textContent = count > 99 ? '99+' : String(count);
    node.classList.toggle('hidden', count <= 0);
  });
  const titleBadge = Number(S.badges?.messages || 0) + Number(S.badges?.notifications || 0) + Number(S.badges?.requests || 0);
  document.title = titleBadge > 0 ? `(${titleBadge}) MelCandy` : 'MelCandy';
}

function refreshBadges(badges) {
  if (badges) S.badges = { ...S.badges, ...badges };
  setNavBadges();
  try { renderShell(); } catch { /* ignore */ }
}

function isMe(user) {
  return Boolean(user && S.me && user.id === S.me.id);
}

/* ------------------------------------------------------------------- auth */

function authArtHTML() {
  return `<aside class="auth-art">
    <div class="auth-art-top">
      <span class="brand-mark">${icon('logo')}</span>
      <div><span class="brand-word">melcandy</span></div>
    </div>
    <div class="auth-art-mid">
      <p class="auth-quote">Dünya kalabalık.<br><em>Senin yerin</em><br>burada.</p>
      <p class="auth-art-sub">Fotoğraflar, hikâyeler, sesli mesajlar ve küçük anlar. Kayıtlı herkesin paylaştığı, reklamsız bir alan.</p>
    </div>
    <div class="auth-art-foot">
      <span>${icon('lock')} küçük topluluk</span>
      <span>${icon('heart')} herkes için</span>
      <span>${icon('shield')} reklamsız</span>
    </div>
  </aside>`;
}

function authModeFromSetup(setup) {
  return setup.mode === 'first' ? 'setup' : 'login';
}

function renderAuth({ message = '', inviteCode = '', initialMode = '' } = {}) {
  S.me = null;
  closeAllOverlays();
  hideBoot();
  const params = new URLSearchParams(location.search);
  const urlInvite = inviteCode || params.get('davet') || '';
  const setup = S.setup || { mode: 'closed' };
  let mode = initialMode || authModeFromSetup(setup);
  if (urlInvite && setup.canRegister && !initialMode) mode = 'setup';
  const canSetup = Boolean(setup.canRegister);
  if (!canSetup) mode = 'login';

  const app = byId('app');
  app.innerHTML = `<div class="auth-screen">
    ${authArtHTML()}
    <section class="auth-panel">
      <div class="auth-card">
        <div class="auth-mobile-brand">
          <span class="brand-mark">${icon('logo')}</span>
          <span class="brand-word">melcandy</span>
        </div>
        <h1 class="auth-title" data-auth-title>${mode === 'setup' ? (setup.mode === 'first' ? 'İlk hesabını oluştur' : 'Hesap oluştur') : 'Tekrar hoş geldin'}</h1>
        <p class="auth-lead" data-auth-lead>${mode === 'setup'
          ? (setup.mode === 'first' ? 'İlk hesabı sen oluştur. Sonra arkadaşlarını davet edebilirsin.' : 'Birkaç saniyede hesabını oluştur ve paylaşmaya başla.')
          : 'Kaldığın yerden devam et.'}</p>

        ${canSetup ? `<div class="auth-tabs" data-auth-tabs ${setup.mode === 'first' ? 'hidden' : ''}>
          <button type="button" class="auth-tab ${mode === 'login' ? 'active' : ''}" data-auth-mode="login">Giriş yap</button>
          <button type="button" class="auth-tab ${mode === 'setup' ? 'active' : ''}" data-auth-mode="setup">${setup.mode === 'first' ? 'Hesap oluştur' : 'Kayıt ol'}</button>
        </div>` : ''}

        ${urlInvite && canSetup ? `<div class="auth-note info" style="margin-top:18px">${icon('link')}<span>Davet bağlantısı algılandı. Kayıt olurken bu bağlantıyı kullanabilirsin.</span></div>` : ''}
        ${setup.mode === 'closed' ? `<div class="auth-note info" style="margin-top:18px">${icon('lock')}<span>Kayıtlar şu anda kapalı. Yalnızca mevcut hesaplar giriş yapabilir.</span></div>` : ''}
        ${message ? `<div class="form-error" style="margin-top:16px" data-auth-error>${esc(message)}</div>` : '<div class="form-error hidden" data-auth-error></div>'}

        <form class="auth-form" data-auth-form autocomplete="on">
          ${mode === 'setup' ? `
            <div class="field"><label for="auth-display">Görünen ad</label>
              <div class="input-wrap">${icon('user')}<input id="auth-display" name="displayName" maxlength="40" placeholder="Adın" autocomplete="name" required></div>
            </div>
            <div class="field"><label for="auth-username">Kullanıcı adı <span class="hint">küçük harf, rakam, nokta</span></label>
              <div class="input-wrap">${icon('link')}<input id="auth-username" name="username" maxlength="24" placeholder="mesela can" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
            </div>
            <div class="field"><label for="auth-password">Şifre</label>
              <div class="input-wrap">${icon('lock')}<input id="auth-password" name="password" type="password" minlength="8" maxlength="200" placeholder="En az 8 karakter" autocomplete="new-password" required></div>
              <div class="strength" data-strength data-score="0"><i></i><i></i><i></i><i></i></div>
            </div>
          ` : `
            <div class="field"><label for="auth-username">Kullanıcı adı</label>
              <div class="input-wrap">${icon('user')}<input id="auth-username" name="username" maxlength="24" placeholder="Kullanıcı adın" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
            </div>
            <div class="field"><label for="auth-password">Şifre</label>
              <div class="input-wrap">${icon('lock')}<input id="auth-password" name="password" type="password" maxlength="200" placeholder="Şifren" autocomplete="current-password" required></div>
            </div>
          `}
          <button class="btn btn-primary btn-lg btn-block" type="submit" data-auth-submit>${mode === 'setup' ? 'Hesabı oluştur' : 'Giriş yap'}</button>
        </form>
        <p class="auth-switch">
          ${mode === 'login' && canSetup ? `Henüz hesabın yok mu? <button type="button" data-auth-mode="setup">${setup.mode === 'first' ? 'İlk hesabı oluştur' : 'Kayıt ol'}</button>` : ''}
          ${mode === 'setup' ? `Zaten hesabın var mı? <button type="button" data-auth-mode="login">Giriş yap</button>` : ''}
          ${!canSetup ? `Yeni bir cihaz mı? <button type="button" data-auth-mode="login">Giriş yap</button>` : ''}
        </p>
        <p class="auth-note info" style="margin-top:20px">${icon('info')}<span>Bu uygulama arama motorlarına kapalıdır. Veriler yalnızca bu sunucuda saklanır.</span></p>
      </div>
    </section>
  </div>`;

  bindAuth(app, { mode });
}

function bindAuth(app, { mode }) {
  const form = $('[data-auth-form]', app);
  const errorBox = $('[data-auth-error]', app);
  const submit = $('[data-auth-submit]', app);
  const strength = $('[data-strength]', app);

  const onClick = (event) => {
    const modeButton = event.target.closest('[data-auth-mode]');
    if (!modeButton) return;
    const nextMode = modeButton.dataset.authMode;
    if (nextMode === mode) return;
    renderAuth({ message: '', initialMode: nextMode });
    const target = nextMode === 'setup' ? $('[name="displayName"]') : $('[name="username"]');
    setTimeout(() => target?.focus(), 60);
  };
  if (app._authClick) app.removeEventListener('click', app._authClick);
  app._authClick = onClick;
  app.addEventListener('click', onClick);

  if (strength) {
    const password = $('[name="password"]', form);
    password?.addEventListener('input', () => {
      const value = password.value;
      let score = 0;
      if (value.length >= 8) score += 1;
      if (value.length >= 12) score += 1;
      if (/[A-ZĞÜŞİÖÇ]/.test(value) && /[a-zğüşıöç]/.test(value)) score += 1;
      if (/\d/.test(value) && /[^\w\s]/.test(value)) score += 1;
      strength.dataset.score = String(value ? Math.max(1, score) : 0);
    });
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    submit.disabled = true;
    const previous = submit.textContent;
    submit.innerHTML = '<span class="spinner" style="width:18px;height:18px"></span>';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      if (mode === 'setup') {
        const result = await api('/api/setup', {
          method: 'POST',
          body: {
            username: data.username,
            displayName: data.displayName,
            password: data.password,
          },
        });
        if (result.invite?.code) {
          toast('Hesabın hazır. Arkadaşlarını davet edebilirsin.', 'success');
        }
      } else {
        await api('/api/login', { method: 'POST', body: { username: data.username, password: data.password } });
      }
      await bootstrapAndEnter();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
      submit.disabled = false;
      submit.textContent = previous;
      haptic(18);
      const password = $('[name="password"]', form);
      if (error.status === 401) {
        password?.focus();
        password?.select();
      }
    }
  });

  setTimeout(() => $('[name="username"]', app)?.focus(), 80);
}

/* ------------------------------------------------------------------ shell */

const NAV_ITEMS = [
  { path: '/', label: 'Ana akış', icon: 'home', fill: 'home-fill', match: (path) => path === '/' },
  { path: '/arkadaslar', label: 'Arkadaşlar', icon: 'users', badge: 'requests', match: (path) => path.startsWith('/arkadaslar') },
  { path: '/mesajlar', label: 'Mesajlar', icon: 'message', badge: 'messages', match: (path) => path.startsWith('/mesajlar') },
  { path: '/bildirimler', label: 'Bildirimler', icon: 'bell', fill: 'bell-fill', badge: 'notifications', match: (path) => path.startsWith('/bildirimler') },
];

function navLinkHTML(item, path, mobile = false) {
  const active = item.match(path);
  if (mobile) {
    return `<a class="tab-item ${active ? 'active' : ''} ${item.create ? 'create-tab' : ''}" href="${item.path}" data-go="${item.path}" aria-label="${esc(item.label)}">
      ${item.icon === 'users' ? `<svg class="ico tab-line" aria-hidden="true"><use href="#i-users"></use></svg><svg class="ico tab-fill" aria-hidden="true"><use href="#i-users"></use></svg>` : `${icon(item.icon, 'ico tab-line')}${icon(item.fill || item.icon, 'ico tab-fill')}`}
      ${item.badge ? `<span class="nav-badge ${Number(S.badges?.[item.badge] || 0) ? '' : 'hidden'}" data-badge="${item.badge}">${esc(String(S.badges?.[item.badge] || 0))}</span>` : ''}
    </a>`;
  }
  return `<a class="nav-link ${active ? 'active' : ''} ${item.create ? 'create-link' : ''}" href="${item.path}" data-go="${item.path}">
    ${icon(item.icon, 'ico nav-line')}${item.fill ? icon(item.fill, 'ico nav-fill') : icon(item.icon, 'ico nav-fill')}
    <span>${esc(item.label)}</span>
    ${item.badge ? `<span class="nav-badge ${Number(S.badges?.[item.badge] || 0) ? '' : 'hidden'}" data-badge="${item.badge}">${esc(String(S.badges?.[item.badge] || 0))}</span>` : ''}
  </a>`;
}

function renderShell() {
  const me = S.me || {};
  const user = S.me || me || {};
  const path = location.pathname;
  const app = byId('app');
  if (!app) return;
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/" data-go="/" aria-label="MelCandy ana akış">
        <span class="brand-mark">${icon('logo')}</span>
        <span><span class="brand-word">melcandy</span><span class="brand-sub">sosyal</span></span>
      </a>
      <nav class="nav" aria-label="Ana menü">
        ${NAV_ITEMS.map((item) => navLinkHTML(item, path)).join('')}
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-foot">
        <a class="side-profile" href="/u/${esc(user.username || me.username || '')}" data-go="/u/${esc(user.username || me.username || '')}">
          ${avatarHTML(user, '', { dot: true })}
          <span class="side-profile-meta"><strong>${esc(user.displayName || me.displayName || 'Profilin')}</strong><span>@${esc(user.username || me.username || '')}</span>${user.activity && user.activity.type !== 'none' ? `<span class="side-activity">${user.activity.type === 'listening' ? '🎧' : '🎮'} ${esc((user.activity.title || '').slice(0, 20))}</span>` : ''}</span>
        </a>
        <a class="nav-link" href="/ayarlar" data-go="/ayarlar">${icon('settings')}<span>Ayarlar</span></a>
      </div>
    </aside>

    <header class="mobile-top">
      <a class="mobile-brand" href="/" data-go="/" aria-label="MelCandy ana akış">
        <span class="brand-mark">${icon('logo')}</span>
        <span class="brand-word">melcandy</span>
      </a>
      <div class="mobile-top-actions">
        <a class="icon-btn" href="/bildirimler" data-go="/bildirimler" aria-label="Bildirimler" style="position:relative">
          ${icon('bell')}
          <span class="nav-badge ${Number(S.badges?.notifications || 0) ? '' : 'hidden'}" data-badge="notifications" style="position:absolute;top:2px;right:2px;margin:0">${esc(String(S.badges?.notifications || 0))}</span>
        </a>
        <a class="icon-btn" href="/u/${esc(user.username || me.username || '')}" data-go="/u/${esc(user.username || me.username || '')}" aria-label="Profil">
          ${avatarHTML(user, 'avatar-sm')}
        </a>
      </div>
    </header>

    <main class="main"><div id="view"></div></main>

    <nav class="tabbar" aria-label="Alt menü">
      ${NAV_ITEMS.map((item) => navLinkHTML(item, path, true)).join('')}
      <a class="tab-item ${path === '/olustur' ? 'active' : ''} create-tab" href="/olustur" data-go="/olustur" aria-label="Oluştur">${icon('plus-square')}</a>
    </nav>
  </div>`;

  setNavBadges();
}

/* ----------------------------------------------------------------- router */

const ROUTES = [
  { name: 'feed', re: /^\/$/ },
  { name: 'messages', re: /^\/mesajlar\/?$/ },
  { name: 'conversation', re: /^\/mesajlar\/([^/]+)\/?$/ },
  { name: 'notifications', re: /^\/bildirimler\/?$/ },
  { name: 'composer', re: /^\/olustur\/?$/ },
  { name: 'settings', re: /^\/ayarlar\/?$/ },
  { name: 'profileEdit', re: /^\/ayarlar\/profil\/?$/ },
  { name: 'profile', re: /^\/u\/([^/]+)\/?$/ },
  { name: 'postDetail', re: /^\/p\/([^/]+)\/?$/ },
  { name: 'saved', re: /^\/(kaydedilenler|kaydedilen)\/?$/ },
  { name: 'archive', re: /^\/(arsiv|arşiv)\/?$/ },
];

function matchRoute(pathname) {
  for (const route of ROUTES) {
    const match = route.re.exec(pathname);
    if (match) {
      return {
        name: route.name,
        params: match.length > 1 ? { id: decodeURIComponent(match[1] || '') } : {},
        search: new URLSearchParams(location.search),
      };
    }
  }
  return { name: 'notFound', params: {}, search: new URLSearchParams(location.search) };
}

const Views = {};

async function route() {
  if (!S.me) return;
  const parsed = matchRoute(location.pathname);
  S.route = parsed;
  closeAllOverlays();
  try { S.currentView?.cleanup?.(); } catch (error) { console.error(error); }
  S.currentView = null;
  renderShell();
  const root = byId('view');
  const view = Views[parsed.name] || Views.notFound;
  if (!view) {
    root.innerHTML = `<div class="view"><div class="empty-state"><h3>Sayfa bulunamadı</h3></div></div>`;
    return;
  }
  if (!['messages', 'conversation'].includes(parsed.name)) window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    const cleanup = await view(root, parsed);
    S.currentView = { name: parsed.name, cleanup: typeof cleanup === 'function' ? cleanup : null };
  } catch (error) {
    console.error(error);
    root.innerHTML = `<div class="view"><div class="empty-state">
      <div class="empty-icon">${icon('alert')}</div>
      <h3>Bu sayfa yüklenemedi</h3>
      <p>${esc(error.message || 'Bilinmeyen bir hata oluştu.')}</p>
      <button class="btn btn-primary" data-go="${esc(location.pathname)}">${icon('refresh')} Yeniden dene</button>
      <button class="btn btn-ghost" data-go="/">${icon('home')} Ana akışa dön</button>
    </div></div>`;
  }
}

function navigate(path, { replace = false, keepScroll = false } = {}) {
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin) {
    location.href = target.href;
    return;
  }
  const current = `${location.pathname}${location.search}`;
  const next = `${target.pathname}${target.search}`;
  if (current === next) {
    route();
    return;
  }
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  history[replace ? 'replaceState' : 'pushState']({}, '', next);
  route();
}

/* -------------------------------------------------------------------- SSE */

const SSE_EVENTS = [
  'ready', 'hello', 'badges', 'presence', 'notification', 'post:new', 'post:update', 'post:delete',
  'like', 'comment:new', 'comment:update', 'comment:delete', 'comment:like',
  'story:new', 'story:update', 'story:view', 'message:new', 'message:update', 'message:delete',
  'message:reaction', 'message:seen', 'typing', 'follow:update',
  'users:update', 'profile:update',
];

function emit(type, data) {
  window.dispatchEvent(new CustomEvent('ikimiz:event', { detail: { type, data } }));
}

function connectSSE() {
  if (S.es) {
    try { S.es.close(); } catch { /* ignore */ }
    S.es = null;
  }
  if (!S.me) return;
  const source = new EventSource('/api/events');
  S.es = source;
  for (const type of SSE_EVENTS) {
    source.addEventListener(type, (event) => {
      let data = {};
      try { data = JSON.parse(event.data || '{}'); } catch { /* ignore */ }
      handleSSE(type, data);
      emit(type, data);
    });
  }
  source.addEventListener('error', () => {
    // EventSource kendisi yeniden bağlanır.
  });
}

const NOTIFICATION_TEXT = {
  like: 'gönderini beğendi',
  comment: 'gönderine yorum yaptı',
  reply: 'yorumuna yanıt verdi',
  mention: 'senden bahsetti',
  comment_like: 'yorumunu beğendi',
  follow: 'seni takip etmeye başladı',
  message: 'sana mesaj gönderdi',
  story_reply: 'hikâyene yanıt verdi',
  story_reaction: 'hikâyene tepki verdi',
};

function handleSSE(type, data) {
  switch (type) {
    case 'ready':
      if (Array.isArray(data.online)) {
        S.online = data.online;
        S.me && (S.me.online = data.online.includes(S.me.id));
      }
      break;
    case 'badges':
      refreshBadges(data);
      break;
    case 'presence':
      if (Array.isArray(data.online)) {
        S.online = data.online;
        if (S.me) S.me.online = data.online.includes(S.me.id);
      }
      break;
    case 'message:new': {
      const message = data.message;
      const own = message && message.mine;
      if (!own && !['messages', 'conversation'].includes(S.currentView?.name)) {
        toast(`${message.sender?.displayName || 'Yeni mesaj'}: ${message.media ? 'bir medya gönderdi' : String(message.body || '').slice(0, 70)}`, '');
      }
      break;
    }
    case 'notification': {
      const notif = data.notification || data;
      const actor = notif?.actor?.displayName || 'Birisi';
      if (!['notifications'].includes(S.currentView?.name)) {
        toast(`${actor} ${NOTIFICATION_TEXT[notif?.type] || 'bir şey yaptı'}.`, '');
      }
      break;
    }
    default:
      break;
  }
}

/* -------------------------------------------------------------- app start */

async function bootstrapAndEnter() {
  const boot = await api('/api/bootstrap');
  if (!boot.authenticated) {
    S.setup = boot.setup || S.setup;
    renderAuth();
    return;
  }
  await enterApp(boot);
}

async function enterApp(boot) {
  S.me = boot.me;
  S.badges = boot.badges || { notifications: 0, messages: 0, stories: 0, requests: 0 };
  S.online = boot.online || [];
  S.setup = boot.setup || S.setup;
  S.invite = boot.invite || null;
  S.lost = false;
  applyTheme(S.me.theme || 'system');
  applySettings(S.me.settings || {});
  hideBoot();
  connectSSE();
  await route();
}

function hideBoot() {
  const boot = byId('boot');
  if (!boot || boot.classList.contains('done')) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 500);
}

function renderFatal(message) {
  hideBoot();
  byId('app').innerHTML = `<div class="pending-screen"><div class="pending-card fatal-card">
    <div class="pending-icon">${icon('wifi-off')}</div>
    <h1>Uygulamaya ulaşılamadı</h1>
    <p>${esc(message || 'Sunucu ile bağlantı kurulamadı. Sunucunun çalıştığından emin ol.')}</p>
    <button class="btn btn-primary" data-fatal-retry>${icon('refresh')} Yeniden dene</button>
  </div></div>`;
  byId('app').addEventListener('click', (event) => {
    if (event.target.closest('[data-fatal-retry]')) location.reload();
  });
}

function wireGlobals() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-go]');
    if (!target) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(target.dataset.go);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlays.length) {
      event.preventDefault();
      closeOverlay();
    }
  });

  window.addEventListener('popstate', () => { route(); });

  const banner = document.createElement('div');
  banner.className = 'offline-banner hidden';
  banner.innerHTML = `${icon('wifi-off')}<span>Çevrimdışısın. Bağlantı gelince devam edecek.</span>`;
  document.body.appendChild(banner);
  const setOnline = () => {
    banner.classList.toggle('hidden', navigator.onLine);
    if (navigator.onLine && S.me) api('/api/bootstrap').then((boot) => {
      if (boot.authenticated) {
        S.badges = boot.badges || S.badges;
        setNavBadges();
        emit('reconnected', boot);
      }
    }).catch(() => {});
  };
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  setOnline();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.me) {
      api('/api/badges').then((data) => refreshBadges(data.badges)).catch(() => {});
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

async function start() {
  bootPrefs();
  wireGlobals();
  hideBoot();
  try {
    const boot = await api('/api/bootstrap');
    S.setup = boot.setup || S.setup;
    if (!boot.authenticated) {
      renderAuth();
      return;
    }
    await enterApp(boot);
  } catch (error) {
    if (error.status === 0) renderFatal(error.message);
    else {
      // Bootstrap bozulsa bile config ile giriş ekranına düş.
      try {
        const config = await api('/api/config');
        S.setup = config.setup;
      } catch { /* ignore */ }
      renderAuth({ message: error.message });
    }
  }
}

/* ------------------------------------------------------------------- feed */

S.posts = new Map();

function cachePost(post) {
  if (post?.id) S.posts.set(post.id, post);
  return post;
}

function cachedPost(id) {
  return S.posts.get(id) || null;
}

function postCacheUpdate(patch) {
  if (!patch?.id) return;
  const existing = S.posts.get(patch.id);
  if (existing) S.posts.set(patch.id, { ...existing, ...patch });
}

function daysBetween(start, end = new Date()) {
  const first = dateObj(start);
  const last = dateObj(end);
  if (!first || !last) return 0;
  return Math.max(0, Math.floor((last - first) / 86400000));
}

function feedSkeletonHTML(count = 2) {
  return Array.from({ length: count }, () => `<article class="post-card" aria-hidden="true">
    <div class="post-head">
      <span class="skeleton" style="width:40px;height:40px;border-radius:50%"></span>
      <div style="flex:1;display:grid;gap:6px"><span class="skeleton skeleton-line" style="width:34%"></span><span class="skeleton skeleton-line" style="width:22%;height:9px"></span></div>
    </div>
    <div class="skeleton" style="aspect-ratio:4/5;border-radius:0"></div>
    <div class="post-body" style="display:grid;gap:8px;padding-top:8px">
      <span class="skeleton skeleton-line" style="width:52%"></span>
      <span class="skeleton skeleton-line" style="width:78%"></span>
      <span class="skeleton skeleton-line" style="width:40%;height:9px"></span>
    </div>
  </article>`).join('');
}

function storiesStripHTML(groups) {
  const own = groups.find((group) => group.user.id === S.me?.id);
  const others = groups.filter((group) => group.user.id !== S.me?.id);
  const mineItem = own
    ? `<button class="story-item ${own.allViewed ? 'viewed' : ''}" data-story-user="${esc(own.user.id)}">
        <span class="story-ring ${own.allViewed ? 'viewed' : ''}">
          <span class="story-ring-inner">${own.stories.at(-1)?.media?.kind === 'video' && !own.stories.at(-1)?.media?.posterUrl
            ? `<video src="${esc(own.stories.at(-1).media.url)}" muted playsinline preload="metadata"></video>`
            : `<img src="${esc(own.stories.at(-1)?.media?.posterUrl || own.stories.at(-1)?.media?.url || '')}" alt="">`}</span>
          <span class="story-plus" data-story-new>${icon('plus')}</span>
        </span>
        <span class="story-name">Hikâyen</span>
      </button>`
    : `<button class="story-item" data-story-new>
        <span class="story-ring mine-empty">
          <span class="story-ring-inner">${avatarHTML(S.me || {}, '', { className: 'story-avatar-fallback' })}</span>
          <span class="story-plus">${icon('plus')}</span>
        </span>
        <span class="story-name">Hikâyen</span>
      </button>`;

  const otherItems = others.map((group) => {
    const latest = group.stories.at(-1);
    const thumb = latest?.media?.kind === 'video' && !latest.media.posterUrl
      ? `<video src="${esc(latest.media.url)}" muted playsinline preload="metadata"></video>`
      : `<img src="${esc(latest?.media?.posterUrl || latest?.media?.url || '')}" alt="">`;
    return `<button class="story-item ${group.allViewed ? 'viewed' : ''}" data-story-user="${esc(group.user.id)}">
      <span class="story-ring ${group.allViewed ? 'viewed' : ''}">
        <span class="story-ring-inner">${thumb}</span>
      </span>
      <span class="story-name">${esc(group.user.displayName?.split(' ')[0] || group.user.username)}</span>
    </button>`;
  }).join('');

  return `<div class="stories-wrap"><div class="stories" role="list" aria-label="Hikâyeler">${mineItem}${otherItems}</div></div>`;
}

function postMediaHTML(post, { page = false } = {}) {
  const media = post.media || [];
  if (!media.length) return '';
  const slides = media.map((item, index) => {
    const ratioRaw = item.width && item.height ? item.width / item.height : 1;
    const ratio = Math.min(Math.max(ratioRaw, 0.8), 1.91);
    if (item.kind === 'video') {
      return `<div class="post-slide" style="aspect-ratio:${ratio}">
        <video src="${esc(item.url)}" ${item.posterUrl ? `poster="${esc(item.posterUrl)}"` : ''} controls playsinline preload="metadata" ${index === 0 ? '' : 'preload="none"'}></video>
      </div>`;
    }
    return `<div class="post-slide" style="aspect-ratio:${ratio}">
      <img src="${esc(item.url)}" alt="${esc(post.altText || '')}" loading="${index === 0 ? 'eager' : 'lazy'}" draggable="false">
    </div>`;
  }).join('');

  const hasVideo = media.some((item) => item.kind === 'video');
  return `<div class="post-media" data-post-media ${page ? 'data-page-media' : ''}>
    <div class="carousel" data-carousel tabindex="0" aria-label="Gönderi medyası">${slides}</div>
    ${media.length > 1 ? `
      <button class="carousel-btn prev" data-carousel-step="-1" aria-label="Önceki">${icon('chevron-left')}</button>
      <button class="carousel-btn next" data-carousel-step="1" aria-label="Sonraki">${icon('chevron-right')}</button>
      <span class="carousel-count" data-carousel-count>1/${media.length}</span>
      <div class="carousel-dots" data-carousel-dots>${media.map((_, index) => `<span class="carousel-dot ${index === 0 ? 'active' : ''}"></span>`).join('')}</div>
    ` : ''}
    ${!hasVideo ? `<div class="heart-burst" data-heart-burst>${icon('heart-fill')}</div>` : ''}
  </div>`;
}

function captionHTML(post, { page = false } = {}) {
  if (!post.caption) return '';
  return `<div class="${page ? 'post-page-caption' : 'post-caption'}"><a class="caption-user" href="/u/${esc(post.user.username)}" data-go="/u/${esc(post.user.username)}">${esc(post.user.username)}</a>${linkify(post.caption)}</div>`;
}

function topCommentsHTML(post) {
  const comments = post.topComments || [];
  if (!comments.length) return '';
  return `<div class="post-comments-preview">${comments.map((comment) => `
    <p class="preview-comment"><b>${esc(comment.user.username)}</b>${linkify(comment.body)}</p>
  `).join('')}</div>`;
}

function postCardHTML(post) {
  cachePost(post);
  const liked = Boolean(post.liked);
  const saved = Boolean(post.saved);
  const mediaCount = post.media?.length || 0;
  const metaBits = [];
  if (post.location) metaBits.push(`<span>${icon('location')}${esc(post.location)}</span>`);
  if (mediaCount > 1) metaBits.push(`<span>${mediaCount} medya</span>`);
  return `<article class="post-card" data-post-id="${esc(post.id)}">
    <header class="post-head">
      <a href="/u/${esc(post.user.username)}" data-go="/u/${esc(post.user.username)}" aria-label="${esc(post.user.displayName)} profili">${avatarHTML(post.user, '', { dot: true })}</a>
      <div class="post-head-main">
        <div class="post-user"><a href="/u/${esc(post.user.username)}" data-go="/u/${esc(post.user.username)}">${esc(post.user.displayName)}</a>${post.user.id === S.me?.id ? `<span class="badge badge-neutral" style="font-size:8.5px;padding:2px 6px">sen</span>` : ''}</div>
        <div class="post-sub">${metaBits.join('<span class="dot-sep"></span>') || `<span>@${esc(post.user.username)}</span>`}</div>
      </div>
      <button class="icon-btn" data-post-menu="${esc(post.id)}" aria-label="Gönderi seçenekleri">${icon('more')}</button>
    </header>
    ${postMediaHTML(post)}
    <div class="post-actions">
      <button class="icon-btn like-btn ${liked ? 'liked' : ''}" data-like="${esc(post.id)}" aria-label="${liked ? 'Beğeniyi geri al' : 'Beğen'}" aria-pressed="${liked}">${icon(liked ? 'heart-fill' : 'heart')}</button>
      <button class="icon-btn" data-comments="${esc(post.id)}" aria-label="Yorumlar">${icon('comment')}</button>
      <button class="icon-btn" data-share="${esc(post.id)}" aria-label="Paylaş">${icon('send')}</button>
      <span class="spacer"></span>
      <button class="icon-btn save-btn ${saved ? 'saved' : ''}" data-save="${esc(post.id)}" aria-label="${saved ? 'Kaydedilenlerden çıkar' : 'Kaydet'}" aria-pressed="${saved}">${icon(saved ? 'bookmark-fill' : 'bookmark')}</button>
    </div>
    <div class="post-body">
      <div class="post-likes" data-likes-row><span data-like-count>${post.likeCount ? `${fmtCount(post.likeCount)} beğeni` : 'İlk beğeni senin olsun'}</span></div>
      ${captionHTML(post)}
      ${topCommentsHTML(post)}
      ${post.commentCount > (post.topComments?.length || 0) ? `<button class="view-comments" data-comments="${esc(post.id)}">${plural(post.commentCount, 'yorumun', 'yorumun')} tamamını gör</button>` : ''}
      ${post.music ? `<p class="tiny muted" style="margin-top:6px;display:flex;align-items:center;gap:5px">${icon('music')} ${esc(post.music)}</p>` : ''}
      <a class="post-time" href="/p/${esc(post.id)}" data-go="/p/${esc(post.id)}">${timeAgoText(post.createdAt)}${post.archived ? ' · arşivde' : ''}</a>
    </div>
    ${post.commentsDisabled && post.user.id !== S.me?.id ? `<div class="quick-comment"><span class="tiny muted">Bu gönderide yorumlar kapalı.</span></div>` : `
      <form class="quick-comment" data-quick-comment="${esc(post.id)}">
        ${avatarHTML(S.me, '', { className: 'avatar' })}
        <input name="body" maxlength="1000" placeholder="Bir şeyler yaz…" aria-label="Yorum yaz" autocomplete="off">
        <button type="submit" data-quick-send>Gönder</button>
      </form>`}
  </article>`;
}

function railHTML(people = [], memories = []) {
  const memory = memories?.[0];
  const others = (people || []).filter((person) => person.id !== S.me?.id).slice(0, 4);
  return `<aside class="rail" aria-label="Yan panel">
    <div class="rail-card rail-people-card">
      <div class="rail-card-title">
        <span class="eyebrow">topluluk</span>
      </div>
      ${others.length ? `<div class="rail-people">${others.map((person) => `
        <a class="rail-person" href="/u/${esc(person.username)}" data-go="/u/${esc(person.username)}">
          ${avatarHTML(person, 'avatar-sm', { dot: true })}
          <span class="rail-person-meta"><strong>${esc(person.displayName)}</strong><span>@${esc(person.username)}</span></span>
          <span class="rail-person-msg" data-go="/mesajlar/${esc(person.username)}" role="button" aria-label="${esc(person.displayName)} kişisine mesaj gönder">${icon('message')}</span>
        </a>`).join('')}</div>` : `<p class="tiny muted" style="margin:0">Henüz başka kimse yok. Arkadaşlarını davet ederek başlayabilirsin.</p>`}
    </div>
    ${memory ? `<a class="rail-card memory-card" href="/p/${esc(memory.id)}" data-go="/p/${esc(memory.id)}">
      <div class="memory-thumb">${postThumb(memory)}</div>
      <div class="memory-meta"><strong>Bir an</strong><span>${fmtDate(memory.createdAt)} · ${timeAgoText(memory.createdAt)}</span></div>
    </a>` : `<div class="rail-card rail-tip">${icon('sparkle')}<span>Bugünün küçük anlarını da paylaş. Bir fotoğraf, kısa bir video ya da tek bir cümle yeter.</span></div>`}
    <div class="rail-card rail-tip">${icon('lock')}<span>Buradaki her şey yalnızca uygulamaya kayıtlı kişilere görünür. Reklamsız ve sade.</span></div>
    <p class="rail-footer">MelCandy · ${esc(fmtCount((people || []).length))} kişi<br>${esc(S.me?.displayName || '')} · ${esc(fmtDate(new Date()))}</p>
  </aside>`;
}

async function renderFeed(root) {
  root.innerHTML = `<div class="view">
    <div class="feed-layout">
      <div class="feed-main">
        <div class="feed-head"><div><h1>Ana akış</h1><p class="page-sub">${esc(fmtDate(new Date()))} · paylaşılanlar</p></div>
          <button class="icon-btn" data-feed-refresh aria-label="Yenile">${icon('refresh')}</button>
        </div>
        <div data-stories>${storiesStripHTML([]).replace('</div></div>', '<div class="story-item"><span class="skeleton" style="width:66px;height:66px;border-radius:50%"></span></div><div class="story-item"><span class="skeleton" style="width:66px;height:66px;border-radius:50%"></span></div></div></div>')}</div>
        <div data-feed-list>${feedSkeletonHTML(2)}</div>
        <div class="load-more" data-feed-end></div>
      </div>
      <div data-rail>${railHTML([], [])}</div>
    </div>
  </div>`;

  const list = $('[data-feed-list]', root);
  const storiesBox = $('[data-stories]', root);
  const railBox = $('[data-rail]', root);
  const endBox = $('[data-feed-end]', root);
  const state = { cursor: null, loading: false, done: false, ids: new Set(), groups: [], people: [] };
  const abort = new AbortController();

  const showEmpty = () => {
    list.innerHTML = `<div class="empty-state card" style="margin-bottom:18px">
      <div class="empty-icon">${icon('camera')}</div>
      <h3>Burası henüz sessiz</h3>
      <p>İlk anını paylaş. Bir fotoğraf, kısa bir video ya da sadece birkaç kelime yeter.</p>
      <a class="btn btn-primary" href="/olustur" data-go="/olustur">${icon('plus')} İlk anı paylaş</a>
    </div>`;
    endBox.innerHTML = '';
  };

  const loadStories = async () => {
    try {
      const data = await api('/api/stories', { signal: abort.signal });
      state.groups = data.groups || [];
      S.storyGroups = state.groups;
      storiesBox.innerHTML = storiesStripHTML(state.groups);
    } catch (error) {
      if (error.name !== 'AbortError') storiesBox.innerHTML = storiesStripHTML([]);
    }
  };

  const loadRail = async () => {
    try {
      const [memories, users] = await Promise.all([
        api('/api/memories', { signal: abort.signal }),
        api('/api/users', { signal: abort.signal }),
      ]);
      state.people = users.users || [];
      S.people = state.people;
      railBox.innerHTML = railHTML(state.people, memories.items || []);
    } catch { /* rail zaten dolu */ }
  };

  const appendPosts = (items, { replace = false } = {}) => {
    if (replace) {
      list.innerHTML = '';
      state.ids.clear();
    }
    const fresh = [];
    for (const post of items) {
      cachePost(post);
      if (state.ids.has(post.id)) continue;
      state.ids.add(post.id);
      fresh.push(post);
    }
    if (!fresh.length) return;
    const html = fresh.map(postCardHTML).join('');
    if (replace) list.innerHTML = html;
    else list.insertAdjacentHTML('beforeend', html);
  };

  const loadPage = async ({ reset = false } = {}) => {
    if (state.loading || (state.done && !reset)) return;
    state.loading = true;
    endBox.innerHTML = `<span class="spinner" style="color:var(--muted)" aria-label="Yükleniyor"></span>`;
    try {
      if (reset) state.cursor = null;
      const query = state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : '';
      const data = await api(`/api/feed${query}`, { signal: abort.signal });
      if (reset) {
        list.innerHTML = '';
        state.ids.clear();
      }
      appendPosts(data.items || [], { replace: reset });
      state.cursor = data.nextCursor;
      state.done = !data.nextCursor;
      if (reset && !(data.items || []).length) showEmpty();
      endBox.innerHTML = state.done && state.ids.size
        ? `<p class="feed-end">Başlangıca geldin. ${state.ids.size} anı görüntülendi. ♥</p>`
        : '';
    } catch (error) {
      if (error.name === 'AbortError') return;
      endBox.innerHTML = `<div class="empty-state"><p>${esc(error.message)}</p><button class="btn btn-sm btn-outline" data-feed-retry>Yeniden dene</button></div>`;
    } finally {
      state.loading = false;
    }
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadPage();
  }, { rootMargin: '900px 0px' });
  observer.observe(endBox);

  wirePostInteractions(root, { onChange: () => {} });

  const onStoryOpen = (event) => {
    const newButton = event.target.closest('[data-story-new]');
    if (newButton) {
      event.preventDefault();
      navigate('/olustur?tur=hikaye');
      return;
    }
    const button = event.target.closest('[data-story-user]');
    if (!button) return;
    const index = state.groups.findIndex((group) => group.user.id === button.dataset.storyUser);
    if (index >= 0) openStoryViewer(state.groups, index);
  };

  const onRefresh = (event) => {
    if (event.target.closest('[data-feed-retry]')) loadPage({ reset: true });
    if (event.target.closest('[data-feed-refresh]')) {
      state.done = false;
      loadPage({ reset: true });
      loadStories();
      loadRail();
      toast('Akış yenilendi', 'success');
    }
  };

  const onRealtime = async (event) => {
    const { type, data } = event.detail || {};
    if (type === 'post:new') {
      try {
        const result = await api(`/api/posts/${encodeURIComponent(data.postId)}`);
        if (result.post) {
          cachePost(result.post);
          if (state.ids.has(result.post.id)) return;
          const card = document.createElement('div');
          card.innerHTML = postCardHTML(result.post);
          const node = card.firstElementChild;
          state.ids.add(result.post.id);
          const empty = list.querySelector('.empty-state');
          if (empty) list.innerHTML = '';
          list.prepend(node);
          endBox.innerHTML = '';
          if (result.post.user.id !== S.me?.id) toast(`${result.post.user.displayName} yeni bir anı paylaştı.`, '');
        }
      } catch { /* ignore */ }
    }
    if (type === 'post:update') {
      try {
        const result = await api(`/api/posts/${encodeURIComponent(data.postId)}`);
        if (!result.post) return;
        cachePost(result.post);
        const node = root.querySelector(`[data-post-id="${result.post.id}"]`);
        if (node) {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = postCardHTML(result.post);
          node.replaceWith(wrapper.firstElementChild);
        }
      } catch { /* ignore */ }
    }
    if (type === 'post:delete') {
      state.ids.delete(data.postId);
      root.querySelectorAll(`[data-post-id="${data.postId}"]`).forEach((node) => node.remove());
      if (!state.ids.size) loadPage({ reset: true });
    }
    if (type === 'like') {
      const post = cachedPost(data.postId);
      if (post) {
        post.likeCount = data.likeCount;
        if (data.userId === S.me?.id) post.liked = data.liked;
        updateLikeUI(data.postId, post.liked, data.likeCount);
      }
    }
    if (type === 'comment:new') {
      const post = cachedPost(data.postId);
      if (post) {
        post.commentCount = data.count;
        updateCommentCountUI(data.postId, data.count);
      }
    }
    if (type === 'comment:delete') updateCommentCountUI(data.postId, data.count);
    if (type === 'story:update' || type === 'story:new') loadStories();
    if (type === 'profile:update' || type === 'users:update') {
      loadRail();
    }
  };

  root.addEventListener('click', onStoryOpen);
  root.addEventListener('click', onRefresh);
  window.addEventListener('ikimiz:event', onRealtime);

  await Promise.all([loadStories(), loadRail(), loadPage({ reset: true })]);

  return () => {
    abort.abort();
    observer.disconnect();
    window.removeEventListener('ikimiz:event', onRealtime);
  };
}

Views.feed = renderFeed;

/* -------------------------------------------------------- post interactions */

function updateLikeUI(postId, liked, count) {
  $$(`[data-like="${postId}"]`).forEach((button) => {
    button.classList.toggle('liked', Boolean(liked));
    button.setAttribute('aria-pressed', String(Boolean(liked)));
    button.innerHTML = icon(liked ? 'heart-fill' : 'heart');
    if (liked) {
      button.classList.remove('like-anim');
      void button.offsetWidth;
      button.classList.add('like-anim');
    }
  });
  $$(`[data-post-id="${postId}"] [data-like-count]`).forEach((node) => {
    node.textContent = Number(count) > 0 ? `${fmtCount(count)} beğeni` : 'İlk beğeni senin olsun';
  });
}

function updateSaveUI(postId, saved) {
  $$(`[data-save="${postId}"]`).forEach((button) => {
    button.classList.toggle('saved', Boolean(saved));
    button.setAttribute('aria-pressed', String(Boolean(saved)));
    button.innerHTML = icon(saved ? 'bookmark-fill' : 'bookmark');
  });
}

function updateCommentCountUI(postId, count) {
  const post = cachedPost(postId);
  if (post) post.commentCount = Number(count) || 0;
  $$(`[data-post-id="${postId}"] .view-comments`).forEach((node) => {
    if (Number(count) > (post?.topComments?.length || 0)) {
      node.textContent = `${plural(Number(count), 'yorumun', 'yorumun')} tamamını gör`;
      node.classList.remove('hidden');
    } else {
      node.classList.add('hidden');
    }
  });
}

function burstHeart(mediaBox, x, y) {
  const burst = mediaBox?.querySelector('[data-heart-burst]');
  if (!burst) return;
  const rect = mediaBox.getBoundingClientRect();
  burst.style.left = `${x - rect.left}px`;
  burst.style.top = `${y - rect.top}px`;
  burst.classList.remove('play');
  void burst.offsetWidth;
  burst.classList.add('play');
}

async function toggleLike(postId, { ripple = false, source = null } = {}) {
  const post = cachedPost(postId);
  const liked = !post?.liked;
  const optimistic = (post?.likeCount || 0) + (liked ? 1 : -1);
  if (post) {
    post.liked = liked;
    post.likeCount = Math.max(0, optimistic);
    updateLikeUI(postId, liked, post.likeCount);
  }
  try {
    const data = await api(`/api/posts/${encodeURIComponent(postId)}/like`, { method: liked ? 'POST' : 'DELETE' });
    if (post) {
      post.liked = data.liked;
      post.likeCount = data.likeCount;
      updateLikeUI(postId, data.liked, data.likeCount);
    }
    if (liked && ripple) haptic(10);
    return data;
  } catch (error) {
    if (post) {
      post.liked = !liked;
      post.likeCount = Math.max(0, optimistic - (liked ? 1 : -1));
      updateLikeUI(postId, !liked, post.likeCount);
    }
    toast(error.message, 'error');
    return null;
  }
}

async function toggleSave(postId) {
  const post = cachedPost(postId);
  const saved = !post?.saved;
  if (post) post.saved = saved;
  updateSaveUI(postId, saved);
  try {
    const data = await api(`/api/posts/${encodeURIComponent(postId)}/save`, { method: saved ? 'POST' : 'DELETE' });
    if (post) post.saved = data.saved;
    updateSaveUI(postId, data.saved);
    toast(data.saved ? 'Kaydedildi' : 'Kaydedilenlerden çıkarıldı', 'success');
  } catch (error) {
    if (post) post.saved = !saved;
    updateSaveUI(postId, !saved);
    toast(error.message, 'error');
  }
}

async function openPostMenu(postId) {
  let post = cachedPost(postId);
  if (!post) {
    try { post = cachePost((await api(`/api/posts/${encodeURIComponent(postId)}`)).post); } catch (error) { toast(error.message, 'error'); return; }
  }
  const mine = post.user.id === S.me?.id;
  const items = [
    { label: 'Gönderiyi aç', icon: 'eye', value: 'open' },
    { label: 'Bağlantıyı kopyala', icon: 'link', value: 'copy' },
    { label: 'Paylaş', icon: 'send', value: 'share' },
  ];
  if (mine) {
    items.push({ label: 'Açıklamayı düzenle', icon: 'edit', value: 'caption' });
    items.push({ label: post.commentsDisabled ? 'Yorumları aç' : 'Yorumları kapat', icon: 'comment', value: 'comments' });
    items.push({ label: post.archived ? 'Arşivden çıkar' : 'Arşivle', icon: 'archive', value: 'archive' });
    items.push({ label: 'Gönderiyi sil', icon: 'trash', value: 'delete', danger: true });
  }
  const choice = await choiceSheet({ title: 'Gönderi', sub: `@${post.user.username}`, items });
  if (!choice) return;
  if (choice === 'open') navigate(`/p/${post.id}`);
  if (choice === 'copy') copyText(new URL(`/p/${post.id}`, location.origin).href);
  if (choice === 'share') shareURL(`/p/${post.id}`, `${post.user.displayName} · MelCandy`);
  if (choice === 'caption') {
    const caption = await promptDialog({
      title: 'Açıklamayı düzenle',
      label: 'Açıklama',
      value: post.caption || '',
      message: 'Gönderinin açıklamasını güncelle.',
      maxlength: 2200,
    });
    if (caption === null) return;
    try {
      const data = await api(`/api/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { caption } });
      cachePost(data.post);
      const node = document.querySelector(`.post-card[data-post-id="${post.id}"]`);
      if (node) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = postCardHTML(data.post);
        node.replaceWith(wrapper.firstElementChild);
      }
      toast('Açıklama güncellendi', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }
  if (choice === 'comments') {
    try {
      const data = await api(`/api/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { commentsDisabled: !post.commentsDisabled } });
      cachePost(data.post);
      toast(data.post.commentsDisabled ? 'Yorumlar kapatıldı' : 'Yorumlar açıldı', 'success');
      route();
    } catch (error) { toast(error.message, 'error'); }
  }
  if (choice === 'archive') {
    try {
      await api(`/api/posts/${encodeURIComponent(post.id)}`, { method: 'PATCH', body: { archived: !post.archived } });
      toast(post.archived ? 'Arşivden çıkarıldı' : 'Arşive taşındı', 'success');
      route();
    } catch (error) { toast(error.message, 'error'); }
  }
  if (choice === 'delete') {
    const ok = await confirmDialog({
      title: 'Gönderi silinsin mi?',
      message: 'Bu anı ve içindeki medya kalıcı olarak silinecek. Geri alınamaz.',
      confirmText: 'Sil',
      danger: true,
      iconName: 'trash',
    });
    if (!ok) return;
    try {
      await api(`/api/posts/${encodeURIComponent(post.id)}`, { method: 'DELETE' });
      S.posts.delete(post.id);
      document.querySelectorAll(`[data-post-id="${post.id}"]`).forEach((node) => node.remove());
      toast('Gönderi silindi', 'success');
      if (S.route?.name === 'postDetail') navigate('/');
    } catch (error) { toast(error.message, 'error'); }
  }
}

function wirePostInteractions(root, { onChange } = {}) {
  root.addEventListener('click', async (event) => {
    const like = event.target.closest('[data-like]');
    if (like) {
      event.preventDefault();
      const media = like.closest('[data-post-id]')?.querySelector('[data-post-media]');
      const post = cachedPost(like.dataset.like);
      if (post && !post.liked && media) {
        const rect = media.getBoundingClientRect();
        burstHeart(media, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      await toggleLike(like.dataset.like);
      onChange?.('like', like.dataset.like);
      return;
    }

    const save = event.target.closest('[data-save]');
    if (save) {
      event.preventDefault();
      await toggleSave(save.dataset.save);
      onChange?.('save', save.dataset.save);
      return;
    }

    const comments = event.target.closest('[data-comments]');
    if (comments) {
      event.preventDefault();
      openCommentsSheet(comments.dataset.comments);
      return;
    }

    const share = event.target.closest('[data-share]');
    if (share) {
      event.preventDefault();
      const post = cachedPost(share.dataset.share);
      shareURL(`/p/${share.dataset.share}`, post ? `${post.user.displayName} · MelCandy` : 'MelCandy');
      return;
    }

    const menu = event.target.closest('[data-post-menu]');
    if (menu) {
      event.preventDefault();
      openPostMenu(menu.dataset.postMenu);
      return;
    }

    const step = event.target.closest('[data-carousel-step]');
    if (step) {
      event.preventDefault();
      const media = step.closest('[data-post-media]');
      const carousel = media?.querySelector('[data-carousel]');
      if (!carousel) return;
      const direction = Number(step.dataset.carouselStep);
      carousel.scrollBy({ left: direction * carousel.clientWidth, behavior: 'smooth' });
      return;
    }
  });

  root.addEventListener('dblclick', async (event) => {
    if (event.target.closest('video, button, a, input, textarea')) return;
    const media = event.target.closest('[data-post-media]');
    if (!media) return;
    const article = media.closest('[data-post-id]');
    if (!article) return;
    event.preventDefault();
    burstHeart(media, event.clientX, event.clientY);
    const post = cachedPost(article.dataset.postId);
    if (post && !post.liked) await toggleLike(post.id, { ripple: true });
    onChange?.('like', article.dataset.postId);
  });

  root.addEventListener('scroll', (event) => {
    const carousel = event.target.closest?.('[data-carousel]');
    if (!carousel) return;
    const media = carousel.closest('[data-post-media]');
    const count = carousel.children.length;
    if (!media || count <= 1) return;
    const index = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
    const label = media.querySelector('[data-carousel-count]');
    if (label) label.textContent = `${Math.min(index + 1, count)}/${count}`;
    media.querySelectorAll('[data-carousel-dots] .carousel-dot').forEach((dot, dotIndex) => {
      dot.classList.toggle('active', dotIndex === index);
    });
  }, true);

  root.addEventListener('input', (event) => {
    if (event.target.matches('[data-quick-comment] input')) {
      const form = event.target.closest('[data-quick-comment]');
      const button = form.querySelector('[data-quick-send]');
      button?.classList.toggle('enabled', Boolean(event.target.value.trim()));
    }
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-quick-comment]');
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector('input[name="body"]');
    const body = input?.value.trim();
    if (!body) return;
    const postId = form.dataset.quickComment;
    const button = form.querySelector('[data-quick-send]');
    button.disabled = true;
    try {
      const data = await api(`/api/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: { body } });
      input.value = '';
      button.classList.remove('enabled');
      const post = cachedPost(postId);
      if (post) {
        post.commentCount = data.commentCount;
        post.topComments = [...(post.topComments || []), data.comment].slice(-2);
        const article = form.closest('[data-post-id]');
        const preview = article?.querySelector('.post-comments-preview');
        if (preview) {
          const p = document.createElement('p');
          p.className = 'preview-comment';
          p.innerHTML = `<b>${esc(data.comment.user.username)}</b>${linkify(data.comment.body)}`;
          preview.appendChild(p);
          if (preview.children.length > 2) preview.firstElementChild.remove();
        } else {
          const target = article?.querySelector('.post-body');
          if (target) {
            const box = document.createElement('div');
            box.className = 'post-comments-preview';
            box.innerHTML = `<p class="preview-comment"><b>${esc(data.comment.user.username)}</b>${linkify(data.comment.body)}</p>`;
            target.querySelector('.view-comments')?.before(box);
          }
        }
        updateCommentCountUI(postId, data.commentCount);
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------- yorumlar */

function postMiniHTML(post) {
  if (!post) return '';
  const media = post.media?.[0];
  return `<div class="post-mini">
    <div class="post-mini-thumb">${media ? (media.kind === 'video' ? (media.posterUrl ? `<img src="${esc(media.posterUrl)}" alt="">` : '') : `<img src="${esc(media.url)}" alt="">`) : ''}</div>
    <p>${post.caption ? linkify(post.caption, { tags: false }) : `<b>${esc(post.user.displayName)}</b> · ${timeAgo(post.createdAt)}`}</p>
    <button class="icon-btn" data-go="/p/${esc(post.id)}" aria-label="Gönderiyi aç">${icon('arrow-right')}</button>
  </div>`;
}

function commentItemHTML(comment, post, depth = 0) {
  const canDelete = comment.mine || post?.user?.id === S.me?.id;
  const body = comment.deleted
    ? '<span class="comment-deleted">Bu yorum silindi.</span>'
    : linkify(comment.body);
  return `<div class="comment-item" data-comment-row="${esc(comment.id)}">
    <a href="/u/${esc(comment.user.username)}" data-go="/u/${esc(comment.user.username)}">${avatarHTML(comment.user)}</a>
    <div class="comment-main">
      <div class="comment-line"><b>${esc(comment.user.username)}</b>${body}</div>
      <div class="comment-meta">
        <span>${timeAgo(comment.createdAt)}</span>
        ${comment.editedAt ? '<span>düzenlendi</span>' : ''}
        ${comment.deleted ? '' : `<button type="button" data-comment-reply="${esc(comment.id)}">Yanıtla</button>`}
        ${comment.mine && !comment.deleted ? `<button type="button" data-comment-edit="${esc(comment.id)}">Düzenle</button>` : ''}
        ${canDelete && !comment.deleted ? `<button type="button" data-comment-delete="${esc(comment.id)}">Sil</button>` : ''}
      </div>
      ${depth === 0 ? `<div class="comment-replies" data-comment-replies="${esc(comment.id)}"></div>` : ''}
    </div>
    ${comment.deleted ? '' : `<button type="button" class="comment-like ${comment.liked ? 'liked' : ''}" data-comment-like="${esc(comment.id)}" aria-pressed="${comment.liked ? 'true' : 'false'}" aria-label="Yorumu beğen">${icon('heart')}<span>${comment.likeCount || ''}</span></button>`}
  </div>`;
}

function commentThreadHTML(comments, post) {
  const roots = comments.filter((comment) => !comment.parentId);
  const replies = new Map();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    if (!replies.has(comment.parentId)) replies.set(comment.parentId, []);
    replies.get(comment.parentId).push(comment);
  }
  const item = (comment, depth = 0) => {
    const children = depth === 0 ? (replies.get(comment.id) || []) : [];
    if (!children.length) return commentItemHTML(comment, post, depth);
    return `<div data-comment-thread="${esc(comment.id)}">${commentItemHTML(comment, post, depth)}
      <div class="comment-replies">${children.map((child) => commentItemHTML(child, post, 1)).join('')}</div></div>`;
  };
  return roots.length
    ? roots.map((comment) => item(comment)).join('')
    : `<div class="empty-state" style="padding:38px 12px">
        <div class="empty-icon">${icon('comment')}</div>
        <h3>Henüz yorum yok</h3>
        <p>İlk yorumu sen yaz. Küçük bir not bile günü güzelleştirir.</p>
      </div>`;
}

function commentFormHTML(post) {
  return `<div class="comment-form-wrap" data-comment-form-wrap>
    <div class="reply-banner hidden" data-reply-banner></div>
    <form class="comment-form" data-comment-form>
      ${avatarHTML(S.me)}
      <div class="input-wrap"><input name="body" maxlength="1000" placeholder="Yorum ekle…" autocomplete="off" aria-label="Yorum" required></div>
      <button class="send-btn" type="submit" data-comment-send ${post?.commentsDisabled && post.user.id !== S.me?.id ? 'disabled' : ''}>Gönder</button>
    </form>
    ${post?.commentsDisabled && post.user.id !== S.me?.id ? '<p class="tiny muted" style="margin-top:8px">Bu gönderide yorumlar kapalı.</p>' : ''}
  </div>`;
}

function createCommentController({ post, comments, listEl, footEl, onChange = null }) {
  const state = {
    map: new Map((comments || []).map((comment) => [comment.id, comment])),
    replyTo: null,
    busy: false,
  };

  const sorted = () => [...state.map.values()]
    .filter((comment) => !comment.deleted)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const render = () => {
    listEl.innerHTML = commentThreadHTML([...state.map.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))), post);
    renderFoot();
  };

  const renderFoot = () => {
    const banner = footEl.querySelector('[data-reply-banner]');
    if (!banner) return;
    if (!state.replyTo) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      return;
    }
    const target = state.map.get(state.replyTo);
    if (!target) {
      state.replyTo = null;
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    banner.innerHTML = `<span>${icon('comment')} <b>@${esc(target.user.username)}</b> kişisine yanıt veriyorsun</span><button type="button" data-cancel-reply aria-label="Yanıtı iptal et">${icon('close')}</button>`;
  };

  const focusInput = () => {
    const input = footEl.querySelector('[data-comment-form] input[name="body"]');
    if (input) {
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: 'nearest' });
    }
  };

  const handleClick = async (event) => {
    const reply = event.target.closest('[data-comment-reply]');
    if (reply) {
      state.replyTo = reply.dataset.commentReply;
      renderFoot();
      focusInput();
      return;
    }
    if (event.target.closest('[data-cancel-reply]')) {
      state.replyTo = null;
      renderFoot();
      return;
    }
    const like = event.target.closest('[data-comment-like]');
    if (like) {
      const comment = state.map.get(like.dataset.commentLike);
      if (!comment) return;
      const liked = !comment.liked;
      comment.liked = liked;
      comment.likeCount = Math.max(0, (comment.likeCount || 0) + (liked ? 1 : -1));
      like.classList.toggle('liked', liked);
      like.setAttribute('aria-pressed', String(liked));
      like.querySelector('span').textContent = comment.likeCount || '';
      try {
        const data = await api(`/api/comments/${encodeURIComponent(comment.id)}/like`, { method: liked ? 'POST' : 'DELETE' });
        comment.liked = data.liked;
        comment.likeCount = data.likeCount;
        like.classList.toggle('liked', data.liked);
        like.querySelector('span').textContent = data.likeCount || '';
      } catch (error) {
        comment.liked = !liked;
        comment.likeCount = Math.max(0, (comment.likeCount || 0) + (liked ? -1 : 1));
        like.classList.toggle('liked', !liked);
        like.querySelector('span').textContent = comment.likeCount || '';
        toast(error.message, 'error');
      }
      return;
    }
    const edit = event.target.closest('[data-comment-edit]');
    if (edit) {
      const comment = state.map.get(edit.dataset.commentEdit);
      if (!comment) return;
      const body = await promptDialog({
        title: 'Yorumu düzenle',
        label: 'Yorum',
        value: comment.body,
        message: 'Yorumunu güncelle.',
        maxlength: 1000,
      });
      if (body === null || body === comment.body) return;
      try {
        await api(`/api/comments/${encodeURIComponent(comment.id)}`, { method: 'PATCH', body: { body } });
        comment.body = body;
        comment.editedAt = new Date().toISOString();
        render();
        toast('Yorum güncellendi', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    const remove = event.target.closest('[data-comment-delete]');
    if (remove) {
      const comment = state.map.get(remove.dataset.commentDelete);
      if (!comment) return;
      const ok = await confirmDialog({
        title: 'Yorum silinsin mi?',
        message: 'Bu yorum kalıcı olarak silinecek.',
        confirmText: 'Sil',
        danger: true,
        iconName: 'trash',
      });
      if (!ok) return;
      try {
        const data = await api(`/api/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' });
        state.map.delete(comment.id);
        for (const [id, child] of [...state.map.entries()]) {
          if (child.parentId === comment.id) state.map.delete(id);
        }
        if (state.replyTo === comment.id) state.replyTo = null;
        render();
        onChange?.(data.commentCount);
        toast('Yorum silindi', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  };

  const onSubmit = async (event) => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault();
    if (state.busy) return;
    const input = form.querySelector('input[name="body"]');
    const body = input?.value.trim();
    if (!body) return;
    state.busy = true;
    const button = form.querySelector('[data-comment-send]');
    if (button) button.disabled = true;
    try {
      const data = await api(`/api/posts/${encodeURIComponent(post.id)}/comments`, {
        method: 'POST',
        body: { body, parentId: state.replyTo || undefined },
      });
      state.map.set(data.comment.id, data.comment);
      state.replyTo = null;
      input.value = '';
      render();
      onChange?.(data.commentCount);
      const row = listEl.querySelector(`[data-comment-row="${data.comment.id}"]`);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
    }
  };

  listEl.addEventListener('click', handleClick);
  footEl.addEventListener('click', handleClick);
  footEl.addEventListener('submit', onSubmit);
  render();

  return {
    render,
    sorted,
    setComments(next) {
      state.map = new Map((next || []).map((comment) => [comment.id, comment]));
      render();
    },
    add(comment) {
      state.map.set(comment.id, { ...comment, liked: false, likeCount: 0, mine: comment.user?.id === S.me?.id });
      render();
    },
  };
}

async function openCommentsSheet(postId) {
  let post = cachedPost(postId);
  let comments = [];
  try {
    const results = await Promise.all([
      post ? Promise.resolve({ post }) : api(`/api/posts/${encodeURIComponent(postId)}`),
      api(`/api/posts/${encodeURIComponent(postId)}/comments`),
    ]);
    post = results[0].post;
    comments = results[1].comments || [];
    cachePost(post);
  } catch (error) {
    toast(error.message, 'error');
    return;
  }

  let controller = null;
  const entry = openSheet({
    title: 'Yorumlar',
    sub: post.commentCount ? `${fmtCount(post.commentCount)} yorum` : 'ilk yorum',
    size: 'sheet-wide',
    className: 'comments-sheet',
    body: `${postMiniHTML(post)}<div class="comment-list" data-comment-list></div>`,
    foot: '<div data-comment-foot></div>',
    onMount: (layer) => {
      const listEl = layer.querySelector('[data-comment-list]');
      const footEl = layer.querySelector('[data-comment-foot]');
      footEl.innerHTML = commentFormHTML(post);
      controller = createCommentController({
        post,
        comments,
        listEl,
        footEl,
        onChange: (count) => {
          post.commentCount = Number(count) || 0;
          updateCommentCountUI(post.id, count);
          const sub = layer.querySelector('.sheet-sub');
          if (sub) sub.textContent = count ? `${fmtCount(count)} yorum` : 'ilk yorum';
        },
      });
    },
    onClose: () => {
      window.removeEventListener('ikimiz:event', onRealtime);
    },
  });

  const refresh = async () => {
    try {
      const data = await api(`/api/posts/${encodeURIComponent(postId)}/comments`);
      controller?.setComments(data.comments || []);
    } catch { /* ignore */ }
  };

  const onRealtime = (event) => {
    const { type, data } = event.detail || {};
    if (data?.postId !== postId || !controller) return;
    if (['comment:new', 'comment:update', 'comment:delete'].includes(type)) refresh();
  };
  window.addEventListener('ikimiz:event', onRealtime);
  entry.layer.addEventListener('click', (event) => {
    if (event.target.closest('[data-overlay-close]')) closeOverlay(entry);
  });
}

async function openLikesSheet(postId) {
  let users = [];
  try {
    const data = await api(`/api/posts/${encodeURIComponent(postId)}/likes`);
    users = data.users || [];
  } catch (error) {
    toast(error.message, 'error');
    return;
  }
  const body = users.length
    ? `<div class="likes-sheet-list">${users.map((user) => `
        <a class="like-row" href="/u/${esc(user.username)}" data-go="/u/${esc(user.username)}">
          ${avatarHTML(user, '', { dot: true })}
          <span class="like-row-meta"><strong>${esc(user.displayName)}</strong><span>@${esc(user.username)}</span></span>
          ${icon('chevron-right', 'ico chev')}
        </a>`).join('')}</div>`
    : `<div class="empty-state" style="padding:30px 10px"><div class="empty-icon">${icon('heart')}</div><h3>Henüz beğeni yok</h3><p>İlk kalbi sen bırak.</p></div>`;
  openSheet({ title: 'Beğenenler', sub: users.length ? `${users.length} kişi` : '', size: 'sheet-sm', body });
}

/* --------------------------------------------------------------- hikâyeler */

function storyFooterHTML(story) {
  if (story.mine) {
    return `<div class="story-view-count">${icon('eye')}<span data-story-view-count>${story.viewCount || 0} görüntüleme</span></div>
      <div class="story-owner-actions">
        <button class="btn btn-sm btn-soft" data-story-viewers>${icon('users')} Görüntüleyenler</button>
        <button class="icon-btn" data-story-delete aria-label="Hikâyeyi sil">${icon('trash')}</button>
      </div>`;
  }
  return `<form class="story-reply" data-story-reply>
      <input name="body" maxlength="1000" placeholder="Hikâyeye yanıt ver…" autocomplete="off" aria-label="Hikâyeye yanıt">
      <button type="submit" aria-label="Gönder">${icon('send')}</button>
    </form>
    <div class="story-react">
      <button type="button" data-story-react="❤️" aria-label="Kalp">❤️</button>
      <button type="button" data-story-react="😍" aria-label="Aşk">😍</button>
      <button type="button" data-story-react="😂" aria-label="Gülme">😂</button>
      <button type="button" data-story-react="😮" aria-label="Şaşkın">😮</button>
      <button type="button" data-story-react="🥺" aria-label="Duygulu">🥺</button>
    </div>`;
}

async function openStoryViewer(groups, startIndex = 0) {
  const entries = (groups || []).filter((group) => group.stories?.length);
  if (!entries.length) {
    toast('Şu an görüntülenecek hikâye yok.', '');
    return;
  }
  const startGroup = groups[startIndex];
  let gi = Math.max(0, entries.findIndex((group) => group.user.id === startGroup?.user.id));
  if (gi < 0 || gi >= entries.length) gi = 0;
  let si = 0;
  let timer = 0;
  let paused = false;
  let closed = false;
  let startedAt = 0;
  let remaining = 0;

  const entry = openOverlay(`<div class="story-viewer" role="dialog" aria-modal="true" aria-label="Hikâyeler">
    <div class="story-progress-row" data-story-progress></div>
    <div class="story-viewer-head">
      <a data-story-profile>${avatarHTML(entries[gi].user)}</a>
      <div style="min-width:0">
        <div class="story-viewer-user" data-story-owner></div>
        <div class="story-viewer-time" data-story-time></div>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" data-story-close aria-label="Kapat">${icon('close')}</button>
    </div>
    <div class="story-stage" data-story-stage></div>
    <button class="story-nav-btn prev" data-story-prev aria-label="Önceki hikâye">${icon('chevron-left')}</button>
    <button class="story-nav-btn next" data-story-next aria-label="Sonraki hikâye">${icon('chevron-right')}</button>
    <div class="story-foot" data-story-foot></div>
    <div class="story-hint">Dokun ve tut: duraklat · Yanlara dokun: geç</div>
  </div>`, {
    layerClass: 'story-layer',
    closeOnBackdrop: false,
    onClose: () => {
      closed = true;
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ikimiz:event', onRealtime);
    },
  });

  const layer = entry.layer;
  const progressBox = layer.querySelector('[data-story-progress]');
  const stage = layer.querySelector('[data-story-stage]');
  const foot = layer.querySelector('[data-story-foot]');
  const ownerEl = layer.querySelector('[data-story-owner]');
  const timeEl = layer.querySelector('[data-story-time]');
  const profileLink = layer.querySelector('[data-story-profile]');

  const current = () => entries[gi]?.stories[si] || null;

  const clearTimer = () => {
    clearTimeout(timer);
    timer = 0;
  };

  const markViewed = async (story) => {
    if (!story || story.mine || story.viewed) return;
    story.viewed = true;
    try {
      const data = await api(`/api/stories/${encodeURIComponent(story.id)}/view`, { method: 'POST' });
      if (typeof data.viewCount === 'number') story.viewCount = data.viewCount;
    } catch { /* sessiz */ }
  };

  const renderProgress = () => {
    const story = current();
    const list = entries[gi]?.stories || [];
    progressBox.innerHTML = list.map((item, index) => {
      const cls = index < si ? 'done' : index === si ? 'current' : '';
      return `<div class="story-progress-track ${cls}" data-story-track="${index}"><i></i></div>`;
    }).join('');
    if (story) {
      const track = progressBox.querySelector('.story-progress-track.current');
      if (track) {
        const i = track.querySelector('i');
        const duration = songDuration(story);
        i.style.animationDuration = `${duration}ms`;
        i.style.animationPlayState = paused ? 'paused' : 'running';
      }
    }
  };

  const songDuration = (story) => {
    if (story?.media?.kind === 'video' && story.media.duration) {
      return Math.max(1500, Math.min(60000, Number(story.media.duration) * 1000));
    }
    return 5200;
  };

  const startTimer = (duration) => {
    clearTimer();
    if (paused || closed) return;
    if (!S.me?.settings?.storyAutoAdvance) {
      return;
    }
    remaining = duration;
    startedAt = Date.now();
    timer = setTimeout(() => next(), duration);
  };

  const preload = () => {
    const nextGroup = entries[gi + 1];
    const nextStory = nextGroup?.stories?.[0];
    const media = nextStory?.media;
    if (media?.kind === 'image') {
      const image = new Image();
      image.src = media.url;
    }
    if (media?.kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = media.url;
    }
  };

  const render = ({ resetProgress = true } = {}) => {
    const group = entries[gi];
    const story = current();
    if (!group || !story) {
      closeOverlay(entry);
      return;
    }
    ownerEl.textContent = group.user.displayName;
    timeEl.textContent = `${timeAgoText(story.createdAt)}${story.mine ? ' · senin hikâyen' : ''}`;
    profileLink.setAttribute('href', `/u/${group.user.username}`);
    profileLink.setAttribute('data-go', `/u/${group.user.username}`);
    profileLink.innerHTML = avatarHTML(group.user);
    if (resetProgress) renderProgress();

    const media = story.media;
    if (!media) {
      stage.innerHTML = '<div class="empty-state" style="color:#fff"><p>Medya yüklenemedi.</p></div>';
      return;
    }
    if (media.kind === 'video') {
      stage.innerHTML = `<div class="story-tap-zone left" data-story-prev></div>
        <div class="story-tap-zone right" data-story-next></div>
        <video src="${esc(media.url)}" ${media.posterUrl ? `poster="${esc(media.posterUrl)}"` : ''} playsinline autoplay preload="auto"></video>
        ${story.caption ? `<div class="story-caption">${linkify(story.caption)}</div>` : ''}`;
      const video = stage.querySelector('video');
      video.volume = 1;
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && Number.isFinite(video.duration)) {
          startTimer(Math.max(1500, video.duration * 1000) + 150);
        }
      }, { once: true });
      video.addEventListener('ended', () => {
        if (!paused) next();
      });
      video.play().catch(() => {});
    } else {
      stage.innerHTML = `<div class="story-tap-zone left" data-story-prev></div>
        <div class="story-tap-zone right" data-story-next></div>
        <img src="${esc(media.url)}" alt="${esc(story.caption || '')}">
        ${story.caption ? `<div class="story-caption">${linkify(story.caption)}</div>` : ''}`;
    }

    foot.innerHTML = storyFooterHTML(story);
    markViewed(story);
    startTimer(songDuration(story));
    preload();
  };

  const renderOnlyProgress = () => {
    renderProgress();
  };

  const pause = () => {
    if (paused) return;
    paused = true;
    const video = stage.querySelector('video');
    if (video) video.pause();
    const track = progressBox.querySelector('.story-progress-track.current i');
    if (track) track.style.animationPlayState = 'paused';
    if (timer) {
      clearTimer();
      const elapsed = Date.now() - startedAt;
      remaining = Math.max(600, remaining - elapsed);
    }
  };

  const resume = () => {
    if (!paused) return;
    paused = false;
    const video = stage.querySelector('video');
    if (video) {
      video.play().catch(() => {});
      const track = progressBox.querySelector('.story-progress-track.current i');
      if (track) track.style.animationPlayState = 'running';
      if (remaining > 0) startTimer(remaining);
    } else {
      const track = progressBox.querySelector('.story-progress-track.current i');
      if (track) track.style.animationPlayState = 'running';
      startTimer(remaining > 0 ? remaining : songDuration(current()));
    }
  };

  const next = () => {
    if (closed) return;
    clearTimer();
    const group = entries[gi];
    if (si + 1 < (group?.stories?.length || 0)) {
      si += 1;
      render();
      return;
    }
    gi += 1;
    si = 0;
    while (gi < entries.length && !(entries[gi].stories?.length)) gi += 1;
    if (gi >= entries.length) {
      closeOverlay(entry);
      return;
    }
    render();
  };

  const prev = () => {
    if (closed) return;
    clearTimer();
    if (si > 0) {
      si -= 1;
      render();
      return;
    }
    gi -= 1;
    while (gi >= 0 && !(entries[gi].stories?.length)) gi -= 1;
    if (gi < 0) {
      gi = 0;
      si = 0;
      render();
      return;
    }
    si = Math.max(0, (entries[gi].stories?.length || 1) - 1);
    render();
  };

  const onKey = (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prev();
    } else if (event.key === ' ') {
      event.preventDefault();
      paused ? resume() : pause();
    }
  };
  window.addEventListener('keydown', onKey);

  const openViewers = async () => {
    const story = current();
    if (!story?.mine) return;
    pause();
    try {
      const data = await api(`/api/stories/${encodeURIComponent(story.id)}/viewers`);
      const viewers = data.viewers || [];
      const body = viewers.length
        ? `<div>${viewers.map((viewer) => `<div class="viewer-row">${avatarHTML(viewer)}<div class="like-row-meta"><strong>${esc(viewer.displayName)}</strong><span>@${esc(viewer.username)}</span></div><span>${timeAgo(viewer.viewedAt)}</span></div>`).join('')}</div>`
        : `<div class="empty-state" style="padding:26px 10px"><div class="empty-icon">${icon('eye')}</div><h3>Henüz kimse görmedi</h3><p>Hikâyen 24 saat boyunca burada kalacak.</p></div>`;
      openSheet({ title: 'Görüntüleyenler', sub: `${viewers.length} kişi`, size: 'sheet-sm', className: 'story-viewers-sheet', body, onClose: resume });
    } catch (error) {
      toast(error.message, 'error');
      resume();
    }
  };

  const deleteStory = async () => {
    const story = current();
    if (!story?.mine) return;
    const ok = await confirmDialog({
      title: 'Hikâye silinsin mi?',
      message: 'Bu hikâye ve medyası kalıcı olarak silinecek.',
      confirmText: 'Sil',
      danger: true,
      iconName: 'trash',
    });
    if (!ok) return;
    pause();
    try {
      await api(`/api/stories/${encodeURIComponent(story.id)}`, { method: 'DELETE' });
      const group = entries[gi];
      group.stories.splice(si, 1);
      toast('Hikâye silindi', 'success');
      if (!group.stories.length) {
        entries.splice(gi, 1);
        si = 0;
        if (!entries.length) {
          closeOverlay(entry);
          return;
        }
        if (gi >= entries.length) gi = 0;
        render();
      } else {
        si = Math.min(si, group.stories.length - 1);
        render();
      }
      resume();
    } catch (error) {
      toast(error.message, 'error');
      resume();
    }
  };

  const react = async (emoji) => {
    const story = current();
    if (!story || story.mine) return;
    try {
      await api(`/api/stories/${encodeURIComponent(story.id)}/react`, { method: 'POST', body: { emoji } });
      toast(`${emoji} gönderildi`, 'success');
      haptic(10);
      const burst = document.createElement('span');
      burst.textContent = emoji;
      burst.style.cssText = 'position:absolute;left:50%;top:60%;font-size:46px;pointer-events:none;z-index:9;transform:translate(-50%,-50%);animation:heart-pop .9s ease forwards';
      stage.appendChild(burst);
      setTimeout(() => burst.remove(), 950);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const onRealtime = (event) => {
    const { type, data } = event.detail || {};
    if (type === 'story:view' && data.storyId === current()?.id) {
      const node = foot.querySelector('[data-story-view-count]');
      if (node) node.textContent = `${data.viewCount || 0} görüntüleme`;
      const story = current();
      if (story) story.viewCount = data.viewCount || 0;
    }
    if (type === 'story:update' && !current()) {
      closeOverlay(entry);
    }
  };
  window.addEventListener('ikimiz:event', onRealtime);

  layer.addEventListener('click', (event) => {
    if (event.target.closest('[data-story-close]')) {
      closeOverlay(entry);
      return;
    }
    if (event.target.closest('[data-story-viewers]')) {
      event.preventDefault();
      openViewers();
      return;
    }
    if (event.target.closest('[data-story-delete]')) {
      event.preventDefault();
      deleteStory();
      return;
    }
    const reaction = event.target.closest('[data-story-react]');
    if (reaction) {
      event.preventDefault();
      react(reaction.dataset.storyReact);
      return;
    }
    if (event.target.closest('[data-story-next]')) {
      next();
      return;
    }
    if (event.target.closest('[data-story-prev]')) {
      prev();
      return;
    }
  });

  layer.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-story-reply]');
    if (!form) return;
    event.preventDefault();
    const story = current();
    const input = form.querySelector('input[name="body"]');
    const body = input?.value.trim();
    if (!story || !body) return;
    try {
      await api(`/api/stories/${encodeURIComponent(story.id)}/reply`, { method: 'POST', body: { body } });
      input.value = '';
      toast('Yanıtın gönderildi', 'success');
      haptic(8);
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  let pressTimer = 0;
  stage.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, a, input')) return;
    pressTimer = setTimeout(() => pause(), 140);
  });
  const release = () => {
    clearTimeout(pressTimer);
    if (paused) resume();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', release);

  render();
}

/* ------------------------------------------------------- keşfet & arama */

function postTileHTML(post) {
  cachePost(post);
  const media = post.media?.[0];
  const thumb = media
    ? media.kind === 'video'
      ? (media.posterUrl ? `<img src="${esc(media.posterUrl)}" alt="" loading="lazy">` : `<video src="${esc(media.url)}" muted playsinline preload="metadata"></video>`)
      : `<img src="${esc(media.url)}" alt="${esc(post.altText || '')}" loading="lazy">`
    : '';
  return `<a class="grid-tile" href="/p/${esc(post.id)}" data-go="/p/${esc(post.id)}" aria-label="${esc(post.caption?.slice(0, 60) || 'Gönderi')}">
    ${thumb}
    ${media?.kind === 'video' ? `<span class="tile-badge">${icon('play')}</span>` : ''}
    ${(post.media?.length || 0) > 1 ? `<span class="tile-badge tile-multi">${icon('grid')}</span>` : ''}
    <span class="grid-overlay">
      <span>${icon('heart-fill')}${fmtCount(post.likeCount)}</span>
      <span>${icon('comment')}${fmtCount(post.commentCount)}</span>
    </span>
  </a>`;
}

function gridHTML(posts) {
  return posts.map(postTileHTML).join('');
}

/* --------------------------------------------------------- kaydedilenler */

async function renderCollection(root, { endpoint, title, eyebrow, sub, emptyIcon, emptyTitle, emptyText, emptyAction }) {
  root.innerHTML = `<div class="view view-wide">
    <div class="feed-head" style="margin-bottom:18px">
      <div><span class="eyebrow">${esc(eyebrow)}</span><h1 class="page-title">${esc(title)}</h1><p class="page-sub">${esc(sub)}</p></div>
    </div>
    <div class="post-grid" data-collection-grid></div>
    <div class="load-more" data-collection-end></div>
  </div>`;
  const grid = root.querySelector('[data-collection-grid]');
  const end = root.querySelector('[data-collection-end]');
  const state = { cursor: null, loading: false, done: false, ids: new Set(), count: 0 };
  const abort = new AbortController();

  const load = async ({ reset = false } = {}) => {
    if (state.loading || (state.done && !reset)) return;
    state.loading = true;
    if (reset) {
      state.cursor = null;
      state.done = false;
      state.ids.clear();
      state.count = 0;
      grid.innerHTML = '';
    }
    end.innerHTML = `<span class="spinner" style="color:var(--muted)"></span>`;
    try {
      const query = state.cursor ? `${endpoint.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(state.cursor)}` : '';
      const data = await api(`${endpoint}${query}`, { signal: abort.signal });
      const fresh = (data.items || []).filter((post) => {
        if (state.ids.has(post.id)) return false;
        state.ids.add(post.id);
        state.count += 1;
        return true;
      });
      state.cursor = data.nextCursor;
      state.done = !data.nextCursor;
      grid.insertAdjacentHTML('beforeend', gridHTML(fresh));
      if (!state.count) {
        grid.innerHTML = `<div class="grid-empty empty-state card" style="padding:48px 20px">
          <div class="empty-icon">${icon(emptyIcon || 'bookmark')}</div>
          <h3>${esc(emptyTitle || 'Henüz bir şey yok')}</h3>
          <p>${esc(emptyText || '')}</p>
          ${emptyAction || ''}
        </div>`;
        end.innerHTML = '';
        return;
      }
      end.innerHTML = state.done ? `<p class="feed-end">${state.count} anı · hepsi bu kadar</p>` : '';
    } catch (error) {
      if (error.name === 'AbortError') return;
      end.innerHTML = `<div class="empty-state"><p>${esc(error.message)}</p><button class="btn btn-sm btn-outline" data-collection-retry>Yeniden dene</button></div>`;
    } finally {
      state.loading = false;
    }
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  }, { rootMargin: '700px' });
  observer.observe(end);
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-collection-retry]')) load({ reset: true });
  });
  const onRealtime = (event) => {
    if (['post:delete', 'post:update'].includes(event.detail?.type)) load({ reset: true });
  };
  window.addEventListener('ikimiz:event', onRealtime);

  await load();
  return () => {
    abort.abort();
    observer.disconnect();
    window.removeEventListener('ikimiz:event', onRealtime);
  };
}

Views.saved = (root) => renderCollection(root, {
  endpoint: '/api/saved',
  title: 'Kaydedilenler',
  eyebrow: 'arşiv değil, saklananlar',
  sub: 'Sonra dönmek istediğin anlar burada.',
  emptyIcon: 'bookmark',
  emptyTitle: 'Henüz kaydedilen yok',
  emptyText: 'Bir gönderideki yer imi simgesine dokun, burada biriksin.',
  emptyAction: `<a class="btn btn-primary" href="/olustur" data-go="/olustur">${icon('plus')} Anı paylaş</a>`,
});

Views.archive = (root) => renderCollection(root, {
  endpoint: '/api/archive',
  title: 'Arşiv',
  eyebrow: 'sadece senin görebileceğin',
  sub: 'Akıştan kaldırdığın ama silmediğin anlar.',
  emptyIcon: 'archive',
  emptyTitle: 'Arşiv boş',
  emptyText: 'Bir gönderiyi arşivlediğinde burada saklanır.',
  emptyAction: `<a class="btn btn-primary" href="/olustur" data-go="/olustur">${icon('plus')} Yeni anı paylaş</a>`,
});

/* --------------------------------------------------------------- bulunamadı */

Views.notFound = (root) => {
  root.innerHTML = `<div class="view view-narrow"><div class="empty-state card" style="padding:70px 24px">
    <div class="empty-icon">${icon('compass')}</div>
    <h3>Burada bir şey yok</h3>
    <p>Aradığın sayfa taşınmış ya da hiç var olmamış olabilir.</p>
    <a class="btn btn-primary" href="/" data-go="/">${icon('home')} Ana akışa dön</a>
    <a class="btn btn-ghost" href="/mesajlar" data-go="/mesajlar">${icon('message')} Mesajlara bak</a>
  </div></div>`;
};

/* ------------------------------------------------------------------ profil */

function profileEmptyHTML({ mine }) {
  return `<div class="profile-empty empty-state" style="padding:46px 20px">
    <div class="empty-icon">${icon('camera')}</div>
    <h3>Henüz gönderi yok</h3>
    <p>${mine ? 'İlk fotoğrafını ya da videonu paylaş.' : 'Bu kişi henüz bir an paylaşmadı.'}</p>
    ${mine ? `<a class="btn btn-primary" href="/olustur" data-go="/olustur">${icon('plus')} Anı paylaş</a>` : ''}
  </div>`;
}

async function renderProfile(root, { params }) {
  const username = String(params.id || '').trim();
  let data;
  try {
    data = await api(`/api/users/${encodeURIComponent(username)}`);
  } catch (error) {
    root.innerHTML = `<div class="view view-narrow"><div class="empty-state card" style="padding:60px 24px">
      <div class="empty-icon">${icon('user')}</div>
      <h3>${error.status === 404 ? 'Profil bulunamadı' : 'Profil yüklenemedi'}</h3>
      <p>${esc(error.message)}</p>
      <a class="btn btn-primary" href="/" data-go="/">${icon('home')} Ana akışa dön</a>
    </div></div>`;
    return;
  }

  const user = data.user;
  const mine = Boolean(user.isMe);
  // Sayfayı gören kişi kendi profilindeyse çevrimiçidir; SSE el sıkışması
  // tamamlanmadan gelen ilk yüklemede nokta kaybolmasın.
  if (mine) user.online = true;
  const initialsName = esc(initials(user.displayName));
  const joined = fmtDate(user.createdAt);
  const followLabel = user.isFollowing ? 'Takibi bırak' : 'Takip et';

  root.innerHTML = `<div class="view view-wide">
    <div class="profile-page">
      <header class="profile-head">
        <div class="profile-cover">
          ${user.cover ? `<img src="/api/media/${esc(user.cover)}" alt="${esc(user.displayName)} kapak görseli">` : ''}
          ${mine ? `<button class="profile-cover-edit" data-cover-pick>${icon('camera')} Kapak değiştir</button>` : ''}
        </div>
        <div class="profile-body">
          <div class="profile-avatar-row">
            <span data-profile-avatar>${avatarHTML(user, 'avatar-xl', { dot: true })}</span>
            <div class="profile-actions">
              ${mine
                ? `<a class="btn btn-soft" href="/ayarlar/profil" data-go="/ayarlar/profil">${icon('edit')} Profili düzenle</a>
                   <button class="btn btn-outline" data-profile-share>${icon('link')} Paylaş</button>
                   <a class="icon-btn" href="/ayarlar" data-go="/ayarlar" aria-label="Ayarlar">${icon('settings')}</a>`
                : `<button class="btn ${user.isFollowing ? 'btn-outline' : 'btn-primary'}" data-follow-toggle>${icon(user.isFollowing ? 'check' : 'plus')} ${followLabel}</button>
                   <a class="btn btn-soft" href="/mesajlar/${esc(user.username)}" data-go="/mesajlar/${esc(user.username)}">${icon('message')} Mesaj gönder</a>
                   <button class="btn btn-outline" data-profile-share>${icon('link')} Paylaş</button>`}
            </div>
          </div>
          <div class="profile-identity">
            <h1>${esc(user.displayName)}</h1>
            ${mine ? '<span class="badge badge-neutral">sen</span>' : (user.followsMe ? '<span class="badge badge-ok">seni takip ediyor</span>' : '')}
            ${user.online ? '<span class="badge badge-ok"><i class="online-dot" style="position:relative;display:inline-block"></i> çevrimiçi</span>' : ''}
          </div>
          <div class="profile-handle">@${esc(user.username)}${user.pronouns ? ` · ${esc(user.pronouns)}` : ''}</div>
          ${user.bio ? `<p class="profile-bio">${linkify(user.bio)}</p>` : `<p class="profile-bio muted" style="font-style:italic">${mine ? 'Kendinden birkaç kelimeyle bahset.' : 'Henüz bir biyografi yok.'}</p>`}
          ${user.link ? `<a class="profile-link" href="${esc(user.link)}" target="_blank" rel="noopener noreferrer">${icon('link')}${esc(user.link.replace(/^https?:\/\//, ''))}</a>` : ''}
          <div class="profile-meta-row">
            <span>${icon('calendar')} ${esc(joined)} tarihinde katıldı</span>
            ${user.online ? `<span>${icon('heart')} şu an burada</span>` : ''}
          </div>
          <div class="profile-stats">
            <div class="profile-stat"><strong>${fmtCount(user.counts?.posts || 0)}</strong><span>gönderi</span></div>
            <button type="button" class="profile-stat stat-button" data-follow-list="followers"><strong data-follower-count>${fmtCount(user.counts?.followers || 0)}</strong><span>takipçi</span></button>
            <button type="button" class="profile-stat stat-button" data-follow-list="following"><strong>${fmtCount(user.counts?.following || 0)}</strong><span>takip</span></button>
            <div class="profile-stat"><strong>${fmtCount(user.counts?.likes || 0)}</strong><span>beğeni</span></div>
            ${mine ? `<div class="profile-stat"><strong>${fmtCount(user.counts?.saved || 0)}</strong><span>kaydedilen</span></div>` : ''}
          </div>
        </div>
        <div class="profile-tabs" role="tablist">
          <span class="profile-tab active">${icon('grid')} Gönderiler <span class="tiny">${fmtCount(user.counts?.posts || 0)}</span></span>
          ${mine ? `<a class="profile-tab" href="/kaydedilenler" data-go="/kaydedilenler">${icon('bookmark')} Kaydedilenler</a>` : ''}
        </div>
      </header>

      <div class="profile-grid-wrap">
        <div class="post-grid profile-grid" data-profile-posts></div>
        <div class="load-more" data-profile-end></div>
      </div>
    </div>
  </div>`;

  const state = { cursor: data.nextCursor, done: !data.nextCursor, loading: false, ids: new Set(), posts: [] };
  const abort = new AbortController();
  const postsGrid = root.querySelector('[data-profile-posts]');
  const end = root.querySelector('[data-profile-end]');

  const addPosts = (items) => {
    for (const post of items) {
      if (state.ids.has(post.id)) continue;
      state.ids.add(post.id);
      cachePost(post);
      state.posts.push(post);
    }
  };

  const paint = () => {
    postsGrid.innerHTML = state.posts.length ? gridHTML(state.posts) : profileEmptyHTML({ mine });
    end.innerHTML = state.done && state.posts.length ? `<p class="feed-end">Tüm anlar burada. ♥</p>` : '';
  };

  const load = async () => {
    if (state.loading || state.done) return;
    state.loading = true;
    end.innerHTML = `<span class="spinner" style="color:var(--muted)"></span>`;
    try {
      const query = state.cursor ? `?cursor=${encodeURIComponent(state.cursor)}` : '';
      const next = await api(`/api/users/${encodeURIComponent(username)}${query}`, { signal: abort.signal });
      addPosts(next.posts || []);
      state.cursor = next.nextCursor;
      state.done = !next.nextCursor;
      paint();
    } catch (error) {
      if (error.name !== 'AbortError') toast(error.message, 'error');
    } finally {
      state.loading = false;
    }
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  }, { rootMargin: '700px' });
  observer.observe(end);

  const onShare = async () => {
    await shareURL(`/u/${user.username}`, `${user.displayName} · MelCandy`);
  };

  const syncFollowUI = (following, counts) => {
    user.isFollowing = following;
    if (counts) user.counts = { ...(user.counts || {}), ...counts };
    const button = root.querySelector('[data-follow-toggle]');
    if (button) {
      button.classList.toggle('btn-primary', !following);
      button.classList.toggle('btn-outline', following);
      button.innerHTML = `${icon(following ? 'check' : 'plus')} ${following ? 'Takibi bırak' : 'Takip et'}`;
    }
    const follower = root.querySelector('[data-follower-count]');
    if (follower) follower.textContent = fmtCount(user.counts?.followers || 0);
  };

  const toggleFollow = async () => {
    if (mine) return;
    const button = root.querySelector('[data-follow-toggle]');
    if (button) button.disabled = true;
    try {
      const result = user.isFollowing
        ? await api(`/api/users/${encodeURIComponent(user.username)}/follow`, { method: 'DELETE' })
        : await api(`/api/users/${encodeURIComponent(user.username)}/follow`, { method: 'POST' });
      syncFollowUI(Boolean(result.following), result.counts);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };

  const openFollowList = (kind) => {
    const title = kind === 'followers' ? 'Takipçiler' : 'Takip edilenler';
    const entry = openSheet({
      title,
      sub: `@${user.username}`,
      body: `<div class="chat-loading" style="padding:20px"><span class="spinner"></span></div>`,
      onMount: async (layer) => {
        const body = layer.querySelector('.sheet-body');
        try {
          const data = await api(`/api/users/${encodeURIComponent(user.username)}/${kind}`);
          const users = data.users || [];
          body.innerHTML = users.length
            ? `<div class="user-results">${users.map((person) => `
                <a class="user-result" href="/u/${esc(person.username)}">
                  ${avatarHTML(person, '', { dot: true })}
                  <span class="user-result-meta"><strong>${esc(person.displayName)}${person.isMe ? ' · sen' : ''}</strong><span>@${esc(person.username)}</span></span>
                  <span class="btn btn-sm btn-soft">${person.isMe ? 'Profilin' : 'Profili gör'}</span>
                </a>`).join('')}</div>`
            : `<p class="tiny muted" style="padding:8px 0">Henüz kimse yok.</p>`;
        } catch (error) {
          body.innerHTML = `<p class="tiny muted" style="padding:8px 0">${esc(error.message)}</p>`;
        }
      },
    });
    return entry;
  };

  const onClick = (event) => {
    if (event.target.closest('[data-follow-toggle]')) {
      toggleFollow();
      return;
    }
    const followList = event.target.closest('[data-follow-list]');
    if (followList) {
      openFollowList(followList.dataset.followList);
      return;
    }
    if (event.target.closest('[data-profile-share]')) shareProfile();
  };
  const shareProfile = () => onShare();

  root.addEventListener('click', onClick);

  const onRealtime = (event) => {
    const { type, data: payload } = event.detail || {};
    if (type === 'post:delete') {
      root.querySelectorAll(`[data-go="/p/${payload.postId}"]`).forEach((node) => node.remove());
      state.posts = state.posts.filter((post) => post.id !== payload.postId);
      state.ids.delete(payload.postId);
      paint();
    }
    if (type === 'post:new' || type === 'post:update') {
      if (payload.user?.id && payload.user.id !== user.id) return;
      if (type === 'post:update' && payload.postId) {
        api(`/api/posts/${encodeURIComponent(payload.postId)}`).then(({ post }) => {
          if (!post) return;
          state.posts = state.posts.filter((item) => item.id !== post.id);
          state.ids.delete(post.id);
          addPosts([post]);
          paint();
        }).catch(() => {});
      }
    }
    if (type === 'profile:update' && payload.user?.id === user.id) {
      api(`/api/users/${encodeURIComponent(username)}`).then((fresh) => {
        Object.assign(user, fresh.user);
        const name = root.querySelector('.profile-identity h1');
        if (name) name.textContent = fresh.user.displayName;
        const handle = root.querySelector('.profile-handle');
        if (handle) handle.textContent = `@${fresh.user.username}${fresh.user.pronouns ? ` · ${fresh.user.pronouns}` : ''}`;
        const avatar = root.querySelector('[data-profile-avatar]');
        if (avatar) avatar.innerHTML = avatarHTML(fresh.user, 'avatar-xl', { dot: true });
        const cover = root.querySelector('.profile-cover');
        if (cover) cover.innerHTML = `${fresh.user.cover ? `<img src="/api/media/${esc(fresh.user.cover)}" alt="">` : ''}${mine ? `<button class="profile-cover-edit" data-cover-pick>${icon('camera')} Kapak değiştir</button>` : ''}`;
      }).catch(() => {});
    }
  };
  window.addEventListener('ikimiz:event', onRealtime);

  addPosts(data.posts || []);
  state.done = !data.nextCursor;
  paint();

  return () => {
    abort.abort();
    observer.disconnect();
    window.removeEventListener('ikimiz:event', onRealtime);
  };
}

Views.profile = renderProfile;

/* ---------------------------------------------------------- profil düzenle */

async function renderProfileEdit(root) {
  const me = S.me || {};
  root.innerHTML = `<div class="view view-narrow">
    <div class="profile-edit-shell">
      <div class="composer-head">
        <a class="icon-btn" href="/u/${esc(me.username || '')}" data-go="/u/${esc(me.username || '')}" aria-label="Geri">${icon('arrow-left')}</a>
        <h1>Profili düzenle</h1>
      </div>

      <div class="card profile-edit-card" style="padding:0;overflow:hidden">
        <div class="profile-cover" data-edit-cover style="border-radius:0">
          ${me.cover ? `<img src="/api/media/${esc(me.cover)}" alt="">` : ''}
          <button type="button" class="profile-cover-edit" data-edit-cover-pick>${icon('camera')} Kapak seç</button>
        </div>
        <div style="padding:20px 24px 24px">
          <div class="avatar-edit-row">
            <div class="avatar-edit-preview">
              <span data-edit-avatar>${avatarHTML(me, 'avatar-xl')}</span>
              <button type="button" class="upload-badge" data-edit-avatar-pick aria-label="Profil fotoğrafı seç">${icon('camera')}</button>
            </div>
            <div class="avatar-edit-info">
              <strong>${esc(me.username)}</strong>
              <p>Fotoğrafı seçtikten sonra yakınlaştırıp konumlandırabilirsin. Görselin uygulamaya kayıtlı kişilere görünür.</p>
              <div style="display:flex;gap:7px;flex-wrap:wrap">
                <button type="button" class="btn btn-sm btn-soft" data-edit-avatar-pick>${icon('image')} Fotoğraf seç</button>
                <button type="button" class="btn btn-sm btn-ghost" data-edit-avatar-remove>Kaldır</button>
              </div>
            </div>
          </div>

          <form data-profile-form style="display:grid;gap:14px">
            <div class="form-row">
              <div class="field"><label for="edit-name">Görünen ad</label>
                <div class="input-wrap"><input id="edit-name" name="displayName" maxlength="40" value="${esc(me.displayName || '')}" required></div>
              </div>
              <div class="field"><label for="edit-username">Kullanıcı adı</label>
                <div class="input-wrap"><input id="edit-username" name="username" maxlength="24" value="${esc(me.username || '')}" autocapitalize="none" spellcheck="false" required></div>
              </div>
            </div>
            <div class="field"><label for="edit-pronouns">Hitap / zamir <span class="hint">isteğe bağlı</span></label>
              <div class="input-wrap"><input id="edit-pronouns" name="pronouns" maxlength="30" value="${esc(me.pronouns || '')}" placeholder="o / kendisi"></div>
            </div>
            <div class="field"><label for="edit-bio">Biyografi</label>
              <textarea id="edit-bio" name="bio" maxlength="220" placeholder="Kendine dair birkaç kelime…">${esc(me.bio || '')}</textarea>
              <div class="counter" data-bio-count>${(me.bio || '').length}/220</div>
            </div>
            <div class="field"><label for="edit-link">Bağlantı</label>
              <div class="input-wrap">${icon('link')}<input id="edit-link" name="link" maxlength="160" value="${esc(me.link || '')}" placeholder="https://…" inputmode="url"></div>
            </div>
            <div class="form-actions" style="justify-content:flex-end">
              <a class="btn btn-ghost" href="/u/${esc(me.username || '')}" data-go="/u/${esc(me.username || '')}">Vazgeç</a>
              <button class="btn btn-primary" type="submit" data-profile-save>${icon('check')} Kaydet</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>`;

  const form = root.querySelector('[data-profile-form]');
  const avatarBox = root.querySelector('[data-edit-avatar]');
  const coverBox = root.querySelector('[data-edit-cover]');
  const bio = form.querySelector('[name="bio"]');
  const counter = root.querySelector('[data-bio-count]');
  let pendingAvatar;
  let pendingCover;
  let busy = false;

  bio.addEventListener('input', () => {
    counter.textContent = `${bio.value.length}/220`;
    counter.classList.toggle('over', bio.value.length > 220);
  });

  const localPreviewURL = (blob) => URL.createObjectURL(blob);

  const pickAvatar = async () => {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;
    const image = await adjustImage(file, { ratio: '1:1', title: 'Profil fotoğrafını ayarla', max: 1024, quality: 0.92 });
    if (!image) return;
    const progress = progressOverlay('Fotoğraf yükleniyor');
    try {
      progress.step(0, 'Yükleniyor…');
      const media = await uploadMedia(image.blob, { kind: 'image', width: image.width, height: image.height, name: file.name, onProgress: (value) => progress.progress(value) });
      pendingAvatar = media.id;
      avatarBox.innerHTML = `<span class="avatar avatar-xl"><span class="avatar-media"><img src="${esc(localPreviewURL(image.blob))}" alt=""></span></span>`;
      progress.done();
      toast('Fotoğraf hazır. Kaydetmeyi unutma.', 'success');
    } catch (error) {
      progress.fail(error.message);
    }
  };

  const pickCover = async () => {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;
    const image = await adjustImage(file, { ratio: '3:1', title: 'Kapak fotoğrafını ayarla', max: 2048, quality: 0.9 });
    if (!image) return;
    const progress = progressOverlay('Kapak yükleniyor');
    try {
      progress.step(0, 'Yükleniyor…');
      const media = await uploadMedia(image.blob, { kind: 'image', width: image.width, height: image.height, name: file.name, onProgress: (value) => progress.progress(value) });
      pendingCover = media.id;
      coverBox.innerHTML = `<img src="${esc(localPreviewURL(image.blob))}" alt=""><button type="button" class="profile-cover-edit" data-edit-cover-pick>${icon('camera')} Kapak seç</button>`;
      progress.done();
      toast('Kapak hazır. Kaydetmeyi unutma.', 'success');
    } catch (error) {
      progress.fail(error.message);
    }
  };

  const removeAvatar = () => {
    pendingAvatar = null;
    avatarBox.innerHTML = `<span class="avatar avatar-xl"><span class="avatar-media"><span class="avatar-initial">${esc(initials(me.displayName))}</span></span></span>`;
  };

  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-avatar-pick]')) {
      event.preventDefault();
      pickAvatar();
    }
    if (event.target.closest('[data-edit-cover-pick]')) {
      event.preventDefault();
      pickCover();
    }
    if (event.target.closest('[data-edit-avatar-remove]')) {
      event.preventDefault();
      removeAvatar();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = form.querySelector('[data-profile-save]');
    button.disabled = true;
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = {
      displayName: values.displayName,
      username: values.username,
      pronouns: values.pronouns,
      bio: values.bio,
      link: values.link,
    };
    if (pendingAvatar !== undefined) payload.avatar = pendingAvatar;
    if (pendingCover !== undefined) payload.cover = pendingCover;
    try {
      const data = await api('/api/me', { method: 'PATCH', body: payload });
      S.me = data.user;
      S.online = S.online || [];
      toast('Profilin güncellendi', 'success');
      emit('profile:update', { user: { id: data.user.id, displayName: data.user.displayName, username: data.user.username, avatar: data.user.avatar } });
      navigate(`/u/${data.user.username}`);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    } finally {
      busy = false;
    }
  });
}

Views.profileEdit = renderProfileEdit;

/* ------------------------------------------------------------ gönderi detay */

async function renderPostDetail(root, { params }) {
  const postId = String(params.id || '').trim();
  let post = null;
  let comments = [];
  try {
    const [postData, commentsData] = await Promise.all([
      api(`/api/posts/${encodeURIComponent(postId)}`),
      api(`/api/posts/${encodeURIComponent(postId)}/comments`),
    ]);
    post = cachePost(postData.post);
    comments = commentsData.comments || [];
  } catch (error) {
    root.innerHTML = `<div class="view view-narrow"><div class="empty-state card" style="padding:56px 24px">
      <div class="empty-icon">${icon('image')}</div>
      <h3>${error.status === 404 ? 'Gönderi bulunamadı' : 'Gönderi yüklenemedi'}</h3>
      <p>${esc(error.message)}</p>
      <a class="btn btn-primary" href="/" data-go="/">${icon('home')} Ana akışa dön</a>
    </div></div>`;
    return;
  }

  root.innerHTML = `<div class="view view-wide">
    <div class="post-page" data-post-id="${esc(post.id)}">
      <div class="post-page-media">${postMediaHTML(post, { page: true })}</div>
      <div class="post-page-side" data-detail-side></div>
    </div>
  </div>`;

  const abort = new AbortController();
  let controller = null;
  let busy = false;

  const likesLabel = () => (Number(post.likeCount) > 0 ? `${fmtCount(post.likeCount)} beğeni` : 'İlk beğeni senin olsun');

  const paintSide = () => {
    const side = root.querySelector('[data-detail-side]');
    if (!side) return;
    const mine = post.user.id === S.me?.id;
    const headerMeta = [post.location, `${plural(post.commentCount || 0, 'yorum', 'yorum')}`].filter(Boolean).join(' · ');
    side.innerHTML = `<header class="post-page-head">
      <a href="/u/${esc(post.user.username)}" data-go="/u/${esc(post.user.username)}" aria-label="${esc(post.user.displayName)} profili">${avatarHTML(post.user, '', { dot: true })}</a>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:6px">
          <a href="/u/${esc(post.user.username)}" data-go="/u/${esc(post.user.username)}">${esc(post.user.username)}</a>
          ${mine ? '<span class="badge badge-neutral" style="font-size:8.5px;padding:2px 6px">sen</span>' : ''}
        </div>
        <div class="tiny muted" style="margin-top:2px">${esc(headerMeta)}</div>
      </div>
      <button class="icon-btn" data-post-menu="${esc(post.id)}" aria-label="Gönderi seçenekleri">${icon('more')}</button>
    </header>
    ${captionHTML(post, { page: true })}
    <div class="post-page-comments comment-list" data-detail-comments></div>
    <div class="post-page-foot">
      <div class="post-page-actions">
        <button class="icon-btn like-btn ${post.liked ? 'liked' : ''}" data-like="${esc(post.id)}" aria-label="${post.liked ? 'Beğeniyi geri al' : 'Beğen'}" aria-pressed="${post.liked}">${icon(post.liked ? 'heart-fill' : 'heart')}</button>
        <button class="icon-btn" data-detail-focus aria-label="Yorum yaz">${icon('comment')}</button>
        <button class="icon-btn" data-share="${esc(post.id)}" aria-label="Paylaş">${icon('send')}</button>
        <span class="spacer"></span>
        <button class="icon-btn save-btn ${post.saved ? 'saved' : ''}" data-save="${esc(post.id)}" aria-label="${post.saved ? 'Kaydedilenlerden çıkar' : 'Kaydet'}" aria-pressed="${post.saved}">${icon(post.saved ? 'bookmark-fill' : 'bookmark')}</button>
      </div>
      <div class="post-page-meta">
        <div class="likes" data-like-count>${likesLabel()}</div>
        <div class="time">${esc(fmtDateTime(post.createdAt))}${post.archived ? ' · arşivde' : ''}${post.music ? ` · ${esc(post.music)}` : ''}</div>
      </div>
      <div data-detail-comment-foot></div>
    </div>`;

    const listEl = side.querySelector('[data-detail-comments]');
    const footEl = side.querySelector('[data-detail-comment-foot]');
    footEl.innerHTML = commentFormHTML(post);
    controller = createCommentController({
      post,
      comments,
      listEl,
      footEl,
      onChange: (count) => {
        post.commentCount = Number(count) || 0;
        updateCommentCountUI(post.id, count);
        const sub = side.querySelector('.post-page-head .tiny');
        if (sub) sub.textContent = [post.location, plural(post.commentCount, 'yorum', 'yorum')].filter(Boolean).join(' · ');
      },
    });
  };

  const refreshComments = async () => {
    try {
      const data = await api(`/api/posts/${encodeURIComponent(postId)}/comments`, { signal: abort.signal });
      comments = data.comments || [];
      paintSide();
    } catch (error) {
      if (error.name !== 'AbortError') { /* sessiz kal */ }
    }
  };

  const refreshPost = async () => {
    try {
      const data = await api(`/api/posts/${encodeURIComponent(postId)}`, { signal: abort.signal });
      post = cachePost(data.post);
      paintSide();
    } catch (error) {
      if (error.name !== 'AbortError' && error.status === 404) navigate('/');
    }
  };

  const onDetailClick = (event) => {
    if (!event.target.closest('[data-detail-focus]')) return;
    event.preventDefault();
    const input = root.querySelector('[data-comment-form] input[name="body"]');
    if (input) {
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const onRealtime = (event) => {
    const { type, data } = event.detail || {};
    if (type === 'like' && data?.postId === postId) {
      if (data.userId !== S.me?.id) {
        post.likeCount = Number(data.likeCount) || 0;
        updateLikeUI(post.id, post.liked, post.likeCount);
      }
      return;
    }
    if (type === 'post:delete' && data?.postId === postId) {
      toast('Gönderi silindi', '');
      navigate('/');
      return;
    }
    if (type === 'post:update' && data?.postId === postId) {
      refreshPost();
      return;
    }
    if (!['comment:new', 'comment:update', 'comment:delete'].includes(type)) return;
    if (data?.postId !== postId) return;
    if (type === 'comment:new' && data.comment?.user?.id === S.me?.id) {
      post.commentCount = Number(data.count) || post.commentCount;
      return;
    }
    refreshComments();
  };

  root.addEventListener('click', onDetailClick);
  window.addEventListener('ikimiz:event', onRealtime);
  wirePostInteractions(root, { onChange: () => {} });
  paintSide();

  return () => {
    abort.abort();
    window.removeEventListener('ikimiz:event', onRealtime);
  };
}

Views.postDetail = renderPostDetail;

/* -------------------------------------------------------------------- sohbet */

const CHAT_EMOJIS = ['❤️', '😂', '😮', '😢', '👍', '🔥', '🥰', '🙈', '✨', '💋'];
const QUICK_REACTIONS = ['❤️', '😂', '😮', '👍'];
const STICKER_PRESETS = [
  '💖', '🥰', '😘', '😍', '🤭', '😻',
  '🌸', '✨', '🍓', '🍬', '🧸', '🎀',
  '💋', '🫶', '🥺', '😴', '🙈', '🐣',
  '🌈', '🌙', '🍭', '💐', '💌', '🧁',
];

function replyPreviewText(reply) {
  if (!reply) return '';
  if (reply.body) return reply.body.slice(0, 90);
  if (reply.stickerEmoji) return reply.stickerEmoji;
  if (reply.hasSticker) return 'sticker';
  if (reply.hasMedia) return 'medya';
  return 'mesaj';
}

function messageSummary(message) {
  if (!message) return '';
  if (message.deleted) return 'Mesaj silindi';
  if (message.body) return message.body;
  if (message.sticker?.emoji) return message.sticker.emoji;
  if (message.sticker?.media) return 'Sticker';
  if (message.media?.kind === 'audio') return 'Sesli mesaj';
  if (message.media?.kind === 'video') return 'Video';
  if (message.media) return 'Medya';
  return 'Mesaj';
}

function chatStickerHTML(sticker) {
  if (!sticker) return '';
  if (sticker.media?.url) {
    return `<span class="msg-sticker"><img src="${esc(sticker.media.url)}" alt="Sticker" loading="lazy"></span>`;
  }
  if (sticker.emoji) {
    return `<span class="msg-sticker msg-sticker-emoji" role="img" aria-label="${esc(sticker.emoji)} sticker">${esc(sticker.emoji)}</span>`;
  }
  return '';
}

function chatReactionsHTML(message) {
  const reactions = message.reactions || [];
  if (!reactions.length) return '';
  const counts = new Map();
  for (const reaction of reactions) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) || 0) + 1);
  }
  const mine = new Set(
    reactions.filter((reaction) => reaction.userId === S.me?.id).map((reaction) => reaction.emoji),
  );
  return `<div class="msg-reactions" aria-label="Tepkiler">${[...counts.entries()].map(([emoji, count]) => {
    const active = mine.has(emoji);
    return `<button type="button" class="msg-reaction${active ? ' mine' : ''}" data-msg-react="${esc(emoji)}" data-msg-id="${esc(message.id)}" aria-pressed="${active}" aria-label="${esc(emoji)} tepkisi${count > 1 ? ` ${count}` : ''}">${esc(emoji)}${count > 1 ? `<b>${count}</b>` : ''}</button>`;
  }).join('')}</div>`;
}

function chatMediaHTML(message) {
  const media = message.media;
  if (!media) return '';
  if (media.kind === 'audio') {
    return `<div class="msg-audio"><audio src="${esc(media.url)}" controls preload="metadata"></audio></div>`;
  }
  if (media.kind === 'video') {
    return `<div class="msg-media"><video src="${esc(media.url)}" ${media.posterUrl ? `poster="${esc(media.posterUrl)}"` : ''} controls playsinline preload="metadata"></video></div>`;
  }
  return `<div class="msg-media"><img src="${esc(media.url)}" alt="Paylaşılan görsel" loading="lazy" data-chat-media="${esc(media.url)}"></div>`;
}

function chatBubbleHTML(message) {
  const quote = message.replyTo
    ? `<button type="button" class="msg-reply-quote" data-reply-jump="${esc(message.replyTo.id)}"><b>@${esc(message.replyTo.username)}</b> · ${esc(replyPreviewText(message.replyTo))}</button>`
    : '';
  if (message.deleted) {
    return `<div class="msg-bubble" style="font-style:italic;opacity:.6" data-msg-menu="${esc(message.id)}">Bu mesaj silindi</div>`;
  }
  const body = message.body ? linkify(message.body) : '';
  const sticker = chatStickerHTML(message.sticker);
  const gap = body && (message.media || sticker) ? '<div style="height:6px"></div>' : '';
  const onlySticker = Boolean(sticker) && !body && !quote;
  return `<div class="msg-bubble${onlySticker ? ' msg-bubble-sticker' : ''}" data-msg-menu="${esc(message.id)}">${quote}${body}${gap}${chatMediaHTML(message)}${sticker}</div>`;
}

function chatRowHTML(message, partner) {
  const own = Boolean(message.mine);
  const avatar = !own
    ? `<a href="/u/${esc(message.sender?.username || partner?.username || '')}" data-go="/u/${esc(message.sender?.username || partner?.username || '')}" aria-label="${esc(message.sender?.displayName || '')}">${avatarHTML(message.sender || partner, 'avatar-xs')}</a>`
    : '';
  const meta = [fmtTime(message.createdAt)];
  if (message.editedAt) meta.push('düzenlendi');
  if (own) meta.push(message.seenAt ? '<span class="seen">Görüldü</span>' : 'Gönderildi');
  const id = esc(message.id);
  const quick = message.deleted ? '' : `<div class="msg-quick" role="group" aria-label="Mesaj eylemleri">
    <button type="button" data-msg-reply="${id}" aria-label="Yanıtla" title="Yanıtla">${icon('comment')}</button>
    ${QUICK_REACTIONS.map((emoji) => `<button type="button" data-msg-react="${esc(emoji)}" data-msg-id="${id}" aria-label="${esc(emoji)} tepkisi ver" title="${esc(emoji)}">${esc(emoji)}</button>`).join('')}
    <button type="button" data-msg-more="${id}" aria-label="Diğer seçenekler" title="Diğer seçenekler">${icon('more')}</button>
  </div>`;
  return `<div class="msg-row ${own ? 'own' : ''}" data-message-row="${id}">
    ${avatar}
    <div class="msg-stack">
      <div class="msg-bubble-wrap">
        ${chatBubbleHTML(message)}
        ${quick}
      </div>
      ${chatReactionsHTML(message)}
      <div class="msg-meta">${meta.join(' · ')}</div>
    </div>
  </div>`;
}

function chatMessagesHTML(messages, partner) {
  let previous = null;
  return messages.map((message) => {
    const separator = !previous || !sameDay(previous.createdAt, message.createdAt)
      ? `<div class="day-sep">${esc(dayLabel(message.createdAt))}</div>`
      : '';
    previous = message;
    return separator + chatRowHTML(message, partner);
  }).join('');
}

function chatIntroHTML(partner) {
  return `<div class="chat-intro">
    ${avatarHTML(partner || {}, '', { dot: true })}
    <strong>${esc(partner?.displayName || 'Sohbet')}</strong>
    <p>Sohbetin başlangıcı. İlk mesajı yaz, bir fotoğraf, sticker ya da sesli mesaj gönder.</p>
  </div>`;
}

function conversationRowHTML(conversation, { active = false } = {}) {
  const user = conversation.user || {};
  const last = conversation.lastMessage;
  const preview = last
    ? `${last.mine ? 'Sen: ' : ''}${messageSummary(last)}`
    : 'Sohbeti başlat';
  return `<a class="conv-row${active ? ' active' : ''}" href="/mesajlar/${esc(user.username)}" data-go="/mesajlar/${esc(user.username)}"${active ? ' aria-current="page"' : ''}>
    ${avatarHTML(user, 'avatar-md', { dot: true })}
    <span class="conv-main">
      <span class="conv-top"><strong>${esc(user.displayName || user.username || '')}</strong><span class="conv-time">${conversation.lastAt ? esc(timeAgo(conversation.lastAt)) : ''}</span></span>
      <span class="conv-preview ${last && !last.mine && conversation.unreadCount ? 'fresh' : ''}">${esc(String(preview).slice(0, 90))}</span>
    </span>
    ${conversation.unreadCount ? `<span class="conv-badge">${conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>` : ''}
  </a>`;
}

function memberRowHTML(person) {
  return `<a class="dm-member" href="/mesajlar/${esc(person.username)}" data-go="/mesajlar/${esc(person.username)}" title="${esc(person.displayName || person.username)} ile sohbet">
    ${avatarHTML(person, 'avatar-sm', { dot: true })}
    <span class="dm-member-main"><strong>${esc(person.displayName || person.username)}</strong><small>@${esc(person.username)}</small></span>
    <span class="dm-member-go">${icon('message')}</span>
  </a>`;
}

function messagesShellHTML({ username = '' } = {}) {
  const me = S.me || {};
  return `<div class="view view-wide dm-view">
    <div class="dm-shell" data-dm-view="${username ? 'chat' : 'list'}">
      <aside class="dm-side" aria-label="Sohbetler">
        <div class="dm-side-head">
          <h1>Mesajlar</h1>
        </div>
        <div class="dm-search">
          <input type="search" placeholder="Sohbetlerde ara" aria-label="Sohbetlerde ara" autocomplete="off" data-dm-search>
        </div>
        <div class="dm-scroll">
          <div class="dm-side-label">Sohbetler</div>
          <div class="dm-list" data-conv-list><div class="chat-loading"><span class="spinner"></span></div></div>
          <div class="dm-side-extra">
            <div class="dm-side-label">Yeni sohbet</div>
            <div class="dm-list" data-people-list><div class="chat-loading"><span class="spinner"></span></div></div>
          </div>
        </div>
        <div class="dm-side-foot">
          <a class="dm-me" href="/u/${esc(me.username || '')}" data-go="/u/${esc(me.username || '')}">
            ${avatarHTML(me, 'avatar-sm', { dot: true })}
            <span class="dm-me-main"><strong>${esc(me.displayName || 'Profil')}</strong><small>@${esc(me.username || '')}</small></span>
          </a>
          <a class="icon-btn dm-icon-btn" href="/ayarlar" data-go="/ayarlar" aria-label="Ayarlar">${icon('settings')}</a>
        </div>
      </aside>
      <section class="dm-main" data-dm-main></section>
      <aside class="dm-members" aria-label="Topluluk">
        <div class="dm-members-head"><span>Topluluk</span><span class="dm-online" data-dm-online></span></div>
        <div class="dm-members-body" data-dm-members></div>
      </aside>
    </div>
  </div>`;
}

function personRowHTML(person) {
  return `<a class="conv-row" href="/mesajlar/${esc(person.username)}" data-go="/mesajlar/${esc(person.username)}">
    ${avatarHTML(person, 'avatar-md', { dot: true })}
    <span class="conv-main">
      <span class="conv-top"><strong>${esc(person.displayName || person.username)}</strong></span>
      <span class="conv-preview">@${esc(person.username)} · sohbet başlat</span>
    </span>
    <span class="conv-go">${icon('message')}</span>
  </a>`;
}

async function renderMessages(root, { params } = {}) {
  const username = String(params?.id || '').trim();
  root.innerHTML = messagesShellHTML({ username });

  const listEl = root.querySelector('[data-conv-list]');
  const peopleEl = root.querySelector('[data-people-list]');
  const membersEl = root.querySelector('[data-dm-members]');
  const onlineEl = root.querySelector('[data-dm-online]');
  const mainEl = root.querySelector('[data-dm-main]');
  const searchEl = root.querySelector('[data-dm-search]');
  const abort = new AbortController();
  let data = { conversations: [], people: [], online: [] };
  let loading = false;
  let chatCleanup = null;

  const applySearch = () => {
    const q = String(searchEl.value || '').trim().toLocaleLowerCase('tr');
    let shown = 0;
    listEl.querySelectorAll('.conv-row').forEach((row) => {
      const match = !q || row.textContent.toLocaleLowerCase('tr').includes(q);
      row.classList.toggle('hidden', !match);
      if (match) shown += 1;
    });
    const rows = listEl.querySelectorAll('.conv-row').length;
    let note = listEl.querySelector('[data-dm-no-match]');
    if (q && rows && !shown) {
      if (!note) {
        note = document.createElement('p');
        note.dataset.dmNoMatch = '';
        note.className = 'dm-note';
        listEl.appendChild(note);
      }
      note.textContent = 'Eşleşen sohbet yok.';
    } else {
      note?.remove();
    }
  };

  const paintList = () => {
    const active = username.toLocaleLowerCase('tr');
    const items = data.conversations;
    listEl.innerHTML = items.length
      ? items.map((conversation) => conversationRowHTML(conversation, {
        active: String(conversation.user?.username || '').toLocaleLowerCase('tr') === active,
      })).join('')
      : '<p class="dm-note">Henüz sohbet yok. Aşağıdaki kişilerden birine ilk mesajı yaz.</p>';

    const talkedTo = new Set(items.map((item) => item.user?.id));
    const others = data.people.filter((person) => person.id !== S.me?.id && !talkedTo.has(person.id));
    peopleEl.innerHTML = others.length
      ? others.map(personRowHTML).join('')
      : '<p class="dm-note">Yeni sohbet başlatabileceğin başka bir hesap yok.</p>';

    listEl.querySelector('.conv-row.active')?.scrollIntoView({ block: 'nearest' });
    applySearch();
  };

  const paintMembers = () => {
    const onlineIds = new Set([...(Array.isArray(data.online) ? data.online : []), ...(Array.isArray(S.online) ? S.online : [])]);
    const people = data.people.filter((person) => person.id !== S.me?.id);
    const online = people.filter((person) => onlineIds.has(person.id) || person.online);
    const offline = people.filter((person) => !onlineIds.has(person.id) && !person.online);
    onlineEl.textContent = online.length ? `${online.length} çevrimiçi` : '';
    const group = (label, items) => (items.length
      ? `<div class="dm-member-group"><span>${label}</span><b>${items.length}</b></div>${items.map(memberRowHTML).join('')}`
      : '');
    membersEl.innerHTML = people.length
      ? group('Çevrimiçi', online) + group('Çevrimdışı', offline)
      : '<p class="dm-note">Henüz başka hesap yok. Davet bağlantısıyla arkadaşlarını çağırabilirsin.</p>';
  };

  const loadSide = async () => {
    if (loading) return;
    loading = true;
    try {
      const [conversationData, userData] = await Promise.all([
        api('/api/conversations', { signal: abort.signal }),
        api('/api/users', { signal: abort.signal }),
      ]);
      data = {
        conversations: conversationData.conversations || [],
        people: userData.users || [],
        online: userData.online || [],
      };
      paintList();
      paintMembers();
    } catch (error) {
      if (error.name === 'AbortError') return;
      listEl.innerHTML = `<div class="dm-note">${esc(error.message)}</div><button type="button" class="btn btn-sm btn-outline" data-conv-retry>Yeniden dene</button>`;
      peopleEl.innerHTML = '';
      membersEl.innerHTML = '';
    } finally {
      loading = false;
    }
  };

  const onRealtime = (event) => {
    const { type, data: payload } = event.detail || {};
    if (type === 'presence') {
      data.online = Array.isArray(payload?.online) ? payload.online : data.online;
      paintMembers();
      return;
    }
    if (['message:new', 'message:seen', 'message:delete', 'users:update', 'follow:update', 'profile:update'].includes(type)) loadSide();
  };
  const onClick = (event) => {
    if (event.target.closest('[data-conv-retry]')) loadSide();
  };
  const onSearch = () => applySearch();

  root.addEventListener('click', onClick);
  searchEl.addEventListener('input', onSearch);
  window.addEventListener('ikimiz:event', onRealtime);

  if (username) {
    chatCleanup = await renderConversation(mainEl, username);
  } else {
    const firstName = String(S.me?.displayName || '').trim().split(/\s+/)[0];
    mainEl.innerHTML = `<div class="dm-welcome">
      <div class="dm-welcome-icon">${icon('message')}</div>
      <h2>${firstName ? `Hoş geldin, ${esc(firstName)}` : 'Mesajlar'}</h2>
      <p>Soldaki bir sohbeti seç ya da topluluktan birine ilk mesajı gönder.</p>
      <div class="dm-welcome-actions">
        <a class="btn btn-outline btn-sm" href="/" data-go="/">${icon('home')} Akışa dön</a>
      </div>
    </div>`;
  }

  await loadSide();

  return () => {
    abort.abort();
    root.removeEventListener('click', onClick);
    searchEl.removeEventListener('input', onSearch);
    window.removeEventListener('ikimiz:event', onRealtime);
    try { chatCleanup?.(); } catch { /* ignore */ }
  };
}

async function renderConversation(container, username) {
  container.innerHTML = '<div class="chat-loading" style="min-height:220px"><span class="spinner"></span></div>';
  const path = `/api/conversations/${encodeURIComponent(username)}`;

  let initial;
  try {
    initial = await api(`${path}/messages?limit=50`);
  } catch (error) {
    container.innerHTML = `<div class="dm-welcome">
      <div class="dm-welcome-icon">${icon('message')}</div>
      <h2>Sohbet açılamadı</h2>
      <p>${esc(error.message || 'Bu kişiyle sohbet başlatılamadı.')}</p>
      <div class="dm-welcome-actions">
        <a class="btn btn-primary btn-sm" href="/mesajlar" data-go="/mesajlar">${icon('message')} Sohbetler</a>
        <a class="btn btn-outline btn-sm" href="/" data-go="/">${icon('home')} Akışa dön</a>
      </div>
    </div>`;
    return;
  }

  const partner = initial.user || { displayName: username, username };

  container.innerHTML = `<div class="chat-page">
        <header class="chat-head">
          <a class="icon-btn dm-mobile-only" href="/mesajlar" data-go="/mesajlar" aria-label="Sohbetlere dön">${icon('arrow-left')}</a>
          <a href="/u/${esc(partner.username)}" data-go="/u/${esc(partner.username)}" aria-label="${esc(partner.displayName)} profili">${avatarHTML(partner, '', { dot: true })}</a>
          <div class="chat-head-meta">
            <strong>${esc(partner.displayName)}</strong>
            <span data-chat-presence>${partner.online ? '<span class="online">şu an çevrimiçi</span>' : (partner.lastSeenAt ? `son görülme ${esc(timeAgoText(partner.lastSeenAt))}` : 'çevrimdışı')}</span>
          </div>
          <a class="icon-btn dm-mobile-only" href="/u/${esc(partner.username)}" data-go="/u/${esc(partner.username)}" aria-label="${esc(partner.displayName)} profili">${icon('user')}</a>
        </header>
        <div class="chat-body" data-chat-body></div>
        <button type="button" class="chat-scroll-bottom hidden" data-chat-bottom aria-label="En sona in">${icon('chevron-down')}</button>
        <div class="chat-compose">
          <div class="chat-reply-banner hidden" data-chat-reply></div>
          <div class="recording-bar hidden" data-recording-bar>
            <span class="recording-dot"></span>
            <span data-record-time class="mono">0:00</span>
            <span class="tiny">kaydediliyor…</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn-sm btn-ghost" data-record-cancel>Vazgeç</button>
            <button type="button" class="btn btn-sm btn-primary" data-record-send>Gönder</button>
          </div>
          <form class="chat-input-row" data-chat-form>
            <button type="button" class="icon-btn" data-chat-attach aria-label="Medya ekle">${icon('image')}</button>
            <button type="button" class="icon-btn sticker-btn" data-chat-sticker aria-label="Sticker ekle">${icon('sticker')}</button>
            <div class="chat-input-wrap">
              <textarea name="body" rows="1" maxlength="2000" placeholder="Mesaj yaz…" aria-label="Mesaj" autocomplete="off"></textarea>
              <button type="button" class="emoji-btn" data-chat-emoji aria-label="Emoji">${icon('emoji')}</button>
            </div>
            <button type="button" class="icon-btn mic-btn" data-chat-mic aria-label="Sesli mesaj">${icon('mic')}</button>
            <button type="submit" class="send-btn" data-chat-send aria-label="Gönder" disabled>${icon('send')}</button>
          </form>
          <div class="emoji-panel hidden" data-chat-emojis></div>
          <div class="sticker-panel hidden" data-chat-stickers></div>
        </div>
      </div>`;

  const root = container;
  const bodyEl = root.querySelector('[data-chat-body]');
  const form = root.querySelector('[data-chat-form]');
  const textarea = form.querySelector('textarea');
  const sendButton = form.querySelector('[data-chat-send]');
  const attachButton = form.querySelector('[data-chat-attach]');
  const stickerButton = form.querySelector('[data-chat-sticker]');
  const micButton = form.querySelector('[data-chat-mic]');
  const bottomButton = root.querySelector('[data-chat-bottom]');
  const replyBanner = root.querySelector('[data-chat-reply]');
  const recordingBar = root.querySelector('[data-recording-bar]');
  const recordTime = root.querySelector('[data-record-time]');
  const emojiPanel = root.querySelector('[data-chat-emojis]');
  const stickerPanel = root.querySelector('[data-chat-stickers]');
  const presenceEl = root.querySelector('[data-chat-presence]');

  const state = {
    messages: initial.messages || [],
    hasMore: Boolean(initial.hasMore),
    nextBefore: initial.nextBefore || null,
    loading: false,
    sending: false,
    uploading: false,
    replyTo: null,
    typingTimer: 0,
    typingNode: null,
    lastTypingAt: 0,
    recorder: null,
    recStream: null,
    recChunks: [],
    recStarted: 0,
    recTimer: 0,
    recCancel: false,
    stickers: [],
    stickersLoaded: false,
    stickersLoading: false,
    stickersError: '',
  };

  const nearBottom = () => bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 120;

  const updateSendState = () => {
    sendButton.disabled = state.sending || state.uploading || !textarea.value.trim();
    attachButton.disabled = state.uploading;
    stickerButton.disabled = state.uploading;
    micButton.disabled = state.uploading;
  };

  const autoGrow = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(120, Math.max(30, textarea.scrollHeight))}px`;
    updateSendState();
  };

  const paint = ({ scrollToBottom = false, keepTop = false } = {}) => {
    const previousHeight = bodyEl.scrollHeight;
    const previousTop = bodyEl.scrollTop;
    const wasBottom = previousHeight - previousTop - bodyEl.clientHeight < 120;
    bodyEl.innerHTML = state.messages.length ? chatMessagesHTML(state.messages, partner) : chatIntroHTML(partner);
    if (scrollToBottom || wasBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
    else if (keepTop) bodyEl.scrollTop = bodyEl.scrollHeight - previousHeight + previousTop;
    else bodyEl.scrollTop = Math.min(previousTop, bodyEl.scrollHeight);
    bottomButton.classList.toggle('hidden', nearBottom());
  };

  const sortMessages = () => {
    state.messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  };

  const renderPresence = () => {
    if (!presenceEl) return;
    presenceEl.innerHTML = partner.online
      ? '<span class="online">şu an çevrimiçi</span>'
      : (partner.lastSeenAt ? `son görülme ${esc(timeAgoText(partner.lastSeenAt))}` : 'çevrimdışı');
  };

  const renderReply = () => {
    if (!state.replyTo) {
      replyBanner.classList.add('hidden');
      replyBanner.innerHTML = '';
      return;
    }
    const target = state.replyTo;
    const snippet = messageSummary(target).slice(0, 80);
    replyBanner.classList.remove('hidden');
    replyBanner.innerHTML = `<span>${icon('comment')} <b>@${esc(target.sender?.username || partner.username)}</b> · ${esc(snippet)}</span>
      <button type="button" data-chat-reply-cancel aria-label="Yanıtı iptal et">${icon('close')}</button>`;
  };

  const markSeen = () => {
    if (document.visibilityState !== 'visible') return;
    api(`${path}/seen`, { method: 'POST' }).catch(() => {});
  };

  const loadOlder = async () => {
    if (state.loading || !state.hasMore || !state.nextBefore) return;
    state.loading = true;
    try {
      const data = await api(`${path}/messages?limit=50&before=${encodeURIComponent(state.nextBefore)}`);
      const known = new Set(state.messages.map((message) => message.id));
      const older = (data.messages || []).filter((message) => !known.has(message.id));
      state.messages = [...older, ...state.messages];
      state.hasMore = Boolean(data.hasMore);
      state.nextBefore = data.nextBefore || null;
      paint({ keepTop: true });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.loading = false;
    }
  };

  const sendMessage = async ({ body = '', mediaId = null, stickerEmoji = '', stickerId = null } = {}) => {
    if (state.sending) return null;
    state.sending = true;
    updateSendState();
    try {
      const data = await api(`${path}/messages`, {
        method: 'POST',
        body: {
          body,
          mediaId: mediaId || undefined,
          stickerEmoji: stickerEmoji || undefined,
          stickerMediaId: stickerId || undefined,
          replyToId: state.replyTo?.id || undefined,
        },
      });
      const message = data.message;
      if (message && !state.messages.some((item) => item.id === message.id)) {
        state.messages.push(message);
        sortMessages();
        paint({ scrollToBottom: true });
      }
      state.replyTo = null;
      renderReply();
      return message;
    } catch (error) {
      toast(error.message, 'error');
      return null;
    } finally {
      state.sending = false;
      updateSendState();
    }
  };

  const closeComposerPanels = (except = null) => {
    for (const panel of [emojiPanel, stickerPanel]) {
      if (panel && panel !== except) panel.classList.add('hidden');
    }
  };

  const reactToMessage = async (message, emoji) => {
    if (!message || message.deleted || !emoji) return;
    try {
      const data = await api(`/api/messages/${encodeURIComponent(message.id)}/react`, {
        method: 'POST',
        body: { emoji },
      });
      message.reactions = data.reactions || [];
      haptic(7);
      paint();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const startReply = (message) => {
    if (!message || message.deleted) return;
    state.replyTo = message;
    closeComposerPanels();
    renderReply();
    textarea.focus({ preventScroll: true });
  };

  const jumpToMessage = (id) => {
    const row = [...bodyEl.querySelectorAll('[data-message-row]')]
      .find((node) => node.dataset.messageRow === String(id));
    if (!row) {
      toast('Bu mesaj artık sohbette görünmüyor.', 'error');
      return;
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('msg-flash');
    requestAnimationFrame(() => row.classList.add('msg-flash'));
    setTimeout(() => row.classList.remove('msg-flash'), 1400);
  };

  const paintStickerPanel = () => {
    if (!stickerPanel) return;
    if (state.stickersLoading && !state.stickersLoaded) {
      stickerPanel.innerHTML = '<div class="sticker-panel-loading"><span class="spinner"></span><span>Stickerlar yükleniyor…</span></div>';
      return;
    }
    if (state.stickersError && !state.stickersLoaded) {
      stickerPanel.innerHTML = `<div class="sticker-panel-error"><p>${esc(state.stickersError)}</p><button type="button" class="btn btn-sm btn-outline" data-sticker-retry>Yeniden dene</button></div>`;
      return;
    }

    const mine = state.stickers.length
      ? `<div class="sticker-grid sticker-grid-mine">${state.stickers.map((sticker) => {
        const media = sticker.media || {};
        const label = sticker.label || 'Sticker';
        return `<span class="sticker-tile sticker-tile-media">
          <button type="button" class="sticker-send" data-sticker-id="${esc(sticker.id)}" aria-label="${esc(label)} stickerını gönder" title="${esc(label)}">
            <img src="${esc(media.url || '')}" alt="${esc(label)}" loading="lazy">
          </button>
          <button type="button" class="sticker-remove" data-sticker-remove="${esc(sticker.id)}" aria-label="${esc(label)} stickerını sil" title="Stickerı sil">${icon('close')}</button>
        </span>`;
      }).join('')}</div>`
      : '<p class="sticker-empty">Henüz kendi stickerın yok. Şeffaf arka planlı bir PNG yükleyerek kitaplığını oluştur.</p>';

    stickerPanel.innerHTML = `<div class="sticker-panel-head">
        <div><strong>Stickerlar</strong><span>${state.stickers.length}/80 özel sticker</span></div>
        <button type="button" class="btn btn-sm btn-soft" data-sticker-upload>${icon('plus')} Sticker yükle</button>
      </div>
      <div class="sticker-panel-label">Hazır stickerlar</div>
      <div class="sticker-grid">${STICKER_PRESETS.map((emoji) => `<button type="button" class="sticker-tile sticker-emoji" data-sticker-emoji="${esc(emoji)}" aria-label="${esc(emoji)} stickerını gönder">${esc(emoji)}</button>`).join('')}</div>
      <div class="sticker-panel-label">Stickerlarım <span>PNG önerilir</span></div>
      ${mine}`;
  };

  const loadStickers = async ({ force = false } = {}) => {
    if (state.stickersLoading) return;
    if (state.stickersLoaded && !force) return;
    state.stickersLoading = true;
    state.stickersError = '';
    paintStickerPanel();
    try {
      const data = await api('/api/stickers');
      state.stickers = Array.isArray(data.stickers) ? data.stickers : [];
      state.stickersLoaded = true;
    } catch (error) {
      if (error.name !== 'AbortError') state.stickersError = error.message || 'Stickerlar yüklenemedi.';
    } finally {
      state.stickersLoading = false;
      paintStickerPanel();
    }
  };

  const toggleStickerPanel = async () => {
    if (!stickerPanel) return;
    if (!stickerPanel.classList.contains('hidden')) {
      stickerPanel.classList.add('hidden');
      return;
    }
    closeComposerPanels(stickerPanel);
    stickerPanel.classList.remove('hidden');
    paintStickerPanel();
    await loadStickers();
  };

  const sendSticker = async ({ emoji = '', stickerId = null } = {}) => {
    const sent = await sendMessage({ stickerEmoji: emoji, stickerId });
    if (sent) {
      stickerPanel.classList.add('hidden');
      haptic(9);
    }
  };

  const uploadSticker = async () => {
    if (state.uploading) return;
    const files = await pickFiles({ accept: 'image/*', multiple: false });
    const file = files[0];
    if (!file) return;
    if (fileKind(file) !== 'image') {
      toast('Sticker için bir görsel seçmelisin.', 'error');
      return;
    }
    state.uploading = true;
    updateSendState();
    const progress = progressOverlay('Sticker ekleniyor');
    try {
      progress.step(0, 'Kare olarak hazırlanıyor…');
      const processed = await adjustImage(file, {
        ratio: '1:1',
        title: 'Stickerı ayarla',
        max: 512,
        quality: 0.92,
        format: 'png',
      });
      if (!processed) {
        progress.done();
        return;
      }
      progress.step(1, 'Yükleniyor…');
      const media = await uploadMedia(processed.blob, {
        kind: 'image',
        width: processed.width,
        height: processed.height,
        name: 'sticker.png',
        onProgress: (value) => progress.progress(value * 0.9, 'Sticker yükleniyor…'),
      });
      progress.step(2, 'Kitaplığa ekleniyor…');
      const data = await api('/api/stickers', {
        method: 'POST',
        body: {
          mediaId: media.id,
          label: String(file.name || 'sticker').replace(/\.[^.]+$/, '').slice(0, 60),
        },
      });
      if (data?.sticker) state.stickers = [data.sticker, ...state.stickers];
      state.stickersLoaded = true;
      progress.done();
      paintStickerPanel();
      toast('Sticker kitaplığına eklendi', 'success');
    } catch (error) {
      progress.fail(error.message);
    } finally {
      state.uploading = false;
      updateSendState();
    }
  };

  const removeSticker = async (id) => {
    const sticker = state.stickers.find((item) => item.id === id);
    if (!sticker) return;
    const ok = await confirmDialog({
      title: 'Sticker silinsin mi?',
      message: 'Sticker kitaplığından kaldırılacak. Daha önce gönderdiğin mesajlarda görünmeye devam eder.',
      confirmText: 'Sil',
      danger: true,
      iconName: 'trash',
    });
    if (!ok) return;
    try {
      await api(`/api/stickers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.stickers = state.stickers.filter((item) => item.id !== id);
      paintStickerPanel();
      toast('Sticker silindi', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const showTyping = () => {
    clearTimeout(state.typingTimer);
    if (!state.typingNode) {
      const node = document.createElement('div');
      node.className = 'typing-row';
      node.innerHTML = `${avatarHTML(partner, 'avatar-xs')}<span class="typing-dots"><i></i><i></i><i></i></span>`;
      bodyEl.appendChild(node);
      state.typingNode = node;
      if (nearBottom()) bodyEl.scrollTop = bodyEl.scrollHeight;
    }
    state.typingTimer = setTimeout(() => {
      state.typingNode?.remove();
      state.typingNode = null;
    }, 3500);
  };

  const sendTyping = () => {
    if (!textarea.value.trim()) return;
    const now = Date.now();
    if (now - state.lastTypingAt < 1800) return;
    state.lastTypingAt = now;
    api(`${path}/typing`, { method: 'POST' }).catch(() => {});
  };

  const openMessageMenu = async (message) => {
    if (!message || message.deleted) return;
    const items = [
      { label: 'Yanıtla', icon: 'comment', value: 'reply' },
      { label: 'Tepki ver', icon: 'heart', value: 'react' },
    ];
    if (message.body) items.push({ label: 'Metni kopyala', icon: 'copy', value: 'copy' });
    if (message.mine && message.body) items.push({ label: 'Düzenle', icon: 'edit', value: 'edit' });
    if (message.mine) items.push({ label: 'Sil', icon: 'trash', value: 'delete', danger: true });
    const choice = await choiceSheet({
      title: 'Mesaj',
      sub: messageSummary(message).slice(0, 48),
      items,
    });
    if (!choice) return;

    if (choice === 'reply') {
      startReply(message);
      return;
    }
    if (choice === 'copy') {
      copyText(message.body, 'Mesaj kopyalandı');
      return;
    }
    if (choice === 'react') {
      const emoji = await choiceSheet({
        title: 'Tepki seç',
        sub: 'Tekrar dokunursan tepki kaldırılır',
        items: CHAT_EMOJIS.map((value) => ({ label: value, value })),
      });
      if (!emoji) return;
      await reactToMessage(message, emoji);
      return;
    }
    if (choice === 'edit') {
      const body = await promptDialog({
        title: 'Mesajı düzenle',
        label: 'Mesaj',
        value: message.body,
        message: 'Düzenlenen mesajlar “düzenlendi” olarak işaretlenir.',
        maxlength: 2000,
      });
      if (body === null || !body.trim() || body.trim() === message.body) return;
      try {
        const data = await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'PATCH', body: { body: body.trim() } });
        Object.assign(message, data.message);
        paint();
        toast('Mesaj güncellendi', 'success');
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (choice === 'delete') {
      const ok = await confirmDialog({
        title: 'Mesaj silinsin mi?',
        message: 'Bu mesaj sohbetten kaldırılacak. Karşı taraf da artık göremeyecek.',
        confirmText: 'Sil',
        danger: true,
        iconName: 'trash',
      });
      if (!ok) return;
      try {
        await api(`/api/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' });
        message.deleted = true;
        message.body = '';
        message.media = null;
        message.sticker = null;
        message.reactions = [];
        paint();
        toast('Mesaj silindi', 'success');
      } catch (error) { toast(error.message, 'error'); }
    }
  };

  const uploadAndSend = async (file) => {
    const kind = fileKind(file);
    if (!['image', 'video'].includes(kind)) {
      toast('Sadece görsel veya video gönderebilirsin.', 'error');
      return;
    }
    if (state.uploading) return;
    state.uploading = true;
    updateSendState();
    const progress = progressOverlay('Medya gönderiliyor');
    try {
      progress.step(0, 'Hazırlanıyor…');
      let blob = file;
      let width = 0;
      let height = 0;
      let duration = 0;
      let posterBlob = null;
      if (kind === 'image') {
        const processed = await processImage(file, { ratio: 'original', max: 2048, quality: 0.9 });
        blob = processed.blob;
        width = processed.width;
        height = processed.height;
      } else {
        const info = await readVideo(file);
        width = info.width;
        height = info.height;
        duration = info.duration;
        posterBlob = await dataURLtoBlob(info.poster);
      }
      progress.step(1, 'Yükleniyor…');
      const media = await uploadMedia(blob, {
        kind,
        width,
        height,
        duration,
        name: file.name || 'medya',
        onProgress: (value, name) => progress.progress(value * 0.9, `${name} yükleniyor…`),
      });
      if (kind === 'video' && posterBlob) {
        progress.progress(0.94, 'Kapak hazırlanıyor…');
        await uploadPoster(media.id, posterBlob).catch(() => {});
      }
      progress.step(2, 'Gönderiliyor…');
      const text = textarea.value.trim();
      const sent = await sendMessage({ body: text, mediaId: media.id });
      if (sent) {
        textarea.value = '';
        autoGrow();
      }
      progress.done();
    } catch (error) {
      progress.fail(error.message);
    } finally {
      state.uploading = false;
      updateSendState();
    }
  };

  const showRecording = (show) => {
    recordingBar.classList.toggle('hidden', !show);
    micButton.classList.toggle('recording', show);
  };

  const stopRecording = ({ cancel = false } = {}) => {
    if (!state.recorder) return;
    state.recCancel = cancel;
    try { state.recorder.stop(); } catch { /* ignore */ }
  };

  const finishRecording = async () => {
    clearInterval(state.recTimer);
    state.recTimer = 0;
    const recorder = state.recorder;
    const chunks = state.recChunks;
    const stream = state.recStream;
    const duration = Math.min(60, (Date.now() - state.recStarted) / 1000);
    const cancel = state.recCancel;
    state.recorder = null;
    state.recStream = null;
    state.recChunks = [];
    state.recStarted = 0;
    state.recCancel = false;
    showRecording(false);
    stream?.getTracks().forEach((track) => track.stop());
    if (cancel || !chunks.length) return;
    const type = recorder?.mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type });
    if (blob.size < 400) {
      toast('Kayıt çok kısa oldu.', 'error');
      return;
    }
    const progress = progressOverlay('Ses gönderiliyor');
    try {
      progress.step(1, 'Yükleniyor…');
      const media = await uploadMedia(blob, {
        kind: 'audio',
        duration,
        name: 'ses-kaydi',
        onProgress: (value) => progress.progress(value * 0.9, 'Ses yükleniyor…'),
      });
      progress.step(2, 'Gönderiliyor…');
      await sendMessage({ body: '', mediaId: media.id });
      progress.done();
    } catch (error) {
      progress.fail(error.message);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Tarayıcın ses kaydını desteklemiyor.', 'error');
      return;
    }
    if (state.recorder) {
      stopRecording({ cancel: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      state.recorder = recorder;
      state.recStream = stream;
      state.recChunks = [];
      state.recStarted = Date.now();
      state.recCancel = false;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) state.recChunks.push(event.data);
      });
      recorder.addEventListener('stop', () => { finishRecording(); });
      recorder.start();
      showRecording(true);
      recordTime.textContent = '0:00';
      state.recTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - state.recStarted) / 1000);
        recordTime.textContent = durationText(seconds);
        if (seconds >= 60) stopRecording({ cancel: false });
      }, 250);
    } catch (error) {
      toast('Mikrofona erişilemedi. Tarayıcı iznini kontrol et.', 'error');
    }
  };

  const openLightbox = (url) => {
    openOverlay(`<div style="position:fixed;inset:0;display:grid;place-items:center;padding:18px;z-index:1">
      <img src="${esc(url)}" alt="" style="max-width:100%;max-height:92vh;border-radius:14px;object-fit:contain">
      <button class="icon-btn" data-overlay-close style="position:fixed;top:16px;right:16px;color:#fff;background:rgba(0,0,0,.45);width:40px;height:40px" aria-label="Kapat">${icon('close')}</button>
    </div>`);
  };

  /* ------------------------------------------------------------- listeners */

  const onFormSubmit = (event) => {
    event.preventDefault();
    const body = textarea.value.trim();
    if (!body || state.sending) return;
    textarea.value = '';
    autoGrow();
    closeComposerPanels();
    sendMessage({ body });
    markSeen();
  };

  const onTextareaInput = () => {
    autoGrow();
    sendTyping();
  };

  const onTextareaKey = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  };

  const onChatClick = async (event) => {
    if (event.target.closest('[data-chat-media]')) {
      event.preventDefault();
      openLightbox(event.target.closest('[data-chat-media]').dataset.chatMedia);
      return;
    }
    if (event.target.closest('[data-chat-reply-cancel]')) {
      state.replyTo = null;
      renderReply();
      return;
    }

    const reaction = event.target.closest('[data-msg-react]');
    if (reaction) {
      event.preventDefault();
      event.stopPropagation();
      const message = state.messages.find((item) => item.id === reaction.dataset.msgId);
      await reactToMessage(message, reaction.dataset.msgReact);
      return;
    }

    const replyButton = event.target.closest('[data-msg-reply]');
    if (replyButton) {
      event.preventDefault();
      const message = state.messages.find((item) => item.id === replyButton.dataset.msgReply);
      startReply(message);
      return;
    }

    const moreButton = event.target.closest('[data-msg-more]');
    if (moreButton) {
      event.preventDefault();
      const message = state.messages.find((item) => item.id === moreButton.dataset.msgMore);
      openMessageMenu(message);
      return;
    }

    const replyJump = event.target.closest('[data-reply-jump]');
    if (replyJump) {
      event.preventDefault();
      event.stopPropagation();
      jumpToMessage(replyJump.dataset.replyJump);
      return;
    }

    if (event.target.closest('[data-sticker-upload]')) {
      await uploadSticker();
      return;
    }
    if (event.target.closest('[data-sticker-retry]')) {
      loadStickers({ force: true });
      return;
    }
    const stickerRemove = event.target.closest('[data-sticker-remove]');
    if (stickerRemove) {
      await removeSticker(stickerRemove.dataset.stickerRemove);
      return;
    }
    const stickerEmoji = event.target.closest('[data-sticker-emoji]');
    if (stickerEmoji) {
      await sendSticker({ emoji: stickerEmoji.dataset.stickerEmoji });
      return;
    }
    const stickerSend = event.target.closest('[data-sticker-id]');
    if (stickerSend) {
      await sendSticker({ stickerId: stickerSend.dataset.stickerId });
      return;
    }
    if (event.target.closest('[data-chat-sticker]')) {
      toggleStickerPanel();
      return;
    }

    const menuBubble = event.target.closest('[data-msg-menu]');
    if (menuBubble) {
      if (event.target.closest('a, audio, video, button')) return;
      event.preventDefault();
      const message = state.messages.find((item) => item.id === menuBubble.dataset.msgMenu);
      openMessageMenu(message);
      return;
    }

    if (event.target.closest('[data-chat-attach]')) {
      closeComposerPanels();
      const files = await pickFiles({ accept: 'image/*,video/*', multiple: false });
      if (files[0]) uploadAndSend(files[0]);
      return;
    }
    if (event.target.closest('[data-chat-mic]')) {
      startRecording();
      return;
    }
    if (event.target.closest('[data-record-cancel]')) {
      stopRecording({ cancel: true });
      return;
    }
    if (event.target.closest('[data-record-send]')) {
      stopRecording({ cancel: false });
      return;
    }
    if (event.target.closest('[data-chat-emoji]')) {
      const willOpen = emojiPanel.classList.contains('hidden');
      closeComposerPanels(emojiPanel);
      emojiPanel.classList.toggle('hidden', !willOpen);
      if (willOpen) {
        emojiPanel.innerHTML = CHAT_EMOJIS.map((emoji) => `<button type="button" data-emoji-value="${esc(emoji)}">${esc(emoji)}</button>`).join('');
      }
      return;
    }
    const emoji = event.target.closest('[data-emoji-value]');
    if (emoji) {
      const value = emoji.dataset.emojiValue;
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      textarea.value = `${textarea.value.slice(0, start)}${value}${textarea.value.slice(end)}`;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + value.length;
      autoGrow();
      return;
    }
    if (event.target.closest('[data-chat-bottom]')) {
      bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
    }
  };

  const onScroll = () => {
    bottomButton.classList.toggle('hidden', nearBottom());
    if (bodyEl.scrollTop < 70) loadOlder();
  };

  const onRealtime = (event) => {
    const { type, data } = event.detail || {};
    if (type === 'message:new' && data?.message) {
      const message = data.message;
      const sameThread = message.senderId === partner.id || message.recipientId === partner.id;
      if (!sameThread) return;
      const existing = state.messages.findIndex((item) => item.id === message.id);
      if (existing >= 0) state.messages.splice(existing, 1);
      state.messages.push(message);
      sortMessages();
      state.typingNode?.remove();
      state.typingNode = null;
      clearTimeout(state.typingTimer);
      paint({ scrollToBottom: !message.mine && nearBottom() });
      if (!message.mine) markSeen();
      return;
    }
    if (type === 'message:update' && data?.message) {
      const index = state.messages.findIndex((item) => item.id === data.message.id);
      if (index >= 0) state.messages[index] = data.message;
      paint();
      return;
    }
    if (type === 'message:delete' && data?.id) {
      const message = state.messages.find((item) => item.id === data.id);
      if (message) {
        message.deleted = true;
        message.body = '';
        message.media = null;
        message.sticker = null;
        message.reactions = [];
        paint();
      }
      return;
    }
    if (type === 'message:reaction' && data?.messageId) {
      const message = state.messages.find((item) => item.id === data.messageId);
      if (message) {
        message.reactions = data.reactions || [];
        paint();
      }
      return;
    }
    if (type === 'message:seen' && data?.by === partner.id) {
      let changed = false;
      for (const message of state.messages) {
        if (message.mine && !message.seenAt && message.createdAt <= data.at) {
          message.seenAt = data.at;
          changed = true;
        }
      }
      if (changed) paint();
      return;
    }
    if (type === 'typing' && data?.userId === partner.id) {
      showTyping();
      return;
    }
    if (type === 'presence' && Array.isArray(data?.online)) {
      partner.online = data.online.includes(partner.id);
      renderPresence();
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') markSeen();
  };

  form.addEventListener('submit', onFormSubmit);
  textarea.addEventListener('input', onTextareaInput);
  textarea.addEventListener('keydown', onTextareaKey);
  root.addEventListener('click', onChatClick);
  bodyEl.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('ikimiz:event', onRealtime);
  document.addEventListener('visibilitychange', onVisible);

  paint({ scrollToBottom: true });
  autoGrow();
  markSeen();

  return () => {
    clearInterval(state.recTimer);
    clearTimeout(state.typingTimer);
    state.recStream?.getTracks().forEach((track) => track.stop());
    if (state.recorder && state.recorder.state !== 'inactive') {
      try { state.recorder.stop(); } catch { /* ignore */ }
    }
    window.removeEventListener('ikimiz:event', onRealtime);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

Views.messages = (root, { params } = {}) => renderMessages(root, { params });
Views.conversation = Views.messages;

/* ------------------------------------------------------------- bildirimler */

const NOTIF_ICONS = {
  like: 'heart-fill',
  comment: 'comment',
  reply: 'comment',
  mention: 'user',
  comment_like: 'heart-fill',
  follow: 'users',
  message: 'message',
  story_reply: 'comment',
  story_reaction: 'heart-fill',
};

function notifBucket(value) {
  const date = dateObj(value);
  if (!date) return 'Daha önce';
  const now = new Date();
  if (sameDay(date, now)) return 'Bugün';
  if (sameDay(date, new Date(now.getTime() - 86400000))) return 'Dün';
  const days = (now - date) / 86400000;
  if (days < 7) return 'Bu hafta';
  if (days < 31) return 'Bu ay';
  return 'Daha önce';
}

function notificationTarget(notification) {
  if (!notification) return '/';
  if (notification.postId) return `/p/${notification.postId}`;
  if (notification.type === 'message' && notification.actor?.username) {
    return `/mesajlar/${notification.actor.username}`;
  }
  if (notification.type === 'message') return '/mesajlar';
  if (notification.actor?.username) return `/u/${notification.actor.username}`;
  return '/';
}

function notificationItemHTML(notification) {
  const type = notification.type || 'info';
  const actor = notification.actor || { displayName: 'MelCandy', username: '' };
  const text = NOTIFICATION_TEXT[type] || 'bir şey yaptı';
  const target = notificationTarget(notification);
  const snippet = notification.meta?.body || notification.meta?.text || '';
  const thumb = notification.thumb;
  const thumbHTML = thumb
    ? `<span class="notif-thumb">${thumb.kind === 'video' && !thumb.posterUrl
      ? `<video src="${esc(thumb.url)}" muted playsinline preload="metadata"></video>`
      : `<img src="${esc(thumb.posterUrl || thumb.url)}" alt="" loading="lazy">`}</span>`
    : '';
  return `<div class="notif-item ${notification.read ? '' : 'unread'}" data-notif-id="${esc(notification.id)}" ${target ? `data-notif-target="${esc(target)}"` : ''} role="button" tabindex="0" aria-label="${esc(`${actor.displayName} ${text}`)}">
    <span class="notif-avatar">
      ${avatarHTML(actor)}
      <span class="notif-type-dot">${icon(NOTIF_ICONS[type] || 'heart')}</span>
    </span>
    <div class="notif-body">
      <div><b>${esc(actor.displayName)}</b> ${esc(text)}</div>
      ${snippet ? `<div class="notif-snippet">${esc(snippet)}</div>` : ''}
      <span class="muted">${esc(timeAgoText(notification.createdAt))}${notification.read ? '' : ' · yeni'}</span>
    </div>
    ${thumbHTML}
    <button type="button" class="icon-btn" data-notif-delete="${esc(notification.id)}" aria-label="Bildirimi sil" title="Bildirimi sil">${icon('trash')}</button>
  </div>`;
}

async function renderNotifications(root) {
  root.innerHTML = `<div class="view view-wide"><div class="notifications-page">
    <div class="notif-head">
      <div><h1 class="page-title">Bildirimler</h1><p class="page-sub">Beğeniler, yorumlar, takipler ve mesajlar.</p></div>
    </div>
    <div class="notif-list" data-notif-list>${Array.from({ length: 5 }, () => `<div class="notif-item"><span class="skeleton" style="width:44px;height:44px;border-radius:50%"></span><div style="flex:1;display:grid;gap:7px"><span class="skeleton skeleton-line" style="width:60%"></span><span class="skeleton skeleton-line" style="width:34%;height:9px"></span></div></div>`).join('')}</div>
    <div class="load-more" data-notif-end></div>
  </div></div>`;

  const listEl = root.querySelector('[data-notif-list]');
  const endEl = root.querySelector('[data-notif-end]');
  const state = { items: [], cursor: null, loading: false, done: false, autoRead: false };
  const abort = new AbortController();

  const head = root.querySelector('.notif-head');

  const paint = () => {
    if (!state.items.length) {
      listEl.innerHTML = `<div class="empty-state notif-empty">
        <div class="empty-icon">${icon('bell')}</div>
        <h3>Henüz bildirim yok</h3>
        <p>Beğeniler, yorumlar, takipler ve mesajlar burada birikecek. Sessizlik de bir hikâye.</p>
        <a class="btn btn-primary" href="/" data-go="/">${icon('home')} Akışa dön</a>
      </div>`;
      return;
    }
    const groups = new Map();
    for (const item of state.items) {
      const label = notifBucket(item.createdAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(item);
    }
    listEl.innerHTML = [...groups.entries()].map(([label, items]) => `
      <div class="notif-group-label">${esc(label)}</div>
      ${items.map((item) => notificationItemHTML(item)).join('')}
    `).join('');
  };

  const updateHead = () => {
    const unread = state.items.some((item) => !item.read);
    const button = head.querySelector('[data-notif-read-all]');
    if (button) button.classList.toggle('hidden', !unread);
  };

  const load = async ({ reset = false } = {}) => {
    if (state.loading || (state.done && !reset)) return;
    state.loading = true;
    if (reset) {
      state.cursor = null;
      state.done = false;
    }
    endEl.innerHTML = `<span class="spinner" style="color:var(--muted)"></span>`;
    try {
      const query = state.cursor ? `?before=${encodeURIComponent(state.cursor)}` : '';
      const data = await api(`/api/notifications${query}`, { signal: abort.signal });
      const fresh = (data.items || []).filter((item) => !state.items.some((known) => known.id === item.id));
      state.items = reset ? (data.items || []) : [...state.items, ...fresh];
      state.cursor = data.nextCursor || null;
      state.done = !data.nextCursor;
      refreshBadges(data.badges);
      paint();
      updateHead();
      endEl.innerHTML = state.done && state.items.length ? '<p class="feed-end">Hepsi bu kadar.</p>' : '';
      scheduleAutoRead();
    } catch (error) {
      if (error.name === 'AbortError') return;
      endEl.innerHTML = `<div class="empty-state"><p>${esc(error.message)}</p><button class="btn btn-sm btn-outline" data-notif-retry>Yeniden dene</button></div>`;
    } finally {
      state.loading = false;
    }
  };

  const markAllRead = async ({ silent = false } = {}) => {
    if (!state.items.some((item) => !item.read)) return;
    try {
      const data = await api('/api/notifications/read', { method: 'POST', body: { ids: state.items.filter((item) => !item.read).map((item) => item.id) } });
      state.items.forEach((item) => { item.read = true; });
      refreshBadges(data.badges);
      paint();
      updateHead();
      if (!silent) toast('Tümü okundu işaretlendi', 'success');
    } catch (error) {
      if (!silent) toast(error.message, 'error');
    }
  };

  const scheduleAutoRead = () => {
    if (state.autoRead) return;
    if (!state.items.some((item) => !item.read)) return;
    state.autoRead = true;
    setTimeout(() => { if (!abort.signal.aborted) markAllRead({ silent: true }); }, 1600);
  };

  const deleteNotification = async (id) => {
    try {
      const data = await api(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.items = state.items.filter((item) => item.id !== id);
      refreshBadges(data.badges);
      paint();
      updateHead();
      toast('Bildirim silindi', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const openNotification = async (item) => {
    if (!item) return;
    if (!item.read) {
      try {
        const data = await api('/api/notifications/read', { method: 'POST', body: { ids: [item.id] } });
        item.read = true;
        refreshBadges(data.badges);
        paint();
        updateHead();
      } catch { /* yönlendirme yine de çalışsın */ }
    }
    const target = notificationTarget(item);
    if (target) navigate(target);
  };

  const findItem = (id) => state.items.find((item) => item.id === id);

  const onClick = (event) => {
    const del = event.target.closest('[data-notif-delete]');
    if (del) {
      event.preventDefault();
      event.stopPropagation();
      deleteNotification(del.dataset.notifDelete);
      return;
    }
    if (event.target.closest('[data-notif-read-all]')) {
      event.preventDefault();
      markAllRead();
      return;
    }
    if (event.target.closest('[data-notif-retry]')) {
      load({ reset: true });
      return;
    }
    const itemEl = event.target.closest('[data-notif-id]');
    if (itemEl) openNotification(findItem(itemEl.dataset.notifId));
  };

  const onKey = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const itemEl = event.target.closest('[data-notif-id]');
    if (!itemEl || event.target.closest('button')) return;
    event.preventDefault();
    openNotification(findItem(itemEl.dataset.notifId));
  };

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) load();
  }, { rootMargin: '700px' });
  observer.observe(endEl);

  const onRealtime = (event) => {
    const { type, data } = event.detail || {};
    if (type === 'notification' && data?.id) {
      const notification = data.notification || data;
      if (!notification?.id || state.items.some((item) => item.id === notification.id)) return;
      state.items = [notification, ...state.items];
      paint();
      updateHead();
      if (notification.type === 'follow') scheduleAutoRead();
      return;
    }
  };

  head.insertAdjacentHTML('beforeend', `<button class="btn btn-sm btn-outline hidden" data-notif-read-all>${icon('check')} Tümünü okundu işaretle</button>`);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  window.addEventListener('ikimiz:event', onRealtime);

  await load({ reset: true });

  return () => {
    abort.abort();
    observer.disconnect();
    window.removeEventListener('ikimiz:event', onRealtime);
  };
}

Views.notifications = renderNotifications;

/* ------------------------------------------------------------------ ayarlar */

function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Safari\//.test(ua) ? 'Safari'
            : 'Tarayıcı';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : 'Bilinmeyen cihaz';
  return `${browser} · ${os}`;
}

function uptimeText(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days} gün ${hours} sa`;
  if (hours) return `${hours} sa ${minutes} dk`;
  return `${minutes} dk`;
}

async function renderSettings(root) {
  const me = S.me || {};
  const settings = me.settings || {};
  const theme = me.theme || 'system';
  const on = (key) => (typeof settings[key] === 'boolean' ? settings[key] : true);
  const reduce = Boolean(settings.reduceMotion);

  const switchRow = (key, title, sub, iconName, value) => `<div class="settings-row clickable" data-setting-row="${key}">
    ${icon(iconName, 'ico lead')}
    <div class="settings-row-main"><strong>${title}</strong><span>${sub}</span></div>
    <span class="switch ${value ? 'on' : ''}" data-switch="${key}" role="switch" aria-checked="${value ? 'true' : 'false'}" aria-label="${esc(title)}"></span>
  </div>`;

  root.innerHTML = `<div class="view view-wide">
    <div class="settings-page">
      <div class="settings-head">
        <h1 class="page-title">Ayarlar</h1>
        <p class="page-sub">Uygulamanın görünümü, bildirimleri ve gizlilik düğmeleri.</p>
      </div>

      <section class="settings-card">
        <div class="settings-card-head">${icon('user')}<div><h2>Hesap</h2><p>Profilin, görünümün ve kimliğin.</p></div></div>
        <div class="settings-card-body">
          <div class="avatar-edit-row" style="padding-bottom:0;border-bottom:0;margin-bottom:0">
            ${avatarHTML(me, 'avatar-lg', { dot: true })}
            <div class="avatar-edit-info" style="flex:1;min-width:0">
              <strong>${esc(me.displayName || '')}</strong>
              <p>@${esc(me.username || '')}${me.pronouns ? ` · ${esc(me.pronouns)}` : ''}</p>
            </div>
            <a class="btn btn-sm btn-outline" href="/ayarlar/profil" data-go="/ayarlar/profil">${icon('edit')} Düzenle</a>
          </div>
          <div class="field" style="margin-top:16px">
            <label>Görünüm</label>
            <div class="theme-switch" data-theme-switch>
              <button type="button" data-theme-choice="system" class="${theme === 'system' ? 'active' : ''}">${icon('monitor')} Sistem</button>
              <button type="button" data-theme-choice="light" class="${theme === 'light' ? 'active' : ''}">${icon('sun')} Açık</button>
              <button type="button" data-theme-choice="dark" class="${theme === 'dark' ? 'active' : ''}">${icon('moon')} Karanlık</button>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">${icon('bell')}<div><h2>Bildirimler ve ses</h2><p>Rahatsız edilmeden haberdar ol.</p></div></div>
        <div class="settings-card-body" style="padding-bottom:4px"><p class="tiny muted">Ayarlar yalnızca bu hesap için geçerli.</p></div>
        ${switchRow('notifications', 'Uygulama içi bildirimler', 'Yeni beğeni, yorum ve mesajlarda küçük bildirim baloncukları göster.', 'bell', on('notifications'))}
        ${switchRow('storyAutoAdvance', 'Hikâyeler otomatik geçsin', 'Süre dolunca sonraki hikâyeye geç.', 'clock', on('storyAutoAdvance'))}
        ${switchRow('reduceMotion', 'Hareketleri azalt', 'Animasyonları ve geçişleri en aza indir.', 'sparkle', reduce)}
        <div class="settings-row">
          ${icon('bell', 'ico lead')}
          <div class="settings-row-main"><strong>Tarayıcı bildirimleri</strong><span data-permission-text>${Notification?.permission === 'granted' ? 'Açık. Uygulama kapalıyken de haber verebiliriz.' : Notification?.permission === 'denied' ? 'Tarayıcı tarafından engellenmiş. Site ayarlarından izin verebilirsin.' : 'İzin verirsen yeni mesajları kaçırmazsın.'}</span></div>
          <button type="button" class="btn btn-sm btn-outline" data-notif-permission ${Notification?.permission === 'granted' ? 'disabled' : ''}>${Notification?.permission === 'granted' ? 'Açık' : 'İzin iste'}</button>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">${icon('link')}<div><h2>Davet</h2><p>Yeni kişiler için paylaşılabilir bir kayıt bağlantısı oluştur.</p></div></div>
        <div class="settings-card-body" data-invite-panel>
          <div class="chat-loading" style="padding:10px"><span class="spinner"></span></div>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">${icon('shield')}<div><h2>Güvenlik</h2><p>Şifren ve açık oturumların.</p></div></div>
        <div class="settings-row clickable" data-password-open>
          ${icon('key', 'ico lead')}
          <div class="settings-row-main"><strong>Şifreyi değiştir</strong><span>Yeni bir şifre belirle. Diğer oturumlar kapanacak.</span></div>
          ${icon('chevron-right', 'ico chev')}
        </div>
        <div class="settings-card-body" style="padding-top:8px">
          <div class="section-title" style="font-size:12.5px">Açık oturumlar</div>
          <div data-session-list><div class="chat-loading" style="padding:14px"><span class="spinner"></span></div></div>
          <button type="button" class="btn btn-sm btn-outline" data-session-revoke-others>${icon('logout')} Diğer oturumları kapat</button>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">${icon('download')}<div><h2>Veriler</h2><p>Her şey senin. İstediğin an indir.</p></div></div>
        <div class="settings-card-body">
          <div class="stat-grid" data-stat-grid><span class="skeleton skeleton-line" style="width:100%;height:52px"></span></div>
          <div class="settings-row clickable" style="padding-left:0;padding-right:0" data-go="/arsiv">
            ${icon('archive', 'ico lead')}
            <div class="settings-row-main"><strong>Arşiv</strong><span>Akıştan kaldırdığın ama silmediğin anlar.</span></div>
            ${icon('chevron-right', 'ico chev')}
          </div>
          <div class="settings-row clickable" style="padding-left:0;padding-right:0" data-go="/kaydedilenler">
            ${icon('bookmark', 'ico lead')}
            <div class="settings-row-main"><strong>Kaydedilenler</strong><span>Sonra dönmek için sakladıkların.</span></div>
            ${icon('chevron-right', 'ico chev')}
          </div>
          <a class="settings-row clickable" style="padding-left:0;padding-right:0" href="/api/me/export" download>
            ${icon('download', 'ico lead')}
            <div class="settings-row-main"><strong>Verilerimi indir</strong><span>Gönderiler, mesajlar, yorumlar ve medya listesi JSON olarak.</span></div>
            ${icon('chevron-right', 'ico chev')}
          </a>
          <p class="tiny muted">Medya dosyaları sunucudaki <span class="mono">data/media</span> klasöründe durur. Yedek almak için <span class="mono">npm run backup</span> komutunu kullan.</p>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">${icon('alert')}<div><h2>Oturum ve hesap</h2><p>Buradaki işlemler geri alınamaz.</p></div></div>
        <div class="settings-row clickable" data-logout>
          ${icon('logout', 'ico lead')}
          <div class="settings-row-main"><strong>Çıkış yap</strong><span>Bu cihazdaki oturumu kapat.</span></div>
          ${icon('chevron-right', 'ico chev')}
        </div>
        <div class="settings-row clickable danger" data-delete-account>
          ${icon('trash', 'ico lead')}
          <div class="settings-row-main"><strong>Hesabımı sil</strong><span>Hesabın, gönderilerin ve mesajların kalıcı olarak silinir.</span></div>
        </div>
      </section>

      <p class="tiny muted" style="text-align:center;padding:4px 0 24px">
        MelCandy sürüm ${esc(String(window.__IKIMIZ_VERSION__ || '1.0.0'))} · reklamsız, arama motorlarına kapalı
      </p>
    </div>
  </div>`;

  const setSwitch = (key, value) => {
    const node = root.querySelector(`[data-switch="${key}"]`);
    if (!node) return;
    node.classList.toggle('on', Boolean(value));
    node.setAttribute('aria-checked', String(Boolean(value)));
  };

  const saveSettings = async (patch) => {
    const previous = { ...(S.me.settings || {}) };
    S.me.settings = { ...previous, ...patch };
    applySettings(S.me.settings);
    for (const [key, value] of Object.entries(patch)) setSwitch(key, value);
    try {
      const data = await api('/api/me', { method: 'PATCH', body: { settings: patch } });
      S.me = data.user;
      applySettings(S.me.settings || {});
      savePrefs({ reduce: Boolean(S.me.settings?.reduceMotion) });
    } catch (error) {
      S.me.settings = previous;
      applySettings(previous);
      for (const [key] of Object.entries(patch)) setSwitch(key, previous[key]);
      toast(error.message, 'error');
    }
  };

  const chooseTheme = async (choice) => {
    applyTheme(choice);
    S.me.theme = choice;
    savePrefs({ theme: choice });
    root.querySelectorAll('[data-theme-choice]').forEach((node) => node.classList.toggle('active', node.dataset.themeChoice === choice));
    try {
      const data = await api('/api/me', { method: 'PATCH', body: { theme: choice } });
      S.me = data.user;
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  /* --------------------------------------------------------------- davet */

  let invite = null;

  const paintInvite = (info) => {
    const panel = root.querySelector('[data-invite-panel]');
    if (!panel) return;
    if (!info || info.full) {
      panel.innerHTML = `<div class="invite-box">
        <span class="empty-icon" style="width:52px;height:52px;border-radius:16px;margin:0">${icon('check')}</span>
        <strong>Kayıt sınırı doldu</strong>
        <p>Yeni hesap alınamıyor. Mevcut kişiler uygulamayı kullanmaya devam edebilir.</p>
      </div>`;
      return;
    }
    if (info.invite) {
      invite = info.invite;
      panel.innerHTML = `<div class="invite-box">
        <span class="eyebrow">davet bağlantısı</span>
        <div class="invite-code" data-invite-code>${esc(info.invite.code)}</div>
        <p>${info.invite.expiresAt ? `${esc(fmtDateTime(info.invite.expiresAt))} tarihine kadar geçerli.` : 'Tek kullanımlık bağlantı.'} Bu bağlantıyı paylaşarak yeni birinin hesap oluşturmasını sağlayabilirsin.</p>
        <div class="invite-actions">
          <button type="button" class="btn btn-sm btn-primary" data-invite-copy>${icon('copy')} Bağlantıyı kopyala</button>
          <button type="button" class="btn btn-sm btn-outline" data-invite-share>${icon('send')} Paylaş</button>
          <button type="button" class="btn btn-sm btn-ghost" data-invite-new>${icon('refresh')} Yeni bağlantı</button>
        </div>
      </div>`;
      return;
    }
    panel.innerHTML = `<div class="invite-box">
      <span class="empty-icon" style="width:52px;height:52px;border-radius:16px;margin:0">${icon('link')}</span>
      <strong>Yeni kişileri davet et</strong>
      <p>Paylaşılabilir bir kayıt bağlantısı oluştur. Bağlantı 72 saat geçerli olur.</p>
      <button type="button" class="btn btn-primary btn-sm" data-invite-create>${icon('link')} Davet bağlantısı oluştur</button>
    </div>`;
  };

  const loadInvite = async () => {
    try {
      const info = await api('/api/me/invite');
      paintInvite(info);
    } catch (error) {
      const panel = root.querySelector('[data-invite-panel]');
      if (panel) panel.innerHTML = `<p class="tiny muted">${esc(error.message)}</p>`;
    }
  };

  const createInvite = async () => {
    try {
      const info = await api('/api/me/invite', { method: 'POST' });
      if (info.full) {
        paintInvite({ full: true });
        return;
      }
      invite = { code: info.code, expiresAt: info.expiresAt };
      paintInvite({ full: false, invite });
      S.invite = { code: info.code, expiresAt: info.expiresAt };
      toast('Davet bağlantısı hazır', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  /* ------------------------------------------------------------- oturumlar */

  const paintSessions = (sessions) => {
    const box = root.querySelector('[data-session-list]');
    if (!box) return;
    box.innerHTML = sessions.length
      ? sessions.map((session) => `<div class="session-item">
          <span class="session-icon">${icon(/iPhone|iPad|Android/.test(session.userAgent || '') ? 'monitor' : 'monitor')}</span>
          <div class="session-meta">
            <strong>${esc(deviceLabel(session.userAgent))}</strong>
            <span>${esc(session.ip || 'yerel')} · ${session.current ? 'şu an burada' : esc(timeAgoText(session.lastUsedAt || session.createdAt))}</span>
          </div>
          ${session.current ? '<span class="badge badge-ok">bu cihaz</span>' : `<button type="button" class="btn btn-sm btn-ghost" data-session-revoke="${esc(session.id)}">${icon('close')} Kapat</button>`}
        </div>`).join('')
      : '<p class="tiny muted">Açık oturum bulunamadı.</p>';
  };

  const loadSessions = async () => {
    try {
      const data = await api('/api/me/sessions');
      paintSessions(data.sessions || []);
    } catch (error) {
      const box = root.querySelector('[data-session-list]');
      if (box) box.innerHTML = `<p class="tiny muted">${esc(error.message)}</p>`;
    }
  };

  const revokeSession = async (id) => {
    try {
      await api(`/api/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Oturum kapatıldı', 'success');
      await loadSessions();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const revokeOthers = async () => {
    const ok = await confirmDialog({
      title: 'Diğer oturumlar kapatılsın mı?',
      message: 'Bu cihaz dışındaki tüm oturumlar sonlandırılacak.',
      confirmText: 'Kapat',
      iconName: 'logout',
    });
    if (!ok) return;
    try {
      await api('/api/me/sessions', { method: 'DELETE' });
      toast('Diğer oturumlar kapatıldı', 'success');
      await loadSessions();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  /* ---------------------------------------------------------------- şifre */

  const openPasswordSheet = () => {
    openSheet({
      title: 'Şifreyi değiştir',
      sub: 'En az 8 karakter, bir harf ve bir rakam',
      size: 'sheet-sm',
      body: `<form data-password-form style="display:grid;gap:14px">
        <div class="field"><label for="pw-current">Mevcut şifre</label><div class="input-wrap">${icon('lock')}<input id="pw-current" name="current" type="password" autocomplete="current-password" required></div></div>
        <div class="field"><label for="pw-new">Yeni şifre</label><div class="input-wrap">${icon('key')}<input id="pw-new" name="next" type="password" autocomplete="new-password" minlength="8" required></div></div>
        <div class="field"><label for="pw-confirm">Yeni şifre (tekrar)</label><div class="input-wrap">${icon('key')}<input id="pw-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required></div></div>
        <button class="btn btn-primary btn-block" type="submit" data-password-save>${icon('check')} Şifreyi güncelle</button>
        <p class="tiny muted" style="text-align:center">Şifre değişince diğer tüm oturumlar kapanır.</p>
      </form>`,
      onMount: (layer, entry) => {
        const form = layer.querySelector('[data-password-form]');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const values = new FormData(form);
          const current = String(values.get('current') || '');
          const next = String(values.get('next') || '');
          const confirm = String(values.get('confirm') || '');
          if (next !== confirm) { toast('Yeni şifreler birbiriyle uyuşmuyor.', 'error'); return; }
          if (next.length < 8) { toast('Şifre en az 8 karakter olmalı.', 'error'); return; }
          const button = form.querySelector('[data-password-save]');
          button.disabled = true;
          try {
            await api('/api/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
            closeOverlay(entry);
            toast('Şifren güncellendi', 'success');
            loadSessions();
          } catch (error) {
            toast(error.message, 'error');
            button.disabled = false;
          }
        });
      },
    });
  };

  /* ---------------------------------------------------------------- stats */

  const loadStats = async () => {
    const grid = root.querySelector('[data-stat-grid]');
    if (!grid) return;
    try {
      const data = await api('/api/stats');
      grid.innerHTML = [
        ['posts', fmtCount(data.counts?.posts || 0), 'gönderi'],
        ['messages', fmtCount(data.counts?.messages || 0), 'mesaj'],
        ['media', fmtCount(data.storage?.mediaCount || 0), 'medya'],
        ['storage', formatBytes(data.storage?.bytes || 0), 'medya boyutu'],
        ['db', formatBytes(data.storage?.dbBytes || 0), 'veritabanı'],
        ['uptime', uptimeText(data.uptime), 'çalışma süresi'],
      ].map(([, value, label]) => `<div class="stat-box"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
    } catch (error) {
      grid.innerHTML = `<p class="tiny muted">${esc(error.message)}</p>`;
    }
  };

  /* ------------------------------------------------------------- eylemler */

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      toast('Bu tarayıcı bildirimleri desteklemiyor.', 'error');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      const text = root.querySelector('[data-permission-text]');
      if (text) {
        text.textContent = result === 'granted'
          ? 'Açık. Uygulama kapalıyken de haber verebiliriz.'
          : result === 'denied'
            ? 'Tarayıcı tarafından engellenmiş. Site ayarlarından izin verebilirsin.'
            : 'İzin verirsen yeni mesajları kaçırmazsın.';
      }
      const button = root.querySelector('[data-notif-permission]');
      if (button && result === 'granted') {
        button.disabled = true;
        button.textContent = 'Açık';
      }
      if (result === 'granted') toast('Bildirim izni verildi. Teşekkürler!', 'success');
    } catch (error) {
      toast(error.message || 'İzin istenemedi.', 'error');
    }
  };

  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch { /* yine de çık */ }
    if (S.es) {
      try { S.es.close(); } catch { /* ignore */ }
      S.es = null;
    }
    S.me = null;
    S.people = [];
    closeAllOverlays();
    renderAuth({ message: 'Çıkış yaptın. Görüşürüz.' });
  };

  const deleteAccount = async () => {
    const sure = await confirmDialog({
      title: 'Hesabın silinsin mi?',
      message: 'Tüm gönderilerin, hikâyelerin, mesajların ve medyan kalıcı olarak silinecek. Bu işlem geri alınamaz.',
      confirmText: 'Devam et',
      danger: true,
      iconName: 'trash',
    });
    if (!sure) return;
    const password = await promptDialog({
      title: 'Şifreni doğrula',
      label: 'Şifre',
      type: 'password',
      message: 'Silmeyi onaylamak için mevcut şifreni gir.',
      confirmText: 'Hesabı sil',
    });
    if (!password) return;
    try {
      await api('/api/me', { method: 'DELETE', body: { password } });
      if (S.es) {
        try { S.es.close(); } catch { /* ignore */ }
        S.es = null;
      }
      S.me = null;
      S.people = [];
      closeAllOverlays();
      renderAuth({ message: 'Hesabın silindi. Görüşmek üzere.' });
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const onClick = (event) => {
    const themeChoice = event.target.closest('[data-theme-choice]');
    if (themeChoice) {
      chooseTheme(themeChoice.dataset.themeChoice);
      return;
    }
    const settingRow = event.target.closest('[data-setting-row]');
    if (settingRow) {
      const key = settingRow.dataset.settingRow;
      const current = typeof S.me.settings?.[key] === 'boolean'
        ? S.me.settings[key]
        : !['reduceMotion'].includes(key);
      saveSettings({ [key]: !current });
      return;
    }
    if (event.target.closest('[data-password-open]')) { openPasswordSheet(); return; }
    if (event.target.closest('[data-session-revoke-others]')) { revokeOthers(); return; }
    const revoke = event.target.closest('[data-session-revoke]');
    if (revoke) { revokeSession(revoke.dataset.sessionRevoke); return; }
    if (event.target.closest('[data-invite-create]')) { createInvite(); return; }
    if (event.target.closest('[data-invite-new]')) { createInvite(); return; }
    if (event.target.closest('[data-invite-copy]')) {
      if (invite?.code) copyText(invite.code, 'Davet kodu kopyalandı');
      return;
    }
    if (event.target.closest('[data-invite-share]')) {
      if (invite?.code) shareURL(`/?davet=${encodeURIComponent(invite.code)}`, 'MelCandy daveti');
      return;
    }
    if (event.target.closest('[data-notif-permission]')) { requestNotificationPermission(); return; }
    if (event.target.closest('[data-logout]')) { logout(); return; }
    if (event.target.closest('[data-delete-account]')) { deleteAccount(); }
  };

  root.addEventListener('click', onClick);

  loadInvite();
  loadSessions();
  loadStats();
}

Views.settings = renderSettings;

/* ---------------------------------------------------------------- besteci */

const COMPOSER_MODES = {
  post: {
    label: 'Gönderi',
    title: 'Yeni bir an',
    eyebrow: 'gönderi',
    icon: 'image',
    accept: 'image/*,video/*',
    multiple: true,
    max: 10,
    captionMax: 2200,
    placeholder: 'Bu anı anlat… #etiket ekleyebilirsin.',
  },
  story: {
    label: 'Hikâye',
    title: 'Yeni bir hikâye',
    eyebrow: '24 saat',
    icon: 'sparkle',
    accept: 'image/*,video/*',
    multiple: false,
    max: 1,
    captionMax: 300,
    placeholder: 'Hikâyene kısa bir not ekle…',
  },
};

const COMPOSER_RATIOS = [
  { key: 'original', label: 'Orijinal' },
  { key: '1:1', label: '1:1' },
  { key: '4:5', label: '4:5' },
  { key: '3:4', label: '3:4' },
  { key: '16:9', label: '16:9' },
  { key: '9:16', label: '9:16' },
];

const COMPOSER_FILE_LIMITS = { image: 20 * 1024 * 1024, video: 200 * 1024 * 1024 };

let composerSeed = null;

function composerModeFrom(search) {
  const raw = String(search?.get('tur') || search?.get('type') || '').trim().toLocaleLowerCase('tr');
  if (['hikaye', 'hikâye', 'story', 'an'].includes(raw)) return 'story';
  if (['gonderi', 'gönderi', 'post', 'foto', 'fotograf', 'fotoğraf'].includes(raw)) return 'post';
  return '';
}

function composerPath(mode) {
  if (mode === 'story') return '/olustur?tur=hikaye';
  return '/olustur?tur=gonderi';
}

function composerThumbHTML(item) {
  if (!item) return '';
  if (item.kind === 'video') {
    return item.posterUrl
      ? `<img src="${esc(item.posterUrl)}" alt="">`
      : `<video src="${esc(item.url)}" muted playsinline preload="metadata"></video>`;
  }
  return `<img src="${esc(item.url)}" alt="" style="filter:${FILTERS[item.filter]?.css || 'none'}">`;
}

function composerPreviewRatio(mode, item) {
  if (!item) return '4/5';
  if (mode === 'story') return '9/16';
  if (item.kind === 'image' && item.ratio && item.ratio !== 'original') return item.ratio.replace(':', ' / ');
  const raw = item.width && item.height ? item.width / item.height : 4 / 5;
  return String(Math.min(Math.max(raw, 0.8), 1.91));
}

function composerDragOver(event) {
  const zone = event.target.closest?.('[data-drop-target]');
  if (!zone) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  zone.classList.add('dragover');
}

function composerDragLeave(event) {
  const zone = event.target.closest?.('[data-drop-target]');
  if (!zone) return;
  if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
  zone.classList.remove('dragover');
}

function composerDropFiles(event) {
  const zone = event.target.closest?.('[data-drop-target]');
  if (!zone) return null;
  event.preventDefault();
  zone.classList.remove('dragover');
  return [...(event.dataTransfer?.files || [])];
}

async function composerItemFromFile(file, kind, { ratio = 'original', onUrl = () => {} } = {}) {
  if (kind === 'video') {
    const meta = await readVideo(file);
    const posterBlob = meta.poster ? await dataURLtoBlob(meta.poster) : null;
    const url = URL.createObjectURL(file);
    onUrl(url);
    return {
      key: uid('m'),
      file,
      kind: 'video',
      url,
      posterUrl: meta.poster || '',
      posterBlob,
      width: meta.width || 0,
      height: meta.height || 0,
      duration: meta.duration || 0,
      filter: 'none',
      ratio,
    };
  }
  const bitmap = await loadBitmap(file);
  const width = bitmap.width || bitmap.naturalWidth || 0;
  const height = bitmap.height || bitmap.naturalHeight || 0;
  if (typeof bitmap.close === 'function') bitmap.close();
  if (!width || !height) throw new Error('görsel okunamadı');
  const url = URL.createObjectURL(file);
  onUrl(url);
  return {
    key: uid('m'),
    file,
    kind: 'image',
    url,
    posterUrl: '',
    posterBlob: null,
    width,
    height,
    duration: 0,
    filter: 'none',
    ratio,
  };
}

function renderComposerChooser(root) {
  root.innerHTML = `<div class="view view-wide">
    <div class="composer-page" data-drop-target>
      <div class="composer-head">
        <a class="icon-btn" href="/" data-go="/" aria-label="Ana akışa dön">${icon('arrow-left')}</a>
        <div class="composer-head-main" style="flex:1;min-width:0">
          <h1>Ne paylaşmak istiyorsun?</h1>
          <p class="page-sub">Bir fotoğraf, kısa bir video ya da tek bir cümle. Yalnızca uygulamaya kayıtlı kişiler görecek.</p>
        </div>
      </div>

      <div class="dropzone">
        <div class="dropzone-inner">
          <div class="dropzone-icon">${icon('sparkle')}</div>
          <h2>Bir an seç</h2>
          <p>Fotoğrafını ya da videonu buraya sürükle, ya da cihazından seç. Gerisini birlikte hallederiz.</p>
          <button type="button" class="btn btn-primary" data-chooser-pick>${icon('image')} Medya seç</button>
          <div class="dropzone-hint">JPG, PNG, WEBP, MP4, MOV · video en fazla 200 MB</div>
        </div>
      </div>

      <div class="create-tiles">
        <a class="create-tile" href="${composerPath('post')}" data-go="${composerPath('post')}">
          <span class="empty-icon">${icon('image')}</span>
          <span><strong>Gönderi</strong><span>1–10 fotoğraf veya video</span></span>
        </a>
        <a class="create-tile" href="${composerPath('story')}" data-go="${composerPath('story')}">
          <span class="empty-icon">${icon('sparkle')}</span>
          <span><strong>Hikâye</strong><span>24 saat sonra kaybolur</span></span>
        </a>
      </div>
    </div>
  </div>`;

  const pick = async () => {
    const files = await pickFiles({ accept: 'image/*,video/*', multiple: true });
    if (!files.length) return;
    composerSeed = files;
    navigate(composerPath('post'));
  };

  const onClick = (event) => {
    if (event.target.closest('[data-chooser-pick]')) {
      event.preventDefault();
      pick();
      return;
    }
    if (event.target.closest('.dropzone') && !event.target.closest('a, button')) {
      event.preventDefault();
      pick();
    }
  };

  const onDrop = (event) => {
    const files = composerDropFiles(event);
    if (!files || !files.length) return;
    composerSeed = files;
    navigate(composerPath('post'));
  };

  root.addEventListener('click', onClick);
  root.addEventListener('dragover', composerDragOver);
  root.addEventListener('dragleave', composerDragLeave);
  root.addEventListener('drop', onDrop);

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('dragover', composerDragOver);
    root.removeEventListener('dragleave', composerDragLeave);
    root.removeEventListener('drop', onDrop);
  };
}

async function renderComposer(root, { search } = {}) {
  const mode = composerModeFrom(search);
  if (!mode) return renderComposerChooser(root);

  const config = COMPOSER_MODES[mode];
  const ratioDefault = 'original';
  const seed = composerSeed;
  composerSeed = null;

  root.innerHTML = `<div class="view view-wide">
    <div class="composer-page" data-drop-target>
      <div class="composer-head">
        <button type="button" class="icon-btn" data-composer-back aria-label="Geri dön">${icon('arrow-left')}</button>
        <div class="composer-head-main" style="flex:1;min-width:0">
          <h1>${esc(config.title)}</h1>
          <p class="page-sub">${mode === 'story' ? 'Hikâyen 24 saat görünür, sonra arşive taşınır.' : 'En fazla 10 medya. Sırayı ve kırpmayı sen belirle.'}</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm hidden" data-publish>${icon('send')} Paylaş</button>
      </div>
      <div data-composer-stage></div>
    </div>
  </div>`;

  const stageEl = root.querySelector('[data-composer-stage]');
  const state = {
    mode,
    items: [],
    active: 0,
    caption: '',
    location: '',
    music: '',
    altText: '',
    altOpen: false,
    commentsDisabled: false,
    likesHidden: false,
    filterOpen: false,
    publishing: false,
    adding: false,
    dirty: false,
  };
  let alive = true;
  let refs = {};
  const objectUrls = new Set();

  const activeItem = () => state.items[state.active] || null;
  const trackUrl = (url) => { objectUrls.add(url); return url; };

  const updateCounter = () => {
    const counter = root.querySelector('[data-caption-counter]');
    if (!counter) return;
    counter.textContent = `${state.caption.length}/${config.captionMax}`;
  };

  const syncPublish = () => {
    root.querySelectorAll('[data-publish]').forEach((button) => {
      button.classList.toggle('hidden', !state.items.length);
      button.disabled = state.publishing || state.adding || !state.items.length;
    });
    root.querySelectorAll('[data-add-media], [data-pick]').forEach((button) => {
      button.disabled = state.adding || state.publishing;
    });
  };

  const dropzoneHTML = () => `<div class="dropzone">
    <div class="dropzone-inner">
      <div class="dropzone-icon">${icon(config.icon)}</div>
      <h2>${mode === 'story' ? 'Hikâyen için bir kare' : 'Anın için bir kare seç'}</h2>
      <p>${mode === 'story'
          ? 'Bir fotoğraf ya da kısa bir video seç. 24 saat sonra kaybolacak.'
          : 'Fotoğrafını ya da videonu buraya sürükle, ya da cihazından seç. Birden fazla medya ekleyebilirsin.'}</p>
      <button type="button" class="btn btn-primary" data-pick>${icon('plus')} ${mode === 'story' ? 'Fotoğraf veya video seç' : 'Medya seç'}</button>
      <div class="dropzone-hint">JPG, PNG, WEBP, MP4, MOV · sürükle bırak da olur</div>
    </div>
  </div>`;

  const mediaRowsHTML = () => state.items.map((item, index) => `<div class="composer-media-row">
    <span class="composer-media-thumb">${composerThumbHTML(item)}</span>
    <div class="composer-media-meta">
      <strong>${esc(item.file.name || (item.kind === 'video' ? 'Video' : 'Fotoğraf'))}</strong>
      <span>${item.kind === 'video' ? 'video' : 'fotoğraf'}${item.width ? ` · ${item.width}×${item.height}` : ''}${item.kind === 'video' && item.duration ? ` · ${durationText(item.duration)}` : ''} · ${formatBytes(item.file.size)}</span>
    </div>
    ${state.items.length > 1 ? `
      <button type="button" class="icon-btn" data-item-move="-1" data-item-key="${esc(item.key)}" aria-label="Bir öne al" title="Bir öne al" ${index === 0 ? 'disabled' : ''}>${icon('chevron-left', 'ico rot-up')}</button>
      <button type="button" class="icon-btn" data-item-move="1" data-item-key="${esc(item.key)}" aria-label="Bir geriye al" title="Bir geriye al" ${index === state.items.length - 1 ? 'disabled' : ''}>${icon('chevron-right', 'ico rot-down')}</button>` : ''}
    <button type="button" class="icon-btn" data-item-remove="${esc(item.key)}" aria-label="Medyayı kaldır" title="Kaldır">${icon('trash')}</button>
  </div>`).join('');

  const detailsHTML = () => `<div class="composer-details">
    <div class="avatar-edit-row" style="margin-bottom:0;padding-bottom:16px">
      ${avatarHTML(S.me, '', { dot: true })}
      <div class="avatar-edit-info" style="min-width:0;flex:1">
        <strong>${esc(S.me?.displayName || '')}</strong>
        <p>@${esc(S.me?.username || '')} · ${esc(config.label)}</p>
      </div>
      <span class="badge badge-neutral">${esc(config.eyebrow)}</span>
    </div>

    <div class="field">
      <label for="composer-caption">Açıklama <span class="hint" data-caption-counter>0/${config.captionMax}</span></label>
      <textarea id="composer-caption" class="textarea" name="caption" rows="4" maxlength="${config.captionMax}" placeholder="${esc(config.placeholder)}" data-caption>${esc(state.caption)}</textarea>
    </div>

    ${mode === 'story' ? `<div class="composer-note">${icon('clock')}<span>Hikâyen 24 saat boyunca görünür. Süresi dolunca silinmez, arşivine taşınır; istediğin an tekrar bakabilirsin.</span></div>` : `
      <div class="form-row">
        <div class="field">
          <label for="composer-location">Konum</label>
          <div class="input-wrap">${icon('location')}<input id="composer-location" name="location" maxlength="100" placeholder="Nerede?" value="${esc(state.location)}" data-location></div>
        </div>
        <div class="field">
          <label for="composer-music">Müzik</label>
          <div class="input-wrap">${icon('music')}<input id="composer-music" name="music" maxlength="120" placeholder="Şarkı veya sanatçı" value="${esc(state.music)}" data-music></div>
        </div>
      </div>

      <div class="field">
        <label>Alt metin <span class="hint">ekran okuyucular için</span></label>
        <div data-alt-wrap class="${state.altOpen ? '' : 'hidden'}">
          <textarea class="textarea" rows="2" maxlength="1200" placeholder="Fotoğrafta ne var?" data-alt>${esc(state.altText)}</textarea>
        </div>
        <button type="button" class="btn-link" data-alt-toggle>${state.altOpen ? 'Alt metni gizle' : 'Alt metin ekle'}</button>
      </div>

      <div class="composer-toggles">
        <button type="button" class="toggle-pill ${state.commentsDisabled ? 'on' : ''}" data-toggle="commentsDisabled" aria-pressed="${state.commentsDisabled}">${icon('comment')} Yorumları kapat</button>
        <button type="button" class="toggle-pill ${state.likesHidden ? 'on' : ''}" data-toggle="likesHidden" aria-pressed="${state.likesHidden}">${icon('heart')} Beğenileri gizle</button>
      </div>
    `}

    ${state.items.length > 1 ? `<div class="field">
      <label>Medya sırası <span class="hint">${state.items.length} medya</span></label>
      <div class="composer-media-list">${mediaRowsHTML()}</div>
    </div>` : state.items.length === 1 ? `<div class="field">
      <label>Medya <span class="hint">${state.items[0].kind === 'video' ? 'video' : 'fotoğraf'}</span></label>
      <div class="composer-media-list">${mediaRowsHTML()}</div>
    </div>` : ''}

    <button type="button" class="btn btn-primary btn-block" data-publish>${icon('send')} ${mode === 'story' ? 'Hikâyeyi paylaş' : 'Anı paylaş'}</button>
    <p class="tiny muted" style="text-align:center">Yalnızca uygulamaya kayıtlı kişiler görecek. Reklamsız.</p>
  </div>`;

  const renderStage = () => {
    if (!alive) return;
    if (!state.items.length) {
      stageEl.innerHTML = dropzoneHTML();
      refs = {};
      syncPublish();
      return;
    }
    stageEl.innerHTML = `<div class="composer-grid">
      <div class="composer-card">
        <div class="composer-preview" data-preview></div>
        <div class="composer-toolbar" data-toolbar>
          <button type="button" class="btn btn-sm btn-soft" data-add-media>${icon('plus')} Ekle</button>
          <div class="composer-ratios" data-ratio-group style="display:flex;gap:6px;align-items:center"></div>
          <button type="button" class="btn btn-sm btn-ghost" data-filter-toggle>${icon('palette')} Filtre</button>
          <button type="button" class="btn btn-sm btn-ghost" data-cover-pick>${icon('image')} Kapak</button>
        </div>
        <div class="filter-strip hidden" data-filters></div>
        <div class="thumb-strip hidden" data-thumbs></div>
      </div>
      <div class="composer-card">${detailsHTML()}</div>
    </div>`;
    refs = {
      preview: stageEl.querySelector('[data-preview]'),
      toolbar: stageEl.querySelector('[data-toolbar]'),
      ratioGroup: stageEl.querySelector('[data-ratio-group]'),
      filters: stageEl.querySelector('[data-filters]'),
      thumbs: stageEl.querySelector('[data-thumbs]'),
    };
    paintPreview();
    paintThumbs();
    paintFilters();
    paintToolbar();
    paintToggles();
    updateCounter();
    syncPublish();
  };

  const paintPreview = () => {
    if (!refs.preview) return;
    const item = activeItem();
    if (!item) return;
    const fit = state.mode === 'story' ? 'contain' : 'cover';
    const media = item.kind === 'video'
      ? `<video src="${esc(item.url)}" ${item.posterUrl ? `poster="${esc(item.posterUrl)}"` : ''} controls playsinline preload="metadata" style="object-fit:${fit}"></video>`
      : `<img src="${esc(item.url)}" alt="${esc(state.altText)}" style="filter:${FILTERS[item.filter]?.css || 'none'};object-fit:${fit}">`;
    refs.preview.style.aspectRatio = composerPreviewRatio(state.mode, item);
    refs.preview.innerHTML = `<div class="media-frame">${media}</div>
      ${state.items.length > 1 ? `
        <button type="button" class="carousel-btn prev" data-preview-prev aria-label="Önceki medya">${icon('chevron-left')}</button>
        <button type="button" class="carousel-btn next" data-preview-next aria-label="Sonraki medya">${icon('chevron-right')}</button>
        <span class="carousel-count">${state.active + 1}/${state.items.length}</span>` : ''}
      <button type="button" class="icon-btn composer-remove" data-remove-active aria-label="Bu medyayı kaldır" title="Kaldır">${icon('close')}</button>`;
  };

  const paintThumbs = () => {
    if (!refs.thumbs) return;
    const show = state.items.length > 1;
    refs.thumbs.classList.toggle('hidden', !show);
    if (!show) { refs.thumbs.innerHTML = ''; return; }
    refs.thumbs.innerHTML = state.items.map((item, index) => `<div class="mini-thumb ${index === state.active ? 'active' : ''}" role="button" tabindex="0" data-thumb="${esc(item.key)}" aria-label="${index + 1}. medya">
      ${composerThumbHTML(item)}
      <span class="remove" data-thumb-remove="${esc(item.key)}" role="button" aria-label="Kaldır" title="Kaldır">${icon('close')}</span>
    </div>`).join('') + (state.items.length < config.max ? `<button type="button" class="mini-thumb composer-add-thumb" data-add-media aria-label="Medya ekle" title="Medya ekle">${icon('plus')}</button>` : '');
  };

  const paintFilters = () => {
    if (!refs.filters) return;
    const item = activeItem();
    const available = Boolean(item && item.kind === 'image');
    const show = available && state.filterOpen;
    refs.filters.classList.toggle('hidden', !show);
    if (!available) { refs.filters.innerHTML = ''; return; }
    refs.filters.innerHTML = imageFiltersStrip(item.url);
    refs.filters.querySelectorAll('[data-filter]').forEach((button) => {
      button.classList.toggle('active', button.dataset.filter === item.filter);
    });
  };

  const paintToolbar = () => {
    if (!refs.toolbar) return;
    const item = activeItem();
    const add = refs.toolbar.querySelector('[data-add-media]');
    if (add) add.classList.toggle('hidden', state.items.length >= config.max);
    const showRatio = Boolean(item && item.kind === 'image' && state.mode === 'post');
    refs.ratioGroup.classList.toggle('hidden', !showRatio);
    if (showRatio) {
      refs.ratioGroup.innerHTML = COMPOSER_RATIOS.map((ratio) => `<button type="button" class="ratio-chip ${item.ratio === ratio.key ? 'active' : ''}" data-ratio="${ratio.key}">${ratio.label}</button>`).join('');
    } else {
      refs.ratioGroup.innerHTML = '';
    }
    const filterButton = refs.toolbar.querySelector('[data-filter-toggle]');
    if (filterButton) filterButton.classList.toggle('hidden', !item || item.kind !== 'image');
    const coverButton = refs.toolbar.querySelector('[data-cover-pick]');
    if (coverButton) coverButton.classList.toggle('hidden', !item || item.kind !== 'video');
  };

  const paintToggles = () => {
    root.querySelectorAll('[data-toggle]').forEach((button) => {
      const value = Boolean(state[button.dataset.toggle]);
      button.classList.toggle('on', value);
      button.setAttribute('aria-pressed', String(value));
    });
  };

  const paintSelection = () => {
    paintPreview();
    paintFilters();
    paintToolbar();
    paintThumbs();
  };

  const selectItem = (key) => {
    const index = state.items.findIndex((item) => item.key === key);
    if (index < 0 || index === state.active) return;
    state.active = index;
    paintSelection();
  };

  const stepPreview = (delta) => {
    if (state.items.length < 2) return;
    state.active = (state.active + delta + state.items.length) % state.items.length;
    paintSelection();
  };

  const setFilter = (key) => {
    const item = activeItem();
    if (!item || item.kind !== 'image' || !FILTERS[key]) return;
    item.filter = key;
    state.dirty = true;
    paintSelection();
  };

  const setRatio = (key) => {
    const item = activeItem();
    if (!item || item.kind !== 'image') return;
    item.ratio = key;
    state.dirty = true;
    paintPreview();
    paintToolbar();
  };

  const toggleOption = (key) => {
    if (!['commentsDisabled', 'likesHidden'].includes(key)) return;
    state[key] = !state[key];
    state.dirty = true;
    paintToggles();
  };

  const toggleAlt = () => {
    state.altOpen = !state.altOpen;
    const wrap = root.querySelector('[data-alt-wrap]');
    if (wrap) wrap.classList.toggle('hidden', !state.altOpen);
    const button = root.querySelector('[data-alt-toggle]');
    if (button) button.textContent = state.altOpen ? 'Alt metni gizle' : 'Alt metin ekle';
    if (state.altOpen) {
      const field = root.querySelector('[data-alt]');
      field?.focus();
      field?.setSelectionRange?.(state.altText.length, state.altText.length);
    }
  };

  const removeItem = (key) => {
    const index = state.items.findIndex((item) => item.key === key);
    if (index < 0) return;
    const [item] = state.items.splice(index, 1);
    if (item?.url) {
      URL.revokeObjectURL(item.url);
      objectUrls.delete(item.url);
    }
    if (state.active > index) state.active -= 1;
    if (state.active >= state.items.length) state.active = Math.max(0, state.items.length - 1);
    state.dirty = true;
    renderStage();
  };

  const moveItem = (key, delta) => {
    const index = state.items.findIndex((item) => item.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.items.length) return;
    const [item] = state.items.splice(index, 1);
    state.items.splice(target, 0, item);
    state.active = target;
    state.dirty = true;
    renderStage();
  };

  const addFiles = async (files) => {
    if (state.adding || state.publishing || !alive) return;
    let list = [...files].filter((file) => ['image', 'video'].includes(fileKind(file)));
    if (!list.length) {
      toast('Geçerli bir fotoğraf veya video seç.', 'error');
      return;
    }
    if (state.mode === 'story') list = list.slice(0, 1);

    const room = config.max - state.items.length;
    if (room <= 0) {
      toast(`En fazla ${config.max} medya ekleyebilirsin.`, 'error');
      return;
    }
    if (list.length > room) toast(`Yalnızca ${room} medya daha ekleyebilirsin.`, 'info');

    state.adding = true;
    syncPublish();
    const slowTimer = setTimeout(() => { if (alive) toast('Medya hazırlanıyor…', 'info'); }, 900);

    try {
      for (const file of list.slice(0, room)) {
        if (!alive) return;
        const kind = fileKind(file);
        const limit = COMPOSER_FILE_LIMITS[kind] || COMPOSER_FILE_LIMITS.image;
        if (file.size > limit) {
          toast(`${file.name || 'Dosya'} çok büyük. En fazla ${formatBytes(limit)} olabilir.`, 'error');
          continue;
        }
        try {
          const item = await composerItemFromFile(file, kind, { ratio: ratioDefault, onUrl: trackUrl });
          if (!alive) {
            URL.revokeObjectURL(item.url);
            return;
          }
          state.items.push(item);
          state.active = state.items.length - 1;
          state.dirty = true;
        } catch (error) {
          toast(`${file.name || 'Medya'}: ${error.message || 'açılamadı'}`, 'error');
        }
      }
      if (!alive) return;
      if (state.items.length) renderStage();
    } finally {
      clearTimeout(slowTimer);
      state.adding = false;
      if (alive) syncPublish();
    }
  };

  const pick = async () => {
    if (state.adding || state.publishing) return;
    const files = await pickFiles({ accept: config.accept, multiple: config.multiple && state.items.length < config.max });
    if (files.length) addFiles(files);
  };

  const openCoverPicker = () => {
    const item = activeItem();
    if (!item || item.kind !== 'video') return;
    openSheet({
      title: 'Video kapağı',
      sub: 'Kaydırıcıyla bir kare seç. Bu kare akışta ve profilde görünecek.',
      size: 'sheet-sm',
      body: `<div style="border-radius:14px;overflow:hidden;background:#000">
          <video data-cover-video src="${esc(item.url)}" ${item.posterUrl ? `poster="${esc(item.posterUrl)}"` : ''} muted playsinline preload="metadata" style="width:100%;max-height:48vh;object-fit:contain"></video>
        </div>
        <input type="range" data-cover-range min="0" max="100" step="0.5" value="30" aria-label="Kapak karesi" style="width:100%;margin-top:16px;accent-color:var(--brand)">
        <div class="tiny muted" data-cover-time style="text-align:center;margin-top:6px">0:00</div>
        <button type="button" class="btn btn-primary btn-block" data-cover-save style="margin-top:12px">${icon('check')} Bu kareyi kapak yap</button>`,
      onMount: (layer, entry) => {
        const video = layer.querySelector('[data-cover-video]');
        const range = layer.querySelector('[data-cover-range]');
        const time = layer.querySelector('[data-cover-time]');
        const save = layer.querySelector('[data-cover-save]');
        const syncTime = () => {
          time.textContent = `${durationText(video.currentTime)} / ${durationText(video.duration || item.duration)}`;
        };
        const seekToValue = () => {
          const duration = Number(video.duration) || item.duration || 0;
          if (!duration) return;
          const next = (Number(range.value) / 100) * duration;
          try { video.currentTime = Math.min(next, Math.max(0, duration - 0.05)); } catch { /* ignore */ }
          syncTime();
        };
        video.addEventListener('loadedmetadata', () => {
          syncTime();
          seekToValue();
        });
        video.addEventListener('seeked', syncTime);
        video.addEventListener('timeupdate', () => {
          const duration = Number(video.duration) || item.duration || 0;
          if (!duration) return;
          range.value = String(Math.min(100, Math.max(0, (video.currentTime / duration) * 100)));
          syncTime();
        });
        range.addEventListener('input', seekToValue);
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            const width = video.videoWidth || item.width || 720;
            const height = video.videoHeight || item.height || 1280;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(video, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
            item.posterUrl = dataUrl;
            item.posterBlob = await dataURLtoBlob(dataUrl);
            closeOverlay(entry);
            renderStage();
            toast('Kapak güncellendi', 'success');
          } catch (error) {
            toast(error.message || 'Kapak oluşturulamadı.', 'error');
            save.disabled = false;
          }
        });
      },
    });
  };

  const leave = async () => {
    if (!state.dirty) {
      navigate('/');
      return;
    }
    const ok = await confirmDialog({
      title: 'Vazgeçilsin mi?',
      message: 'Seçtiğin medya ve yazdıkların kaybolacak. Bu anı sonra da paylaşabilirsin.',
      confirmText: 'Vazgeç',
      cancelText: 'Devam et',
      danger: true,
      iconName: 'alert',
    });
    if (!ok) return;
    state.dirty = false;
    navigate('/');
  };

  const publish = async () => {
    if (state.publishing || state.adding || !alive) return;
    if (!state.items.length) {
      toast('Önce bir fotoğraf veya video seç.', 'error');
      return;
    }

    state.publishing = true;
    syncPublish();
    const progress = progressOverlay(state.mode === 'story' ? 'Hikâyen paylaşılıyor' : 'Anın paylaşılıyor');
    try {
      const total = state.items.length;
      const mediaIds = [];
      for (let index = 0; index < total; index += 1) {
        if (!alive) return;
        const item = state.items[index];
        progress.step(0, `Medya hazırlanıyor (${index + 1}/${total})`);
        let media = null;
        if (item.kind === 'image') {
          const image = await processImage(item.file, {
            ratio: item.ratio || 'original',
            filter: item.filter || 'none',
            max: state.mode === 'story' ? 1920 : 2048,
            quality: 0.9,
          });
          progress.step(1, `Yükleniyor (${index + 1}/${total})`);
          media = await uploadMedia(image.blob, {
            kind: 'image',
            width: image.width,
            height: image.height,
            name: item.file.name,
            onProgress: (value) => progress.progress(((index + value) / total) * 0.82, `Yükleniyor (${index + 1}/${total})`),
          });
        } else {
          progress.step(1, `Video yükleniyor (${index + 1}/${total})`);
          media = await uploadMedia(item.file, {
            kind: 'video',
            width: item.width,
            height: item.height,
            duration: item.duration,
            name: item.file.name,
            onProgress: (value) => progress.progress(((index + value) / total) * 0.82, `Video yükleniyor (${index + 1}/${total})`),
          });
          const posterBlob = item.posterBlob || (item.posterUrl ? await dataURLtoBlob(item.posterUrl) : null);
          if (posterBlob) {
            try {
              await uploadPoster(media.id, posterBlob);
            } catch { /* kapak zorunlu değil */ }
          }
        }
        mediaIds.push(media.id);
      }

      progress.step(2, 'Paylaşılıyor…');
      const caption = state.caption.trim();
      if (state.mode === 'story') {
        await api('/api/stories', { method: 'POST', body: { mediaId: mediaIds[0], caption } });
        state.dirty = false;
        progress.done();
        toast('Hikâyen paylaşıldı. 24 saat boyunca burada.', 'success');
        navigate('/');
        return;
      }

      const body = {
        kind: 'post',
        mediaIds,
        caption,
        location: state.location.trim(),
        altText: state.altText.trim(),
        music: state.music.trim(),
        commentsDisabled: state.commentsDisabled,
        likesHidden: state.likesHidden,
      };
      const data = await api('/api/posts', { method: 'POST', body });
      state.dirty = false;
      progress.done();
      toast('Anın paylaşıldı.', 'success');
      navigate(`/p/${data.post.id}`);
    } catch (error) {
      progress.fail(error.message);
    } finally {
      state.publishing = false;
      if (alive) syncPublish();
    }
  };

  const onClick = (event) => {
    const target = event.target;
    if (target.closest('[data-composer-back]')) { event.preventDefault(); leave(); return; }
    if (target.closest('[data-publish]')) { event.preventDefault(); publish(); return; }
    if (target.closest('[data-pick]')) { event.preventDefault(); pick(); return; }
    if (target.closest('[data-add-media]')) { event.preventDefault(); pick(); return; }
    const thumbRemove = target.closest('[data-thumb-remove]');
    if (thumbRemove) { event.preventDefault(); removeItem(thumbRemove.dataset.thumbRemove); return; }
    const thumb = target.closest('[data-thumb]');
    if (thumb) { selectItem(thumb.dataset.thumb); return; }
    if (target.closest('[data-preview-prev]')) { stepPreview(-1); return; }
    if (target.closest('[data-preview-next]')) { stepPreview(1); return; }
    if (target.closest('[data-remove-active]')) {
      const item = activeItem();
      if (item) removeItem(item.key);
      return;
    }
    const filter = target.closest('[data-filter]');
    if (filter) { setFilter(filter.dataset.filter); return; }
    if (target.closest('[data-filter-toggle]')) { state.filterOpen = !state.filterOpen; paintFilters(); return; }
    if (target.closest('[data-cover-pick]')) { openCoverPicker(); return; }
    const ratio = target.closest('[data-ratio]');
    if (ratio) { setRatio(ratio.dataset.ratio); return; }
    const toggle = target.closest('[data-toggle]');
    if (toggle) { toggleOption(toggle.dataset.toggle); return; }
    if (target.closest('[data-alt-toggle]')) { toggleAlt(); return; }
    const move = target.closest('[data-item-move]');
    if (move) { moveItem(move.dataset.itemKey, Number(move.dataset.itemMove)); return; }
    const itemRemove = target.closest('[data-item-remove]');
    if (itemRemove) { removeItem(itemRemove.dataset.itemRemove); return; }
    if (target.closest('.dropzone') && !target.closest('button')) { pick(); }
  };

  const onInput = (event) => {
    const target = event.target;
    if (target.matches('[data-caption]')) {
      state.caption = target.value;
      state.dirty = true;
      updateCounter();
      return;
    }
    if (target.matches('[data-location]')) { state.location = target.value; state.dirty = true; return; }
    if (target.matches('[data-music]')) { state.music = target.value; state.dirty = true; return; }
    if (target.matches('[data-alt]')) { state.altText = target.value; state.dirty = true; }
  };

  const onKey = (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const thumb = event.target.closest('[data-thumb]');
    if (!thumb || event.target.closest('[data-thumb-remove]')) return;
    event.preventDefault();
    selectItem(thumb.dataset.thumb);
  };

  const onDrop = (event) => {
    const files = composerDropFiles(event);
    if (!files || !files.length) return;
    addFiles(files);
  };

  const beforeUnload = (event) => {
    if (!state.dirty || state.publishing) return;
    event.preventDefault();
    event.returnValue = '';
  };

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('dragover', composerDragOver);
  root.addEventListener('dragleave', composerDragLeave);
  root.addEventListener('drop', onDrop);
  window.addEventListener('beforeunload', beforeUnload);

  renderStage();
  if (seed?.length) addFiles(seed);

  return () => {
    alive = false;
    for (const url of objectUrls) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    objectUrls.clear();
    window.removeEventListener('beforeunload', beforeUnload);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('dragover', composerDragOver);
    root.removeEventListener('dragleave', composerDragLeave);
    root.removeEventListener('drop', onDrop);
  };
}

Views.composer = renderComposer;

/* __APPEND__ */

start();

