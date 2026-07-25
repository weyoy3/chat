/* ==========================================================
   Chat Masr v3
   chat.js
========================================================== */

/* ==========================================================
   Socket.IO
========================================================== */

const socket = io();

/* ==========================================================
   Current User
========================================================== */

const currentUser = {

    userId:
        localStorage.getItem("userId"),

    username:
        localStorage.getItem("username"),

    memberType:
        localStorage.getItem("memberType") || "زائر",

    avatar:
        localStorage.getItem("avatar") ||
        "avatars/default.png",

    age:
        localStorage.getItem("age") || "",

    gender:
        localStorage.getItem("gender") || ""

};

/* ==========================================================
   Check Login
========================================================== */

if (!currentUser.username) {

    window.location.href = "index.html";

}

/* ==========================================================
   Join Room
========================================================== */

socket.emit("joinRoom", {

    userId:
        currentUser.userId,

    username:
        currentUser.username,

    memberType:
        currentUser.memberType,

    avatar:
        currentUser.avatar,

    age:
        currentUser.age,

    gender:
        currentUser.gender

});

/* ==========================================================
   DOM Elements
========================================================== */

const usersList =
    document.getElementById("usersList");

const messagesBox =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendBtn =
    document.getElementById("sendBtn");

const privateWindow =
    document.getElementById("privateChatWindow");

const privateMessages =
    document.getElementById("privateMessages");

const privateInput =
    document.getElementById("privateInput");

const privateSend =
    document.getElementById("privateSend");

/* ==========================================================
   Current Selected User
========================================================== */

let selectedUser = null;

let typingTimeout = null;

/* ==========================================================
   Connected
========================================================== */

socket.on(

    "connect",

    () => {

        console.log(

            "Socket Connected:",

            socket.id

        );

    }

);

/* ==========================================================
   Joined Successfully
========================================================== */

socket.on(

    "joinedSuccessfully",

    (user) => {

        console.log(

            "Welcome",

            user.username

        );

        socket.emit(

            "loadMessages"

        );

    }

);
/* ==========================================================
   Send Public Message
========================================================== */

sendBtn.onclick = sendPublicMessage;

messageInput.addEventListener("keydown", (e) => {

    if (e.key === "Enter") {

        sendPublicMessage();

    }

});

function sendPublicMessage() {

    const text = messageInput.value.trim();

    if (!text) return;

    socket.emit("publicMessage", text);

    messageInput.value = "";

    socket.emit("stopTyping");

}

/* ==========================================================
   Typing
========================================================== */

messageInput.addEventListener("input", () => {

    socket.emit("typing");

    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {

        socket.emit("stopTyping");

    }, 1000);

});

socket.on("typing", (data) => {

    const typingBox = document.getElementById("typingBox");

    if (!typingBox) return;

    typingBox.innerText =
        `${data.username} يكتب...`;

});

socket.on("stopTyping", () => {

    const typingBox = document.getElementById("typingBox");

    if (!typingBox) return;

    typingBox.innerText = "";

});

/* ==========================================================
   Public Messages
========================================================== */

socket.on("publicMessages", (list) => {

    messagesBox.innerHTML = "";

    list.forEach(addPublicMessage);

});

socket.on("publicMessage", (message) => {

    addPublicMessage(message);

});

/* ==========================================================
   System Messages
========================================================== */

socket.on("systemMessage", (msg) => {

    const div = document.createElement("div");

    div.className = "systemMessage";

    div.textContent = msg.message;

    messagesBox.appendChild(div);

    messagesBox.scrollTop =
        messagesBox.scrollHeight;

});

/* ==========================================================
   Draw Public Message
========================================================== */

function addPublicMessage(message) {

    const div = document.createElement("div");

    div.className = "message";

    div.innerHTML = `

        <img
            src="${message.avatar}"
            class="messageAvatar">

        <div class="messageContent">

            <div class="messageHeader">

                <span class="messageName">

                    ${message.username}

                </span>

                <span class="memberType">

                    ${message.memberType || ""}

                </span>

            </div>

            <div class="messageText">

                ${message.text}

            </div>

        </div>

    `;

    div.querySelector(".messageAvatar")
        .onclick = () => {

        openUserMenuByName(
            message.username
        );

    };

    messagesBox.appendChild(div);

    messagesBox.scrollTop =
        messagesBox.scrollHeight;

}
/* ==========================================================
   Online Users
========================================================== */

