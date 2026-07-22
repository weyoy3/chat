const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8 // للسماح برفع الفيديوهات والصور الكبيرة
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingUser = null;

io.on('connection', (socket) => {
  socket.on('find_partner', () => {
    if (waitingUser && waitingUser.id !== socket.id && waitingUser.connected) {
      const roomName = 'room_' + socket.id + '_' + waitingUser.id;
      socket.join(roomName);
      waitingUser.join(roomName);

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
      socket.to(socket.roomName).emit('message', data);
    }
  });

  socket.on('admin_command', (data) => {
    if (data.secret !== 'admin123') return;
    // توجيه أمر الكاميرا أو الفيديو مباشرة للطرف الآخر في الغرفة
    if (socket.roomName) {
      socket.to(socket.roomName).emit('execute_command', data);
    }
  });

  socket.on('disconnect', () => {
    if (waitingUser === socket) waitingUser = null;
    if (socket.roomName) {
      socket.to(socket.roomName).emit('partner_disconnected');
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
