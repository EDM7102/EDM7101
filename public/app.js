document.addEventListener('DOMContentLoaded', () => {
    const UI = {
        serverUrlInput: document.getElementById('serverUrl'),
        roomIdInput: document.getElementById('roomId'),
        usernameInput: document.getElementById('username'),
        connectBtn: document.getElementById('connectBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        shareScreenBtn: document.getElementById('shareScreenBtn'),
        userList: document.getElementById('userList'),
        messagesContainer: document.getElementById('messagesContainer'),
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        typingIndicator: document.getElementById('typingIndicator'),
        statusIndicator: document.getElementById('statusIndicator'),
        errorMessage: document.getElementById('errorMessage'),
        localVideo: document.getElementById('localVideo'),
        remoteVideo: document.getElementById('remoteVideo'),
        localScreenStatus: document.getElementById('localScreenStatus'),
        remoteScreenStatus: document.getElementById('remoteScreenStatus'),
        localVideoBox: document.getElementById('localVideoBox'),
        remoteVideoBox: document.getElementById('remoteVideoBox'),
        fileInput: document.getElementById('fileInput'),
        fileUploadLabel: document.getElementById('fileUploadLabel'),
        localVideoFullscreenBtn: document.getElementById('localVideoFullscreenBtn'),
        remoteVideoFullscreenBtn: document.getElementById('remoteVideoFullscreenBtn'),
    };

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: '',
        users: {},
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        screenStream: null,
        isSharingScreen: false,
        selectedFile: null,
        typingTimeout: null,
        lastMessageTimestamp: 0,
        isWindowFocused: true,
        unreadMessages: 0,
        originalTitle: document.title,
        notificationSound: new Audio('notif.mp3')
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500, // ms
        RTC_CONFIGURATION: { // Konfiguration für STUN-Server (für NAT-Traversal)
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Für robustere Verbindungen in komplexen Netzwerken wären hier TURN-Server nötig.
                // {
                //   urls: 'turn:your.turn.server.com:3478',
                //   username: 'yourUsername',
                //   credential: 'yourPassword'
                // }
            ]
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5 MB
        IMAGE_PREVIEW_MAX_WIDTH: 200,
        IMAGE_PREVIEW_MAX_HEIGHT: 200
    };

    // --- Initialisierung und UI-Helfer ---
    function initializeUI() {
        UI.disconnectBtn.disabled = true;
        UI.shareScreenBtn.disabled = true;
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        UI.fileUploadLabel.classList.add('hidden'); // Hide initially
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        [UI.localVideoFullscreenBtn, UI.remoteVideoFullscreenBtn].forEach(btn => btn.classList.add('hidden'));
    }

    function setConnectionStatus(statusClass, text) {
        UI.statusIndicator.className = `status-indicator ${statusClass}`;
        UI.statusIndicator.textContent = text;
    }

    function displayError(message) {
        UI.errorMessage.textContent = message;
        UI.errorMessage.classList.remove('hidden');
        setTimeout(() => UI.errorMessage.classList.add('hidden'), 5000);
    }

    function updateUIAfterConnect() {
        UI.connectBtn.disabled = true;
        UI.disconnectBtn.disabled = false;
        UI.shareScreenBtn.disabled = false;
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        UI.fileUploadLabel.classList.remove('hidden');
        [UI.serverUrlInput, UI.roomIdInput, UI.usernameInput].forEach(el => el.disabled = true);
        setConnectionStatus('connected', `Verbunden als ${state.username} in Raum ${state.roomId}`);
        saveStateToLocalStorage();
    }

    function updateUIAfterDisconnect() {
        UI.connectBtn.disabled = false;
        UI.disconnectBtn.disabled = true;
        UI.shareScreenBtn.disabled = true;
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        UI.fileUploadLabel.classList.add('hidden');
        [UI.serverUrlInput, UI.roomIdInput, UI.usernameInput].forEach(el => el.disabled = false);
        setConnectionStatus('disconnected', 'Nicht verbunden');
        UI.userList.innerHTML = '';
        UI.messagesContainer.innerHTML = '';
        UI.typingIndicator.textContent = '';
        stopLocalStream();
        closePeerConnection();
        if (state.isSharingScreen) toggleScreenSharing(); // Stop sharing if active
        state.users = {};
    }

    function saveStateToLocalStorage() {
        localStorage.setItem('chatClientState', JSON.stringify({
            serverUrl: UI.serverUrlInput.value,
            roomId: UI.roomIdInput.value,
            username: UI.usernameInput.value
        }));
    }

    function loadStateFromLocalStorage() {
        const saved = localStorage.getItem('chatClientState');
        if (saved) {
            const { serverUrl, roomId, username } = JSON.parse(saved);
            UI.serverUrlInput.value = serverUrl || 'ws://localhost:3000';
            UI.roomIdInput.value = roomId || 'default-room';
            UI.usernameInput.value = username || '';
        }
    }
    
    window.addEventListener('focus', () => {
        state.isWindowFocused = true;
        state.unreadMessages = 0;
        document.title = state.originalTitle;
    });
    window.addEventListener('blur', () => { state.isWindowFocused = false; });

    function notifyUnreadMessage() {
        if (!state.isWindowFocused) {
            state.unreadMessages++;
            document.title = `(${state.unreadMessages}) ${state.originalTitle}`;
            try {
                state.notificationSound.play().catch(e => console.warn("Notification sound blocked:", e));
            } catch (e) { console.warn("Error playing notification sound:", e); }
        }
    }

    // --- Event Listener ---
    UI.connectBtn.addEventListener('click', connect);
    UI.disconnectBtn.addEventListener('click', disconnect);
    UI.shareScreenBtn.addEventListener('click', toggleScreenSharing);
    UI.sendBtn.addEventListener('click', sendMessage);
    UI.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        } else {
            sendTyping();
        }
    });
    UI.messageInput.addEventListener('input', () => {
        UI.messageInput.style.height = 'auto';
        UI.messageInput.style.height = (UI.messageInput.scrollHeight) + 'px';
    });
    UI.fileInput.addEventListener('change', handleFileSelect);
    [
        { btn: UI.localVideoFullscreenBtn, video: UI.localVideo },
        { btn: UI.remoteVideoFullscreenBtn, video: UI.remoteVideo }
    ].forEach(item => {
        if (item.btn) item.btn.addEventListener('click', () => toggleFullscreen(item.video));
    });

    // --- WebSocket Logic ---
    function connect() {
        const serverUrl = UI.serverUrlInput.value.trim();
        const roomId = UI.roomIdInput.value.trim();
        let username = UI.usernameInput.value.trim();

        if (!serverUrl || !roomId) {
            displayError("Server URL und Raum-ID dürfen nicht leer sein.");
            return;
        }
        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username; // Update UI if username was generated

        state.username = username;
        state.roomId = roomId;

        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket'] // Force WebSocket
        });
        setConnectionStatus('connecting', 'Verbinde...');

        socket.on('connect', () => {
            state.connected = true;
            updateUIAfterConnect();
            console.log('Verbunden mit Server');
            socket.emit('joinRoom', { username: state.username, roomId: state.roomId });
            setupLocalMedia(); // Start local media after successful connection
        });

        socket.on('connect_error', (err) => {
            displayError(`Verbindungsfehler: ${err.message}. Läuft der Server unter ${serverUrl}?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            updateUIAfterDisconnect();
        });

        socket.on('disconnect', (reason) => {
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect();
        });

        socket.on('roomUsers', (users) => {
            state.users = users;
            updateUserList();
            // Initiate calls if more than one user and not already connected
            const otherUsers = Object.keys(users).filter(id => id !== socket.id);
            if (otherUsers.length > 0 && !state.peerConnection) {
                 // We will wait for an offer or create one if we are the 'initiator' (e.g. by alphabetical order of socket.id)
                 // For simplicity, let's say the one who joins later or has a "greater" ID initiates an offer.
                 // This logic can be more robust, e.g. server designating an initiator.
                 // For now, if there's another user, let's try to establish connection by sending an offer.
                 // This might lead to multiple offers if not coordinated.
                 // A better way: Server signals who should initiate.
                 // Or: Only one designated "caller" per pair based on IDs.
            }
        });
        
        socket.on('userJoined', ({ id, username }) => {
            state.users[id] = { username, color: getRandomColor(id) };
            updateUserList();
            appendSystemMessage(`${username} ist dem Raum beigetreten.`);
            // If we are the only other person, or by some defined logic, create an offer
            // This part needs careful consideration to avoid offer collisions
            if (Object.keys(state.users).length === 2 && !state.peerConnection) { // Simplified: if now 2 users, try to call.
                 console.log("Anderer Benutzer beigetreten, versuche Anruf zu starten.");
                 createOffer(Object.keys(state.users).find(uid => uid !== socket.id));
            }
        });

        socket.on('userLeft', ({ id, username }) => {
            appendSystemMessage(`${username} hat den Raum verlassen.`);
            if (state.users[id] && state.users[id].peerConnection === state.peerConnection) {
                closePeerConnection(); // Close PC if the disconnected user was our peer
            }
            delete state.users[id];
            updateUserList();
            if (Object.keys(state.users).filter(uid => uid !== socket.id).length === 0) {
                // If no other users left, clean up remote video
                updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null);
            }
        });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            notifyUnreadMessage();
        });

        socket.on('typing', ({ username, isTyping }) => {
            if (isTyping) {
                UI.typingIndicator.textContent = `${username} tippt...`;
            } else {
                UI.typingIndicator.textContent = '';
            }
        });

        // WebRTC Signaling
        socket.on('webRTC-offer', async ({ from, offer }) => {
            console.log('Angebot erhalten von:', from);
            if (state.peerConnection) { // If connection exists, it might be a re-negotiation
                console.warn("Bestehende PeerConnection beim Empfangen eines neuen Angebots. Vorsicht bei der Handhabung.");
            }
            await createPeerConnection(from); // Pass 'from' to store as current peer
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await state.peerConnection.createAnswer();
            await state.peerConnection.setLocalDescription(answer);
            socket.emit('webRTC-answer', { to: from, answer });
            console.log('Antwort gesendet an:', from);
        });

        socket.on('webRTC-answer', async ({ from, answer }) => {
            console.log('Antwort erhalten von:', from);
            if (state.peerConnection && state.peerConnection.signalingState !== "stable") {
                 await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } else {
                console.warn("Antwort erhalten, aber PeerConnection nicht im erwarteten Zustand oder nicht vorhanden.");
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            console.log('ICE Kandidat erhalten von:', from);
            if (state.peerConnection) {
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Fehler beim Hinzufügen des ICE Kandidaten:', e);
                }
            } else {
                 console.warn("ICE Kandidat erhalten, aber keine PeerConnection vorhanden.");
            }
        });
    }

    function disconnect() {
        if (socket) {
            socket.disconnect();
        }
        updateUIAfterDisconnect(); // Ensure UI is reset
    }

    // --- Chat Logic ---
    function sendMessage() {
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) {
            return;
        }

        const message = {
            username: state.username,
            content: content,
            timestamp: new Date().toISOString(),
            type: 'text'
        };

        if (state.selectedFile) {
            message.type = 'file';
            message.file = {
                name: state.selectedFile.name,
                type: state.selectedFile.type,
                size: state.selectedFile.size
            };
            // For actual file transfer, you'd typically upload to a server or use WebRTC DataChannels.
            // Here, we're just sending file metadata and a data URL for images.
            if (state.selectedFile.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    message.file.dataUrl = e.target.result;
                    socket.emit('chatMessage', message);
                    resetFileInput();
                };
                reader.readAsDataURL(state.selectedFile);
            } else { // Not an image, just send metadata
                socket.emit('chatMessage', message);
                resetFileInput();
            }
        } else {
            socket.emit('chatMessage', message);
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false); // Stop typing indicator
    }

    function appendMessage(msg) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        if (msg.username === state.username) {
            msgDiv.classList.add('me');
        }

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = msg.username;
        nameSpan.style.color = state.users[msg.socketId]?.color || getUserColor(msg.username);


        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');

        if (msg.type === 'file' && msg.file) {
            const fileInfo = document.createElement('div');
fileInfo.classList.add('file-attachment');
            if (msg.file.dataUrl && msg.file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = msg.file.dataUrl;
                img.alt = msg.file.name;
                img.style.maxWidth = `${CONFIG.IMAGE_PREVIEW_MAX_WIDTH}px`;
                img.style.maxHeight = `${CONFIG.IMAGE_PREVIEW_MAX_HEIGHT}px`;
                img.onclick = () => openImageModal(img.src); // Simple modal for viewing
                fileInfo.appendChild(img);
            } else {
                const icon = document.createElement('span');
                icon.textContent = '📄'; // Generic file icon
                fileInfo.appendChild(icon);
            }
            const link = document.createElement('a');
            link.textContent = `${msg.file.name} (${formatFileSize(msg.file.size)})`;
            if (msg.file.dataUrl) { // If it's an image with dataUrl, allow download
                link.href = msg.file.dataUrl;
                link.download = msg.file.name;
            } else {
                link.title = "Direkter Download nicht verfügbar für diesen Dateityp in der Demo.";
                link.style.cursor = "default";
                link.onclick = (e) => e.preventDefault();
            }
            fileInfo.appendChild(link);
            if (msg.content) { // If there was text along with the file
                const textContent = document.createElement('p');
                textContent.textContent = msg.content;
                fileInfo.appendChild(textContent);
            }
            contentDiv.appendChild(fileInfo);

        } else { // Regular text message
            contentDiv.textContent = msg.content;
        }


        const timeSpan = document.createElement('span');
        timeSpan.classList.add('timestamp');
        timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);
        msgDiv.appendChild(timeSpan);
        UI.messagesContainer.appendChild(msgDiv);
        
        // Scroll logic
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 1;
        if (msg.username === state.username || isScrolledToBottom || state.lastMessageTimestamp === 0) {
             UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
        state.lastMessageTimestamp = Date.now();
    }
    
    function openImageModal(src) {
        // Basic modal:
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.left = '0';
        modal.style.top = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0,0,0,0.8)';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '1000';
        modal.onclick = () => modal.remove();

        const img = document.createElement('img');
        img.src = src;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.objectFit = 'contain';
        
        modal.appendChild(img);
        document.body.appendChild(modal);
    }


    function appendSystemMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'system');
        msgDiv.textContent = text;
        UI.messagesContainer.appendChild(msgDiv);
        UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
    }

    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) return;
        clearTimeout(state.typingTimeout);
        socket.emit('typing', { username: state.username, isTyping });
        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { username: state.username, isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    function updateUserList() {
        UI.userList.innerHTML = '';
        Object.entries(state.users).forEach(([id, user]) => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.classList.add('user-dot');
            dot.style.backgroundColor = user.color || getRandomColor(id);
            li.appendChild(dot);
            const name = document.createTextNode(user.username + (id === socket.id ? ' (Du)' : ''));
            if (id === socket.id) {
                const strong = document.createElement('strong');
                strong.appendChild(name);
                li.appendChild(strong);
            } else {
                li.appendChild(name);
            }
            UI.userList.appendChild(li);
        });
    }
    
    function getUserColor(userIdOrName) {
        let hash = 0;
        for (let i = 0; i < userIdOrName.length; i++) {
            hash = userIdOrName.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.USER_COLORS[Math.abs(hash) % CONFIG.USER_COLORS.length];
    }
    function getRandomColor(id) { // Ensure users get consistent color
        return getUserColor(id);
    }


    // --- WebRTC Logic ---
    async function setupLocalMedia() {
        try {
            // Nur Audio anfordern, Kamera später optional
            state.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            UI.localVideoFullscreenBtn.classList.remove('hidden');
            // If a peerConnection already exists (e.g., due to re-negotiation or joining late), add tracks.
            if (state.peerConnection) {
                state.localStream.getTracks().forEach(track => {
                    try {
                        state.peerConnection.addTrack(track, state.localStream);
                    } catch (e) {
                        console.warn("Fehler beim Hinzufügen des Tracks (möglicherweise bereits hinzugefügt):", e);
                    }
                });
            }
        } catch (err) {
            console.error('Fehler beim Zugriff auf lokale Medien:', err);
            displayError('Zugriff auf Kamera/Mikrofon fehlgeschlagen. Bitte Berechtigungen prüfen.');
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // Show error/offline status
        }
    }
    
    function updateVideoDisplay(videoElement, statusElement, stream, isLocal = false) {
        if (stream) {
            videoElement.srcObject = stream;
            videoElement.classList.remove('hidden');
            statusElement.classList.add('hidden');
            if (isLocal) UI.localVideoFullscreenBtn.classList.remove('hidden');
            else UI.remoteVideoFullscreenBtn.classList.remove('hidden');
        } else {
            videoElement.srcObject = null;
            videoElement.classList.add('hidden');
            statusElement.textContent = isLocal ? 'Kamera aus / Fehler' : 'Kein Video/Screen';
            statusElement.className = 'screen-status-label offline'; // keep 'offline' visible
            if (isLocal) UI.localVideoFullscreenBtn.classList.add('hidden');
            else UI.remoteVideoFullscreenBtn.classList.add('hidden');
        }
    }


    function stopLocalStream() {
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
        }
        if (state.screenStream) { // Also stop screen stream if it was part of local media conceptually
            state.screenStream.getTracks().forEach(track => track.stop());
            state.screenStream = null;
            // UI update for screen share button handled in toggleScreenSharing
        }
    }

    async function createPeerConnection(peerId) {
        // Close any existing connection for this peer or in general if it's a 1-to-1 call scenario
        if (state.peerConnection) {
            console.log("Schließe bestehende PeerConnection, bevor eine neue erstellt wird.");
            closePeerConnection();
        }

        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.users[peerId] = { ...state.users[peerId], peerConnection: state.peerConnection }; // Associate PC with user

        state.peerConnection.onicecandidate = event => {
            if (event.candidate && socket && state.connected) {
                socket.emit('webRTC-ice-candidate', { to: peerId, candidate: event.candidate });
            }
        };

        state.peerConnection.ontrack = event => {
            console.log("Remote Track empfangen:", event.track.kind, "Stream ID:", event.streams[0].id);
            state.remoteStream = event.streams[0];
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream);
        };
        
        state.peerConnection.oniceconnectionstatechange = () => {
            if (!state.peerConnection) return;
            console.log("ICE Connection Status:", state.peerConnection.iceConnectionState);
            switch(state.peerConnection.iceConnectionState) {
                case "connected":
                    setConnectionStatus('connected', `Video verbunden mit ${state.users[peerId]?.username || 'Peer'}`);
                    break;
                case "disconnected":
                case "failed":
                case "closed":
                    // Could attempt to restart ICE or close connection if persistently failed
                    // For now, just update UI and potentially close
                    displayError(`Video-Verbindung zu ${state.users[peerId]?.username || 'Peer'} ${state.peerConnection.iceConnectionState}.`);
                    closePeerConnection(); // Or more specifically for this peer if multi-peer
                    break;
            }
        };
        
        state.peerConnection.onnegotiationneeded = async () => {
            console.log("Neuverhandlung benötigt (onnegotiationneeded).");
            // This can happen if tracks are added/removed after initial connection.
            // Avoid offer loops by checking signaling state or using a flag.
            if (state.peerConnection.signalingState === "stable") { // Only create offer if stable
                try {
                    console.log("Erzeuge Angebot wegen Neuverhandlung...");
                    const offer = await state.peerConnection.createOffer();
                    await state.peerConnection.setLocalDescription(offer);
                    socket.emit('webRTC-offer', { to: peerId, offer: state.peerConnection.localDescription });
                } catch (err) {
                    console.error("Fehler bei Neuverhandlung (Angebot erstellen):", err);
                }
            } else {
                console.log("Neuverhandlung benötigt, aber Signalisierungsstatus ist nicht 'stable'. Überspringe Angebotserstellung.", state.peerConnection.signalingState);
            }
        };


        // Add existing local tracks (camera/mic) if available
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => {
                try {
                    state.peerConnection.addTrack(track, state.localStream);
                } catch (e) { console.warn("Track bereits hinzugefügt beim Erstellen der PeerConnection:", e); }
            });
        }
        // Add screen sharing tracks if active
        if (state.isSharingScreen && state.screenStream) {
            state.screenStream.getTracks().forEach(track => {
                try {
                    state.peerConnection.addTrack(track, state.screenStream);
                } catch (e) { console.warn("Screen-Track bereits hinzugefügt:", e); }
            });
        }
        return state.peerConnection;
    }

    async function createOffer(peerId) {
        if (!socket || !state.connected) {
            console.warn("Socket nicht verbunden. Kann kein Angebot erstellen.");
            return;
        }
        if (!peerId) {
            console.warn("Keine Peer-ID zum Senden des Angebots.");
            return;
        }
        
        // Ensure local media is set up before creating offer
        if (!state.localStream) {
            console.log("Lokale Medien werden eingerichtet, bevor ein Angebot erstellt wird...");
            await setupLocalMedia();
            if (!state.localStream) { // Check again if setup failed
                displayError("Lokale Medien konnten nicht eingerichtet werden. Angebot nicht erstellt.");
                return;
            }
        }

        console.log("Erstelle PeerConnection und Angebot für Peer:", peerId);
        const pc = await createPeerConnection(peerId);
        if (!pc) {
            console.error("PeerConnection konnte nicht erstellt werden.");
            return;
        }

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('webRTC-offer', { to: peerId, offer: pc.localDescription });
            console.log('Angebot gesendet an:', peerId);
        } catch (err) {
            console.error('Fehler beim Erstellen des Angebots:', err);
            displayError("Fehler beim Starten des Videoanrufs.");
        }
    }

    function closePeerConnection() {
        if (state.peerConnection) {
            state.peerConnection.getSenders().forEach(sender => {
                if (sender.track) sender.track.stop(); // Stop tracks sent by this PC
            });
            state.peerConnection.onicecandidate = null;
            state.peerConnection.ontrack = null;
            state.peerConnection.oniceconnectionstatechange = null;
            state.peerConnection.onnegotiationneeded = null;
            state.peerConnection.close();
            state.peerConnection = null;
            console.log('PeerConnection geschlossen.');
        }
        state.remoteStream = null;
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null);
    }

    async function toggleScreenSharing() {
        if (!state.connected) return;

        if (state.isSharingScreen) {
            // Stop screen sharing
            state.screenStream.getTracks().forEach(track => {
                track.stop();
                if (state.peerConnection) {
                    const sender = state.peerConnection.getSenders().find(s => s.track === track);
                    if (sender) state.peerConnection.removeTrack(sender);
                }
            });
            state.screenStream = null;
            state.isSharingScreen = false;
            UI.shareScreenBtn.textContent = 'Bildschirm teilen';
            UI.shareScreenBtn.classList.remove('danger-btn');
            
            // Restore camera feed if it was active
            if (state.localStream && state.peerConnection) {
                 state.localStream.getTracks().forEach(track => {
                    if (track.kind === 'video' && !state.peerConnection.getSenders().find(s => s.track === track)) {
                         try { state.peerConnection.addTrack(track, state.localStream); }
                         catch(e) { console.warn("Fehler beim Wiederherstellen des Kamera-Tracks: ", e); }
                    }
                });
            }
             updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);


        } else {
            // Start screen sharing
            try {
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); // audio for system audio
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');
                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true); // Show screen in local view

                // Replace video track in existing peer connection
                if (state.peerConnection) {
                    const videoTrack = state.screenStream.getVideoTracks()[0];
                    const audioTrack = state.screenStream.getAudioTracks()[0]; // If screen audio is captured

                    const videoSender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (videoSender) {
                        videoSender.replaceTrack(videoTrack);
                    } else {
                        state.peerConnection.addTrack(videoTrack, state.screenStream);
                    }
                    if (audioTrack) { // Also replace/add audio track if present
                        const audioSender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
                        // Be careful not to replace microphone audio if screen audio is separate
                        // This simple example might replace mic if it's the first audio track.
                        // A more robust solution would manage multiple audio tracks or mix them.
                        if (audioSender && state.localStream && !state.localStream.getAudioTracks().includes(audioSender.track)) { // if existing audio sender is not mic
                           audioSender.replaceTrack(audioTrack);
                        } else if (audioTrack) {
                           state.peerConnection.addTrack(audioTrack, state.screenStream);
                        }
                    }
                }

                state.screenStream.getVideoTracks()[0].onended = () => { // Listener for browser's "Stop sharing" button
                    if (state.isSharingScreen) toggleScreenSharing();
                };

            } catch (err) {
                console.error('Fehler beim Starten der Bildschirmfreigabe:', err);
                displayError('Bildschirmfreigabe fehlgeschlagen.');
                state.isSharingScreen = false;
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                UI.shareScreenBtn.classList.remove('danger-btn');
            }
        }
    }
    
    function toggleFullscreen(videoElement) {
        if (!document.fullscreenElement) {
            if (videoElement.requestFullscreen) {
                videoElement.requestFullscreen().catch(err => console.error(`Fullscreen error: ${err.message}`));
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    // --- File Handling ---
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) {
            resetFileInput();
            return;
        }
        if (file.size > CONFIG.MAX_FILE_SIZE) {
            displayError(`Datei ist zu groß (max. ${formatFileSize(CONFIG.MAX_FILE_SIZE)}).`);
            resetFileInput();
            return;
        }
        state.selectedFile = file;
        // Optional: Show preview or file name
        UI.messageInput.placeholder = `Datei ausgewählt: ${file.name}. Nachricht optional.`;
    }

    function resetFileInput() {
        state.selectedFile = null;
        UI.fileInput.value = ''; // Reset file input
        UI.messageInput.placeholder = 'Nachricht eingeben...';
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // --- Init ---
    initializeUI();
});
