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
        roomId: 'default-room', // Fester Raumname! Ändere 'default-room' bei Bedarf.
        socketId: null, // Eigene Socket ID
        users: {}, 
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        screenStream: null,
        isSharingScreen: false,
        selectedFile: null,
        typingTimeout: null,
        typingUsers: new Set(),
        lastMessageTimestamp: 0,
        isWindowFocused: true,
        unreadMessages: 0,
        originalTitle: document.title,
        notificationSound: null, // Wird später initialisiert
        currentPCPartnerId: null,
        allUsersList: [] 
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500,
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ]
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
        MAX_FILE_SIZE: 5 * 1024 * 1024, 
        IMAGE_PREVIEW_MAX_WIDTH: 200,
        IMAGE_PREVIEW_MAX_HEIGHT: 200
    };

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
        
        // Notification Sound initialisieren, nachdem der Benutzer interagiert hat (z.B. beim Verbinden)
        // oder hier, wenn es ohne direkte Interaktion erlaubt ist (kann blockiert werden)
        try {
            state.notificationSound = new Audio('notif.mp3'); // Pfad zur notif.mp3 muss stimmen
        } catch (e) {
            console.warn("Audio Context für Benachrichtigungston konnte nicht erstellt werden:", e);
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

    function updateUIAfterConnect() {
        UI.connectBtn.classList.add('hidden');
        UI.disconnectBtn.classList.remove('hidden');
        UI.shareScreenBtn.classList.remove('hidden');
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        if(UI.fileUploadLabel) UI.fileUploadLabel.classList.remove('hidden');
        if(UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true; // Mic-Auswahl sperren nach Verbindung
        setConnectionStatus('connected', `Verbunden als ${state.username} (ID: ${state.socketId})`);
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
        if (UI.micSelect) UI.micSelect.disabled = false; // Mic-Auswahl wieder freigeben
        setConnectionStatus('disconnected', 'Nicht verbunden');
        if (UI.userList) UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = '0';
        if (UI.typingIndicator) UI.typingIndicator.textContent = '';
        
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
        state.currentPCPartnerId = null;
    }

    function saveStateToLocalStorage() {
        if (UI.usernameInput && UI.usernameInput.value) {
            localStorage.setItem('chatClientUsername', UI.usernameInput.value);
        }
    }

    function loadStateFromLocalStorage() {
        const savedUsername = localStorage.getItem('chatClientUsername');
        if (savedUsername && UI.usernameInput) {
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
            if (state.notificationSound) {
                state.notificationSound.play().catch(e => console.warn("Benachrichtigungston blockiert:", e));
            }
        }
    }

    // --- Event Listener ---
    if (UI.connectBtn) UI.connectBtn.addEventListener('click', connect);
    if (UI.disconnectBtn) UI.disconnectBtn.addEventListener('click', disconnect);
    if (UI.shareScreenBtn) UI.shareScreenBtn.addEventListener('click', toggleScreenSharing);
    if (UI.sendBtn) UI.sendBtn.addEventListener('click', sendMessage);
    
    if (UI.messageInput) {
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
            const maxHeight = 100; // Max Höhe für Textarea
            if (maxHeight && newHeight > maxHeight) newHeight = maxHeight;
            UI.messageInput.style.height = newHeight + 'px';
        });
    }
    
    if (UI.fileInput) UI.fileInput.addEventListener('change', handleFileSelect);
    if(UI.localVideoFullscreenBtn) UI.localVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.localVideo));
    if(UI.remoteVideoFullscreenBtn) UI.remoteVideoFullscreenBtn.addEventListener('click', () => toggleFullscreen(UI.remoteVideo));
    
    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        if (state.connected && state.localStream && !state.isSharingScreen) { // Nur wenn Kamera-Stream aktiv ist
            console.log("Mikrofon geändert, initialisiere lokalen Stream neu.");
            await setupLocalMedia(true); // true, um nur Audio neu zu initialisieren wenn Video schon läuft
        } else if (state.connected && !state.localStream) {
            await setupLocalMedia(false); // Wenn noch kein Stream da ist, komplett neu
        }
    });
     
    window.addEventListener('beforeunload', () => {
        if (socket && socket.connected) {
            disconnect(); // Sauberes Trennen
        }
    });

    document.addEventListener('fullscreenchange', () => {
        [
            { btn: UI.localVideoFullscreenBtn, video: UI.localVideo },
            { btn: UI.remoteVideoFullscreenBtn, video: UI.remoteVideo }
        ].forEach(item => {
            if(item.btn && item.video) { // Prüfen ob Elemente existieren
                item.btn.textContent = (document.fullscreenElement === item.video) ? "Vollbild verlassen" : "Vollbild";
            }
        });
    });

    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, m => map[m]);
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function getUserColor(userIdOrName) { // Fallback, falls Server keine Farbe sendet
        let hash = 0;
        const str = String(userIdOrName);
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.USER_COLORS[Math.abs(hash) % CONFIG.USER_COLORS.length];
    }

    async function populateMicList() {
        if (!UI.micSelect) return;
        UI.micSelect.innerHTML = ''; // Vorherige Einträge löschen
        try {
            // Test-getUserMedia, um Berechtigungen anzufordern, bevor enumerateDevices aufgerufen wird (verbessert Label-Verfügbarkeit)
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
            console.error("Fehler beim Auflisten der Mikrofone:", e);
            UI.micSelect.appendChild(new Option("Mikrofonzugriffsfehler", ""));
            // displayError('Mikrofonzugriff verweigert oder fehlgeschlagen.'); // Wird oft schon von setupLocalMedia behandelt
        }
    }
    
    function updateVideoDisplay(videoElement, statusElement, stream, isLocal = false) {
        if (!videoElement || !statusElement) {
            console.warn("updateVideoDisplay: Video- oder Status-Element fehlt.");
            return;
        }

        const fullscreenBtn = isLocal ? UI.localVideoFullscreenBtn : UI.remoteVideoFullscreenBtn;

        if (stream && stream.active) {
            videoElement.srcObject = stream;
            const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
            const hasAudio = stream.getAudioTracks().some(t => t.enabled && t.readyState === 'live');

            if (hasVideo) {
                 videoElement.play().catch(e => console.warn(`Videowiedergabe (${isLocal ? 'lokal':'remote'}) fehlgeschlagen:`, e));
                 videoElement.classList.remove('hidden');
                 statusElement.classList.add('hidden');
                 if (fullscreenBtn) fullscreenBtn.classList.remove('hidden');
            } else { 
                videoElement.classList.add('hidden');
                if (fullscreenBtn) fullscreenBtn.classList.add('hidden');
                statusElement.textContent = isLocal ? 
                    (hasAudio ? "DEIN AUDIO AKTIV" : "KAMERA & AUDIO AUS") : 
                    (hasAudio ? "REMOTE AUDIO AKTIV" : "KEIN VIDEO/AUDIO");
                statusElement.className = hasAudio ? 'screen-status-label loading' : 'screen-status-label offline';
                statusElement.classList.remove('hidden');
            }
        } else {
            if (videoElement.srcObject) {
                 videoElement.srcObject.getTracks().forEach(track => track.stop());
            }
            videoElement.srcObject = null;
            videoElement.classList.add('hidden');
            statusElement.textContent = isLocal ? "KAMERA AUS / FEHLER" : "KEIN VIDEO/AUDIO";
            statusElement.className = 'screen-status-label offline';
            statusElement.classList.remove('hidden');
            if (fullscreenBtn) fullscreenBtn.classList.add('hidden');
        }
    }

    function updateUserList(usersArray) {
        if (!UI.userList) return;
        state.allUsersList = usersArray; 
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if(userCountPlaceholder) userCountPlaceholder.textContent = usersArray.length;

        usersArray.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            // Verwende die vom Server gesendete Farbe, oder generiere eine als Fallback
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id)); 
            li.appendChild(dot);
            
            let userNameText = escapeHTML(user.username);
            if (user.id === state.socketId) {
                 userNameText += " (Du)";
                 const strong = document.createElement('strong');
                 strong.textContent = userNameText;
                 li.appendChild(strong);
            } else {
                li.appendChild(document.createTextNode(userNameText));
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

    function connect() {
        const serverUrl = window.location.origin; 
        const roomId = state.roomId;
        let username = UI.usernameInput.value.trim();

        if (!username) {
            username = `User${Math.floor(Math.random() * 10000)}`;
            UI.usernameInput.value = username; // Setze generierten Namen ins Feld
        }
        state.username = username;

        console.log(`Versuche zu verbinden mit ${serverUrl}, Raum: ${state.roomId}, Benutzer: ${state.username}`);
        setConnectionStatus('connecting', 'Verbinde...');

        // Alte Socket-Instanz schließen, falls vorhanden und verbunden
        if (socket && socket.connected) {
            socket.disconnect();
        }
        
        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket'] // Bevorzuge WebSockets
        });
        setupSocketListeners();
    }

    function setupSocketListeners() {
        if (!socket) return;

        socket.on('connect', async () => {
            state.connected = true;
            state.socketId = socket.id; // Socket ID speichern
            console.log('Erfolgreich mit Server verbunden. Eigene Socket ID:', state.socketId);
            updateUIAfterConnect();
            // Lokale Medien erst nach erfolgreichem 'joinSuccess' starten oder wenn Userliste kommt
            // um sicherzustellen, dass die UI bereit ist und die User-ID bekannt ist.
            // Stattdessen hier:
            await populateMicList(); // Mikrofonliste jetzt füllen, da Interaktion erfolgt ist
            await setupLocalMedia(false); // Kamera/Mikrofon initial starten
        });

        socket.on('connect_error', (err) => {
            console.error('Verbindungsfehler:', err);
            displayError(`Verbindungsfehler: ${err.message}. Ist der Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            updateUIAfterDisconnect(); // UI zurücksetzen
        });

        socket.on('disconnect', (reason) => {
            console.log(`Verbindung zum Server getrennt. Grund: ${reason}`);
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect();
        });
        
        socket.on('joinSuccess', ({ users: currentUsersInRoom, id }) => {
             console.log(`Server Bestätigung: 'joinSuccess'. Eigene ID ${id}. Benutzer im Raum:`, currentUsersInRoom);
             if(id !== state.socketId) { // Sollte nicht passieren wenn server.js korrekt socket.id verwendet
                console.warn(`Vom Server empfangene ID (${id}) stimmt nicht mit Socket ID (${state.socketId}) überein!`);
             }
             updateUserList(currentUsersInRoom);
             // P2P-Verbindung initiieren, nachdem man erfolgreich dem Raum beigetreten ist
             // und die erste Benutzerliste hat.
             initiateP2PConnection();
         });

         socket.on('joinError', ({ message }) => { // Serverseitiger Join-Fehler
             displayError(`Fehler beim Betreten des Raums: ${message}`);
             if (socket) socket.disconnect(); // Verbindung trennen, da Join nicht erfolgreich
         });

         socket.on('userListUpdate', (updatedUsersList) => {
             console.log("Benutzerliste vom Server aktualisiert:", updatedUsersList);
             const oldPartnerId = state.currentPCPartnerId;
             updateUserList(updatedUsersList);

             const partnerStillExists = state.currentPCPartnerId && updatedUsersList.some(u => u.id === state.currentPCPartnerId);

             if (oldPartnerId && !partnerStillExists) {
                  console.log(`P2P Partner (ID: ${oldPartnerId}) hat den Raum verlassen.`);
                  closePeerConnection(); // Bestehende P2P Verbindung schließen
                  // Versuche, eine neue P2P-Verbindung zu einem anderen Benutzer aufzubauen
                  initiateP2PConnection(); 
             } else if (!state.currentPCPartnerId && updatedUsersList.some(u => u.id !== state.socketId)) {
                 // Wenn keine P2P-Verbindung besteht und andere Benutzer da sind
                 console.log("Kein P2P Partner, versuche neue Verbindung.");
                 initiateP2PConnection();
             }
         });

        // HIER IST DIE WICHTIGSTE ÄNDERUNG FÜR DEN CHAT: 'chatMessage' -> 'message'
        socket.on('message', (message) => { 
            appendMessage(message); // Annahme: message = { content, timestamp, username, color }
            if (message.username !== state.username) { // Nur für Nachrichten von anderen
                notifyUnreadMessage();
            }
        });

        socket.on('file', (fileMsgData) => {
             appendMessage({ ...fileMsgData, type: 'file' }); // type: 'file' hinzufügen für appendMessage
             if (fileMsgData.username !== state.username) {
                 notifyUnreadMessage();
             }
        });

        socket.on('typing', ({ username, isTyping }) => {
            if (username === state.username) return; // Nicht auf eigene Tipp-Events reagieren
            if (isTyping) {
                state.typingUsers.add(username);
            } else {
                state.typingUsers.delete(username);
            }
            updateTypingIndicatorDisplay();
        });

        // WebRTC Signalisierung
        socket.on('webRTC-offer', async ({ from, offer }) => {
            console.log(`[WebRTC] Angebot erhalten von: ${from}. Current PC Partner: ${state.currentPCPartnerId}`);
            if (state.peerConnection && from !== state.currentPCPartnerId) {
                console.warn(`[WebRTC] Angebot von ${from}, aber bereits mit ${state.currentPCPartnerId} verbunden/verbindend. Ignoriere.`);
                // Optional: Sende "busy" Signal zurück
                return;
            }
            if (state.peerConnection && from === state.currentPCPartnerId && state.peerConnection.signalingState !== "stable") {
                console.warn(`[WebRTC] Neues Angebot von ${from}, aber Signalisierungsstatus ist ${state.peerConnection.signalingState}. Vorsicht vor Race Conditions.`);
                // Evtl. bestehende PC schließen und neu aufbauen oder Offer ignorieren/neu aushandeln.
                // Fürs Erste: Akzeptieren und hoffen, dass es sich stabilisiert.
            }

            await createPeerConnection(from); // Stellt sicher, dass eine PC für 'from' existiert oder neu erstellt wird
            console.log(`[WebRTC] Remote Description (Offer) von ${from} wird gesetzt.`);
            await state.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            
            if(!state.localStream) {
                console.log("[WebRTC] Kein lokaler Stream beim Erstellen der Antwort. Versuche, ihn zu erstellen.");
                await setupLocalMedia(false);
            }
            if (!state.localStream) {
                console.error("[WebRTC] Kann keine Antwort erstellen, da lokaler Stream fehlt!");
                return; // Ohne lokalen Stream keine Tracks für die Antwort
            }

            console.log(`[WebRTC] Erstelle Antwort für ${from}.`);
            const answer = await state.peerConnection.createAnswer();
            console.log(`[WebRTC] Lokale Description (Answer) für ${from} wird gesetzt.`);
            await state.peerConnection.setLocalDescription(answer);
            
            console.log(`[WebRTC] Sende Antwort an ${from}.`);
            socket.emit('webRTC-answer', { to: from, answer: state.peerConnection.localDescription });
        });

        socket.on('webRTC-answer', async ({ from, answer }) => {
            console.log(`[WebRTC] Antwort erhalten von: ${from}. Erwarteter Partner: ${state.currentPCPartnerId}`);
            if (!state.peerConnection || from !== state.currentPCPartnerId) {
                console.warn(`[WebRTC] Antwort von ${from} erhalten, aber keine passende PeerConnection oder falscher Partner. Ignoriere.`);
                return;
            }
            if (state.peerConnection.signalingState === "have-local-offer") {
                console.log(`[WebRTC] Remote Description (Answer) von ${from} wird gesetzt.`);
                await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } else {
                console.warn(`[WebRTC] Antwort von ${from} erhalten, aber PeerConnection nicht im Zustand 'have-local-offer' (ist ${state.peerConnection.signalingState}).`);
            }
        });

        socket.on('webRTC-ice-candidate', async ({ from, candidate }) => {
            console.log(`[WebRTC] ICE Kandidat erhalten von: ${from}. Erwarteter Partner: ${state.currentPCPartnerId}`);
            if (!state.peerConnection || from !== state.currentPCPartnerId) {
                console.warn(`[WebRTC] ICE Kandidat von ${from} erhalten, aber keine passende PeerConnection oder falscher Partner. Ignoriere.`);
                return;
            }

            if (candidate && state.peerConnection.remoteDescription) { // Nur hinzufügen, wenn remoteDescription gesetzt ist
                try {
                    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`[WebRTC] ICE Kandidat von ${from} hinzugefügt.`);
                } catch (e) {
                    console.error('[WebRTC] Fehler beim Hinzufügen des empfangenen ICE Kandidaten:', e);
                }
            } else if (!candidate) {
                console.log(`[WebRTC] Null-ICE Kandidat von ${from} erhalten (Ende der Kandidaten).`);
            } else if (!state.peerConnection.remoteDescription) {
                 console.warn(`[WebRTC] ICE Kandidat von ${from} erhalten, aber remoteDescription ist noch nicht gesetzt. Kandidat wird möglicherweise ignoriert oder später hinzugefügt.`);
                 // Man könnte Kandidaten puffern, wenn das oft passiert.
            }
        });
    }

    function disconnect() {
        console.log("Client initiiert Disconnect.");
        if (socket) {
            socket.disconnect();
        }
        // updateUIAfterDisconnect() wird durch das 'disconnect' Event des Sockets getriggert.
    }

    function sendMessage() {
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) {
            console.log("Kein Inhalt und keine Datei zum Senden.");
            return;
        }
        if (!socket || !state.connected) {
            displayError("Nicht mit dem Server verbunden. Senden fehlgeschlagen.");
            return;
        }

        const messageBase = { content, timestamp: new Date().toISOString() };

        if (state.selectedFile) {
            const fileMessage = {
                ...messageBase,
                // type: 'file', // Server fügt keinen Typ hinzu, appendMessage braucht es
                file: {
                    name: state.selectedFile.name,
                    type: state.selectedFile.type,
                    size: state.selectedFile.size
                }
            };
            if (state.selectedFile.type.startsWith('image/') && state.selectedFile.size <= CONFIG.MAX_FILE_SIZE) { // Größenprüfung hier erneut für DataURL
                const reader = new FileReader();
                reader.onload = (e) => {
                    fileMessage.file.dataUrl = e.target.result; // Bildvorschau als DataURL
                    socket.emit('file', fileMessage);
                    console.log("Datei (mit Vorschau) gesendet:", fileMessage.file.name);
                };
                reader.onerror = (e) => {
                    console.error("Fehler beim Lesen der Datei für Vorschau:", e);
                    displayError("Fehler beim Vorbereiten der Dateivorschau.");
                    // Sende ohne Vorschau oder breche ab
                    delete fileMessage.file.dataUrl; // Stelle sicher, dass keine korrupte DataURL gesendet wird
                    socket.emit('file', fileMessage); // Sende trotzdem, aber ohne Vorschau
                     console.log("Datei (ohne Vorschau nach Fehler) gesendet:", fileMessage.file.name);
                }
                reader.readAsDataURL(state.selectedFile);
            } else {
                socket.emit('file', fileMessage); // Sende Datei-Info (ohne DataURL für Nicht-Bilder oder zu große Bilder)
                console.log("Datei (Info) gesendet:", fileMessage.file.name);
            }
            // Eigene Nachricht direkt anzeigen (optional, da Server-Echo es auch tut)
            // appendMessage({ ...fileMessage, username: state.username, color: getUserColor(state.username), type: 'file'});
            resetFileInput();
        } else {
            const textMessage = { ...messageBase }; // Kein 'type' nötig, da Server 'message' als Text interpretiert
            socket.emit('message', textMessage); // Event-Name ist 'message'
            console.log("Textnachricht gesendet:", textMessage.content);
            // Eigene Nachricht direkt anzeigen (optional, da Server-Echo es auch tut)
            // appendMessage({ ...textMessage, username: state.username, color: getUserColor(state.username) });
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto'; // Höhe zurücksetzen
        UI.messageInput.focus();
        sendTyping(false); // Tipp-Status zurücksetzen
    }

    function appendMessage(msg) {
        if (!UI.messagesContainer) return;

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message-entry'); // Geänderte Klasse für bessere Strukturierung
        const isMe = msg.username === state.username;
        if (isMe) msgDiv.classList.add('me');

        const headerDiv = document.createElement('div');
        headerDiv.classList.add('message-header');
        
        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username) + (isMe ? "" : ""); // "(Du)" wird schon in updateUserList gesetzt
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.username));
        headerDiv.appendChild(nameSpan);

        const timeSpan = document.createElement('span');
        timeSpan.classList.add('timestamp');
        timeSpan.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        headerDiv.appendChild(timeSpan);
        
        msgDiv.appendChild(headerDiv);

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');

        if (msg.type === 'file' && msg.file) { // Explizit auf msg.type === 'file' prüfen
             const fileInfoDiv = document.createElement('div');
             fileInfoDiv.classList.add('file-attachment');
             
             if (msg.file.dataUrl && msg.file.type && msg.file.type.startsWith('image/')) {
                 const img = document.createElement('img');
                 img.src = msg.file.dataUrl;
                 img.alt = escapeHTML(msg.file.name);
                 img.style.maxWidth = `${CONFIG.IMAGE_PREVIEW_MAX_WIDTH}px`;
                 img.style.maxHeight = `${CONFIG.IMAGE_PREVIEW_MAX_HEIGHT}px`;
                 img.style.cursor = 'pointer';
                 img.onclick = () => openImageModal(img.src);
                 fileInfoDiv.appendChild(img);
             } else {
                 // Icon für andere Dateitypen
                 const fileIcon = document.createElement('span');
                 fileIcon.className = 'file-icon'; // CSS für dieses Icon definieren
                 fileIcon.textContent = '📄'; // Einfaches Dokumenten-Icon
                 fileInfoDiv.appendChild(fileIcon);
             }

             const fileText = document.createElement('span');
             fileText.classList.add('file-name');
             const linkText = `${escapeHTML(msg.file.name)} (${formatFileSize(msg.file.size || 0)})`;
             
             if (msg.file.dataUrl) { // Download-Link, wenn DataURL vorhanden ist (z.B. für Bilder)
                 const downloadLink = document.createElement('a');
                 downloadLink.href = msg.file.dataUrl;
                 downloadLink.download = escapeHTML(msg.file.name);
                 downloadLink.textContent = linkText;
                 fileText.appendChild(downloadLink);
             } else {
                 fileText.textContent = linkText + (msg.file.type ? "" : " (Typ unbekannt)");
             }
             fileInfoDiv.appendChild(fileText);

             // Wenn die Datei-Nachricht auch Text-Content hat
             if (msg.content && msg.content.trim() !== "") {
                 const textNode = document.createElement('p');
                 textNode.classList.add('file-accompanying-text');
                 textNode.textContent = escapeHTML(msg.content);
                 fileInfoDiv.appendChild(textNode);
             }
             contentDiv.appendChild(fileInfoDiv);
        } else { // Normale Textnachricht
            contentDiv.innerHTML = escapeHTML(msg.content || '').replace(/\n/g, '<br>'); // Zeilenumbrüche erhalten
        }
        
        msgDiv.appendChild(contentDiv);
        UI.messagesContainer.appendChild(msgDiv);

        // Auto-Scroll-Logik
        const shouldScroll = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + UI.messagesContainer.lastChild.offsetHeight;
        if (isMe || shouldScroll || state.lastMessageTimestamp === 0) {
             UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
        state.lastMessageTimestamp = Date.now();
    }


    function openImageModal(src) {
        const modalId = 'imagePreviewModal';
        let modal = document.getElementById(modalId);
        if (modal) modal.remove(); // Alte Modal entfernen

        modal = document.createElement('div');
        modal.id = modalId;
        modal.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:1001;cursor:pointer;';
        modal.onclick = () => modal.remove();

        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:90%;max-height:90%;object-fit:contain;border-radius:5px;box-shadow:0 0 15px rgba(0,0,0,0.5);';
        img.onclick = (e) => e.stopPropagation(); // Klick auf Bild schließt Modal nicht

        modal.appendChild(img);
        document.body.appendChild(modal);
    }

    function sendTyping(isTyping = true) {
        if (!socket || !state.connected || !UI.messageInput.value) { // Nur senden, wenn auch Text da ist oder explizit false
             if (!isTyping && state.typingTimeout) { // Sende false, wenn explizit gefordert, um Tippen zu beenden
                 socket.emit('typing', { isTyping: false });
                 clearTimeout(state.typingTimeout);
                 state.typingTimeout = null;
             }
            return;
        }
        
        if (isTyping) {
            socket.emit('typing', { isTyping: true });
            clearTimeout(state.typingTimeout); // Bestehenden Timer löschen
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
                state.typingTimeout = null;
            }, CONFIG.TYPING_TIMER_LENGTH);
        } else { // isTyping === false
            clearTimeout(state.typingTimeout);
            state.typingTimeout = null;
            socket.emit('typing', { isTyping: false });
        }
    }

    async function setupLocalMedia(audioOnlyUpdate = false) {
        console.log("[WebRTC] setupLocalMedia aufgerufen. audioOnlyUpdate:", audioOnlyUpdate);
        if (state.localStream && !audioOnlyUpdate) { // Komplett neu, wenn nicht nur Audio-Update
            console.log("[WebRTC] Stoppe bestehenden lokalen Stream.");
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
        }

        try {
            const selectedMicId = UI.micSelect ? UI.micSelect.value : undefined;
            const audioConstraints = { 
                echoCancellation: true, 
                noiseSuppression: true,
                ...(selectedMicId && { deviceId: { exact: selectedMicId } }) // Nur wenn eine ID ausgewählt ist
            };
            
            let stream;
            if (audioOnlyUpdate && state.localStream) { // Nur Audio-Track ersetzen/hinzufügen
                console.log("[WebRTC] Versuche nur Audio-Track zu aktualisieren/hinzuzufügen.");
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                const audioTrack = audioStream.getAudioTracks()[0];
                
                state.localStream.getAudioTracks().forEach(t => { state.localStream.removeTrack(t); t.stop(); }); // Alte Audio-Tracks entfernen
                state.localStream.addTrack(audioTrack); // Neuen Audio-Track hinzufügen
                stream = state.localStream; // Bestehenden Stream mit neuem Audio weiterverwenden
                 console.log("[WebRTC] Audio-Track aktualisiert/hinzugefügt zum bestehenden Stream.");
            } else { // Video und Audio (neu) holen
                console.log("[WebRTC] Fordere neuen Video- und Audio-Stream an.");
                 stream = await navigator.mediaDevices.getUserMedia({
                     video: { width: { ideal: 640 }, height: { ideal: 480 } },
                     audio: audioConstraints
                 });
                 state.localStream = stream;
                 console.log("[WebRTC] Neuer lokaler Stream erstellt:", stream.id);
            }
            
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            if(UI.localVideoFullscreenBtn && state.localStream.getVideoTracks().length > 0) {
                UI.localVideoFullscreenBtn.classList.remove('hidden');
            }

            if (state.peerConnection) { // Wenn eine PeerConnection besteht, Tracks aktualisieren
                console.log("[WebRTC] Lokaler Stream geändert, aktualisiere Tracks in PeerConnection.");
                replaceTracksInPeerConnection(state.localStream); // Ersetzt Video- und Audio-Tracks
                await renegotiateIfNeeded(); // Neuverhandlung anstoßen, da Tracks sich geändert haben könnten
            }
            return true;
        } catch (err) {
            console.error('[WebRTC] Fehler beim Zugriff auf lokale Medien:', err.name, err.message);
            displayError(`Zugriff auf Kamera/Mikrofon fehlgeschlagen: ${err.message}`);
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true); // UI zurücksetzen
            if (state.localStream) { // Sicherstellen, dass Stream gestoppt wird, wenn Fehler auftritt
                 state.localStream.getTracks().forEach(track => track.stop());
                 state.localStream = null;
            }
            return false;
        }
    }


    function stopLocalStream() {
        console.log("[WebRTC] Stoppe lokalen Stream und Screenshare-Stream (falls aktiv).")
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
            updateVideoDisplay(UI.localVideo, UI.localScreenStatus, null, true);
        }
        if (state.screenStream) { // Auch den Screen-Sharing Stream stoppen
            state.screenStream.getTracks().forEach(track => track.stop());
            state.screenStream = null;
        }
    }

    async function createPeerConnection(peerId) {
        if (state.peerConnection && state.currentPCPartnerId === peerId) {
            console.log(`[WebRTC] PeerConnection mit ${peerId} existiert bereits. Nutze bestehende.`);
            return state.peerConnection; // Nutze bestehende, wenn für denselben Peer
        }
        if (state.peerConnection) { // Wenn mit anderem Peer verbunden, erst schließen
            console.log(`[WebRTC] Schließe bestehende PeerConnection mit ${state.currentPCPartnerId}, um neue mit ${peerId} zu erstellen.`);
            closePeerConnection();
        }
        
        console.log(`[WebRTC] Erstelle neue RTCPeerConnection für Peer: ${peerId}`);
        state.peerConnection = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.currentPCPartnerId = peerId; // Partner-ID setzen

        state.peerConnection.onicecandidate = event => {
            if (event.candidate && socket && state.connected && state.currentPCPartnerId) {
                console.log(`[WebRTC] Sende ICE Kandidat an ${state.currentPCPartnerId}:`, event.candidate.candidate.substring(0, 30) + "...");
                socket.emit('webRTC-ice-candidate', { to: state.currentPCPartnerId, candidate: event.candidate });
            } else if (!event.candidate) {
                console.log(`[WebRTC] ICE Kandidatensammlung für ${state.currentPCPartnerId} beendet (null Kandidat).`);
            }
        };

        state.peerConnection.ontrack = event => {
            console.log(`[WebRTC] Remote Track empfangen von ${state.currentPCPartnerId}:`, event.track.kind, "Stream(s):", event.streams);
            if (event.streams && event.streams[0]) {
                state.remoteStream = event.streams[0]; // Hauptstream nehmen
                 updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
            } else { // Manchmal kommen Tracks einzeln ohne Stream-Array
                 if (!state.remoteStream) state.remoteStream = new MediaStream(); // Neuen Stream erstellen, falls nicht vorhanden
                 state.remoteStream.addTrack(event.track);
                 updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, state.remoteStream, false);
            }
        };

        state.peerConnection.oniceconnectionstatechange = () => {
             if (!state.peerConnection) return;
             const pcState = state.peerConnection.iceConnectionState;
             console.log(`[WebRTC] ICE Connection Status zu ${state.currentPCPartnerId}: ${pcState}`);
             
             const partner = state.allUsersList.find(u => u.id === state.currentPCPartnerId);
             const partnerUsername = partner ? partner.username : (state.currentPCPartnerId || 'Unbekannt');

             switch(pcState) {
                 case "new":
                 case "checking":
                     if (UI.remoteScreenStatus) {
                        UI.remoteScreenStatus.textContent = `VERBINDE MIT ${partnerUsername.toUpperCase()}...`;
                        UI.remoteScreenStatus.className = 'screen-status-label loading';
                        UI.remoteScreenStatus.classList.remove('hidden');
                     }
                     if (UI.remoteVideo) UI.remoteVideo.classList.add('hidden');
                     break;
                 case "connected": // Verbindung hergestellt, Daten fließen (können)
                 case "completed": // Alle Kandidatenpaare geprüft
                     // Der ontrack Handler sollte das Video bereits anzeigen.
                     // Status-Update für die App insgesamt:
                     setConnectionStatus('connected', `Video verbunden mit ${partnerUsername}`);
                     if (UI.remoteScreenStatus && state.remoteStream && state.remoteStream.active) { // Nur ausblenden, wenn Stream da ist
                         UI.remoteScreenStatus.classList.add('hidden');
                     }
                     break;
                 case "disconnected": // Verbindung verloren (kann temporär sein)
                     displayError(`Video-Verbindung zu ${partnerUsername} unterbrochen.`);
                     // Hier noch nicht P2P schließen, könnte sich erholen
                     break;
                 case "failed": // Verbindung endgültig fehlgeschlagen
                     displayError(`Video-Verbindung zu ${partnerUsername} fehlgeschlagen.`);
                     closePeerConnection(); // P2P Verbindung schließen
                     // Optional: Versuche, eine neue P2P-Verbindung aufzubauen
                     setTimeout(() => initiateP2PConnection(), 3000); // Mit Verzögerung neu versuchen
                     break;
                 case "closed": // Verbindung wurde geschlossen
                     console.log(`[WebRTC] ICE Verbindung zu ${partnerUsername} geschlossen.`);
                     // closePeerConnection() sollte bereits aufgerufen worden sein oder wird es jetzt
                     break;
             }
         };
        
         state.peerConnection.onsignalingstatechange = () => {
            if (!state.peerConnection) return;
            console.log(`[WebRTC] Signalling State zu ${state.currentPCPartnerId} geändert zu: ${state.peerConnection.signalingState}`);
         };

         state.peerConnection.onnegotiationneeded = async () => {
             console.log(`[WebRTC] Event 'onnegotiationneeded' für ${state.currentPCPartnerId} ausgelöst. Signalling State: ${state.peerConnection.signalingState}`);
             // Nur Offer senden, wenn der Initiator dieser Verbindung ist oder wenn beide Seiten es dürfen (Polite Peer)
             // Und nur wenn der Signalisierungsstatus stabil ist, um Race Conditions zu vermeiden.
             if (state.peerConnection.signalingState === 'stable' && state.socketId < state.currentPCPartnerId) { // Beispiel: Initiator (kleinere ID) sendet Offer
                console.log(`[WebRTC] 'onnegotiationneeded': Bin Initiator oder es ist sicher, neu zu verhandeln. Sende Offer an ${state.currentPCPartnerId}.`);
                await renegotiateIfNeeded();
             } else {
                console.log(`[WebRTC] 'onnegotiationneeded': Nicht der Initiator oder Signalisierungsstatus nicht stabil. Warte auf Offer oder stabilen Zustand.`);
             }
         };

        // Füge Tracks vom lokalen Stream hinzu, falls vorhanden.
        // Dies geschieht oft auch, wenn der Stream später verfügbar wird (in setupLocalMedia).
        if (state.localStream) {
            addTracksToPeerConnection(state.localStream);
        }
        if (state.screenStream && state.isSharingScreen) { // Auch Screen-Tracks hinzufügen, falls Screensharing aktiv ist
            addTracksToPeerConnection(state.screenStream);
        }
        
         return state.peerConnection;
    }

    function addTracksToPeerConnection(stream) {
        if (stream && state.peerConnection) {
             console.log(`[WebRTC] Füge Tracks von Stream ${stream.id} zur PeerConnection mit ${state.currentPCPartnerId} hinzu.`);
             stream.getTracks().forEach(track => {
                 if (!state.peerConnection.getSenders().find(s => s.track === track)) {
                    try { 
                        state.peerConnection.addTrack(track, stream); 
                        console.log(`[WebRTC] Track ${track.kind} (${track.id}) hinzugefügt.`);
                    } catch(e) {
                        console.error(`[WebRTC] Fehler beim Hinzufügen von Track ${track.kind}:`, e);
                    }
                 } else {
                     console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits in der PeerConnection.`);
                 }
             });
        } else if (!stream) {
            console.warn("[WebRTC] addTracksToPeerConnection: Stream ist null.");
        } else if (!state.peerConnection) {
            console.warn("[WebRTC] addTracksToPeerConnection: PeerConnection ist null.");
        }
    }

    function replaceTracksInPeerConnection(stream) {
        if (!state.peerConnection) {
            console.warn("[WebRTC] replaceTracksInPeerConnection: Keine PeerConnection vorhanden.");
            return;
        }
        console.log(`[WebRTC] Ersetze Tracks in PeerConnection mit ${state.currentPCPartnerId} durch Tracks von Stream ${stream ? stream.id : 'NULL'}.`);
        
        // Senders für Video und Audio finden
        const videoSender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        const audioSender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');

        if (stream) { // Neuer Stream zum Ersetzen vorhanden
            const newVideoTrack = stream.getVideoTracks()[0];
            const newAudioTrack = stream.getAudioTracks()[0];

            if (videoSender && newVideoTrack) {
                videoSender.replaceTrack(newVideoTrack)
                    .then(() => console.log("[WebRTC] Video-Track erfolgreich ersetzt."))
                    .catch(e => console.error("[WebRTC] Fehler beim Ersetzen des Video-Tracks:", e));
            } else if (!videoSender && newVideoTrack) { // Falls kein Sender da war, Track hinzufügen
                console.log("[WebRTC] Kein Video-Sender vorhanden, füge neuen Video-Track hinzu.");
                state.peerConnection.addTrack(newVideoTrack, stream);
            } else if (videoSender && !newVideoTrack) { // Neuer Stream hat kein Video, alten Track entfernen (oder null setzen)
                 videoSender.replaceTrack(null)
                    .then(() => console.log("[WebRTC] Video-Track entfernt (mit null ersetzt)."))
                    .catch(e => console.error("[WebRTC] Fehler beim Entfernen des Video-Tracks:", e));
            }

            if (audioSender && newAudioTrack) {
                audioSender.replaceTrack(newAudioTrack)
                    .then(() => console.log("[WebRTC] Audio-Track erfolgreich ersetzt."))
                    .catch(e => console.error("[WebRTC] Fehler beim Ersetzen des Audio-Tracks:", e));
            } else if (!audioSender && newAudioTrack) {
                console.log("[WebRTC] Kein Audio-Sender vorhanden, füge neuen Audio-Track hinzu.");
                state.peerConnection.addTrack(newAudioTrack, stream);
            } else if (audioSender && !newAudioTrack) {
                 audioSender.replaceTrack(null)
                    .then(() => console.log("[WebRTC] Audio-Track entfernt (mit null ersetzt)."))
                    .catch(e => console.error("[WebRTC] Fehler beim Entfernen des Audio-Tracks:", e));
            }
        } else { // Kein neuer Stream -> alle Tracks entfernen
            console.log("[WebRTC] Kein neuer Stream zum Ersetzen, entferne alle Tracks.");
            if (videoSender) videoSender.replaceTrack(null).catch(e=>console.error("Fehler VideoTrack null:", e));
            if (audioSender) audioSender.replaceTrack(null).catch(e=>console.error("Fehler AudioTrack null:", e));
        }
    }


     async function renegotiateIfNeeded() {
         if (!state.peerConnection || !state.currentPCPartnerId ) {
             console.log("[WebRTC] renegotiateIfNeeded: Bedingungen nicht erfüllt (keine PC oder kein Partner).");
             return;
         }
         if (state.peerConnection.signalingState !== 'stable') {
            console.warn(`[WebRTC] renegotiateIfNeeded: Überspringe Neuverhandlung, da Signalisierungsstatus '${state.peerConnection.signalingState}' (nicht stable) ist mit ${state.currentPCPartnerId}.`);
            return;
         }

         console.log(`[WebRTC] renegotiateIfNeeded: Initiiere Offer für Neuverhandlung mit ${state.currentPCPartnerId}.`);
         try {
             const offer = await state.peerConnection.createOffer();
             console.log(`[WebRTC] renegotiateIfNeeded: Lokales Offer erstellt, setze LocalDescription für ${state.currentPCPartnerId}.`);
             await state.peerConnection.setLocalDescription(offer);
             
             console.log(`[WebRTC] renegotiateIfNeeded: Sende Offer an ${state.currentPCPartnerId}.`);
             socket.emit('webRTC-offer', { to: state.currentPCPartnerId, offer: state.peerConnection.localDescription });
         } catch (err) {
             console.error('[WebRTC] renegotiateIfNeeded: Fehler beim Erstellen/Senden des Offers:', err);
             displayError("Fehler bei der Video-Neuverhandlung.");
         }
     }

    function closePeerConnection() {
        if (state.peerConnection) {
            console.log(`[WebRTC] Schließe PeerConnection mit ${state.currentPCPartnerId}.`);
            state.peerConnection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop(); // Stoppe Tracks, die über diese PC gesendet wurden
                }
            });
            state.peerConnection.close();
            state.peerConnection = null;
        }
        // Remote-Stream und UI zurücksetzen
        if(state.remoteStream) {
            state.remoteStream.getTracks().forEach(track => track.stop());
            state.remoteStream = null;
        }
        updateVideoDisplay(UI.remoteVideo, UI.remoteScreenStatus, null, false);
        state.currentPCPartnerId = null; // Wichtig: Partner ID zurücksetzen
        console.log("[WebRTC] PeerConnection und Remote-Stream bereinigt.");
    }

     async function initiateP2PConnection() {
         if (!state.connected || !socket || !state.socketId) {
            console.log("[WebRTC] initiateP2PConnection: Nicht verbunden oder Socket-ID fehlt. Breche ab.");
            return;
         }
         if (state.peerConnection && state.peerConnection.iceConnectionState !== 'closed' && state.peerConnection.iceConnectionState !== 'failed') {
             console.log(`[WebRTC] initiateP2PConnection: Bereits eine PeerConnection mit ${state.currentPCPartnerId} vorhanden (Status: ${state.peerConnection.iceConnectionState}). Breche ab.`);
             return;
         }

         // Nur andere Benutzer als potenzielle Partner betrachten
         const otherUsers = state.allUsersList.filter(u => u.id !== state.socketId);
         if (otherUsers.length === 0) {
             console.log("[WebRTC] initiateP2PConnection: Keine anderen Benutzer im Raum für P2P.");
             if(state.currentPCPartnerId) closePeerConnection(); // Falls noch alter Partner da stand
             return;
         }

         // Einfache Logik: Verbinde dich mit dem ersten anderen Benutzer in der Liste
         // In einer Mehrbenutzerumgebung bräuchte man eine komplexere Auswahl oder Pairing-Logik.
         const targetUser = otherUsers[0]; 
         console.log(`[WebRTC] initiateP2PConnection: Potenzieller Partner gefunden: ${targetUser.username} (${targetUser.id})`);
         
         // Stelle sicher, dass lokale Medien bereit sind, bevor eine PC erstellt wird
         if (!state.localStream || !state.localStream.active) {
            console.log("[WebRTC] initiateP2PConnection: Lokaler Stream nicht bereit. Versuche setupLocalMedia.");
            const mediaReady = await setupLocalMedia(false);
            if (!mediaReady) {
                console.error("[WebRTC] initiateP2PConnection: Lokale Medien konnten nicht eingerichtet werden. Breche P2P ab.");
                return;
            }
         }

         await createPeerConnection(targetUser.id); // Erstellt PC und setzt state.currentPCPartnerId

         // Der "höfliche" Peer (mit der größeren ID) wartet auf ein Angebot.
         // Der "unhöfliche" Peer (mit der kleineren ID) initiiert das Angebot.
         // Dies hilft, "Glaring" (gleichzeitiges Senden von Offers) zu vermeiden.
         if (state.socketId < targetUser.id) {
             console.log(`[WebRTC] initiateP2PConnection: Eigene ID (${state.socketId}) ist kleiner als Ziel-ID (${targetUser.id}). Initiiere Offer.`);
             await renegotiateIfNeeded(); // Sendet das initiale Offer
         } else {
              console.log(`[WebRTC] initiateP2PConnection: Eigene ID (${state.socketId}) ist größer/gleich Ziel-ID (${targetUser.id}). Warte auf Offer.`);
              // PeerConnection ist erstellt und lauscht auf Angebote.
         }
     }

    async function toggleScreenSharing() {
        if (!state.connected || !UI.shareScreenBtn) return;
        UI.shareScreenBtn.disabled = true;

        if (state.isSharingScreen) { // Screensharing beenden
            console.log("[WebRTC] Beende Screensharing.");
            if (state.screenStream) {
                 state.screenStream.getTracks().forEach(track => track.stop());
                 state.screenStream = null;
            }
            state.isSharingScreen = false;
            UI.shareScreenBtn.textContent = 'Bildschirm teilen';
            UI.shareScreenBtn.classList.remove('danger-btn');

            // Ersetze Screen-Tracks durch Kamera-Tracks (falls lokaler Stream vorhanden)
            if (state.localStream) {
                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true); // Zeige wieder Kamera lokal an
                if (state.peerConnection) {
                    replaceTracksInPeerConnection(state.localStream); 
                    await renegotiateIfNeeded(); // Wichtig: Neuverhandlung nach Track-Änderung
                }
            } else { // Falls kein Kamera-Stream da war (sollte nicht passieren, wenn P2P aktiv war)
                await setupLocalMedia(false); // Versuche Kamera neu zu starten
            }

        } else { // Screensharing starten
            console.log("[WebRTC] Starte Screensharing.");
            try {
                // Wichtig: getDisplayMedia stoppt existierende Kamera-Tracks nicht automatisch.
                // Der Benutzer wählt aus, ob auch Audio geteilt wird.
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: { cursor: "always" }, // Zeige Mauszeiger
                    audio: { echoCancellation: true, noiseSuppression: true } // Optional: Audio vom Bildschirm teilen
                });
                state.isSharingScreen = true;
                UI.shareScreenBtn.textContent = 'Teilen beenden';
                UI.shareScreenBtn.classList.add('danger-btn');
                
                updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.screenStream, true); // Zeige geteilten Bildschirm lokal an

                if (state.peerConnection) {
                    replaceTracksInPeerConnection(state.screenStream); // Ersetzt Kamera/Mic durch Screen-Tracks
                    await renegotiateIfNeeded(); // Wichtig: Neuverhandlung
                }

                // Listener für das Beenden des Teilens durch den Browser-Button
                if (state.screenStream.getVideoTracks()[0]) {
                    state.screenStream.getVideoTracks()[0].onended = () => {
                        console.log("[WebRTC] Screensharing durch Browser-UI beendet.");
                        if (state.isSharingScreen) { // Nur wenn intern noch als sharing markiert
                            toggleScreenSharing(); // Ruft die eigene Funktion auf, um alles sauber zu beenden
                        }
                    };
                }

            } catch (err) {
                console.error('[WebRTC] Fehler beim Starten der Bildschirmfreigabe:', err);
                displayError(`Bildschirmfreigabe fehlgeschlagen: ${err.message}`);
                state.isSharingScreen = false; // Zustand zurücksetzen
                UI.shareScreenBtn.textContent = 'Bildschirm teilen';
                UI.shareScreenBtn.classList.remove('danger-btn');
                // Stelle Kamera wieder her, falls sie vorher lief
                if (state.localStream) updateVideoDisplay(UI.localVideo, UI.localScreenStatus, state.localStream, true);
            }
        }
        UI.shareScreenBtn.disabled = false;
    }

    function toggleFullscreen(videoElement) {
        if (!videoElement || videoElement.classList.contains('hidden')) return;
        if (!document.fullscreenElement) {
            if (videoElement.requestFullscreen) {
                videoElement.requestFullscreen().catch(err => console.error(`Vollbildfehler für Element ${videoElement.id}: ${err.message}`));
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => console.error(`Fehler beim Verlassen des Vollbilds: ${err.message}`));
            }
        }
    }

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
        if (UI.messageInput) UI.messageInput.placeholder = `Datei ausgewählt: ${escapeHTML(file.name)}. Nachricht optional.`;
    }

    function resetFileInput() {
        state.selectedFile = null;
        if(UI.fileInput) UI.fileInput.value = ''; // Wichtig, um das 'change'-Event erneut auszulösen, wenn dieselbe Datei gewählt wird
        if (UI.messageInput) UI.messageInput.placeholder = 'Nachricht eingeben...';
    }

    initializeUI();
    // populateMicList() wird nun nach Klick auf "Verbinden" bzw. in setupSocketListeners -> 'connect' aufgerufen,
    // da getUserMedia oft eine Benutzerinteraktion erfordert, um Berechtigungen abzufragen.
});
