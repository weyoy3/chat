const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

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

            io.to(room).emit('matched'); // إخبار الطرفين أنه تم الاتصال بشخص حقيقي
            socket.roomName = room;
            partner.roomName = room;
        } else {
            waitingUser = socket;
        }
    });

    socket.on('message', (msg) => {
        if (socket.roomName) {
            socket.to(socket.roomName).emit('message', msg);
        }
    });

    socket.on('disconnect', () => {
        if (waitingUser === socket) {
            waitingUser = null;
        }
        if (socket.roomName) {
            socket.to(socket.roomName).emit('partner_disconnected');
        }
        console.log('مستخدم غادر:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
});
