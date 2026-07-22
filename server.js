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

    if (waitingUser) {
        const partner = waitingUser;
        waitingUser = null;

        partner.partnerId = socket.id;
        socket.partnerId = partner.id;

        partner.join('room-' + socket.id);
        socket.join('room-' + socket.id);

        io.to('room-' + socket.id).emit('connected');
    } else {
        waitingUser = socket;
    }

    socket.on('message', (msg) => {
        if (socket.partnerId) {
            const roomId = 'room-' + (socket.id > socket.partnerId ? socket.id : socket.partnerId);
            socket.broadcast.to(roomId).emit('message', msg);
        }
    });

    socket.on('disconnect', () => {
        if (waitingUser === socket) {
            waitingUser = null;
        }
        if (socket.partnerId) {
            const roomId = 'room-' + (socket.id > socket.partnerId ? socket.id : socket.partnerId);
            io.to(roomId).emit('partner_disconnected');
        }
        console.log('مستخدم غادر:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
});
