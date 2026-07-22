const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// الاتصال بقاعدة البيانات MongoDB (اختياري محلياً، أساسي للإنتاج)
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/arabic_chat', {
            serverSelectionTimeoutMS: 5000
        });
        console.log('تم الاتصال بقاعدة البيانات بنجاح.');
    } catch (err) {
        console.log('تحذير: يعمل السيرفر بدون قاعدة بيانات حالياً (In-Memory Mode).');
    }
};
connectDB();

// إرسال نظام الـ Sockets للتحكم الكامل
require('./sockets/socketmanager')(io);

const PORT = process.env.PORT || 3000;
server.launch = server.listen(PORT, () => {
    console.log(`السيرفر العالمي يعمل بكفاءة على البورت: ${PORT}`);
});
