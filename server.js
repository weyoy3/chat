require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
// اكتشاف قطع الاتصال أسرع -> الأسماء تتحرر أسرع
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 15000,
  pingInterval: 5000
});
app.use(express.static(__dirname));

const ROOMS = [
  { id: 'general', name: 'الغرفة العامة', emoji: '💬', flag: '🌍', category: 'عامة', theme: { bg: 'linear-gradient(180deg,#f7f4ec,#efe9da)', accent: '#0d9488', accent2: '#14b8a6', wm: '💬' } },
  { id: 'egypt', name: 'مصر', emoji: '😍', flag: '🇪🇬', category: 'دول', theme: { bg: 'linear-gradient(180deg,#fbf3e9,#f3e6d6)', accent: '#b91c1c', accent2: '#dc2626', wm: '🏛️' } },
  { id: 'saudi', name: 'السعودية', emoji: '🌴', flag: '🇸🇦', category: 'دول', theme: { bg: 'linear-gradient(180deg,#eef7f0,#e3f0e6)', accent: '#15803d', accent2: '#16a34a', wm: '🌴' } },
  { id: 'algeria', name: 'الجزائر', emoji: '⭐', flag: '🇩🇿', category: 'دول', theme: { bg: 'linear-gradient(180deg,#f0f4fb,#e6ecf7)', accent: '#1d4ed8', accent2: '#2563eb', wm: '⭐' } },
  { id: 'morocco', name: 'المغرب', emoji: '🌙', flag: '🇲', category: 'دول', theme: { bg: 'linear-gradient(180deg,#fbf0f0,#f5e3e3)', accent: '#be123c', accent2: '#e11d48', wm: '🌙' } },
  { id: 'love', name: 'الحب والغرام', emoji: '❤️', flag: '💕', category: 'مواضيع', theme: { bg: 'linear-gradient(180deg,#fdf0f5,#fbe3ec)', accent: '#db2777', accent2: '#ec4899', wm: '❤️' } },
  { id: 'poetry', name: 'الشعر والأدب', emoji: '📖', flag: '✍️', category: 'مواضيع', theme: { bg: 'linear-gradient(180deg,#f5f0e6,#ece2cf)', accent: '#92400e', accent2: '#b45309', wm: '📜' } },
  { id: 'english', name: 'English Room', emoji: '🔤', flag: '🇬', category: 'مواضيع', theme: { bg: 'linear-gradient(180deg,#eef2fb,#e3e9f7)', accent: '#1e40af', accent2: '#3b82f6', wm: '🔤' } }
];
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, index: true, trim: true },
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  gender: { type: String, default: '' },
  age: { type: Number, default: null },
  country: { type: String, default: '' },
  role: { type: String, default: 'member' },
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
  text: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
const Message = mongoose.model('Message', messageSchema);

function isDbConnected() { return mongoose.connection.readyState === 1; }
async function connectDB() {
  if (!process.env.MONGO_URL) { console.warn('MONGO_URL غير موجود.'); return; }
  try { await mongoose.connect(process.env.MONGO_URL); console.log('MongoDB connected successfully'); }
  catch (e) { console.error('MongoDB connection error:', e.message); }
}
connectDB();

async function saveMessage(m) {
  if (!isDbConnected()) return;
  try { await Message.create(m); } catch (e) { console.error('saveMessage error:', e.message); }
}
async function loadHistory(roomId) {
  if (!isDbConnected()) return [];
  try {
    const docs = await Message.find({ room: roomId }).sort({ createdAt: -1 }).limit(30);
    return docs.reverse().map((d) => ({
      text: d.text, senderName: d.senderName, senderColor: d.senderColor,
      senderRole: d.senderRole, senderGender: d.senderGender, time: d.createdAt.getTime()
    }));
  } catch (e) { return []; }
}

