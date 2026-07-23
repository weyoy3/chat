require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(__dirname));

// =========================================================
// 1) Models
// =========================================================
const conversationSchema = new mongoose.Schema({
  room: { type: String, unique: true, index: true },
  userA: { type: String, index: true },
  userB: { type: String, index: true },
  nameA: { type: String, default: '' },
  nameB: { type: String, default: '' },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null }
});

const messageSchema = new mongoose.Schema({
  room: { type: String, index: true },
  senderId: { type: String, index: true },
  senderName: { type: String, default: '' },
  text: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

// حذف تلقائي بعد 30 يوم
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);

// =========================================================
// 2) Database
// =========================================================
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

async function connectDB() {
  if (!process.env.MONGO_URL) {
    console.warn('MONGO_URL غير موجود. الشات هيشتغل من غير حفظ الرسائل.');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
  }
}
connectDB();

async function saveConversation(room, a, b) {
  if (!isDbConnected()) return;
  try {
    await Conversation.create({
      room,
      userA: a.id, userB: b.id,
      nameA: a.name, nameB: b.name,
      startedAt: new Date()
    });
  } catch (e) { console.error('saveConversation error:', e.message); }
}

async function endConversation(room) {
  if (!room || !isDbConnected()) return;
  try {
    await Conversation.findOneAndUpdate({ room }, { endedAt: new Date() });
  } catch (e) { console.error('endConversation error:', e.message); }
}

async function saveMessage({ room, senderId, senderName, text }) {
  if (!room || !text || !isDbConnected()) return;
  try {
    await Message.create({ room, senderId, senderName, text });
  } catch (e) { console.error('saveMessage error:', e.message); }
}

// =========================================================
// 3) أدوات مساعدة
// =========================================================
function generateName() {
  return 'ضيف_' + Math.floor(1000 + Math.random() * 9000);
}

function broadcastOnlineCount() {
  const count = io.sockets.sockets.size;
  io.emit('online_count', { count });
}

const waitingQueue = [];

function removeFromQueue(socket) {
  const i = waitingQueue.findIndex((s) => s.id === socket.id);
  if (i !== -1) waitingQueue.splice(i, 1);
}

function notifyPartnerAndClearRoom(roomName, leaverSocket, reason) {
  const clients = io.sockets.adapter.rooms.get(roomName);
  if (!clients) return;
  for (const clientId of clients) {
    if (clientId === leaverSocket.id) continue;
    const remaining = io.sockets.sockets.get(clientId);
    if (remaining) {
      remaining.emit('partner_disconnected', { reason });
      remaining.emit('chat_ended', { reason });
      remaining.data.roomName = null;
      remaining.data.partnerId = null;
    }
  }
}

// =========================================================
// 4) منطق الشات
// =========================================================
io.on('connection', (socket) => {
  socket.data.roomName = null;
  socket.data.partnerId = null;
  socket.data.displayName = generateName();
  socket.data.lastMsg = 0;

  console.log('مستخدم متصل:', socket.data.displayName, socket.id);

  // نبعتله هويته + عدد الأونلاين
  socket.emit('your_identity', { name: socket.data.displayName });
  broadcastOnlineCount();

  // دالة البحث عن شريك (تتنادى من find_partner و next_partner)
  function tryMatch() {
    if (socket.data.roomName) {
      socket.emit('system_message', { text: 'أنت متصل بالفعل في دردشة.', time: Date.now() });
      return;
    }
    removeFromQueue(socket);

    while (waitingQueue.length > 0) {
      const partner = waitingQueue.shift();
      if (!partner.connected) continue;
      if (partner.id === socket.id) continue;

      const room = `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      socket.join(room);
      partner.join(room);

      socket.data.roomName = room;
      socket.data.partnerId = partner.id;
      partner.data.roomName = room;
      partner.data.partnerId = socket.id;

      saveConversation(room,
        { id: partner.id, name: partner.data.displayName },
        { id: socket.id, name: socket.data.displayName }
      );

      socket.emit('matched', { room, partnerName: partner.data.displayName, time: Date.now() });
      partner.emit('matched', { room, partnerName: socket.data.displayName, time: Date.now() });

      io.to(room).emit('system_message', { text: 'تم الاتصال، قل مرحبا 👋', time: Date.now() });
      return;
    }

    waitingQueue.push(socket);
    socket.emit('searching', { time: Date.now() });
  }

  socket.on('find_partner', tryMatch);

  // زر التالي: يسيب الشريك الحالي ويبحث عن واحد جديد
  socket.on('next_partner', () => {
    removeFromQueue(socket);
    const roomName = socket.data.roomName;
    if (roomName) {
      socket.to(roomName).emit('partner_disconnected', { reason: 'next' });
      notifyPartnerAndClearRoom(roomName, socket, 'next');
      endConversation(roomName);
      socket.leave(roomName);
      socket.data.roomName = null;
      socket.data.partnerId = null;
    }
    socket.emit('system_message', { text: 'جاري البحث عن شريك جديد...', time: Date.now() });
    tryMatch();
  });

  // رسالة + rate limit
  socket.on('message', (msg) => {
    if (typeof msg !== 'string') return;
    const text = msg.trim().slice(0, 1000);
    if (!text || !socket.data.roomName) return;

    const now = Date.now();
    if (now - socket.data.lastMsg < 400) return; // حماية من السبام
    socket.data.lastMsg = now;

    saveMessage({
      room: socket.data.roomName,
      senderId: socket.id,
      senderName: socket.data.displayName,
      text
    });

    socket.to(socket.data.roomName).emit('message', {
      text,
      senderId: socket.id,
      senderName: socket.data.displayName,
      time: now
    });
  });

  socket.on('typing', () => {
    if (!socket.data.roomName) return;
    socket.to(socket.data.roomName).emit('typing', { from: socket.id });
  });
  socket.on('stop_typing', () => {
    if (!socket.data.roomName) return;
    socket.to(socket.data.roomName).emit('stop_typing', { from: socket.id });
  });

  socket.on('leave_chat', () => {
    removeFromQueue(socket);
    const roomName = socket.data.roomName;
    if (roomName) {
      socket.to(roomName).emit('partner_disconnected', { reason: 'leave' });
      notifyPartnerAndClearRoom(roomName, socket, 'leave');
      endConversation(roomName);
      socket.leave(roomName);
      socket.data.roomName = null;
      socket.data.partnerId = null;
    }
    socket.emit('left', { time: Date.now() });
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    const roomName = socket.data.roomName;
    if (roomName) {
      socket.to(roomName).emit('partner_disconnected', { reason: 'disconnect' });
      notifyPartnerAndClearRoom(roomName, socket, 'disconnect');
      endConversation(roomName);
    }
    broadcastOnlineCount();
    console.log('مستخدم قطع الاتصال:', socket.data.displayName);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
