const clients = new Map(); // userId -> Set<ServerResponse>

function write(res, payload) {
  try {
    res.write(payload);
  } catch {
    /* istemci kopmuş olabilir */
  }
}

export function addClient(userId, res) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  const wasOffline = set.size === 0;
  set.add(res);
  write(res, `event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  if (wasOffline) broadcastPresence();
}

export function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    clients.delete(userId);
    broadcastPresence();
  }
}

export function sendTo(userId, type, data) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) write(res, payload);
}

export function broadcast(type, data, options = {}) {
  for (const [userId, set] of clients) {
    if (options.exceptUserId && userId === options.exceptUserId) continue;
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) write(res, payload);
  }
}

export function onlineUserIds() {
  return [...clients.keys()];
}

export function isOnline(userId) {
  return (clients.get(userId)?.size || 0) > 0;
}

let presenceTimer = null;
function broadcastPresence() {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcast('presence', { online: onlineUserIds() });
  }, 120);
}

// Proxy'lerin bağlantıyı kapatmasını engelle.
const heartbeat = setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) write(res, ': nabız\n\n');
  }
}, 25_000);
heartbeat.unref();
