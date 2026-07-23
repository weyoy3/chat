require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// =========================================================
// 1) الغرف الثابتة
// =========================================================
const ROOMS = [
  { id: 'general', name: 'الغرفة العامة', emoji: '💬', flag: '🌍', category: 'عامة' },
  { id: 'egypt',   name: 'مصر',           emoji: '😍', flag: '🇪🇬', category: 'دول' },
  { id: 'saudi',   name: 'السعودية',      emoji: '🌴', flag: '🇸', category: 'دول' },
  { id: 'algeria', name: 'الجزائر',       emoji: '⭐', flag: '🇩🇿', category: 'دول' },
  { id: 'morocco', name: 'المغرب',        emoji: '🌙', flag: '🇲🇦', category: 'دول' },
  { id: 'love',    name: 'الحب والغرام',  emoji: '❤️', flag: '💕', category: 'مواضيع' },
  { id: 'poetry',  name: 'الشعر والأدب',  emoji: '📖', flag: '✍️', category: 'مواضيع' },
  { id: 'english', name: 'English Room',  emoji: '🔤', flag: '🇬', category: 'مواضيع' }
];
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

// =========================================================
// 2) قاعدة البيانات
// =========================================================
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
  text: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
const Message = mongoose.model('Message', messageSchema);

function isDbConnected() { return mongoose.connection.readyState === 1; }

async function connectDB() {
  if (!process.env.MONGO_URL) {
    console.warn('MONGO_URL غير موجود. الشات هيشتغل من غير حفظ.');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('MongoDB connected successfully');
  } catch (e) { console.error('MongoDB connection error:', e.message); }
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
      senderRole: d.senderRole, time: d.createdAt.getTime()
    }));
  } catch (e) { return []; }
}

// =========================================================
// 3) أدوات مساعدة
// =========================================================
function generateName() { return 'زائر_' + Math.floor(1000 + Math.random() * 9000); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 42%)`;
}
function roomCount(roomId) {
  const s = io.sockets.adapter.rooms.get(roomId);
  return s ? s.size : 0;
}
function buildRoomsList() { return ROOMS.map((r) => ({ ...r, count: roomCount(r.id) })); }
function broadcastRooms() { io.emit('rooms_list', buildRoomsList()); }
function roomUsersList(roomId) {
  const s = io.sockets.adapter.rooms.get(roomId);
  if (!s) return [];
  const list = [];
  for (const cid of s) {
    const sock = io.sockets.sockets.get(cid);
    if (sock && sock.data.user) list.push({ name: sock.data.user.name, color: sock.data.user.color, role: sock.data.user.role });
  }
  return list;
}
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
function publicUser(u, color) {
  return { name: u.username, role: u.role, color };
}

// =========================================================
// 4) منطق الاتصال
// =========================================================
io.on('connection', (socket) => {
  socket.data.user = null;   // مفيش مستخدم لحد ما يعمل auth
  socket.data.lastMsg = 0;

  socket.emit('rooms_list', buildRoomsList());

  // ---------- AUTH ----------
  socket.on('auth_check', async (token) => {
    if (typeof token !== 'string' || !isDbConnected()) return socket.emit('auth_fail');
    try {
      const u = await User.findOne({ authToken: token });
      if (!u) return socket.emit('auth_fail');
      const color = colorFromId(u.username);
      socket.data.user = { id: String(u._id), name: u.username, role: 'member', color };
      socket.emit('auth_ok', publicUser(u, color));
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

    if (username.length < 3 || username.length > 20)
      return socket.emit('register_err', { msg: 'اسم المستخدم لازم 3-20 حرف.' });
    if (!isEmail(email))
      return socket.emit('register_err', { msg: 'البريد الإلكتروني غير صحيح.' });
    if (password.length < 6)
      return socket.emit('register_err', { msg: 'كلمة المرور 6 أحرف على الأقل.' });
    if (!isDbConnected())
      return socket.emit('register_err', { msg: 'قاعدة البيانات غير متصلة، حاول لاحقًا.' });

    try {
      const exists = await User.findOne({ $or: [{ email }, { username }] });
      if (exists) return socket.emit('register_err', { msg: 'البريد أو اسم المستخدم مستخدم بالفعل.' });

      const passwordHash = await bcrypt.hash(password, 10);
      const authToken = newToken();
      const u = await User.create({ username, email, passwordHash, gender, age: isNaN(age) ? null : age, country, role: 'member', authToken });
      const color = colorFromId(u.username);
      socket.data.user = { id: String(u._id), name: u.username, role: 'member', color };
      socket.emit('register_ok', { token: authToken, user: publicUser(u, color) });
    } catch (e) {
      socket.emit('register_err', { msg: 'حدث خطأ أثناء التسجيل.' });
    }
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

      u.authToken = newToken();
      await u.save();
      const color = colorFromId(u.username);
      socket.data.user = { id: String(u._id), name: u.username, role: 'member', color };
      socket.emit('login_ok', { token: u.authToken, user: publicUser(u, color) });
    } catch (e) {
      socket.emit('login_err', { msg: 'حدث خطأ أثناء الدخول.' });
    }
  });

  socket.on('guest_login', () => {
    const name = generateName();
    const color = colorFromId(socket.id);
    socket.data.user = { id: socket.id, name, role: 'guest', color };
    socket.emit('guest_ok', { user: { name, role: 'guest', color } });
  });

  // ---------- GUARD ----------
  function authed() { return !!socket.data.user; }

  // ---------- ROOMS ----------
  socket.on('join_room', async (roomId) => {
    if (!authed() || !ROOM_IDS.has(roomId)) return;
    if (socket.data.currentRoom && socket.data.currentRoom !== roomId) socket.leave(socket.data.currentRoom);

    socket.join(roomId);
    socket.data.currentRoom = roomId;
    broadcastRooms();

    const meta = ROOMS.find((r) => r.id === roomId);
    const history = await loadHistory(roomId);
    socket.emit('joined_room', { room: meta, history });
    socket.to(roomId).emit('user_joined', { name: socket.data.user.name, color: socket.data.user.color, role: socket.data.user.role });
  });

  socket.on('leave_room', () => {
    if (!authed()) return;
    const roomId = socket.data.currentRoom;
    if (roomId) {
      socket.to(roomId).emit('user_left', { name: socket.data.user.name, role: socket.data.user.role });
      socket.leave(roomId);
      socket.data.currentRoom = null;
      broadcastRooms();
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
    const payload = { text, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, time: now };

    saveMessage({ room: socket.data.currentRoom, senderId: socket.id, senderName: u.name, senderColor: u.color, senderRole: u.role, text });
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
    if (roomId && socket.data.user) {
      socket.to(roomId).emit('user_left', { name: socket.data.user.name, role: socket.data.user.role });
    }
    broadcastRooms();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
