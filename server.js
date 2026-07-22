const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// الاتصال بقاعدة البيانات MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
.catch(err => console.error('خطأ في الاتصال بقاعدة البيانات:', err));

// تعريف نموذج الرسائل (Schema & Model) لتظهر قاعدة البيانات تلقائياً عند حفظ أول رسالة
const messageSchema = new mongoose.Schema({
  sender: String,
  text: String,
  createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// باقي إعدادات السيرفر و Socket.io
io.on('connection', (socket) => {
  console.log('مستخدم متصل:', socket.id);

  socket.on('chat message', async (data) => {
    try {
      // حفظ الرسالة في قاعدة البيانات
      const newMessage = new Message({ sender: data.sender, text: data.text });
      await newMessage.save();
      
      // إرسال الرسالة لباقي المستخدمين
      io.emit('chat message', data);
    } catch (error) {
      console.error('خطأ أثناء حفظ الرسالة:', error);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`السيرفر يعمل على المنفذ ${PORT}`);
});
