/* ==========================================================
   Chat Masr
   app.js v2
========================================================== */

const socket = io();

/* ==========================================================
   Elements
========================================================== */

const loginBtn =
    document.getElementById("loginBtn");

const registerBtn =
    document.getElementById("registerBtn");

const guestBtn =
    document.getElementById("guestBtn");

const startNow =
    document.getElementById("startNow");

const loginModal =
    document.getElementById("loginModal");

const registerModal =
    document.getElementById("registerModal");

const guestModal =
    document.getElementById("guestModal");

/* ==========================================================
   Close Buttons
========================================================== */

document.getElementById("closeLogin")
.onclick = () => {

    loginModal.style.display = "none";

};

document.getElementById("closeRegister")
.onclick = () => {

    registerModal.style.display = "none";

};

document.getElementById("closeGuest")
.onclick = () => {

    guestModal.style.display = "none";

};

/* ==========================================================
   Open Buttons
========================================================== */

loginBtn.onclick = () => {

    loginModal.style.display = "flex";

};

registerBtn.onclick = () => {

    registerModal.style.display = "flex";

};

guestBtn.onclick = () => {

    guestModal.style.display = "flex";

};

startNow.onclick = () => {

    guestModal.style.display = "flex";

};

/* ==========================================================
   Close Outside
========================================================== */

window.onclick = (e) => {

    if (e.target === loginModal)
        loginModal.style.display = "none";

    if (e.target === registerModal)
        registerModal.style.display = "none";

    if (e.target === guestModal)
        guestModal.style.display = "none";

};

/* ==========================================================
   Statistics
========================================================== */

socket.emit("getStatistics");

socket.on("statistics", (stats) => {

    document.getElementById("onlineCount").innerText =
        stats.online;

});

socket.on("onlineUsers", (users) => {

    document.getElementById("onlineCount").innerText =
        users.length;

});
/* ==========================================================
   Guest Login
========================================================== */

document.getElementById("guestForm")
.addEventListener("submit", (e) => {

    e.preventDefault();

    const username =
        document.getElementById("guestUsername")
        .value.trim();

    const age =
        document.getElementById("guestAge")
        .value;

    const gender =
        document.getElementById("guestGender")
        .value;

    if (!username || !age || !gender) {

        alert("يرجى ملء جميع البيانات.");

        return;

    }

    localStorage.setItem("userId", "");

    localStorage.setItem("username", username);

    localStorage.setItem("age", age);

    localStorage.setItem("gender", gender);

    localStorage.setItem("memberType", "زائر");

    localStorage.setItem(
        "avatar",
        "avatars/default.png"
    );

    window.location.href = "chat.html";

});

/* ==========================================================
   Register
========================================================== */

document.getElementById("registerForm")
.addEventListener("submit", (e) => {

    e.preventDefault();

    const user = {

        username:
            document.getElementById("registerUsername").value.trim(),

        email:
            document.getElementById("registerEmail").value.trim(),

        password:
            document.getElementById("registerPassword").value,

        age:
            document.getElementById("registerAge").value,

        gender:
            document.getElementById("registerGender").value,

        memberType: "عضو"

    };

    if (
        !user.username ||
        !user.email ||
        !user.password ||
        !user.age ||
        !user.gender
    ) {

        alert("يرجى ملء جميع البيانات.");

        return;

    }

    socket.emit("registerUser", user);

});

socket.on("registerSuccess", () => {

    alert("تم إنشاء الحساب بنجاح.");

    registerModal.style.display = "none";

});

socket.on("registerError", (msg) => {

    alert(msg);

});
/* ==========================================================
   Login
========================================================== */

document.getElementById("loginForm")
.addEventListener("submit", (e) => {

    e.preventDefault();

    const loginData = {

        username:
            document.getElementById("loginUsername").value.trim(),

        password:
            document.getElementById("loginPassword").value

    };

    if (
        !loginData.username ||
        !loginData.password
    ) {

        alert("يرجى إدخال اسم المستخدم وكلمة المرور.");

        return;

    }

    socket.emit("loginUser", loginData);

});

socket.on("loginSuccess", (user) => {

    localStorage.setItem(
        "userId",
        user._id || ""
    );

    localStorage.setItem(
        "username",
        user.username
    );

    localStorage.setItem(
        "age",
        user.age || ""
    );

    localStorage.setItem(
        "gender",
        user.gender || ""
    );

    localStorage.setItem(
        "memberType",
        user.memberType || "عضو"
    );

    localStorage.setItem(
        "avatar",
        user.avatar || "avatars/default.png"
    );

    window.location.href = "chat.html";

});

socket.on("loginError", (msg) => {

    alert(msg);

});

/* ==========================================================
   Connection
========================================================== */

socket.on("connect", () => {

    console.log("Socket Connected");

});

socket.on("disconnect", () => {

    console.log("Socket Disconnected");

});

socket.on("connect_error", (err) => {

    console.error(err);

});

/* ==========================================================
   Auto Login
========================================================== */

if (localStorage.getItem("username")) {

    console.log(
        "Saved User:",
        localStorage.getItem("username")
    );

}

/* ==========================================================
   Ready
========================================================== */

console.log("====================================");
console.log("Chat Masr App Loaded");
console.log("====================================");
