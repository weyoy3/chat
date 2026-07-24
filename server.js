/**
 * ==========================================================
 * Chat Masr Server v3.0
 * Backend:
 * Node.js
 * Express
 * Socket.IO
 * MongoDB
 * ==========================================================
 */

require("dotenv").config();

/* ==========================================================
   Packages
========================================================== */

const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const socketio = require("socket.io");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const bcrypt = require("bcrypt");
const multer = require("multer");

/* ==========================================================
   Models
========================================================== */

const User = require("./models/User");
const Message = require("./models/Message");
const PrivateMessage = require("./models/PrivateMessage");

/* ==========================================================
   App
========================================================== */

const app = express();

const server = http.createServer(app);

const io = socketio(server, {

    cors: {

        origin: "*",

        methods: ["GET","POST"]

    }

});

const PORT = process.env.PORT || 3000;

/* ==========================================================
   MongoDB
========================================================== */

mongoose.connect(

    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/chat_masr",

    {

        autoIndex: true

    }

)

.then(() => {

    console.log("=================================");
    console.log("MongoDB Connected");
    console.log("=================================");

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

    extended:true

}));

app.use(session({

    secret:
        process.env.SESSION_SECRET ||
        "chat-masr-secret",

    resave:false,

    saveUninitialized:false,

    cookie:{

        maxAge:
            1000 * 60 * 60 * 24

    }

}));

/* ==========================================================
   Static Files
========================================================== */

app.use(

    express.static(

        path.join(
            __dirname,
            "public"
        )

    )

);

/* ==========================================================
   Uploads
========================================================== */

const storage = multer.diskStorage({

    destination:(req,file,cb)=>{

        cb(

            null,

            path.join(

                __dirname,

                "public",

                "uploads"

            )

        );

    },

    filename:(req,file,cb)=>{

        const uniqueName =

            Date.now() +

            "-" +

            Math.random()

            .toString(36)

            .substring(2)

            +

            path.extname(file.originalname);

        cb(

            null,

            uniqueName

        );

    }

});

const upload = multer({

    storage

});

/* ==========================================================
   Runtime Memory
========================================================== */

let onlineUsers = [];
/* ==========================================================
   Routes
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

app.get("/chat", (req, res) => {

    res.sendFile(

        path.join(

            __dirname,

            "public",

            "chat.html"

        )

    );

});

/* ==========================================================
   Register API
========================================================== */

