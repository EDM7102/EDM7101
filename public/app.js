document.addEventListener('DOMContentLoaded', () => {
    const UI = {
        usernameInput: document.getElementById('usernameInput'),
        connectBtn: document.getElementById('connectBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        userList: document.getElementById('userList'),
        messagesContainer: document.getElementById('messagesContainer'),
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        typingIndicator: document.getElementById('typingIndicator'),
        statusIndicator: document.getElementById('statusIndicator'),
        errorMessage: document.getElementById('errorMessage'),
        micSelect: document.getElementById('micSelect'),
        remoteAudioControls: document.getElementById('remoteAudioControls'),

        // UI Elemente für Bildschirm teilen
        shareScreenBtn: document.getElementById('shareScreenBtn'),
        remoteScreenContainer: document.getElementById('remoteScreenContainer'),
        remoteScreenSharerName: document.getElementById('remoteScreenSharerName'),
        remoteScreenVideo: document.getElementById('remoteScreenVideo'),
        remoteScreenFullscreenBtn: document.querySelector('#remoteScreenContainer .fullscreen-btn')
    };

    // Dieser Log wird direkt nach dem Abrufen der UI-Elemente ausgeführt
    console.log("[App] UI.connectBtn gefunden (nach UI-Abruf):", !!UI.connectBtn);
    if (UI.connectBtn) {
        console.log("[App] UI.connectBtn Element (nach UI-Abruf):", UI.connectBtn);
    }


    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room',
        socketId: null,
        allUsersList: [],

        typingTimeout: null,
        typingUsers: new Set(),

        notificationSound: new Audio('/notif.mp3'),

        // WebRTC State (Lokal)
        localAudioStream: null,
        screenStream: null,
        isSharingScreen: false,

        // WebRTC State (Remote)
        peerConnections: new Map(),
        remoteAudioElements: new Map(),
        remoteStreams: new Map(),

        // Bildschirm teilen State (Remote Anzeige)
        currentlyViewingPeerId: null,

        localAudioMuted: false,
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500,
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ],
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9700', '#ff5722', '#795548'],
    };

    // --- Funktionsdefinitionen ---
    // Alle Funktionsdefinitionen (inkl. connect, disconnect, etc.) bleiben hier oben

    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, m => map[m]);
    }

    function getUserColor(userIdOrName) {
        let hash = 0;
        const str = String(userIdOrName);
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.USER_COLORS[Math.abs(hash) % CONFIG.USER_COLORS.length];
    }

    function playNotificationSound() {
        if (state.notificationSound) {
            state.notificationSound.currentTime = 0;
             state.notificationSound.play().catch(e => {
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
             });
        }
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

    function loadStateFromLocalStorage() {
        try {
            const storedState = localStorage.getItem('chatAppState');
            if (storedState) {
                state = { ...state, ...JSON.parse(storedState) };
                if (state.username) {
                    UI.usernameInput.value = state.username;
                }
            }
        } catch (e) {
            console.error("Fehler beim Laden des Zustands aus Local Storage:", e);
            displayError("Fehler beim Laden gespeicherter Daten.");
        }
    }

    // initializeUI wird angepasst, um Event Listener zuzuweisen
    function initializeUI() {
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        // UI Elemente werden bereits am Anfang des DOMContentLoaded Blocks geholt

        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        if (UI.micSelect) UI.micSelect.disabled = false;
        updateRemoteAudioControls();
        updateRemoteScreenDisplay(null);

        // --- Event Listener Zuweisungen (JETZT INNERHALB von initializeUI) ---
        // Dieser Block wird ausgeführt, NACHDEM UI-Elemente geholt sind und initializeUI gestartet wurde

        console.log("[App] Event Listener werden ZUGJEWIESEN innerhalb von initializeUI."); // Debug Log
        if (UI.connectBtn) { // Prüfen, ob Button gefunden wurde
            UI.connectBtn.addEventListener('click', connect);
            console.log("[App] connectBtn Listener ZUGJEWIESEN innerhalb von initializeUI."); // Debug Log
        } else {
             console.error("[App] connectBtn Element NICHT GEFUNDEN innerhalb von initializeUI!"); // Debug Log
        }


        if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
            if (state.connected && !state.isSharingScreen) {
                console.log("[WebRTC] Mikrofonauswahl geändert. Versuche lokalen Stream zu aktualisieren.");
                await setupLocalAudioStream();
            } else if (state.isSharingScreen) {
                console.warn("[WebRTC] Mikrofonauswahl geändert während Bildschirmteilung. Ändert sich erst danach.");
            } else {
                 console.log("[WebRTC] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
            }
        });

        if (UI.shareScreenBtn) UI.shareScreenBtn.addEventListener('click', toggleScreenSharing);

         if (UI.remoteScreenFullscreenBtn) {
             UI.remoteScreenFullscreenBtn.addEventListener('click', () => {
                 if (UI.remoteScreenContainer) {
                      toggleFullscreen(UI.remoteScreenContainer);
                 }
             });
         }

         document.addEventListener('fullscreenchange', () => {
             if (UI.remoteScreenFullscreenBtn) {
                  const isRemoteScreenInFullscreen = document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement));
                  UI.remoteScreenFullscreenBtn.textContent = isRemoteScreenInFullscreen ? "Vollbild verlassen" : "Vollbild";
             }
         });

        window.addEventListener('beforeunload', () => {
            if (socket && socket.connected) {
                socket.disconnect();
            }
             stopLocalAudioStream();
             stopScreenSharing(false);
             closeAllPeerConnections();
        });

        // Globale Funktion für Vollbild
        function toggleFullscreen(element) {
            if (!element) {
                 console.warn("[UI] toggleFullscreen: Element nicht gefunden.");
                 return;
            }
            if (!document.fullscreenElement) {
                if (element.requestFullscreen) {
                    element.requestFullscreen().catch(err => console.error(`[UI] Fullscreen error: ${err.message}`, err));
                } else if (element.webkitRequestFullscreen) {
                    element.webkitRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (webkit): ${err.message}`, err));
                } else if (element.msRequestFullscreen) {
                    element.msRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (ms): ${err.message}`, err));
                } else {
                     console.warn("[UI] toggleFullscreen: Browser does not support Fullscreen API on this element.");
                }
            } else {
                 console.log("[UI] toggleFullscreen: Exiting Fullscreen.");
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    document.webkitExitFullscreen();
                } else if (document.msExitFullscreen) {
                    document.msExitFullscreen();
                }
            }
        }

    } // Ende initializeUI Funktion

    function updateUIAfterConnect() {
        if (!UI.connectBtn || !UI.disconnectBtn || !UI.sendBtn || !UI.messageInput) return;
        UI.connectBtn.classList.add('hidden');
        UI.disconnectBtn.classList.remove('hidden');
        UI.shareScreenBtn.classList.remove('hidden');
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        setConnectionStatus('connected', 'Verbunden');
        saveStateToLocalStorage();
    }

    function updateUIAfterDisconnect() {
        if (!UI.connectBtn || !UI.disconnectBtn || !UI.sendBtn || !UI.messageInput) return;
        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        setConnectionStatus('disconnected', 'Getrennt');
        stopLocalAudioStream();
        stopScreenSharing(false);
        closeAllPeerConnections();
    }

    function saveStateToLocalStorage() {
        try {
            const stateToSave = { username: state.username };
            localStorage.setItem('chatAppState', JSON.stringify(stateToSave));
        } catch (e) {
            console.error("Fehler beim Speichern des Zustands im Local Storage:", e);
            displayError("Fehler beim Speichern von Daten.");
        }
    }

    function populateMicList(devices) {
        if (!UI.micSelect) return;
        UI.micSelect.innerHTML = '<option value="">Standard-Mikrofon</option>';
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Mikrofon ${UI.micSelect.options.length}`;
            UI.micSelect.add(option);
        });
    }

    function updateUserList(users) {
        if (!UI.userList) return;
        UI.userList.innerHTML = '';
        if (users && users.length > 0) {
            users.forEach(user => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span class="user-dot" style="background-color: <span class="math-inline">\{user\.color \|\| getUserColor\(user\.id\)\}"\></span\>
<strong\></span>{escapeHTML(user.username)}</strong>
                    ${user.sharingStatus ? '<span class="sharing-indicator"> (teilt)</span>' : ''}
                    ${user.id !== state.socketId && user.sharingStatus ? `<button class="view-screen-button view" data-peer-id="${user.id}">Bildschirm ansehen</button>` : ''}
                `;
                UI.userList.appendChild(li);
            });
            document.querySelectorAll('#userList li .view-screen-button').forEach(button => {
                button.addEventListener('click', handleViewScreenClick);
            });
            document.getElementById('userCountPlaceholder').textContent = users.length.toString();
        } else {
            document.getElementById('userCountPlaceholder').textContent = '0';
        }
        state.allUsersList = users;
        updatePeerConnections(users.filter(user => user.id !== state.socketId));
    }

    function updateTypingIndicatorDisplay() {
        if (!UI.typingIndicator) return;
        const typingUsernames = Array.from(state.typingUsers);
        if (typingUsernames.length > 0) {
            UI.typingIndicator.textContent = `${typingUsernames.map(name => escapeHTML(name)).join(', ')} schreibt gerade...`;
            UI.typingIndicator.style.display = 'block';
        } else {
            UI.typingIndicator.style.display = 'none';
        }
    }

    function updateRemoteAudioControls() {
        if (!UI.remoteAudioControls) return;
        UI.remoteAudioControls.classList.toggle('hidden', state.peerConnections.size === 0);
        UI.remoteAudioControls.innerHTML = '<h3>Sprach-Teilnehmer</h3>';
        state.peerConnections.forEach((pc, peerId) => {
            const user = state.allUsersList.find(u => u.id === peerId);
            if (!user) return;

            const itemDiv = document.createElement('div');
            itemDiv.classList.add('remote-audio-item');
            itemDiv.innerHTML = `
                <span style="color: <span class="math-inline">\{user\.color \|\| getUserColor\(peerId\)\}"\></span>{escapeHTML(user.username)}</span>
                <button class="mute-btn" data-peer-id="${peerId}">Stumm</button>
            `;
            UI.remoteAudioControls.appendChild(itemDiv);
        });
        document.querySelectorAll('#remoteAudioControls .mute-btn').forEach(button => {
            button.addEventListener('click', toggleRemoteAudioMute);
        });
        updateAllRemoteMuteButtons();
    }

    function updateRemoteScreenDisplay(peerId) {
        if (!UI.remoteScreenContainer || !UI.remoteScreenVideo || !UI.remoteScreenSharerName) return;

        if (peerId) {
            const user = state.allUsersList.find(u => u.id === peerId);
            if (user) {
                UI.remoteScreenContainer.classList.remove('hidden');
                UI.remoteScreenSharerName.textContent = escapeHTML(user.username);
                const stream = state.remoteStreams.get(peerId);
                if (stream) {
                    UI.remoteScreenVideo.srcObject = stream;
                } else {
                    UI.remoteScreenVideo.srcObject = null;
                }
                state.currentlyViewingPeerId = peerId;
            } else {
                UI.remoteScreenContainer.classList.add('hidden');
                UI.remoteScreenVideo.srcObject = null;
                UI.remoteScreenSharerName.textContent = '';
                state.currentlyViewingPeerId = null;
            }
        } else {
            UI.remoteScreenContainer.classList.add('hidden');
            UI.remoteScreenVideo.srcObject = null;
            UI.remoteScreenSharerName.textContent = '';
            state.currentlyViewingPeerId = null;
        }
        updateAllViewScreenButtons();
    }

    function ensureRemoteAudioElementExists(peerId) {
        if (state.remoteAudioElements.has(peerId)) {
            return state.remoteAudioElements.get(peerId);
        }
        const audioElement = new Audio();
        audioElement.autoplay = true;
        audioElement.controls = false;
        state.remoteAudioElements.set(peerId, audioElement);
        return audioElement;
    }

    function removeRemoteAudioElement(peerId) {
        if (state.remoteAudioElements.has(peerId)) {
            const audioElement = state.remoteAudioElements.get(peerId);
            audioElement.pause();
            audioElement.srcObject = null;
            state.remoteAudioElements.delete(peerId);
        }
    }

    function toggleLocalAudioMute() {
        if (!state.localAudioStream) return;
        state.localAudioMuted = !state.localAudioMuted;
        state.localAudioStream.getTracks().forEach(track => {
            if (track.kind === 'audio') {
                track.enabled = !state.localAudioMuted;
            }
        });
        updateLocalMuteButtonUI();
    }

    function updateLocalMuteButtonUI() {
        if (!UI.localMuteBtn) return;
        UI.localMuteBtn.textContent = state.localAudioMuted ? 'Mikrofon an' : 'Mikro stumm schalten';
        UI.localMuteBtn.classList.toggle('muted', state.localAudioMuted);
    }

    function toggleRemoteAudioMute(event) {
        const peerId = event.target.dataset.peerId;
        if (!peerId || !state.remoteAudioElements.has(peerId)) return;

        const audioElement = state.remoteAudioElements.get(peerId);
        audioElement.muted = !audioElement.muted;
        updateAllRemoteMuteButtons();
    }

    function updateAllRemoteMuteButtons() {
        if (!UI.remoteAudioControls) return;
        UI.remoteAudioControls.querySelectorAll('.mute-btn').forEach(button => {
            const peerId = button.dataset.peerId;
            if (state.remoteAudioElements.has(peerId)) {
                button.textContent = state.remoteAudioElements.get(peerId).muted ? 'Ton an' : 'Stumm';
                button.classList.toggle('muted', state.remoteAudioElements.get(peerId).muted);
            }
        });
    }

    async function setupLocalAudioStream() {
        console.log("[WebRTC] setupLocalAudioStream aufgerufen.");
        try {
            const constraints = {
                audio: {
                    deviceId: UI.micSelect.value ? { exact: UI.micSelect.value } : undefined,
                },
                video: false,
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log("[WebRTC] Lokalen Audio-Stream erhalten:", stream);
            state.localAudioStream = stream;
            updateLocalMuteButtonUI();
            updateAllRemoteMuteButtons();
            return stream;

        } catch (error) {
            console.error("[WebRTC] Fehler beim Abrufen des lokalen Audio-Streams:", error);
            displayError("Zugriff auf Mikrofon verweigert oder kein Mikrofon gefunden.");
            return null;
        }
    }

    function stopLocalAudioStream() {
        if (state.localAudioStream) {
            console.log("[WebRTC] Stoppe lokalen Audio-Stream.");
            state.localAudioStream.getTracks().forEach(track => track.stop());
            state.localAudioStream = null;
            updateLocalMuteButtonUI();
            updateAllRemoteMuteButtons();
        } else {
             console.log("[WebRTC] Kein lokaler Audio-Stream zum Stoppen.");
        }
    }


    function updateAllViewScreenButtons() {
         if (!UI.userList) return;
         UI.userList.querySelectorAll('.view-screen-button').forEach(button => {
             const peerId = button.dataset.peerId;
             if (peerId === state.currentlyViewingPeerId) {
                  button.textContent = 'Anzeige stoppen';
                  button.classList.remove('view');
                  button.classList.add('stop');
             } else {
                  button.textContent = 'Bildschirm ansehen';
                  button.classList.remove('stop');
                  button.classList.add('view');
             }
         });
    }

    // Startet die Socket.IO Verbindung (Funktion, die von Klick aufgerufen wird)
    function connect() { // <-- DEFINITION DER CONNECT FUNKTION
        console.log("[Socket.IO] connect() button clicked."); // Debug Log am Anfang des Aufrufs
        console.log("[Socket.IO] connect() aufgerufen.");
        const serverUrl = window.location.origin;
        const roomId = state.roomId;
        let username = UI.usernameInput.value.trim();

        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username;
        state.username = username;

        console.log(`[Socket.IO] Verbinde mit ${serverUrl} in Raum ${state.roomId} als ${state.username}`);

        if (socket) {
            console.log("[Socket.IO] Bestehende Socket-Instanz gefunden, wird getrennt.");
            socket.disconnect();
        }

        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket'],
            forceNew: true
        });
        setConnectionStatus('connecting', 'Verbinde...');
        setupSocketListeners();
    }

    // Richtet alle Socket.IO Event Listener ein
    function setupSocketListeners() {
        if (!socket) return;
        console.log("[Socket.IO] setupSocketListeners aufgerufen.");

        socket.on('connect', () => {
            console.log('[Socket.IO] "connect" event erhalten. Socket verbunden auf Transport:', socket.io.engine.transport.name, 'Socket ID:', socket.id);
        });

        socket.on('connect_error', (err) => {
            console.error('[Socket.IO] "connect_error" erhalten:', err.message, err.data);
            state.connected = false;
            displayError(`Verbindungsfehler: ${err.message}. Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] "disconnect" event erhalten: ${reason}`);
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect();
        });

        socket.on('joinSuccess', ({ users: currentUsers, id: myId }) => {
            console.log(`[Socket.IO] "joinSuccess" event erhalten. Dein Socket ID: ${myId}, Benutzer im Raum:`, currentUsers);
            state.connected = true;
            state.socketId = myId;
             const selfUser = currentUsers.find(u => u.id === myId);
             if(selfUser) {
                  state.username = selfUser.username;
             }
            updateUIAfterConnect();
            updateUserList(currentUsers);
        });

        socket.on('joinError', ({ message }) => {
            console.error(`[Socket.IO] "joinError" erhalten: ${message}`);
            displayError(message);
            if (socket && socket.connected) {
                 console.log("[Socket.IO] JoinError erhalten, Socket ist noch verbunden. Manuelles Trennen.");
                 socket.disconnect();
             } else {
                 console.log("[Socket.IO] JoinError erhalten, Socket war bereits getrennt oder wird getrennt.");
             }
        });

        socket.on('userListUpdate', (currentUsersList) => {
            console.log("[Socket.IO] Benutzerliste aktualisiert:", currentUsersList);
            updateUserList(currentUsersList);
        });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            if (message.id !== state.socketId) {
                 console.log("[Socket.IO] Neue Nachricht von anderem Benutzer. Sound abspielen.");
                playNotificationSound();
            }
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

        // --- WebRTC Signalisierungs-Listener ---
        socket.on('webRTC-signal', async ({ from, type, payload }) => {
             if (from === state.socketId) {
                 return;
             }

             let pc = state.peerConnections.get(from);
             if (!pc) {
                 console.warn(`[WebRTC Signal] Empfange Signal von unbekanntem Peer ${from}. Erstelle PeerConnection.`);
                 pc = await createPeerConnection(from);
                 addLocalStreamTracksToPeerConnection(pc, state.isSharingScreen ? state.screenStream : state.localAudioStream);
             }

            try {
                 if (type === 'offer') {
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Offer).`);
                    const isPolite = state.socketId < from;

                    if (pc.signalingState !== 'stable' && pc.localDescription && isPolite) {
                         console.warn(`[WebRTC Signal] Peer ${from}: Glare erkannt (Polite). Ignoriere Offer.`);
                         return;
                    }

                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                    console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Offer) gesetzt.`);

                    console.log(`[WebRTC Signal] Peer ${from}: Erstelle Answer.`);
                    const answer = await pc.createAnswer();
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Local Description (Answer).`);
                    await pc.setLocalDescription(answer);
                    console.log(`[WebRTC Signal] Peer ${from}: Local Description (Answer) gesetzt.`);

                    console.log(`[WebRTC Signal] Peer ${from}: Sende Answer.`);
                    socket.emit('webRTC-signal', { to: from, type: 'answer', payload: pc.localDescription });

                 } else if (type === 'answer') {
                     console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Answer).`);
                    if (pc.signalingState === 'have-local-offer') {
                        await pc.setRemoteDescription(new RTCSessionDescription(payload));
                         console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Answer) gesetzt.`);
                    } else {
                        console.warn(`[WebRTC Signal] Peer <span class="math-inline">\{from\}\: Empfange Answer im falschen Signaling State \(</span>{pc.signalingState}). Ignoriere.`);
                    }

                 } else if (type === 'candidate') {
                     try {
                        await pc.addIceCandidate(new RTCIceCandidate(payload));
                     } catch (e) {
                         console.error(`[WebRTC Signal] Peer ${from}: Fehler beim Hinzufügen des ICE Kandidaten:`, e);
                     }

                 } else {
                     console.warn(`[WebRTC Signal] Unbekannter Signal-Typ '${type}' von Peer ${from} empfangen.`);
                 }
            } catch (err) {
                console.error(`[WebRTC Signal Error] Fehler bei Verarbeitung von Signal '${type}' von Peer ${from}:`, err);
                displayError(`Fehler bei Audio-Verhandlung mit Peer ${from}.`);
            }
        });

        socket.on('screenShareStatus', ({ id, sharing }) => {
            console.log(`[Socket.IO] screenShareStatus von ${id} erhalten: ${sharing}. (Wird von userListUpdate verarbeitet)`);
        });
    }

    // Startet die Bildschirmteilung
    async function startScreenSharing() {
        console.log("[WebRTC] startScreenSharing aufgerufen.");
        if (!state.connected) {
             console.warn("[WebRTC] Nicht verbunden, kann Bildschirm nicht teilen.");
             return false;
        }
        if (state.isSharingScreen) {
             console.warn("[WebRTC] Bildschirm wird bereits geteilt.");
             return true;
        }

        try {
             const stream = await navigator.mediaDevices.getDisplayMedia({
                 video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
                 audio: true
             });
             state.screenStream = stream;
             state.isSharingScreen = true;
             console.log(`[WebRTC] Bildschirmstream erhalten: ${stream.id}. Tracks: Video: ${stream.getVideoTracks().length}, Audio: ${stream.getAudioTracks().length}`);

             const screenAudioTrack = stream.getAudioTracks()[0];
             if (screenAudioTrack && state.localAudioStream) {
                  console.log("[WebRTC] Bildschirmstream hat Audio. Stoppe lokalen Mikrofonstream.");
                 stopLocalAudioStream();
             } else {
                  console.log("[WebRTC] Bildschirmstream hat kein Audio oder Mikrofon war nicht aktiv. Mikrofon bleibt/ist inaktiv.");
             }

             state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream);
             });

             const screenVideoTrack = stream.getVideoTracks()[0];
             if (screenVideoTrack) {
                 screenVideoTrack.onended = () => {
                     console.log("[WebRTC] Bildschirmteilung beendet durch Browser UI.");
                     if (state.isSharingScreen) {
                         toggleScreenSharing();
                     }
                 };
                  console.log("[WebRTC] onended Listener für Screen Video Track hinzugefügt.");
             } else {
                  console.warn("[WebRTC] Kein Screen Video Track gefunden, onended Listener konnte nicht hinzugefügt werden.");
             }

             socket.emit('screenShareStatus', { sharing: true });
             console.log("[Socket.IO] Sende 'screenShareStatus: true'.");

             updateShareScreenButtonUI();

             return true;
        } catch (err) {
             console.error('[WebRTC] Fehler beim Starten der Bildschirmteilung:', err.name, err.message);
             let errorMessage = `Bildschirmfreigabe fehlgeschlagen: ${err.message}.`;
             if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                  errorMessage = "Bildschirmfreigabe verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
             } else if (err.name === 'AbortError') {
                  errorMessage = "Bildschirmfreigabe abgebrochen.";
             }
             displayError(errorMessage);

             state.screenStream = null;
             state.isSharingScreen = false;
             setupLocalAudioStream();

             updateShareScreenButtonUI();

             socket.emit('screenShareStatus', { sharing: false });

             return false;
        }
    }

    // Stoppt die Bildschirmteilung
    function stopScreenSharing(sendSignal = true) {
         console.log(`[WebRTC] stopScreenSharing aufgerufen. sendSignal: ${sendSignal}.`);
         if (!state.isSharingScreen) {
             console.warn("[WebRTC] stopScreenSharing: Bildschirm wird nicht geteilt.");
             return;
         }

         if (state.screenStream) {
             console.log(`[WebRTC] Stoppe Tracks im Bildschirmstream (${state.screenStream.id}).`);
             state.screenStream.getTracks().forEach(track => {
                  console.log(`[WebRTC] Stoppe Screen Track <span class="math-inline">\{track\.id\} \(</span>{track.kind}).`);
                  track.stop();
             });
             state.screenStream = null;
             console.log("[WebRTC] screenStream ist jetzt null.");
         } else {
              console.log("[WebRTC] stopScreenSharing: screenStream war bereits null.");
         }

         state.isSharingScreen = false;
         console.log("[WebRTC] isSharingScreen ist jetzt false.");

         setupLocalAudioStream();

         if (sendSignal && socket && state.connected) {
             socket.emit('screenShareStatus', { sharing: false });
             console.log("[Socket.IO] Sende 'screenShareStatus: false'.");
         }

          updateShareScreenButtonUI();
    }

    // Umschalten der Bildschirmteilung
    async function toggleScreenSharing() {
        console.log(`[WebRTC] toggleScreenSharing aufgerufen. Aktueller State isSharingScreen: ${state.isSharingScreen}`);
        if (!state.connected || !UI.shareScreenBtn) {
             console.warn("[WebRTC] Nicht verbunden oder Button nicht gefunden.");
             return;
        }

        UI.shareScreenBtn.disabled = true;

        if (state.isSharingScreen) {
            stopScreenSharing(true);
        } else {
            await startScreenSharing();
        }

        UI.shareScreenBtn.disabled = false;
    }

     // Aktualisiert die UI des Bildschirm teilen Buttons
     function updateShareScreenButtonUI() {
         if (UI.shareScreenBtn) {
             UI.shareScreenBtn.textContent = state.isSharingScreen ? 'Teilen beenden' : '🖥 Bildschirm teilen';
             UI.shareScreenBtn.classList.toggle('active', state.isSharingScreen);
         }
     }

    async function createPeerConnection(peerId) {
        console.log(`[WebRTC] createPeerConnection aufgerufen für Peer: ${peerId}.`);
        if (state.peerConnections.has(peerId)) {
            console.warn(`[WebRTC] PeerConnection mit ${peerId} existiert bereits.`);
            return state.peerConnections.get(peerId);
        }

        console.log(`[WebRTC] Erstelle neue RTCPeerConnection für Peer: ${peerId}`);
        const pc = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.peerConnections.set(peerId, pc);

        pc.onicecandidate = event => {
            if (event.candidate && socket && state.connected) {
                socket.emit('webRTC-signal', {
                    to: peerId,
                    type: 'candidate',
                    payload: event.candidate
                });
            } else if (!event.candidate) {
                console.log(`[WebRTC] ICE candidate gathering für Peer ${peerId} beendet.`);
            }
        };

        pc.ontrack = event => {
            console.log(`[WebRTC] Empfange remote track von Peer ${peerId}. Track Kind: ${event.track.kind}, Stream ID(s): ${event.streams ? event.streams.map(s => s.id).join(', ') : 'No Stream'}`);

             let remoteStream = state.remoteStreams.get(peerId);
             if (!remoteStream) {
                 remoteStream = new MediaStream();
                 state.remoteStreams.set(
