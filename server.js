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

/* ============ النماذج (MongoDB) ============ */
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

/* ============ مخزن الذاكرة الاحتياطي ============ */
const mem = { users: [], messages: [], pms: [], reports: [], seq: 1 };
function memId() { return 'mem' + (mem.seq++); }

/* ============ قاعدة البيانات ============ */
function dbOk() { return mongoose.connection.readyState === 1; }
(async function connectDB() {
  if (!process.env.MONGO_URL) { console.warn('[chat-masr] MONGO_URL غير موجود — شغّال بمخزن الذاكرة (البيانات مؤقتة).'); return; }
  try { await mongoose.connect(process.env.MONGO_URL); console.log('[chat-masr] MongoDB متصل ✓'); }
  catch (e) { console.error('[chat-masr] خطأ MongoDB (هكمل بمخزن الذاكرة):', e.message); }
})();

/* ---- دوال موحّدة: DB أو ذاكرة ---- */
function safe(p, fb) { if (dbOk()) { return p().catch(function () { return fb; }); } return Promise.resolve(fb); }

function uByToken(t)    { return safe(function(){ return User.findOne({ authToken: t }); }, mem.users.find(function(u){ return u.authToken === t; }) || null); }
function uByEmail(e)    { return safe(function(){ return User.findOne({ email: e }); }, mem.users.find(function(u){ return u.email === e; }) || null); }
function uByUsername(n) { return safe(function(){ return User.findOne({ username: n }); }, mem.users.find(function(u){ return u.username === n; }) || null); }
function uById(id)      { return safe(function(){ return User.findById(id); }, mem.users.find(function(u){ return String(u._id) === String(id); }) || null); }
function uByAny(email, username) { return safe(function(){ return User.findOne({ $or: [{ email: email }, { username: username }] }); }, mem.users.find(function(u){ return u.email === email || u.username === username; }) || null); }

async function uCreate(o) {
  if (dbOk()) { try { return await User.create(o); } catch (e) { throw e; } }
  o._id = memId(); o.createdAt = o.createdAt || new Date(); o.lastSeen = new Date();
  o.points = o.points || 0; o.role = o.role || 'member';
  mem.users.push(o); return o;
}
async function uSave(u) { if (dbOk() && u && typeof u.save === 'function') { try { await u.save(); } catch (e) {} } return u; }
function uIncPoints(id, n) {
  if (dbOk()) { User.updateOne({ _id: id }, { $inc: { points: n }, $set: { lastSeen: new Date() } }).catch(function () {}); return; }
  const u = mem.users.find(function (x) { return String(x._id) === String(id); }); if (u) { u.points = (u.points || 0) + n; u.lastSeen = new Date(); }
}
function uTouch(id) {
  if (dbOk()) { User.updateOne({ _id: id }, { lastSeen: new Date() }).catch(function () {}); return; }
  const u = mem.users.find(function (x) { return String(x._id) === String(id); }); if (u) u.lastSeen = new Date();
}
function uCount() { return safe(function(){ return User.countDocuments(); }, mem.users.length); }

function normMsg(d) {
  return { kind: d.kind || 'msg', text: d.text, mentions: d.mentions || [], senderName: d.senderName, senderColor: d.senderColor, senderRole: d.senderRole, senderGender: d.senderGender, time: (d.createdAt ? d.createdAt.getTime() : Date.now()) };
}
function mPush(m) {
  if (dbOk()) { Message.create(m).catch(function () {}); return; }
  m._id = memId(); m.createdAt = new Date(); mem.messages.push(m);
  if (mem.messages.length > 600) mem.messages.splice(0, mem.messages.length - 600);
}
function mLoad() {
  return safe(function(){ return Message.find({ room: ROOM }).sort({ createdAt: -1 }).limit(120).then(function(d){ return d.reverse().map(normMsg); }); }, mem.messages.slice(-120).map(normMsg));
}
function mToday() {
  const now = new Date(); const c = new Date(now.getTime() + 2 * 3600000);
  const s = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()) - 2 * 3600000).getTime();
  return safe(function(){ return Message.countDocuments({ createdAt: { $gte: new Date(s) } }); }, mem.messages.filter(function(x){ return (x.createdAt ? x.createdAt.getTime() : 0) >= s; }).length);
}

