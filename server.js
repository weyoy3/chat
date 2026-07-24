require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

let onlineUsers = [];

function getUser(socketId) {
    return onlineUsers.find(user => user.socketId === socketId);
}

function removeUser(socketId) {
    onlineUsers = onlineUsers.filter(user => user.socketId !== socketId);
}

io.on("connection", (socket) => {

    console.log("New Connection:", socket.id);

    socket.on("joinRoom", (user) => {

        const newUser = {
            socketId: socket.id,
            username: user.username,
            age: user.age,
            gender: user.gender,
            memberType: user.memberType,
            avatar: user.avatar
        };

        onlineUsers.push(newUser);

        io.emit("systemMessage", {
            text: `انضم للغرفة (# ${user.memberType} #)`
        });

        io.emit("onlineUsers", onlineUsers);

    });

    socket.on("sendMessage", (message) => {

        const sender = getUser(socket.id);

        if (!sender) return;

        io.emit("newMessage", {

            username: sender.username,

            avatar: sender.avatar,

            text: message,

            time: new Date().toLocaleTimeString("ar-EG")

        });

    });

    socket.on("disconnect", () => {

        const user = getUser(socket.id);

        if (user) {

            io.emit("systemMessage", {

                text: `${user.username} غادر الغرفة`

            });

        }

        removeUser(socket.id);

        io.emit("onlineUsers", onlineUsers);

        console.log("Disconnected:", socket.id);

    });

});

app.get("/", (req, res) => {

    res.sendFile(path.join(__dirname, "public", "index.html"));

});

server.listen(PORT, () => {

    console.log("");

    console.log("====================================");

    console.log("       Chat Masr Started");

    console.log("====================================");

    console.log(`Server Running : http://localhost:${PORT}`);

    console.log("");

});
