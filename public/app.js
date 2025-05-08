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
            e.preventDefault(); // Prevent default form submission
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
                 // setupLocalMedia will call replaceTracksInPeerConnection if PC exists
                 await setupLocalMedia(false); // Initial call, not just update
            } else {
                 console.log("[WebRTC LOG] Join Success: Lokaler Stream existiert bereits oder Screensharing ist aktiv. Überspringe setupLocalMedia.");
                 // If stream already exists (e.g., from previous connection attempt),
                 // ensure its tracks are in the newly created PC.
                 const streamToAdd = state.isSharingScreen && state.screenStream ? state.screenStream : state.localStream;
                 if (state.peerConnection && streamToAdd) {
                     console.log("[WebRTC LOG] Join Success: PeerConnection existiert, lokaler Stream auch. Ensure tracks are in PC.");
                     await replaceTracksInPeerConnection(streamToAdd, state.isSharingScreen ? 'screen' : 'camera', 'joinSuccess_existingStream');
                 }
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

            // If connected and no active P2P connection or the partner left, try to initiate P2P
            if (state.connected) {
                const otherUsers = currentUsersList.filter(u => u.id !== state.socketId);
                if (otherUsers.length > 0 && (!state.peerConnection || !oldPartnerStillPresent)) {
                    console.log("[WebRTC LOG] userListUpdate: Neue User im Raum oder alte Verbindung weg. Versuche P2P Verbindung.");
                    initiateP2PConnection();
                } else if (otherUsers.length === 0 && state.peerConnection) {
                    // If no other users left but a PC exists, close it.
                     console.log("[WebRTC LOG] userListUpdate: Keine anderen User mehr im Raum. Schließe PeerConnection.");
                     closePeerConnection();
                     updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
                } else if (otherUsers.length === 0 && !state.peerConnection) {
                     console.log("[WebRTC LOG] userListUpdate: Keine anderen User im Raum und keine PeerConnection. Alles ok.");
                     updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
                }
            } else {
                 console.log("[WebRTC LOG] userListUpdate: Nicht verbunden. Überspringe P2P Initiierung.");
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

            // If we receive an offer from a peer that is not our current partner, and we have a PC,
            // this indicates a potential Glare or new peer situation. Close old PC and create new one.
            if (state.peerConnection && state.currentPCPartnerId !== from) {
                 console.warn(`[WebRTC LOG] webRTC-offer: Angebot von neuem Peer ${from} erhalten, während Verbindung zu ${state.currentPCPartnerId} besteht. Schließe alte Verbindung.`);
                 closePeerConnection(); // Close existing PC
            }
             // Ensure PeerConnection exists for the 'from' peer
            if (!state.peerConnection || state.currentPCPartnerId !== from) {
                 console.log(`[WebRTC LOG] webRTC-offer: Erstelle/prüfe PeerConnection für ${from}.`);
                 await createPeerConnection(from); // Create new PC if none exists or partner changed
            }


            // Ensure local media is ready (at least audio-only) BEFORE setting remote description,
            // in case we need to send an answer with our capabilities.
             if (!state.localStream && !state.isSharingScreen) {
                 console.log("[WebRTC LOG] webRTC-offer: Lokaler Stream nicht bereit, versuche setupLocalMedia (Audio only).");
                 await setupLocalMedia(false); // Start audio stream
             } else if (state.peerConnection && (state.localStream || state.screenStream)) {
                 // If stream exists, ensure tracks are added to the newly created PC (if PC was just created)
                 const streamToAdd = state.isSharingScreen && state.screenStream ? state.screenStream : state.localStream;
                  if (streamToAdd) {
                      console.log("[WebRTC LOG] webRTC-offer: Lokaler Stream existiert. Stelle sicher, dass Tracks in PC sind.");
                     await replaceTracksInPeerConnection(streamToAdd, state.isSharingScreen ? 'screen' : 'camera', 'webRTC-offer_ensureTracks');
                  }
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
                 // Consider closing PC or trying to recover on error
                 // closePeerConnection();
            }
        });

        socket.on('webRTC-answer', async ({ from, answer }) => {
            console.log(`[WebRTC LOG] webRTC-answer: Antwort erhalten von ${from}. Antworttyp: ${answer.type}, SDP (erste 100 Zeichen): ${answer.sdp ? answer.sdp.substring(0,100): 'Kein SDP'}...`);
            if (!state.peerConnection || state.currentPCPartnerId !== from) {
                console.warn(`[WebRTC LOG] webRTC-answer: Antwort von ${from} erhalten, aber keine passende PeerConnection oder falscher Partner (${state.currentPCPartnerId}).`);
                return;
            }
            // Allow setRemoteDescription in 'have-local-offer' and 'stable' states
             if (state.peerConnection.signalingState === "have-local-offer" || state.peerConnection.signalingState === "stable") {
                try {
                    console.log(`[WebRTC LOG] webRTC-answer: Setze Remote Description (Answer) von ${from}. Aktueller Signalling State: ${state.peerConnection.signalingState}`);
                    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                    console.log(`[WebRTC LOG] webRTC-answer: Remote Description (Answer) gesetzt. Neuer Signalling State: ${state.peerConnection.signalingState}`);
                } catch (err) {
                    console.error(`[WebRTC LOG] webRTC-answer: Fehler beim Setzen der Remote Description (Answer) von ${from}:`, err);
                    displayError(`Fehler bei Video-Verhandlung mit ${from} (Answer-Processing).`);
                     // Consider closing PC or trying to recover on error
                     // closePeerConnection();
                }
            } else {
                console.warn(`[WebRTC LOG] webRTC-answer: Antwort von ${from} erhalten, aber PeerConnection nicht im Zustand 'have-local-offer' oder 'stable' (aktuell: ${state.peerConnection.signalingState}). Antwort wird ignoriert.`);
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            console.log(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat erhalten von ${from}:`, candidate ? (candidate.candidate ? candidate.candidate.substring(0,50) + '...' : candidate) : 'null'); // Log partial candidate
            if (state.peerConnection && state.currentPCPartnerId === from && state.peerConnection.remoteDescription) {
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erfolgreich hinzugefügt.`);
                } catch (e) {
                    console.error(`[WebRTC LOG] webRTC-ice-candidate: Fehler beim Hinzufügen des ICE Kandidaten von ${from}:`, e.name, e.message);
                }
            } else if (state.peerConnection && state.currentPCPartnerId === from && !state.peerConnection.remoteDescription) {
                 console.warn(`[WebRTC LOG] webRTC-ice-candidate: ICE Kandidat von ${from} erhalten, aber RemoteDescription ist noch nicht gesetzt (aktuell: ${state.peerConnection.signalingState}). Kandidat wird ggf. intern vom Browser gepuffert.`);
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
    } // End setupSocketListeners

    function disconnect() {
        console.log("[Socket.IO] Trenne Verbindung manuell. state.connected vor Trennung:", state.connected);
        if (socket) {
            socket.disconnect(); // This triggers the 'disconnect' event
        } else {
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
            } else { // For other file types (no preview in chat, just metadata)
                console.log(`sendMessage: Sende Datei-Info für "${message.file.name}" (${formatFileSize(message.file.size)})`);
                socket.emit('file', message);
                resetFileInput();
            }
        } else { // Normal text message
            const message = { ...messageBase, type: 'text' };
            console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`); // Log up to 50 chars
            socket.emit('message', message);
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto'; // Reset height
        UI.messageInput.focus();
        sendTyping(false); // Reset typing status
    }

    function appendMessage(msg) {
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
                img.onload = () => UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
                img.onclick = () => openImageModal(img.src);
                fileInfo.appendChild(img);
            } else { // For non-image files or images without dataUrl
                fileInfo.innerHTML += `<span class="file-icon">📄</span>`;
            }
            const linkText = `${escapeHTML(msg.file.name)} (${formatFileSize(msg.file.size)})`;
            if (msg.file.dataUrl && !msg.file.type.startsWith('application/octet-stream')) {
                fileInfo.innerHTML += ` <a href="${msg.file.dataUrl}" download="${escapeHTML(msg.file.name)}">${linkText}</a>`;
            } else {
                fileInfo.innerHTML += ` <span>${linkText}</span>`;
            }
            if (msg.content) {
                const textNode = document.createElement('p');
                textNode.style.marginTop = '5px';
                textNode.textContent = escapeHTML(msg.content);
                fileInfo.appendChild(textNode);
            }
            contentDiv.appendChild(fileInfo);
        } else { // Normal text message
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

        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20;
        if (isMe || isScrolledToBottom || state.lastMessageTimestamp === 0) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
        state.lastMessageTimestamp = Date.now();
    }

    function openImageModal(src) {
        const modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:1000;cursor:pointer;padding:20px;box-sizing:border-box;';
        modal.onclick = (event) => {
            if(event.target === modal) modal.remove();
        };

        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:5px;box-shadow:0 0 15px rgba(0,0,0,0.5);';
        img.onclick = (event) => event.stopPropagation();
        img.alt = "Vollbildansicht";

        modal.appendChild(img);
        document.body.appendChild(modal);
    }


    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) {
             console.log("sendTyping: Not connected, skipping.");
             return;
        }
        if(UI.messageInput.disabled) {
             console.log("sendTyping: Message input disabled, skipping.");
             return;
        }

        clearTimeout(state.typingTimeout);

        socket.emit('typing', { isTyping });
        console.log(`sendTyping: Emitting typing: ${isTyping}`);
        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                console.log("sendTyping: Timer expired, emitting typing: false");
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- WebRTC Logic ---
    // Starts the microphone stream (audio-only) by default.
    // If audioOnlyUpdate = true, attempts to update only the audio track.
    async function setupLocalMedia(audioOnlyUpdate = false) {
        console.log(`[WebRTC LOG] setupLocalMedia called. audioOnlyUpdate: ${audioOnlyUpdate}, isSharingScreen: ${state.isSharingScreen}`);

        // If screensharing is active and this is not an audio-only update, do nothing.
        // Media for PeerConnection will come from the ScreenStream.
        if (state.isSharingScreen && !audioOnlyUpdate) {
            console.log("[WebRTC LOG] setupLocalMedia: Screensharing active. Not initializing/changing local media (camera/audio) now.");
            // Ensure screen tracks are in the PC if it exists (e.g., PC was just created)
             if(state.peerConnection && state.screenStream) {
                  console.log("[WebRTC LOG] setupLocalMedia: Screensharing active. Ensuring ScreenStream tracks are in PC.");
                  await replaceTracksInPeerConnection(state.screenStream, 'screen', 'setupLocalMedia_screenActive');
             }
            return true;
        }

        try {
            const selectedMicId = UI.micSelect ? UI.micSelect.value : undefined;
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                ...(selectedMicId && { deviceId: { exact: selectedMicId } })
            };
            console.log("[WebRTC LOG] setupLocalMedia: Audio constraints:", audioConstraints);

            let streamToProcess;

            if (audioOnlyUpdate && state.localStream) {
                console.log("[WebRTC LOG] setupLocalMedia: Attempting to update/add audio track only.");
                // Stop and remove old audio tracks
                state.localStream.getAudioTracks().forEach(t => {
                    console.log(`[WebRTC LOG] setupLocalMedia: Stopping and removing old audio track ${t.id} from localStream.`);
                    t.stop();
                    state.localStream.removeTrack(t);
                });

                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false }); // Get only audio
                const newAudioTrack = audioStream.getAudioTracks()[0];

                if (newAudioTrack) {
                    console.log(`[WebRTC LOG] setupLocalMedia: Adding new audio track ${newAudioTrack.id} to localStream.`);
                    state.localStream.addTrack(newAudioTrack);
                    streamToProcess = state.localStream; // The existing stream with new audio track
                } else {
                    console.warn("[WebRTC LOG] setupLocalMedia: Could not get new audio track for update.");
                    streamToProcess = state.localStream; // Use the stream without the new audio track
                    // displayError("Could not update microphone."); // Optional error
                }
            } else { // Full stream setup or first setup (Audio only)
                console.log("[WebRTC LOG] setupLocalMedia: Requesting new audio-only stream (Mic).");
                // Stop existing local stream (microphone), if any and not screen share
                 if (state.localStream && !state.isSharingScreen) {
                     console.log("[WebRTC LOG] setupLocalMedia: Stopping existing local audio stream for full restart.");
                     state.localStream.getTracks().forEach(track => track.stop());
                     state.localStream = null; // Clear old reference
                 }
                // Always set video to false
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: false, // NO CAMERA
                    audio: audioConstraints
                });
                state.localStream = newStream; // This is now the audio-only stream
                streamToProcess = state.localStream;
                console.log(`[WebRTC LOG] setupLocalMedia: New local audio-only stream created: ${streamToProcess.id}. Tracks: Video: ${streamToProcess.getVideoTracks().length}, Audio: ${streamToProcess.getAudioTracks().length}`);
            }

            // Update local video UI (will show status since video:false)
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, streamToProcess, true);

            // If a PeerConnection exists, replace/add tracks with the new/updated local stream.
            if (state.peerConnection) {
                console.log("[WebRTC LOG] setupLocalMedia: Local audio stream changed/updated. Updating tracks in PeerConnection.");
                 // Replace current tracks with tracks from the (audio-only) streamToProcess
                 // replaceTracksInPeerConnection will handle the correct track types.
                await replaceTracksInPeerConnection(streamToProcess, 'camera', 'setupLocalMedia'); // 'camera' here signals it's not screenStream
            } else {
                 console.log("[WebRTC LOG] setupLocalMedia: PeerConnection not found. Tracks will be added when PC is created.");
            }

            return true;
        } catch (err) {
            console.error('[WebRTC LOG] setupLocalMedia: Error accessing local media (Mic):', err.name, err.message);
            // Specific error messages for user
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                 displayError("Mikrofonzugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.");
                 if (UI.localScreenStatus) UI.localScreenStatus.textContent = "MIKROFON ZUGRIFF VERWEIGERT";
                 if (UI.micSelect) {
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

            // Ensure old tracks are stopped and stream reference is cleared on error
            if (state.localStream && !audioOnlyUpdate) { // Only on full setup error, clean stream
                state.localStream.getTracks().forEach(track => track.stop());
                state.localStream = null;
            }
             updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // Reset UI to offline status

            return false; // Report error getting local media
        }
    }


    function stopLocalStream() {
        console.log("[WebRTC LOG] stopLocalStream: Stopping all local streams (Mic and Screen).")
        if (state.localStream) {
            console.log(`[WebRTC LOG] stopLocalStream: Stopping tracks from localStream (${state.localStream.id}).`);
            state.localStream.getTracks().forEach(track => {
                 console.log(`[WebRTC LOG] stopLocalStream: Stopping local track ${track.id} (${track.kind}).`);
                 track.stop();
            });
            state.localStream = null;
            console.log("[WebRTC LOG] stopLocalStream: localStream is now null.");
        } else {
             console.log("[WebRTC LOG] stopLocalStream: localStream was already null.");
        }
        if (state.screenStream) {
             console.log(`[WebRTC LOG] stopLocalStream: Stopping tracks from screenStream (${state.screenStream.id}).`);
             state.screenStream.getTracks().forEach(track => {
                  console.log(`[WebRTC LOG] stopLocalStream: Stopping Screen track ${track.id} (${track.kind}).`);
                  track.stop();
             });
            state.screenStream = null;
             console.log("[WebRTC LOG] stopLocalStream: screenStream is now null.");
        } else {
             console.log("[WebRTC LOG] stopLocalStream: screenStream was already null.");
        }
        // Local video UI is reset by updateVideoDisplay with null stream
        updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
    }

    async function createPeerConnection(peerId) {
        console.log(`[WebRTC LOG] createPeerConnection called for Peer: ${peerId}. state.currentPCPartnerId before creation: ${state.currentPCPartnerId}`);
        // If a PC already exists for this peer, reuse it.
        if (state.peerConnection && state.currentPCPartnerId === peerId) {
            console.log(`[WebRTC LOG] createPeerConnection: PeerConnection with ${peerId} already exists and will be reused.`);
            return state.peerConnection;
        }
        // If a PC exists for a different peer, close it first.
        if (state.peerConnection) {
            console.log(`[WebRTC LOG] createPeerConnection: Closing existing PeerConnection with ${state.currentPCPartnerId} to create a new one with ${peerId}.`);
            closePeerConnection(); // Cleanly close old connection
        }

        console.log(`[WebRTC LOG] createPeerConnection: Creating new RTCPeerConnection for Peer: ${peerId} with config:`, CONFIG.RTC_CONFIGURATION);
        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.currentPCPartnerId = peerId; // Set partner ID immediately

        state.peerConnection.onicecandidate = event => {
            if (event.candidate && socket && state.connected && state.currentPCPartnerId === peerId) {
                 console.log(`[WebRTC LOG] onicecandidate: Sending ICE candidate to ${state.currentPCPartnerId} (Type: ${event.candidate.type}).`);
                socket.emit('webRTC-ice-candidate', { to: state.currentPCPartnerId, candidate: event.candidate });
            } else if (!event.candidate) {
                console.log(`[WebRTC LOG] onicecandidate: ICE candidate gathering for ${peerId} finished (null candidate).`);
            } else {
                 console.warn(`[WebRTC LOG] onicecandidate: ICE candidate for ${peerId} generated, but not sent (connected: ${state.connected}, currentPCPartnerId: ${state.currentPCPartnerId}).`);
            }
        };

        state.peerConnection.ontrack = event => {
            console.log(`[WebRTC LOG] ontrack: Remote track received from ${state.currentPCPartnerId}. Track Kind: ${event.track.kind}, Track ID: ${event.track.id}, Stream ID(s): ${event.streams ? event.streams.map(s => s.id).join(', ') : 'No Stream'}`);
             if (!UI.remoteVideo || !UI.remoteScreenStatus) {
                console.error("[WebRTC LOG] ontrack: Remote video/status element not found!");
                return;
            }

            // First, clear the old remoteStream and stop its tracks if it exists
            // This is important to ensure only the currently received stream is displayed.
            if (state.remoteStream) {
                 console.log(`[WebRTC LOG] ontrack: Stopping tracks of old remoteStream (${state.remoteStream.id}).`);
                 state.remoteStream.getTracks().forEach(t => t.stop());
            }

            // Assign the new stream directly or create a new MediaStream if event.streams[0] doesn't exist.
            // The browser usually groups tracks into streams.
            if (event.streams && event.streams[0]) {
                console.log(`[WebRTC LOG] ontrack: Assigning stream ${event.streams[0].id} (contains track ${event.track.id}) to remote video element.`);
                state.remoteStream = event.streams[0]; // Update the global remoteStream
            } else {
                // Fallback if tracks arrive individually without an associated stream in the event
                // This should rarely happen but is handled.
                if (!state.remoteStream) { // Only create if none exists yet
                    state.remoteStream = new MediaStream();
                    console.log(`[WebRTC LOG] ontrack: New remoteStream ${state.remoteStream.id} created as none was in event or existed.`);
                }
                // Add the received track to the (possibly newly created) remoteStream
                if (!state.remoteStream.getTrackById(event.track.id)) {
                    console.log(`[WebRTC LOG] ontrack: Adding track ${event.track.id} to (possibly new) remoteStream ${state.remoteStream.id}.`);
                    state.remoteStream.addTrack(event.track);
                } else {
                     console.log(`[WebRTC LOG] ontrack: Track ${event.track.id} is already in remoteStream ${state.remoteStream.id}.`);
                }
            }
            // Update the remote UI with the current remoteStream
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);

            // Add listeners for the end of the remote stream/tracks to update UI
             event.track.onended = () => {
                 console.log(`[WebRTC LOG] ontrack: Remote track ${event.track.id} (${event.track.kind}) ended.`);
                 // Check if all other tracks in remoteStream are ended
                 if (state.remoteStream && state.remoteStream.getTracks().every(t => t.readyState === 'ended')) {
                     console.log(`[WebRTC LOG] ontrack: All tracks in remoteStream ${state.remoteStream.id} ended. Resetting Remote UI.`);
                      // If all tracks ended, reset the Remote UI
                      updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
                      // Clear remoteStream reference as stream is no longer active
                      if (state.remoteStream) {
                         state.remoteStream.getTracks().forEach(t => t.stop()); // Ensure tracks are stopped
                         state.remoteStream = null;
                      }
                 } else {
                     console.log(`[WebRTC LOG] ontrack: Track ${event.track.id} ended, but other tracks in remoteStream are still active.`);
                      // If only one track ends but others are still there, update display
                      // e.g., switching from video+audio to audio only.
                     updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
                 }
             };
             event.track.onmute = () => {
                  console.log(`[WebRTC LOG] ontrack: Remote track ${event.track.id} (${event.track.kind}) was muted.`);
                  // If a video track is muted, update the display to status label if needed
                  if (event.track.kind === 'video') {
                      updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
                  }
             };
              event.track.ounmute = () => {
                   console.log(`[WebRTC LOG] ontrack: Remote track ${event.track.id} (${event.track.kind}) was unmuted.`);
                  // If a video track is unmuted, update the display to video if needed
                  if (event.track.kind === 'video') {
                       updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
                   }
              };
        };


        state.peerConnection.oniceconnectionstatechange = () => {
             if (!state.peerConnection) return;
            const pcState = state.peerConnection.iceConnectionState;
            const partner = state.allUsersList.find(u => u.id === state.currentPCPartnerId);
            const partnerUsername = partner ? partner.username : (state.currentPCPartnerId || 'Unbekannt');
            console.log(`[WebRTC LOG] oniceconnectionstatechange: ICE Connection Status to ${partnerUsername} (${state.currentPCPartnerId}): ${pcState}`);
            switch (pcState) {
                case "new": case "checking":
                    if (UI.remoteScreenStatus) {
                        UI.remoteScreenStatus.textContent = `VERBINDE MIT ${partnerUsername.toUpperCase()}...`;
                        UI.remoteScreenStatus.className = 'screen-status-label loading'; UI.remoteScreenStatus.classList.remove('hidden');
                    }
                    if (UI.remoteVideo) UI.remoteVideo.classList.add('hidden');
                    break;
                case "connected":
                    console.log(`[WebRTC LOG] ICE 'connected': Successfully connected with ${partnerUsername}. Data should flow now.`);
                    setConnectionStatus('connected', `Verbunden mit ${partnerUsername}`);
                    break;
                case "completed":
                    console.log(`[WebRTC LOG] ICE 'completed': All candidate pairs checked with ${partnerUsername}. Connection should be stable.`);
                    break;
                case "disconnected":
                    console.warn(`[WebRTC LOG] ICE 'disconnected': Video connection to ${partnerUsername} interrupted. Attempting to re-establish...`);
                     if (UI.remoteScreenStatus) {
                         UI.remoteScreenStatus.textContent = `VERBINDUNG UNTERBROCHEN MIT ${partnerUsername.toUpperCase()}`;
                         UI.remoteScreenStatus.className = 'screen-status-label loading'; UI.remoteScreenStatus.classList.remove('hidden');
                     }
                    break;
                case "failed":
                    console.error(`[WebRTC LOG] ICE 'failed': Video connection to ${partnerUsername} failed.`);
                    displayError(`Video-Verbindung zu ${partnerUsername} fehlgeschlagen.`);
                    closePeerConnection();
                    break;
                case "closed":
                    console.log(`[WebRTC LOG] ICE 'closed': Connection to ${partnerUsername} was closed.`);
                    if (state.currentPCPartnerId === (partner ? partner.id : null) || !partner) {
                        closePeerConnection();
                    }
                    break;
            }
        };

        state.peerConnection.onsignalingstatechange = () => {
            if (!state.peerConnection) return;
            console.log(`[WebRTC LOG] onsignalingstatechange: Signalling State to ${state.currentPCPartnerId || 'N/A'} changed to: ${state.peerConnection.signalingState}`);
        };

        state.peerConnection.onnegotiationneeded = async () => {
            console.log(`[WebRTC LOG] onnegotiationneeded: Event for ${state.currentPCPartnerId || 'N/A'} triggered. Current Signalling State: ${state.peerConnection?.signalingState}`);
            const isPolite = state.socketId < state.currentPCPartnerId;
            const canCreateOffer = state.peerConnection?.signalingState === 'stable' ||
                                (state.peerConnection?.signalingState === 'have-local-offer' && !isPolite);

            if (!canCreateOffer) {
                 console.warn(`[WebRTC LOG] onnegotiationneeded: Skipping Offer creation. Signalling State: '${state.peerConnection?.signalingState}'. Am I Polite? ${isPolite}.`);
                 return;
            }
             console.log(`[WebRTC LOG] onnegotiationneeded: Am Initiator (or safe). Creating and sending Offer to ${state.currentPCPartnerId}.`);
             await createAndSendOffer();
        };

        // Initial tracks are added by setupLocalMedia or toggleScreenSharing AFTER PC is created.
        // These functions use replaceTracksInPeerConnection.

        return state.peerConnection;
    }

    // Helper function to add tracks to a PeerConnection.
    // NOTE: Use replaceTracksInPeerConnection for existing connections instead of this directly.
    function addTracksToPeerConnection(stream, caller = 'unknown') {
        if (!state.peerConnection) {
             console.warn(`[WebRTC LOG] addTracksToPeerConnection (called by ${caller}): PeerConnection is null. Cannot add tracks.`);
             return;
        }
        if (!stream) {
            console.warn(`[WebRTC LOG] addTracksToPeerConnection (called by ${caller}): Called with null stream.`);
            return;
        }
        console.warn(`[WebRTC LOG] addTracksToPeerConnection (called by ${caller}): Adding tracks from Stream ${stream.id} to PeerConnection. NOTE: Using addTrack directly. Consider replaceTracksInPeerConnection for existing connections.`);
        stream.getTracks().forEach(track => {
             try {
                 // Add track. This creates a new RTCRtpSender.
                 state.peerConnection.addTrack(track, stream);
                 console.log(`[WebRTC LOG] addTracksToPeerConnection (called by ${caller}): Track ${track.kind} (${track.id}) successfully added.`);
             } catch (e) {
                  console.error(`[WebRTC LOG] addTracksToPeerConnection (called by ${caller}): Error adding track ${track.id}:`, e);
                  // The "A sender already exists for the track" error happens here if called incorrectly.
             }
        });
    }


    // Replaces the tracks in the PeerConnection with the tracks from a new stream.
    // Initiates renegotiation if needed.
    async function replaceTracksInPeerConnection(newStream, streamType = 'camera', caller = 'unknown') {
        console.log(`[WebRTC LOG] replaceTracksInPeerConnection (called by ${caller}): Replacing tracks for stream type '${streamType}' in PeerConnection with ${state.currentPCPartnerId || 'N/A'}. New Stream ID: ${newStream ? newStream.id : 'NULL'}.`);
        if (!state.peerConnection) {
            console.warn(`[WebRTC LOG] replaceTracksInPeerConnection (called by ${caller}): No PeerConnection found.`);
            // If PC is null, try to initiate P2P if connected?
            if (state.connected && state.allUsersList.some(u => u.id !== state.socketId)) {
                 console.warn(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Connected but no PeerConnection. Attempting to initiate P2P.`);
                 initiateP2PConnection(); // Attempt to create PC
                 // Tracks will be added after PC is ready and onnegotiationneeded fires.
            }
            return false;
        }

        const senders = state.peerConnection.getSenders();
        let negotiationNeeded = false;

        // Iterate over all SENDERs in the PeerConnection
        for (const sender of senders) {
            const trackKind = sender.track ? sender.track.kind : null;
            if (!trackKind) continue;

            // Find the corresponding track in the NEW Stream for this sender's kind
            const newTrackForSender = newStream ? newStream.getTracks().find(t => t.kind === trackKind) : null;

            if (newTrackForSender) {
                // If the new track exists and is different from the currently sent track, replace it
                if (sender.track !== newTrackForSender) {
                    console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Replacing Track ${trackKind} (old: ${sender.track?.id || 'N/A'}, new: ${newTrackForSender.id})`);
                    try {
                        await sender.replaceTrack(newTrackForSender);
                        negotiationNeeded = true; // Track was replaced -> Negotiation needed
                    } catch (e) {
                        console.error(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Error replacing Track ${trackKind}:`, e);
                    }
                } else {
                     console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Track ${trackKind} is the same (${sender.track?.id}). No replace needed.`);
                }
            } else {
                // If no new track exists for this sender's kind, send null if currently sending a track
                if (sender.track !== null) {
                    console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Sending null for Track ${trackKind} (old: ${sender.track?.id || 'N/A'}), as no new track is available.`);
                    try {
                        await sender.replaceTrack(null);
                         negotiationNeeded = true; // Sending null -> Negotiation needed
                    } catch (e) {
                         console.error(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Error replacing Track ${trackKind} with null:`, e);
                    }
                } else {
                     console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Track ${trackKind} is already sending null. No replace needed.`);
                }
            }
        }

         // Add any tracks from the newStream for which there was NO existing sender.
         // This is important if a new track type is added (e.g., video when only audio was sent before).
         if (newStream) {
             const existingSenderKinds = senders.map(s => s.track?.kind).filter(kind => kind);
             newStream.getTracks().forEach(track => {
                 if (!existingSenderKinds.includes(track.kind)) {
                     console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Adding new Track ${track.kind} (${track.id}) (No existing sender of this type).`);
                      try {
                         // Adding a track creates a new sender.
                         state.peerConnection.addTrack(track, newStream);
                         negotiationNeeded = true; // New track added -> Negotiation needed
                      } catch (e) {
                         console.error(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Error adding new Track ${track.id}:`, e);
                      }
                 } else {
                      console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Track ${track.kind} (${track.id}) already has an existing sender. Will not add again.`);
                 }
             });
         }


        if (negotiationNeeded) {
            console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): Tracks were changed. Negotiation will be triggered by onnegotiationneeded.`);
            // The onnegotiationneeded event should handle initiating the offer if necessary.
        } else {
            console.log(`[WebRTC LOG] replaceTracksInPeerConnection (by ${caller}): No effective change in tracks. No negotiation needed.`);
        }
        return negotiationNeeded;
    }


    function closePeerConnection() {
        console.log("[WebRTC LOG] closePeerConnection called.");
        if (state.peerConnection) {
            console.log("[WebRTC LOG] closePeerConnection: Closing PeerConnection with:", state.currentPCPartnerId);
            // Tracks themselves are not stopped here, as they belong to localStream or screenStream.
            // stopLocalStream() or toggleScreenSharing() stop the tracks.
            state.peerConnection.close();
            state.peerConnection = null;
        } else {
             console.log("[WebRTC LOG] closePeerConnection: No PeerConnection to close.");
        }
        state.currentPCPartnerId = null;

        if(state.remoteStream){
            console.log(`[WebRTC LOG] closePeerConnection: Stopping tracks of remoteStream (${state.remoteStream.id}).`);
            state.remoteStream.getTracks().forEach(track => track.stop());
            state.remoteStream = null;
             console.log("[WebRTC LOG] closePeerConnection: remoteStream is now null.");
        } else {
             console.log("[WebRTC LOG] closePeerConnection: remoteStream was already null.");
        }
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
        console.log("[WebRTC LOG] closePeerConnection: PeerConnection and partner ID reset.");
    }

    // Initiates the process to set up a P2P WebRTC connection with another user
    function initiateP2PConnection() {
        console.log("[WebRTC LOG] initiateP2PConnection called.");
        if (!state.connected || !socket || !state.socketId) {
            console.log("[WebRTC LOG] initiateP2PConnection: Conditions not met (not connected, no socket, or no own ID).");
            return;
        }

        const currentPartnerOnline = state.currentPCPartnerId && state.allUsersList.some(u => u.id === state.currentPCPartnerId);

        // If a PC exists and the current partner is still online, do nothing.
        if (state.peerConnection && currentPartnerOnline) {
             console.log(`[WebRTC LOG] initiateP2PConnection: Existing connection to ${state.currentPCPartnerId} is online. No action.`);
             return;
        } else if (state.peerConnection && !currentPartnerOnline) { // Partner gone, but PC still there
            console.log("[WebRTC LOG] initiateP2PConnection: Current partner no longer online. Closing old PeerConnection.");
            closePeerConnection(); // Clean up old connection
        }

        const otherUsers = state.allUsersList.filter(u => u.id !== state.socketId);
        if (otherUsers.length === 0) {
            console.log("[WebRTC LOG] initiateP2PConnection: No other users in room for P2P.");
            if(state.currentPCPartnerId) closePeerConnection();
            updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
            return;
        }

        const targetUser = otherUsers.sort((a,b) => a.id.localeCompare(b.id))[0];
        console.log(`[WebRTC LOG] initiateP2PConnection: Potential P2P Partner: ${targetUser.username} (${targetUser.id})`);

        const shouldInitiateOffer = state.socketId < targetUser.id;
        console.log(`[WebRTC LOG] initiateP2PConnection: Own ID: ${state.socketId}, Target ID: ${targetUser.id}. Am I Initiator? ${shouldInitiateOffer}`);


         createPeerConnection(targetUser.id).then(async () => {
             console.log(`[WebRTC LOG] initiateP2PConnection: PeerConnection with ${targetUser.id} created.`);

             // Do NOT add initial tracks here. They will be added by setupLocalMedia or toggleScreenSharing
             // which are called after joinSuccess and during screen sharing events, using replaceTracksInPeerConnection.

              if (shouldInitiateOffer) {
                   console.log(`[WebRTC LOG] initiateP2PConnection: Am Initiator. Will create and send initial Offer (potentially no media lines).`);
                  // Send initial offer. Media lines will be added when tracks are added later.
                  await createAndSendOffer();
               } else {
                    console.log(`[WebRTC LOG] initiateP2PConnection: Am Receiver. Will wait for Offer.`);
               }

         }).catch(err => {
              console.error("[WebRTC LOG] initiateP2PConnection: Error creating PeerConnection:", err);
              displayError("Fehler beim Aufbau der P2P-Verbindung.");
              closePeerConnection();
         });

    }

     async function createAndSendOffer() {
         if (!state.peerConnection || !state.currentPCPartnerId) {
             console.warn("[WebRTC LOG] createAndSendOffer: Conditions not met (no PC or no partner). Offer not created.");
             return;
         }
         // Polite Peer Glare Handling check
         const isPolite = state.socketId < state.currentPCPartnerId;
         const canCreateOffer = state.peerConnection?.signalingState === 'stable' ||
                                (state.peerConnection?.signalingState === 'have-local-offer' && !isPolite);

         if (!canCreateOffer) {
              console.warn(`[WebRTC LOG] createAndSendOffer: Skipping Offer creation. Signalling State: '${state.peerConnection?.signalingState}'. Am I Polite? ${isPolite}.`);
              return;
         }

         try {
             console.log(`[WebRTC LOG] createAndSendOffer: Creating Offer for ${state.currentPCPartnerId}. Current Signalling State: ${state.peerConnection.signalingState}`);
             const offer = await state.peerConnection.createOffer();

             // Check if the offer has actually changed before calling setLocalDescription again
             if (!state.peerConnection.localDescription || state.peerConnection.localDescription.sdp !== offer.sdp) {
                 console.log(`[WebRTC LOG] createAndSendOffer: Setting LocalDescription (Offer) for ${state.currentPCPartnerId}. Offer Type: ${offer.type}`);
                 await state.peerConnection.setLocalDescription(offer); // This updates localDescription
                 console.log(`[WebRTC LOG] createAndSendOffer: LocalDescription set. New Signalling State: ${state.peerConnection.signalingState}`);
             } else {
                 console.log(`[WebRTC LOG] createAndSendOffer: New Offer is identical to existing LocalDescription. No setLocalDescription needed.`);
             }

             // Send the (possibly just set) localDescription
             if (state.peerConnection.localDescription) {
                 console.log(`[WebRTC LOG] createAndSendOffer: Sending Offer (Type: ${state.peerConnection.localDescription.type}) to ${state.currentPCPartnerId}.`);
                 socket.emit('webRTC-offer', { to: state.currentPCPartnerId, offer: state.peerConnection.localDescription });
             } else {
                  console.error("[WebRTC LOG] createAndSendOffer: localDescription is null after setLocalDescription. Offer cannot be sent.");
             }

         } catch (err) {
             console.error('[WebRTC LOG] createAndSendOffer: Error creating/sending Offer:', err);
             displayError("Fehler bei der Video-Verhandlung (Offer).");
         }
     }


    async function toggleScreenSharing() {
        if (!state.connected || !UI.shareScreenBtn) {
             console.warn("[WebRTC LOG] toggleScreenSharing: Not connected or button not found.");
             return;
        }
        UI.shareScreenBtn.disabled = true;
        console.log(`[WebRTC LOG] toggleScreenSharing called. Current state: ${state.isSharingScreen ? 'Sharing active' : 'Sharing inactive'}.`);

        if (state.isSharingScreen) { // Stop screensharing
            console.log("[WebRTC LOG] toggleScreenSharing: Stopping Screensharing.");
            if (state.screenStream) {
                console.log(`[WebRTC LOG] toggleScreenSharing: Stopping tracks from screenStream (${state.screenStream.id}).`);
                state.screenStream.getTracks().forEach(track => {
                    console.log(`[WebRTC LOG] toggleScreenSharing: Stopping Screen Track ${track.id} (${track.kind}).`);
                    track.stop();
                });
                state.screenStream = null;
                console.log("[WebRTC LOG] toggleScreenSharing: screenStream is now null.");
            }
            state.isSharingScreen = false;
            UI.shareScreenBtn.textContent = 'Bildschirm teilen';
            UI.shareScreenBtn.classList.remove('danger-btn');

            // Replace screen tracks with microphone tracks (Audio-only stream)
            // setupLocalMedia gets the microphone stream or ensures it exists.
             console.log("[WebRTC LOG] toggleScreenSharing: Screensharing stopped. Re-initializing local audio stream.");
             // setupLocalMedia gets the audio-only stream and calls replaceTracksInPeerConnection
             // It also updates the local UI display (which is hidden anyway).
             await setupLocalMedia(false); // false, since it's a full switch back to mic

        } else { // Start screensharing
            console.log("[WebRTC LOG] toggleScreenSharing: Starting Screensharing.");
            try {
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
                    audio: true
                });
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');

                console.log(`[WebRTC LOG] toggleScreenSharing: ScreenStream ${state.screenStream.id} obtained. Tracks: Video: ${state.screenStream.getVideoTracks().length}, Audio: ${state.screenStream.getAudioTracks().length}`);

                // Stop the local microphone stream, as audio now comes from the screen stream (if audio:true above).
                if (state.localStream) {
                     console.log("[WebRTC LOG] toggleScreenSharing: Stopping local microphone stream.");
                     state.localStream.getTracks().forEach(track => track.stop());
                     state.localStream = null;
                     console.log("[WebRTC LOG] toggleScreenSharing: localStream is now null.");
                }

                // Replace current tracks (microphone) with screen tracks in the PeerConnection
                if (state.peerConnection) {
                    console.log("[WebRTC LOG] toggleScreenSharing: PeerConnection exists. Replacing tracks with ScreenStream tracks.");
                    await replaceTracksInPeerConnection(state.screenStream, 'screen', 'toggleScreenSharing');
                } else {
                     console.warn("[WebRTC LOG] toggleScreenSharing: PeerConnection does not exist when starting screensharing. Tracks will be added when PC is initiated.");
                     // If PC doesn't exist, initiateP2PConnection should be called by userListUpdate or similar.
                     // The screen tracks will be added to the PC when it's created via replaceTracksInPeerConnection
                     // called after initiateP2PConnection completes and sets state.peerConnection.
                     // We need to ensure initiateP2PConnection is triggered if needed here.
                     // It's already triggered by userListUpdate when users are present.
                }

                // Update local UI (will show "Bildschirm geteilt" status)
                 updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true);

                const screenVideoTrack = state.screenStream.getVideoTracks()[0];
                if (screenVideoTrack) {
                    screenVideoTrack.onended = () => {
                        console.log("[WebRTC LOG] toggleScreenSharing: Screensharing ended by browser UI.");
                        if (state.isSharingScreen) {
                            console.log("[WebRTC LOG] toggleScreenSharing: Calling toggleScreenSharing to clean up.");
                            toggleScreenSharing();
                        }
                    };
                     console.log("[WebRTC LOG] toggleScreenSharing: onended listener for Screen Video Track added.");
                } else {
                     console.warn("[WebRTC LOG] toggleScreenSharing: No Screen Video Track found, onended listener could not be added.");
                }

            } catch (err) {
                console.error('[WebRTC LOG] toggleScreenSharing: Error starting screensharing:', err.name, err.message);
                let errorMessage = `Bildschirmfreigabe fehlgeschlagen: ${err.message}`;
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                     errorMessage = "Bildschirmfreigabe verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
                } else if (err.name === 'AbortError') {
                     errorMessage = "Bildschirmfreigabe abgebrochen.";
                }
                displayError(errorMessage);

                state.isSharingScreen = false;
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                UI.shareScreenBtn.classList.remove('danger-btn');

                 console.log("[WebRTC LOG] toggleScreenSharing: Screensharing failed. Attempting to restore local audio stream.");
                 await setupLocalMedia(false);
            }
        }
        UI.shareScreenBtn.disabled = false;
    }


    function toggleFullscreen(videoElement) {
        if (!videoElement || videoElement.classList.contains('hidden')) {
             console.warn("[UI] toggleFullscreen: Cannot start fullscreen, video element not found or hidden.");
             return;
        }
         console.log(`[UI] toggleFullscreen called for video element:`, videoElement);
        if (!document.fullscreenElement) {
            if (videoElement.requestFullscreen) {
                videoElement.requestFullscreen().catch(err => console.error(`[UI] Fullscreen error: ${err.message}`, err));
            } else if (videoElement.webkitRequestFullscreen) { /* Safari */
                videoElement.webkitRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (webkit): ${err.message}`, err));
            } else if (videoElement.msRequestFullscreen) { /* IE11 */
                videoElement.msRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (ms): ${err.message}`, err));
            } else {
                 console.warn("[UI] toggleFullscreen: Browser does not support Fullscreen API on this element.");
            }
        } else {
             console.log("[UI] toggleFullscreen: Exiting Fullscreen.");
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
    }

    function resetFileInput() {
        state.selectedFile = null;
        if (UI.fileInput) UI.fileInput.value = '';
        UI.messageInput.placeholder = 'Nachricht eingeben...';
    }


    // --- Init ---
    initializeUI();
    // populateMicList() is called after 'joinSuccess'

});
