/* ==========================================================
   Chat Masr
   chat.js v4
========================================================== */

const socket = io();

/* ==========================================================
   Current User
========================================================== */

const currentUser = {

    userId:
        localStorage.getItem("userId") || "",

    username:
        localStorage.getItem("username") || "زائر",

    memberType:
        localStorage.getItem("memberType") || "عضو",

    avatar:
        localStorage.getItem("avatar") ||
        "avatars/default.png",

    age:
        localStorage.getItem("age") || "",

    gender:
        localStorage.getItem("gender") || ""

};

/* ==========================================================
   Variables
========================================================== */

let selectedUser = null;

let typingTimeout = null;

/* ==========================================================
   Elements
========================================================== */

const usersList =
    document.getElementById("usersList");

const messagesBox =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendBtn =
    document.getElementById("sendBtn");

const typingBox =
    document.getElementById("typingBox");

const privateWindow =
    document.getElementById("privateChatWindow");

const privateMessages =
    document.getElementById("privateMessages");

const privateInput =
    document.getElementById("privateInput");

const privateSend =
    document.getElementById("privateSend");

/* ==========================================================
   Join Room
========================================================== */

socket.emit("joinRoom", {

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
   Connected
========================================================== */

socket.on("joinedSuccessfully", (user) => {

    console.log(

        "Welcome",

        user.username

    );

});
/* ==========================================================
   Send Public Message
========================================================== */

function sendPublicMessage() {

    const text = messageInput.value.trim();

    if (!text) return;

    socket.emit("publicMessage", text);

    messageInput.value = "";

    socket.emit("stopTyping");

}

sendBtn.onclick = sendPublicMessage;

messageInput.addEventListener("keydown", (e) => {

    if (e.key === "Enter") {

        sendPublicMessage();

    }

});

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

    typingBox.innerHTML =

        `${data.username} يكتب...`;

});

socket.on("stopTyping", () => {

    typingBox.innerHTML = "";

});

/* ==========================================================
   Public Messages
========================================================== */

socket.on("publicMessages", (list) => {

    messagesBox.innerHTML = "";

    list.forEach(drawPublicMessage);

});

socket.on("publicMessage", (message) => {

    drawPublicMessage(message);

});

/* ==========================================================
   System Messages
========================================================== */

socket.on("systemMessage", (msg) => {

    const div = document.createElement("div");

    div.className = "systemMessage";

    div.innerHTML = msg.message;

    messagesBox.appendChild(div);

    scrollBottom(messagesBox);

});

/* ==========================================================
   Draw Public Message
========================================================== */