function pmPush(m) {
  if (dbOk()) { return PM.create(m).catch(function () { return null; }); }
  m._id = memId(); m.createdAt = new Date(); m.read = false; mem.pms.push(m); return Promise.resolve(m);
}
function pmList(me) {
  return safe(function(){ return PM.find({ $or: [{ from: me }, { to: me }] }).sort({ createdAt: -1 }).lean(); },
    mem.pms.filter(function(x){ return x.from === me || x.to === me; }).slice().sort(function(a,b){ return b.createdAt - a.createdAt; }));
}
function pmHistory(me, w) {
  return safe(function(){ return PM.find({ $or: [{ from: me, to: w }, { from: w, to: me }] }).sort({ createdAt: 1 }).limit(300); },
    mem.pms.filter(function(x){ return (x.from === me && x.to === w) || (x.from === w && x.to === me); }).slice().sort(function(a,b){ return a.createdAt - b.createdAt; }));
}
function pmOpen(me, w) {
  if (dbOk()) { PM.updateMany({ from: w, to: me, read: false }, { read: true }).catch(function () {}); return; }
  mem.pms.forEach(function (x) { if (x.from === w && x.to === me) x.read = true; });
}
function rPush(r) {
  if (dbOk()) { Report.create(r).catch(function () {}); return; }
  r._id = memId(); r.createdAt = new Date(); mem.reports.push(r);
}

/* ============ إحصائيات حيّة ============ */
function countOnline() {
  let total = 0, memC = 0;
  io.sockets.sockets.forEach(function (s) { if (s.connected && s.data.user) { total++; if (s.data.user.role === 'member') memC++; } });
  return { total: total, mem: memC, guests: Math.max(0, total - memC) };
}
async function computeStats() {
  const o = countOnline();
  const members = await uCount();
  const today = await mToday();
  return { online: o.total, members: members, guests: o.guests, today: today };
}
setInterval(function () { computeStats().then(function (s) { io.emit('live_stats', s); }).catch(function () {}); }, 4000);

/* ============ API ============ */
app.get('/api/stats', function (req, res) { computeStats().then(function (d) { res.json(d); }).catch(function () { res.json({ online: 0, members: 0, guests: 0, today: 0 }); }); });
app.get('/api/latest', function (req, res) {
  if (dbOk()) {
    User.find({}, { username: 1, color: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(8)
      .then(function (us) { res.json(us.map(function (u) { return { username: u.username, color: u.color, createdAt: u.createdAt }; })); })
      .catch(function () { res.json([]); });
  } else {
    res.json(mem.users.slice(-8).reverse().map(function (u) { return { username: u.username, color: u.color, createdAt: u.createdAt }; }));
  }
});

/* ============ أدوات ============ */
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ''); }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const activeNames = new Map();
const pidSockets = new Map();

function regPid(pid, sid) { if (!pidSockets.has(pid)) pidSockets.set(pid, new Set()); pidSockets.get(pid).add(sid); }
function reserveName(desired, pid, sid) {
  regPid(pid, sid);
  let base = (desired || '').trim().replace(/\s+/g, ' ');
  if (base.length < 2) base = 'ضيف_' + Math.floor(1000 + Math.random() * 9000);
  function tryOne(n) {
    const low = n.toLowerCase(); const cur = activeNames.get(low);
    if (!cur) { activeNames.set(low, { pid: pid, name: n }); return n; }
    if (cur.pid === pid) return n;
    return null;
  }
  let got = tryOne(base);
  if (got) return { name: got, renamed: got.toLowerCase() !== base.toLowerCase() };
  for (let i = 2; i < 300; i++) { got = tryOne(base + i); if (got) return { name: got, renamed: true }; }
  const fb = base + String(sid).slice(0, 4); activeNames.set(fb.toLowerCase(), { pid: pid, name: fb });
  return { name: fb, renamed: true };
}
function releaseSocket(sid) {
  pidSockets.forEach(function (set) { set.delete(sid); });
  pidSockets.forEach(function (set, pid) { if (set.size === 0) pidSockets.delete(pid); });
}
setInterval(function () {
  pidSockets.forEach(function (set, pid) {
    set.forEach(function (sid) { const s = io.sockets.sockets.get(sid); if (!s || !s.connected) set.delete(sid); });
    if (set.size === 0) pidSockets.delete(pid);
  });
  activeNames.forEach(function (info, low) { const set = pidSockets.get(info.pid); if (!set || set.size === 0) activeNames.delete(low); });
}, 20000);

