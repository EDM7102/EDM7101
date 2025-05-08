document.addEventListener('DOMContentLoaded', () => {
    const UI = {
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
        roomId: 'default-room',
        users: {},
        peerConnection: null,
        localStream: null,
        remoteStream: null, // Wird im ontrack Handler gesetzt
        screenStream: null,
        isSharingScreen: false,
        selectedFile: null,
        typingTimeout: null,
        typingUsers: new Set(),
        lastMessageTimestamp: 0,
        isWindowFocused: true,
        unreadMessages: 0,
        originalTitle: document.title,
        notificationSound: new Audio('notif.mp3'), // Stelle sicher, dass notif.mp3 im public-Ordner ist
        currentPCPartnerId: null,
        allUsersList: [],
        socketId: null // Eigene Socket-ID
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500,
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // { urls: 'stun:stun.services.mozilla.com' },
                // --- FÜR VERBESSERTE VERBINDUNGEN TURN-SERVER HINZUFÜGEN ---
                // {
                //   urls: 'turn:dein.turn.server.com:3478',
                //   username: 'dein_turn_username',
                //   credential: 'dein_turn_passwort'
                // },
                // {
                //   urls: 'turns:dein.turn.server.com:443?transport=tcp',
                //   username: 'dein_turn_username',
                //   credential: 'dein_turn_passwort'
                // }
            ],
            // iceCandidatePoolSize: 10, // Kann Latenz verbessern, aber auch mehr Traffic verursachen
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
        MAX_FILE_SIZE: 5 * 1024 * 1024,
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
        if (UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.classList.add('hidden');
        if (UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.classList.add('hidden');
        if (UI.micSelect) UI.micSelect.disabled = false;
         updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
         updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
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
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.remove('hidden');
        if (UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true; // Mikrofonwahl während Verbindung sperren
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();
    }

    function updateUIAfterDisconnect() {
        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
        if (UI.usernameInput) UI.usernameInput.disabled = false;
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
        state.socketId = null;
         updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
         updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
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
                state.notificationSound.play().catch(e => console.warn("[WebRTC LOG] Notification sound blocked or error:", e));
            } catch (e) { console.warn("[WebRTC LOG] Error playing notification sound:", e); }
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
        const maxHeight = 100; // Max Höhe in px
        if (maxHeight && newHeight > maxHeight) newHeight = maxHeight;
        UI.messageInput.style.height = newHeight + 'px';
    });
    UI.fileInput.addEventListener('change', handleFileSelect);
    if (UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.localVideo));
    if (UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.remoteVideo));
    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        if (state.connected && state.localStream && !state.isSharingScreen) { // Nur wenn verbunden, Kamera aktiv und nicht Screensharing
            console.log("[WebRTC LOG] Mikrofon geändert. Initialisiere Audio neu.");
            await setupLocalMedia(true); // true für audioOnlyUpdate
        } else if (!state.connected) {
            console.log("[WebRTC LOG] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
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
            if (item.btn) {
                item.btn.textContent = (document.fullscreenElement === item.video) ? "Vollbild verlassen" : "Vollbild";
            }
        });
    });

    // --- Utility Functions ---
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

    // --- Media Device Functions ---
    async function populateMicList() {
        if (!UI.micSelect) return;
        UI.micSelect.innerHTML = '';
        try {
            // Kurzen Zugriff anfordern, um Berechtigungen zu prüfen und vollständige Liste zu erhalten
            await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length === 0) {
                UI.micSelect.appendChild(new Option("Keine Mikrofone gefunden", ""));
                return;
            }
            audioInputs.forEach((d, i) => {
                UI.micSelect.appendChild(new Option(d.label || `Mikrofon ${i + 1}`, d.deviceId));
            });
        } catch (e) {
            UI.micSelect.appendChild(new Option("Mikrofonzugriff Fehler", ""));
            console.warn("[WebRTC LOG] Fehler bei der Mikrofonauflistung:", e.name, e.message);
            // Kein displayError hier, da es beim Verbinden störend sein kann. setupLocalMedia behandelt den Fehler.
        }
    }

    // --- UI Update Functions ---
    function updateVideoDisplay(videoElement, statusElement, stream, isLocal = false) {
        if (!videoElement || !statusElement) {
            console.warn(`[WebRTC LOG] updateVideoDisplay: Video- oder Statuselement für ${isLocal ? 'lokal' : 'remote'} nicht gefunden.`);
            return;
        }

        const fullscreenBtn = isLocal ? UI.localVideoFullscreenBtn : UI.remoteVideoFullscreenBtn;
        const hasActiveTracks = stream && stream.active && (stream.getVideoTracks().some(t => t.readyState === 'live') || stream.getAudioTracks().some(t => t.readyState === 'live'));

        if (hasActiveTracks) {
            console.log(`[WebRTC LOG] updateVideoDisplay (${isLocal ? 'lokal' : 'remote'}): Stream ${stream.id} ist aktiv. Video-Tracks: ${stream.getVideoTracks().length}, Audio-Tracks: ${stream.getAudioTracks().length}`);
            videoElement.srcObject = stream;
            const hasVideo = stream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted); // Prüfe auch auf muted

            if (hasVideo) {
                videoElement.play().catch(e => console.warn(`[WebRTC LOG] Videowiedergabe (${isLocal ? 'lokal' : 'remote'}) fehlgeschlagen für Stream ${stream.id}:`, e));
                videoElement.classList.remove('hidden');
                statusElement.classList.add('hidden');
            } else { // Nur Audio oder Video gemuted
                videoElement.classList.add('hidden');
                statusElement.textContent = isLocal ? (state.isSharingScreen ? "BILDSCHIRM GETEILT (Audio)" : "DEIN AUDIO AKTIV") : "REMOTE AUDIO AKTIV";
                statusElement.className = 'screen-status-label loading';
                statusElement.classList.remove('hidden');
            }
            if (fullscreenBtn && hasVideo) fullscreenBtn.classList.remove('hidden');
            else if (fullscreenBtn) fullscreenBtn.classList.add('hidden');

        } else {
            console.log(`[WebRTC LOG] updateVideoDisplay (${isLocal ? 'lokal' : 'remote'}): Kein aktiver Stream oder keine Tracks.`);
            if (videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
            videoElement.srcObject = null;
            videoElement.classList.add('hidden');
            statusElement.textContent = isLocal ? (state.isSharingScreen ? "BILDSCHIRM GETEILT" : "KAMERA AUS / FEHLER") : "KEIN VIDEO/SCREEN";
            statusElement.className = 'screen-status-label offline';
            statusElement.classList.remove('hidden');
            if (fullscreenBtn) fullscreenBtn.classList.add('hidden');
        }
    }


    function updateUserList(usersArrayFromServer) {
        state.allUsersList = usersArrayFromServer; // Komplette Liste vom Server
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        usersArrayFromServer.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id));
            li.appendChild(dot);

            const nameNode = document.createTextNode(` ${escapeHTML(user.username)}`);
            if (user.id === state.socketId) { // Eigene Socket-ID aus dem State verwenden
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
        const serverUrl = window.location.origin; // Nimmt Host und Port der aktuellen Seite
        const roomId = state.roomId;
        let username = UI.usernameInput.value.trim();

        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username;
        state.username = username;

        console.log(`[Socket.IO] Verbinde mit ${serverUrl} in Raum ${state.roomId} als ${state.username}`);

        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket'] // Bevorzuge WebSocket
        });
        setConnectionStatus('connecting', 'Verbinde...');
        setupSocketListeners();
    }

    function setupSocketListeners() {
        if (!socket) return;

        socket.on('connect', async () => {
            state.connected = true;
            // Die eigene Socket-ID wird vom Server per 'joinSuccess' gesendet
            console.log('[Socket.IO] Verbunden mit Server.');
            // UI-Updates erst nach 'joinSuccess', da dort die ID und Userliste kommt
            // setupLocalMedia wird nach joinSuccess aufgerufen bzw. bei P2P Initiierung.
        });

        socket.on('connect_error', (err) => {
            console.error('[Socket.IO] Verbindungsfehler:', err.message, err.data);
            displayError(`Verbindungsfehler: ${err.message}. Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            updateUIAfterDisconnect(); // Stellt sicher, dass UI zurückgesetzt wird
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] Verbindung getrennt: ${reason}`);
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect();
        });

        socket.on('joinSuccess', async ({ users: currentUsers, id: myId }) => {
            console.log(`[Socket.IO] Join erfolgreich. Deine ID: ${myId}, Benutzer im Raum:`, currentUsers);
            state.socketId = myId; // Eigene ID speichern
            state.username = currentUsers.find(u => u.id === myId)?.username || state.username; // Username vom Server übernehmen, falls geändert
            updateUserList(currentUsers);
            updateUIAfterConnect(); // Jetzt UI aktualisieren, da wir ID und Userliste haben

            await populateMicList(); // Mikrofonliste nach erfolgreichem Join (und ggf. Permission Grant) laden

            // Lokale Medien starten, NACHDEM die UI aktualisiert wurde und Mikrofonauswahl ggf. geladen ist
            if (!state.localStream) { // Nur wenn nicht schon vorhanden (z.B. durch vorherige Versuche)
                const mediaSuccess = await setupLocalMedia();
                if (!mediaSuccess) {
                    console.warn("[WebRTC LOG] Lokale Medien konnten beim Join nicht gestartet werden.");
                    // Evtl. Button anbieten, um es manuell zu versuchen
                }
            }
            initiateP2PConnection(); // P2P-Verbindung zu anderen Nutzern initiieren
        });


        socket.on('joinError', ({ message }) => {
            console.error(`[Socket.IO] Join Fehler: ${message}`);
            displayError(message);

            // Wenn der Fehler "Username already taken" ist, nicht sofort disconnecten,
            // damit der Nutzer den Namen ändern und es erneut versuchen kann.
            if (!message.toLowerCase().includes("username already taken")) {
                if (socket) socket.disconnect();
            } else { // Bei "Username already taken"
                UI.connectBtn.classList.remove('hidden');
                UI.disconnectBtn.classList.add('hidden');
                if (UI.usernameInput) UI.usernameInput.disabled = false;
                setConnectionStatus('disconnected', 'Fehler beim Beitreten');
            }
        });

        socket.on('userListUpdate', (currentUsersList) => {
            console.log("[Socket.IO] Benutzerliste aktualisiert:", currentUsersList);
            const oldPartnerStillPresent = state.currentPCPartnerId && currentUsersList.some(u => u.id === state.currentPCPartnerId);

            updateUserList(currentUsersList);

            if (!oldPartnerStillPresent && state.currentPCPartnerId) {
                console.log("[WebRTC LOG] P2P Partner hat Chat verlassen. Schließe PeerConnection.");
                closePeerConnection();
            }
            // Wenn keine P2P Verbindung besteht und andere User da sind (außer man selbst)
            if (!state.currentPCPartnerId && currentUsersList.some(u => u.id !== state.socketId)) {
                console.log("[WebRTC LOG] Neue User im Raum oder keine aktive Verbindung. Versuche P2P Verbindung.");
                initiateP2PConnection();
            } else if (currentUsersList.length === 1 && currentUsersList[0].id === state.socketId) {
                 // Nur man selbst ist im Raum
                 if(state.currentPCPartnerId) closePeerConnection(); // Schließe ggf. alte Verbindung
                 updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false); // Remote Video ausblenden
            }
        });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            if (message.username !== state.username) notifyUnreadMessage();
        });
        socket.on('file', (fileMsgData) => {
            appendMessage({ ...fileMsgData, type: 'file' });
            if (fileMsgData.username !== state.username) notifyUnreadMessage();
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
            console.log(`[WebRTC LOG] webRTC-offer: Angebot erhalten von ${from}. Angebotstyp: ${offer.type}, SDP (erste 100 Zeichen): ${offer.sdp ? offer.sdp.substring(0,100) : 'Kein SDP'}...`);

            if (state.peerConnection && state.currentPCPartnerId !== from) {
                 console.warn(`[WebRTC LOG] webRTC-offer: Angebot von neuem Peer ${from} erhalten, während Verbindung zu ${state.currentPCPartnerId} besteht. Schließe alte Verbindung.`);
                 closePeerConnection();
            }
            if (!state.peerConnection) {
                await createPeerConnection(from);
            }
            // Sicherstellen, dass lokale Medien bereit sind, BEVOR setRemoteDescription aufgerufen wird, falls noch nicht geschehen.
            if (!state.localStream && !state.isSharingScreen) {
                console.log("[WebRTC LOG] webRTC-offer: Lokaler Stream nicht bereit, versuche setupLocalMedia.");
                await setupLocalMedia(); // Stellt sicher, dass Tracks für die Antwort verfügbar sind
            }


            try {
                console.log(`[WebRTC LOG] webRTC-offer: Setze Remote Description (Offer) von ${from}. Aktueller Signalling State: ${state.peerConnection?.signalingState}`);
                await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                console.log(`[WebRTC LOG] webRTC-offer: Remote Description (Offer) gesetzt. Neuer Signalling State: ${state.peerConnection?.signalingState}`);

                console.log(`[WebRTC LOG] webRTC-offer: Erstelle Antwort für ${from}.`);
                const answer = await state.peerConnection.createAnswer();
                console.log(`[WebRTC LOG] webRTC-offer: Setze Local Description (Answer) für ${from}. Antworttyp: ${answer.type}`);
                await state.peerConnection.setLocalDescription(answer);
                console.log(`[WebRTC LOG] webRTC-offer: Local Description (Answer) gesetzt. Neuer Signalling State: ${state.peerConnection?.signalingState}`);

                console.log(`[WebRTC LOG] webRTC-offer: Sende Antwort an ${from}.`);
                socket.emit('webRTC-answer', { to: from, answer: state.peerConnection.localDescription });
            } catch (err) {
                console.error(`[WebRTC LOG] webRTC-offer: Fehler bei der Verarbeitung des Angebots von ${from}:`, err);
                displayError(`Fehler bei Video-Verhandlung mit ${from} (Offer-Processing).`);
            }
        });

        socket.on('webRTC-answer', async ({ from, answer }) => {
            console.log(`[WebRTC LOG] webRTC-answer: Antwort erhalten von ${from}. Antworttyp: ${answer.type}, SDP (erste 100 Zeichen): ${answer.sdp ? answer.sdp.substring(0,100): 'Kein SDP'}...`);
            if (!state.peerConnection || state.currentPCPartnerId !== from) {
                console.warn(`[WebRTC LOG] webRTC-answer: Antwort von ${from} erhalten, aber keine passende PeerConnection oder falscher Partner (${state.currentPCPartnerId}).`);
                return;
            }
            if (state.peerConnection.signalingState === "have-local-offer" || state.peerConnection.signalingState === "stable") { // 'stable' für polite peers
                try {
                    console.log(`[WebRTC LOG] webRTC-answer: Setze Remote Description (Answer) von ${from}. Aktueller Signalling State: ${state.peerConnection.signalingState}`);
                    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                    console.log(`[WebRTC LOG] webRTC-answer: Remote Description (Answer) gesetzt. Neuer Signalling State: ${state.peerConnection.signalingState}`);
                } catch (err) {
                    console.error(`[WebRTC LOG] webRTC-answer: Fehler beim Setzen der Remote Description (Answer) von ${from}:`, err);
                    displayError(`Fehler bei Video-Verhandlung mit ${from} (Answer-Processing).`);
                }
            } else {
                console.warn(`[WebRTC LOG] webRTC-answer: Antwort von ${from} erhalten, aber PeerConnection nicht im Zustand 'have-local-offer' (aktuell: ${state.peerConnection.signalingState}). Antwort wird ignoriert.`);
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            console.log(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat erhalten von ${from}:`, candidate ? JSON.stringify(candidate).substring(0,100)+'...' : 'null');
            if (state.peerConnection && state.currentPCPartnerId === from && state.peerConnection.remoteDescription) {
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erfolgreich hinzugefügt.`);
                } catch (e) {
                    console.error(`[WebRTC LOG] webRTC-ice-candidate: Fehler beim Hinzufügen des ICE Kandidaten von ${from}:`, e.name, e.message);
                }
            } else if (state.peerConnection && state.currentPCPartnerId === from && !state.peerConnection.remoteDescription) {
                 console.warn(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erhalten, aber RemoteDescription ist noch nicht gesetzt. Kandidat wird ggf. intern gepuffert.`);
                 // Browser puffern Kandidaten oft, bis setRemoteDescription aufgerufen wurde. Manchmal muss man sie aber manuell puffern.
                 // Fürs Erste verlassen wir uns auf das Browser-Buffering.
                 try {
                     await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                 } catch (e) {
                    console.error(`[WebRTC LOG] webRTC-ice-candidate: Fehler beim Hinzufügen des gepufferten ICE Kandidaten von ${from}:`, e.name, e.message);
                 }
            } else {
                console.warn(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erhalten, aber PeerConnection nicht bereit oder falscher Partner (aktuell: ${state.currentPCPartnerId}, remoteDesc: ${!!state.peerConnection?.remoteDescription}).`);
            }
        });
    } // Ende setupSocketListeners

    function disconnect() {
        console.log("[Socket.IO] Trenne Verbindung manuell.");
        if (socket) {
            socket.disconnect(); // Dies löst das 'disconnect' Event aus, das updateUIAfterDisconnect aufruft
        } else {
            // Fallback, falls Socket-Objekt nicht existiert, aber UI zurückgesetzt werden soll
            updateUIAfterDisconnect();
        }
    }

    // --- Chat Logic ---
    function sendMessage() {
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) return;
        if (!socket || !state.connected) {
            displayError("Nicht verbunden. Nachricht kann nicht gesendet werden.");
            return;
        }

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
                    socket.emit('file', message);
                    resetFileInput();
                };
                reader.onerror = (err) => {
                    console.error("[File Send] Fehler beim Lesen der Bilddatei:", err);
                    displayError("Fehler beim Lesen der Bilddatei.");
                    resetFileInput();
                };
                reader.readAsDataURL(state.selectedFile);
            } else { // Für andere Dateitypen (keine Vorschau im Chat, nur Metadaten)
                socket.emit('file', message);
                resetFileInput();
            }
        } else { // Normale Textnachricht
            const message = { ...messageBase, type: 'text' };
            socket.emit('message', message);
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto'; // Höhe zurücksetzen
        UI.messageInput.focus();
        sendTyping(false); // Tipp-Status zurücksetzen
    }

    function appendMessage(msg) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.username === state.username; // Oder msg.id === state.socketId, falls Username sich ändern könnte
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username);
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.username)); // Farbe vom Server oder generiert

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
                img.onload = () => UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight; // Scrollen nach Bildladen
                img.onclick = () => openImageModal(img.src); // Modal Funktion
                fileInfo.appendChild(img);
            } else { // Für nicht-Bild-Dateien oder Bilder ohne dataUrl
                fileInfo.innerHTML += `<span class="file-icon">📄</span>`; // Einfaches Datei-Icon
            }
            const linkText = `${escapeHTML(msg.file.name)} (${formatFileSize(msg.file.size)})`;
            // Wenn dataUrl vorhanden ist (typischerweise für Bilder, die direkt gesendet wurden)
            if (msg.file.dataUrl && !msg.file.type.startsWith('application/octet-stream')) { // Octet-stream nicht direkt verlinken für Download
                fileInfo.innerHTML += ` <a href="${msg.file.dataUrl}" download="${escapeHTML(msg.file.name)}">${linkText}</a>`;
            } else {
                fileInfo.innerHTML += ` <span>${linkText}</span>`; // Kein direkter Download-Link für serverseitig gespeicherte Dateien ohne dataUrl
            }
            if (msg.content) { // Zusätzlicher Text zur Datei
                const textNode = document.createElement('p');
                textNode.style.marginTop = '5px';
                textNode.textContent = escapeHTML(msg.content);
                fileInfo.appendChild(textNode);
            }
            contentDiv.appendChild(fileInfo);
        } else { // Normale Textnachricht
            contentDiv.textContent = escapeHTML(msg.content || '');
        }

        const timeSpan = document.createElement('span');
        timeSpan.classList.add('timestamp');
        try {
            timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) { timeSpan.textContent = "Invalid Date"; }


        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);
        msgDiv.appendChild(timeSpan);
        UI.messagesContainer.appendChild(msgDiv);

        // Scroll-Logik verbessert
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20; // Etwas Toleranz
        if (isMe || isScrolledToBottom || state.lastMessageTimestamp === 0) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
        state.lastMessageTimestamp = Date.now();
    }

    function openImageModal(src) {
        const modal = document.createElement('div');
        modal.id = 'imageModal'; // ID für einfaches Entfernen
        modal.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:1000;cursor:pointer;padding:20px;box-sizing:border-box;';
        modal.onclick = (event) => {
            if(event.target === modal) modal.remove(); // Schließt nur bei Klick auf Hintergrund
        };

        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:5px;box-shadow:0 0 15px rgba(0,0,0,0.5);';
        img.onclick = (event) => event.stopPropagation(); // Klick auf Bild schließt Modal nicht

        modal.appendChild(img);
        document.body.appendChild(modal);
    }


    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) return;
        clearTimeout(state.typingTimeout);
        socket.emit('typing', { isTyping }); // Sendet den aktuellen Tipp-Status
        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false }); // Sendet 'tippt nicht mehr' nach Timer-Ablauf
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- WebRTC Logic ---
    async function setupLocalMedia(audioOnlyUpdate = false) {
        console.log(`[WebRTC LOG] setupLocalMedia aufgerufen. audioOnlyUpdate: ${audioOnlyUpdate}, isSharingScreen: ${state.isSharingScreen}`);

        if (state.isSharingScreen && !audioOnlyUpdate) { // Wenn Screensharing aktiv ist und es kein reines Audio-Update ist
            console.log("[WebRTC LOG] setupLocalMedia: Screensharing ist aktiv. Lokale Kamera-Medien werden nicht jetzt initialisiert/geändert.");
            return true; // Verhindere, dass Kamera den Screen-Stream überschreibt
        }

        try {
            const selectedMicId = UI.micSelect ? UI.micSelect.value : undefined;
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                ...(selectedMicId && { deviceId: { exact: selectedMicId } })
            };
            console.log("[WebRTC LOG] setupLocalMedia: Audio-Constraints:", audioConstraints);

            let streamToProcess;
            if (audioOnlyUpdate && state.localStream) {
                console.log("[WebRTC LOG] setupLocalMedia: Versuche nur Audio-Track zu aktualisieren/hinzuzufügen.");
                // Alten Audio-Track stoppen und entfernen
                state.localStream.getAudioTracks().forEach(t => {
                    console.log(`[WebRTC LOG] setupLocalMedia: Stoppe und entferne alten Audio-Track ${t.id} vom localStream.`);
                    t.stop();
                    state.localStream.removeTrack(t);
                });

                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                const newAudioTrack = audioStream.getAudioTracks()[0];

                if (newAudioTrack) {
                    console.log(`[WebRTC LOG] setupLocalMedia: Füge neuen Audio-Track ${newAudioTrack.id} zum localStream hinzu.`);
                    state.localStream.addTrack(newAudioTrack);
                    streamToProcess = state.localStream; // Der bestehende Stream mit neuem AudioTrack
                } else {
                    console.warn("[WebRTC LOG] setupLocalMedia: Konnte keinen neuen Audio-Track für Update bekommen.");
                    return false;
                }
            } else { // Vollständiger Stream-Aufbau oder erster Aufbau
                console.log("[WebRTC LOG] setupLocalMedia: Fordere neuen Video- und Audio-Stream (Kamera) an.");
                // Bestehenden Kamera-Stream (nicht Screen-Stream!) stoppen, falls vorhanden
                if (state.localStream && !state.isSharingScreen) { // Nur wenn nicht Screensharing
                    console.log("[WebRTC LOG] setupLocalMedia: Stoppe bestehenden lokalen Kamera-Stream für kompletten Neustart.");
                    state.localStream.getTracks().forEach(track => track.stop());
                }

                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
                    audio: audioConstraints
                });
                state.localStream = newStream;
                streamToProcess = state.localStream;
                console.log(`[WebRTC LOG] setupLocalMedia: Neuer lokaler Kamera-Stream erstellt: ${streamToProcess.id}. Tracks: Video: ${streamToProcess.getVideoTracks().length}, Audio: ${streamToProcess.getAudioTracks().length}`);
            }

            // Wichtig: streamToProcess hier ist entweder der modifizierte state.localStream oder der neu erstellte.
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, streamToProcess, true);


            if (state.peerConnection) {
                console.log("[WebRTC LOG] setupLocalMedia: Lokaler Kamera-Stream geändert, aktualisiere Tracks in PeerConnection.");
                // Nur Kamera/Mikrofon Tracks in der PC ersetzen, nicht Screen-Tracks.
                // `replaceTracksInPeerConnection` sollte selbstständig die Neuverhandlung anstoßen.
                await replaceTracksInPeerConnection(streamToProcess, 'camera');
            }
            return true;
        } catch (err) {
            console.error('[WebRTC LOG] setupLocalMedia: Fehler beim Zugriff auf lokale Medien (Kamera/Mikro):', err.name, err.message);
            displayError(`Kamera/Mikrofon: ${err.message}. Bitte Berechtigungen prüfen.`);
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // UI zurücksetzen
            if (state.localStream && !audioOnlyUpdate) { // Bei vollem Setup-Fehler Stream cleanen
                state.localStream.getTracks().forEach(track => track.stop());
                state.localStream = null;
            }
            return false;
        }
    }

    function stopLocalStream() {
        console.log("[WebRTC LOG] stopLocalStream: Stoppe alle lokalen Streams (Kamera und Screen).")
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
        }
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(track => track.stop());
            state.screenStream = null;
            // UI für localVideo wird von localStream gesteuert, oder muss explizit auf Kamera zurückgesetzt werden.
        }
        // Falls Screensharing aktiv war und nun gestoppt wird, muss ggf. Kamera wieder angezeigt werden.
        // Dies wird typischerweise in toggleScreenSharing gehandhabt.
    }

    async function createPeerConnection(peerId) {
        if (state.peerConnection && state.currentPCPartnerId === peerId) {
            console.log(`[WebRTC LOG] createPeerConnection: PeerConnection mit ${peerId} existiert bereits und wird weiterverwendet.`);
            return state.peerConnection;
        }
        if (state.peerConnection) { // Verbindung zu anderem Peer oder Neuaufbau
            console.log(`[WebRTC LOG] createPeerConnection: Schließe bestehende PeerConnection mit ${state.currentPCPartnerId}, um neue mit ${peerId} zu erstellen.`);
            closePeerConnection(); // Alte Verbindung sauber schließen
        }

        console.log(`[WebRTC LOG] createPeerConnection: Erstelle neue RTCPeerConnection für Peer: ${peerId} mit Konfiguration:`, CONFIG.RTC_CONFIGURATION);
        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.currentPCPartnerId = peerId; // Wichtig: Setze Partner-ID sofort

        state.peerConnection.onicecandidate = event => {
            if (event.candidate && socket && state.connected && state.currentPCPartnerId) { // Prüfe currentPCPartnerId
                console.log(`[WebRTC LOG] onicecandidate: Sende ICE Kandidat an ${state.currentPCPartnerId}:`, JSON.stringify(event.candidate).substring(0, 100) + "...");
                socket.emit('webRTC-ice-candidate', { to: state.currentPCPartnerId, candidate: event.candidate });
            } else if (!event.candidate) {
                console.log(`[WebRTC LOG] onicecandidate: ICE Kandidatensammlung für ${state.currentPCPartnerId} beendet (null Kandidat).`);
            }
        };

        state.peerConnection.ontrack = event => {
            console.log(`[WebRTC LOG] ontrack: Remote Track empfangen von ${state.currentPCPartnerId}. Track Kind: ${event.track.kind}, Track ID: ${event.track.id}, Stream(s):`, event.streams);
            if (!UI.remoteVideo) {
                console.error("[WebRTC LOG] ontrack: Remote Video Element nicht gefunden!");
                return;
            }

            // Zuerst den alten remoteStream leeren und Tracks stoppen, wenn er existiert
            if (state.remoteStream) {
                 console.log(`[WebRTC LOG] ontrack: Stoppe Tracks des alten remoteStream ${state.remoteStream.id}`);
                 state.remoteStream.getTracks().forEach(t => t.stop());
            }

            // Weise den neuen Stream direkt zu oder erstelle einen neuen, wenn event.streams[0] nicht existiert
            if (event.streams && event.streams[0]) {
                console.log(`[WebRTC LOG] ontrack: Weise Stream ${event.streams[0].id} (enthält Track ${event.track.id}) dem Remote-Videoelement zu.`);
                state.remoteStream = event.streams[0]; // Aktualisiere den globalen remoteStream
            } else {
                // Fallback, wenn Tracks einzeln ohne zugehörigen Stream im Event ankommen
                if (!state.remoteStream) { // Nur erstellen, wenn noch keiner existiert
                    state.remoteStream = new MediaStream();
                    console.log(`[WebRTC LOG] ontrack: Neuer RemoteStream ${state.remoteStream.id} erstellt, da keiner im Event war oder existierte.`);
                }
                // Prüfe, ob der Track schon im (ggf. neu erstellten) Stream ist
                if (!state.remoteStream.getTrackById(event.track.id)) {
                    console.log(`[WebRTC LOG] ontrack: Füge Track ${event.track.id} zum (ggf. neuen) RemoteStream ${state.remoteStream.id} hinzu.`);
                    state.remoteStream.addTrack(event.track);
                }
            }
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
        };


        state.peerConnection.oniceconnectionstatechange = () => {
            if (!state.peerConnection) return; // PC könnte bereits geschlossen sein
            const pcState = state.peerConnection.iceConnectionState;
            const partner = state.allUsersList.find(u => u.id === state.currentPCPartnerId);
            const partnerUsername = partner ? partner.username : (state.currentPCPartnerId || 'Unbekannt');
            console.log(`[WebRTC LOG] oniceconnectionstatechange: ICE Connection Status zu ${partnerUsername} (${state.currentPCPartnerId}): ${pcState}`);

            switch (pcState) {
                case "new":
                case "checking":
                    if (UI.remoteScreenStatus) {
                        UI.remoteScreenStatus.textContent = `VERBINDE MIT ${partnerUsername.toUpperCase()}...`;
                        UI.remoteScreenStatus.className = 'screen-status-label loading';
                        UI.remoteScreenStatus.classList.remove('hidden');
                    }
                    if (UI.remoteVideo) UI.remoteVideo.classList.add('hidden');
                    break;
                case "connected":
                    console.log(`[WebRTC LOG] ICE 'connected': Erfolgreich verbunden mit ${partnerUsername}. Daten sollten jetzt fließen.`);
                    setConnectionStatus('connected', `Video verbunden mit ${partnerUsername}`);
                    // updateVideoDisplay sollte durch ontrack bereits das Video sichtbar machen
                    break;
                case "completed":
                    console.log(`[WebRTC LOG] ICE 'completed': Alle Kandidatenpaare geprüft mit ${partnerUsername}. Verbindung sollte stabil sein.`);
                    break;
                case "disconnected":
                    console.warn(`[WebRTC LOG] ICE 'disconnected': Video-Verbindung zu ${partnerUsername} unterbrochen. Versuche, Verbindung wiederherzustellen...`);
                    // Hier nicht sofort closePeerConnection, da es temporär sein kann. Der Browser versucht oft, sich wieder zu verbinden.
                    // Man könnte einen Timer für einen harten Reset setzen, falls es zu lange dauert.
                    if (UI.remoteScreenStatus) UI.remoteScreenStatus.textContent = `VERBINDUNG UNTERBROCHEN MIT ${partnerUsername.toUpperCase()}`;
                    break;
                case "failed":
                    console.error(`[WebRTC LOG] ICE 'failed': Video-Verbindung zu ${partnerUsername} fehlgeschlagen.`);
                    displayError(`Video-Verbindung zu ${partnerUsername} fehlgeschlagen. Prüfe Netzwerk/Firewall oder Konsolenausgaben.`);
                    closePeerConnection(); // Verbindung ist definitiv fehlgeschlagen
                    // Optional: Automatischen Neuverbindungsversuch starten
                    // setTimeout(() => { if (state.connected) initiateP2PConnection(); }, 5000);
                    break;
                case "closed":
                    console.log(`[WebRTC LOG] ICE 'closed': Verbindung zu ${partnerUsername} wurde geschlossen.`);
                    // closePeerConnection() sollte hier normalerweise schon aufgerufen worden sein oder wird es jetzt sicherstellen.
                    // Dies geschieht oft, wenn die andere Seite die Verbindung beendet.
                    if (state.currentPCPartnerId === (partner ? partner.id : null)) { // Nur wenn es der aktuelle Partner war
                        closePeerConnection(); // Stelle sicher, dass alles bereinigt ist
                    }
                    break;
            }
        };

        state.peerConnection.onsignalingstatechange = () => {
            if (!state.peerConnection) return;
            console.log(`[WebRTC LOG] onsignalingstatechange: Signalling State zu ${state.currentPCPartnerId} geändert zu: ${state.peerConnection.signalingState}`);
        };

        state.peerConnection.onnegotiationneeded = async () => {
            console.log(`[WebRTC LOG] onnegotiationneeded: Event für ${state.currentPCPartnerId} ausgelöst. Aktueller Signalling State: ${state.peerConnection.signalingState}`);
            // "Polite peer" Logik: Nur der Peer mit der "kleineren" ID initiiert das Offer bei Glare.
            // state.socketId sollte hier gesetzt sein.
            if (state.peerConnection.signalingState === 'stable' && state.socketId && state.currentPCPartnerId && state.socketId < state.currentPCPartnerId) {
                console.log(`[WebRTC LOG] onnegotiationneeded: Bin Initiator (oder es ist sicher), erstelle und sende Offer an ${state.currentPCPartnerId}.`);
                await createAndSendOffer();
            } else {
                console.log(`[WebRTC LOG] onnegotiationneeded: Nicht der Initiator oder Signalisierungsstatus nicht stabil ('${state.peerConnection.signalingState}') oder IDs fehlen. Warte auf Offer oder stabilen Zustand.`);
            }
        };

        // Füge Tracks vom lokalen Stream hinzu, falls vorhanden und P2P gestartet wird.
        // Die Tracks sollten aktuell sein (Kamera oder Screen).
        const streamToAdd = state.isSharingScreen && state.screenStream ? state.screenStream : state.localStream;
        if (streamToAdd) {
            console.log(`[WebRTC LOG] createPeerConnection: Füge Tracks vom Stream ${streamToAdd.id} (Typ: ${state.isSharingScreen ? 'Screen' : 'Kamera'}) zur neuen PeerConnection hinzu.`);
            addTracksToPeerConnection(streamToAdd);
        } else {
            console.log("[WebRTC LOG] createPeerConnection: Kein lokaler Stream (Kamera oder Screen) vorhanden beim Erstellen der PeerConnection. setupLocalMedia sollte dies vorher behandeln.");
        }
        return state.peerConnection;
    }

    // Hilfsfunktion, um Tracks zu einer PeerConnection hinzuzufügen
    function addTracksToPeerConnection(stream) {
        if (stream && state.peerConnection) {
            stream.getTracks().forEach(track => {
                // Prüfe, ob dieser Track (oder ein Track gleicher Art) schon gesendet wird
                const senderExists = state.peerConnection.getSenders().find(s => s.track === track || (s.track && s.track.kind === track.kind));
                if (!senderExists) {
                    try {
                        state.peerConnection.addTrack(track, stream);
                        console.log(`[WebRTC LOG] addTracksToPeerConnection: Track ${track.kind} (${track.id}) zum Stream ${stream.id} hinzugefügt.`);
                    } catch (e) {
                        console.error(`[WebRTC LOG] addTracksToPeerConnection: Fehler beim Hinzufügen von Track ${track.id}:`, e);
                    }
                } else {
                    console.log(`[WebRTC LOG] addTracksToPeerConnection: Track ${track.kind} (${track.id}) oder ähnlicher Art wird bereits gesendet. Übersprungen.`);
                }
            });
        } else if (!stream) {
            console.warn("[WebRTC LOG] addTracksToPeerConnection: Aufgerufen mit null Stream.");
        }
    }


    async function createAndSendOffer() {
        if (!state.peerConnection || !state.currentPCPartnerId) {
            console.warn("[WebRTC LOG] createAndSendOffer: Bedingungen nicht erfüllt (keine PC oder kein Partner). Offer wird nicht erstellt.");
            return;
        }
        // Strenge Prüfung des Signalisierungsstatus, um "glare" und Race Conditions zu minimieren.
        // Nur anbieten, wenn der Zustand 'stable' ist oder man als 'polite' Peer in bestimmten Situationen (z.B. nach Track-Änderung) agiert.
        if (state.peerConnection.signalingState !== 'stable') {
            console.warn(`[WebRTC LOG] createAndSendOffer: Überspringe Offer-Erstellung, da Signalisierungsstatus '${state.peerConnection.signalingState}' (nicht stable) ist mit ${state.currentPCPartnerId}. Verlasse mich ggf. auf onnegotiationneeded.`);
            return;
        }

        try {
            console.log(`[WebRTC LOG] createAndSendOffer: Erstelle Offer für ${state.currentPCPartnerId}.`);
            const offer = await state.peerConnection.createOffer();

            // Überprüfe, ob sich das Offer wirklich geändert hat, bevor setLocalDescription erneut aufgerufen wird (vermeidet unnötige Events)
            if (!state.peerConnection.localDescription || state.peerConnection.localDescription.sdp !== offer.sdp) {
                console.log(`[WebRTC LOG] createAndSendOffer: Setze LocalDescription für ${state.currentPCPartnerId}. Offer Typ: ${offer.type}`);
                await state.peerConnection.setLocalDescription(offer); // Das aktualisiert localDescription
                console.log(`[WebRTC LOG] createAndSendOffer: LocalDescription gesetzt. Neuer Signalling State: ${state.peerConnection.signalingState}`);
            } else {
                console.log(`[WebRTC LOG] createAndSendOffer: Neues Offer ist identisch mit dem bestehenden LocalDescription. Kein setLocalDescription nötig.`);
            }

            // Sende das (ggf. gerade gesetzte) localDescription
            if (state.peerConnection.localDescription) {
                console.log(`[WebRTC LOG] createAndSendOffer: Sende Offer (Typ: ${state.peerConnection.localDescription.type}) an ${state.currentPCPartnerId}.`);
                socket.emit('webRTC-offer', { to: state.currentPCPartnerId, offer: state.peerConnection.localDescription });
            } else {
                 console.error("[WebRTC LOG] createAndSendOffer: localDescription ist null nach setLocalDescription. Offer kann nicht gesendet werden.");
            }

        } catch (err) {
            console.error('[WebRTC LOG] createAndSendOffer: Fehler beim Erstellen/Senden des Offers:', err);
            displayError("Fehler bei der Video-Verhandlung (Offer).");
        }
    }


    async function replaceTracksInPeerConnection(newStream, streamType = 'camera') { // streamType: 'camera' oder 'screen'
        if (!state.peerConnection) {
            console.warn("[WebRTC LOG] replaceTracksInPeerConnection: Keine PeerConnection vorhanden.");
            return false;
        }
        console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Ersetze Tracks für Stream-Typ '${streamType}' in PeerConnection mit ${state.currentPCPartnerId}. Neuer Stream ID: ${newStream ? newStream.id : 'NULL'}.`);

        let tracksEffectivelyReplacedOrAdded = false; // Um zu entscheiden, ob Neuverhandlung nötig ist
        const senders = state.peerConnection.getSenders();

        // Video-Track ersetzen oder hinzufügen/entfernen
        const newVideoTrack = newStream ? newStream.getVideoTracks()[0] : null;
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');

        if (videoSender) {
            // Wenn der neue Track derselbe ist, der schon gesendet wird, nichts tun (Performance)
            if (videoSender.track === newVideoTrack && newVideoTrack !== null) { // explizit !== null
                 console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Neuer Video-Track (${newVideoTrack?.id}) ist identisch mit dem aktuellen. Keine Aktion.`);
            } else {
                console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Ersetze bestehenden Video-Track ${videoSender.track?.id || 'N/A'} durch ${newVideoTrack?.id || 'null'}.`);
                await videoSender.replaceTrack(newVideoTrack)
                    .then(() => { tracksEffectivelyReplacedOrAdded = true; console.log("[WebRTC LOG] Video-Track erfolgreich via replaceTrack geändert/entfernt."); })
                    .catch(e => console.error("[WebRTC LOG] Fehler beim Ersetzen des Video-Tracks:", e));
            }
        } else if (newVideoTrack) { // Kein Video-Sender, aber neuer Video-Track -> hinzufügen
            console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Füge neuen Video-Track ${newVideoTrack.id} hinzu (kein Sender).`);
            try {
                state.peerConnection.addTrack(newVideoTrack, newStream);
                tracksEffectivelyReplacedOrAdded = true;
                console.log("[WebRTC LOG] Video-Track erfolgreich via addTrack hinzugefügt.");
            } catch (e) {
                console.error("[WebRTC LOG] Fehler beim Hinzufügen des neuen Video-Tracks:", e);
            }
        }

        // Audio-Track ersetzen oder hinzufügen/entfernen
        // Nur wenn es der Kamera-Stream ist ODER der Screen-Stream explizit Audio hat UND es gewünscht ist.
        // Aktuell wird Screen-Audio nicht separat behandelt/gemischt, d.h. Screen-Sharing ersetzt auch Audio, wenn Screen-Audio vorhanden.
        const newAudioTrack = newStream ? newStream.getAudioTracks()[0] : null;
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

        // Nur Audio-Track ersetzen/hinzufügen, wenn es ein neuer Stream ist (Kamera ODER Screen mit Audio)
        // Dies bedeutet, wenn Screensharing mit Audio gestartet wird, wird das Mikrofon-Audio ersetzt.
        // Wenn Screensharing (ohne Audio) gestartet wird, bleibt der Mikrofon-Audio-Track (falls er von localStream kam).
        // Wenn vom Screen-Sharing (mit Audio) zurück zur Kamera (mit Audio) gewechselt wird, wird Screen-Audio durch Mic-Audio ersetzt.
        if (audioSender) {
            if (audioSender.track === newAudioTrack && newAudioTrack !== null) {
                console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Neuer Audio-Track (${newAudioTrack?.id}) ist identisch mit dem aktuellen. Keine Aktion.`);
            } else {
                console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Ersetze bestehenden Audio-Track ${audioSender.track?.id || 'N/A'} durch ${newAudioTrack?.id || 'null'} (Stream-Typ '${streamType}').`);
                await audioSender.replaceTrack(newAudioTrack)
                    .then(() => { tracksEffectivelyReplacedOrAdded = true; console.log("[WebRTC LOG] Audio-Track erfolgreich via replaceTrack geändert/entfernt."); })
                    .catch(e => console.error("[WebRTC LOG] Fehler beim Ersetzen des Audio-Tracks:", e));
            }
        } else if (newAudioTrack) { // Kein Audio-Sender, aber neuer Audio-Track -> hinzufügen
            console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Füge neuen Audio-Track ${newAudioTrack.id} hinzu (kein Sender, Stream-Typ '${streamType}').`);
            try {
                state.peerConnection.addTrack(newAudioTrack, newStream);
                tracksEffectivelyReplacedOrAdded = true;
                console.log("[WebRTC LOG] Audio-Track erfolgreich via addTrack hinzugefügt.");
            } catch (e) {
                console.error("[WebRTC LOG] Fehler beim Hinzufügen des neuen Audio-Tracks:", e);
            }
        }


        if (tracksEffectivelyReplacedOrAdded) {
            console.log("[WebRTC LOG] replaceTracksInPeerConnection: Tracks wurden geändert. Neuverhandlung wird angestoßen.");
            // `onnegotiationneeded` sollte automatisch ausgelöst werden, wenn der Initiator der Verbindung (`socketId < currentPCPartnerId`) dies tut.
            // Wenn man der Empfänger ist, sollte man auf ein Offer warten.
            // Für robustes Verhalten, besonders wenn Tracks programmatisch geändert werden:
            await createAndSendOffer(); // Stößt Offer an, falls Bedingungen erfüllt (z.B. 'stable' state)
        } else {
            console.log("[WebRTC LOG] replaceTracksInPeerConnection: Keine effektive Änderung der Tracks. Keine Neuverhandlung angestoßen.");
        }
        return tracksEffectivelyReplacedOrAdded;
    }


    function closePeerConnection() {
        if (state.peerConnection) {
            console.log("[WebRTC LOG] closePeerConnection: Schließe PeerConnection mit:", state.currentPCPartnerId);
            // Tracks von Sendern entfernen und stoppen
            state.peerConnection.getSenders().forEach(sender => {
                if (sender.track) {
                    // sender.track.stop(); // Tracks nicht stoppen, da sie noch lokal verwendet werden könnten (localStream)
                }
                // state.peerConnection.removeTrack(sender); // Nicht notwendig, da close() alles erledigt
            });
            state.peerConnection.close(); // Schließt die Verbindung und setzt Signalling State etc.
            state.peerConnection = null; // Entferne Referenz
        }
        state.currentPCPartnerId = null; // Partner zurücksetzen
        if(state.remoteStream){ // Remote Stream Tracks stoppen und Stream nullen
            state.remoteStream.getTracks().forEach(track => track.stop());
            state.remoteStream = null;
        }
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false); // Remote Video UI zurücksetzen
        console.log("[WebRTC LOG] closePeerConnection: PeerConnection und Partner-ID zurückgesetzt.");
    }

    function initiateP2PConnection() {
        if (!state.connected || !socket || !state.socketId) { // Eigene ID muss bekannt sein
            console.log("[WebRTC LOG] initiateP2PConnection: Bedingungen nicht erfüllt (nicht verbunden, kein Socket oder keine eigene ID).");
            return;
        }
        // Nur wenn noch keine Verbindung besteht oder der Partner nicht mehr da ist.
        if (state.peerConnection && state.currentPCPartnerId && state.allUsersList.some(u => u.id === state.currentPCPartnerId)) {
             console.log(`[WebRTC LOG] initiateP2PConnection: Bestehende Verbindung zu ${state.currentPCPartnerId}. Keine Aktion.`);
             return;
        } else if (state.peerConnection && state.currentPCPartnerId) { // Partner weg, aber PC noch da
            closePeerConnection(); // Alte Verbindung aufräumen
        }


        const otherUsers = state.allUsersList.filter(u => u.id !== state.socketId); // Alle anderen User
        if (otherUsers.length === 0) {
            console.log("[WebRTC LOG] initiateP2PConnection: Keine anderen Benutzer im Raum.");
            if(state.currentPCPartnerId) closePeerConnection(); // Alte PC schließen, wenn man alleine ist
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
            return;
        }

        // Wähle einen Partner. Hier einfach der erste aus der Liste der anderen User.
        // Man könnte eine komplexere Logik implementieren (z.B. den mit der kleinsten ID, um Konsistenz zu gewährleisten)
        const targetUser = otherUsers.sort((a,b) => a.id.localeCompare(b.id))[0]; // Sortiere für konsistente Wahl
        console.log(`[WebRTC LOG] initiateP2PConnection: Potenzieller P2P Partner: ${targetUser.username} (${targetUser.id})`);


        // "Polite Peer" Logik: Der Peer mit der "kleineren" ID initiiert das Offer.
        // Stellt sicher, dass nicht beide gleichzeitig ein Offer senden (Glare-Situation).
        const shouldInitiateOffer = state.socketId < targetUser.id;

        if (shouldInitiateOffer) {
            console.log(`[WebRTC LOG] initiateP2PConnection: Bin Initiator (${state.socketId} < ${targetUser.id}). Erstelle PeerConnection und sende Offer an ${targetUser.username}.`);
            // Stelle sicher, dass lokale Medien bereit sind, bevor Offer gesendet wird.
            // `setupLocalMedia` sollte bereits Tracks im `state.localStream` oder `state.screenStream` haben.
            // Wenn nicht, wird es hier versucht.
            const mediaReady = (state.isSharingScreen && state.screenStream) || state.localStream;
            if (!mediaReady) {
                console.warn("[WebRTC LOG] initiateP2PConnection: Lokale Medien nicht bereit für Offer. Versuche setupLocalMedia.");
                setupLocalMedia().then(async (success) => { // setupLocalMedia ist async
                    if (success) {
                        await createPeerConnection(targetUser.id); // Erstellt PC und fügt lokale Tracks hinzu
                        await createAndSendOffer(); // Sendet initiales Offer
                    } else {
                        console.error("[WebRTC LOG] initiateP2PConnection: Lokale Medien konnten nicht gestartet werden. Kein Offer gesendet.");
                    }
                });
            } else { // Medien sind schon bereit
                createPeerConnection(targetUser.id).then(async () => { // createPeerConnection ist async
                    await createAndSendOffer();
                });
            }
        } else {
            console.log(`[WebRTC LOG] initiateP2PConnection: Bin Empfänger (${state.socketId} > ${targetUser.id}). Warte auf Offer von ${targetUser.username}. Erstelle PeerConnection, um bereit zu sein.`);
            // Erstelle PeerConnection, füge lokale Tracks hinzu, aber sende kein Offer.
            const mediaReady = (state.isSharingScreen && state.screenStream) || state.localStream;
            if (!mediaReady) {
                 setupLocalMedia().then(success => {
                     if(success) createPeerConnection(targetUser.id);
                 });
            } else {
                 createPeerConnection(targetUser.id);
            }
        }
    }


    async function toggleScreenSharing() {
        if (!state.connected || !UI.shareScreenBtn) return;
        UI.shareScreenBtn.disabled = true; // Button während des Vorgangs deaktivieren

        if (state.isSharingScreen) { // Screensharing beenden
            console.log("[WebRTC LOG] toggleScreenSharing: Beende Screensharing.");
            if (state.screenStream) {
                state.screenStream.getTracks().forEach(track => track.stop());
                state.screenStream = null;
                console.log("[WebRTC LOG] toggleScreenSharing: ScreenStream gestoppt.");
            }
            state.isSharingScreen = false;
            UI.shareScreenBtn.textContent = 'Bildschirm teilen';
            UI.shareScreenBtn.classList.remove('danger-btn');

            // Ersetze Screen-Tracks durch Kamera-Tracks
            if (state.localStream && state.localStream.active) { // Nur wenn Kamera-Stream aktiv ist/war
                console.log("[WebRTC LOG] toggleScreenSharing: Kamera-Stream ist aktiv. Ersetze Screen-Tracks durch Kamera-Tracks.");
                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true); // Lokale Ansicht aktualisieren
                if (state.peerConnection) {
                    await replaceTracksInPeerConnection(state.localStream, 'camera'); // Stößt Neuverhandlung an
                }
            } else { // Falls kein Kamera-Stream da war oder nicht aktiv (z.B. nur Audio)
                console.log("[WebRTC LOG] toggleScreenSharing: Kein aktiver Kamera-Stream. Versuche Kamera neu zu starten.");
                await setupLocalMedia(false); // Startet Kamera und initiiert ggf. Neuverhandlung via replaceTracks
            }

        } else { // Screensharing starten
            console.log("[WebRTC LOG] toggleScreenSharing: Starte Screensharing.");
            try {
                // Wichtig: Hier audio: true/false je nach Bedarf. Wenn true, muss Screen-Audio ggf. mit Mic gemischt werden
                // oder das Mic-Audio ersetzen (was die aktuelle `replaceTracksInPeerConnection` tun würde).
                // Für Einfachheit erstmal audio: false für Screen-Share.
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always", frameRate: { ideal: 10, max: 15 } }, // Niedrigere Framerate für Screensharing
                    audio: false // true, wenn Screen-Audio gewünscht ist (siehe Kommentar oben)
                });
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');

                console.log(`[WebRTC LOG] toggleScreenSharing: ScreenStream ${state.screenStream.id} erhalten. VideoTrack: ${state.screenStream.getVideoTracks()[0]?.id}, AudioTrack: ${state.screenStream.getAudioTracks()[0]?.id}`);

                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true); // Zeige geteilten Bildschirm lokal an

                if (state.peerConnection) {
                    await replaceTracksInPeerConnection(state.screenStream, 'screen'); // Stößt Neuverhandlung an
                }

                // Listener für das Beenden des Teilens durch den Browser-Button ("Stop sharing" im Browser-Fenster)
                if (state.screenStream.getVideoTracks()[0]) {
                    state.screenStream.getVideoTracks()[0].onended = () => {
                        console.log("[WebRTC LOG] toggleScreenSharing: Screensharing durch Browser-UI (Stop-Button) beendet.");
                        // Nur wenn Screensharing noch aktiv ist (verhindert doppelte Ausführung, falls schon durch Button geklickt wurde)
                        if (state.isSharingScreen) {
                            toggleScreenSharing(); // Ruft die eigene Funktion auf, um alles sauber zu beenden
                        }
                    };
                }
            } catch (err) {
                console.error('[WebRTC LOG] toggleScreenSharing: Fehler beim Starten der Bildschirmfreigabe:', err.name, err.message);
                displayError(`Bildschirmfreigabe fehlgeschlagen: ${err.message}`);
                state.isSharingScreen = false; // Zustand zurücksetzen
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                UI.shareScreenBtn.classList.remove('danger-btn');
                // Stelle Kamera wieder her, falls sie vorher lief und Screen-Sharing fehlschlug
                if (state.localStream && state.localStream.active) {
                    updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
                    // Hier könnte man überlegen, ob eine Neuverhandlung nötig ist, um sicherzustellen, dass der Peer den Kamerastream hat.
                    // replaceTracksInPeerConnection(state.localStream, 'camera') wäre eine Möglichkeit.
                }
            }
        }
        UI.shareScreenBtn.disabled = false; // Button wieder aktivieren
    }


    function toggleFullscreen(videoElement) {
        if (!videoElement || videoElement.classList.contains('hidden')) return;
        if (!document.fullscreenElement) {
            if (videoElement.requestFullscreen) {
                videoElement.requestFullscreen().catch(err => console.error(`[UI] Fullscreen error: ${err.message}`, err));
            } else if (videoElement.webkitRequestFullscreen) { /* Safari */
                videoElement.webkitRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (webkit): ${err.message}`, err));
            } else if (videoElement.msRequestFullscreen) { /* IE11 */
                videoElement.msRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (ms): ${err.message}`, err));
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { /* Safari */
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) { /* IE11 */
                document.msExitFullscreen();
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
        UI.messageInput.placeholder = `Datei ausgewählt: ${escapeHTML(file.name)}. Nachricht optional.`;
        // Optional: kleine Vorschau für Bilder direkt im Input-Bereich anzeigen
    }

    function resetFileInput() {
        state.selectedFile = null;
        if (UI.fileInput) UI.fileInput.value = ''; // Wichtig, um denselben File nochmal wählen zu können
        UI.messageInput.placeholder = 'Nachricht eingeben...';
    }


    // --- Init ---
    initializeUI(); // Grund-UI setzen
    // populateMicList() wird jetzt nach erfolgreichem 'joinSuccess' aufgerufen,
    // um sicherzustellen, dass Mikrofonberechtigungen ggf. schon erteilt wurden.

}); // Ende DOMContentLoaded Listener
