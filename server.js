const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم الملفات الثابتة من مجلد المشروع الحالي
app.use(express.static(path.join(__dirname)));

// طوابير الانتظار والغرف النشطة
let waitingUser = null;
const rooms = new Map(); // لتخزين معلومات الغرف

io.on('connection', (socket) => {
    console.log(`مستخدم متصل: ${socket.id}`);

    // استقبال حدث بدء البحث عن شريك
    socket.on('find_partner', (data) => {
        socket.username = data.username || 'زائر';

        if (waitingUser && waitingUser.id !== socket.id) {
            // وجدنا مستخدماً منتظراً، نقوم بربطهما في غرفة واحدة
            const roomName = `room_${socket.id}_${waitingUser.id}`;
            
            socket.join(roomName);
            waitingUser.join(roomName);

            rooms.set(socket.id, roomName);
            rooms.set(waitingUser.id, roomName);

            // إرسال إشعار للطرفين بأن الاتصال تم
            io.to(roomName).emit('partner_found', {
                message: 'تم الاتصال بشخص عشوائي، ابدأ الحديث الآن!'
            });

            console.log(`تم ربط المستخدمين في الغرفة: ${roomName}`);
            waitingUser = null; // إعادة تعيين الطابور
        } else {
            // لا يوجد مستخدمون متاحون، نضع هذا المستخدم في الانتظار
            waitingUser = socket;
            socket.emit('waiting', { message: 'جاري البحث عن شخص متصل...' });
            console.log(`المستخدم ${socket.username} في الانتظار...`);
        }
    });

    // استقبال الرسائل وإرسالها للطرف الآخر في نفس الغرفة
    socket.on('send_message', (data) => {
        const roomName = rooms.get(socket.id);
        if (roomName) {
            socket.to(roomName).emit('receive_message', {
                sender: socket.username,
                message: data.message
            });
        }
    });

    // التعامل مع قطع الاتصال أو خروج المستخدم
    socket.on('disconnect', () => {
        console.log(`مستخدم غادر: ${socket.id}`);
        
        if (waitingUser && waitingUser.id === socket.id) {
            waitingUser = null;
        }

        const roomName = rooms.get(socket.id);
        if (roomName) {
            // إعلام الطرف الآخر بانقطاع الاتصال
            socket.to(roomName).emit('partner_disconnected', {
                message: 'انقطع الاتصال مع الطرف الآخر.'
            });

            // تنظيف الغرفة
            rooms.delete(socket.id);
            // البحث عن الشريك الآخر وحذف غرفته أيضاً
            for (let [userId, r] of rooms.entries()) {
                if (r === roomName) {
                    rooms.delete(userId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل بنجاح على الرابط: http://localhost:${PORT}`);
});
