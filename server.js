// --- Hilfsfunktion gegen XSS ---
function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// --- Globale Variablen ---
let socket, peer = null, localStream = null, username = '', userColor = '';
let users = [];
const userColors = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6',
  '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3'
];
let typingTimeout = null;
let typingUsers = new Set();

// --- UI-Elemente ---
const usernameInput = document.getElementById('username');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const messages = document.getElementById('messages');
const userList = document.querySelector('#userList ul');
const micSelect = document.getElementById('mic');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const myVideo = document.getElementById('myVideo');
const remoteVideo = document.getElementById('remoteVideo');
const myOffline = document.getElementById('myOffline');
const remoteOffline = document.getElementById('remoteOffline');
const errorDiv = document.getElementById('errorMsg');
const typingIndicator = document.getElementById('typingIndicator');
const fileInput = document.getElementById('fileInput');
const connectionStatus = document.getElementById('connectionStatus');
const notifSound = document.getElementById('notifSound');

// --- Fehleranzeige ---
function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.style.display = 'block';
  setTimeout(() => { errorDiv.style.display = 'none'; }, 4000);
}

// --- Verbindungsstatus-Badge ---
function setConnectionStatus(connected) {
  if (connected) {
    connectionStatus.textContent = "🟢 Verbunden";
    connectionStatus.className = "status-badge connected";
  } else {
    connectionStatus.textContent = "🔴 Getrennt";
    connectionStatus.className = "status-badge disconnected";
  }
}
setConnectionStatus(false);

function playNotifSound() {
  notifSound.currentTime = 0;
  notifSound.play();
}

// --- PeerConnection-Erstellung ---
function createPeer(targetId) {
  const pc = new RTCPeerConnection();
  pc.onicecandidate = e => e.candidate && socket.emit('ice', { target: targetId, candidate: e.candidate });
  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
    remoteVideo.style.display = 'block';
    remoteOffline.style.display = 'none';
  };
  return pc;
}

// --- Mikrofonliste aktualisieren ---
async function updateMicList() {
  micSelect.innerHTML = '';
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.filter(d => d.kind === 'audioinput').forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Mikrofon ${i+1}`;
      micSelect.appendChild(opt);
    });
  } catch (e) {
    showError('Keine Mikrofone gefunden.');
  }
}

// --- Audio-Initialisierung ---
async function initializeAudio() {
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream = new MediaStream();
    audioStream.getTracks().forEach((track) => localStream.addTrack(track));
  } catch (error) {
    console.error("Fehler bei der Initialisierung des Audio-Streams:", error);
    showError("Mikrofonzugriff fehlgeschlagen.");
  }
}

// --- Socket-Initialisierung ---
async function initSocket() {
  socket = io();
  socket.on('message', ({ username: uname, text, color }) => {
    appendMessage(uname, text, color);
    if (uname !== username) playNotifSound();
  });
  socket.on('file', ({ username: uname, fileName, fileType, fileData, color }) => {
    appendFileMessage(uname, fileName, fileType, fileData, color);
    if (uname !== username) playNotifSound();
  });
  socket.on('users', list => {
    if (users.length && list.length > users.length) playNotifSound();
    updateUserList(list);
    users = list.filter(u => u.name !== username);
  });
  socket.on('offer', async ({ from, sdp }) => {
    if (!peer) {
      peer = createPeer(from);
      if (localStream) localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
    }
    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('answer', { target: from, sdp: answer });
  });
  socket.on('answer', ({ sdp }) => {
    peer && peer.setRemoteDescription(new RTCSessionDescription(sdp));
  });
  socket.on('ice', ({ candidate }) => {
    peer && peer.addIceCandidate(new RTCIceCandidate(candidate));
  });

  socket.on('typing', ({ username: typingUser }) => {
    if (typingUser !== username) {
      typingUsers.add(typingUser);
      updateTypingIndicator();
      playNotifSound();
    }
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      typingUsers.delete(typingUser);
      updateTypingIndicator();
    }, 2000);
  });

  socket.on('joinError', ({ message }) => {
    showError(message);
    setConnectionStatus(false);
    socket.disconnect();
  });
}

// --- Nachrichten & Dateien einfügen mit Animation ---
function appendMessage(uname, text, color) {
  const msg = document.createElement('div');
  msg.classList.add('message');
  if (uname === username) msg.classList.add('me');
  msg.innerHTML = `<span class="name" style="color:${color}">${escapeHTML(uname)}:</span> ${escapeHTML(text)}`;
  messages.appendChild(msg);
  msg.style.opacity = "0";
  setTimeout(()=>msg.style.opacity = "1", 20);
  messages.scrollTop = messages.scrollHeight;
}
function appendFileMessage(uname, fileName, fileType, fileData, color) {
  const msg = document.createElement('div');
  msg.classList.add('message');
  if (uname === username) msg.classList.add('me');
  let content = `<span class="name" style="color:${color}">${escapeHTML(uname)}:</span> `;
  if (fileType.startsWith('image/')) {
    content += `<a href="${fileData}" target="_blank"><img src="${fileData}" alt="${escapeHTML(fileName)}" /></a>`;
  } else {
    content += `<span class="file-attachment"><a href="${fileData}" download="${escapeHTML(fileName)}">${escapeHTML(fileName)}</a></span>`;
  }
  msg.innerHTML = content;
  messages.appendChild(msg);
  msg.style.opacity = "0";
  setTimeout(()=>msg.style.opacity = "1", 20);
  messages.scrollTop = messages.scrollHeight;
}

// --- Nutzerliste animieren ---
function updateUserList(list) {
  userList.innerHTML = '';
  list.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="user-dot"></span> ${escapeHTML(u.name)}`;
    userList.appendChild(li);
  });
}