function generateName() { return 'زائر_' + Math.floor(1000 + Math.random() * 9000); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 42%)`;
}
function roomCount(roomId) { const s = io.sockets.adapter.rooms.get(roomId); return s ? s.size : 0; }
function buildRoomsList() { return ROOMS.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, flag: r.flag, category: r.category, count: roomCount(r.id) })); }
function broadcastRooms() { io.emit('rooms_list', buildRoomsList()); }

function roomUsersList(roomId) {
  const s = io.sockets.adapter.rooms.get(roomId);
  if (!s) return [];
  const list = [];
  for (const cid of s) {
    const sock = io.sockets.sockets.get(cid);
    if (sock && sock.data.user) list.push({ name: sock.data.user.name, color: sock.data.user.color, role: sock.data.user.role, gender: sock.data.user.gender || '' });
  }
  return list;
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
function publicUser(u, color) { return { name: u.username, role: u.role, color, gender: u.gender || '' }; }

// ---- حجز الأسماء النشطة ----
const activeNames = new Map();
function reserveName(desired, socketId) {
  let base = (desired || '').trim().replace(/\s+/g, ' ');
  if (base.length < 2) base = generateName();
  const tryOne = (n) => {
    const low = n.toLowerCase();
    if (!activeNames.has(low)) { activeNames.set(low, socketId); return n; }
    if (activeNames.get(low) === socketId) return n;
    return null;
  };
  let got = tryOne(base);
  if (got) return { name: got, renamed: got.toLowerCase() !== base.toLowerCase() };
  for (let i = 2; i < 200; i++) { got = tryOne(base + i); if (got) return { name: got, renamed: true }; }
  const fb = base + socketId.slice(0, 4);
  activeNames.set(fb.toLowerCase(), socketId);
  return { name: fb, renamed: true };
}
function releaseName(socketId) {
  for (const [low, sid] of activeNames) { if (sid === socketId) { activeNames.delete(low); break; } }
}

// ---- منظّف دوري: يحرر أي اسم صاحبه مش متصل فعليًا (يحل مشكلة الاسم المحجوز لشبح) ----
setInterval(() => {
  for (const [low, sid] of activeNames) {
    const s = io.sockets.sockets.get(sid);
    if (!s || !s.connected) activeNames.delete(low);
  }
}, 20000);

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function findMentions(text, roomId, senderSocketId) {
  const s = io.sockets.adapter.rooms.get(roomId);
  if (!s) return [];
  const found = []; const seen = new Set();
  for (const cid of s) {
    if (cid === senderSocketId) continue;
    const sock = io.sockets.sockets.get(cid);
    if (!sock || !sock.data.user) continue;
    const name = sock.data.user.name; const low = name.toLowerCase();
    if (seen.has(low)) continue;
    const re = new RegExp('(^|[^\\u0600-\\u06FF\\w])' + escapeRegExp(name) + '($|[^\\u0600-\\u06FF\\w])');
    if (re.test(text)) { seen.add(low); found.push(name); }
  }
  return found;
}

io.on('connection', (socket) => {
  socket.data.user = null;
  socket.data.lastMsg = 0;
  socket.emit('rooms_list', buildRoomsList());

  socket.on('auth_check', async (token) => {
    if (typeof token !== 'string' || !isDbConnected()) return socket.emit('auth_fail');
    try {
      const u = await User.findOne({ authToken: token });
      if (!u) return socket.emit('auth_fail');
      const { name } = reserveName(u.username, socket.id);
      const color = colorFromId(name);
      socket.data.user = { id: String(u._id), name, role: 'member', color, gender: u.gender || '' };
      socket.emit('auth_ok', { name, role: 'member', color, gender: u.gender || '' });
    } catch (e) { socket.emit('auth_fail'); }
  });

  socket.on('register', async (d) => {
    if (!d || typeof d !== 'object') return;
    const username = (d.username || '').trim();
    const email = (d.email || '').trim().toLowerCase();
    const password = d.password || '';
    const gender = (d.gender || '').trim();
    const age = parseInt(d.age, 10);
    const country = (d.country || '').trim();
    if (username.length < 3 || username.length > 20) return socket.emit('register_err', { msg: 'اسم المستخدم لازم 3-20 حرف.' });
    if (!isEmail(email)) return socket.emit('register_err', { msg: 'البريد الإلكتروني غير صحيح.' });
    if (password.length < 6) return socket.emit('register_err', { msg: 'كلمة المرور 6 أحرف على الأقل.' });
    if (!isDbConnected()) return socket.emit('register_err', { msg: 'قاعدة البيانات غير متصلة.' });
    if (activeNames.has(username.toLowerCase())) return socket.emit('register_err', { msg: 'الاسم ده مستخدم حاليًا على الموقع، جرّب اسم تاني.' });
    try {
      const exists = await User.findOne({ $or: [{ email }, { username }] });
      if (exists) return socket.emit('register_err', { msg: 'البريد أو اسم المستخدم مستخدم بالفعل.' });
      const passwordHash = await bcrypt.hash(password, 10);
      const authToken = newToken();
      const u = await User.create({ username, email, passwordHash, gender, age: isNaN(age) ? null : age, country, role: 'member', authToken });
      reserveName(username, socket.id);
      const color = colorFromId(username);
      socket.data.user = { id: String(u._id), name: username, role: 'member', color, gender };
      socket.emit('register_ok', { token: authToken, user: publicUser(u, color) });
    } catch (e) { socket.emit('register_err', { msg: 'حدث خطأ أثناء التسجيل.' }); }
  });

  socket.on('login', async (d) => {
    if (!d || typeof d !== 'object') return;
    const email = (d.email || '').trim().toLowerCase();
    const password = d.password || '';
    if (!isEmail(email) || !password) return socket.emit('login_err', { msg: 'أدخل البريد وكلمة المرور.' });
    if (!isDbConnected()) return socket.emit('login_err', { msg: 'قاعدة البيانات غير متصلة.' });
    try {
      const u = await User.findOne({ email });
      if (!u) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
      const ok = await bcrypt.compare(password, u.passwordHash);
      if (!ok) return socket.emit('login_err', { msg: 'البريد أو كلمة المرور غير صحيحة.' });
      u.authToken = newToken(); await u.save();
      const { name } = reserveName(u.username, socket.id);
      const color = colorFromId(name);
      socket.data.user = { id: String(u._id), name, role: 'member', color, gender: u.gender || '' };
      socket.emit('login_ok', { token: u.authToken, user: { name, role: 'member', color, gender: u.gender || '' } });
    } catch (e) { socket.emit('login_err', { msg: 'حدث خطأ أثناء الدخول.' }); }
  });

  socket.on('guest_login', (d) => {
    const raw = (d && d.name || '').trim();
    const age = d ? parseInt(d.age, 10) : NaN;
    const gender = d ? (d.gender || '').trim() : '';
    const { name, renamed } = reserveName(raw, socket.id);
    const color = colorFromId(name);
    socket.data.user = { id: socket.id, name, role: 'guest', color, gender, age: isNaN(age) ? null : age };
    socket.emit('guest_ok', { user: { name, role: 'guest', color, gender }, renamed });
  });

  function authed() { return !!socket.data.user; }

  socket.on('join_room', async (roomId) => {
    if (!authed() || !ROOM_IDS.has(roomId)) return;
    if (socket.data.currentRoom && socket.data.currentRoom !== roomId) socket.leave(socket.data.currentRoom);
    socket.join(roomId);
    socket.data.currentRoom = roomId;
    broadcastRooms();
    const meta = ROOMS.find((r) => r.id === roomId);
    const history = await loadHistory(roomId);
    socket.emit('joined_room', { room: { id: meta.id, name: meta.name, emoji: meta.emoji, theme: meta.theme }, history });
    socket.to(roomId).emit('user_joined', { name: socket.data.user.name, color: socket.data.user.color, role: socket.data.user.role, gender: socket.data.user.gender || '' });
  });

  socket.on('leave_room', () => {
    if (!authed()) return;
    const roomId = socket.data.currentRoom;
    if (roomId) {
      socket.to(roomId).emit('user_left', { name: socket.data.user.name, color: socket.data.user.color, role: socket.data.user.role, gender: socket.data.user.gender || '' });
      socket.leave(roomId); socket.data.currentRoom = null; broadcastRooms();
    }
    socket.emit('left_room');
  });

  socket.on('request_users', () => {
    if (!authed() || !socket.data.currentRoom) return;
    socket.emit('room_users', roomUsersList(socket.data.currentRoom));
  });

  socket.on('message', (msg) => {
    if (!authed() || typeof msg !== 'string') return;
    const text = msg.trim().slice(0, 1000);
    if (!text || !socket.data.currentRoom) return;
    const now = Date.now();
    if (now - socket.data.lastMsg < 400) return;
    socket.data.lastMsg = now;
    const u = socket.data.user;
    const mentions = findMentions(text, socket.data.currentRoom, socket.id);
    const s = io.sockets.adapter.rooms.get(socket.data.currentRoom);
    if (s) {
      for (const cid of s) {
        if (cid === socket.id) continue;
        const sock = io.sockets.sockets.get(cid);
        if (sock && sock.data.user && mentions.some((mn) => mn.toLowerCase() === sock.data.user.name.toLowerCase())) {
          sock.emit('mentioned', { by: u.name });
        }
      }
    }
    // رسائل الزائر لا تُحفظ في قاعدة البيانات (لا أثر دائم للزائر)
    if (u.role === 'member') {
      saveMessage({ room: socket.data.currentRoom, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', text });
    }
    const payload = { text, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, senderGender: u.gender || '', mentions, time: now };
    io.to(socket.data.currentRoom).emit('message', payload);
  });

  socket.on('typing', () => {
    if (!authed() || !socket.data.currentRoom) return;
    socket.to(socket.data.currentRoom).emit('typing', { name: socket.data.user.name });
  });
  socket.on('stop_typing', () => {
    if (!authed() || !socket.data.currentRoom) return;
    socket.to(socket.data.currentRoom).emit('stop_typing', { name: socket.data.user.name });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.currentRoom;
    if (roomId && socket.data.user) socket.to(roomId).emit('user_left', { name: socket.data.user.name, color: socket.data.user.color, role: socket.data.user.role, gender: socket.data.user.gender || '' });
    releaseName(socket.id);
    broadcastRooms();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
