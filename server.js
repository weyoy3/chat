/**
 * ==========================================================
 * Chat Masr Server v2.0
 * Backend : Node.js + Express + Socket.IO + MongoDB
 * ==========================================================
 */

require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const socketio = require("socket.io");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const app = express();

const server = http.createServer(app);

const io = socketio(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

/* ==========================================================
   MongoDB
========================================================== */

mongoose.connect(
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/chat_masr"
)
.then(() => {

    console.log("MongoDB Connected");

})
.catch((err) => {

    console.error(err);

});

/* ==========================================================
   Middlewares
========================================================== */

app.use(cors());

app.use(cookieParser());

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(session({

    secret: "chat-masr-secret",

    resave: false,

    saveUninitialized: false,

    cookie: {

        maxAge: 1000 * 60 * 60 * 24

    }

}));

/* ==========================================================
   Static Files
========================================================== */

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

/* ==========================================================
   Home
========================================================== */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});

/* ==========================================================
   Temporary Memory
========================================================== */

let onlineUsers = [];

let publicMessages = [];

let privateMessages = [];

/* ==========================================================
   Socket.IO
========================================================== */

io.on("connection", (socket) => {

    console.log(
        "User Connected:",
        socket.id
    );
        /* ==========================================================
       Register Member
    ========================================================== */

    socket.on("registerUser", (data) => {

        const exists = onlineUsers.find(
            u => u.username === data.username
        );

        if (exists) {

            socket.emit("registerError",
                "اسم المستخدم مستخدم بالفعل");

            return;

        }

        socket.emit("registerSuccess");

    });

    /* ==========================================================
       Login Member
    ========================================================== */

    socket.on("loginUser", (data) => {

        socket.emit("loginSuccess", {

            username: data.username,

            avatar: "avatars/default.png"

        });

    });

    /* ==========================================================
       Join Chat
    ========================================================== */

    socket.on("joinRoom", (data) => {

        const oldUser = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (oldUser) return;

        const user = {

            socketId: socket.id,

            username: data.username,

            age: data.age,

            gender: data.gender,

            memberType: data.memberType,

            avatar:
                data.avatar ||
                "avatars/default.png",

            status: "online",

            joinedAt: new Date()

        };

        onlineUsers.push(user);

        socket.emit(
            "joinedSuccessfully",
            user
        );

        socket.emit(
            "publicMessages",
            publicMessages
        );

        io.emit(
            "onlineUsers",
            onlineUsers
        );

        io.emit("systemMessage", {

            id: Date.now(),

            type: "join",

            username: user.username,

            memberType: user.memberType,

            message:
                `${user.username} انضم إلى الغرفة`,

            time: new Date()

        });

        console.log(
            user.username,
            "Joined"
        );

    });

    /* ==========================================================
       Public Message
    ========================================================== */

    socket.on("publicMessage", (text) => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        const message = {

            id: Date.now(),

            username: sender.username,

            avatar: sender.avatar,

            memberType: sender.memberType,

            text,

            createdAt: new Date()

        };

        publicMessages.push(message);

        io.emit(
            "publicMessage",
            message
        );

    });
        /* ==========================================================
       Private Text Message
    ========================================================== */

    socket.on("privateMessage", (data) => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        const receiver = onlineUsers.find(
            u => u.socketId === data.to
        );

        if (!receiver) return;

        const message = {

            id: Date.now(),

            from: sender.socketId,

            to: receiver.socketId,

            senderName: sender.username,

            receiverName: receiver.username,

            avatar: sender.avatar,

            type: "text",

            text: data.text,

            createdAt: new Date(),

            seen: false

        };

        privateMessages.push(message);

        io.to(receiver.socketId)
        .emit("privateMessage", message);

        socket.emit(
            "privateMessage",
            message
        );

    });

    /* ==========================================================
       Private Image
    ========================================================== */

    socket.on("privateImage", (data) => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        const message = {

            id: Date.now(),

            from: sender.socketId,

            to: data.to,

            senderName: sender.username,

            avatar: sender.avatar,

            type: "image",

            image: data.image,

            createdAt: new Date()

        };

        privateMessages.push(message);

        io.to(data.to)
        .emit("privateImage", message);

        socket.emit(
            "privateImage",
            message
        );

    });

    /* ==========================================================
       Private Video
    ========================================================== */

    socket.on("privateVideo", (data) => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        const message = {

            id: Date.now(),

            from: sender.socketId,

            to: data.to,

            senderName: sender.username,

            avatar: sender.avatar,

            type: "video",

            video: data.video,

            createdAt: new Date()

        };

        privateMessages.push(message);

        io.to(data.to)
        .emit("privateVideo", message);

        socket.emit(
            "privateVideo",
            message
        );

    });

    /* ==========================================================
       Private Voice
    ========================================================== */

    socket.on("privateVoice", (data) => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        const message = {

            id: Date.now(),

            from: sender.socketId,

            to: data.to,

            senderName: sender.username,

            avatar: sender.avatar,

            type: "voice",

            voice: data.voice,

            duration: data.duration,

            createdAt: new Date()

        };

        privateMessages.push(message);

        io.to(data.to)
        .emit("privateVoice", message);

        socket.emit(
            "privateVoice",
            message
        );

    });

    /* ==========================================================
       Message Seen
    ========================================================== */

    socket.on("messageSeen", (messageId) => {

        const message = privateMessages.find(
            m => m.id === messageId
        );

        if (!message) return;

        message.seen = true;

        io.to(message.from)
        .emit("messageSeen", messageId);

    });

    /* ==========================================================
       Update Status
    ========================================================== */

    socket.on("updateStatus", (status) => {

        const user = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!user) return;

        user.status = status;

        io.emit(
            "onlineUsers",
            onlineUsers
        );

    });
        /* ==========================================================
       Server Statistics
    ========================================================== */

    socket.on("getStatistics", () => {

        socket.emit("statistics", {

            online: onlineUsers.length,

            publicMessages: publicMessages.length,

            privateMessages: privateMessages.length,

            uptime: process.uptime()

        });

    });

    /* ==========================================================
       Delete Public Message (Admin)
    ========================================================== */

    socket.on("deletePublicMessage", (messageId) => {

        publicMessages = publicMessages.filter(
            m => m.id !== messageId
        );

        io.emit(
            "publicMessages",
            publicMessages
        );

    });

    /* ==========================================================
       Kick User
    ========================================================== */

    socket.on("kickUser", (socketId) => {

        io.to(socketId).emit("kicked");

        io.sockets.sockets
            .get(socketId)
            ?.disconnect(true);

    });

    /* ==========================================================
       Mute User
    ========================================================== */

    socket.on("muteUser", (data) => {

        io.to(data.socketId).emit("muted", {

            minutes: data.minutes

        });

    });

    /* ==========================================================
       Ban User
    ========================================================== */

    socket.on("banUser", (socketId) => {

        io.to(socketId).emit("banned");

        io.sockets.sockets
            .get(socketId)
            ?.disconnect(true);

    });

    /* ==========================================================
       Disconnect
    ========================================================== */

    socket.on("disconnect", () => {

        const user = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (user) {

            io.emit("systemMessage", {

                id: Date.now(),

                type: "leave",

                username: user.username,

                memberType: user.memberType,

                message:
                    `${user.username} غادر الغرفة`,

                time: new Date()

            });

        }

        onlineUsers = onlineUsers.filter(
            u => u.socketId !== socket.id
        );

        io.emit(
            "onlineUsers",
            onlineUsers
        );

        console.log(
            socket.id,
            "Disconnected"
        );

    });

});

/* ==========================================================
   Error Handler
========================================================== */

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({

        success: false,

        message: "Internal Server Error"

    });

});

/* ==========================================================
   404
========================================================== */

app.use((req, res) => {

    res.status(404).send("404 Not Found");

});

/* ==========================================================
   Start Server
========================================================== */

server.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("        CHAT MASR SERVER");
    console.log("======================================");
    console.log(`Server : http://localhost:${PORT}`);
    console.log("MongoDB : Connected");
    console.log("Socket.IO : Running");
    console.log("======================================");
    console.log("");

});
