/* Basit uçtan uca duman testi. Sunucu çalışırken: node scripts/smoke.mjs */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const PASSWORD = 'Test1234!';

function cookieFrom(res) {
  const list = res.headers.getSetCookie?.() || [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function call(path, { method = 'GET', body, cookie = '', headers = {}, raw = null } = {}) {
  const opts = {
    method,
    headers: {
      'x-ikimiz-client': '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  if (raw) opts.body = raw;
  const res = await fetch(BASE + path, opts);
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) data = await res.json();
  else data = await res.text();
  if (!res.ok) {
    const error = new Error(`${method} ${path} → ${res.status}: ${data?.error || data}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return { data, cookie: cookieFrom(res), res };
}

let failures = 0;
function ok(condition, label) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}`);
  }
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

async function main() {
  console.log('\nMelCandy API duman testi\n');

  const usernameB = `smoke_${Date.now().toString(36)}`;

  const config = await call('/api/config');
  ok(config.data.authenticated === false, 'başlangıçta oturum yok');
  ok(config.data.setup.canRegister === true, 'kayıtlar açık');
  ok(config.data.setup.inviteRequired === false, 'davet kodu zorunlu değil');

  // İlk hesap (can) varsa giriş yap, yoksa kur.
  let first;
  if (config.data.setup.mode === 'first') {
    first = await call('/api/setup', {
      method: 'POST',
      body: { username: 'can', displayName: 'Can', password: PASSWORD },
    });
    ok(first.data.user.username === 'can', 'ilk hesap kuruldu');
    ok(first.data.pending === false, 'ilk hesap doğrudan onaylı');
  } else {
    first = await call('/api/login', {
      method: 'POST',
      body: { username: 'can', password: PASSWORD },
    });
    console.log('  · can hesabı zaten var, giriş yapıldı');
  }

  const cookieA = first.cookie;
  const bootA = await call('/api/bootstrap', { cookie: cookieA });
  ok(bootA.data.authenticated && bootA.data.me.username === 'can', 'bootstrap çalışıyor');
  ok(!('partner' in bootA.data), 'bootstrap partner varsayımı içermiyor');

  // İkinci hesap: davetsiz, doğrudan onaylı açık kayıt.
  let cookieB = '';
  let secondId = null;
  let second;
  try {
    second = await call('/api/setup', {
      method: 'POST',
      body: { username: usernameB, displayName: 'Smoke Test', password: PASSWORD },
    });
    cookieB = second.cookie;
    secondId = second.data.user.id;
    ok(second.data.pending === false, 'ikinci hesap onay beklemeden açıldı');

    const bootB = await call('/api/bootstrap', { cookie: cookieB });
    ok(bootB.data.authenticated && !bootB.data.pending, 'ikinci hesap oturum açtı');

    const users = await call('/api/users', { cookie: cookieA });
    ok(users.data.users.some((u) => u.id === secondId), 'yeni hesap topluluk listesinde');

    // Takip
    const follow = await call('/api/users/can/follow', { method: 'POST', cookie: cookieB });
    ok(follow.data.following === true, 'takip isteği işlendi');
    const profileForB = await call(`/api/users/${usernameB}`, { cookie: cookieA });
    ok(profileForB.data.user.followsMe === true, 'profilde “seni takip ediyor” durumu var');
    const following = await call(`/api/users/${usernameB}/following`, { cookie: cookieB });
    ok(following.data.users.some((u) => u.username === 'can'), 'takip listesinde can görünüyor');
    const canProfile = await call('/api/users/can', { cookie: cookieA });
    ok(canProfile.data.user.counts.followers >= 1, 'takipçi sayısı güncellendi');

    // Medya
    const upload = await call('/api/media', {
      method: 'POST',
      cookie: cookieB,
      raw: png,
      headers: { 'x-media-kind': 'image', 'content-type': 'image/png', 'x-width': '1', 'x-height': '1' },
    });
    const mediaId = upload.data.media.id;
    ok(upload.data.media.kind === 'image', 'medya yüklendi');

    // Gönderi
    const post = await call('/api/posts', {
      method: 'POST',
      cookie: cookieB,
      body: { caption: 'Duman testi #smoke', mediaIds: [mediaId], location: 'İstanbul' },
    });
    const postId = post.data.post.id;
    ok(post.data.post.media.length === 1, 'gönderi oluşturuldu');

    const feedA = await call('/api/feed', { cookie: cookieA });
    ok(feedA.data.items.some((p) => p.id === postId), 'gönderi diğer kullanıcının akışında görünüyor');

    // Beğeni
    await call(`/api/posts/${postId}/like`, { method: 'POST', cookie: cookieA });
    const detail = await call(`/api/posts/${postId}`, { cookie: cookieB });
    ok(detail.data.post.likeCount === 1, 'beğeni sayıldı');

    // Yorum
    const comment = await call(`/api/posts/${postId}/comments`, {
      method: 'POST',
      cookie: cookieA,
      body: { body: 'Duman testi yorumu' },
    });
    ok(comment.data.commentCount === 1, 'yorum eklendi');

    // Hikâye
    const storyUpload = await call('/api/media', {
      method: 'POST',
      cookie: cookieB,
      raw: png,
      headers: { 'x-media-kind': 'image', 'content-type': 'image/png', 'x-width': '1', 'x-height': '1' },
    });
    const story = await call('/api/stories', {
      method: 'POST',
      cookie: cookieB,
      body: { mediaId: storyUpload.data.media.id, caption: 'Duman testi hikâyesi' },
    });
    ok(Boolean(story.data.story.id), 'hikâye oluşturuldu');
    await call(`/api/stories/${story.data.story.id}/view`, { method: 'POST', cookie: cookieA });
    const storiesA = await call('/api/stories', { cookie: cookieA });
    ok(Array.isArray(storiesA.data.groups), 'hikâye grupları geliyor');

    // Mesajlaşma
    const message = await call(`/api/conversations/can/messages`, {
      method: 'POST',
      cookie: cookieB,
      body: { body: 'Selam, duman testi.' },
    });
    ok(message.data.message.mine === true, 'mesaj gönderildi');
    const messageId = message.data.message.id;
    const conversationsA = await call('/api/conversations', { cookie: cookieA });
    const conversation = conversationsA.data.conversations.find((c) => c.user.id === secondId);
    ok(Boolean(conversation), 'sohbet listesinde yeni kişi var');
    ok(conversation?.unreadCount >= 1, 'okunmamış mesaj sayısı doğru');
    const threadA = await call(`/api/conversations/${usernameB}/messages`, { cookie: cookieA });
    ok(threadA.data.messages.some((m) => m.body === 'Selam, duman testi.'), 'mesaj karşı tarafta görünüyor');
    await call(`/api/conversations/${usernameB}/seen`, { method: 'POST', cookie: cookieA });

    // Sticker kitaplığı
    const stickerUpload = await call('/api/media', {
      method: 'POST',
      cookie: cookieB,
      raw: png,
      headers: { 'x-media-kind': 'image', 'content-type': 'image/png', 'x-width': '1', 'x-height': '1' },
    });
    const sticker = await call('/api/stickers', {
      method: 'POST',
      cookie: cookieB,
      body: { mediaId: stickerUpload.data.media.id, label: 'Duman sticker' },
    });
    const stickerId = sticker.data.sticker.id;
    ok(Boolean(sticker.data.sticker.media?.url), 'özel sticker kitaplığa eklendi');
    const stickerList = await call('/api/stickers', { cookie: cookieB });
    ok(stickerList.data.stickers.some((item) => item.id === stickerId), 'sticker listeleniyor');

    // Sticker gönderimi
    const stickerMessage = await call('/api/conversations/can/messages', {
      method: 'POST',
      cookie: cookieB,
      body: { stickerMediaId: stickerId },
    });
    ok(Boolean(stickerMessage.data.message.sticker?.media?.url), 'özel sticker gönderildi');
    const emojiSticker = await call('/api/conversations/can/messages', {
      method: 'POST',
      cookie: cookieB,
      body: { stickerEmoji: '💖' },
    });
    ok(emojiSticker.data.message.sticker?.emoji === '💖', 'hazır emoji sticker gönderildi');
    const emptyMessage = await call(`/api/conversations/can/messages`, {
      method: 'POST',
      cookie: cookieB,
      body: {},
    }).then(() => false).catch((error) => error.status === 400);
    ok(emptyMessage, 'boş mesaj reddedildi');

    // Yanıt
    const reply = await call(`/api/conversations/${usernameB}/messages`, {
      method: 'POST',
      cookie: cookieA,
      body: { body: 'Duman yanıtı', replyToId: messageId },
    });
    ok(reply.data.message.replyTo?.id === messageId, 'mesaja yanıt gönderildi');
    const replyId = reply.data.message.id;

    // Tepkiler (aynı emoji tekrar gönderilince kaldırılır)
    const react = await call(`/api/messages/${replyId}/react`, {
      method: 'POST',
      cookie: cookieB,
      body: { emoji: '❤️' },
    });
    ok(react.data.reactions.some((item) => item.userId === secondId && item.emoji === '❤️'), 'mesaja tepki eklendi');
    const unreact = await call(`/api/messages/${replyId}/react`, {
      method: 'POST',
      cookie: cookieB,
      body: { emoji: '❤️' },
    });
    ok(!unreact.data.reactions.some((item) => item.userId === secondId), 'aynı tepki kaldırıldı');
    const reactAgain = await call(`/api/messages/${replyId}/react`, {
      method: 'POST',
      cookie: cookieB,
      body: { emoji: '😂' },
    });
    ok(reactAgain.data.reactions.some((item) => item.userId === secondId && item.emoji === '😂'), 'tepki değiştirildi');

    const threadB = await call(`/api/conversations/can/messages`, { cookie: cookieB });
    const replyInThread = threadB.data.messages.find((item) => item.id === replyId);
    ok(replyInThread?.reactions?.some((item) => item.emoji === '😂'), 'tepkiler sohbet geçmişinde görünüyor');
    ok(replyInThread?.replyTo?.body === 'Selam, duman testi.', 'yanıt alıntısı sohbet geçmişinde görünüyor');

    // Bildirim
    const notifications = await call('/api/notifications', { cookie: cookieA });
    ok(notifications.data.items.length > 0, 'bildirim üretildi');
    await call('/api/notifications/read', { method: 'POST', cookie: cookieA, body: {} });

    // Profil
    const profile = await call(`/api/users/${usernameB}`, { cookie: cookieA });
    ok(profile.data.posts.length > 0, 'profil gönderileri geliyor');

    // Temizlik: gönderi, hikâye, sticker ve mesajlar
    await call(`/api/posts/${postId}`, { method: 'DELETE', cookie: cookieB });
    await call(`/api/stories/${story.data.story.id}`, { method: 'DELETE', cookie: cookieB });
    await call(`/api/stickers/${stickerId}`, { method: 'DELETE', cookie: cookieB });
    for (const item of [messageId, stickerMessage.data.message.id, emojiSticker.data.message.id]) {
      await call(`/api/messages/${item}`, { method: 'DELETE', cookie: cookieB }).catch(() => {});
    }
  } finally {
    if (cookieB && secondId) {
      await call('/api/users/can/follow', { method: 'DELETE', cookie: cookieB }).catch(() => {});
      await call('/api/me', { method: 'DELETE', cookie: cookieB, body: { password: PASSWORD } }).catch(() => {});
      const usersAfter = await call('/api/users', { cookie: cookieA }).catch(() => null);
      if (usersAfter) {
        ok(!usersAfter.data.users.some((u) => u.id === secondId), 'test hesabı temizlendi');
      }
    }
  }

  // Güvenlik
  const noAuth = await call('/api/feed').then(() => false).catch((e) => e.status === 401);
  ok(noAuth, 'oturumsuz istek reddedildi');
  const csrf = await fetch(BASE + '/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookieA, 'x-ikimiz-client': '1', origin: 'https://evil.example' },
    body: '{}',
  });
  ok(csrf.status === 403, 'yabancı origin reddedildi');

  for (const removed of ['/api/explore', '/api/search?q=smoke']) {
    const res = await fetch(BASE + removed, {
      headers: { 'x-ikimiz-client': '1', cookie: cookieA },
    });
    ok(res.status === 404, `kaldırılan uç yok: ${removed.split('?')[0]}`);
  }

  await call('/api/logout', { method: 'POST', cookie: cookieA }).catch(() => {});

  console.log(`\n${failures === 0 ? 'Tüm testler geçti.' : `${failures} test başarısız.`}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('\nTest hatası:', error.message);
  if (error.data) console.error(error.data);
  process.exit(1);
});
