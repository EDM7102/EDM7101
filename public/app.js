document.addEventListener('DOMContentLoaded', () => {
    const UI = {
        // serverUrlInput und roomIdInput werden nicht mehr benötigt
        usernameInput: document.getElementById('usernameInput'),
        connectBtn: document.getElementById('connectBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        shareScreenBtn: document.getElementById('shareScreenBtn'),
        userList: document.getElementById('userList'),
        messagesContainer: document.getElementById('messagesContainer'),
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        typingIndicator: document.getElementById('typingIndicator'),
        statusIndicator: document.getElementById('statusIndicator'), // Korrigierte ID
        errorMessage: document.getElementById('errorMessage'),       // Korrigierte ID
        localVideo: document.getElementById('localVideo'),         // Korrigierte ID
        remoteVideo: document.getElementById('remoteVideo'),       // Korrigierte ID
        localScreenStatus: document.getElementById('localScreenStatus'), // Korrigierte ID
        remoteScreenStatus: document.getElementById('remoteScreenStatus'), // Korrigierte ID
        localVideoBox: document.getElementById('localVideoBox'),     // Korrigierte ID
        remoteVideoBox: document.getElementById('remoteVideoBox'),   // Korrigierte ID
        fileInput: document.getElementById('fileInput'),
        fileUploadLabel: document.getElementById('fileUploadLabel'),   // Korrigierte ID
        localVideoFullscreenBtn: document.getElementById('localVideoFullscreenBtn'),   // Korrigierte ID
        remoteVideoFullscreenBtn: document.getElementById('remoteVideoFullscreenBtn'), // Korrigierte ID
        micSelect: document.getElementById('micSelect') // Mic Select hinzugefügt, falls benötigt
    };

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room', // Fester Raumname hier gesetzt! Ändere 'default-room' nach Bedarf.
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
        notificationSound: new Audio('notif.mp3'),
        currentPCPartnerId: null // Partner-ID merken
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500, // ms
        RTC_CONFIGURATION: { // Konfiguration für STUN-Server (für NAT-Traversal)
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Für robustere Verbindungen in komplexen Netzwerken wären hier TURN-Server nötig.
            ]
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5 MB
        IMAGE_PREVIEW_MAX_WIDTH: 200,
        IMAGE_PREVIEW_MAX_HEIGHT: 200
    };

    // --- Initialisierung und UI-Helfer ---
    function initializeUI() {
        UI.disconnectBtn.classList.add('hidden'); // Standardmäßig versteckt
        UI.shareScreenBtn.classList.add('hidden'); // Standardmäßig versteckt
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        // UI.fileUploadLabel existiert jetzt und hat die ID
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        // UI.localVideoFullscreenBtn und UI.remoteVideoFullscreenBtn existieren jetzt
        if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.classList.add('hidden');
        if(UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.classList.add('hidden');
        // Mikrofon-Auswahl initial deaktivieren
        if (UI.micSelect) UI.micSelect.disabled = false; // Nur vor Verbindung änderbar
    }

    function setConnectionStatus(statusClass, text) {
        if (!UI.statusIndicator) return; // Sicherstellen, dass das Element existiert
        UI.statusIndicator.className = `status-indicator ${statusClass}`;
        UI.statusIndicator.textContent = text;
    }

    function displayError(message) {
        if (!UI.errorMessage) return; // Sicherstellen, dass das Element existiert
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
        if (UI.micSelect) UI.micSelect.disabled = true; // Mic während Verbindung nicht ändern
        setConnectionStatus('connected', `Verbunden als ${state.username}`); // Raum-ID aus Titel entfernt
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
        // UI.messagesContainer.innerHTML = ''; // Nachrichten nicht unbedingt löschen
        UI.typingIndicator.textContent = '';
        stopLocalStream();
        closePeerConnection();
        if (state.isSharingScreen) { // Reset screen sharing state
             state.isSharingScreen = false;
             UI.shareScreenBtn.textContent = 'Bildschirm teilen';
             UI.shareScreenBtn.classList.remove('danger-btn');
        }
        state.users = {};
    }

    function saveStateToLocalStorage() {
        // Speichere nur den Benutzernamen, da Server/Raum jetzt fest sind
        localStorage.setItem('chatClientUsername', UI.usernameInput.value);
    }

    function loadStateFromLocalStorage() {
        // Lade nur den Benutzernamen
        const savedUsername = localStorage.getItem('chatClientUsername');
        if (savedUsername) {
            UI.usernameInput.value = savedUsername;
        }
        // ServerUrl und RoomId werden nicht mehr aus LocalStorage geladen
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
        const maxHeight = 100; // Feste max Höhe
        if (maxHeight && newHeight > maxHeight) newHeight = maxHeight;
        UI.messageInput.style.height = newHeight + 'px';
    });
    UI.fileInput.addEventListener('change', handleFileSelect);
    // Event Listener für Fullscreen Buttons
    if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.localVideo));
    if(UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.remoteVideo));

    // Event Listener für Mic Select (optional, für spätere Verwendung)
    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        if (state.connected && !state.isSharingScreen) {
            console.log("Mikrofon geändert, initialisiere Audio neu.");
            await setupLocalMedia(); // Re-init media mit neuem Mic
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


    // --- WebSocket Logic ---
    function connect() {
        // --- START MODIFICATION ---
        // Werte fest eintragen statt aus UI lesen:
        const serverUrl = window.location.origin; // Verbindet zum selben Server, von dem die Seite geladen wurde
        const roomId = state.roomId; // Nutzt den festen Wert aus dem State ('default-room')

        let username = UI.usernameInput.value.trim(); // Benutzername bleibt Eingabe

        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username;

        state.username = username;
        // state.roomId ist bereits im State gesetzt

        console.log(`Verbinde mit ${serverUrl} in Raum ${state.roomId}`); // Log für Debugging
        // --- END MODIFICATION ---

        socket = io(serverUrl, { // Nutze die ermittelte serverUrl
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket']
        });
        setConnectionStatus('connecting', 'Verbinde...');

        // --- Socket Event Listeners ---
        socket.on('connect', () => {
            state.connected = true;
            updateUIAfterConnect();
            console.log('Verbunden mit Server, ID:', socket.id);
            // Server sollte jetzt 'joinSuccess' oder 'userListUpdate' senden
            // Kein explizites 'joinRoom' mehr hier, Server managed das bei connect mit auth
            setupLocalMedia();
        });

        socket.on('connect_error', (err) => {
            displayError(`Verbindungsfehler: ${err.message}. Läuft der Server unter ${serverUrl}?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            updateUIAfterDisconnect();
        });

        socket.on('disconnect', (reason) => {
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect(); // UI zurücksetzen
        });

        // Server sollte 'joinSuccess' senden oder direkt 'userListUpdate'
         socket.on('joinSuccess', async ({ users: currentUsers, id: myId }) => {
             console.log("Join erfolgreich. Meine ID:", myId, "Benutzer:", currentUsers);
             // state.connected und updateUIAfterConnect sollten schon in 'connect' passiert sein
             state.socketId = myId; // Eigene ID speichern, falls benötigt
             updateUserList(currentUsers); // Initialisiere User Liste

             // Initialisiere P2P nur, wenn andere User da sind
             initiateP2PConnection();
         });

         socket.on('joinError', ({ message }) => {
             displayError(message);
             if (socket) socket.disconnect(); // Trennen bei Fehler
         });

         socket.on('userListUpdate', (currentUsersList) => {
             console.log("Benutzerliste aktualisiert:", currentUsersList);
             const oldPartnerStillPresent = state.currentPCPartnerId && currentUsersList.some(u => u.id === state.currentPCPartnerId);

             // Systemnachrichten für Join/Leave (optional) -> diese Logik kann vereinfacht oder entfernt werden

             updateUserList(currentUsersList); // Aktualisiere Anzeige

             // P2P Logik anpassen
             if (!oldPartnerStillPresent && state.currentPCPartnerId) {
                  console.log("P2P Partner hat Chat verlassen. Schließe Verbindung.");
                  closePeerConnection();
             }
             // Versuche neue P2P Verbindung, wenn keine besteht oder Partner weg ist und andere da sind
             if (!state.currentPCPartnerId && currentUsersList.some(u => u.id !== socket?.id)) {
                 initiateP2PConnection();
             }
         });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            notifyUnreadMessage();
        });
         socket.on('file', (fileMsgData) => { // Datei-Event vom Server (aus server.js)
             appendMessage({ ...fileMsgData, type: 'file' });
             if (fileMsgData.username !== state.username && state.isConnected && document.hidden === false) notifyUnreadMessage();
         });


        socket.on('typing', ({ username, isTyping }) => {
            if (username === state.username) return; // Eigene Tipp-Anzeige ignorieren
            const typingUsernames = state.typingUsers || (state.typingUsers = new Set()); // Sicherstellen, dass Set existiert
            if (isTyping) {
                typingUsernames.add(username);
            } else {
                typingUsernames.delete(username);
            }
            updateTypingIndicatorDisplay(); // Funktion zum Anzeigen aufrufen
        });


        // WebRTC Signaling Listener bleiben gleich...
         socket.on('webRTC-offer', async ({ from, offer }) => {
            console.log('Angebot erhalten von:', from);
             if (state.peerConnection) {
                console.warn("Bestehende PeerConnection beim Empfangen eines neuen Angebots.");
                // Ggf. alte schließen oder Logik für Re-Negotiation verbessern
                closePeerConnection();
            }
            await createPeerConnection(from);
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            if(!state.localStream) await setupLocalMedia(); // Stelle sicher, dass lokale Medien bereit sind
            const answer = await state.peerConnection.createAnswer();
            await state.peerConnection.setLocalDescription(answer);
            socket.emit('webRTC-answer', { to: from, answer: state.peerConnection.localDescription });
            console.log('Antwort gesendet an:', from);
        });

        socket.on('webRTC-answer', async ({ from, answer }) => {
            console.log('Antwort erhalten von:', from);
            if (state.peerConnection && state.peerConnection.signalingState !== "stable") {
                 await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } else {
                console.warn("Antwort erhalten, aber PeerConnection nicht im erwarteten Zustand.");
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            // console.log('ICE Kandidat erhalten von:', from);
            if (state.peerConnection && state.peerConnection.remoteDescription) { // Kandidaten erst nach setRemoteDescription hinzufügen
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Fehler beim Hinzufügen des ICE Kandidaten:', e);
                }
            } else {
                 console.warn("ICE Kandidat erhalten, aber PeerConnection nicht bereit.");
            }
        });
    } // Ende der connect Funktion


    function disconnect() {
        if (socket) {
            socket.disconnect(); // Löst den 'disconnect' Event Listener aus
        } else {
             updateUIAfterDisconnect(); // Falls Socket nie erstellt wurde
        }
    }

    // --- Chat Logic ---
    function sendMessage() {
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) return;
        if (!socket || !state.connected) return;

        const messageBase = {
            // username und color werden vom Server hinzugefügt
            content: content,
            timestamp: new Date().toISOString(),
        };

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
                    message.file.dataUrl = e.target.result; // Base64 für Vorschau
                    socket.emit('file', message); // An Server senden
                    resetFileInput();
                };
                reader.readAsDataURL(state.selectedFile);
            } else { // Nur Metadaten für andere Dateien senden
                socket.emit('file', message);
                resetFileInput();
            }
        } else {
            const message = { ...messageBase, type: 'text' };
            socket.emit('message', message); // An Server senden
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false);
    }

    function appendMessage(msg) { // Wird vom Server-Broadcast aufgerufen
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.username === state.username;
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username);
        // Farbe aus msg.color verwenden, die der Server mitsendet
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.username));

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');

        if (msg.type === 'file' && msg.file) {
             const fileInfo = document.createElement('div');
             fileInfo.classList.add('file-attachment');
             if (msg.file.dataUrl && msg.file.type.startsWith('image/')) {
                 const img = document.createElement('img');
                 img.src = msg.file.dataUrl; // Direkt Base64 verwenden
                 img.alt = escapeHTML(msg.file.name);
                 img.style.maxWidth = `${CONFIG.IMAGE_PREVIEW_MAX_WIDTH}px`;
                 img.style.maxHeight = `${CONFIG.IMAGE_PREVIEW_MAX_HEIGHT}px`;
                 img.onclick = () => openImageModal(img.src);
                 fileInfo.appendChild(img);
             } else {
                 fileInfo.innerHTML += `<span style="font-size: 1.5em;">📄</span>`; // Datei-Icon
             }
             const linkText = `${escapeHTML(msg.file.name)} (${formatFileSize(msg.file.size)})`;
             if (msg.file.dataUrl) { // Download-Link für Bilder
                 fileInfo.innerHTML += ` <a href="${msg.file.dataUrl}" download="${escapeHTML(msg.file.name)}">${linkText}</a>`;
             } else {
                 fileInfo.innerHTML += ` <span>${linkText} (Kein direkter Download)</span>`;
             }
              if (msg.content) { // Text mit Datei anzeigen
                 const textNode = document.createElement('p');
                 textNode.textContent = escapeHTML(msg.content);
                 fileInfo.appendChild(textNode);
             }
             contentDiv.appendChild(fileInfo);

        } else { // Normale Textnachricht
            contentDiv.textContent = escapeHTML(msg.content || ''); // Sicherstellen, dass content existiert
        }

        const timeSpan = document.createElement('span');
        timeSpan.classList.add('timestamp');
        timeSpan.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);
        msgDiv.appendChild(timeSpan);
        UI.messagesContainer.appendChild(msgDiv);

        // Scroll logic
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 10; // Toleranz erhöht
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
        msgDiv.classList.add('message', 'system'); // Eigene Klasse für Systemnachrichten
        msgDiv.textContent = escapeHTML(text);
        UI.messagesContainer.appendChild(msgDiv);
        UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
    }

    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) return;
        clearTimeout(state.typingTimeout);
        socket.emit('typing', { isTyping }); // Server kennt Absender
        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
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


    function updateUserList(usersArray) { // Nimmt Array vom Server entgegen
        state.allUsersList = usersArray; // Speichere die komplette Liste (inkl. Self)
        UI.userList.innerHTML = '';
        const userCountElement = document.getElementById('userCountPlaceholder');
        if(userCountElement) userCountElement.textContent = usersArray.length;

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

    function getUserColor(userIdOrName) { // Konsistente Farbe basierend auf ID/Name
        let hash = 0;
        const str = String(userIdOrName); // Sicherstellen, dass es ein String ist
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.USER_COLORS[Math.abs(hash) % CONFIG.USER_COLORS.length];
    }

    // --- WebRTC Logic ---
    async function setupLocalMedia() {
        if (state.localStream) { // Stoppe alten Stream, bevor neuer geholt wird
            state.localStream.getTracks().forEach(track => track.stop());
        }
        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                 video: { width: { ideal: 640 }, height: { ideal: 480 } }, // Kleinere Auflösung für Performance
                 audio: { echoCancellation: true, noiseSuppression: true }
             });
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.classList.remove('hidden');

            // Füge Tracks zur bestehenden PeerConnection hinzu, falls vorhanden
            if (state.peerConnection) {
                state.localStream.getTracks().forEach(track => {
                    const sender = state.peerConnection.getSenders().find(s => s.track?.kind === track.kind);
                    if (sender) {
                        sender.replaceTrack(track).catch(e => console.error("Fehler beim Ersetzen des Tracks:", e));
                    } else {
                         try { state.peerConnection.addTrack(track, state.localStream); } catch(e) {console.warn("Fehler beim Hinzufügen des Tracks", e)}
                    }
                });
                 // Nach dem Hinzufügen von Tracks könnte eine Neuverhandlung nötig sein
                 // renegotiateIfNeeded(); // (Vorsicht mit automatischen Triggern)
            }
            return true; // Erfolg
        } catch (err) {
            console.error('Fehler beim Zugriff auf lokale Medien:', err);
            displayError('Zugriff auf Kamera/Mikrofon fehlgeschlagen. Berechtigungen prüfen.');
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
            return false; // Misserfolg
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
            // Screen sharing UI wird in toggleScreenSharing zurückgesetzt
        }
    }

    async function createPeerConnection(peerId) {
        if (state.peerConnection) closePeerConnection();

        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.currentPCPartnerId = peerId; // Partner merken
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
                 // Manchmal wird track ohne stream geliefert, baue stream manuell
                 if (!state.remoteStream) state.remoteStream = new MediaStream();
                 state.remoteStream.addTrack(event.track);
                 updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream);
            }
        };

        state.peerConnection.oniceconnectionstatechange = () => {
             if (!state.peerConnection) return;
             console.log("ICE Connection Status:", state.peerConnection.iceConnectionState);
             const partnerUsername = state.allUsersList.find(u => u.id === state.currentPCPartnerId)?.username || 'Peer';
             switch(state.peerConnection.iceConnectionState) {
                 case "checking":
                     UI.remoteScreenStatus.textContent = "VERBINDE...";
                     UI.remoteScreenStatus.className = 'screen-status-label loading';
                     UI.remoteScreenStatus.classList.remove('hidden');
                     UI.remoteVideo.classList.add('hidden');
                     break;
                 case "connected": // Fall through
                 case "completed":
                     // UI wird durch ontrack aktualisiert
                     setConnectionStatus('connected', `Video verbunden mit ${partnerUsername}`);
                     break;
                 case "disconnected":
                 case "failed":
                 case "closed":
                     displayError(`Video-Verbindung zu ${partnerUsername} ${state.peerConnection.iceConnectionState}.`);
                     closePeerConnection();
                     // Versuche ggf. neu zu verbinden
                     initiateP2PConnection();
                     break;
             }
         };

         state.peerConnection.onnegotiationneeded = async () => {
             console.log("Neuverhandlung benötigt.");
             // Implementiere Logik, um Offer-Loops zu vermeiden (z.B. Rollenbasierte Initiierung)
             // Hier nur einfaches Logging oder manueller Trigger
             // await renegotiateIfNeeded(); // Vorsicht mit automatischem Aufruf
         };

        // Lokale Tracks hinzufügen
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => {
                try { state.peerConnection.addTrack(track, state.localStream); } catch(e){}
            });
        }
        if (state.isSharingScreen && state.screenStream) {
             state.screenStream.getTracks().forEach(track => {
                 try { state.peerConnection.addTrack(track, state.screenStream); } catch(e){}
             });
         }
         return state.peerConnection;
    }

     async function renegotiateIfNeeded() { // Aufruf nach Track Änderungen
         if (!state.peerConnection || !state.currentPCPartnerId || state.peerConnection.signalingState !== 'stable') {
             console.log("Überspringe Neuverhandlung (Bedingungen nicht erfüllt)");
             return;
         }
         console.log("Neuverhandlung wird initiiert...");
         try {
             const offer = await state.peerConnection.createOffer();
             await state.peerConnection.setLocalDescription(offer);
             socket.emit('webRTC-offer', { to: state.currentPCPartnerId, offer: state.peerConnection.localDescription });
             console.log('Neuverhandlungs-Angebot gesendet an:', state.currentPCPartnerId);
         } catch (err) {
             console.error('Fehler bei Neuverhandlung:', err);
         }
     }

    function closePeerConnection() {
        if (state.peerConnection) {
            console.log("Schließe PeerConnection mit:", state.currentPCPartnerId);
            state.peerConnection.close(); // Triggert auch oniceconnectionstatechange zu 'closed'
            state.peerConnection = null;
        }
        state.currentPCPartnerId = null;
        state.remoteStream = null;
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null);
    }

     function initiateP2PConnection() { // Wird aufgerufen bei connect/userlistUpdate
         if (!state.isConnected || !socket) return;

         const otherUsers = state.allUsersList.filter(u => u.id !== socket.id);
         if (otherUsers.length === 0) { // Keine anderen User da
             if(state.peerConnection) closePeerConnection();
             return;
         }

         // Wenn schon verbunden und Partner noch da ist -> nichts tun
         if (state.currentPCPartnerId && otherUsers.some(u => u.id === state.currentPCPartnerId)) {
             return;
         }

         // Wenn Verbindung weg oder Partner weg -> neue aufbauen
         if (state.peerConnection) closePeerConnection();

         // Logik zur Auswahl des Partners (hier: der erste Andere)
         // Eine bessere Logik könnte IDs vergleichen, um nur einen Initiator zu haben
         const targetUser = otherUsers[0];
         const shouldInitiate = true; // Vereinfacht: Wir initiieren immer, wenn wir verbinden/Partner weg ist
                                      // Besser: Logik basierend auf IDs (z.B. ID A < ID B -> A initiiert)

         if (shouldInitiate) {
             console.log("Initiiere P2P mit:", targetUser.username);
             // Stelle sicher, dass Medien bereit sind, BEVOR createOffer gerufen wird
             setupLocalMedia().then(success => {
                 if (success) {
                     createPeerConnection(targetUser.id).then(() => {
                         renegotiateIfNeeded(); // Jetzt Offer senden
                     });
                 } else {
                     displayError("Lokale Medien nicht verfügbar, Anruf kann nicht initiiert werden.");
                 }
             });
         }
     }


    async function toggleScreenSharing() {
        if (!state.connected) return;
        UI.shareScreenBtn.disabled = true; // Button deaktivieren während Umschaltung

        if (state.isSharingScreen) {
            // --- Stoppe Screensharing ---
             if (state.screenStream) {
                 state.screenStream.getTracks().forEach(track => track.stop());
             }
             state.screenStream = null;
             state.isSharingScreen = false;
             UI.shareScreenBtn.textContent = 'Bildschirm teilen';
             UI.shareScreenBtn.classList.remove('danger-btn');

             // Entferne Screen-Tracks von PeerConnection
             if (state.peerConnection) {
                 state.peerConnection.getSenders().forEach(sender => {
                      if (sender.track && sender.track.getSettings && sender.track.getSettings().displaySurface) { // Prüfe ob es ein Screen Track ist
                          state.peerConnection.removeTrack(sender).catch(e => console.warn("Fehler beim Entfernen des Screen-Tracks:", e));
                      }
                 });
             }

             // Stelle Kamera wieder her (falls Stream existiert)
             if (state.localStream) {
                  updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
                  // Füge Kamera-Tracks wieder zur PeerConnection hinzu (falls entfernt)
                 if (state.peerConnection) {
                     state.localStream.getTracks().forEach(track => {
                         if (!state.peerConnection.getSenders().find(s => s.track === track)) {
                              try { state.peerConnection.addTrack(track, state.localStream); } catch(e) {}
                         }
                     });
                     await renegotiateIfNeeded(); // Neu verhandeln
                 }
             } else {
                 // Falls kein Kamera-Stream existierte, initialisiere nur Audio neu
                 await setupLocalMedia(); // Dies holt Kamera+Audio, wenn möglich
             }

        } else {
            // --- Starte Screensharing ---
            try {
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');
                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true); // Zeige Screen lokal an

                if (state.peerConnection) {
                    // Ersetze Video-Track durch Screen-Track
                    const screenVideoTrack = state.screenStream.getVideoTracks()[0];
                    const screenAudioTrack = state.screenStream.getAudioTracks()[0]; // Optional: System-Audio

                    const videoSender = state.peerConnection.getSenders().find(s => s.track?.kind === 'video');
                    if (videoSender && screenVideoTrack) {
                         videoSender.replaceTrack(screenVideoTrack).catch(e => console.error("Fehler beim Ersetzen Video-Track:", e));
                    } else if (screenVideoTrack) {
                         try { state.peerConnection.addTrack(screenVideoTrack, state.screenStream); } catch(e){}
                    }
                    // Optional: Umgang mit Screen-Audio (ersetzt Mikrofon? Zusätzlicher Track?)
                    // Hier ersetzen wir einfachheitshalber den bestehenden Audio-Track, falls Screen-Audio da ist
                    if (screenAudioTrack) {
                        const audioSender = state.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
                        if (audioSender) {
                             audioSender.replaceTrack(screenAudioTrack).catch(e => console.error("Fehler beim Ersetzen Audio-Track:", e));
                        } else {
                             try { state.peerConnection.addTrack(screenAudioTrack, state.screenStream); } catch(e){}
                        }
                    }
                    await renegotiateIfNeeded(); // Neu verhandeln nach Track-Änderung
                }

                // Listener für "Stop sharing" Button im Browser
                state.screenStream.getVideoTracks()[0].onended = () => {
                    if (state.isSharingScreen) toggleScreenSharing(); // Ruft diese Funktion erneut auf zum Stoppen
                };

            } catch (err) {
                console.error('Fehler beim Starten der Bildschirmfreigabe:', err);
                displayError('Bildschirmfreigabe fehlgeschlagen.');
                state.isSharingScreen = false;
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                 UI.shareScreenBtn.classList.remove('danger-btn');
                 // Ggf. Kamera wiederherstellen
                 if (state.localStream) updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            }
        }
        UI.shareScreenBtn.disabled = false; // Button wieder aktivieren
    }

    function toggleFullscreen(videoElement) {
        if (!videoElement) return;
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
        if(UI.fileInput) UI.fileInput.value = ''; // Reset file input
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
    populateMicList(); // Mikrofone schon beim Laden suchen
});