function updateTypingIndicator() {
  if (typingUsers.size > 0) {
    typingIndicator.textContent = [...typingUsers].join(', ') + ' schreibt...';
    typingIndicator.style.display = 'block';
  } else {
    typingIndicator.style.display = 'none';
  }
}

// --- Benutzername aus LocalStorage laden ---
document.addEventListener('DOMContentLoaded', () => {
  const savedName = localStorage.getItem('username');
  if (savedName) usernameInput.value = savedName;
  if (Notification.permission !== "granted") {
    Notification.requestPermission();
  }
});

// --- Verbinden ---
connectBtn.addEventListener('click', async () => {
  await updateMicList();
  await initializeAudio();
  await initSocket();
  username = usernameInput.value.trim();
  localStorage.setItem('username', username);
  if (!username) return showError('Bitte Benutzernamen eingeben.');
  usernameInput.readOnly = true;
  userColor = userColors[Math.floor(Math.random() * userColors.length)];
  socket.emit('join', { username });
  connectBtn.style.display = 'none';
  disconnectBtn.style.display = 'inline-block';
  setConnectionStatus(true);

  try {
    if (users.length === 0) return;
    peer = createPeer(users[0].id);
    if (localStream) localStream.getTracks().forEach(t => peer.addTrack(t, localStream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('offer', { target: users[0].id, sdp: offer });
  } catch (err) {
    showError('Mikrofonzugriff fehlgeschlagen.');
  }
});

// --- Trennen ---
disconnectBtn.addEventListener('click', () => {
  if (socket) socket.disconnect();
  connectBtn.style.display = 'inline-block';
  disconnectBtn.style.display = 'none';
  usernameInput.readOnly = false;
  messages.innerHTML = '';
  userList.innerHTML = '';
  typingIndicator.style.display = 'none';
  typingUsers.clear();
  [myVideo, remoteVideo].forEach(v => {
    if (v.srcObject) v.srcObject.getTracks().forEach(t => t.stop());
    v.srcObject = null;
    v.style.display = 'none';
  });
  myOffline.style.display = 'block';
  remoteOffline.style.display = 'block';
  setConnectionStatus(false);
  peer = null;
});

// --- Nachricht senden ---
sendBtn.addEventListener('click', () => {
  const text = messageInput.value.trim();
  if (!text || !username) return;
  socket.emit('message', { username, text, color: userColor });
  messageInput.value = '';
  socket.emit('typing', { username, typing: false });
});

// --- Senden mit Enter ---
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// --- Tippanzeige beim Tippen ---
messageInput.addEventListener('input', () => {
  if (username && socket) socket.emit('typing', { username, typing: true });
});

// --- Datei-Upload ---
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showError('Datei zu groß (max. 5MB).');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    socket.emit('file', {
      username,
      fileName: file.name,
      fileType: file.type,
      fileData: e.target.result,
      color: userColor
    });
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

// --- Datei-Auswahl öffnen per Klick auf Büroklammer ---
document.querySelector('.file-upload-label').addEventListener('click', () => {
  fileInput.click();
});

// --- Bildschirm teilen ---
shareScreenBtn.addEventListener('click', async () => {
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    localStream.getVideoTracks().forEach(track => {
      localStream.removeTrack(track);
      if (peer) {
        const senders = peer.getSenders().filter(s => s.track && s.track.kind === 'video');
        senders.forEach(sender => peer.removeTrack(sender));
      }
    });
    displayStream.getVideoTracks().forEach(track => {
      localStream.addTrack(track);
      if (peer) {
        peer.addTrack(track, localStream);
      }
    });
    myVideo.srcObject = new MediaStream([...displayStream.getVideoTracks(), ...localStream.getAudioTracks()]);
    myVideo.style.display = 'block';
    myOffline.style.display = 'none';

    if (peer && users.length > 0) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit('offer', { target: users[0].id, sdp: offer });
    }
  } catch (err) {
    showError('Bildschirmfreigabe fehlgeschlagen.');
  }
});

// --- Vollbild ---
window.toggleFullscreen = function(id) {
  const el = document.getElementById(id);
  if (!document.fullscreenElement) el.requestFullscreen(); else document.exitFullscreen();
};
