const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024 // السماح برفع ملفات بحجم حتى 10 ميجابايت
});

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

            io.to(room).emit('matched');
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
