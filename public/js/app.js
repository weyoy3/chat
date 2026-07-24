// =====================================
// Chat Masr App
// =====================================

const socket = io();

// ================================
// Buttons
// ================================

const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const guestBtn = document.getElementById("guestBtn");

const loginModal = document.getElementById("loginModal");
const registerModal = document.getElementById("registerModal");
const guestModal = document.getElementById("guestModal");

const closeLogin = document.getElementById("closeLogin");
const closeRegister = document.getElementById("closeRegister");
const closeGuest = document.getElementById("closeGuest");

// ================================
// Open Modals
// ================================

loginBtn.onclick = () => {

    loginModal.style.display = "flex";

};

registerBtn.onclick = () => {

    registerModal.style.display = "flex";

};

guestBtn.onclick = () => {

    guestModal.style.display = "flex";

};

// ================================
// Close Modals
// ================================

closeLogin.onclick = () => {

    loginModal.style.display = "none";

};

closeRegister.onclick = () => {

    registerModal.style.display = "none";

};

closeGuest.onclick = () => {

    guestModal.style.display = "none";

};

// ================================
// Close Outside
// ================================

window.onclick = (e) => {

    if(e.target === loginModal)
        loginModal.style.display = "none";

    if(e.target === registerModal)
        registerModal.style.display = "none";

    if(e.target === guestModal)
        guestModal.style.display = "none";

};

// ================================
// Online Users
// ================================

socket.on("onlineUsers",(users)=>{

    document.getElementById("onlineCount").innerText = users.length;

});

// ================================
// Guest Login
// ================================

document
.getElementById("guestForm")
.addEventListener("submit",(e)=>{

    e.preventDefault();

    const username =
    e.target.querySelector("input").value;

    localStorage.setItem("username",username);

    localStorage.setItem("memberType","زائر");

    window.location.href="chat.html";

});

// =====================================
// Register Member
// =====================================

document
.getElementById("registerForm")
.addEventListener("submit", (e) => {

    e.preventDefault();

    const inputs = e.target.querySelectorAll("input");
    const select = e.target.querySelector("select");

    const user = {

        username: inputs[0].value,

        email: inputs[1].value,

        password: inputs[2].value,

        age: inputs[3].value,

        gender: select.value,

        memberType: "عضو"

    };

    socket.emit("registerUser", user);

});

socket.on("registerSuccess", () => {

    alert("تم إنشاء الحساب بنجاح");

    registerModal.style.display = "none";

});


// =====================================
// Login Member
// =====================================

document
.getElementById("loginForm")
.addEventListener("submit", (e) => {

    e.preventDefault();

    const inputs = e.target.querySelectorAll("input");

    const loginData = {

        username: inputs[0].value,

        password: inputs[1].value

    };

    socket.emit("loginUser", loginData);

});


socket.on("loginSuccess", (user) => {

    localStorage.setItem("username", user.username);

    localStorage.setItem("memberType", "عضو");

    localStorage.setItem("avatar", user.avatar || "");

    window.location.href = "chat.html";

});


socket.on("loginError", (msg) => {

    alert(msg);

});


// =====================================
// Server Statistics
// =====================================

socket.emit("getStatistics");

socket.on("statistics", (data) => {

    document.getElementById("onlineCount").innerText =
        data.online;

});


// =====================================
// Welcome Message
// =====================================

console.log("Welcome To Chat Masr");


// =====================================
// Connection Status
// =====================================

socket.on("connect", () => {

    console.log("Connected");

});

socket.on("disconnect", () => {

    console.log("Disconnected");

});
