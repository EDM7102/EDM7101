document.addEventListener('DOMContentLoaded', () => {
    const UI = {
        // serverUrlInput und roomIdInput werden nicht mehr ausgelesen
        usernameInput: document.getElementById('usernameInput'),
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
        micSelect: document.getElementById('micSelect')
    };

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room', // Fester Raumname! Ändere 'default-room' bei Bedarf.
        users: {}, // Speichert User-Infos { id: { username, color } }
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        screenStream: null,
        isSharingScreen: false,
        selectedFile: null,
        typingTimeout: null,
        typingUsers: new Set(), // Set für tippende User hinzugefügt
        lastMessageTimestamp: 0,
        isWindowFocused: true,
        unreadMessages: 0,
        originalTitle: document.title,
        notificationSound: new Audio('notif.mp3'),
        currentPCPartnerId: null,
        allUsersList: [] // Liste aller User vom Server (inkl. self)
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500, // ms
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5 MB
        IMAGE_PREVIEW_MAX_WIDTH: 200,
        IMAGE_PREVIEW_MAX_HEIGHT: 200
    };

    // --- Initialisierung und UI-Helfer ---
    function initializeUI() {
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.classList.add('hidden');
        if(UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.classList.add('hidden');
        if (UI.micSelect) UI.micSelect.disabled = false;
    }

    function setConnectionStatus(statusClass, text) {
        if (!UI.statusIndicator) return;
        UI.statusIndicator.className = `status-indicator ${statusClass}`;
        UI.statusIndicator.textContent = text;
    }

    function displayError(message) {
        if (!UI.errorMessage) return;
        UI.errorMessage.textContent = message;
        UI.errorMessage.classList.remove('hidden');
        setTimeout(() => {
            if (UI.errorMessage) UI.errorMessage.classList.add('hidden');
        }, 5000);
    }

    function updateUIAfterConnect() {
        UI.connectBtn.classList.add('hidden');
        UI.disconnectBtn.classList.remove('hidden');
        UI.shareScreenBtn.classList.remove('hidden');
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        if(UI.fileUploadLabel) UI.fileUploadLabel.classList.remove('hidden');
        if(UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true;
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();
    }

    function updateUIAfterDisconnect() {
        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if(UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
        if(UI.usernameInput) UI.usernameInput.disabled = false;
        if (UI.micSelect) UI.micSelect.disabled = false;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = '0';
        UI.typingIndicator.textContent = '';
        stopLocalStream();
        closePeerConnection();
        if (state.isSharingScreen) {
             state.isSharingScreen = false;
             UI.shareScreenBtn.textContent = 'Bildschirm teilen';
             UI.shareScreenBtn.classList.remove('danger-btn');
        }
        state.users = {};
        state.allUsersList = [];
    }

    function saveStateToLocalStorage() {
        localStorage.setItem('chatClientUsername', UI.usernameInput.value);
    }

    function loadStateFromLocalStorage() {
        const savedUsername = localStorage.getItem('chatClientUsername');
        if (savedUsername) {
            UI.usernameInput.value = savedUsername;
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
        let newHeight = UI.messageInput.scrollHeight;
        const maxHeight = 100;
        if (maxHeight && newHeight > maxHeight) newHeight = maxHeight;
        UI.messageInput.style.height = newHeight + 'px';
    });
    UI.fileInput.addEventListener('change', handleFileSelect);
    if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.localVideo));
    if(UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.remoteVideo));
    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        if (state.connected && !state.isSharingScreen) {
            console.log("Mikrofon geändert, initialisiere Audio neu.");
            await setupLocalMedia();
        }
    });
     window.addEventListener('beforeunload', () => {
        if (socket && socket.connected) {
            socket.disconnect();
        }
    });
    document.addEventListener('fullscreenchange', () => {
        [
            { btn: UI.localVideoFullscreenBtn, video: UI.localVideo },
            { btn: UI.remoteVideoFullscreenBtn, video: UI.remoteVideo }
        ].forEach(item => {
            if(item.btn) {
                item.btn.textContent = (document.fullscreenElement === item.video) ? "Vollbild verlassen" : "Vollbild";
            }
        });
    });

    // ============================================= //
    // === HIER BEGINNEN DIE FUNKTIONSDEFINITIONEN === //
    // ============================================= //

    // --- Utility Functions --- (Wieder eingefügt)
    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str);
        return str.replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function getUserColor(userIdOrName) {
        let hash = 0;
        const str = String(userIdOrName);
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.USER_COLORS[Math.abs(hash) % CONFIG.USER_COLORS.length];
    }

    // --- Media Device Functions --- (populateMicList war hier)
    async function populateMicList() { // **WIEDER EINGEFÜGT**
        if (!UI.micSelect) return; // Stellen Sie sicher, dass das Element existiert
        UI.micSelect.innerHTML = '';
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length === 0) {
                UI.micSelect.appendChild(new Option("Keine Mikrofone", ""));
                return;
            }
            audioInputs.forEach((d, i) => {
                UI.micSelect.appendChild(new Option(d.label || `Mikrofon ${i + 1}`, d.deviceId));
            });
        } catch (e) {
            UI.micSelect.appendChild(new Option("Mikrofonfehler", ""));
            // showError('Mikrofonzugriff verweigert oder fehlgeschlagen.'); // Error wird schon bei setupLocalMedia angezeigt
            console.error("Mic enumeration failed:", e);
        }
    }

    // --- UI Update Functions --- (updateVideoDisplay war hier)
    function updateVideoDisplay(videoElement, statusElement, stream, isLocal = false) { // **WIEDER EINGEFÜGT**
        if (!videoElement || !statusElement) return; // Sicherstellen, dass Elemente existieren

        const fullscreenBtn = isLocal ? UI.localVideoFullscreenBtn : UI.remoteVideoFullscreenBtn;

        if (stream && stream.active && (stream.getVideoTracks().some(t => t.readyState === 'live') || stream.getAudioTracks().some(t => t.readyState === 'live'))) {
            videoElement.srcObject = stream;
            const hasVideo = stream.getVideoTracks().some(t => t.readyState === 'live');

            if (hasVideo) {
                 videoElement.play().catch(e => console.warn("Video play failed", e));
                 videoElement.classList.remove('hidden');
                 statusElement.classList.add('hidden');
            } else { // Nur Audio
                videoElement.classList.add('hidden'); // Kein Video anzeigen
                statusElement.textContent = isLocal ? "DEIN AUDIO AKTIV" : "REMOTE AUDIO AKTIV";
                statusElement.className = 'screen-status-label loading'; // Oder eine andere Klasse für Audio
                statusElement.classList.remove('hidden');
            }
            if (fullscreenBtn && hasVideo) fullscreenBtn.classList.remove('hidden');
            else if (fullscreenBtn) fullscreenBtn.classList.add('hidden');

        } else {
            if (videoElement.srcObject) {
                 videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
            videoElement.srcObject = null;
            videoElement.classList.add('hidden');
            statusElement.textContent = isLocal ? "KAMERA AUS / FEHLER" : "KEIN VIDEO/SCREEN";
            statusElement.className = 'screen-status-label offline';
            statusElement.classList.remove('hidden');
            if (fullscreenBtn) fullscreenBtn.classList.add('hidden');
        }
    }

     function updateUserList(usersArray) { // Nimmt Array vom Server entgegen
        state.allUsersList = usersArray; // Speichere die komplette Liste (inkl. Self)
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder'); // ID korrigiert
        if(userCountPlaceholder) userCountPlaceholder.textContent = usersArray.length;

        usersArray.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id)); // Farbe vom Server oder generiert
            li.appendChild(dot);
            const nameNode = document.createTextNode(` ${escapeHTML(user.username)}`);

            if (user.id === socket?.id) { // Prüfe gegen aktuelle Socket-ID
                 const strong = document.createElement('strong');
                 strong.appendChild(nameNode);
                 strong.appendChild(document.createTextNode(" (Du)"));
                 li.appendChild(strong);
            } else {
                li.appendChild(nameNode);
            }
            UI.userList.appendChild(li);
        });
    }

     function updateTypingIndicatorDisplay() {
        if (!UI.typingIndicator) return;
        const typingUsernames = state.typingUsers;
        if (typingUsernames && typingUsernames.size > 0) {
            const usersString = Array.from(typingUsernames).map(escapeHTML).join(', ');
            UI.typingIndicator.textContent = `${usersString} schreibt...`;
            UI.typingIndicator.style.display = 'block';
        } else {
            UI.typingIndicator.style.display = 'none';
        }
    }

    // --- WebSocket Logic ---
    function connect() {
        const serverUrl = window.location.origin;
        const roomId = state.roomId; // Aus dem State nehmen
        let username = UI.usernameInput.value.trim();

        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username;
        state.username = username;

        console.log(`Verbinde mit ${serverUrl} in Raum ${state.roomId}`);

        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket']
        });
        setConnectionStatus('connecting', 'Verbinde...');
        setupSocketListeners(); // Listener hier aufrufen
    }

    function setupSocketListeners() { // Alle .on Listener hier rein
        if (!socket) return;

        socket.on('connect', () => {
            state.connected = true;
            updateUIAfterConnect();
            console.log('Verbunden mit Server, ID:', socket.id);
            // Server sendet userList / joinSuccess
            setupLocalMedia(); // Lokale Medien starten
        });

        socket.on('connect_error', (err) => {
            displayError(`Verbindungsfehler: ${err.message}. Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            updateUIAfterDisconnect();
        });

        socket.on('disconnect', (reason) => {
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect();
        });

        socket.on('joinSuccess', async ({ users: currentUsers, id: myId }) => {
             console.log("Join erfolgreich erhalten. ID:", myId, "Benutzer:", currentUsers);
             state.socketId = myId;
             updateUserList(currentUsers);
             initiateP2PConnection();
         });

         socket.on('joinError', ({ message }) => {
             displayError(message);
             if (socket) socket.disconnect();
         });

         socket.on('userListUpdate', (currentUsersList) => {
             console.log("Benutzerliste aktualisiert:", currentUsersList);
             const oldPartnerStillPresent = state.currentPCPartnerId && currentUsersList.some(u => u.id === state.currentPCPartnerId);

             updateUserList(currentUsersList); // Anzeige aktualisieren

             if (!oldPartnerStillPresent && state.currentPCPartnerId) {
                  console.log("P2P Partner hat Chat verlassen.");
                  closePeerConnection();
             }
             if (!state.currentPCPartnerId && currentUsersList.some(u => u.id !== socket?.id)) {
                 initiateP2PConnection(); // Neuen Partner suchen, wenn möglich
             }
         });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            notifyUnreadMessage();
        });
         socket.on('file', (fileMsgData) => {
             appendMessage({ ...fileMsgData, type: 'file' });
             if (fileMsgData.username !== state.username && state.isConnected && document.hidden === false) notifyUnreadMessage();
         });


        socket.on('typing', ({ username, isTyping }) => {
            if (username === state.username) return;
            if (isTyping) {
                state.typingUsers.add(username);
            } else {
                state.typingUsers.delete(username);
            }
            updateTypingIndicatorDisplay();
        });

         socket.on('webRTC-offer', async ({ from, offer }) => {
            console.log('Angebot erhalten von:', from);
             if (state.peerConnection) {
                console.warn("Bestehende PeerConnection beim Empfangen eines neuen Angebots.");
                closePeerConnection();
            }
            await createPeerConnection(from);
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            if(!state.localStream) await setupLocalMedia();
            const answer = await state.peerConnection.createAnswer();
            await state.peerConnection.setLocalDescription(answer);
            socket.emit('webRTC-answer', { to: from, answer: state.peerConnection.localDescription });
            console.log('Antwort gesendet an:', from);
        });

        socket.on('webRTC-answer', async ({ from, answer }) => {
            console.log('Antwort erhalten von:', from);
            if (state.peerConnection && state.peerConnection.signalingState === "have-local-offer") { // Nur nach Offer anwenden
                 await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } else {
                console.warn("Antwort erhalten, aber PeerConnection nicht im erwarteten Zustand.");
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            if (state.peerConnection && state.peerConnection.remoteDescription) {
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Fehler beim Hinzufügen des ICE Kandidaten:', e);
                }
            } else {
                 console.warn("ICE Kandidat erhalten, aber PeerConnection nicht bereit.");
            }
        });
    } // Ende setupSocketListeners

    function disconnect() {
        if (socket) {
            socket.disconnect();
        } else {
             updateUIAfterDisconnect();
        }
    }

    // --- Chat Logic ---
    function sendMessage() {
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) return;
        if (!socket || !state.connected) return;

        const messageBase = { content, timestamp: new Date().toISOString() };

        if (state.selectedFile) {
            const message = {
                ...messageBase,
                type: 'file',
                file: {
                    name: state.selectedFile.name,
                    type: state.selectedFile.type,
                    size: state.selectedFile.size
                }
            };
            if (state.selectedFile.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    message.file.dataUrl = e.target.result;
                    socket.emit('file', message); // Sende 'file' event an server
                    resetFileInput();
                };
                reader.readAsDataURL(state.selectedFile);
            } else {
                socket.emit('file', message); // Sende 'file' event (ohne dataUrl)
                resetFileInput();
            }
        } else {
            const message = { ...messageBase, type: 'text' };
            socket.emit('message', message); // Sende 'message' event
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false);
    }

    function appendMessage(msg) { // Wird vom Server für 'chatMessage' und 'file' aufgerufen
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.username === state.username;
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username);
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.username));

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');

        if (msg.type === 'file' && msg.file) {
             const fileInfo = document.createElement('div');
             fileInfo.classList.add('file-attachment');
             if (msg.file.dataUrl && msg.file.type.startsWith('image/')) {
                 const img = document.createElement('img');
                 img.src = msg.file.dataUrl;
                 img.alt = escapeHTML(msg.file.name);
                 img.style.maxWidth = `${CONFIG.IMAGE_PREVIEW_MAX_WIDTH}px`;
                 img.style.maxHeight = `${CONFIG.IMAGE_PREVIEW_MAX_HEIGHT}px`;
                 img.onclick = () => openImageModal(img.src);
                 fileInfo.appendChild(img);
             } else {
                 fileInfo.innerHTML += `<span style="font-size: 1.5em;">📄</span>`;
             }
             const linkText = `${escapeHTML(msg.file.name)} (${formatFileSize(msg.file.size)})`;
             if (msg.file.dataUrl) {
                 fileInfo.innerHTML += ` <a href="${msg.file.dataUrl}" download="${escapeHTML(msg.file.name)}">${linkText}</a>`;
             } else {
                 fileInfo.innerHTML += ` <span>${linkText} (Kein direkter Download)</span>`;
             }
              if (msg.content) {
                 const textNode = document.createElement('p');
                 textNode.style.marginTop = '5px'; // Kleiner Abstand
                 textNode.textContent = escapeHTML(msg.content);
                 fileInfo.appendChild(textNode);
             }
             contentDiv.appendChild(fileInfo);

        } else { // Normale Textnachricht
            contentDiv.textContent = escapeHTML(msg.content || '');
        }

        const timeSpan = document.createElement('span');
        timeSpan.classList.add('timestamp');
        timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);
        msgDiv.appendChild(timeSpan);
        UI.messagesContainer.appendChild(msgDiv);

        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 10;
        if (isMe || isScrolledToBottom || state.lastMessageTimestamp === 0) {
             UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
        state.lastMessageTimestamp = Date.now();
    }

    function openImageModal(src) {
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;justify-content:center;align-items:center;z-index:1000;cursor:pointer;';
        modal.onclick = () => modal.remove();

        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:90%;max-height:90%;object-fit:contain;';

        modal.appendChild(img);
        document.body.appendChild(modal);
    }

    function appendSystemMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'system');
        msgDiv.textContent = escapeHTML(text);
        UI.messagesContainer.appendChild(msgDiv);
        UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
    }

    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) return;
        clearTimeout(state.typingTimeout);
        socket.emit('typing', { isTyping });
        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- WebRTC Logic ---
    async function setupLocalMedia() { // Wird bei connect aufgerufen
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                 video: { width: { ideal: 640 }, height: { ideal: 480 } },
                 audio: { echoCancellation: true, noiseSuppression: true }
             });
            state.localStream = stream;
            // Diese Zeile ruft updateVideoDisplay auf, das definiert sein muss!
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.classList.remove('hidden');

            if (state.peerConnection) {
                replaceTracksInPeerConnection(state.localStream);
            }
            return true;
        } catch (err) {
            console.error('Fehler beim Zugriff auf lokale Medien:', err);
            displayError('Zugriff auf Kamera/Mikrofon fehlgeschlagen.');
            // Diese Zeile ruft updateVideoDisplay auf, das definiert sein muss!
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
            return false;
        }
    }

    function stopLocalStream() {
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
        }
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(track => track.stop());
            state.screenStream = null;
        }
    }

     async function createPeerConnection(peerId) {
        if (state.peerConnection) closePeerConnection();

        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.currentPCPartnerId = peerId;
        console.log("PeerConnection erstellt für Partner:", peerId);

        state.peerConnection.onicecandidate = event => {
            if (event.candidate && socket && state.connected) {
                socket.emit('webRTC-ice-candidate', { to: peerId, candidate: event.candidate });
            }
        };

        state.peerConnection.ontrack = event => {
            console.log("Remote Track empfangen:", event.track.kind);
            if (event.streams && event.streams[0]) {
                state.remoteStream = event.streams[0];
                 updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream);
            } else {
                 if (!state.remoteStream) state.remoteStream = new MediaStream();
                 state.remoteStream.addTrack(event.track);
                 updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream);
            }
        };

        state.peerConnection.oniceconnectionstatechange = () => {
             if (!state.peerConnection) return;
             console.log("ICE Connection Status:", state.peerConnection.iceConnectionState);
             const partner = state.allUsersList.find(u => u.id === state.currentPCPartnerId);
             const partnerUsername = partner ? partner.username : 'Peer';
             switch(state.peerConnection.iceConnectionState) {
                 case "checking":
                     UI.remoteScreenStatus.textContent = "VERBINDE...";
                     UI.remoteScreenStatus.className = 'screen-status-label loading';
                     UI.remoteScreenStatus.classList.remove('hidden');
                     UI.remoteVideo.classList.add('hidden');
                     break;
                 case "connected":
                 case "completed":
                     setConnectionStatus('connected', `Video verbunden mit ${partnerUsername}`);
                     break;
                 case "disconnected":
                 case "failed":
                 case "closed":
                     displayError(`Video-Verbindung zu ${partnerUsername} ${state.peerConnection.iceConnectionState}.`);
                     closePeerConnection();
                     initiateP2PConnection(); // Versuche neu zu verbinden
                     break;
             }
         };

         state.peerConnection.onnegotiationneeded = async () => {
             console.log("Neuverhandlung benötigt.");
             // Hier keine automatische Offer-Erstellung mehr, um Loops zu vermeiden
             // Offers sollten gezielt ausgelöst werden, z.B. wenn ein Track manuell hinzugefügt wird.
         };

        // Lokale Tracks hinzufügen
        addTracksToPeerConnection(state.localStream);
        addTracksToPeerConnection(state.screenStream); // Fügt Screen-Tracks hinzu, falls vorhanden

         return state.peerConnection;
    }

    function addTracksToPeerConnection(stream) {
        if (stream && state.peerConnection) {
             stream.getTracks().forEach(track => {
                 if (!state.peerConnection.getSenders().find(s => s.track === track)) {
                    try { state.peerConnection.addTrack(track, stream); } catch(e) {}
                 }
             });
        }
    }
    function replaceTracksInPeerConnection(stream) {
        if(stream && state.peerConnection){
             stream.getTracks().forEach(track => {
                 const sender = state.peerConnection.getSenders().find(s => s.track?.kind === track.kind);
                 if (sender) {
                     sender.replaceTrack(track).catch(e => console.error("Fehler replaceTrack:", e));
                 } else {
                     try { state.peerConnection.addTrack(track, stream); } catch(e){}
                 }
             });
        }
    }

     async function renegotiateIfNeeded() { // Nur aufrufen, wenn nötig (z.B. nach Track-Änderung)
         if (!state.peerConnection || !state.currentPCPartnerId || state.peerConnection.signalingState !== 'stable') {
             console.log("Überspringe Neuverhandlung (Bedingungen nicht erfüllt)");
             return;
         }
         console.log("Initiiere Neuverhandlung Offer...");
         try {
             const offer = await state.peerConnection.createOffer();
             await state.peerConnection.setLocalDescription(offer);
             socket.emit('webRTC-offer', { to: state.currentPCPartnerId, offer: state.peerConnection.localDescription });
         } catch (err) {
             console.error('Fehler bei Neuverhandlung Offer:', err);
         }
     }

    function closePeerConnection() {
        if (state.peerConnection) {
            console.log("Schließe PeerConnection mit:", state.currentPCPartnerId);
            state.peerConnection.close();
            state.peerConnection = null;
        }
        state.currentPCPartnerId = null;
        state.remoteStream = null;
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null);
    }

     function initiateP2PConnection() {
         if (!state.isConnected || !socket || state.peerConnection) return; // Nur wenn verbunden und keine PC besteht

         const otherUsers = state.allUsersList.filter(u => u.id !== socket.id);
         if (otherUsers.length === 0) return;

         const targetUser = otherUsers[0];
         // Hier einfache Logik: Der mit der "kleineren" ID initiiert das Offer
         const shouldInitiate = socket.id < targetUser.id;

         if (shouldInitiate) {
             console.log("Initiiere P2P Offer mit:", targetUser.username);
             setupLocalMedia().then(success => {
                 if (success) {
                     createPeerConnection(targetUser.id).then(() => {
                         renegotiateIfNeeded(); // Send initial offer
                     });
                 }
             });
         } else {
              console.log("Warte auf Offer von:", targetUser.username);
              // Erstelle PeerConnection, um auf Offer vorbereitet zu sein
              if(!state.peerConnection) createPeerConnection(targetUser.id);
         }
     }


    async function toggleScreenSharing() {
        if (!state.connected) return;
        UI.shareScreenBtn.disabled = true;

        if (state.isSharingScreen) {
            // --- Stoppe Screensharing ---
             if (state.screenStream) {
                 state.screenStream.getTracks().forEach(track => track.stop());
             }
             state.screenStream = null;
             state.isSharingScreen = false;
             UI.shareScreenBtn.textContent = 'Bildschirm teilen';
             UI.shareScreenBtn.classList.remove('danger-btn');

             // Ersetze Screen-Tracks durch Kamera-Tracks in PeerConnection
             if (state.peerConnection && state.localStream) {
                 replaceTracksInPeerConnection(state.localStream); // Fügt Kamera/Mic (wieder) hinzu/ersetzt Screen
                 await renegotiateIfNeeded();
             }
             // Zeige wieder Kamera lokal an
             if (state.localStream) {
                 updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
             } else {
                 await setupLocalMedia(); // Falls kein Kamera-Stream da war
             }

        } else {
            // --- Starte Screensharing ---
            try {
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');
                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true);

                if (state.peerConnection) {
                    replaceTracksInPeerConnection(state.screenStream); // Ersetzt Kamera/Mic durch Screen
                    await renegotiateIfNeeded();
                }

                state.screenStream.getVideoTracks()[0].onended = () => {
                    if (state.isSharingScreen) toggleScreenSharing();
                };

            } catch (err) {
                console.error('Fehler beim Starten der Bildschirmfreigabe:', err);
                displayError('Bildschirmfreigabe fehlgeschlagen.');
                state.isSharingScreen = false;
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                UI.shareScreenBtn.classList.remove('danger-btn');
                 if (state.localStream) updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            }
        }
        UI.shareScreenBtn.disabled = false;
    }

    function toggleFullscreen(videoElement) {
        if (!videoElement || videoElement.classList.contains('hidden')) return; // Nur wenn Video sichtbar
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
        UI.messageInput.placeholder = `Datei ausgewählt: ${file.name}. Nachricht optional.`;
    }

    function resetFileInput() {
        state.selectedFile = null;
        if(UI.fileInput) UI.fileInput.value = '';
        UI.messageInput.placeholder = 'Nachricht eingeben...';
    }


    // --- Init ---
    initializeUI();
    populateMicList(); // **Wird jetzt hier aufgerufen**

}); // Ende DOMContentLoaded Listener