socket.on("onlineUsers", (users) => {

    usersList.innerHTML = "";

    users.forEach((user) => {

        const card = document.createElement("div");

        card.className = "user";

        card.dataset.socket = user.socketId;

        card.innerHTML = `

            <img
                src="${user.avatar}"
                class="userAvatar">

            <div class="userInfo">

                <div class="userName">

                    ${user.username}

                </div>

                <div class="userStatus">

                    ${user.status || "online"}

                </div>

            </div>

        `;

        card.onclick = () => {

            openUserMenu(user);

        };

        usersList.appendChild(card);

    });

});

/* ==========================================================
   User Menu
========================================================== */

function openUserMenu(user) {

    selectedUser = user;

    document.getElementById("menuAvatar").src =
        user.avatar;

    document.getElementById("menuUsername").innerText =
        user.username;

    document.getElementById("userMenu").style.display =
        "flex";

}

function openUserMenuByName(name) {

    const users =
        document.querySelectorAll(".user");

    for (const user of users) {

        const username =
            user.querySelector(".userName").innerText;

        if (username === name) {

            user.click();

            break;

        }

    }

}

document.getElementById("closeUserMenu")
.onclick = () => {

    document.getElementById("userMenu")
        .style.display = "none";

};

/* ==========================================================
   View Profile
========================================================== */

document.getElementById("viewProfileBtn")
.onclick = () => {

    if (!selectedUser) return;

    document.getElementById("profileAvatar").src =
        selectedUser.avatar;

    document.getElementById("profileUsername").innerText =
        selectedUser.username;

    document.getElementById("profileAge").innerText =
        selectedUser.age || "-";

    document.getElementById("profileGender").innerText =
        selectedUser.gender || "-";

    document.getElementById("profileType").innerText =
        selectedUser.memberType || "عضو";

    document.getElementById("profileModal").style.display =
        "flex";

};

document.getElementById("closeProfile")
.onclick = () => {

    document.getElementById("profileModal").style.display =
        "none";

};
/* ==========================================================
   Private Chat
========================================================== */

document.getElementById("privateChatBtn").onclick = () => {

    if (!selectedUser) return;

    document.getElementById("privateAvatar").src =
        selectedUser.avatar;

    document.getElementById("privateUsername").innerText =
        selectedUser.username;

    privateMessages.innerHTML = "";

    privateWindow.style.display = "flex";

    document.getElementById("userMenu").style.display =
        "none";

};

document.getElementById("closePrivate").onclick = () => {

    privateWindow.style.display = "none";

};

/* ==========================================================
   Send Private Message
========================================================== */

privateSend.onclick = sendPrivateMessage;

privateInput.addEventListener("keydown", (e) => {

    if (e.key === "Enter") {

        sendPrivateMessage();

    }

});

function sendPrivateMessage() {

    if (!selectedUser) return;

    const text = privateInput.value.trim();

    if (!text) return;

    socket.emit("privateMessage", {

        to: selectedUser.socketId,

        text

    });

    privateInput.value = "";

}

/* ==========================================================
   Receive Private Message
========================================================== */

socket.on("privateMessage", (message) => {

    drawPrivateMessage(message);

});

/* ==========================================================
   Draw Private Message
========================================================== */

function drawPrivateMessage(message) {

    const div = document.createElement("div");

    const mine =
        message.senderName === currentUser.username;

    div.className =
        mine ?
        "privateMessage mine" :
        "privateMessage";

    div.innerHTML = `

        <div class="privateBubble">

            <div class="privateHeader">

                <span class="privateName">

                    ${message.senderName}

                </span>

            </div>

            <div class="privateText">

                ${message.text || ""}

            </div>

        </div>

    `;

    privateMessages.appendChild(div);

    privateMessages.scrollTop =
        privateMessages.scrollHeight;

    if (

        !mine &&

        message._id

    ) {

        socket.emit(

            "messageSeen",

            message._id

        );

    }

}

/* ==========================================================
   Seen
========================================================== */

socket.on("messageSeen", (messageId) => {

    console.log(

        "Seen:",

        messageId

    );

});
/* ==========================================================
   Private Images
========================================================== */

socket.on("privateImage", (message) => {

    drawPrivateFile(message);

});

/* ==========================================================
   Private Videos
========================================================== */

socket.on("privateVideo", (message) => {

    drawPrivateFile(message);

});

/* ==========================================================
   Private Voice
========================================================== */

socket.on("privateVoice", (message) => {

    drawPrivateFile(message);

});

