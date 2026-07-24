require('dotenv').config();
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingTimeout: 15000, pingInterval: 5000 });
app.use(express.json());
app.use(express.static(__dirname));

const ROOM = 'general';

/* ============ الألوان ============ */
const NAME_COLORS = ['#3b82f6','#16a34a','#8b5cf6','#f97316','#e3a857','#ef4444','#06b6d4','#ec4899','#10b981','#f59e0b','#6366f1','#14b8a6'];
function colorFor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

/* ============ الرتب ============ */
function rankFromPoints(p) { return Math.min(99, 1 + Math.floor((p || 0) / 100)); }
function tierLabel(role, rank) {
  if (role === 'admin') return 'مشرف';
  if (rank >= 50) return 'عضو ذهبي';
  if (rank >= 30) return 'عضو فضي';
  if (rank >= 15) return 'عضو برونزي';
  if (rank >= 8)  return 'عضو نشيط';
  if (rank >= 3)  return 'عضو مشارك';
  return 'عضو';
}
function joinText(role, rank) {
  if (role === 'admin') return 'انضم للغرفة (# مشرف #)';
  if (role === 'guest') return 'انضم للغرفة (# زائر #)';
  return 'انضم للغرفة (# ' + tierLabel('member', rank) + ' رتبة ' + rank + ' #)';
}

