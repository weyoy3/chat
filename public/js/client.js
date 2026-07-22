const socket = io();

let currentUser = null;
let currentRoom = 'العامة';
let isRegistering = false;

window.addEventListener('DOMContentLoaded', () => {
    const ageSelects = [document.getElementById('guest-age'), document.getElementById('member-age')];
    ageSelects.forEach(select => {
        if (!select) return;
        for (let i = 18; i <= 90; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `${i} سنة`;
            select.appendChild(option);
        }
    });
    generateRandomName();
});

function generateRandomName() {
    const adjectives = ['نشيط', 'سريع', 'ذكي', 'مبدع', 'هادئ', 'نجم', 'أسد', 'صقر'];
    const names = ['أحمد', 'محمد', 'كريم', 'يوسف', 'عمر', 'خالد', 'رائد', 'سامي', 'فارس'];
    const randAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randName = names[Math.floor(Math.random() * names.length)];
    const randNum = Math.floor(100 + Math.random() * 900);
    
    document.getElementById('guest-username').value = `${randName}_${randAdj}_${randNum}`;
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    
    if (tab === 'guest') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('guest-form').classList.add('active');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('member-form').classList.add('active');
    }
}

function toggleMemberMode(e) {
    e.preventDefault();
    isRegistering = !isRegistering;
    const extraFields = document.getElementById('register-fields');
    const modeText = document.getElementById('mode-text');
    const modeLink = document.getElementById('mode-toggle-link');
    const submitBtn = document.getElementById('member-submit-btn');

    if (isRegistering) {
        extraFields.style.display = 'block';
        modeText.textContent = 'لديك حساب بالفعل؟';
        modeLink.textContent = 'تسجيل الدخول';
        submitBtn.innerHTML = 'إنشاء حساب جديد';
    } else {
        extraFields.style.display = 'none';
        modeText.textContent = 'ليس لديك حساب؟';
        modeLink.textContent = 'إنشاء حساب جديد';
        submitBtn.innerHTML = 'تسجيل الدخول';
    }
}

function handleGuestLogin(e) {
    e.preventDefault();
    let username = document.getElementById('guest-username').value.trim();
    const gender = document.getElementById('guest-gender').value;
    const age = document.getElementById('guest-age').value;

    if (!username) {
        generateRandomName();
        username = document.getElementById('guest-username').value.trim();
    }

    if (!age || parseInt(age) < 18) {
        document.getElementById('guest-error').textContent = 'عذراً، يجب أن يكون العمر 18 سنة أو أكثر لاستخدام المنصة.';
        return;
    }

    currentUser = { username, gender, age, type: 'ضيف' };
    initChatSession();
}

function handleMemberLogin(e) {
    e.preventDefault();
    const email = document.getElementById('member-email').value;

    if (isRegistering) {
        const username = document.getElementById('member-username').value.trim();
        const age = document.getElementById('member-age').value;
        const gender = document.getElementById('member-gender').value;

        if (!username || !age || parseInt(age) < 18) {
            document.getElementById('member-error').textContent = 'يرجى إكمال البيانات والتأكد من أن العمر 18 سنة فأكثر.';
            return;
        }
        currentUser = { username, gender, age, email, type: 'عضو' };
    } else {
        currentUser = { username: email.split('@')[0], gender: 'ذكر', age: 24, email, type: 'عضو' };
    }

    initChatSession();
}

function loginWithGoogle() {
    currentUser = {
        username: 'مستخدم_جوجل_' + Math.floor(Math.random() * 1000),
        gender: 'ذكر',
        age: 25,
        type: 'عضو جوجل'
    };
    initChatSession();
}

function initChatSession() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';

    document.getElementById('my-display-name').textContent = currentUser.username;
    document.getElementById('my-avatar-icon').textContent = currentUser.gender === 'أنثى' ? '👩' : '👨';

    socket.emit('joinRoom', { username: currentUser.username, room: currentRoom, gender: currentUser.gender });

    socket.on('message', (message) => {
        appendMessage(message);
    });

    socket.on('roomUsers', ({ room, users }) => {
        updateOnlineUsers(users);
    });
}

function changeRoom(roomName) {
    currentRoom = roomName;
    document.getElementById('current-room-title').textContent = `غرفة ${roomName}`;
    
    document.querySelectorAll('.room-item').forEach(el => {
        el.classList.remove('active');
        if (el.getAttribute('data-room') === roomName) {
            el.classList.add('active');
        }
    });

    document.getElementById('messages-container').innerHTML = '';
    socket.emit('joinRoom', { username: currentUser.username, room: currentRoom, gender: currentUser.gender });
}

function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const msgText = input.value.trim();

    if (!msgText) return;

    socket.emit('chatMessage', { room: currentRoom, text: msgText, username: currentUser.username });
    input.value = '';
    input.focus();
}

function appendMessage(msg) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');

    if (msg.type === 'system') {
        div.className = 'message-bubble system';
        div.textContent = msg.text;
    } else {
        const isOutgoing = msg.username === currentUser.username;
        div.className = `message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`;
        div.innerHTML = `
            <div class="msg-username">${msg.username}</div>
            <div class="msg-text">${msg.text}</div>
            <div class="msg-time">${msg.time}</div>
        `;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function updateOnlineUsers(users) {
    const list = document.getElementById('users-list');
    document.getElementById('online-count').textContent = users.length;
    
    list.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-list-item';
        li.innerHTML = `
            <div class="user-status-dot"></div>
            <span>${user.username}</span>
        `;
        list.appendChild(li);
    });
}

function logout() {
    location.reload();
}

