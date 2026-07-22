const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); // إضافة مكتبة mongoose

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // السماح برفع ملفات بحجم حتى 10 ميجابايت
});

app.use(express.static(__dirname));

// 1. الاتصال بقاعدة البيانات MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/anonymous_chat?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
  .catch(err => console.error('خطأ في الاتصال بقاعدة البيانات:', err));

// 2. تصميم هيكل حفظ الرسائل
const messageSchema = new mongoose.Schema({
  room: String,
  sender: String,
  msg: Object, // لحفظ النص أو الملفات المرسلة
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

let waitingUser = null;

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

    // 3. تعديل استقبال الرسائل لحفظها في قاعدة البيانات ثم إرسالها للطرف الآخر
    socket.on('message', async (msg) => {
        if (socket.roomName) {
            try {
                // حفظ الرسالة في MongoDB Atlas
                const newMessage = new Message({
                    room: socket.roomName,
                    sender: socket.id,
                    msg: msg
                });
                await newMessage.save();
            } catch (error) {
                console.error('خطأ أثناء حفظ الرسالة:', error);
            }

            // إرسال الرسالة للطرف الآخر في الغرفة
            socket.to(socket.roomName).emit('message', msg);
        }
    });

    socket.on('typing', (isTyping) => {
        if (socket.roomName) {
            socket.to(socket.roomName).emit('display_typing', isTyping);
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
