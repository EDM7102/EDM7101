// --- Application Module ---
const EDMBookApp = (() => {
    // --- Configuration & State ---
    const CONFIG = {
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
        TYPING_TIMEOUT_MS: 2000,
        USER_COLORS: [
            '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6',
            '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3'
        ],
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
                // Für robustere Verbindungen in Produktion könnten TURN-Server nötig sein.
                // {
                //   urls: 'turn:dein.turn.server.com:3478',
                //   username: 'deinBenutzername',
                //   credential: 'deinPasswort'
                // }
            ]
        }
    };

    let state = {
        socket: null,
        peerConnection: null,
        localStream: null,
        username: '',
        userColor: '',
        allUsersList: [], // Array von {id, name, color} Objekten (inkl. eigenem User, vom Server)
        typingUsers: new Set(),
        typingTimeoutId: null,
        isConnected: false,
        isScreenSharing: false,
        currentPCPartnerId: null // ID des aktuellen P2P Partners
    };

    // --- DOM Elements Cache ---
    const UI = {
        usernameInput: document.getElementById('usernameInput'),
        connectBtn: document.getElementById('connectBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        shareScreenBtn: document.getElementById('shareScreenBtn'),
        messagesContainer: document.getElementById('messagesContainer'),
        userList: document.getElementById('userList'),
        userCount: document.getElementById('userCount'),
        micSelect: document.getElementById('micSelect'),
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        myVideo: document.getElementById('myVideo'),
        remoteVideo: document.getElementById('remoteVideo'),
        myScreenStatus: document.getElementById('myScreenStatus'),
        remoteScreenStatus: document.getElementById('remoteScreenStatus'),
        myVideoBox: document.getElementById('myScreenBox'),
        remoteVideoBox: document.getElementById('remoteScreenBox'),
        errorDisplay: document.getElementById('errorDisplay'),
        typingIndicator: document.getElementById('typingIndicator'),
        fileInput: document.getElementById('fileInput'),
        fileUploadLabel: document.querySelector('.file-upload-label'),
        connectionStatusBadge: document.getElementById('connectionStatus'),
        notifSound: document.getElementById('notifSound'),
        fullscreenBtns: document.querySelectorAll('.fullscreen-btn')
    };

    // --- Utility Functions ---
    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str); // Sicherstellen, dass es ein String ist
        return str.replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    function showError(message, duration = 5000) {
        UI.errorDisplay.textContent = message;
        UI.errorDisplay.style.display = 'block';
        setTimeout(() => { UI.errorDisplay.style.display = 'none'; }, duration);
        console.error("App Error:", message);
    }

    function playNotifSound() {
        if (UI.notifSound && UI.notifSound.readyState >= 2) { // HAVE_CURRENT_DATA oder mehr
            UI.notifSound.currentTime = 0;
            UI.notifSound.play().catch(e => console.warn("Notification sound play failed:", e));
        }
    }

    function getTimestamp() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // --- UI Update Functions ---
    function updateConnectionStatusDisplay(statusText, statusClass) {
        UI.connectionStatusBadge.textContent = statusText;
        UI.connectionStatusBadge.className = `status-indicator ${statusClass}`;
    }

    function setAppConnected(connected) {
        state.isConnected = connected;
        if (connected) {
            updateConnectionStatusDisplay('Verbunden', 'connected');
            UI.usernameInput.readOnly = true;
            UI.connectBtn.classList.add('hidden');
            UI.disconnectBtn.classList.remove('hidden');
            UI.shareScreenBtn.classList.remove('hidden');
            UI.messageInput.disabled = false;
            UI.sendBtn.disabled = false;
            UI.fileInput.disabled = false;
            UI.fileUploadLabel.style.pointerEvents = 'auto';
            UI.fileUploadLabel.style.opacity = '1';
            UI.micSelect.disabled = true;
        } else {
            updateConnectionStatusDisplay('Getrennt', 'disconnected');
            UI.usernameInput.readOnly = false;
            UI.connectBtn.classList.remove('hidden');
            UI.disconnectBtn.classList.add('hidden');
            UI.shareScreenBtn.classList.add('hidden');
            UI.userList.innerHTML = '';
            UI.userCount.textContent = '0';
            UI.typingIndicator.style.display = 'none';
            state.typingUsers.clear();
            resetVideoElements();
            UI.messageInput.disabled = true;
            UI.sendBtn.disabled = true;
            UI.fileInput.disabled = true;
            UI.fileUploadLabel.style.pointerEvents = 'none';
            UI.fileUploadLabel.style.opacity = '0.5';
            UI.micSelect.disabled = false;
            state.currentPCPartnerId = null; // Wichtig bei Disconnect
        }
    }

    function appendMessageToDOM(msgData) {
        const { username: uname, text, color, type = 'text', fileName, fileType, fileData } = msgData;
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');

        const isMe = uname === state.username; // Vergleiche mit dem im State gespeicherten Namen
        const senderUser = state.allUsersList.find(u => u.username === uname); // Finde User-Objekt für Farbe etc.
        const displayName = escapeHTML(uname);
        const displayColor = escapeHTML(senderUser ? senderUser.color : (isMe ? state.userColor : CONFIG.USER_COLORS[0]));


        if (isMe) msgDiv.classList.add('me');

        let contentHTML = `<span class="name" style="color:${displayColor}">${displayName}:</span>`;

        if (type === 'file') {
            if (fileType && fileType.startsWith('image/')) {
                contentHTML += `<div class="file-attachment">
                                <img src="${escapeHTML(fileData)}" alt="${escapeHTML(fileName)}" onclick="this.requestFullscreen()" title="Klicken für Vollbild"/>
                                <a href="${escapeHTML(fileData)}" download="${escapeHTML(fileName)}">${escapeHTML(fileName)}</a>
                              </div>`;
            } else {
                contentHTML += `<div class="file-attachment">
                                <span>📄</span>
                                <a href="${escapeHTML(fileData)}" download="${escapeHTML(fileName)}">${escapeHTML(fileName)}</a>
                              </div>`;
            }
        } else {
            contentHTML += escapeHTML(text);
        }
        contentHTML += `<span class="timestamp">${getTimestamp()}</span>`;
        msgDiv.innerHTML = contentHTML;

        UI.messagesContainer.appendChild(msgDiv);
        if (UI.messagesContainer.scrollHeight - UI.messagesContainer.scrollTop < UI.messagesContainer.clientHeight + 200) {
             UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
    }

    function updateUserListDisplay(usersArray) {
        state.allUsersList = usersArray;
        UI.userList.innerHTML = '';
        UI.userCount.textContent = usersArray.length;
        usersArray.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            dot.style.backgroundColor = escapeHTML(user.color || CONFIG.USER_COLORS[0]);
            li.appendChild(dot);
            li.appendChild(document.createTextNode(` ${escapeHTML(user.username)}`));
            if (user.id === state.socket?.id) {
                 li.appendChild(document.createTextNode(" (Du)"));
                 li.style.fontWeight = 'bold';
            }
            UI.userList.appendChild(li);
        });
    }

    function updateTypingIndicatorDisplay() {
        if (state.typingUsers.size > 0) {
            const usersString = Array.from(state.typingUsers).map(escapeHTML).join(', ');
            UI.typingIndicator.textContent = `${usersString} schreibt...`;
            UI.typingIndicator.style.display = 'block';
        } else {
            UI.typingIndicator.style.display = 'none';
        }
    }

    function updateVideoDisplay(videoElement, statusElement, stream, isMyStream = false) {
        const boxElement = isMyStream ? UI.myVideoBox : UI.remoteVideoBox;
        const fullscreenBtn = boxElement.querySelector('.fullscreen-btn');

        if (stream && stream.active && (stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].readyState === 'live' || stream.getAudioTracks().length > 0 && stream.getAudioTracks()[0].readyState === 'live')) {
            videoElement.srcObject = stream;
            if (stream.getVideoTracks().length > 0) { // Nur Video abspielen, wenn Videospur vorhanden
                 videoElement.play().catch(e => console.warn("Video play failed", e));
                 videoElement.classList.remove('hidden');
                 statusElement.classList.add('hidden');
            } else { // Nur Audio
                videoElement.classList.add('hidden'); // Kein Video anzeigen
                statusElement.textContent = isMyStream ? "DEIN AUDIO AKTIV" : "REMOTE AUDIO AKTIV";
                statusElement.className = 'screen-status-label loading'; // Oder eine andere Klasse für Audio
                statusElement.classList.remove('hidden');
            }
            if (fullscreenBtn && stream.getVideoTracks().length > 0) fullscreenBtn.classList.remove('hidden');
            else if (fullscreenBtn) fullscreenBtn.classList.add('hidden');

        } else {
            if (videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
            videoElement.srcObject = null;
            videoElement.classList.add('hidden');
            statusElement.textContent = isMyStream ? "MEIN SCREEN/AUDIO OFFLINE" : "REMOTE SCREEN/AUDIO OFFLINE";
            statusElement.className = 'screen-status-label offline';
            statusElement.classList.remove('hidden');
            if (fullscreenBtn) fullscreenBtn.classList.add('hidden');
        }
    }
    function resetVideoElements() {
        updateVideoDisplay(UI.myVideo, UI.myScreenStatus, null, true);
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
        state.isScreenSharing = false;
        UI.shareScreenBtn.textContent = "🖥 Bildschirm teilen";
        UI.shareScreenBtn.classList.remove('danger-btn');
    }

    // --- Media Device Functions ---
    async function populateMicList() {
        UI.micSelect.innerHTML = ''; // Clear previous options
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); // Permissions prompt
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
            showError('Mikrofonzugriff verweigert oder fehlgeschlagen.');
            console.error("Mic enumeration failed:", e);
        }
    }

    async function initializeLocalMedia(isScreenShare = false) {
        try {
            if (state.localStream) {
                state.localStream.getTracks().forEach(track => track.stop());
            }

            let mediaStream;
            const audioConstraints = UI.micSelect.value ? { deviceId: { exact: UI.micSelect.value } } : true;

            if (isScreenShare) {
                mediaStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always" },
                    audio: { echoCancellation: true, noiseSuppression: true } // Versuche, Audio vom Screen mit aufzunehmen
                });
                state.isScreenSharing = true;
                updateVideoDisplay(UI.myVideo, UI.myScreenStatus, mediaStream, true);
                mediaStream.getVideoTracks()[0].onended = () => handleStopScreenShareByUser();
            } else { // Audio-only stream
                mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                state.isScreenSharing = false; // Sicherstellen
                 // updateVideoDisplay(UI.myVideo, UI.myScreenStatus, mediaStream, true); // Zeigt "DEIN AUDIO AKTIV"
                 updateVideoDisplay(UI.myVideo, UI.myScreenStatus, new MediaStream(mediaStream.getAudioTracks()), true);
            }
            state.localStream = mediaStream;

            if (state.peerConnection) {
                // Bestehende Tracks entfernen und neue hinzufügen
                state.peerConnection.getSenders().forEach(sender => {
                   if(sender.track) state.peerConnection.removeTrack(sender).catch(e => console.warn("Error removing track:", e));
                });
                for (const track of state.localStream.getTracks()) {
                    try {
                        state.peerConnection.addTrack(track, state.localStream);
                    } catch (e) { console.warn("Error adding track in initLocalMedia:", e); }
                }
                await renegotiateIfNeeded(); // Aushandlung nach Track-Änderung
            }
        } catch (error) {
            console.error("Error initializing media:", error);
            showError(`Medienzugriff fehlgeschlagen: ${error.name}.`);
            if (isScreenShare) handleStopScreenShareByUser(); // UI zurücksetzen
            return false;
        }
        return true;
    }
     function handleStopScreenShareByUser() {
        state.isScreenSharing = false;
        updateVideoDisplay(UI.myVideo, UI.myScreenStatus, null, true);
        UI.shareScreenBtn.textContent = "🖥 Bildschirm teilen";
        UI.shareScreenBtn.classList.remove('danger-btn');

        if (state.localStream) { // Nur Videotrack stoppen, Audiotrack vom Mikrofon ggf. behalten/neu starten
            state.localStream.getVideoTracks().forEach(track => track.stop());
        }

        // Wichtig: P2P-Verbindung informieren oder neu initialisieren nur mit Audio
        initializeLocalMedia(false).then(() => {
            if (state.peerConnection && state.currentPCPartnerId) {
                 renegotiateIfNeeded();
            }
        });
    }


    // --- WebRTC Functions ---
    function createPeerConnection(targetSocketId) {
        if (state.peerConnection) {
            state.peerConnection.close();
        }
        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.currentPCPartnerId = targetSocketId; // Partner merken
        console.log("PeerConnection created for target:", targetSocketId);

        state.peerConnection.onicecandidate = event => {
            if (event.candidate && state.socket && state.isConnected) {
                state.socket.emit('webrtcSignaling', { type: 'iceCandidate', candidate: event.candidate, target: targetSocketId });
            }
        };

        state.peerConnection.ontrack = event => {
            console.log("Remote track received:", event.track.kind, "Stream:", event.streams[0].id);
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, event.streams[0]);
        };

        state.peerConnection.oniceconnectionstatechange = () => {
            if (!state.peerConnection) return;
            console.log("ICE connection state:", state.peerConnection.iceConnectionState);
             switch (state.peerConnection.iceConnectionState) {
                case 'checking':
                    updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null);
                    UI.remoteScreenStatus.textContent = "VERBINDE...";
                    UI.remoteScreenStatus.className = 'screen-status-label loading';
                    UI.remoteScreenStatus.classList.remove('hidden');
                    break;
                case 'failed':
                case 'disconnected':
                case 'closed':
                    updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null);
                    if (state.currentPCPartnerId === targetSocketId) { // Nur wenn es der aktuelle Partner war
                        state.currentPCPartnerId = null;
                    }
                     // Versuche ggf. neu zu verbinden, wenn noch andere User da sind
                    initiateP2PConnection();
                    break;
                 case 'connected': // Fall through
                 case 'completed':
                    // Handled by ontrack
                    break;
            }
        };
        // Lokale Tracks hinzufügen, falls vorhanden
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => {
                try {
                    state.peerConnection.addTrack(track, state.localStream);
                } catch(e) { console.warn("Error adding track to new PC:", e); }
            });
        }
    }

    async function renegotiateIfNeeded() {
        if (!state.peerConnection || !state.isConnected || !state.currentPCPartnerId) {
            console.warn("Renegotiation check: No peer connection, not connected, or no partner.");
            return;
        }
        // Nur wenn der Polling-State 'stable' ist oder ein Offer erstellt werden muss
        if (state.peerConnection.signalingState === 'stable' || state.peerConnection.signalingState === 'have-local-offer') {
            try {
                console.log("Renegotiating: Creating offer for", state.currentPCPartnerId);
                const offer = await state.peerConnection.createOffer({
                    offerToReceiveAudio: 1,
                    offerToReceiveVideo: 1
                });
                await state.peerConnection.setLocalDescription(offer);
                state.socket.emit('webrtcSignaling', { type: 'offer', sdp: offer, target: state.currentPCPartnerId });
            } catch (e) {
                showError("Fehler bei WebRTC-Neuverhandlung.");
                console.error("Renegotiation error:", e);
            }
        } else {
            console.log("Skipping renegotiation, signalingState:", state.peerConnection.signalingState);
        }
    }

    function closePeerConnection() {
        if (state.peerConnection) {
            console.log("Closing PeerConnection with partner:", state.currentPCPartnerId);
            state.peerConnection.close();
            state.peerConnection = null;
        }
        state.currentPCPartnerId = null;
        resetVideoElements(); // UI für Videos zurücksetzen
    }

    function initiateP2PConnection() {
        if (!state.isConnected || !state.socket) return;

        const otherUsers = state.allUsersList.filter(u => u.id !== state.socket.id);
        if (otherUsers.length === 0) {
            console.log("Keine anderen Benutzer für P2P vorhanden.");
            if(state.peerConnection) closePeerConnection(); // Bestehende Verbindung schließen
            return;
        }

        // Wenn schon eine Verbindung besteht und der Partner noch da ist, nichts tun
        if (state.currentPCPartnerId && otherUsers.some(u => u.id === state.currentPCPartnerId)) {
            console.log("P2P Verbindung zu", state.currentPCPartnerId, "besteht bereits und Partner ist online.");
            return;
        }

        // Wenn der aktuelle Partner nicht mehr da ist oder keine Verbindung besteht, neue aufbauen
        if (state.peerConnection) closePeerConnection(); // Alte schließen

        const targetUser = otherUsers[0]; // Einfach den ersten anderen Benutzer nehmen
        console.log("Initiating P2P with:", targetUser.username, targetUser.id);
        createPeerConnection(targetUser.id);
        renegotiateIfNeeded(); // Offer senden
    }


    // --- Socket.IO Event Handlers ---
    function setupSocketListeners() {
        if (!state.socket) return;

        state.socket.on('connect', () => {
            console.log('Socket verbunden:', state.socket.id);
            updateConnectionStatusDisplay('Authentifiziere...', 'connecting');
            state.userColor = CONFIG.USER_COLORS[Math.floor(Math.random() * CONFIG.USER_COLORS.length)];
            state.socket.emit('join', { username: state.username, color: state.userColor });
        });

        state.socket.on('joinSuccess', async ({ users: currentUsers, id: myId }) => {
            console.log("Join erfolgreich. Meine ID:", myId, "Benutzer:", currentUsers);
            state.socket.id = myId; // Eigene Socket ID speichern
            setAppConnected(true);
            updateUserListDisplay(currentUsers);

            if (!await initializeLocalMedia(false)) { // false für initial Audio
                showError("Konnte Audio nicht initialisieren. Voice/Video-Chat eingeschränkt.");
            }
            initiateP2PConnection(); // P2P Verbindung mit erstem User versuchen
        });

        state.socket.on('joinError', ({ message }) => {
            showError(message);
            if (state.socket) state.socket.disconnect();
        });

        state.socket.on('userListUpdate', (currentUsersList) => {
            console.log("Benutzerliste aktualisiert:", currentUsersList);
            const oldUserCount = state.allUsersList.length;
            const oldPartnerStillPresent = state.currentPCPartnerId && currentUsersList.some(u => u.id === state.currentPCPartnerId);

            // Systemnachrichten für Join/Leave (optional)
            const previousUserIds = new Set(state.allUsersList.map(u => u.id));
            currentUsersList.forEach(u => {
                if (u.id !== state.socket?.id && !previousUserIds.has(u.id)) {
                    appendMessageToDOM({ username: 'System', text: `${u.username} ist beigetreten.`, color: 'var(--accent-color)'});
                    if (state.isConnected && document.hidden === false) playNotifSound();
                }
            });
            state.allUsersList.forEach(oldUser => {
                 if (oldUser.id !== state.socket?.id && !currentUsersList.some(newUser => newUser.id === oldUser.id)) {
                    appendMessageToDOM({ username: 'System', text: `${oldUser.username} hat den Chat verlassen.`, color: 'var(--accent-color)'});
                 }
            });

            updateUserListDisplay(currentUsersList);

            if (!oldPartnerStillPresent && state.currentPCPartnerId) {
                 console.log("P2P Partner hat Chat verlassen. Schließe Verbindung.");
                 closePeerConnection();
            }
            // Versuche neue P2P Verbindung, wenn keine besteht oder Partner weg ist und andere da sind
            if (!state.currentPCPartnerId && currentUsersList.some(u => u.id !== state.socket?.id)) {
                initiateP2PConnection();
            }
        });

        state.socket.on('message', (msgData) => {
            appendMessageToDOM(msgData);
            if (msgData.username !== state.username && state.isConnected && document.hidden === false) playNotifSound();
        });

        state.socket.on('file', (fileMsgData) => {
            appendMessageToDOM({ ...fileMsgData, type: 'file' });
            if (fileMsgData.username !== state.username && state.isConnected && document.hidden === false) playNotifSound();
        });

        state.socket.on('typing', ({ username: typingUser, isTyping }) => {
            if (typingUser === state.username) return;
            if (isTyping) {
                state.typingUsers.add(typingUser);
            } else {
                state.typingUsers.delete(typingUser);
            }
            updateTypingIndicatorDisplay();
        });

        state.socket.on('webrtcSignaling', async (data) => {
            const { type, sdp, candidate, from } = data;
            console.log("WebRTC Signal empfangen:", type, "von:", from);

            // Erstelle PeerConnection, falls nicht vorhanden und ein Offer kommt
            if (!state.peerConnection && type === 'offer') {
                console.log("Keine PeerConnection, erstelle für Offer von:", from);
                createPeerConnection(from); // 'from' ist der targetSocketId für die Antwort
            } else if (!state.peerConnection) {
                console.warn("WebRTC Signal empfangen, aber keine PeerConnection und kein Offer.");
                return;
            }
            // Ignoriere Signale, wenn sie nicht vom aktuellen Partner kommen (außer neue Offers)
            if (type !== 'offer' && state.currentPCPartnerId && state.currentPCPartnerId !== from) {
                console.warn("Signal von nicht-aktuellem Partner ignoriert:", from, "Aktuell:", state.currentPCPartnerId);
                return;
            }


            try {
                if (type === 'offer') {
                    if (!state.localStream) { // Stelle sicher, dass lokale Medien bereit sind
                        await initializeLocalMedia(state.isScreenSharing);
                    }
                    // Füge Tracks hinzu, falls noch nicht geschehen (z.B. wenn PC gerade erst erstellt wurde)
                    if (state.localStream && state.peerConnection.getSenders().length === 0) {
                         state.localStream.getTracks().forEach(track => {
                            try {state.peerConnection.addTrack(track, state.localStream); }
                            catch(e) { console.warn("Fehler beim Hinzufügen von Track bei Offer:", e); }
                        });
                    }
                    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                    const answer = await state.peerConnection.createAnswer();
                    await state.peerConnection.setLocalDescription(answer);
                    state.socket.emit('webrtcSignaling', { type: 'answer', sdp: answer, target: from });
                    state.currentPCPartnerId = from; // Partner bestätigen/setzen
                    console.log("Offer verarbeitet, Answer gesendet an", from);
                } else if (type === 'answer') {
                    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
                    console.log("Answer von", from, "verarbeitet.");
                } else if (type === 'iceCandidate' && candidate) {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (e) {
                showError("Fehler bei WebRTC-Signalisierung.");
                console.error("WebRTC signaling error:", type, e);
                // Bei Fehler ggf. Verbindung zurücksetzen
                if (state.currentPCPartnerId === from) closePeerConnection();
            }
        });

        state.socket.on('disconnect', (reason) => {
            console.log('Socket getrennt:', reason);
            showError(`Verbindung getrennt: ${reason}.`);
            if (state.localStream) {
                state.localStream.getTracks().forEach(track => track.stop());
                state.localStream = null;
            }
            closePeerConnection(); // Schließt auch P2P
            setAppConnected(false); // UI zurücksetzen
        });
    }

    // --- Event Handlers ---
    async function handleConnect() {
        const newUsername = UI.usernameInput.value.trim();
        if (!newUsername) {
            showError('Bitte Benutzernamen eingeben.');
            return;
        }
        state.username = newUsername;
        localStorage.setItem('username', state.username);
        updateConnectionStatusDisplay('Verbinde...', 'connecting');
        UI.connectBtn.disabled = true;

        if (state.socket && state.socket.connected) { // Bereits verbunden, sollte nicht passieren
             state.socket.disconnect(); // Alte Verbindung trennen
        }
        // Verbinde zum Server (URL hier ggf. anpassen, wenn Server woanders läuft)
        state.socket = io({
            reconnectionAttempts: 3,
            timeout: 6000
        });
        setupSocketListeners();
        UI.connectBtn.disabled = false; // Freigeben nach Versuch
    }

    function handleDisconnect() {
        if (state.socket) {
            state.socket.disconnect();
        }
        // UI wird durch 'disconnect' Event Handler im Socket aktualisiert
    }

    function handleSendMessage() {
        const text = UI.messageInput.value.trim();
        if (!text || !state.isConnected) return;

        const messageData = { text }; // Server fügt username und color hinzu
        state.socket.emit('message', messageData);
        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto'; // Höhe zurücksetzen
        UI.messageInput.focus();

        if (state.typingTimeoutId) clearTimeout(state.typingTimeoutId);
        if (state.socket) state.socket.emit('typing', { isTyping: false });
    }

    function handleFileInputChange(event) {
        const file = event.target.files[0];
        if (!file || !state.isConnected) return;

        if (file.size > CONFIG.MAX_FILE_SIZE) {
            showError(`Datei zu groß (max. ${CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB).`);
            UI.fileInput.value = ''; // Auswahl zurücksetzen
            return;
        }

        const reader = new FileReader();
        reader.onload = function (e) {
            const fileData = {
                fileName: file.name,
                fileType: file.type,
                fileData: e.target.result, // Base64 data URL
            };
            state.socket.emit('file', fileData);
        };
        reader.readAsDataURL(file);
        UI.fileInput.value = ''; // Auswahl zurücksetzen
    }

    async function handleShareScreen() {
        if (!state.isConnected) {
            showError("Bitte zuerst verbinden.");
            return;
        }
        UI.shareScreenBtn.disabled = true;

        if (state.isScreenSharing) { // Stoppe Screensharing
            handleStopScreenShareByUser(); // Diese Funktion setzt auch Buttons etc.
        } else { // Starte Screensharing
            console.log("Starte Bildschirmfreigabe.");
            UI.myScreenStatus.textContent = "BILDSCHIRM WIRD AUSGEWÄHLT...";
            UI.myScreenStatus.className = 'screen-status-label loading';
            UI.myScreenStatus.classList.remove('hidden');
            UI.myVideo.classList.add('hidden');


            const success = await initializeLocalMedia(true);
            if (success) {
                UI.shareScreenBtn.textContent = "🛑 Teilen beenden";
                UI.shareScreenBtn.classList.add('danger-btn');
            } else { // Fehler beim Starten des Screensharings
                handleStopScreenShareByUser(); // Setzt UI zurück
                 await initializeLocalMedia(false); // Versuche, nur Audio wiederherzustellen
            }
        }
        UI.shareScreenBtn.disabled = false;
    }

    function handleTyping() {
        if (!state.isConnected || !state.socket) return;

        state.socket.emit('typing', { isTyping: true });
        if (state.typingTimeoutId) clearTimeout(state.typingTimeoutId);
        state.typingTimeoutId = setTimeout(() => {
            if (state.socket) state.socket.emit('typing', { isTyping: false });
        }, CONFIG.TYPING_TIMEOUT_MS);

        // Auto-Resize Textarea
        UI.messageInput.style.height = 'auto';
        let newHeight = UI.messageInput.scrollHeight;
        const maxHeight = parseInt(window.getComputedStyle(UI.messageInput).maxHeight);
        if (maxHeight && newHeight > maxHeight) newHeight = maxHeight;
        UI.messageInput.style.height = newHeight + 'px';

    }

    function toggleFullscreen(event) {
        const boxId = event.currentTarget.dataset.targetBox;
        const element = document.getElementById(boxId);
        if (!element) return;

        if (!document.fullscreenElement) {
            const videoElement = element.querySelector('video');
            // Nur wenn Video sichtbar ist und eine src hat
            if (videoElement && videoElement.srcObject && !videoElement.classList.contains('hidden')) {
                 element.requestFullscreen().catch(err => {
                    showError(`Vollbildfehler: ${err.message || err}`);
                });
            } else {
                showError("Kein Video zum Anzeigen im Vollbildmodus.");
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    // --- Initialization ---
    function bindEventListeners() {
        UI.connectBtn.addEventListener('click', handleConnect);
        UI.disconnectBtn.addEventListener('click', handleDisconnect);
        UI.sendBtn.addEventListener('click', handleSendMessage);
        UI.shareScreenBtn.addEventListener('click', handleShareScreen);

        UI.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
        UI.messageInput.addEventListener('input', handleTyping);
        UI.fileInput.addEventListener('change', handleFileInputChange);
        // UI.fileUploadLabel.addEventListener('click', () => UI.fileInput.click()); // Nicht nötig, da label for=""

        UI.fullscreenBtns.forEach(btn => btn.addEventListener('click', toggleFullscreen));

        UI.micSelect.addEventListener('change', async () => {
            if (state.isConnected && !state.isScreenSharing) {
                console.log("Mikrofon geändert, initialisiere Audio neu.");
                await initializeLocalMedia(false);
            }
        });

        window.addEventListener('beforeunload', () => {
            if (state.socket && state.socket.connected) {
                state.socket.disconnect();
            }
        });
        document.addEventListener('fullscreenchange', () => {
            UI.fullscreenBtns.forEach(btn => {
                const box = document.getElementById(btn.dataset.targetBox);
                btn.textContent = (document.fullscreenElement === box) ? "Vollbild verlassen" : "Vollbild";
            });
        });
    }

    async function init() {
        const savedUsername = localStorage.getItem('username');
        if (savedUsername) {
            UI.usernameInput.value = savedUsername;
        }
        await populateMicList();
        setAppConnected(false);
        bindEventListeners();

        if (Notification && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") console.log("Desktop notifications enabled.");
            });
        }
        console.log("EDMBook Chat App initialisiert.", new Date().toLocaleTimeString());
    }

    return {
        init
    };
})();

document.addEventListener('DOMContentLoaded', EDMBookApp.init);