app.post("/api/register", async (req, res) => {

    try {

        const {

            username,

            email,

            password,

            age,

            gender

        } = req.body;

        if (

            !username ||

            !email ||

            !password ||

            !age ||

            !gender

        ) {

            return res.status(400).json({

                success:false,

                message:"جميع الحقول مطلوبة"

            });

        }

        const exists = await User.findOne({

            $or:[

                {

                    username

                },

                {

                    email

                }

            ]

        });

        if(exists){

            return res.status(409).json({

                success:false,

                message:"اسم المستخدم أو البريد مستخدم بالفعل"

            });

        }

        const hashedPassword =

            await bcrypt.hash(

                password,

                10

            );

        const user = await User.create({

            username,

            email,

            password:hashedPassword,

            age,

            gender,

            memberType:"عضو"

        });

        res.json({

            success:true,

            userId:user._id,

            username:user.username

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({

            success:false,

            message:"حدث خطأ أثناء التسجيل"

        });

    }

});

/* ==========================================================
   Login API
========================================================== */

app.post("/api/login", async (req,res)=>{

    try{

        const{

            email,

            password

        }=req.body;

        const user=

        await User.findOne({

            email

        });

        if(!user){

            return res.status(404).json({

                success:false,

                message:"الحساب غير موجود"

            });

        }

        const match=

        await bcrypt.compare(

            password,

            user.password

        );

        if(!match){

            return res.status(401).json({

                success:false,

                message:"كلمة المرور غير صحيحة"

            });

        }

        req.session.userId=

            user._id;

        req.session.username=

            user.username;

        res.json({

            success:true,

            user:{

                id:user._id,

                username:user.username,

                avatar:user.avatar,

                memberType:user.memberType,

                age:user.age,

                gender:user.gender

            }

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({

            success:false,

            message:"حدث خطأ أثناء تسجيل الدخول"

        });

    }

});

/* ==========================================================
   Upload Avatar
========================================================== */

app.post(

    "/api/upload/avatar",

    upload.single("avatar"),

    (req,res)=>{

        if(!req.file){

            return res.status(400).json({

                success:false,

                message:"لم يتم اختيار صورة"

            });

        }

        res.json({

            success:true,

            path:

            "uploads/"+

            req.file.filename

        });

    }

);

/* ==========================================================
   Socket.IO
========================================================== */

io.on("connection",(socket)=>{

    console.log(

        "Connected:",

        socket.id

    );
        /* ==========================================================
       Join Room
    ========================================================== */

    socket.on("joinRoom", async (data) => {

        try {

            const exists = onlineUsers.find(
                u => u.socketId === socket.id
            );

            if (exists) return;

            const user = {

                socketId: socket.id,

                userId: data.userId || null,

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

            if (user.userId) {

                await User.findByIdAndUpdate(

                    user.userId,

                    {

                        isOnline: true,

                        lastSeen: new Date()

                    }

                );

            }

            socket.emit(
                "joinedSuccessfully",
                user
            );

            const lastMessages = await Message
                .find({
                    isDeleted: false
                })
                .sort({
                    createdAt: -1
                })
                .limit(100);

            socket.emit(
                "publicMessages",
                lastMessages.reverse()
            );

            io.emit(
                "onlineUsers",
                onlineUsers
            );

            io.emit(
                "systemMessage",
                {

                    id: Date.now(),

                    type: "join",

                    username: user.username,

                    memberType: user.memberType,

                    message:
                        `${user.username} انضم إلى الغرفة`,

                    createdAt: new Date()

                }

            );

            console.log(
                user.username,
                "Joined Chat"
            );

        }

        catch (err) {

            console.error(err);

        }

    });

    /* ==========================================================
       User Status
    ========================================================== */

    socket.on("updateStatus", async (status) => {

        const user = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!user) return;

        user.status = status;

        if (user.userId) {

            await User.findByIdAndUpdate(

                user.userId,

                {

                    status

                }

            );

        }

        io.emit(
            "onlineUsers",
            onlineUsers
        );

    });

    /* ==========================================================
       Typing
    ========================================================== */

    socket.on("typing", () => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        socket.broadcast.emit(
            "typing",
            {

                username:
                    sender.username

            }

        );

    });

    socket.on("stopTyping", () => {

        const sender = onlineUsers.find(
            u => u.socketId === socket.id
        );

        if (!sender) return;

        socket.broadcast.emit(
            "stopTyping",
            {

                username:
                    sender.username

            }

        );

    });
        /* ==========================================================
       Public Messages
    ========================================================== */

    socket.on("publicMessage", async (text) => {

        try {

            const sender = onlineUsers.find(
                u => u.socketId === socket.id
            );

            if (!sender) return;

            if (!text || text.trim() === "") return;

            const savedMessage = await Message.create({

                senderId: sender.userId,

                username: sender.username,

                avatar: sender.avatar,

                memberType: sender.memberType,

                text: text.trim(),

                room: "general",

                messageType: "text"

            });

            io.emit(
                "publicMessage",
                savedMessage
            );

        }

        catch (err) {

            console.error(err);

        }

    });

    /* ==========================================================
       Delete Public Message
    ========================================================== */

    socket.on("deletePublicMessage", async (messageId) => {

        try {

            await Message.findByIdAndUpdate(

                messageId,

                {

                    isDeleted: true,

                    deletedAt: new Date()

                }

            );

            io.emit(

                "deletePublicMessage",

                messageId

            );

        }

        catch (err) {

            console.error(err);

        }

    });

    /* ==========================================================
       Load Old Messages
    ========================================================== */

    socket.on("loadMessages", async () => {

        try {

            const messages = await Message

                .find({

                    isDeleted: false

                })

                .sort({

                    createdAt: -1

                })

                .limit(100);

            socket.emit(

                "publicMessages",

                messages.reverse()

            );

        }

        catch (err) {

            console.error(err);

        }

    });
        /* ==========================================================
       Private Text Message
    ========================================================== */

    socket.on("privateMessage", async (data) => {

        try {

            const sender = onlineUsers.find(
                u => u.socketId === socket.id
            );

            if (!sender) return;

            const receiver = onlineUsers.find(
                u => u.socketId === data.to
            );

            if (!receiver) return;

            const savedMessage = await PrivateMessage.create({

                senderId: sender.userId,

                receiverId: receiver.userId,

                senderUsername: sender.username,

                receiverUsername: receiver.username,

                senderAvatar: sender.avatar,

                type: "text",

                text: data.text,

                delivered: true,

                seen: false

            });

            io.to(receiver.socketId).emit(
                "privateMessage",
                savedMessage
            );

            socket.emit(
                "privateMessage",
                savedMessage
            );

        }

        catch(err){

            console.error(err);

        }

    });

    /* ==========================================================
       Private Image
    ========================================================== */

    socket.on("privateImage", async (data)=>{

        try{

            const sender = onlineUsers.find(
                u=>u.socketId===socket.id
            );

            if(!sender) return;

            const receiver = onlineUsers.find(
                u=>u.socketId===data.to
            );

            if(!receiver) return;

            const savedMessage =
            await PrivateMessage.create({

                senderId:sender.userId,

                receiverId:receiver.userId,

                senderUsername:sender.username,

                receiverUsername:receiver.username,

                senderAvatar:sender.avatar,

                type:"image",

                file:data.image,

                delivered:true,

                seen:false

            });

            io.to(receiver.socketId)
            .emit("privateImage",savedMessage);

            socket.emit(
                "privateImage",
                savedMessage
            );

        }

        catch(err){

            console.error(err);

        }

    });

    /* ==========================================================
       Private Video
    ========================================================== */

    socket.on("privateVideo", async (data)=>{

        try{

            const sender = onlineUsers.find(
                u=>u.socketId===socket.id
            );

            if(!sender) return;

            const receiver = onlineUsers.find(
                u=>u.socketId===data.to
            );

            if(!receiver) return;

            const savedMessage =
            await PrivateMessage.create({

                senderId:sender.userId,

                receiverId:receiver.userId,

                senderUsername:sender.username,

                receiverUsername:receiver.username,

                senderAvatar:sender.avatar,

                type:"video",

                file:data.video,

                delivered:true,

                seen:false

            });

            io.to(receiver.socketId)
            .emit("privateVideo",savedMessage);

            socket.emit(
                "privateVideo",
                savedMessage
            );

        }

        catch(err){

            console.error(err);

        }

    });

    /* ==========================================================
       Private Voice
    ========================================================== */

    socket.on("privateVoice", async (data)=>{

        try{

            const sender = onlineUsers.find(
                u=>u.socketId===socket.id
            );

            if(!sender) return;

            const receiver = onlineUsers.find(
                u=>u.socketId===data.to
            );

            if(!receiver) return;

            const savedMessage =
            await PrivateMessage.create({

                senderId:sender.userId,

                receiverId:receiver.userId,

                senderUsername:sender.username,

                receiverUsername:receiver.username,

                senderAvatar:sender.avatar,

                type:"voice",

                file:data.voice,

                duration:data.duration,

                delivered:true,

                seen:false

            });

            io.to(receiver.socketId)
            .emit("privateVoice",savedMessage);

            socket.emit(
                "privateVoice",
                savedMessage
            );

        }

        catch(err){

            console.error(err);

        }

    });
        /* ==========================================================
       Message Seen
    ========================================================== */

    socket.on("messageSeen", async (messageId) => {

        try {

            await PrivateMessage.findByIdAndUpdate(

                messageId,

                {

                    seen: true,

                    seenAt: new Date()

                }

            );

            io.emit(

                "messageSeen",

                messageId

            );

        }

        catch (err) {

            console.error(err);

        }

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
       Statistics
    ========================================================== */

    socket.on("getStatistics", async () => {

        try {

            const members =
                await User.countDocuments();

            const messages =
                await Message.countDocuments({

                    isDeleted:false

                });

            const privateCount =
                await PrivateMessage.countDocuments({

                    isDeleted:false

                });

            socket.emit(

                "statistics",

                {

                    online:
                        onlineUsers.length,

                    members,

                    publicMessages:
                        messages,

                    privateMessages:
                        privateCount,

                    uptime:
                        process.uptime()

                }

            );

        }

        catch(err){

            console.error(err);

        }

    });

    /* ==========================================================
       Disconnect
    ========================================================== */

    socket.on("disconnect", async () => {

        const user = onlineUsers.find(

            u => u.socketId === socket.id

        );

        if(user){

            if(user.userId){

                await User.findByIdAndUpdate(

                    user.userId,

                    {

                        isOnline:false,

                        lastSeen:new Date()

                    }

                );

            }

            io.emit(

                "systemMessage",

                {

                    id:Date.now(),

                    type:"leave",

                    username:user.username,

                    memberType:user.memberType,

                    message:
                        `${user.username} غادر الغرفة`,

                    createdAt:new Date()

                }

            );

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
   404 Handler
========================================================== */

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message: "404 - Page Not Found"

    });

});

/* ==========================================================
   Graceful Shutdown
========================================================== */

process.on("SIGINT", async () => {

    console.log("");
    console.log("Closing Chat Masr Server...");

    try {

        await mongoose.connection.close();

        console.log("MongoDB Disconnected");

        process.exit(0);

    }

    catch (err) {

        console.error(err);

        process.exit(1);

    }

});

/* ==========================================================
   Server Start
========================================================== */

server.listen(PORT, () => {

    console.log("");
    console.log("========================================");
    console.log("        CHAT MASR SERVER v3");
    console.log("========================================");
    console.log(`Server Running : http://localhost:${PORT}`);
    console.log(`Port           : ${PORT}`);
    console.log("Database       : MongoDB");
    console.log("Socket.IO      : Ready");
    console.log("Status         : Online");
    console.log("========================================");
    console.log("");

});
