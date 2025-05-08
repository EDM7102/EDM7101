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
        localVideo: document.getElementById('localVideo'), // Bleibt im DOM, wird aber nicht angezeigt
        remoteVideo: document.getElementById('remoteVideo'),
        localScreenStatus: document.getElementById('localScreenStatus'), // Statusanzeige für lokales Audio/Screen
        remoteScreenStatus: document.getElementById('remoteScreenStatus'),
        localVideoBox: document.getElementById('localVideoBox'), // Die gesamte Box für lokales Video/Status
        remoteVideoBox: document.getElementById('remoteVideoBox'),
        fileInput: document.getElementById('fileInput'),
        fileUploadLabel: document.getElementById('fileUploadLabel'),
        localVideoFullscreenBtn: document.getElementById('localVideoFullscreenBtn'), // Bleibt im DOM, aber hidden
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
        localStream: null, // Wird nur Audio-Tracks enthalten (vom Mikro) oder null, wenn Mikro aus/fehlgeschlagen
        remoteStream: null, // Wird im ontrack Handler gesetzt
        screenStream: null, // Enthält den Stream vom geteilten Bildschirm
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
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        // Lokales Video/Screen Box ausblenden, nur Remote soll sichtbar sein
        if (UI.localVideoBox) UI.localVideoBox.classList.add('hidden');
        if (UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.classList.add('hidden');
        if (UI.micSelect) UI.micSelect.disabled = false;
         updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // Lokale UI initialisieren (Status)
         updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false); // Remote UI initialisieren
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
        console.log("[UI] updateUIAfterConnect aufgerufen. state.connected:", state.connected);
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
        console.log("[UI] updateUIAfterDisconnect aufgerufen. state.connected:", state.connected);
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
        stopLocalStream(); // Stoppt sowohl Mikrofon- als auch Screen-Stream
        closePeerConnection();
        if (state.isSharingScreen) {
            state.isSharingScreen = false;
            UI.shareScreenBtn.textContent = 'Bildschirm teilen';
            UI.shareScreenBtn.classList.remove('danger-btn');
        }
        state.users = {};
        state.allUsersList = [];
        state.socketId = null;
         updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // Lokale UI zurücksetzen
         updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false); // Remote UI zurücksetzen
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
    // Fullscreen Buttons sind jetzt auf localVideoBox/remoteVideoBox, die localVideoBox ist hidden
    // if (UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.localVideo));
    if (UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.remoteVideo));

    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        // Nur wenn verbunden und NICHT Bildschirm teilt, versuchen Audio neu zu initialisieren
        // Wenn Screensharing aktiv ist, bleibt der Screen-Audio-Track (falls vorhanden) oder es ist kein Audio-Track gesendet.
        if (state.connected && !state.isSharingScreen) {
            console.log("[WebRTC LOG] Mikrofon geändert. Initialisiere Audio neu.");
            await setupLocalMedia(true); // true für audioOnlyUpdate
        } else if (!state.connected) {
            console.log("[WebRTC LOG] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
        } else if (state.isSharingScreen) {
             console.log("[WebRTC LOG] Mikrofonauswahl geändert während Screensharing. Änderung wird erst nach Beenden des Screensharing wirksam.");
             // Optional: Hinweis an den Benutzer anzeigen
        }
    });

    window.addEventListener('beforeunload', () => {
        if (socket && socket.connected) {
            socket.disconnect();
        }
    });
    document.addEventListener('fullscreenchange', () => {
        [
            // { btn: UI.localVideoFullscreenBtn, video: UI.localVideo }, // Lokales Video ist hidden, kein Fullscreen-Button nötig
            { btn: UI.remoteVideoFullscreenBtn, video: UI.remoteVideo }
        ].forEach(item => {
            if (item.btn) {
                // Prüfe, ob das Element gerade im Vollbildmodus ist
                const isTargetInFullscreen = document.fullscreenElement === item.video || (item.video && item.video.contains(document.fullscreenElement));

                item.btn.textContent = isTargetInFullscreen ? "Vollbild verlassen" : "Vollbild";
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
        console.log("[WebRTC LOG] populateMicList aufgerufen.");
        if (!UI.micSelect) {
            console.warn("[WebRTC LOG] populateMicList: UI.micSelect nicht gefunden.");
            return;
        }
        UI.micSelect.innerHTML = ''; // Bestehende Optionen entfernen
        // Standard-Option hinzufügen
        UI.micSelect.appendChild(new Option("Standard-Mikrofon", ""));

        try {
            // Kurzen Zugriff anfordern, um Berechtigungen zu prüfen und vollständige Liste zu erhalten
            // Nur Audio anfordern, da keine Kamera benötigt wird
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            // Tracks stoppen, da dieser Stream nur zur Geräteerkennung dient
            tempStream.getTracks().forEach(track => track.stop());

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length > 0) {
                 audioInputs.forEach((d, i) => {
                     // Füge Geräte hinzu, außer dem Standardgerät, falls es bereits als separate Option gelistet ist
                     if (d.deviceId !== 'default' || !audioInputs.some(dev => dev.deviceId === 'default' && dev.label === d.label)) {
                         UI.micSelect.appendChild(new Option(d.label || `Mikrofon ${i + 1}`, d.deviceId));
                     }
                 });
            } else {
                 console.warn("[WebRTC LOG] populateMicList: Keine Mikrofone gefunden.");
                 // Optional: Hinweis im UI, dass keine Mikrofone gefunden wurden
            }
        } catch (e) {
            console.warn("[WebRTC LOG] populateMicList: Fehler bei der Mikrofonauflistung:", e.name, e.message);
             // Fehlermeldung im UI anzeigen, dass Mikrofonzugriff verweigert wurde oder ein Fehler auftrat
             const opt = new Option(`Mikrofonzugriff Fehler: ${e.name}`, "");
             opt.style.color = 'var(--error-bg)';
             UI.micSelect.appendChild(opt);
             displayError(`Mikrofonzugriff fehlgeschlagen: ${e.message}.`);
        }
    }

    // --- UI Update Functions ---
    function updateVideoDisplay(videoElement, statusElement, stream, isLocal = false) {
        // Diese Funktion wird weiterhin für lokales (verstecktes) und remote Video aufgerufen
        if (!videoElement || !statusElement) {
            console.warn(`[WebRTC LOG] updateVideoDisplay: Video- oder Statuselement für ${isLocal ? 'lokal' : 'remote'} nicht gefunden.`);
            return;
        }

        const fullscreenBtn = isLocal ? UI.localVideoFullscreenBtn : UI.remoteVideoFullscreenBtn;
        // Ein Stream ist "aktiv", wenn er Tracks hat UND der Stream selbst nicht inactive ist
        const hasActiveTracks = stream && stream.active && stream.getTracks().some(t => t.readyState === 'live'); // Prüfe auf aktive Tracks

        if (hasActiveTracks) {
            console.log(`[WebRTC LOG] updateVideoDisplay (${isLocal ? 'lokal' : 'remote'}): Stream ${stream.id} ist aktiv. Tracks: Video: ${stream.getVideoTracks().length}, Audio: ${stream.getAudioTracks().length}. Status Element:`, statusElement);
            videoElement.srcObject = stream;
            // Prüfe, ob ein aktiver, nicht gemuteter Video-Track vorhanden ist
            const hasVideo = stream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);

            if (hasVideo) {
                console.log(`[WebRTC LOG] updateVideoDisplay (${isLocal ? 'lokal' : 'remote'}): Hat aktiven Video-Track. Zeige Video an.`);
                videoElement.play().catch(e => console.warn(`[WebRTC LOG] Videowiedergabe (${isLocal ? 'lokal' : 'remote'}) fehlgeschlagen für Stream ${stream.id}:`, e));
                videoElement.classList.remove('hidden');
                statusElement.classList.add('hidden'); // Status ausblenden, wenn Video da ist
            } else { // Nur Audio oder Video gemuted/nicht vorhanden
                 console.log(`[WebRTC LOG] updateVideoDisplay (${isLocal ? 'lokal' : 'remote'}): Hat keinen aktiven Video-Track. Zeige Status an.`);
                videoElement.classList.add('hidden'); // Video ausblenden
                // Angepasste Status-Texte
                if (isLocal) {
                    statusElement.textContent = state.isSharingScreen ? "BILDSCHIRM GETEILT" : "DEIN AUDIO AKTIV";
                } else {
                    statusElement.textContent = "REMOTE AUDIO AKTIV ODER KEIN VIDEO";
                }
                statusElement.className = 'screen-status-label loading'; // Oder andere Klasse für "aktiv"
                statusElement.classList.remove('hidden'); // Status einblenden
            }
            // Fullscreen-Button nur anzeigen, wenn Video sichtbar ist UND es nicht das lokale (versteckte) Video ist
            if (fullscreenBtn) {
                 if (hasVideo && !isLocal) { // Nur Remote-Video hat sichtbaren Fullscreen-Button
                     fullscreenBtn.classList.remove('hidden');
                 } else {
                     fullscreenBtn.classList.add('hidden');
                 }
            }

        } else {
            console.log(`[WebRTC LOG] updateVideoDisplay (${isLocal ? 'lokal' : 'remote'}): Kein aktiver Stream oder keine Tracks. Setze UI zurück.`);
            // Sicherstellen, dass alle Tracks des alten srcObject gestoppt werden
            if (videoElement.srcObject) {
                videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
            videoElement.srcObject = null; // Wichtig, um Verbindung zu lösen
            videoElement.classList.add('hidden');
            // Angepasste Status-Texte für Offline/Fehler
            if (isLocal) {
                statusElement.textContent = "MIKROFON AUS / FEHLER";
            } else {
                statusElement.textContent = "KEIN VIDEO/SCREEN";
            }
            statusElement.className = 'screen-status-label offline';
            statusElement.classList.remove('hidden'); // Status einblenden
            if (fullscreenBtn) fullscreenBtn.classList.add('hidden'); // Fullscreen Button ausblenden
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
        console.log("[Socket.IO] connect() aufgerufen. state.connected vor Verbindungsversuch:", state.connected);
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
        console.log("[Socket.IO] setupSocketListeners aufgerufen.");

        socket.on('connect', async () => {
            // state.connected wird hier noch NICHT auf true gesetzt.
            // Wir warten auf 'joinSuccess' vom Server als Bestätigung.
            console.log('[Socket.IO] "connect" event erhalten. Socket verbunden auf Transport:', socket.io.engine.transport.name, 'Socket ID:', socket.id);
             // Die eigene Socket-ID und Userliste kommt per 'joinSuccess'
        });

        socket.on('connecting', (transport) => {
             console.log(`[Socket.IO] "connecting" event erhalten. Versuche über Transport: ${transport}`);
        });
         socket.on('connect_error', (err) => {
            console.error('[Socket.IO] "connect_error" erhalten:', err.message, err.data);
            state.connected = false; // Setze auf false bei Verbindungsfehler
            console.log("[Socket.IO] state.connected nach connect_error:", state.connected);
            displayError(`Verbindungsfehler: ${err.message}. Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            updateUIAfterDisconnect(); // Stellt sicher, dass UI zurückgesetzt wird
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] "disconnect" event erhalten: ${reason}`);
            state.connected = false; // Setze auf false bei Trennung
            console.log("[Socket.IO] state.connected nach disconnect:", state.connected);
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect();
        });

        socket.on('joinSuccess', async ({ users: currentUsers, id: myId }) => {
            console.log(`[Socket.IO] "joinSuccess" event erhalten. Dein Socket ID: ${myId}, Benutzer im Raum:`, currentUsers);
            state.connected = true; // Jetzt wissen wir, dass wir erfolgreich verbunden und im Raum sind
            console.log("[Socket.IO] state.connected nach joinSuccess:", state.connected);
            state.socketId = myId; // Eigene ID speichern
            state.username = currentUsers.find(u => u.id === myId)?.username || state.username; // Username vom Server übernehmen, falls geändert
            updateUserList(currentUsers);
            updateUIAfterConnect(); // Jetzt UI aktualisieren, da wir ID und Userliste haben

            await populateMicList(); // Mikrofonliste nach erfolgreichem Join (und ggf. Permission Grant) laden

            // Lokale Medien starten (nur Audio standardmäßig)
            if (!state.localStream && !state.isSharingScreen) {
                 console.log("[WebRTC LOG] Join Success: Lokaler Stream (Audio only) wird gestartet.");
                 await setupLocalMedia(); // Startet standardmäßig nur Audio
            } else {
                 console.log("[WebRTC LOG] Join Success: Lokaler Stream existiert bereits oder Screensharing ist aktiv. Überspringe setupLocalMedia.");
                 // Hier könnte man optional sicherstellen, dass der bestehende Stream (Audio only oder Screen) noch in der PC ist.
                 // initiateP2PConnection() unten wird dies sowieso machen.
            }

            initiateP2PConnection(); // P2P-Verbindung zu anderen Nutzern initiieren
        });


        socket.on('joinError', ({ message }) => {
            console.error(`[Socket.IO] "joinError" erhalten: ${message}`);
            state.connected = false; // Bei Join-Fehler sind wir nicht verbunden
            console.log("[Socket.IO] state.connected nach joinError:", state.connected);
            displayError(message);

            // Wenn der Fehler "Username already taken" ist, nicht sofort disconnecten,
            // damit der Nutzer den Namen ändern und es erneut versuchen kann.
            if (!message.toLowerCase().includes("benutzername in diesem raum bereits vergeben")) {
                // if (socket) socket.disconnect(); // disconnect wird nicht benötigt, wenn der Server die Verbindung schließt
                 updateUIAfterDisconnect(); // Stelle UI zurück, falls Socket geschlossen wird
            } else { // Bei "Username already taken"
                // Die Verbindung bleibt u.U. bestehen, aber der Join ist fehlgeschlagen.
                // Setze den Status manuell zurück, um erneuten Versuch zu ermöglichen.
                setConnectionStatus('disconnected', 'Benutzername bereits vergeben');
                 if (UI.usernameInput) UI.usernameInput.disabled = false;
                 UI.connectBtn.classList.remove('hidden');
                 UI.disconnectBtn.classList.add('hidden');
                 UI.shareScreenBtn.classList.add('hidden');
                 UI.sendBtn.disabled = true;
                 UI.messageInput.disabled = true;
                 if (UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
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
            if (!state.currentPCPartnerId && state.connected && state.allUsersList.some(u => u.id !== state.socketId)) {
                console.log("[WebRTC LOG] Neue User im Raum oder keine aktive Verbindung. Versuche P2P Verbindung.");
                initiateP2PConnection();
            } else if (state.connected && state.allUsersList.length === 1 && state.allUsersList[0].id === state.socketId) {
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
            // Sicherstellen, dass lokale Medien bereit sind (mindestens Audio), BEVOR setRemoteDescription aufgerufen wird, falls noch nicht geschehen.
            // Da standardmäßig nur Audio gestartet wird, sollte setupLocalMedia() hier nur Audio holen, falls noch nicht vorhanden.
             if (!state.localStream && !state.isSharingScreen) { // Wenn weder lokales Audio noch Screen-Share aktiv ist
                 console.log("[WebRTC LOG] webRTC-offer: Lokaler Stream nicht bereit, versuche setupLocalMedia (Audio only).");
                 await setupLocalMedia(); // Stellt sicher, dass (Audio-)Tracks für die Antwort verfügbar sind
             } else if (state.localStream && state.localStream.getAudioTracks().length === 0 && !state.isSharingScreen) {
                 // Fallback: Falls localStream da ist, aber keinen Audio-Track hat (könnte durch vorherigen Fehler passieren), Audio neu versuchen
                 console.log("[WebRTC LOG] webRTC-offer: Lokaler Stream existiert, hat aber keinen Audio-Track. Versuche setupLocalMedia (Audio only) erneut.");
                 await setupLocalMedia(true); // audioOnlyUpdate
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
            // Erlauben setRemoteDescription sowohl im 'have-local-offer' als auch im 'stable' Zustand
             if (state.peerConnection.signalingState === "have-local-offer" || state.peerConnection.signalingState === "stable") {
                try {
                    console.log(`[WebRTC LOG] webRTC-answer: Setze Remote Description (Answer) von ${from}. Aktueller Signalling State: ${state.peerConnection.signalingState}`);
                    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                    console.log(`[WebRTC LOG] webRTC-answer: Remote Description (Answer) gesetzt. Neuer Signalling State: ${state.peerConnection.signalingState}`);
                } catch (err) {
                    console.error(`[WebRTC LOG] webRTC-answer: Fehler beim Setzen der Remote Description (Answer) von ${from}:`, err);
                    displayError(`Fehler bei Video-Verhandlung mit ${from} (Answer-Processing).`);
                }
            } else {
                console.warn(`[WebRTC LOG] webRTC-answer: Antwort von ${from} erhalten, aber PeerConnection nicht im Zustand 'have-local-offer' oder 'stable' (aktuell: ${state.peerConnection.signalingState}). Antwort wird ignoriert.`);
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            console.log(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat erhalten von ${from}:`, candidate ? (candidate.candidate ? candidate.candidate.substring(0,50) + '...' : candidate) : 'null'); // Logge nur Teil des Kandidatenstrings
            if (state.peerConnection && state.currentPCPartnerId === from && state.peerConnection.remoteDescription) {
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erfolgreich hinzugefügt.`);
                } catch (e) {
                    console.error(`[WebRTC LOG] webRTC-ice-candidate: Fehler beim Hinzufügen des ICE Kandidaten von ${from}:`, e.name, e.message);
                     // Wenn der Fehler 'OperationError' ist und die Beschreibung "The ICE candidate could not be added." enthält,
                     // könnte es ein Hinweis auf einen bereits geschlossenen Port oder ähnliches sein.
                     // Ein genereller Fehler beim addIceCandidate kann auf Netzwerkprobleme oder Probleme mit der SDP hindeuten.
                }
            } else if (state.peerConnection && state.currentPCPartnerId === from && !state.peerConnection.remoteDescription) {
                 console.warn(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erhalten, aber RemoteDescription ist noch nicht gesetzt (aktuell: ${state.peerConnection.signalingState}). Kandidat wird ggf. intern vom Browser gepuffert.`);
                 // Browser puffern Kandidaten oft, bis setRemoteDescription aufgerufen wurde. Manchmal muss man sie aber manuell puffern.
                 // Fürs Erste verlassen wir uns auf das Browser-Buffering.
                 try {
                     await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                     console.log(`[WebRTC LOG] webRTC-ice-candidate: Gepufferter ICE Kandidat von ${from} erfolgreich nachträglich hinzugefügt.`);
                 } catch (e) {
                    console.error(`[WebRTC LOG] webRTC-ice-candidate: Fehler beim nachträglichen Hinzufügen des gepufferten ICE Kandidaten von ${from}:`, e.name, e.message);
                 }
            } else {
                console.warn(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erhalten, aber PeerConnection nicht bereit oder falscher Partner (aktuell: ${state.currentPCPartnerId}, remoteDesc: ${!!state.peerConnection?.remoteDescription}, signalingState: ${state.peerConnection?.signalingState}).`);
            }
        });
    } // Ende setupSocketListeners

    function disconnect() {
        console.log("[Socket.IO] Trenne Verbindung manuell. state.connected vor Trennung:", state.connected);
        if (socket) {
            socket.disconnect(); // Dies löst das 'disconnect' Event aus, das updateUIAfterDisconnect aufruft
        } else {
            // Fallback, falls Socket-Objekt nicht existiert, aber UI zurückgesetzt werden soll
            updateUIAfterDisconnect();
        }
    }

    // --- Chat Logic ---
    function sendMessage() {
        console.log("sendMessage() aufgerufen. state.connected:", state.connected, "socket existiert:", !!socket);
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) {
            console.log("sendMessage: Kein Inhalt oder Datei ausgewählt. Abbruch.");
            return;
        }
        console.log("sendMessage: Inhalt oder Datei vorhanden. Prüfe Verbindung...");

        if (!socket || !state.connected) {
            console.error("[Chat Send Error] Cannot send message. socket is null/undefined:", !socket, "state.connected is false:", !state.connected);
            displayError("Nicht verbunden. Nachricht kann nicht gesendet werden.");
            return;
        }
        console.log("sendMessage: Verbindung aktiv. Sende Nachricht/Datei.");

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
                    console.log(`sendMessage: Sende Bilddatei "${message.file.name}" (${formatFileSize(message.file.size)})`);
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
                console.log(`sendMessage: Sende Datei-Info für "${message.file.name}" (${formatFileSize(message.file.size)})`);
                socket.emit('file', message);
                resetFileInput();
            }
        } else { // Normale Textnachricht
            const message = { ...messageBase, type: 'text' };
            console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, 50)}..."`);
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
        img.alt = "Vollbildansicht"; // Alternativtext für Barrierefreiheit

        modal.appendChild(img);
        document.body.appendChild(modal);
    }


    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) {
             console.log("sendTyping: Nicht verbunden, sende Tipp-Status nicht.");
             return;
        }
        // Sende Tipp-Status nur, wenn auch Nachrichten gesendet werden können
        if(UI.messageInput.disabled) {
             console.log("sendTyping: Nachrichteneingabe deaktiviert, sende Tipp-Status nicht.");
             return;
        }

        clearTimeout(state.typingTimeout);
        // Sende Tipp-Status nur, wenn er sich ändert oder Timer abgelaufen ist
        // Um Server-Last zu reduzieren, könnte man hier client-seitig eine Rate-Limit einbauen.
        // Für jetzt senden wir einfach bei jeder Eingabe und dann nochmal false nach Pause.

        socket.emit('typing', { isTyping }); // Sendet den aktuellen Tipp-Status
        console.log(`sendTyping: Emitting typing: ${isTyping}`);
        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                console.log("sendTyping: Timer abgelaufen, sende typing: false");
                socket.emit('typing', { isTyping: false }); // Sendet 'tippt nicht mehr' nach Timer-Ablauf
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- WebRTC Logic ---
    // Diese Funktion startet standardmäßig nur den Mikrofon-Stream (Audio-only)
    // Wenn audioOnlyUpdate = true, versucht sie nur den Audio-Track zu aktualisieren
    async function setupLocalMedia(audioOnlyUpdate = false) {
        console.log(`[WebRTC LOG] setupLocalMedia aufgerufen. audioOnlyUpdate: ${audioOnlyUpdate}, isSharingScreen: ${state.isSharingScreen}`);

        // Wenn bereits Screensharing aktiv ist und dies kein reines Audio-Update ist, nichts tun.
        // Die Medien für die PeerConnection kommen dann vom ScreenStream.
        if (state.isSharingScreen && !audioOnlyUpdate) {
            console.log("[WebRTC LOG] setupLocalMedia: Screensharing ist aktiv. Lokale Medien (Kamera/Audio) werden nicht jetzt initialisiert/geändert.");
             // Sicherstellen, dass der ScreenStream in der PC ist, falls PC neu erstellt wurde
             if(state.peerConnection && state.screenStream) {
                  console.log("[WebRTC LOG] setupLocalMedia: Screensharing aktiv. Stelle sicher, dass ScreenStream Tracks in PC sind.");
                  addTracksToPeerConnection(state.screenStream); // Fügt Screen Tracks hinzu, falls noch nicht da
             }
            return true; // Meldet Erfolg, auch wenn keine neuen Medien geholt wurden, da Screensharing aktiv ist
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

                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false }); // Nur Audio holen
                const newAudioTrack = audioStream.getAudioTracks()[0];

                if (newAudioTrack) {
                    console.log(`[WebRTC LOG] setupLocalMedia: Füge neuen Audio-Track ${newAudioTrack.id} zum localStream hinzu.`);
                    state.localStream.addTrack(newAudioTrack);
                    streamToProcess = state.localStream; // Der bestehende Stream mit neuem AudioTrack
                } else {
                    console.warn("[WebRTC LOG] setupLocalMedia: Konnte keinen neuen Audio-Track für Update bekommen.");
                    // Wenn kein neuer Track verfügbar ist, bleibt der Stream ggf. ohne Audio-Track.
                    streamToProcess = state.localStream; // Verwende den Stream ohne neuen Audio-Track
                    // displayError("Konnte Mikrofon nicht aktualisieren."); // Optional: Fehlermeldung
                }
            } else { // Vollständiger Stream-Aufbau oder erster Aufbau (Audio only)
                console.log("[WebRTC LOG] setupLocalMedia: Fordere neuen Audio-only Stream (Mikro) an.");
                // Bestehenden lokalen Stream (Microfon) stoppen, falls vorhanden und nicht Screen-Share
                 if (state.localStream && !state.isSharingScreen) {
                     console.log("[WebRTC LOG] setupLocalMedia: Stoppe bestehenden lokalen Audio-Stream für kompletten Neustart.");
                     state.localStream.getTracks().forEach(track => track.stop());
                     state.localStream = null; // Alte Referenz löschen
                 }
                // Kamera immer auf false setzen
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: false, // KEINE KAMERA
                    audio: audioConstraints
                });
                state.localStream = newStream; // Dies ist nun der Audio-only Stream
                streamToProcess = state.localStream;
                console.log(`[WebRTC LOG] setupLocalMedia: Neuer lokaler Audio-only Stream erstellt: ${streamToProcess.id}. Tracks: Video: ${streamToProcess.getVideoTracks().length}, Audio: ${streamToProcess.getAudioTracks().length}`);
            }

            // UI für lokales Video aktualisieren (wird den Status anzeigen, da video:false)
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, streamToProcess, true);

            // Wenn eine PeerConnection existiert (was der Fall sein sollte, wenn connected),
            // die Tracks in der PC durch die neuen/aktualisierten ersetzen.
            // Hier wird der Audio-only Stream oder der aktualisierte Audio-only Stream in die PC gebracht.
            if (state.peerConnection) {
                console.log("[WebRTC LOG] setupLocalMedia: Lokaler Audio-Stream geändert/aktualisiert, aktualisiere Tracks in PeerConnection.");
                 // Ersetze die aktuellen Tracks durch die Tracks aus dem (Audio-only) streamToProcess
                 // replaceTracksInPeerConnection wird sich um die richtige Art der Tracks kümmern.
                await replaceTracksInPeerConnection(streamToProcess, 'camera'); // 'camera' hier signalisiert, dass es nicht der screenStream ist
            } else {
                 console.log("[WebRTC LOG] setupLocalMedia: PeerConnection nicht vorhanden. Tracks werden beim Erstellen der PC hinzugefügt.");
            }

            return true; // Meldet Erfolg beim Starten/Aktualisieren der lokalen Medien
        } catch (err) {
            console.error('[WebRTC LOG] setupLocalMedia: Fehler beim Zugriff auf lokale Medien (Mikro):', err.name, err.message);
            // Spezifische Fehlermeldung für den Benutzer
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                 displayError("Mikrofonzugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.");
                 if (UI.localScreenStatus) UI.localScreenStatus.textContent = "MIKROFON ZUGRIFF VERWEIGERT";
                 if (UI.micSelect) { // Mikrofonliste leeren oder Fehler anzeigen
                      UI.micSelect.innerHTML = '';
                      UI.micSelect.appendChild(new Option(`Zugriff verweigert: ${err.name}`, ""));
                 }
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                 displayError("Kein Mikrofon gefunden.");
                  if (UI.localScreenStatus) UI.localScreenStatus.textContent = "KEIN MIKROFON GEFUNDEN";
                  if (UI.micSelect) {
                      UI.micSelect.innerHTML = '';
                       UI.micSelect.appendChild(new Option("Kein Mikrofon gefunden", ""));
                  }
            } else {
                 displayError(`Fehler beim Mikrofon: ${err.message}.`);
                 if (UI.localScreenStatus) UI.localScreenStatus.textContent = `MIKROFON FEHLER: ${err.name}`;
            }


            // Sicherstellen, dass alte Tracks gestoppt und Stream-Referenz gelöscht wird bei Fehler
            if (state.localStream && !audioOnlyUpdate) { // Nur bei vollem Setup-Fehler Stream cleanen
                state.localStream.getTracks().forEach(track => track.stop());
                state.localStream = null;
            }
             updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // UI zurücksetzen auf Offline-Status

            return false; // Meldet Fehler beim Starten der lokalen Medien
        }
    }


    function stopLocalStream() {
        console.log("[WebRTC LOG] stopLocalStream: Stoppe alle lokalen Streams (Mikrofon und Screen).")
        if (state.localStream) {
            console.log(`[WebRTC LOG] stopLocalStream: Stoppe Tracks von localStream (${state.localStream.id}).`);
            state.localStream.getTracks().forEach(track => {
                 console.log(`[WebRTC LOG] stopLocalStream: Stoppe lokalen Track ${track.id} (${track.kind}).`);
                 track.stop();
            });
            state.localStream = null;
            console.log("[WebRTC LOG] stopLocalStream: localStream ist nun null.");
        } else {
             console.log("[WebRTC LOG] stopLocalStream: localStream war bereits null.");
        }
        if (state.screenStream) {
             console.log(`[WebRTC LOG] stopLocalStream: Stoppe Tracks von screenStream (${state.screenStream.id}).`);
             state.screenStream.getTracks().forEach(track => {
                  console.log(`[WebRTC LOG] stopLocalStream: Stoppe Screen Track ${track.id} (${track.kind}).`);
                  track.stop();
             });
            state.screenStream = null;
             console.log("[WebRTC LOG] stopLocalStream: screenStream ist nun null.");
        } else {
             console.log("[WebRTC LOG] stopLocalStream: screenStream war bereits null.");
        }
        // UI für localVideo wird von updateVideoDisplay mit null Stream zurückgesetzt
        updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
    }

    async function createPeerConnection(peerId) {
        console.log(`[WebRTC LOG] createPeerConnection aufgerufen für Peer: ${peerId}. state.currentPCPartnerId vor Erstellung: ${state.currentPCPartnerId}`);
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
            if (event.candidate && socket && state.connected && state.currentPCPartnerId === peerId) { // Prüfe currentPCPartnerId und ob es der Partner ist, für den die PC erstellt wurde
                // console.log(`[WebRTC LOG] onicecandidate: Sende ICE Kandidat an ${state.currentPCPartnerId}:`, JSON.stringify(event.candidate).substring(0, 100) + "...");
                 console.log(`[WebRTC LOG] onicecandidate: Sende ICE Kandidat an ${state.currentPCPartnerId} (Typ: ${event.candidate.type}).`);
                socket.emit('webRTC-ice-candidate', { to: state.currentPCPartnerId, candidate: event.candidate });
            } else if (!event.candidate) {
                console.log(`[WebRTC LOG] onicecandidate: ICE Kandidatensammlung für ${peerId} beendet (null Kandidat).`);
            } else {
                 console.warn(`[WebRTC LOG] onicecandidate: ICE Kandidat für ${peerId} generiert, aber nicht gesendet (connected: ${state.connected}, currentPCPartnerId: ${state.currentPCPartnerId}).`);
            }
        };

        state.peerConnection.ontrack = event => {
            console.log(`[WebRTC LOG] ontrack: Remote Track empfangen von ${state.currentPCPartnerId}. Track Kind: ${event.track.kind}, Track ID: ${event.track.id}, Stream ID(s): ${event.streams ? event.streams.map(s => s.id).join(', ') : 'Kein Stream'}`);
            if (!UI.remoteVideo || !UI.remoteScreenStatus) {
                console.error("[WebRTC LOG] ontrack: Remote Video/Status Element nicht gefunden!");
                return;
            }

            // Zuerst den alten remoteStream leeren und Tracks stoppen, wenn er existiert
            // Dies ist wichtig, um sicherzustellen, dass immer nur der aktuell empfangene Stream angezeigt wird.
            if (state.remoteStream) {
                 console.log(`[WebRTC LOG] ontrack: Stoppe Tracks des alten remoteStream ${state.remoteStream.id}`);
                 state.remoteStream.getTracks().forEach(t => t.stop());
            }

            // Weise den neuen Stream direkt zu oder erstelle einen neuen MediaStream, wenn event.streams[0] nicht existiert.
            // Der Browser gruppiert Tracks normalerweise in Streams.
            if (event.streams && event.streams[0]) {
                console.log(`[WebRTC LOG] ontrack: Weise Stream ${event.streams[0].id} (enthält Track ${event.track.id}) dem Remote-Videoelement zu.`);
                state.remoteStream = event.streams[0]; // Aktualisiere den globalen remoteStream
            } else {
                // Fallback, wenn Tracks einzeln ohne zugehörigen Stream im Event ankommen
                // Dies sollte selten passieren, aber man ist vorbereitet.
                if (!state.remoteStream) { // Nur erstellen, wenn noch keiner existiert
                    state.remoteStream = new MediaStream();
                    console.log(`[WebRTC LOG] ontrack: Neuer RemoteStream ${state.remoteStream.id} erstellt, da keiner im Event war oder existierte.`);
                }
                // Füge den empfangenen Track dem (ggf. neu erstellten) RemoteStream hinzu
                if (!state.remoteStream.getTrackById(event.track.id)) {
                    console.log(`[WebRTC LOG] ontrack: Füge Track ${event.track.id} zum (ggf. neuen) RemoteStream ${state.remoteStream.id} hinzu.`);
                    state.remoteStream.addTrack(event.track);
                } else {
                     console.log(`[WebRTC LOG] ontrack: Track ${event.track.id} ist bereits im RemoteStream ${state.remoteStream.id}.`);
                }
            }
            // Aktualisiere die Remote-UI mit dem aktuellen remoteStream
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);

            // Listener für das Ende des Remote-Streams/Tracks hinzufügen, um UI zu aktualisieren
             event.track.onended = () => {
                 console.log(`[WebRTC LOG] ontrack: Remote Track ${event.track.id} (${event.track.kind}) beendet.`);
                 // Prüfe, ob noch andere Tracks im remoteStream aktiv sind
                 if (state.remoteStream && state.remoteStream.getTracks().every(t => t.readyState === 'ended')) {
                     console.log(`[WebRTC LOG] ontrack: Alle Tracks im remoteStream ${state.remoteStream.id} beendet. Setze Remote UI zurück.`);
                      // Wenn alle Tracks beendet sind, setze die Remote-UI zurück
                      updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
                      // Lösche die remoteStream Referenz, da der Stream nicht mehr aktiv ist
                      if (state.remoteStream) {
                         state.remoteStream.getTracks().forEach(t => t.stop()); // Sicherstellen, dass auch gestoppt ist
                         state.remoteStream = null;
                      }
                 } else {
                     console.log(`[WebRTC LOG] ontrack: Track ${event.track.id} beendet, aber andere Tracks im remoteStream sind noch aktiv.`);
                      // Wenn nur ein Track endet, aber andere noch da sind, aktualisiere die Anzeige,
                      // falls z.B. von Video+Audio zu nur Audio gewechselt wird.
                     updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
                 }
             };
             event.track.onmute = () => {
                  console.log(`[WebRTC LOG] ontrack: Remote Track ${event.track.id} (${event.track.kind}) wurde gemutet.`);
                  // Wenn ein Video-Track gemutet wird, aktualisiere die Anzeige ggf. auf Status-Label
                  if (event.track.kind === 'video') {
                      updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
                  }
             };
              event.track.ounmute = () => {
                   console.log(`[WebRTC LOG] ontrack: Remote Track ${event.track.id} (${event.track.kind}) wurde entmutet.`);
                  // Wenn ein Video-Track entmutet wird, aktualisiere die Anzeige ggf. auf Video
                  if (event.track.kind === 'video') {
                       updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
                   }
              };
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
                    // Update Remote UI status
                    if (UI.remoteScreenStatus) {
                        UI.remoteScreenStatus.textContent = `VERBINDE MIT ${partnerUsername.toUpperCase()}...`;
                        UI.remoteScreenStatus.className = 'screen-status-label loading';
                        UI.remoteScreenStatus.classList.remove('hidden');
                    }
                    if (UI.remoteVideo) UI.remoteVideo.classList.add('hidden');
                    break;
                case "connected":
                    console.log(`[WebRTC LOG] ICE 'connected': Erfolgreich verbunden mit ${partnerUsername}. Daten sollten jetzt fließen.`);
                    // Setze den allgemeinen Verbindungsstatus oben (könnte aber auch "Video verbunden" sein, je nach Bedarf)
                    setConnectionStatus('connected', `Verbunden mit ${partnerUsername}`);
                    // updateVideoDisplay sollte durch ontrack bereits das Video/Audio sichtbar machen
                    break;
                case "completed":
                    console.log(`[WebRTC LOG] ICE 'completed': Alle Kandidatenpaare geprüft mit ${partnerUsername}. Verbindung sollte stabil sein.`);
                     // Optional: Statusanzeige verfeinern, z.B. "Stabile Verbindung mit..."
                    break;
                case "disconnected":
                    console.warn(`[WebRTC LOG] ICE 'disconnected': Video-Verbindung zu ${partnerUsername} unterbrochen. Versuche, Verbindung wiederherzustellen...`);
                    // Hier nicht sofort closePeerConnection, da es temporär sein kann. Der Browser versucht oft, sich wieder zu verbinden.
                    // Man könnte einen Timer für einen harten Reset setzen, falls es zu lange dauert.
                     if (UI.remoteScreenStatus) {
                         UI.remoteScreenStatus.textContent = `VERBINDUNG UNTERBROCHEN MIT ${partnerUsername.toUpperCase()}`;
                         UI.remoteScreenStatus.className = 'screen-status-label loading'; // Zeige gelben Status
                         UI.remoteScreenStatus.classList.remove('hidden');
                     }
                     // Das Remote Video sollte durch ontrack/onended ggf. schon ausgeblendet sein oder hier explizit ausgeblendet werden
                     // if (UI.remoteVideo) UI.remoteVideo.classList.add('hidden'); // Besser: updateVideoDisplay mit aktuellem Stream-Status aufrufen
                    break;
                case "failed":
                    console.error(`[WebRTC LOG] ICE 'failed': Video-Verbindung zu ${partnerUsername} fehlgeschlagen.`);
                    displayError(`Video-Verbindung zu ${partnerUsername} fehlgeschlagen. Prüfe Netzwerk/Firewall.`);
                    closePeerConnection(); // Verbindung ist definitiv fehlgeschlagen
                    // Optional: Automatischen Neuverbindungsversuch starten
                    // setTimeout(() => { if (state.connected) initiateP2PConnection(); }, 5000);
                    break;
                case "closed":
                    console.log(`[WebRTC LOG] ICE 'closed': Verbindung zu ${partnerUsername} wurde geschlossen.`);
                    // closePeerConnection() sollte hier normalerweise schon aufgerufen worden sein oder wird es jetzt sicherstellen.
                    // Dies geschieht oft, wenn die andere Seite die Verbindung beendet oder ein fataler Fehler auftrat.
                    if (state.currentPCPartnerId === (partner ? partner.id : null) || !partner) { // Wenn es der aktuelle Partner war oder der Partner nicht mehr existiert
                        closePeerConnection(); // Stelle sicher, dass alles bereinigt ist
                    }
                    break;
            }
        };

        state.peerConnection.onsignalingstatechange = () => {
            if (!state.peerConnection) return;
            console.log(`[WebRTC LOG] onsignalingstatechange: Signalling State zu ${state.currentPCPartnerId || 'N/A'} geändert zu: ${state.peerConnection.signalingState}`);
        };

        state.peerConnection.onnegotiationneeded = async () => {
            console.log(`[WebRTC LOG] onnegotiationneeded: Event für ${state.currentPCPartnerId || 'N/A'} ausgelöst. Aktueller Signalling State: ${state.peerConnection?.signalingState}`);
            // "Polite peer" Logik: Nur der Peer mit der "kleineren" ID initiiert das Offer bei Glare.
            // state.socketId sollte hier gesetzt sein.
            // Stelle sicher, dass state.currentPCPartnerId auch gesetzt ist
            if (state.peerConnection?.signalingState === 'stable' && state.socketId && state.currentPCPartnerId && state.socketId < state.currentPCPartnerId) {
                console.log(`[WebRTC LOG] onnegotiationneeded: Bin Initiator (oder es ist sicher), erstelle und sende Offer an ${state.currentPCPartnerId}.`);
                await createAndSendOffer();
            } else {
                console.log(`[WebRTC LOG] onnegotiationneeded: Nicht der Initiator oder Signalisierungsstatus nicht stabil ('${state.peerConnection?.signalingState}') oder IDs fehlen. Warte auf Offer oder stabilen Zustand.`);
            }
        };

        // Füge Tracks vom lokalen Stream (Audio-only) oder ScreenStream hinzu, falls vorhanden, wenn PC gestartet wird.
        // Die Tracks sollten aktuell sein (Mikrofon oder Screen).
        const streamToAdd = state.isSharingScreen && state.screenStream ? state.screenStream : state.localStream; // localStream ist Audio-only

        if (streamToAdd) {
            console.log(`[WebRTC LOG] createPeerConnection: Füge Tracks vom Stream ${streamToAdd.id} (Typ: ${state.isSharingScreen ? 'Screen' : 'Mikrofon'}) zur neuen PeerConnection hinzu.`);
            addTracksToPeerConnection(streamToAdd); // Fügt die Tracks als Sender hinzu
        } else {
            console.log("[WebRTC LOG] createPeerConnection: Kein lokaler Stream (Mikrofon oder Screen) vorhanden beim Erstellen der PeerConnection.");
            // Das sollte eigentlich nicht passieren, da setupLocalMedia beim joinSuccess aufgerufen wird.
            // Füge hier optional ein check/call von setupLocalMedia ein, falls localStream null ist?
            // await setupLocalMedia(); // Versucht lokalen Audio-Stream zu holen
            // if (state.localStream) addTracksToPeerConnection(state.localStream);
        }
        return state.peerConnection;
    }

    // Hilfsfunktion, um Tracks zu einer PeerConnection hinzuzufügen
    function addTracksToPeerConnection(stream) {
        if (!state.peerConnection) {
             console.warn("[WebRTC LOG] addTracksToPeerConnection: PeerConnection ist null. Kann keine Tracks hinzufügen.");
             return;
        }
        if (!stream) {
            console.warn("[WebRTC LOG] addTracksToPeerConnection: Aufgerufen mit null Stream.");
            return;
        }
        console.log(`[WebRTC LOG] addTracksToPeerConnection: Füge Tracks von Stream ${stream.id} zur PeerConnection hinzu.`);
        stream.getTracks().forEach(track => {
            // Füge den Track hinzu. addTrack erstellt automatisch einen neuen RTCRtpSender.
            // Prüfe nicht explizit, ob ein Sender gleicher Art existiert, da addTrack dies intern verwaltet
            // und onnegotiationneeded sich um die Neuverhandlung kümmert, wenn sich die SDP ändert.
             try {
                 state.peerConnection.addTrack(track, stream);
                 console.log(`[WebRTC LOG] addTracksToPeerConnection: Track ${track.kind} (${track.id}) erfolgreich hinzugefügt.`);
             } catch (e) {
                 console.error(`[WebRTC LOG] addTracksToPeerConnection: Fehler beim Hinzufügen von Track ${track.id}:`, e);
             }
        });
    }


    // Ersetzt die Tracks in der PeerConnection durch die Tracks aus einem neuen Stream
    // Initiert eine Neuverhandlung, falls nötig.
    async function replaceTracksInPeerConnection(newStream, streamType = 'camera') { // streamType: 'camera' (bedeutet hier Audio-only) oder 'screen'
        if (!state.peerConnection) {
            console.warn("[WebRTC LOG] replaceTracksInPeerConnection: Keine PeerConnection vorhanden.");
            return false;
        }
        console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Ersetze Tracks für Stream-Typ '${streamType}' in PeerConnection mit ${state.currentPCPartnerId || 'N/A'}. Neuer Stream ID: ${newStream ? newStream.id : 'NULL'}.`);

        const senders = state.peerConnection.getSenders();
        let negotiationNeeded = false;

        // Iteriere über alle SENDER in der PeerConnection
        for (const sender of senders) {
            const trackKind = sender.track ? sender.track.kind : null;
            // Finde den passenden Track im NEUEN Stream für diesen Sender-Kind
            const newTrackForSender = newStream ? newStream.getTracks().find(t => t.kind === trackKind) : null;

            if (newTrackForSender) {
                // Wenn der neue Track existiert und sich vom aktuell gesendeten Track unterscheidet, ersetze ihn
                if (sender.track !== newTrackForSender) {
                    console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Ersetze Track ${trackKind} (alt: ${sender.track?.id || 'N/A'}, neu: ${newTrackForSender.id})`);
                    try {
                        await sender.replaceTrack(newTrackForSender);
                        negotiationNeeded = true; // Track wurde ersetzt -> Neuverhandlung nötig
                    } catch (e) {
                        console.error(`[WebRTC LOG] replaceTracksInPeerConnection: Fehler beim Ersetzen von Track ${trackKind}:`, e);
                         // Wenn replaceTrack fehlschlägt, könnte der Sender in einem ungültigen Zustand sein.
                         // Optional: Sender entfernen und neuen Track neu hinzufügen? Kompliziert.
                    }
                } else {
                     console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Track ${trackKind} ist derselbe (${sender.track?.id}). Kein replace nötig.`);
                }
            } else {
                // Wenn kein neuer Track für diesen Sender-Kind existiert (z.B. kein Video mehr von Kamera/Screen), sende null, falls aktuell ein Track gesendet wird
                if (sender.track !== null) {
                    console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Sende null für Track ${trackKind} (alt: ${sender.track?.id || 'N/A'}), da kein neuer Track verfügbar.`);
                     // Ersetze den Track durch null, um das Senden dieses Tracks zu stoppen.
                    try {
                        await sender.replaceTrack(null);
                         negotiationNeeded = true; // Null gesendet -> Neuverhandlung nötig
                    } catch (e) {
                         console.error(`[WebRTC LOG] replaceTracksInPeerConnection: Fehler beim Ersetzen von Track ${trackKind} durch null:`, e);
                    }
                } else {
                     console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Track ${trackKind} sendet bereits null. Kein replace nötig.`);
                }
            }
        }

         // Füge alle Tracks aus dem newStream hinzu, für die es noch KEINEN Sender gab.
         // Dies ist wichtig, wenn ein neuer Track-Typ hinzugefügt wird (z.B. Video, wenn vorher nur Audio).
         if (newStream) {
             const existingSenderKinds = senders.map(s => s.track?.kind).filter(kind => kind);
             newStream.getTracks().forEach(track => {
                 if (!existingSenderKinds.includes(track.kind)) {
                     console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Füge neuen Track ${track.kind} (${track.id}) hinzu (Kein existierender Sender dieses Typs).`);
                      try {
                         state.peerConnection.addTrack(track, newStream);
                         negotiationNeeded = true; // Neuer Track hinzugefügt -> Neuverhandlung nötig
                      } catch (e) {
                         console.error(`[WebRTC LOG] replaceTracksInPeerConnection: Fehler beim Hinzufügen von neuem Track ${track.id}:`, e);
                      }
                 } else {
                      // Dieser Track-Kind existiert bereits als Sender. Er wurde oben entweder ersetzt oder war derselbe.
                      console.log(`[WebRTC LOG] replaceTracksInPeerConnection: Track ${track.kind} (${track.id}) ist bereits vorhanden oder wurde ersetzt. Wird nicht erneut hinzugefügt.`);
                 }
             });
         }


        if (negotiationNeeded) {
            console.log("[WebRTC LOG] replaceTracksInPeerConnection: Tracks wurden geändert. Neuverhandlung wird angestoßen.");
            // `onnegotiationneeded` sollte automatisch ausgelöst werden, wenn der Initiator
            // die Sender-Liste ändert oder replaceTrack(null) aufruft.
            // Für Robustheit können wir hier explizit ein Offer versuchen, aber die onnegotiationneeded Logik
            // sollte die primäre Methode sein, um Glare zu vermeiden.
            // createAndSendOffer() wird am Ende von onnegotiationneeded aufgerufen, wenn nötig.
            // Manchmal kann es aber sinnvoll sein, ein Offer hier direkt anzustoßen,
            // wenn man sicher ist, dass man der Initiator ist oder eine sofortige Neuverhandlung erzwingen will.
            // Lasse es vorerst weg und verlasse mich auf onnegotiationneeded.
        } else {
            console.log("[WebRTC LOG] replaceTracksInPeerConnection: Keine effektive Änderung der Tracks. Keine Neuverhandlung angestoßen.");
        }
        return negotiationNeeded;
    }


    function closePeerConnection() {
        console.log("[WebRTC LOG] closePeerConnection aufgerufen.");
        if (state.peerConnection) {
            console.log("[WebRTC LOG] closePeerConnection: Schließe PeerConnection mit:", state.currentPCPartnerId);
            // Die Tracks selbst werden nicht hier gestoppt, da sie zum localStream oder screenStream gehören.
            // stopLocalStream() oder toggleScreenSharing() stoppen die Tracks.
            // PeerConnection schließen
            state.peerConnection.close(); // Schließt die Verbindung und löst Sender/Receiver auf
            state.peerConnection = null; // Entferne Referenz
        } else {
             console.log("[WebRTC LOG] closePeerConnection: Keine PeerConnection zum Schließen vorhanden.");
        }
        state.currentPCPartnerId = null; // Partner zurücksetzen

        // Remote Stream Tracks stoppen und Stream nullen
        if(state.remoteStream){
            console.log(`[WebRTC LOG] closePeerConnection: Stoppe Tracks des remoteStream (${state.remoteStream.id}).`);
            state.remoteStream.getTracks().forEach(track => track.stop());
            state.remoteStream = null;
             console.log("[WebRTC LOG] closePeerConnection: remoteStream ist nun null.");
        } else {
             console.log("[WebRTC LOG] closePeerConnection: remoteStream war bereits null.");
        }
        // Remote Video UI zurücksetzen
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
        console.log("[WebRTC LOG] closePeerConnection: PeerConnection und Partner-ID zurückgesetzt.");
    }

    // Startet den Prozess zum Aufbau einer P2P WebRTC Verbindung zu einem anderen User
    function initiateP2PConnection() {
        console.log("[WebRTC LOG] initiateP2PConnection aufgerufen.");
        if (!state.connected || !socket || !state.socketId) { // Eigene ID muss bekannt sein
            console.log("[WebRTC LOG] initiateP2PConnection: Bedingungen nicht erfüllt (nicht verbunden, kein Socket oder keine eigene ID).");
            return;
        }
        // Nur wenn noch keine Verbindung zu einem P2P Partner besteht oder der aktuelle Partner nicht mehr online ist.
        // Prüfe, ob der aktuelle Partner noch in der Benutzerliste ist.
        const currentPartnerOnline = state.currentPCPartnerId && state.allUsersList.some(u => u.id === state.currentPCPartnerId);

        if (state.peerConnection && currentPartnerOnline) {
             console.log(`[WebRTC LOG] initiateP2PConnection: Bestehende Verbindung zu ${state.currentPCPartnerId} ist online. Keine Aktion.`);
             // Optional: Hier könnte man prüfen, ob die bestehende Verbindung noch gesund ist.
             return;
        } else if (state.peerConnection && !currentPartnerOnline) { // Partner weg, aber PC noch da
            console.log("[WebRTC LOG] initiateP2PConnection: Aktueller Partner nicht mehr online. Schließe alte PeerConnection.");
            closePeerConnection(); // Alte Verbindung aufräumen
        }


        const otherUsers = state.allUsersList.filter(u => u.id !== state.socketId); // Alle anderen User im selben Raum
        if (otherUsers.length === 0) {
            console.log("[WebRTC LOG] initiateP2PConnection: Keine anderen Benutzer im Raum für P2P.");
            if(state.currentPCPartnerId) closePeerConnection(); // Alte PC schließen, wenn man alleine ist
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false); // Remote Video ausblenden
            return;
        }

        // Wähle einen Partner. Hier einfach der erste aus der Liste der anderen User, sortiert nach ID
        // für eine konsistente Partnerwahl in einer einfachen 1:1 Verbindung pro Peer.
        const targetUser = otherUsers.sort((a,b) => a.id.localeCompare(b.id))[0];
        console.log(`[WebRTC LOG] initiateP2PConnection: Potenzieller P2P Partner: ${targetUser.username} (${targetUser.id})`);

        // "Polite Peer" Logik: Der Peer mit der "kleineren" ID initiiert das Offer.
        // Stellt sicher, dass nicht beide gleichzeitig ein Offer senden (Glare-Situation).
        const shouldInitiateOffer = state.socketId < targetUser.id;

        console.log(`[WebRTC LOG] initiateP2PConnection: Eigene ID: ${state.socketId}, Ziel ID: ${targetUser.id}. Bin Initiator? ${shouldInitiateOffer}`);


        // Erstelle die PeerConnection. Füge die aktuellen lokalen Tracks hinzu (Mikrofon oder Screen).
        // setupLocalMedia sollte bereits aufgerufen worden sein und state.localStream/state.screenStream gesetzt haben.
        // createPeerConnection wird dann die Tracks zu den Sendern hinzufügen.

         createPeerConnection(targetUser.id).then(async () => { // createPeerConnection ist async
             console.log(`[WebRTC LOG] initiateP2PConnection: PeerConnection mit ${targetUser.id} erstellt.`);
             // Füge die aktuellen lokalen Tracks zur PeerConnection hinzu
             const streamToAdd = state.isSharingScreen && state.screenStream ? state.screenStream : state.localStream; // localStream ist Audio-only
             if(streamToAdd) {
                 console.log(`[WebRTC LOG] initiateP2PConnection: Füge Tracks von lokalem Stream (${streamToAdd.id}, Typ: ${state.isSharingScreen ? 'Screen' : 'Mikrofon'}) zur PC hinzu.`);
                  addTracksToPeerConnection(streamToAdd);
                  // Wenn wir Initiator sind UND Tracks hinzugefügt haben, erstellen wir direkt ein Offer.
                  // Ansonsten wartet der Empfänger auf das Offer.
                 if (shouldInitiateOffer) {
                      console.log(`[WebRTC LOG] initiateP2PConnection: Bin Initiator UND Tracks hinzugefügt. Erstelle und sende Offer.`);
                     await createAndSendOffer(); // sendet Offer, wenn SignallingState stable
                 } else {
                      console.log(`[WebRTC LOG] initiateP2PConnection: Bin Empfänger ODER keine Tracks zum Hinzufügen. Warte auf Offer.`);
                 }

             } else {
                  console.warn("[WebRTC LOG] initiateP2PConnection: Kein lokaler Stream vorhanden, kann keine Tracks zur PC hinzufügen.");
                  // Auch wenn keine Tracks hinzugefügt wurden, muss der Initiator das Offer senden,
                  // damit der SDP-Austausch gestartet wird (für zukünftige Track-Additions).
                  if (shouldInitiateOffer) {
                       console.log(`[WebRTC LOG] initiateP2PConnection: Kein lokaler Stream, aber bin Initiator. Erstelle und sende Offer.`);
                      await createAndSendOffer(); // sendet Offer, auch wenn keine Tracks drin sind
                   } else {
                        console.log(`[WebRTC LOG] initiateP2PConnection: Kein lokaler Stream und bin Empfänger. Warte auf Offer.`);
                   }
             }


         }).catch(err => {
              console.error("[WebRTC LOG] initiateP2PConnection: Fehler beim Erstellen der PeerConnection:", err);
              displayError("Fehler beim Aufbau der P2P-Verbindung.");
              // Optional: cleanup oder retry
              closePeerConnection();
         });

    }

     async function createAndSendOffer() {
         if (!state.peerConnection || !state.currentPCPartnerId) {
             console.warn("[WebRTC LOG] createAndSendOffer: Bedingungen nicht erfüllt (keine PC oder kein Partner). Offer wird nicht erstellt.");
             return;
         }
         // Strenge Prüfung des Signalisierungsstatus, um "glare" und Race Conditions zu minimieren.
         // Nur anbieten, wenn der Zustand 'stable' ist (oder in bestimmten Übergangszuständen, je nach Peer-Rolle und Ereignis).
         // Hier verlassen wir uns stark auf onnegotiationneeded für den automatischen Aufruf im 'stable' Zustand.
         // Wenn diese Funktion explizit aufgerufen wird (z.B. nach addTrack/replaceTrack),
         // prüfen wir den Zustand, um Glare zu vermeiden (Polite/Impolite Logic).
         // Da unsere initiateP2PConnection und replaceTracksInPeerConnection jetzt explizit
         // createAndSendOffer aufrufen können, fügen wir eine Polite Peer Glare Handling Prüfung hinzu.

         // Verbesserte Glare Handling Prüfung (nur Polite Peer sendet Offer von stable state)
         const isPolite = state.socketId < state.currentPCPartnerId; // Annahme der Polite Peer Logik
         const canCreateOffer = state.peerConnection.signalingState === 'stable' ||
                                (state.peerConnection.signalingState === 'have-local-offer' && !isPolite); // Impolite kann Offer bei have-local-offer neu senden

         if (!canCreateOffer) {
              console.warn(`[WebRTC LOG] createAndSendOffer: Überspringe Offer-Erstellung. Aktueller Signalisierungsstatus: '${state.peerConnection.signalingState}'. Bin Polite? ${isPolite}. Partner ID: ${state.currentPCPartnerId}.`);
              return;
         }


         try {
             console.log(`[WebRTC LOG] createAndSendOffer: Erstelle Offer für ${state.currentPCPartnerId}. Aktueller Signalling State: ${state.peerConnection.signalingState}`);
             const offer = await state.peerConnection.createOffer();

             // Überprüfe, ob sich das Offer wirklich geändert hat, bevor setLocalDescription erneut aufgerufen wird (vermeidet unnötige Events)
             if (!state.peerConnection.localDescription || state.peerConnection.localDescription.sdp !== offer.sdp) {
                 console.log(`[WebRTC LOG] createAndSendOffer: Setze LocalDescription (Offer) für ${state.currentPCPartnerId}. Offer Typ: ${offer.type}`);
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
             // Bei Fehler ggf. PeerConnection schließen oder Neuversuch planen?
             // closePeerConnection(); // Vorsicht mit automatischem Schließen bei jedem Fehler
         }
     }


    async function toggleScreenSharing() {
        if (!state.connected || !UI.shareScreenBtn) {
             console.warn("[WebRTC LOG] toggleScreenSharing: Nicht verbunden oder Button nicht gefunden.");
             return;
        }
        UI.shareScreenBtn.disabled = true; // Button während des Vorgangs deaktivieren
        console.log(`[WebRTC LOG] toggleScreenSharing aufgerufen. Aktueller Zustand: ${state.isSharingScreen ? 'Sharing aktiv' : 'Sharing inaktiv'}.`);

        if (state.isSharingScreen) { // Screensharing beenden
            console.log("[WebRTC LOG] toggleScreenSharing: Beende Screensharing.");
            if (state.screenStream) {
                console.log(`[WebRTC LOG] toggleScreenSharing: Stoppe Tracks von screenStream (${state.screenStream.id}).`);
                state.screenStream.getTracks().forEach(track => {
                    console.log(`[WebRTC LOG] toggleScreenSharing: Stoppe Screen Track ${track.id} (${track.kind}).`);
                    track.stop();
                });
                state.screenStream = null;
                console.log("[WebRTC LOG] toggleScreenSharing: screenStream ist nun null.");
            }
            state.isSharingScreen = false;
            UI.shareScreenBtn.textContent = 'Bildschirm teilen';
            UI.shareScreenBtn.classList.remove('danger-btn');

            // Ersetze Screen-Tracks durch Mikrofon-Tracks (Audio-only stream)
            // setupLocalMedia holt den Mikrofon-Stream oder stellt sicher, dass er da ist.
             console.log("[WebRTC LOG] toggleScreenSharing: Screensharing beendet. Initialisiere lokalen Audio-Stream neu.");
             // setupLocalMedia holt den Audio-only Stream und ruft replaceTracksInPeerConnection auf
             await setupLocalMedia(false); // false, da es ein vollständiger Wechsel ist

        } else { // Screensharing starten
            console.log("[WebRTC LOG] toggleScreenSharing: Starte Screensharing.");
            try {
                // Bildschirmfreigabe anfordern. Standardmäßig Video (den Bildschirm) und Audio (System-Audio).
                // audio: true hier bedeutet, dass das System-Audio mit aufgenommen wird, falls vom Browser unterstützt.
                // Wenn audio: false, wird nur der Bildschirm ohne Ton geteilt.
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always", frameRate: { ideal: 10, max: 15 } }, // Niedrigere Framerate für Screensharing
                    audio: true // Setze auf true, um System-Audio mitzuteilen (falls verfügbar)
                });
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');

                console.log(`[WebRTC LOG] toggleScreenSharing: ScreenStream ${state.screenStream.id} erhalten. Tracks: Video: ${state.screenStream.getVideoTracks().length}, Audio: ${state.screenStream.getAudioTracks().length}`);

                // Stoppe den lokalen Mikrofon-Stream, da das Audio jetzt vom Bildschirm-Stream kommt (falls audio:true oben).
                // Wenn audio:false im getDisplayMedia, behalte den Mikrofon-Stream bei.
                // Die replaceTracksInPeerConnection Logik unten behandelt dies.
                if (state.localStream) {
                     console.log("[WebRTC LOG] toggleScreenSharing: Stoppe lokalen Mikrofon-Stream.");
                     state.localStream.getTracks().forEach(track => track.stop());
                     state.localStream = null; // Referenz löschen
                     console.log("[WebRTC LOG] toggleScreenSharing: localStream ist nun null.");
                }


                // Ersetze die aktuellen Tracks (Mikrofon) durch die Screen-Tracks in der PeerConnection
                if (state.peerConnection) {
                    console.log("[WebRTC LOG] toggleScreenSharing: PeerConnection existiert. Ersetze Tracks durch ScreenStream Tracks.");
                    await replaceTracksInPeerConnection(state.screenStream, 'screen'); // Stößt Neuverhandlung an
                } else {
                     console.warn("[WebRTC LOG] toggleScreenSharing: PeerConnection existiert nicht beim Starten von Screensharing.");
                     // Das sollte eigentlich nicht passieren, wenn man verbunden ist.
                     // Wenn doch, müssen die Screen-Tracks der PC hinzugefügt werden, sobald sie erstellt wird.
                }

                // Lokale UI aktualisieren (wird den Status "Bildschirm geteilt" anzeigen)
                 updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true);


                // Listener für das Beenden des Teilens durch den Browser-Button ("Stop sharing" im Browser-Fenster)
                // Dieser Listener wird auf den VideoTrack des ScreenStreams gesetzt.
                const screenVideoTrack = state.screenStream.getVideoTracks()[0];
                if (screenVideoTrack) {
                    screenVideoTrack.onended = () => {
                        console.log("[WebRTC LOG] toggleScreenSharing: Screensharing durch Browser-UI (Stop-Button) beendet.");
                        // Nur wenn Screensharing noch aktiv ist (verhindert doppelte Ausführung, falls schon durch Button geklickt wurde)
                        if (state.isSharingScreen) {
                            console.log("[WebRTC LOG] toggleScreenSharing: Rufe toggleScreenSharing auf, um sauber zu beenden.");
                            toggleScreenSharing(); // Ruft die eigene Funktion auf, um alles sauber zu beenden
                        }
                    };
                     console.log("[WebRTC LOG] toggleScreenSharing: onended Listener für Screen Video Track hinzugefügt.");
                } else {
                     console.warn("[WebRTC LOG] toggleScreenSharing: Kein Screen Video Track gefunden, onended Listener konnte nicht hinzugefügt werden.");
                }

            } catch (err) {
                console.error('[WebRTC LOG] toggleScreenSharing: Fehler beim Starten der Bildschirmfreigabe:', err.name, err.message);
                let errorMessage = `Bildschirmfreigabe fehlgeschlagen: ${err.message}`;
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                     errorMessage = "Bildschirmfreigabe verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
                } else if (err.name === 'AbortError') {
                     errorMessage = "Bildschirmfreigabe abgebrochen.";
                }
                displayError(errorMessage);

                state.isSharingScreen = false; // Zustand zurücksetzen
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                UI.shareScreenBtn.classList.remove('danger-btn');

                // Nach fehlgeschlagenem Screensharing den Mikrofon-Stream wiederherstellen
                 console.log("[WebRTC LOG] toggleScreenSharing: Screensharing fehlgeschlagen. Versuche lokalen Audio-Stream wiederherzustellen.");
                 await setupLocalMedia(false); // false, da es ein vollständiger Wechsel (zurück zum Mikrofon) ist
            }
        }
        UI.shareScreenBtn.disabled = false; // Button wieder aktivieren
    }


    function toggleFullscreen(videoElement) {
        if (!videoElement || videoElement.classList.contains('hidden')) {
             console.warn("[UI] toggleFullscreen: Kann Fullscreen nicht starten, Videoelement nicht gefunden oder versteckt.");
             return;
        }
         console.log(`[UI] toggleFullscreen aufgerufen für Videoelement:`, videoElement);
        if (!document.fullscreenElement) {
            // Versuche Fullscreen für das Videoelement selbst
            if (videoElement.requestFullscreen) {
                videoElement.requestFullscreen().catch(err => console.error(`[UI] Fullscreen error: ${err.message}`, err));
            } else if (videoElement.webkitRequestFullscreen) { /* Safari */
                videoElement.webkitRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (webkit): ${err.message}`, err));
            } else if (videoElement.msRequestFullscreen) { /* IE11 */
                videoElement.msRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (ms): ${err.message}`, err));
            } else {
                 console.warn("[UI] toggleFullscreen: Browser unterstützt Fullscreen API nicht auf diesem Element.");
            }
        } else {
             // Wenn bereits Fullscreen aktiv ist, beende es
             console.log("[UI] toggleFullscreen: Beende Fullscreen.");
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
    // um sicherzustellen, dass Mikrofonberechtigungen ggf. schon erteilt wurden,
    // was für die enumerateDevices API oft nötig ist.

}); // Ende DOMContentLoaded Listener