function findOnline(name) {
  let found = null;
  io.sockets.sockets.forEach(function (s) { if (s.connected && s.data.user && s.data.user.name === name) found = s.data.user; });
  return found;
}
function socketsFor(name) {
  const a = [];
  io.sockets.sockets.forEach(function (s) { if (s.connected && s.data.user && s.data.user.name === name) a.push(s); });
  return a;
}
function roomUsers() {
  const s = io.sockets.adapter.rooms.get(ROOM); if (!s) return [];
  const list = [];
  s.forEach(function (sid) {
    const sock = io.sockets.sockets.get(sid);
    if (sock && sock.data.user) {
      const u = sock.data.user; const rk = u.role === 'member' ? rankFromPoints(u.points) : 0;
      list.push({ name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: rk, tier: tierLabel(u.role, rk), online: true });
    }
  });
  return list;
}
function emitUsers() { io.to(ROOM).emit('room_users', roomUsers()); }

function findMentions(text, senderPid) {
  const found = [];
  activeNames.forEach(function (info, low) {
    if (info.pid === senderPid) return;
    if (found.some(function (f) { return f.toLowerCase() === low; })) return;
    const re = new RegExp('^' + escRe(info.name) + '($|[^\\u0600-\\u06FF\\w])');
    if (re.test(text)) found.push(info.name);
  });
  return found;
}

async function loadHistory() {
  const all = await mLoad();
  const names = []; const seen = {};
  all.forEach(function (m) { if (m.kind !== 'join' && m.senderRole === 'member' && !seen[m.senderName]) { seen[m.senderName] = true; names.push(m.senderName); } });
  let map = {};
  if (names.length) {
    if (dbOk()) { try { const us = await User.find({ username: { $in: names } }, { username: 1, points: 1 }); us.forEach(function (u) { map[u.username] = u.points || 0; }); } catch (e) {} }
    else { mem.users.forEach(function (u) { if (names.indexOf(u.username) >= 0) map[u.username] = u.points || 0; }); }
  }
  all.forEach(function (m) {
    if (m.kind !== 'join' && m.senderRole === 'member') { const rk = rankFromPoints(map[m.senderName] || 0); m.senderRank = rk; m.senderTier = tierLabel('member', rk); }
    else { m.senderRank = 0; m.senderTier = ''; }
  });
  return all;
}

