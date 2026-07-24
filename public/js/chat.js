/* ==========================================================
   Chat Masr
   chat.js
========================================================== */

const socket = io();

/* ==========================================================
   Current User
========================================================== */

const username =
    localStorage.getItem("username");

const memberType =
    localStorage.getItem("memberType");

const avatar =
    localStorage.getItem("avatar") ||
    "avatars/default.png";

/* ==========================================================
   Join Room
========================================================== */

socket.emit("joinRoom", {

    username,

    memberType,

    avatar,

    age:
        localStorage.getItem("age") || "",

    gender:
        localStorage.getItem("gender") || ""

});

/* ==========================================================
   Elements
========================================================== */

const usersList =
    document.getElementById("usersList");

const messages =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendBtn =
    document.getElementById("sendBtn");

/* ==========================================================
   Send Public Message
========================================================== */

sendBtn.onclick = () => {

    const text =
        messageInput.value.trim();

    if(text.length === 0)
        return;

    socket.emit(
        "publicMessage",
        text
    );

    messageInput.value = "";

};

messageInput.addEventListener(
"keydown",

(e)=>{

    if(e.key==="Enter")
        sendBtn.click();

});

/* ==========================================================
   Connected
========================================================== */

socket.on(
"joinedSuccessfully",

(user)=>{

    console.log(

        "Welcome",

        user.username

    );

});
/* ==========================================================
   Online Users
========================================================== */

socket.on("onlineUsers", (users) => {

    usersList.innerHTML = "";

    users.forEach((user) => {

        const div = document.createElement("div");

        div.className = "user";

        div.dataset.socket = user.socketId;

        div.innerHTML = `

            <img
                src="${user.avatar}"
                class="userAvatar">

            <div class="userInfo">

                <div class="userName">

                    ${user.username}

                </div>

                <div class="userStatus">

                    ${user.memberType}

                </div>

            </div>

        `;

        div.onclick = () => {

            openUserMenu(user);

        };

        usersList.appendChild(div);

    });

});

/* ==========================================================
   Public Messages
========================================================== */

socket.on("publicMessage", (message) => {

    addPublicMessage(message);

});

/* ==========================================================
   Previous Messages
========================================================== */

socket.on("publicMessages", (list) => {

    messages.innerHTML = "";

    list.forEach(addPublicMessage);

});

/* ==========================================================
   System Messages
========================================================== */

socket.on("systemMessage", (msg) => {

    const div = document.createElement("div");

    div.className = "systemMessage";

    div.innerHTML = msg.message;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;

});

/* ==========================================================
   Draw Public Message
========================================================== */

function addPublicMessage(message){

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

            </div>

            <div class="messageText">

                ${message.text}

            </div>

        </div>

    `;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;

}
/* ==========================================================
   User Menu
========================================================== */

let selectedUser = null;

function openUserMenu(user){

    selectedUser = user;

    document.getElementById("menuAvatar").src =
        user.avatar;

    document.getElementById("menuUsername").innerText =
        user.username;

    document.getElementById("userMenu").style.display =
        "flex";

}

function openUserMenuByName(name){

    const cards =
        document.querySelectorAll(".user");

    for(const card of cards){

        const username = card.querySelector(
            ".userName"
        ).innerText;

        if(username === name){

            card.click();

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

    if(!selectedUser) return;

    document.getElementById("profileAvatar").src =
        selectedUser.avatar;

    document.getElementById("profileUsername")
    .innerText = selectedUser.username;

    document.getElementById("profileAge")
    .innerText =
        selectedUser.age || "-";

    document.getElementById("profileGender")
    .innerText =
        selectedUser.gender || "-";

    document.getElementById("profileType")
    .innerText =
        selectedUser.memberType;

    document.getElementById("profileModal")
    .style.display = "flex";

};

document.getElementById("closeProfile")
.onclick = () => {

    document.getElementById("profileModal")
    .style.display = "none";

};

/* ==========================================================
   Private Chat
========================================================== */

document.getElementById("privateChatBtn")
.onclick = () => {

    if(!selectedUser) return;

    document.getElementById("privateAvatar").src =
        selectedUser.avatar;

    document.getElementById("privateUsername")
    .innerText =
        selectedUser.username;

    document.getElementById("privateMessages")
    .innerHTML = "";

    document.getElementById("privateChatWindow")
    .style.display = "flex";

    document.getElementById("userMenu")
    .style.display = "none";

};

document.getElementById("closePrivate")
.onclick = () => {

    document.getElementById("privateChatWindow")
    .style.display = "none";

};

/* ==========================================================
   Send Private Message
========================================================== */

document.getElementById("privateSend")
.onclick = () => {

    const input =
        document.getElementById("privateInput");

    const text =
        input.value.trim();

    if(text === "")
        return;

    socket.emit("privateMessage",{

        to:selectedUser.socketId,

        text:text

    });

    input.value = "";

};

/* ==========================================================
   Receive Private Message
========================================================== */

socket.on("privateMessage",(message)=>{

    const box =
        document.getElementById(
            "privateMessages"
        );

    const div =
        document.createElement("div");

    div.className = "message";

    div.innerHTML = `

        <div class="messageContent">

            <div class="messageHeader">

                <span class="messageName">

                    ${message.senderName}

                </span>

            </div>

            <div class="messageText">

                ${message.text}

            </div>

        </div>

    `;

    box.appendChild(div);

    box.scrollTop = box.scrollHeight;

});
