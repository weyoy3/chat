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
app.use(express.static(__dirname));

const ROOMS = [
  { id: 'general', name: 'الغرفة العامة', emoji: '💬', flag: '🌍', category: 'عامة', theme: { bg: 'linear-gradient(180deg,#f7f4ec,#efe9da)', accent: '#0d9488', accent2: '#14b8a6' } },
  { id: 'egypt', name: 'مصر', emoji: '😍', flag: '🇪🇬', category: 'دول', theme: { bg: 'linear-gradient(180deg,#fbf3e9,#f3e6d6)', accent: '#b91c1c', accent2: '#dc2626' } },
  { id: 'saudi', name: 'السعودية', emoji: '🌴', flag: '🇸🇦', category: 'دول', theme: { bg: 'linear-gradient(180deg,#eef7f0,#e3f0e6)', accent: '#15803d', accent2: '#16a34a' } },
  { id: 'algeria', name: 'الجزائر', emoji: '⭐', flag: '🇩🇿', category: 'دول', theme: { bg: 'linear-gradient(180deg,#f0f4fb,#e6ecf7)', accent: '#1d4ed8', accent2: '#2563eb' } },
  { id: 'morocco', name: 'المغرب', emoji: '🌙', flag: '🇲🇦', category: 'دول', theme: { bg: 'linear-gradient(180deg,#fbf0f0,#f5e3e3)', accent: '#be123c', accent2: '#e11d48' } },
  { id: 'love', name: 'الحب والغرام', emoji: '❤️', flag: '💕', category: 'مواضيع', theme: { bg: 'linear-gradient(180deg,#fdf0f5,#fbe3ec)', accent: '#db2777', accent2: '#ec4899' } },
  { id: 'poetry', name: 'الشعر والأدب', emoji: '📖', flag: '✍️', category: 'مواضيع', theme: { bg: 'linear-gradient(180deg,#f5f0e6,#ece2cf)', accent: '#92400e', accent2: '#b45309' } },
  { id: 'english', name: 'English Room', emoji: '🔤', flag: '🇬🇧', category: 'مواضيع', theme: { bg: 'linear-gradient(180deg,#eef2fb,#e3e9f7)', accent: '#1e40af', accent2: '#3b82f6' } }
];
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true, trim: true },
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  gender: { type: String, default: '' },
  age: { type: Number, default: null },
  country: { type: String, default: '' },
  relationship: { type: String, default: '' },
  nameColor: { type: String, default: '' },
  role: { type: String, default: 'member' },
  points: { type: Number, default: 0 },
  friends: { type: [String], default: [] },
  friendRequests: { type: [{ from: String, at: Date }], default: [] },
  ignored: { type: [String], default: [] },
  authToken: { type: String, index: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  room: { type: String, index: true },
  senderId: { type: String, index: true },
  senderName: { type: String, default: '' },
  senderColor: { type: String, default: '#0d9488' },
  senderRole: { type: String, default: 'guest' },
  senderGender: { type: String, default: '' },
  kind: { type: String, default: 'msg' },
  mentions: { type: [String], default: [] },
  text: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
const Message = mongoose.model('Message', messageSchema);

const pmSchema = new mongoose.Schema({
  from: { type: String, index: true },
  to: { type: String, index: true },
  text: { type: String, maxlength: 2000 },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
pmSchema.index({ from: 1, to: 1, createdAt: -1 });
pmSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
const PM = mongoose.model('PM', pmSchema);

const reportSchema = new mongoose.Schema({
  reporterName: { type: String, default: '' },
  reportedName: { type: String, index: true },
  room: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
const Report = mongoose.model('Report', reportSchema);

function isDbConnected() { return mongoose.connection.readyState === 1; }
async function connectDB() {
  if (!process.env.MONGO_URL) { console.warn('MONGO_URL غير موجود.'); return; }
  try { await mongoose.connect(process.env.MONGO_URL); console.log('MongoDB connected successfully'); }
  catch (e) { console.error('MongoDB connection error:', e.message); }
}
connectDB();

async function saveMessage(m) { if (!isDbConnected()) return; try { await Message.create(m); } catch (e) {} }
async function saveReport(r) { if (!isDbConnected()) return; try { await Report.create(r); } catch (e) {} }

function rankFromPoints(p) { return Math.min(99, 1 + Math.floor((p || 0) / 100)); }
function rankTier(rank) {
  if (rank >= 90) return { label: 'عضو أسطوري', color: '#ff6600' };
  if (rank >= 70) return { label: 'عضو ذهبي', color: '#d4a017' };
  if (rank >= 50) return { label: 'عضو فضي', color: '#9ca3af' };
  if (rank >= 35) return { label: 'عضو برونزي', color: '#cd7f32' };
  if (rank >= 20) return { label: 'عضو مجتهد', color: '#2563eb' };
  if (rank >= 10) return { label: 'عضو نشيط', color: '#16a34a' };
  return { label: 'عضو', color: '#a9760a' };
}
function tierFor(role, points) {
  if (role !== 'member') return { rank: 0, label: '', color: '' };
  const rank = rankFromPoints(points); const t = rankTier(rank);
  return { rank, label: t.label, color: t.color };
}
function colorFromId(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return `hsl(${h}, 62%, 42%)`; }
function userColor(u) { return (u && u.nameColor) || colorFromId(u ? u.username : ''); }

async function loadHistory(roomId) {
  if (!isDbConnected()) return [];
  try {
    const docs = await Message.find({ room: roomId }).sort({ createdAt: -1 }).limit(80);
    const all = docs.reverse().map((d) => ({
      kind: d.kind || 'msg', text: d.text, mentions: d.mentions || [],
      senderName: d.senderName, senderColor: d.senderColor,
      senderRole: d.senderRole, senderGender: d.senderGender, time: d.createdAt.getTime()
    }));
    const out = []; const lastJoin = new Map();
    for (const m of all) {
      if (m.kind === 'join') { const k = (m.senderName || '').toLowerCase(); const lt = lastJoin.get(k); if (lt && (m.time - lt) < 3000) continue; lastJoin.set(k, m.time); }
      out.push(m);
    }
    const memberNames = [...new Set(out.filter((m) => m.kind !== 'join' && m.senderRole === 'member').map((m) => m.senderName))];
    const map = {};
    if (memberNames.length) { try { const us = await User.find({ username: { $in: memberNames } }, { username: 1, points: 1, nameColor: 1 }); us.forEach((u) => { map[u.username] = u; }); } catch (e) {} }
    out.forEach((m) => {
      if (m.kind !== 'join' && m.senderRole === 'member') {
        const u = map[m.senderName]; const pts = u ? (u.points || 0) : 0; const t = tierFor('member', pts);
        m.senderRank = t.rank; m.senderTierLabel = t.label; m.senderTierColor = t.color;
        if (u && u.nameColor) m.senderColor = u.nameColor;
      } else { m.senderRank = 0; m.senderTierLabel = ''; m.senderTierColor = ''; }
    });
    return out;
  } catch (e) { return []; }
}

function generateName() { return 'زائر_' + Math.floor(1000 + Math.random() * 9000); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function roomCount(roomId) { const s = io.sockets.adapter.rooms.get(roomId); return s ? s.size : 0; }
function buildRoomsList() { return ROOMS.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, flag: r.flag, category: r.category, count: roomCount(r.id) })); }
function broadcastRooms() { io.emit('rooms_list', buildRoomsList()); }

function findOnlineSocket(name) { for (const [, s] of io.sockets.sockets) { if (s.connected && s.data.user && s.data.user.name === name) return s; } return null; }
function findOnlineUser(name) { const s = findOnlineSocket(name); return s ? s.data.user : null; }
function socketsForUser(name) { const arr = []; for (const [, s] of io.sockets.sockets) { if (s.connected && s.data.user && s.data.user.name === name) arr.push(s); } return arr; }

function roomUsersList(roomId) {
  const s = io.sockets.adapter.rooms.get(roomId); if (!s) return [];
  const list = [];
  for (const cid of s) {
    const sock = io.sockets.sockets.get(cid);
    if (sock && sock.data.user) { const u = sock.data.user; const t = tierFor(u.role, u.points); list.push({ name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: t.rank, tierLabel: t.label, tierColor: t.color }); }
  }
  return list;
}
function emitRoomUsers(roomId) { io.to(roomId).emit('room_users', roomUsersList(roomId)); }

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');

const activeNames = new Map();
const pidSockets = new Map();
function registerSocketForPid(pid, socketId) { if (!pidSockets.has(pid)) pidSockets.set(pid, new Set()); pidSockets.get(pid).add(socketId); }
function reserveName(desired, pid, socketId) {
  registerSocketForPid(pid, socketId);
  let base = (desired || '').trim().replace(/\s+/g, ' '); if (base.length < 2) base = generateName();
  const tryOne = (n) => { const low = n.toLowerCase(); const cur = activeNames.get(low); if (!cur) { activeNames.set(low, { pid, name: n }); return n; } if (cur.pid === pid) return n; return null; };
  let got = tryOne(base); if (got) return { name: got, renamed: got.toLowerCase() !== base.toLowerCase() };
  for (let i = 2; i < 200; i++) { got = tryOne(base + i); if (got) return { name: got, renamed: true }; }
  const fb = base + String(socketId).slice(0, 4); activeNames.set(fb.toLowerCase(), { pid, name: fb }); return { name: fb, renamed: true };
}
function releaseSocket(socketId) { for (const [pid, set] of pidSockets) { if (set.has(socketId)) set.delete(socketId); } for (const [pid, set] of pidSockets) if (set.size === 0) pidSockets.delete(pid); }
function releaseNameForPid(pid) { for (const [low, info] of activeNames) { if (info.pid === pid) { activeNames.delete(low); break; } } }
setInterval(() => {
  for (const [pid, set] of pidSockets) { for (const sid of [...set]) { const s = io.sockets.sockets.get(sid); if (!s || !s.connected) set.delete(sid); } if (set.size === 0) pidSockets.delete(pid); }
  for (const [low, info] of activeNames) { const set = pidSockets.get(info.pid); if (!set || set.size === 0) activeNames.delete(low); }
}, 20000);

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function findMentions(text, senderPid) {
  const found = [];
  for (const [low, info] of activeNames) { if (info.pid === senderPid) continue; if (found.some((f) => f.toLowerCase() === low)) continue; const re = new RegExp('^' + escapeRegExp(info.name) + '($|[^\\u0600-\\u06FF\\w])'); if (re.test(text)) found.push(info.name); }
  return found;
}

function memberPayload(u) { const c = userColor(u); const t = tierFor('member', u.points || 0); return { name: u.username, role: 'member', color: c, gender: u.gender || '', points: u.points || 0, rank: t.rank, tierLabel: t.label, tierColor: t.color }; }

io.on('connection', (socket) => {
  socket.data.user = null; socket.data.pid = null; socket.data.lastMsg = 0;
  socket.emit('rooms_list', buildRoomsList());

  socket.on('auth_check', async (token) => {
    if (typeof token !== 'string' || !isDbConnected()) return socket.emit('auth_fail');
    try {
      const u = await User.findOne({ authToken: token }); if (!u) return socket.emit('auth_fail');
      const pid = String(u._id); const { name } = reserveName(u.username, pid, socket.id); socket.data.pid = pid;
      socket.data.user = { id: pid, name, role: 'member', color: userColor(u), gender: u.gender || '', points: u.points || 0 };
      socket.emit('auth_ok', memberPayload(u));
    } catch (e) { socket.emit('auth_fail'); }
  });

  socket.on('register', async (d) => {
    if (!d || typeof d !== 'object') return;
    const username = (d.username || '').trim(); const email = (d.email || '').trim().toLowerCase(); const password = d.password || '';
    const gender = (d.gender || '').trim(); const age = parseInt(d.age, 10); const country = (d.country || '').trim();
    if (username.length < 3 || username.length > 20) return socket.emit('register_err', { msg: 'اسم المستخدم لازم 3-20 حرف.' });
    if (!isEmail(email)) return socket.emit('register_err', { msg: 'البريد الإلكتروني غير صحيح.' });
    if (password.length < 6) return socket.emit('register_err', { msg: 'كلمة المرور 6 أحرف على الأقل.' });
    if (!isDbConnected()) return socket.emit('register_err', { msg: 'قاعدة البيانات غير متصلة.' });
    try {
      const exists = await User.findOne({ $or: [{ email }, { username }] }); if (exists) return socket.emit('register_err', { msg: 'البريد أو اسم المستخدم مستخدم بالفعل.' });
      const passwordHash = await bcrypt.hash(password, 10); const authToken = newToken();
      const u = await User.create({ username, email, passwordHash, gender, age: isNaN(age) ? null : age, country, role: 'member', points: 0, authToken });
      const pid = String(u._id); reserveName(username, pid, socket.id); socket.data.pid = pid;
      socket.data.user = { id: pid, name: username, role: 'member', color: userColor(u), gender, points: 0 };
      socket.emit('register_ok', { token: authToken, user: memberPayload(u) });
    } catch (e) { socket.emit('register_err', { msg: 'حدث خطأ أثناء التسجيل.' }); }
  });

  socket.on('login', async (d) => {
    if (!d || typeof d !== 'object') return;
    const email = (d.email || '').trim().toLowerCase(); const password = d.password || '';
    if (!isEmail(email) || !password) return socket.emit('login_err', { msg: 'أدخل البريد وكلمة المرور.' });
    if (!isDbConnected()) return socket.emit('login_err', { msg: 'قاعدة البيانات غير متصلة.' });
    try {
      const u = await User.findOne({ email }); if (!u) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
      const ok = await bcrypt.compare(password, u.passwordHash); if (!ok) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
      u.authToken = newToken(); await u.save();
      const pid = String(u._id); const { name } = reserveName(u.username, pid, socket.id); socket.data.pid = pid;
      socket.data.user = { id: pid, name, role: 'member', color: userColor(u), gender: u.gender || '', points: u.points || 0 };
      socket.emit('login_ok', { token: u.authToken, user: memberPayload(u) });
    } catch (e) { socket.emit('login_err', { msg: 'حدث خطأ أثناء الدخول.' }); }
  });

  socket.on('guest_login', (d) => {
    const raw = (d && d.name || '').trim(); const age = d ? parseInt(d.age, 10) : NaN; const gender = d ? (d.gender || '').trim() : '';
    let pid = (d && d.guestId || '').trim(); if (!pid) pid = 'g_' + crypto.randomBytes(8).toString('hex');
    const { name, renamed } = reserveName(raw, pid, socket.id); socket.data.pid = pid; const color = colorFromId(name);
    socket.data.user = { id: socket.id, name, role: 'guest', color, gender, age: isNaN(age) ? null : age, points: 0 };
    socket.emit('guest_ok', { user: { name, role: 'guest', color, gender, points: 0 }, renamed, guestId: pid });
  });

  function authed() { return !!socket.data.user; }

  socket.on('join_room', async (payload) => {
    const roomId = typeof payload === 'string' ? payload : (payload && payload.id); const isReload = !!(payload && payload.isReload);
    if (!authed() || !ROOM_IDS.has(roomId)) return;
    const isRejoin = socket.data.currentRoom === roomId;
    if (socket.data.currentRoom && !isRejoin) socket.leave(socket.data.currentRoom);
    socket.join(roomId); socket.data.currentRoom = roomId; broadcastRooms();
    const meta = ROOMS.find((r) => r.id === roomId);
    if (!isRejoin && !isReload) {
      const u = socket.data.user; const t = tierFor(u.role, u.points);
      socket.to(roomId).emit('user_joined', { name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: t.rank, tierLabel: t.label, tierColor: t.color });
      await saveMessage({ room: roomId, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', kind: 'join', text: '', mentions: [] });
    }
    const history = await loadHistory(roomId);
    socket.emit('joined_room', { room: { id: meta.id, name: meta.name, emoji: meta.emoji, theme: meta.theme }, history });
    emitRoomUsers(roomId);
  });

  socket.on('leave_room', () => {
    if (!authed()) return;
    const roomId = socket.data.currentRoom;
    if (roomId) { socket.to(roomId).emit('user_left', { name: socket.data.user.name, color: socket.data.user.color, role: socket.data.user.role, gender: socket.data.user.gender || '' }); socket.leave(roomId); socket.data.currentRoom = null; broadcastRooms(); emitRoomUsers(roomId); }
    socket.emit('left_room');
  });

  socket.on('request_users', () => { if (!authed() || !socket.data.currentRoom) return; socket.emit('room_users', roomUsersList(socket.data.currentRoom)); });

  socket.on('message', (msg) => {
    if (!authed() || typeof msg !== 'string') return;
    const text = msg.trim().slice(0, 1000); if (!text || !socket.data.currentRoom) return;
    const now = Date.now(); if (now - socket.data.lastMsg < 400) return; socket.data.lastMsg = now;
    const u = socket.data.user;
    if (u.role === 'member') { u.points = (u.points || 0) + 10; User.updateOne({ _id: u.id }, { $inc: { points: 10 } }).catch(() => {}); }
    const t = tierFor(u.role, u.points); const mentions = findMentions(text, socket.data.pid);
    saveMessage({ room: socket.data.currentRoom, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', kind: 'msg', text, mentions });
    io.to(socket.data.currentRoom).emit('message', { text, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', mentions, time: now, senderRank: t.rank, senderTierLabel: t.label, senderTierColor: t.color });
  });

  socket.on('profile_get', async (name) => {
    const nm = (name || '').trim(); if (!nm) return socket.emit('profile_data', null);
    const u = isDbConnected() ? await User.findOne({ username: nm }).catch(() => null) : null;
    if (u) { const t = tierFor('member', u.points || 0); return socket.emit('profile_data', { name: u.username, role: 'member', gender: u.gender || '', country: u.country || '', relationship: u.relationship || '', points: u.points || 0, rank: t.rank, tierLabel: t.label, tierColor: t.color, nameColor: u.nameColor || '', joinedAt: u.createdAt ? u.createdAt.getTime() : null, online: !!findOnlineUser(nm) }); }
    const on = findOnlineUser(nm);
    if (on) return socket.emit('profile_data', { name: on.name, role: on.role, gender: on.gender || '', country: '', relationship: '', points: 0, rank: 0, tierLabel: '', tierColor: '', nameColor: '', joinedAt: null, online: true });
    socket.emit('profile_data', null);
  });

  // ===== الدفعة ٢: تعديل البروفايل =====
  socket.on('profile_update', async (d) => {
    if (!authed() || socket.data.user.role !== 'member' || !isDbConnected()) return socket.emit('profile_update_err', { msg: 'غير متاح.' });
    const u = await User.findById(socket.data.user.id).catch(() => null); if (!u) return;
    const gender = (d && d.gender || '').trim(); const country = (d && d.country || '').trim();
    const relationship = (d && d.relationship || '').trim(); const age = d && d.age !== '' && d.age != null ? parseInt(d.age, 10) : null;
    let nameColor = (d && d.nameColor || '').trim();
    if (nameColor && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(nameColor)) nameColor = '';
    u.gender = gender; u.country = country; u.relationship = relationship; if (!isNaN(age)) u.age = age; u.nameColor = nameColor;
    await u.save().catch(() => {});
    const newColor = userColor(u); socket.data.user.color = newColor; socket.data.user.gender = gender;
    const payload = memberPayload(u);
    socket.emit('profile_updated', payload);
    // بثّث التحديث لكل الغرف اللي فيها العضو
    for (const [, s] of io.sockets.sockets) { if (s.id === socket.id) continue; if (s.connected && s.data.user && s.data.currentRoom && socket.data.currentRoom && s.data.currentRoom === socket.data.currentRoom) { /* same room handled below */ } }
    if (socket.data.currentRoom) { emitRoomUsers(socket.data.currentRoom); io.to(socket.data.currentRoom).emit('user_updated', { name: u.username, color: newColor, gender }); }
  });

  socket.on('change_password', async (d) => {
    if (!authed() || socket.data.user.role !== 'member' || !isDbConnected()) return socket.emit('change_password_err', { msg: 'غير متاح.' });
    const oldPass = (d && d.oldPass || ''); const newPass = (d && d.newPass || '');
    if (newPass.length < 6) return socket.emit('change_password_err', { msg: 'كلمة المرور الجديدة 6 أحرف على الأقل.' });
    const u = await User.findById(socket.data.user.id).catch(() => null); if (!u) return;
    const ok = await bcrypt.compare(oldPass, u.passwordHash).catch(() => false); if (!ok) return socket.emit('change_password_err', { msg: 'كلمة المرور الحالية غير صحيحة.' });
    u.passwordHash = await bcrypt.hash(newPass, 10); u.authToken = newToken(); await u.save().catch(() => {});
    socket.emit('change_password_ok', { token: u.authToken });
  });

  socket.on('delete_account', async (d) => {
    if (!authed() || socket.data.user.role !== 'member' || !isDbConnected()) return socket.emit('delete_account_err', { msg: 'غير متاح.' });
    const pass = (d && d.password || '');
    const u = await User.findById(socket.data.user.id).catch(() => null); if (!u) return;
    const ok = await bcrypt.compare(pass, u.passwordHash).catch(() => false); if (!ok) return socket.emit('delete_account_err', { msg: 'كلمة المرور غير صحيحة.' });
    const pid = socket.data.pid; const roomId = socket.data.currentRoom;
    await User.deleteOne({ _id: u._id }).catch(() => {});
    if (roomId) { socket.to(roomId).emit('user_left', { name: u.username }); emitRoomUsers(roomId); }
    releaseSocket(socket.id); releaseNameForPid(pid); broadcastRooms();
    socket.emit('delete_account_ok');
  });

  socket.on('report', (d) => {
    if (!authed()) return;
    const reported = (d && d.name || '').trim(); if (!reported || reported === socket.data.user.name) return;
    saveReport({ reporterName: socket.data.user.name, reportedName: reported, room: socket.data.currentRoom || '' });
    socket.emit('report_ok');
  });

  // ===== الدفعة ٣: الرسائل الخاصة =====
  socket.on('pm_send', async (d) => {
    if (!authed()) return;
    const to = (d && d.to || '').trim(); const text = (d && d.text || '').trim().slice(0, 1000);
    if (!to || !text || to === socket.data.user.name) return;
    // تجاهل: لو المستقبل متجاهل المرسل، ارفض بصمت
    const toUser = isDbConnected() ? await User.findOne({ username: to }).catch(() => null) : null;
    if (toUser && Array.isArray(toUser.ignored) && toUser.ignored.includes(socket.data.user.name)) return socket.emit('pm_blocked');
    const fromUser = socket.data.user.role === 'member' && isDbConnected() ? await User.findById(socket.data.user.id).catch(() => null) : null;
    if (fromUser && Array.isArray(fromUser.ignored) && fromUser.ignored.includes(to)) return socket.emit('pm_blocked');
    const doc = isDbConnected() ? await PM.create({ from: socket.data.user.name, to, text }).catch(() => null) : null;
    const id = doc ? String(doc._id) : ('t' + Date.now()); const time = doc ? doc.createdAt.getTime() : Date.now();
    const msg = { id, from: socket.data.user.name, to, text, time, read: false };
    socket.emit('pm_sent', msg);
    const targets = socketsForUser(to);
    targets.forEach((s) => s.emit('pm_receive', msg));
  });

  socket.on('pm_list', async () => {
    if (!authed() || !isDbConnected()) return socket.emit('pm_list_data', []);
    const me = socket.data.user.name;
    try {
      const docs = await PM.aggregate([
        { $match: { $or: [{ from: me }, { to: me }] } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: { $cond: [{ $eq: ['$from', me] }, '$to', '$from'] } }, lastText: { $first: '$text' }, lastFrom: { $first: '$from' }, lastTime: { $first: '$createdAt' }, unread: { $sum: { $cond: [{ $and: [{ $eq: ['$to', me] }, { $eq: ['$read', false] }] }, 1, 0] } } }
      ]);
      const names = docs.map((x) => x._id);
      const users = await User.find({ username: { $in: names } }, { username: 1, gender: 1, nameColor: 1, points: 1, role: 1 }).catch(() => []);
      const umap = {}; users.forEach((u) => { umap[u.username] = u; });
      const list = docs.map((x) => {
        const u = umap[x._id]; const role = u ? 'member' : (findOnlineUser(x._id) ? findOnlineUser(x._id).role : 'guest');
        const color = u ? userColor(u) : colorFromId(x._id); const gender = u ? (u.gender || '') : (findOnlineUser(x._id) ? findOnlineUser(x._id).gender || '' : '');
        return { name: x._id, color, role, gender, lastText: x.lastText, lastFrom: x.lastFrom, lastTime: x.lastTime.getTime(), unread: x.unread || 0 };
      }).sort((a, b) => b.lastTime - a.lastTime);
      socket.emit('pm_list_data', list);
    } catch (e) { socket.emit('pm_list_data', []); }
  });

  socket.on('pm_history', async (d) => {
    if (!authed() || !isDbConnected()) return socket.emit('pm_history_data', { with: (d && d.with || ''), msgs: [] });
    const withName = (d && d.with || '').trim(); const me = socket.data.user.name; if (!withName) return;
    try {
      const docs = await PM.find({ $or: [{ from: me, to: withName }, { from: withName, to: me }] }).sort({ createdAt: 1 }).limit(200);
      const msgs = docs.map((x) => ({ id: String(x._id), from: x.from, to: x.to, text: x.text, time: x.createdAt.getTime(), read: x.read }));
      socket.emit('pm_history_data', { with: withName, msgs });
    } catch (e) { socket.emit('pm_history_data', { with: withName, msgs: [] }); }
  });

  socket.on('pm_open', async (d) => {
    if (!authed() || !isDbConnected()) return;
    const withName = (d && d.with || '').trim(); const me = socket.data.user.name; if (!withName) return;
    await PM.updateMany({ from: withName, to: me, read: false }, { read: true }).catch(() => {});
    socketsForUser(withName).forEach((s) => s.emit('pm_read', { by: me }));
  });

  // ===== الدفعة ٣: الأصدقاء =====
  socket.on('friend_request', async (d) => {
    if (!authed() || socket.data.user.role !== 'member' || !isDbConnected()) return;
    const to = (d && d.to || '').trim(); const me = socket.data.user.name; if (!to || to === me) return;
    const toUser = await User.findOne({ username: to }).catch(() => null); if (!toUser) return socket.emit('friend_err', { msg: 'المستخدم غير موجود.' });
    if ((toUser.friends || []).includes(me)) return socket.emit('friend_err', { msg: 'أصدقاء بالفعل.' });
    if ((toUser.friendRequests || []).some((r) => r.from === me)) return socket.emit('friend_err', { msg: 'الطلب مرسَل بالفعل.' });
    await User.updateOne({ username: to }, { $addToSet: { friendRequests: { from: me, at: new Date() } } }).catch(() => {});
    socketsForUser(to).forEach((s) => s.emit('friend_request_in', { from: me, color: socket.data.user.color, gender: socket.data.user.gender || '', role: socket.data.user.role }));
    socket.emit('friend_request_ok');
  });

  socket.on('friend_accept', async (d) => {
    if (!authed() || socket.data.user.role !== 'member' || !isDbConnected()) return;
    const from = (d && d.from || '').trim(); const me = socket.data.user.name; if (!from) return;
    await User.updateOne({ username: me }, { $pull: { friendRequests: { from } }, $addToSet: { friends: from } }).catch(() => {});
    await User.updateOne({ username: from }, { $addToSet: { friends: me } }).catch(() => {});
    socketsForUser(from).forEach((s) => s.emit('friend_accepted', { name: me, color: socket.data.user.color, gender: socket.data.user.gender || '', role: socket.data.user.role }));
    socket.emit('friend_accepted', { name: from, color: colorFromId(from), gender: '', role: 'member' });
  });

  socket.on('friend_reject', async (d) => {
    if (!authed() || !isDbConnected()) return;
    const from = (d && d.from || '').trim(); const me = socket.data.user.name; if (!from) return;
    await User.updateOne({ username: me }, { $pull: { friendRequests: { from } } }).catch(() => {});
  });

  socket.on('friend_list', async () => {
    if (!authed() || !isDbConnected()) return socket.emit('friend_list_data', { requests: [], friends: [] });
    const me = socket.data.user.name;
    const u = await User.findOne({ username: me }).catch(() => null); if (!u) return;
    const reqFrom = (u.friendRequests || []).map((r) => r.from);
    const buildList = async (names) => {
      const us = await User.find({ username: { $in: names } }, { username: 1, gender: 1, nameColor: 1, points: 1 }).catch(() => []);
      const m = {}; us.forEach((x) => { m[x.username] = x; });
      return names.map((n) => { const x = m[n]; const on = !!findOnlineUser(n); return { name: n, color: x ? userColor(x) : colorFromId(n), gender: x ? (x.gender || '') : '', role: x ? 'member' : 'guest', online: on }; });
    };
    const [requests, friends] = await Promise.all([buildList(reqFrom), buildList(u.friends || [])]);
    socket.emit('friend_list_data', { requests, friends });
  });

  // ===== الدفعة ٣: التجاهل =====
  socket.on('ignore_toggle', async (d) => {
    if (!authed() || socket.data.user.role !== 'member' || !isDbConnected()) return;
    const name = (d && d.name || '').trim(); const me = socket.data.user.name; if (!name || name === me) return;
    const u = await User.findOne({ username: me }).catch(() => null); if (!u) return;
    const list = u.ignored || []; const has = list.includes(name);
    if (has) await User.updateOne({ username: me }, { $pull: { ignored: name } }).catch(() => {});
    else await User.updateOne({ username: me }, { $addToSet: { ignored: name } }).catch(() => {});
    socket.emit('ignore_state', { name, ignored: !has });
  });

  // ===== الدفعة ٣: البحث =====
  socket.on('search_users', async (d) => {
    if (!authed()) return socket.emit('search_results', []);
    const q = (d && d.q || '').trim(); if (!q) return socket.emit('search_results', []);
    const re = new RegExp(escapeRegExp(q), 'i'); const results = []; const seen = new Set();
    // المتصلون حاليًا
    for (const [, s] of io.sockets.sockets) {
      if (s.connected && s.data.user && re.test(s.data.user.name) && !seen.has(s.data.user.name.toLowerCase())) {
        seen.add(s.data.user.name.toLowerCase()); const u = s.data.user; const t = tierFor(u.role, u.points);
        results.push({ name: u.name, color: u.color, role: u.role, gender: u.gender || '', rank: t.rank, tierLabel: t.label, tierColor: t.color, online: true });
      }
    }
    // أعضاء من DB
    if (isDbConnected() && results.length < 20) {
      try {
        const us = await User.find({ username: re }).limit(20);
        us.forEach((x) => { if (seen.has(x.username.toLowerCase())) return; seen.add(x.username.toLowerCase()); const t = tierFor('member', x.points || 0); results.push({ name: x.username, color: userColor(x), role: 'member', gender: x.gender || '', rank: t.rank, tierLabel: t.label, tierColor: t.color, online: !!findOnlineUser(x.username) }); });
      } catch (e) {}
    }
    socket.emit('search_results', results.slice(0, 30));
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.currentRoom;
    if (roomId && socket.data.user) socket.to(roomId).emit('user_left', { name: socket.data.user.name, color: socket.data.user.color, role: socket.data.user.role, gender: socket.data.user.gender || '' });
    if (roomId) emitRoomUsers(roomId);
    releaseSocket(socket.id); broadcastRooms();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