/* ============ النماذج ============ */
const userSchema = new mongoose.Schema({
  username:    { type: String, required: true, unique: true, index: true, trim: true },
  email:       { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash:{ type: String, required: true },
  age:         { type: Number, default: null },
  gender:      { type: String, default: '' },
  bio:         { type: String, default: '', maxlength: 200 },
  color:       { type: String, default: '' },
  role:        { type: String, default: 'member' },
  points:      { type: Number, default: 0 },
  authToken:   { type: String, index: true },
  lastSeen:    { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  room:        { type: String, index: true, default: ROOM },
  senderId:    { type: String, index: true },
  senderName:  { type: String, default: '' },
  senderColor: { type: String, default: '' },
  senderRole:  { type: String, default: 'guest' },
  senderGender:{ type: String, default: '' },
  kind:        { type: String, default: 'msg' },
  mentions:    { type: [String], default: [] },
  text:        { type: String, maxlength: 2000 },
  createdAt:   { type: Date, default: Date.now }
});
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
const Message = mongoose.model('Message', messageSchema);

const pmSchema = new mongoose.Schema({
  from: { type: String, index: true },
  to:   { type: String, index: true },
  text: { type: String, maxlength: 2000 },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
pmSchema.index({ from: 1, to: 1, createdAt: -1 });
pmSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
const PM = mongoose.model('PM', pmSchema);

const reportSchema = new mongoose.Schema({
  reporter:  { type: String, default: '' },
  reported:  { type: String, index: true },
  reason:    { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
const Report = mongoose.model('Report', reportSchema);

/* ============ قاعدة البيانات ============ */
function dbOk() { return mongoose.connection.readyState === 1; }
(async function connectDB() {
  if (!process.env.MONGO_URL) { console.warn('[chat-masr] MONGO_URL غير موجود — شغّال بدون قاعدة بيانات.'); return; }
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('[chat-masr] MongoDB متصل ✓');
  } catch (e) {
    console.error('[chat-masr] خطأ اتصال MongoDB:', e.message);
  }
})();

function saveMsg(m) { if (dbOk()) Message.create(m).catch(function () {}); }
function savePm(m) { return dbOk() ? PM.create(m).catch(function () { return null; }) : Promise.resolve(null); }
function saveReport(r) { if (dbOk()) Report.create(r).catch(function () {}); }

/* ============ إحصائيات حيّة ============ */
function countOnline() {
  let total = 0, mem = 0;
  for (const entry of io.sockets.sockets) {
    const s = entry[1];
    if (s.connected && s.data.user) { total++; if (s.data.user.role === 'member') mem++; }
  }
  return { total: total, mem: mem, guests: Math.max(0, total - mem) };
}
async function computeStats() {
  const o = countOnline();
  let members = 0, today = 0;
  if (dbOk()) {
    try {
      members = await User.countDocuments();
      const now = new Date();
      const cairo = new Date(now.getTime() + 2 * 3600000);
      const startUtc = new Date(Date.UTC(cairo.getUTCFullYear(), cairo.getUTCMonth(), cairo.getUTCDate()) - 2 * 3600000);
      today = await Message.countDocuments({ createdAt: { $gte: startUtc } });
    } catch (e) {}
  }
  return { online: o.total, members: members, guests: o.guests, today: today };
}
setInterval(function () {
  computeStats().then(function (s) { io.emit('live_stats', s); }).catch(function () {});
}, 4000);

/* ============ API ============ */
app.get('/api/stats', async function (req, res) {
  try { res.json(await computeStats()); } catch (e) { res.json({ online: 0, members: 0, guests: 0, today: 0 }); }
});
app.get('/api/latest', async function (req, res) {
  if (!dbOk()) return res.json([]);
  try {
    const us = await User.find({}, { username: 1, color: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(8);
    res.json(us.map(function (u) { return { username: u.username, color: u.color, createdAt: u.createdAt }; }));
  } catch (e) { res.json([]); }
});

/* ============ أدوات ============ */
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ''); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const activeNames = new Map();
const pidSockets = new Map();

function regPid(pid, sid) {
  if (!pidSockets.has(pid)) pidSockets.set(pid, new Set());
  pidSockets.get(pid).add(sid);
}
function reserveName(desired, pid, sid) {
  regPid(pid, sid);
  let base = (desired || '').trim().replace(/\s+/g, ' ');
  if (base.length < 2) base = 'ضيف_' + Math.floor(1000 + Math.random() * 9000);
  function tryOne(n) {
    const low = n.toLowerCase();
    const cur = activeNames.get(low);
    if (!cur) { activeNames.set(low, { pid: pid, name: n }); return n; }
    if (cur.pid === pid) return n;
    return null;
  }
  let got = tryOne(base);
  if (got) return { name: got, renamed: got.toLowerCase() !== base.toLowerCase() };
  for (let i = 2; i < 300; i++) {
    got = tryOne(base + i);
    if (got) return { name: got, renamed: true };
  }
  const fb = base + String(sid).slice(0, 4);
  activeNames.set(fb.toLowerCase(), { pid: pid, name: fb });
  return { name: fb, renamed: true };
}
function releaseSocket(sid) {
  for (const entry of pidSockets) entry[1].delete(sid);
  for (const entry of pidSockets) if (entry[1].size === 0) pidSockets.delete(entry[0]);
}
setInterval(function () {
  for (const entry of pidSockets) {
    const set = entry[1];
    for (const sid of Array.from(set)) {
      const s = io.sockets.sockets.get(sid);
      if (!s || !s.connected) set.delete(sid);
    }
    if (set.size === 0) pidSockets.delete(entry[0]);
  }
  for (const entry of activeNames) {
    const set = pidSockets.get(entry[1].pid);
    if (!set || set.size === 0) activeNames.delete(entry[0]);
  }
}, 20000);

function findOnline(name) {
  for (const entry of io.sockets.sockets) {
    const s = entry[1];
    if (s.connected && s.data.user && s.data.user.name === name) return s.data.user;
  }
  return null;
}
function socketsFor(name) {
  const a = [];
  for (const entry of io.sockets.sockets) {
    const s = entry[1];
    if (s.connected && s.data.user && s.data.user.name === name) a.push(s);
  }
  return a;
}
function roomUsers() {
  const s = io.sockets.adapter.rooms.get(ROOM);
  if (!s) return [];
  const list = [];
  for (const sid of s) {
    const sock = io.sockets.sockets.get(sid);
    if (sock && sock.data.user) {
      const u = sock.data.user;
      const rk = u.role === 'member' ? rankFromPoints(u.points) : 0;
      list.push({ name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: rk, tier: tierLabel(u.role, rk), online: true });
    }
  }
  return list;
}
function emitUsers() { io.to(ROOM).emit('room_users', roomUsers()); }

function findMentions(text, senderPid) {
  const found = [];
  for (const entry of activeNames) {
    const info = entry[1];
    if (info.pid === senderPid) continue;
    if (found.some(function (f) { return f.toLowerCase() === entry[0]; })) continue;
    const re = new RegExp('^' + escRe(info.name) + '($|[^\\u0600-\\u06FF\\w])');
    if (re.test(text)) found.push(info.name);
  }
  return found;
}

async function loadHistory() {
  if (!dbOk()) return [];
  try {
    const docs = await Message.find({ room: ROOM }).sort({ createdAt: -1 }).limit(120);
    const all = docs.reverse().map(function (d) {
      return {
        kind: d.kind || 'msg', text: d.text, mentions: d.mentions || [],
        senderName: d.senderName, senderColor: d.senderColor,
        senderRole: d.senderRole, senderGender: d.senderGender, time: d.createdAt.getTime()
      };
    });
    const names = [];
    const seen = {};
    all.forEach(function (m) {
      if (m.kind !== 'join' && m.senderRole === 'member' && !seen[m.senderName]) { seen[m.senderName] = true; names.push(m.senderName); }
    });
    const map = {};
    if (names.length) {
      try {
        const us = await User.find({ username: { $in: names } }, { username: 1, points: 1 });
        us.forEach(function (u) { map[u.username] = u.points || 0; });
      } catch (e) {}
    }
    all.forEach(function (m) {
      if (m.kind !== 'join' && m.senderRole === 'member') {
        const rk = rankFromPoints(map[m.senderName] || 0);
        m.senderRank = rk; m.senderTier = tierLabel('member', rk);
      } else {
        m.senderRank = 0; m.senderTier = '';
      }
    });
    return all;
  } catch (e) { return []; }
}

/* ============ Socket ============ */
io.on('connection', function (socket) {
  socket.data.user = null;
  socket.data.pid = null;
  socket.data.lastMsg = 0;
  socket.data.currentRoom = null;

  socket.on('auth_check', async function (token) {
    if (typeof token !== 'string' || !dbOk()) return socket.emit('auth_fail');
    try {
      const u = await User.findOne({ authToken: token });
      if (!u) return socket.emit('auth_fail');
      const pid = String(u._id);
      const res = reserveName(u.username, pid, socket.id);
      socket.data.pid = pid;
      u.lastSeen = new Date(); u.save().catch(function () {});
      const rk = rankFromPoints(u.points || 0);
      socket.data.user = { id: pid, name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0 };
      socket.emit('auth_ok', { name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0, rank: rk, tier: tierLabel(u.role, rk) });
    } catch (e) { socket.emit('auth_fail'); }
  });

  socket.on('register', async function (d) {
    if (!d || typeof d !== 'object') return;
    const username = (d.username || '').trim();
    const email = (d.email || '').trim().toLowerCase();
    const password = d.password || '';
    const age = parseInt(d.age, 10);
    const gender = (d.gender || '').trim();
    if (username.length < 3 || username.length > 20) return socket.emit('register_err', { msg: 'اسم المستخدم 3–20 حرف.' });
    if (!isEmail(email)) return socket.emit('register_err', { msg: 'بريد إلكتروني غير صالح.' });
    if (password.length < 8) return socket.emit('register_err', { msg: 'كلمة المرور 8 أحرف على الأقل.' });
    if (!dbOk()) return socket.emit('register_err', { msg: 'قاعدة البيانات غير متصلة.' });
    try {
      const exists = await User.findOne({ $or: [{ email: email }, { username: username }] });
      if (exists) return socket.emit('register_err', { msg: 'البريد أو الاسم مستخدم بالفعل.' });
      const color = colorFor(username);
      const u = await User.create({ username: username, email: email, passwordHash: await bcrypt.hash(password, 10), age: isNaN(age) ? null : age, gender: gender, color: color, role: 'member', points: 0, authToken: newToken() });
      const pid = String(u._id);
      reserveName(username, pid, socket.id);
      socket.data.pid = pid;
      socket.data.user = { id: pid, name: username, role: 'member', color: color, gender: gender, points: 0 };
      io.emit('new_member', { username: username, color: color, createdAt: u.createdAt });
      socket.emit('register_ok', { token: u.authToken, user: { name: username, role: 'member', color: color, gender: gender, points: 0, rank: 1, tier: 'عضو' } });
    } catch (e) { socket.emit('register_err', { msg: 'حدث خطأ أثناء التسجيل.' }); }
  });

  socket.on('login', async function (d) {
    if (!d || typeof d !== 'object') return;
    const email = (d.email || '').trim().toLowerCase();
    const password = d.password || '';
    if (!isEmail(email) || !password) return socket.emit('login_err', { msg: 'أدخل البريد وكلمة المرور.' });
    if (!dbOk()) return socket.emit('login_err', { msg: 'قاعدة البيانات غير متصلة.' });
    try {
      const u = await User.findOne({ email: email });
      if (!u) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
      const ok = await bcrypt.compare(password, u.passwordHash);
      if (!ok) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
      u.authToken = newToken(); u.lastSeen = new Date(); await u.save();
      const pid = String(u._id);
      const res = reserveName(u.username, pid, socket.id);
      socket.data.pid = pid;
      const rk = rankFromPoints(u.points || 0);
      socket.data.user = { id: pid, name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0 };
      socket.emit('login_ok', { token: u.authToken, user: { name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0, rank: rk, tier: tierLabel(u.role, rk) } });
    } catch (e) { socket.emit('login_err', { msg: 'حدث خطأ أثناء الدخول.' }); }
  });

  socket.on('guest_login', function (d) {
    const raw = (d && d.name || '').trim();
    const age = d ? parseInt(d.age, 10) : NaN;
    const gender = d ? (d.gender || '').trim() : '';
    let pid = (d && d.guestId || '').trim();
    if (!pid) pid = 'g_' + crypto.randomBytes(8).toString('hex');
    const res = reserveName(raw, pid, socket.id);
    socket.data.pid = pid;
    const color = colorFor(res.name);
    socket.data.user = { id: socket.id, name: res.name, role: 'guest', color: color, gender: gender, age: isNaN(age) ? null : age, points: 0 };
    socket.emit('guest_ok', { user: { name: res.name, role: 'guest', color: color, gender: gender, points: 0, rank: 0, tier: 'زائر' }, renamed: res.renamed, guestId: pid });
  });

  function authed() { return !!socket.data.user; }

  socket.on('join_room', async function (payload) {
    if (!authed()) return;
    const isReload = !!(payload && payload.isReload);
    const isRejoin = socket.data.currentRoom === ROOM;
    socket.join(ROOM);
    socket.data.currentRoom = ROOM;
    const u = socket.data.user;
    if (!isRejoin && !isReload) {
      const rk = u.role === 'member' ? rankFromPoints(u.points) : 0;
      socket.to(ROOM).emit('user_joined', { name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: rk, tier: tierLabel(u.role, rk) });
      await saveMsg({ room: ROOM, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', kind: 'join', text: '', mentions: [] });
    }
    const history = await loadHistory();
    socket.emit('joined_room', { room: { id: ROOM, name: 'الغرفة العامة' }, history: history });
    emitUsers();
  });

  socket.on('leave_room', function () {
    if (!authed()) return;
    if (socket.data.currentRoom) { socket.leave(ROOM); socket.data.currentRoom = null; }
    socket.emit('left_room');
  });

  socket.on('request_users', function () { if (authed()) socket.emit('room_users', roomUsers()); });

  socket.on('message', function (msg) {
    if (!authed() || typeof msg !== 'string') return;
    const text = msg.trim().slice(0, 1000);
    if (!text || !socket.data.currentRoom) return;
    const now = Date.now();
    if (now - socket.data.lastMsg < 400) return;
    socket.data.lastMsg = now;
    const u = socket.data.user;
    let rk = 0, tier = '';
    if (u.role === 'member') {
      u.points = (u.points || 0) + 10;
      rk = rankFromPoints(u.points);
      tier = tierLabel('member', rk);
      if (dbOk()) User.updateOne({ _id: u.id }, { $inc: { points: 10 }, $set: { lastSeen: new Date() } }).catch(function () {});
    } else {
      tier = tierLabel(u.role, 0);
    }
    const mentions = findMentions(text, socket.data.pid);
    saveMsg({ room: ROOM, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', kind: 'msg', text: text, mentions: mentions });
    io.to(ROOM).emit('message', { text: text, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', mentions: mentions, time: now, senderRank: rk, senderTier: tier });
  });

  socket.on('typing', function () { if (authed() && socket.data.currentRoom) socket.to(ROOM).emit('typing', { name: socket.data.user.name }); });
  socket.on('stop_typing', function () { if (authed() && socket.data.currentRoom) socket.to(ROOM).emit('stop_typing', { name: socket.data.user.name }); });

  socket.on('profile_get', async function (name) {
    const nm = (name || '').trim();
    if (!nm) return socket.emit('profile_data', null);
    if (dbOk()) {
      const u = await User.findOne({ username: nm }).catch(function () { return null; });
      if (u) {
        const rk = rankFromPoints(u.points || 0);
        return socket.emit('profile_data', { name: u.username, role: u.role, gender: u.gender || '', age: u.age, bio: u.bio || '', color: u.color || colorFor(nm), points: u.points || 0, rank: rk, tier: tierLabel(u.role, rk), joinedAt: u.createdAt ? u.createdAt.getTime() : null, lastSeen: u.lastSeen ? u.lastSeen.getTime() : null, online: !!findOnline(nm) });
      }
    }
    const on = findOnline(nm);
    if (on) return socket.emit('profile_data', { name: on.name, role: on.role, gender: on.gender || '', age: on.age || null, bio: '', color: on.color, points: 0, rank: 0, tier: tierLabel(on.role, 0), joinedAt: null, lastSeen: null, online: true });
    socket.emit('profile_data', null);
  });

  socket.on('profile_update', async function (d) {
    if (!authed() || socket.data.user.role === 'guest' || !dbOk()) return socket.emit('profile_update_err', { msg: 'غير متاح للزوار.' });
    const u = await User.findById(socket.data.user.id).catch(function () { return null; });
    if (!u) return;
    const gender = (d && d.gender || '').trim();
    const bio = (d && d.bio || '').trim().slice(0, 200);
    const age = (d && d.age !== '' && d.age != null) ? parseInt(d.age, 10) : u.age;
    u.gender = gender; u.bio = bio;
    if (!isNaN(age) && age >= 18) u.age = age;
    await u.save().catch(function () {});
    socket.data.user.gender = gender;
    socket.emit('profile_updated', { gender: gender, bio: bio, age: u.age, color: u.color });
    if (socket.data.currentRoom) emitUsers();
  });

  socket.on('pm_send', async function (d) {
    if (!authed()) return;
    const to = (d && d.to || '').trim();
    const text = (d && d.text || '').trim().slice(0, 1000);
    if (!to || !text || to === socket.data.user.name) return;
    const doc = await savePm({ from: socket.data.user.name, to: to, text: text });
    const id = doc ? String(doc._id) : ('t' + Date.now());
    const time = doc ? doc.createdAt.getTime() : Date.now();
    const m = { id: id, from: socket.data.user.name, to: to, text: text, time: time, read: false };
    socket.emit('pm_sent', m);
    socketsFor(to).forEach(function (s) { s.emit('pm_receive', m); });
  });

  socket.on('pm_list', async function () {
    if (!authed() || !dbOk()) return socket.emit('pm_list_data', []);
    const me = socket.data.user.name;
    try {
      const docs = await PM.find({ $or: [{ from: me }, { to: me }] }).sort({ createdAt: -1 }).lean();
      const map = {};
      docs.forEach(function (x) {
        const other = (x.from === me) ? x.to : x.from;
        if (!map[other]) map[other] = { name: other, lastText: x.text, lastFrom: x.from, lastTime: x.createdAt.getTime(), unread: 0 };
        if (x.to === me && !x.read) map[other].unread++;
      });
      const names = Object.keys(map);
      const us = await User.find({ username: { $in: names } }, { username: 1, gender: 1, color: 1 }).lean().catch(function () { return []; });
      const um = {};
      us.forEach(function (u) { um[u.username] = u; });
      const list = names.map(function (n) {
        const u = um[n];
        const on = !!findOnline(n);
        const role = u ? 'member' : (on ? findOnline(n).role : 'guest');
        return {
          name: n,
          color: u ? (u.color || colorFor(n)) : colorFor(n),
          role: role,
          gender: u ? (u.gender || '') : '',
          lastText: map[n].lastText,
          lastFrom: map[n].lastFrom,
          lastTime: map[n].lastTime,
          unread: map[n].unread
        };
      }).sort(function (a, b) { return b.lastTime - a.lastTime; });
      socket.emit('pm_list_data', list);
    } catch (e) { socket.emit('pm_list_data', []); }
  });

  socket.on('pm_history', async function (d) {
    if (!authed() || !dbOk()) return socket.emit('pm_history_data', { with: (d && d.with || ''), msgs: [] });
    const w = (d && d.with || '').trim();
    const me = socket.data.user.name;
    if (!w) return;
    try {
      const docs = await PM.find({ $or: [{ from: me, to: w }, { from: w, to: me }] }).sort({ createdAt: 1 }).limit(300);
      const msgs = docs.map(function (x) { return { id: String(x._id), from: x.from, to: x.to, text: x.text, time: x.createdAt.getTime(), read: x.read }; });
      socket.emit('pm_history_data', { with: w, msgs: msgs });
    } catch (e) { socket.emit('pm_history_data', { with: w, msgs: [] }); }
  });

  socket.on('pm_open', async function (d) {
    if (!authed() || !dbOk()) return;
    const w = (d && d.with || '').trim();
    const me = socket.data.user.name;
    if (!w) return;
    await PM.updateMany({ from: w, to: me, read: false }, { read: true }).catch(function () {});
    socketsFor(w).forEach(function (s) { s.emit('pm_read', { by: me }); });
  });

  socket.on('report', function (d) {
    if (!authed()) return;
    const r = (d && d.name || '').trim();
    if (!r || r === socket.data.user.name) return;
    saveReport({ reporter: socket.data.user.name, reported: r, reason: (d && d.reason || '') });
    socket.emit('report_ok');
  });

  socket.on('disconnect', function () {
    const u = socket.data.user;
    if (u) {
      io.to(ROOM).emit('user_left', { name: u.name, color: u.color, role: u.role, gender: u.gender || '' });
      if (dbOk() && u.role === 'member') User.updateOne({ _id: u.id }, { lastSeen: new Date() }).catch(function () {});
    }
    if (socket.data.currentRoom) emitUsers();
    releaseSocket(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function () { console.log('[chat-masr] شغّال على المنفذ ' + PORT); });
