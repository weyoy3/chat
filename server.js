const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let waitingUser = null;

io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    socket.on('find_partner', () => {
        if (waitingUser && waitingUser.id !== socket.id) {
            // ربط المستخدمين ببعضهما في غرفة واحدة
            const room = 'room_' + socket.id + '_' + waitingUser.id;
            socket.join(room);
            waitingUser.join(room);

            io.to(room).emit('matched');
            
            socket.room = room;
            waitingUser.room = room;
            
            waitingUser = null;
        } else {
            waitingUser = socket;
            socket.emit('waiting');
        }
    });

    socket.on('message', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('message', data);
        }
    });

    socket.on('disconnect', () => {
        if (waitingUser === socket) {
            waitingUser = null;
        }
        if (socket.room) {
            socket.to(socket.room).emit('partner_disconnected');
        }
        console.log('User disconnected: ' + socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
