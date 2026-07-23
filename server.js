require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

// =========================================================
// 1) قائمة الغرف الثابتة (عدّل/زود براحتك من هنا بس)
// =========================================================
const ROOMS = [
  { id: 'general', name: 'الغرفة العامة', emoji: '💬', flag: '🌍', category: 'عامة' },
  { id: 'egypt',   name: 'مصر',           emoji: '😍', flag: '🇪🇬', category: 'دول' },
  { id: 'saudi',   name: 'السعودية',      emoji: '🌴', flag: '🇸🇦', category: 'دول' },
  { id: 'algeria', name: 'الجزائر',       emoji: '⭐', flag: '🇩🇿', category: 'دول' },
  { id: 'morocco', name: 'المغرب',        emoji: '🌙', flag: '🇲🇦', category: 'دول' },
  { id: 'love',    name: 'الحب والغرام',  emoji: '❤️', flag: '💕', category: 'مواضيع' },
  { id: 'poetry',  name: 'الشعر والأدب',  emoji: '📖', flag: '✍️', category: 'مواضيع' },
  { id: 'english', name: 'English Room',  emoji: '🔤', flag: '🇬🇧', category: 'مواضيع' }
];
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

// =========================================================
// 2) قاعدة البيانات
// =========================================================
const messageSchema = new mongoose.Schema({
  room: { type: String, index: true },
  senderId: { type: String, index: true },
  senderName: { type: String, default: '' },
  senderColor: { type: String, default: '#6366f1' },
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
      text: d.text, senderName: d.senderName, senderColor: d.senderColor, time: d.createdAt.getTime()
    }));
  } catch (e) { return []; }
}

// =========================================================
// 3) أدوات مساعدة
// =========================================================
function generateName() { return 'ضيف_' + Math.floor(1000 + Math.random() * 9000); }

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 45%)`;
}

function roomCount(roomId) {
  const s = io.sockets.adapter.rooms.get(roomId);
  return s ? s.size : 0;
}

function buildRoomsList() {
  return ROOMS.map((r) => ({ ...r, count: roomCount(r.id) }));
}

// نبعت قائمة الغرف + العدادات لكل المتصلين
function broadcastRooms() { io.emit('rooms_list', buildRoomsList()); }

function roomUsersList(roomId) {
  const s = io.sockets.adapter.rooms.get(roomId);
  if (!s) return [];
  const list = [];
  for (const cid of s) {
    const sock = io.sockets.sockets.get(cid);
    if (sock) list.push({ name: sock.data.displayName, color: sock.data.color });
  }
  return list;
}

// =========================================================
// 4) منطق الاتصال
// =========================================================
io.on('connection', (socket) => {
  socket.data.displayName = generateName();
  socket.data.color = colorFromId(socket.id);
  socket.data.currentRoom = null;
  socket.data.lastMsg = 0;

  console.log('متصل:', socket.data.displayName);

  socket.emit('your_identity', { name: socket.data.displayName, color: socket.data.color });
  socket.emit('rooms_list', buildRoomsList());

  // دخول غرفة
  socket.on('join_room', async (roomId) => {
    if (!ROOM_IDS.has(roomId)) return;

    // لو في غرفة تانية، يسيبها الأول
    if (socket.data.currentRoom && socket.data.currentRoom !== roomId) {
      socket.leave(socket.data.currentRoom);
    }

    socket.join(roomId);
    socket.data.currentRoom = roomId;
    broadcastRooms();

    const meta = ROOMS.find((r) => r.id === roomId);
    const history = await loadHistory(roomId);

    socket.emit('joined_room', { room: meta, history });
    socket.to(roomId).emit('user_joined', { name: socket.data.displayName, color: socket.data.color });
  });

  // خروج من الغرفة (رجوع للقائمة)
  socket.on('leave_room', () => {
    const roomId = socket.data.currentRoom;
    if (roomId) {
      socket.to(roomId).emit('user_left', { name: socket.data.displayName });
      socket.leave(roomId);
      socket.data.currentRoom = null;
      broadcastRooms();
    }
    socket.emit('left_room');
  });

  // طلب قائمة الموجودين في الغرفة
  socket.on('request_users', () => {
    if (!socket.data.currentRoom) return;
    socket.emit('room_users', roomUsersList(socket.data.currentRoom));
  });

  // رسالة
  socket.on('message', (msg) => {
    if (typeof msg !== 'string') return;
    const text = msg.trim().slice(0, 1000);
    if (!text || !socket.data.currentRoom) return;

    const now = Date.now();
    if (now - socket.data.lastMsg < 400) return; // حماية سبام
    socket.data.lastMsg = now;

    const payload = {
      text,
      senderId: socket.id,
      senderName: socket.data.displayName,
      senderColor: socket.data.color,
      time: now
    };

    saveMessage({
      room: socket.data.currentRoom,
      senderId: socket.id,
      senderName: socket.data.displayName,
      senderColor: socket.data.color,
      text
    });

    io.to(socket.data.currentRoom).emit('message', payload);
  });

  socket.on('typing', () => {
    if (!socket.data.currentRoom) return;
    socket.to(socket.data.currentRoom).emit('typing', { name: socket.data.displayName });
  });
  socket.on('stop_typing', () => {
    if (!socket.data.currentRoom) return;
    socket.to(socket.data.currentRoom).emit('stop_typing', { name: socket.data.displayName });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.currentRoom;
    if (roomId) {
      socket.to(roomId).emit('user_left', { name: socket.data.displayName });
    }
    broadcastRooms();
    console.log('قطع الاتصال:', socket.data.displayName);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