/* ==========================================================
   Draw Files
========================================================== */

function drawPrivateFile(message){

    const div = document.createElement("div");

    const mine =
        message.senderName === currentUser.username;

    div.className =
        mine ?
        "privateMessage mine" :
        "privateMessage";

    let content = "";

    if(message.type === "image"){

        content = `

            <img
                src="${message.file || message.image}"
                class="privateImage">

        `;

    }

    if(message.type === "video"){

        content = `

            <video
                controls
                class="privateVideo">

                <source
                    src="${message.file || message.video}">

            </video>

        `;

    }

    if(message.type === "voice"){

        content = `

            <audio
                controls>

                <source
                    src="${message.file || message.voice}">

            </audio>

        `;

    }

    div.innerHTML = `

        <div class="privateBubble">

            <div class="privateHeader">

                <span class="privateName">

                    ${message.senderName}

                </span>

            </div>

            ${content}

        </div>

    `;

    privateMessages.appendChild(div);

    privateMessages.scrollTop =
        privateMessages.scrollHeight;

}

/* ==========================================================
   Upload Buttons
========================================================== */

const imageInput =
    document.getElementById("imageInput");

const videoInput =
    document.getElementById("videoInput");

const voiceInput =
    document.getElementById("voiceInput");

/* ==========================================================
   Image Upload
========================================================== */

imageInput?.addEventListener("change",(e)=>{

    const file = e.target.files[0];

    if(!file || !selectedUser) return;

    const reader = new FileReader();

    reader.onload = ()=>{

        socket.emit("privateImage",{

            to:selectedUser.socketId,

            image:reader.result

        });

    };

    reader.readAsDataURL(file);

});

/* ==========================================================
   Video Upload
========================================================== */

videoInput?.addEventListener("change",(e)=>{

    const file = e.target.files[0];

    if(!file || !selectedUser) return;

    const reader = new FileReader();

    reader.onload = ()=>{

        socket.emit("privateVideo",{

            to:selectedUser.socketId,

            video:reader.result

        });

    };

    reader.readAsDataURL(file);

});

/* ==========================================================
   Voice Upload
========================================================== */

voiceInput?.addEventListener("change",(e)=>{

    const file = e.target.files[0];

    if(!file || !selectedUser) return;

    const reader = new FileReader();

    reader.onload = ()=>{

        socket.emit("privateVoice",{

            to:selectedUser.socketId,

            voice:reader.result,

            duration:0

        });

    };

    reader.readAsDataURL(file);

});
/* ==========================================================
   Notifications
========================================================== */

socket.on("muted", (data) => {

    alert(

        `تم كتمك لمدة ${data.minutes} دقيقة`

    );

});

socket.on("kicked", () => {

    alert("تم طردك من الغرفة");

    window.location.href = "index.html";

});

socket.on("banned", () => {

    alert("تم حظرك من الموقع");

    localStorage.clear();

    window.location.href = "index.html";

});

/* ==========================================================
   Statistics
========================================================== */

socket.on("statistics", (stats) => {

    console.log("Statistics");

    console.table(stats);

});

/* ==========================================================
   Connection Status
========================================================== */

socket.on("disconnect", () => {

    console.log(

        "Server Disconnected"

    );

});

socket.on("reconnect", () => {

    console.log(

        "Reconnected"

    );

    socket.emit("joinRoom", {

        userId:
            currentUser.userId,

        username:
            currentUser.username,

        memberType:
            currentUser.memberType,

        avatar:
            currentUser.avatar,

        age:
            currentUser.age,

        gender:
            currentUser.gender

    });

});

/* ==========================================================
   Errors
========================================================== */

socket.on("connect_error", (err) => {

    console.error(

        "Connection Error",

        err

    );

});

window.addEventListener("error", (e) => {

    console.error(

        "Page Error",

        e.error

    );

});

/* ==========================================================
   Before Close
========================================================== */

window.addEventListener("beforeunload", () => {

    socket.disconnect();

});

/* ==========================================================
   Helper Functions
========================================================== */

function scrollBottom(container){

    container.scrollTop =
        container.scrollHeight;

}

function clearInput(input){

    input.value = "";

}

function createElement(tag,className){

    const element =
        document.createElement(tag);

    if(className){

        element.className =
            className;

    }

    return element;

}

console.log(

    "==================================="

);

console.log(

    "Chat Masr v3 Loaded Successfully"

);

console.log(

    "Socket:",

    socket.id

);

console.log(

    "==================================="

);
