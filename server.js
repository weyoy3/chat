require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

// تقديم الملفات الثابتة (index.html وغيره)
app.use(express.static(__dirname));

// =========================================================
// 1) Models الخاصة بقاعدة البيانات
// =========================================================

const conversationSchema = new mongoose.Schema({
  room: { type: String, unique: true, index: true },
  userA: { type: String, index: true },
  userB: { type: String, index: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null }
});

const messageSchema = new mongoose.Schema({
  room: { type: String, index: true },
  senderId: { type: String, index: true },
  text: { type: String, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

// حذف الرسائل تلقائيًا بعد 30 يوم (غيّرها لو عايز مدة تانية)
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);

// =========================================================
// 2) الاتصال بقاعدة البيانات + دوال الحفظ
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

async function saveConversation(room, userA, userB) {
  if (!isDbConnected()) return;
  try {
    await Conversation.create({ room, userA, userB, startedAt: new Date() });
  } catch (error) {
    console.error('saveConversation error:', error.message);
  }
}

async function endConversation(room) {
  if (!room || !isDbConnected()) return;
  try {
    await Conversation.findOneAndUpdate({ room }, { endedAt: new Date() });
  } catch (error) {
    console.error('endConversation error:', error.message);
  }
}

async function saveMessage({ room, senderId, text }) {
  if (!room || !text || !isDbConnected()) return;
  try {
    await Message.create({ room, senderId, text });
  } catch (error) {
    console.error('saveMessage error:', error.message);
  }
}

// =========================================================
// 3) منطق الشات
// =========================================================

const waitingQueue = [];

function removeFromQueue(socket) {
  const index = waitingQueue.findIndex((s) => s.id === socket.id);
  if (index !== -1) waitingQueue.splice(index, 1);
}

function clearRoomForRemaining(roomName, disconnectedSocket) {
  const clients = io.sockets.adapter.rooms.get(roomName);
  if (!clients) return;
  for (const clientId of clients) {
    if (clientId === disconnectedSocket.id) continue;
    const remaining = io.sockets.sockets.get(clientId);
    if (remaining) {
      remaining.data.roomName = null;
      remaining.data.partnerId = null;
      remaining.emit('chat_ended', { reason: 'partner_disconnected' });
    }
  }
}

io.on('connection', (socket) => {
  console.log('مستخدم متصل:', socket.id);
  socket.data.roomName = null;
  socket.data.partnerId = null;

  // البحث عن شريك
  socket.on('find_partner', () => {
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

      // حفظ بداية المحادثة في قاعدة البيانات
      saveConversation(room, partner.id, socket.id);

      io.to(room).emit('matched', { room, time: Date.now() });
      io.to(room).emit('system_message', { text: 'تم الاتصال، قل مرحبا 👋', time: Date.now() });
      return;
    }

    waitingQueue.push(socket);
    socket.emit('searching', { time: Date.now() });
  });

  // استقبال رسالة
  socket.on('message', (msg) => {
    if (typeof msg !== 'string') return;
    const text = msg.trim().slice(0, 1000);
    if (!text || !socket.data.roomName) return;

    // حفظ الرسالة في قاعدة البيانات
    saveMessage({ room: socket.data.roomName, senderId: socket.id, text });

    socket.to(socket.data.roomName).emit('message', {
      text,
      senderId: socket.id,
      time: Date.now()
    });
  });

  // مؤشر الكتابة
  socket.on('typing', () => {
    if (!socket.data.roomName) return;
    socket.to(socket.data.roomName).emit('typing', { from: socket.id });
  });
  socket.on('stop_typing', () => {
    if (!socket.data.roomName) return;
    socket.to(socket.data.roomName).emit('stop_typing', { from: socket.id });
  });

  // إنهاء الدردشة يدويًا
  socket.on('leave_chat', () => {
    removeFromQueue(socket);
    const roomName = socket.data.roomName;
    if (roomName) {
      socket.to(roomName).emit('partner_disconnected');
      clearRoomForRemaining(roomName, socket);
      endConversation(roomName);
      socket.leave(roomName);
      socket.data.roomName = null;
      socket.data.partnerId = null;
    }
    socket.emit('left', { time: Date.now() });
  });

  // عند قطع الاتصال
  socket.on('disconnect', () => {
    removeFromQueue(socket);
    const roomName = socket.data.roomName;
    if (roomName) {
      socket.to(roomName).emit('partner_disconnected');
      clearRoomForRemaining(roomName, socket);
      endConversation(roomName);
    }
    console.log('مستخدم قطع الاتصال:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
