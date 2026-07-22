const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

// تقديم الملفات الثابتة من نفس المجلد
app.use(express.static(__dirname));

// قائمة انتظار المستخدمين الباحثين عن دردشة
const waitingQueue = [];

function removeFromQueue(socket) {
  const index = waitingQueue.findIndex((s) => s.id === socket.id);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

function clearRoomForRemaining(roomName, disconnectedSocket) {
  const clients = io.sockets.adapter.rooms.get(roomName);
  if (!clients) return;

  for (const clientId of clients) {
    if (clientId === disconnectedSocket.id) continue;

    const remainingSocket = io.sockets.sockets.get(clientId);
    if (remainingSocket) {
      remainingSocket.data.roomName = null;
      remainingSocket.data.partnerId = null;
      remainingSocket.emit('chat_ended', { reason: 'partner_disconnected' });
    }
  }
}

io.on('connection', (socket) => {
  console.log('مستخدم متصل:', socket.id);

  socket.data.roomName = null;
  socket.data.partnerId = null;

  // البحث عن شريك
  socket.on('find_partner', () => {
    // لو بالفعل داخل غرفة
    if (socket.data.roomName) {
      socket.emit('system_message', {
        text: 'أنت متصل بالفعل في دردشة.',
        time: Date.now()
      });
      return;
    }

    // إزالة المستخدم من قائمة الانتظار لو كان موجودًا بالفعل
    removeFromQueue(socket);

    // محاولة إيجاد مستخدم منتظر
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

      io.to(room).emit('matched', {
        room,
        time: Date.now()
      });

      io.to(room).emit('system_message', {
        text: 'تم الاتصال، قل مرحبا 👋',
        time: Date.now()
      });

      return;
    }

    // لو مفيش شريك متاح، يدخل قائمة الانتظار
    waitingQueue.push(socket);
    socket.emit('searching', { time: Date.now() });
  });

  // استقبال رسالة
  socket.on('message', (msg) => {
    if (typeof msg !== 'string') return;

    const text = msg.trim().slice(0, 1000);
    if (!text) return;
    if (!socket.data.roomName) return;

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
    }

    console.log('مستخدم قطع الاتصال:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