/* ============ Socket ============ */
io.on('connection', function (socket) {
  socket.data.user = null; socket.data.pid = null; socket.data.lastMsg = 0; socket.data.currentRoom = null;

  socket.on('auth_check', async function (token) {
    if (typeof token !== 'string') return socket.emit('auth_fail');
    const u = await uByToken(token);
    if (!u) return socket.emit('auth_fail');
    const pid = String(u._id); const res = reserveName(u.username, pid, socket.id); socket.data.pid = pid;
    u.lastSeen = new Date(); uSave(u);
    const rk = rankFromPoints(u.points || 0);
    socket.data.user = { id: pid, name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0 };
    socket.emit('auth_ok', { name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0, rank: rk, tier: tierLabel(u.role, rk) });
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
    try {
      const exists = await uByAny(email, username);
      if (exists) return socket.emit('register_err', { msg: 'البريد أو الاسم مستخدم بالفعل.' });
      const color = colorFor(username);
      const hash = await bcrypt.hash(password, 10);
      const u = await uCreate({ username: username, email: email, passwordHash: hash, age: isNaN(age) ? null : age, gender: gender, color: color, role: 'member', points: 0, authToken: newToken() });
      const pid = String(u._id); reserveName(username, pid, socket.id); socket.data.pid = pid;
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
    const u = await uByEmail(email);
    if (!u) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
    let ok = false; try { ok = await bcrypt.compare(password, u.passwordHash); } catch (e) {}
    if (!ok) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
    u.authToken = newToken(); u.lastSeen = new Date(); await uSave(u);
    const pid = String(u._id); const res = reserveName(u.username, pid, socket.id); socket.data.pid = pid;
    const rk = rankFromPoints(u.points || 0);
    socket.data.user = { id: pid, name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0 };
    socket.emit('login_ok', { token: u.authToken, user: { name: res.name, role: u.role, color: u.color || colorFor(res.name), gender: u.gender || '', points: u.points || 0, rank: rk, tier: tierLabel(u.role, rk) } });
  });

  socket.on('guest_login', function (d) {
    const raw = (d && d.name || '').trim();
    const age = d ? parseInt(d.age, 10) : NaN;
    const gender = d ? (d.gender || '').trim() : '';
    let pid = (d && d.guestId || '').trim(); if (!pid) pid = 'g_' + crypto.randomBytes(8).toString('hex');
    const res = reserveName(raw, pid, socket.id); socket.data.pid = pid; const color = colorFor(res.name);
    socket.data.user = { id: socket.id, name: res.name, role: 'guest', color: color, gender: gender, age: isNaN(age) ? null : age, points: 0 };
    socket.emit('guest_ok', { user: { name: res.name, role: 'guest', color: color, gender: gender, points: 0, rank: 0, tier: 'زائر' }, renamed: res.renamed, guestId: pid });
  });

  function authed() { return !!socket.data.user; }

  socket.on('join_room', async function (payload) {
    if (!authed()) return;
    const isReload = !!(payload && payload.isReload);
    const isRejoin = socket.data.currentRoom === ROOM;
    socket.join(ROOM); socket.data.currentRoom = ROOM;
    const u = socket.data.user;
    if (!isRejoin && !isReload) {
      const rk = u.role === 'member' ? rankFromPoints(u.points) : 0;
      socket.to(ROOM).emit('user_joined', { name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: rk, tier: tierLabel(u.role, rk) });
      mPush({ room: ROOM, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', kind: 'join', text: '', mentions: [] });
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
    const text = msg.trim().slice(0, 1000); if (!text || !socket.data.currentRoom) return;
    const now = Date.now(); if (now - socket.data.lastMsg < 400) return; socket.data.lastMsg = now;
    const u = socket.data.user; let rk = 0, tier = '';
    if (u.role === 'member') { u.points = (u.points || 0) + 10; rk = rankFromPoints(u.points); tier = tierLabel('member', rk); uIncPoints(u.id, 10); }
    else { tier = tierLabel(u.role, 0); }
    const mentions = findMentions(text, socket.data.pid);
    mPush({ room: ROOM, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', kind: 'msg', text: text, mentions: mentions });
    io.to(ROOM).emit('message', { text: text, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', mentions: mentions, time: now, senderRank: rk, senderTier: tier });
  });

  socket.on('typing', function () { if (authed() && socket.data.currentRoom) socket.to(ROOM).emit('typing', { name: socket.data.user.name }); });
  socket.on('stop_typing', function () { if (authed() && socket.data.currentRoom) socket.to(ROOM).emit('stop_typing', { name: socket.data.user.name }); });

  socket.on('profile_get', async function (name) {
    const nm = (name || '').trim(); if (!nm) return socket.emit('profile_data', null);
    const u = await uByUsername(nm);
    if (u) {
      const rk = rankFromPoints(u.points || 0);
      return socket.emit('profile_data', { name: u.username, role: u.role, gender: u.gender || '', age: u.age, bio: u.bio || '', color: u.color || colorFor(nm), points: u.points || 0, rank: rk, tier: tierLabel(u.role, rk), joinedAt: u.createdAt ? u.createdAt.getTime() : null, lastSeen: u.lastSeen ? u.lastSeen.getTime() : null, online: !!findOnline(nm) });
    }
    const on = findOnline(nm);
    if (on) return socket.emit('profile_data', { name: on.name, role: on.role, gender: on.gender || '', age: on.age || null, bio: '', color: on.color, points: 0, rank: 0, tier: tierLabel(on.role, 0), joinedAt: null, lastSeen: null, online: true });
    socket.emit('profile_data', null);
  });

  socket.on('profile_update', async function (d) {
    if (!authed() || socket.data.user.role === 'guest') return socket.emit('profile_update_err', { msg: 'غير متاح للزوار.' });
    const u = await uById(socket.data.user.id); if (!u) return;
    const gender = (d && d.gender || '').trim();
    const bio = (d && d.bio || '').trim().slice(0, 200);
    const age = (d && d.age !== '' && d.age != null) ? parseInt(d.age, 10) : u.age;
    u.gender = gender; u.bio = bio; if (!isNaN(age) && age >= 18) u.age = age;
    await uSave(u); socket.data.user.gender = gender;
    socket.emit('profile_updated', { gender: gender, bio: bio, age: u.age, color: u.color });
    if (socket.data.currentRoom) emitUsers();
  });

  socket.on('pm_send', async function (d) {
    if (!authed()) return;
    const to = (d && d.to || '').trim(); const text = (d && d.text || '').trim().slice(0, 1000);
    if (!to || !text || to === socket.data.user.name) return;
    const doc = await pmPush({ from: socket.data.user.name, to: to, text: text });
    const id = doc ? String(doc._id) : ('t' + Date.now()); const time = doc ? doc.createdAt.getTime() : Date.now();
    const m = { id: id, from: socket.data.user.name, to: to, text: text, time: time, read: false };
    socket.emit('pm_sent', m); socketsFor(to).forEach(function (s) { s.emit('pm_receive', m); });
  });

  socket.on('pm_list', async function () {
    if (!authed()) return socket.emit('pm_list_data', []);
    const me = socket.data.user.name;
    const docs = await pmList(me);
    const map = {};
    docs.forEach(function (x) {
      const other = (x.from === me) ? x.to : x.from;
      if (!map[other]) map[other] = { name: other, lastText: x.text, lastFrom: x.from, lastTime: x.createdAt.getTime(), unread: 0 };
      if (x.to === me && !x.read) map[other].unread++;
    });
    const names = Object.keys(map);
    let um = {};
    if (names.length) {
      if (dbOk()) { try { const us = await User.find({ username: { $in: names } }, { username: 1, gender: 1, color: 1 }).lean(); us.forEach(function (u) { um[u.username] = u; }); } catch (e) {} }
      else { mem.users.forEach(function (u) { if (names.indexOf(u.username) >= 0) um[u.username] = u; }); }
    }
    const list = names.map(function (n) {
      const u = um[n]; const on = !!findOnline(n); const role = u ? 'member' : (on ? findOnline(n).role : 'guest');
      return { name: n, color: u ? (u.color || colorFor(n)) : colorFor(n), role: role, gender: u ? (u.gender || '') : '', lastText: map[n].lastText, lastFrom: map[n].lastFrom, lastTime: map[n].lastTime, unread: map[n].unread };
    }).sort(function (a, b) { return b.lastTime - a.lastTime; });
    socket.emit('pm_list_data', list);
  });

  socket.on('pm_history', async function (d) {
    if (!authed()) return socket.emit('pm_history_data', { with: (d && d.with || ''), msgs: [] });
    const w = (d && d.with || '').trim(); const me = socket.data.user.name; if (!w) return;
    const docs = await pmHistory(me, w);
    const msgs = docs.map(function (x) { return { id: String(x._id), from: x.from, to: x.to, text: x.text, time: x.createdAt.getTime(), read: x.read }; });
    socket.emit('pm_history_data', { with: w, msgs: msgs });
  });

  socket.on('pm_open', async function (d) {
    if (!authed()) return;
    const w = (d && d.with || '').trim(); const me = socket.data.user.name; if (!w) return;
    pmOpen(me, w); socketsFor(w).forEach(function (s) { s.emit('pm_read', { by: me }); });
  });

  socket.on('report', function (d) {
    if (!authed()) return;
    const r = (d && d.name || '').trim(); if (!r || r === socket.data.user.name) return;
    rPush({ reporter: socket.data.user.name, reported: r, reason: (d && d.reason || '') }); socket.emit('report_ok');
  });

  socket.on('disconnect', function () {
    const u = socket.data.user;
    if (u) { io.to(ROOM).emit('user_left', { name: u.name, color: u.color, role: u.role, gender: u.gender || '' }); if (u.role === 'member') uTouch(u.id); }
    if (socket.data.currentRoom) emitUsers();
    releaseSocket(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function () { console.log('[chat-masr] شغّال على المنفذ ' + PORT); });