function drawPublicMessage(message) {

    const div = document.createElement("div");

    div.className = "message";

    div.innerHTML = `

        <img

            src="${message.avatar}"

            class="messageAvatar"

            onclick="openUserMenuByName('${message.username}')">

        <div class="messageContent">

            <div class="messageHeader">

                <span class="messageName">

                    ${message.username}

                </span>

                <span class="messageType">

                    ${message.memberType || "عضو"}

                </span>

            </div>

            <div class="messageText">

                ${message.text}

            </div>

        </div>

    `;

    messagesBox.appendChild(div);

    scrollBottom(messagesBox);

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

                    ${user.status || "متصل"}

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
   Search User
========================================================== */

document.getElementById("searchUser")
.addEventListener("input", function () {

    const value =
        this.value.toLowerCase();

    document
    .querySelectorAll(".user")
    .forEach((user) => {

        const name = user
            .querySelector(".userName")
            .innerText
            .toLowerCase();

        user.style.display =
            name.includes(value)
            ? "flex"
            : "none";

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
            user.querySelector(".userName")
            .innerText;

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
   Profile
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

    document.getElementById("profileModal")
        .style.display = "flex";

};

document.getElementById("closeProfile")
.onclick = () => {

    document.getElementById("profileModal")
        .style.display = "none";

};
/* ==========================================================
   Open Private Chat
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

/* ==========================================================
   Close Private Chat
========================================================== */

document.getElementById("closePrivate").onclick = () => {

    privateWindow.style.display = "none";

};

/* ==========================================================
   Send Private Message
========================================================== */

function sendPrivateMessage() {

    if (!selectedUser) return;

    const text = privateInput.value.trim();

    if (!text) return;

    socket.emit("privateMessage", {

        to: selectedUser.socketId,

        text: text

    });

    privateInput.value = "";

}

privateSend.onclick = sendPrivateMessage;

privateInput.addEventListener("keydown", (e) => {

    if (e.key === "Enter") {

        sendPrivateMessage();

    }

});

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

                ${message.text}

            </div>

        </div>

    `;

    privateMessages.appendChild(div);

    scrollBottom(privateMessages);

    if (!mine) {

        socket.emit(
            "messageSeen",
            message.id
        );

    }

}

/* ==========================================================
   Message Seen
========================================================== */

socket.on("messageSeen", (messageId) => {

    console.log(

        "Message Seen:",

        messageId

    );

});
/* ==========================================================
   Private Images
========================================================== */

document.getElementById("sendImage").onclick = () => {

    document.getElementById("imageInput").click();

};

document.getElementById("imageInput")
.addEventListener("change", function () {

    if (!selectedUser) return;

    const file = this.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {

        socket.emit("privateImage", {

            to: selectedUser.socketId,

            image: reader.result

        });

    };

    reader.readAsDataURL(file);

    this.value = "";

});

socket.on("privateImage", (message) => {

    const div = document.createElement("div");

    div.className = "privateMessage";

    div.innerHTML = `

        <img

            src="${message.image}"

            class="privateImage">

    `;

    privateMessages.appendChild(div);

    scrollBottom(privateMessages);

});

/* ==========================================================
   Private Video
========================================================== */

document.getElementById("sendVideo").onclick = () => {

    document.getElementById("videoInput").click();

};

document.getElementById("videoInput")
.addEventListener("change", function () {

    if (!selectedUser) return;

    const file = this.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {

        socket.emit("privateVideo", {

            to: selectedUser.socketId,

            video: reader.result

        });

    };

    reader.readAsDataURL(file);

    this.value = "";

});

socket.on("privateVideo", (message) => {

    const div = document.createElement("div");

    div.className = "privateMessage";

    div.innerHTML = `

        <video

            class="privateVideo"

            controls>

            <source src="${message.video}">

        </video>

    `;

    privateMessages.appendChild(div);

    scrollBottom(privateMessages);

});

/* ==========================================================
   Private Voice
========================================================== */

document.getElementById("recordVoice").onclick = () => {

    document.getElementById("voiceInput").click();

};

document.getElementById("voiceInput")
.addEventListener("change", function () {

    if (!selectedUser) return;

    const file = this.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {

        socket.emit("privateVoice", {

            to: selectedUser.socketId,

            voice: reader.result,

            duration: 0

        });

    };

    reader.readAsDataURL(file);

    this.value = "";

});

socket.on("privateVoice", (message) => {

    const div = document.createElement("div");

    div.className = "privateMessage";

    div.innerHTML = `

        <audio controls>

            <source src="${message.voice}">

        </audio>

    `;

    privateMessages.appendChild(div);

    scrollBottom(privateMessages);

});
/* ==========================================================
   Header Buttons
========================================================== */

document.getElementById("logoutBtn").onclick = () => {

    if (!confirm("هل تريد تسجيل الخروج؟"))
        return;

    localStorage.clear();

    window.location.href = "index.html";

};

document.getElementById("profileBtn").onclick = () => {

    document.getElementById("profileAvatar").src =
        currentUser.avatar;

    document.getElementById("profileUsername").innerText =
        currentUser.username;

    document.getElementById("profileAge").innerText =
        currentUser.age || "-";

    document.getElementById("profileGender").innerText =
        currentUser.gender || "-";

    document.getElementById("profileType").innerText =
        currentUser.memberType;

    document.getElementById("profileModal")
        .style.display = "flex";

};

document.getElementById("settingsBtn").onclick = () => {

    alert("سيتم إضافة الإعدادات قريبًا.");

};

/* ==========================================================
   Connection
========================================================== */

socket.on("disconnect", () => {

    console.log("Disconnected");

});

socket.on("connect", () => {

    console.log("Connected");

});

socket.on("connect_error", (err) => {

    console.error(err);

});

/* ==========================================================
   Reconnect
========================================================== */

socket.io.on("reconnect", () => {

    socket.emit("joinRoom", {

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
   Notifications
========================================================== */

socket.on("muted", (data) => {

    alert(
        `تم كتمك لمدة ${data.minutes} دقيقة`
    );

});

socket.on("kicked", () => {

    alert("تم طردك من الغرفة");

    localStorage.clear();

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

    console.table(stats);

});

/* ==========================================================
   Helpers
========================================================== */

function scrollBottom(element) {

    if (!element) return;

    element.scrollTop =
        element.scrollHeight;

}

function clearInput(input) {

    if (!input) return;

    input.value = "";

}

window.addEventListener("beforeunload", () => {

    socket.disconnect();

});

console.log("====================================");
console.log("Chat Masr v4 Loaded");
console.log("====================================");
