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
        remoteAudioControls: document.getElementById('remoteAudioControls')
    };

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room',
        socketId: null,
        allUsersList: [], // Komplette Liste der Benutzer im Raum vom Server
        typingTimeout: null,
        typingUsers: new Set(),
        // lastMessageTimestamp, isWindowFocused, unreadMessages, originalTitle entfernt

        // Sound Effekt
        notificationSound: new Audio('/notif.mp3'), // Sound-Datei im public-Ordner erwartet

        // WebRTC State
        localAudioStream: null,
        peerConnections: new Map(),
        remoteAudioElements: new Map(),
        localAudioMuted: false
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500,
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ],
        },
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
    };

    // --- Initialisierung und UI-Helfer ---
    function initializeUI() {
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        UI.disconnectBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        if (UI.micSelect) UI.micSelect.disabled = false;
        updateRemoteAudioControls();
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
        console.log("[UI] updateUIAfterConnect aufgerufen.");
        UI.connectBtn.classList.add('hidden');
        UI.disconnectBtn.classList.remove('hidden');
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        if (UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true;
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();

        setupLocalAudioStream();
        populateMicList();
    }

    function updateUIAfterDisconnect() {
        console.log("[UI] updateUIAfterDisconnect aufgerufen.");
        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if (UI.usernameInput) UI.usernameInput.disabled = false;
        if (UI.micSelect) UI.micSelect.disabled = false;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = '0';
        UI.typingIndicator.textContent = '';

        stopLocalAudioStream();
        closeAllPeerConnections();
        updateRemoteAudioControls();

        state.users = {};
        state.allUsersList = [];
        state.socketId = null;
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

    // --- Event Listener ---
    UI.connectBtn.addEventListener('click', connect);
    UI.disconnectBtn.addEventListener('click', disconnect);
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

    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        if (state.connected) {
            console.log("[WebRTC] Mikrofonauswahl geändert. Versuche lokalen Stream zu aktualisieren.");
            await setupLocalAudioStream();
        } else {
             console.log("[WebRTC] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
        }
    });

    window.addEventListener('beforeunload', () => {
        if (socket && socket.connected) {
            socket.disconnect();
        }
         stopLocalAudioStream();
         closeAllPeerConnections();
    });


    // --- Utility Functions ---
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

    // Funktion zum Abspielen des Benachrichtigungssounds
    function playNotificationSound() {
        if (state.notificationSound) {
            // Optional: Prüfen, ob das Fenster aktiv ist, um aufdringliche Sounds zu vermeiden
            // if (!document.hidden) { // Wenn Fenster aktiv ist, evtl. keinen Sound spielen
            //    return;
            // }
            // Sound neu laden, um ihn auch bei schnellen Ereignissen abzuspielen
            state.notificationSound.currentTime = 0; // Setzt die Wiedergabeposition an den Anfang
             state.notificationSound.play().catch(e => {
                 // Fehler beim Abspielen (z.B. Autoplay blockiert) abfangen
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
                 // Dem Benutzer eventuell einen Hinweis geben, dass Sounds blockiert sind
             });
        }
    }


    // --- Media Device Functions ---
    async function populateMicList() {
        console.log("[Media] populateMicList aufgerufen.");
        if (!UI.micSelect) {
            console.warn("[Media] populateMicList: UI.micSelect nicht gefunden.");
            return;
        }
        UI.micSelect.innerHTML = '';
        UI.micSelect.appendChild(new Option("Standard-Mikrofon", "", true, true));

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length > 0) {
                 audioInputs.forEach(d => {
                     if (d.deviceId !== 'default' && d.label) {
                          const opt = new Option(d.label, d.deviceId);
                          UI.micSelect.appendChild(opt);
                     }
                 });
                 console.log(`[Media] ${audioInputs.length} Mikrofone gefunden.`);
            } else {
                 console.warn("[Media] populateMicList: Keine Mikrofone gefunden.");
            }
        } catch (e) {
            console.error("[Media] populateMicList: Fehler bei der Mikrofonauflistung:", e.name, e.message);
             const opt = new Option(`Mikrofonliste Fehler: ${e.name}`, "");
             opt.style.color = 'var(--error-bg)';
             UI.micSelect.appendChild(opt);
        }
    }

    // --- UI Update Functions ---

    function updateUserList(usersArrayFromServer) {
        // Prüfen, ob neue Benutzer hinzugekommen sind, bevor die Liste aktualisiert wird
        const oldUsers = state.allUsersList;
        state.allUsersList = usersArrayFromServer; // Komplette Liste vom Server

        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        const otherUsers = usersArrayFromServer.filter(user => user.id !== state.socketId);

        UI.userList.innerHTML = ''; // Liste in der UI leeren

        usersArrayFromServer.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id));
            li.appendChild(dot);

            const nameNode = document.createTextNode(` ${escapeHTML(user.username)}`);
            if (user.id === state.socketId) {
                const strong = document.createElement('strong');
                strong.appendChild(nameNode);
                strong.appendChild(document.createTextNode(" (Du)"));
                li.appendChild(strong);

                 let localMuteBtn = document.getElementById('localMuteBtn');
                 if (!localMuteBtn) {
                     localMuteBtn = document.createElement('button');
                     localMuteBtn.id = 'localMuteBtn';
                     localMuteBtn.textContent = 'Mikro stumm schalten';
                     localMuteBtn.classList.add('mute-btn');
                     localMuteBtn.classList.add('hidden'); // Start Hidden
                     localMuteBtn.addEventListener('click', toggleLocalAudioMute);
                     UI.micSelect.parentNode.insertBefore(localMuteBtn, UI.connectBtn);
                 }
                 if (state.connected) {
                      localMuteBtn.classList.remove('hidden');
                      updateLocalMuteButtonUI();
                 } else {
                      localMuteBtn.classList.add('hidden');
                 }

            } else {
                li.appendChild(nameNode);

                // Prüfen, ob dieser Benutzer neu ist (für Sound-Benachrichtigung)
                if (state.connected && oldUsers.length > 0 && !oldUsers.some(oldUser => oldUser.id === user.id)) {
                     console.log(`[UI] Neuer Benutzer beigetreten: ${user.username}`);
                     playNotificationSound(); // Sound abspielen, wenn ein NEUER Benutzer beitritt
                }

            }
            UI.userList.appendChild(li);
        });

         updateRemoteAudioControls(otherUsers);
         updatePeerConnections(otherUsers);

         if (UI.remoteAudioControls) {
              if (otherUsers.length > 0) {
                   UI.remoteAudioControls.classList.remove('hidden');
              } else {
                   UI.remoteAudioControls.classList.add('hidden');
              }
         }

          // Prüfen, ob Benutzer den Raum verlassen haben (optionaler Sound)
          // Die WebRTC closePeerConnection triggert auch die Bereinigung.
          // Ein Sound hier wäre für den Fall, dass jemand einfach weg ist.
          // if (state.connected && oldUsers.length > usersArrayFromServer.length) {
          //     const goneUsers = oldUsers.filter(oldUser => !usersArrayFromServer.some(newUser => newUser.id === oldUser.id));
          //     if (goneUsers.length > 0) {
          //          console.log(`[UI] Benutzer hat/haben den Raum verlassen: ${goneUsers.map(u => u.username).join(', ')}`);
          //          // playNotificationSound(); // Optional: Sound auch bei verlassen
          //     }
          // }

    }

    function updateTypingIndicatorDisplay() {
        if (!UI.typingIndicator) return;
        const typingUsernames = state.typingUsers;
        if (typingUsernames && typingUsernames.size > 0) {
            const othersTyping = Array.from(typingUsernames).filter(name => name !== state.username);
            if (othersTyping.length > 0) {
                 const usersString = othersTyping.map(escapeHTML).join(', ');
                 UI.typingIndicator.textContent = `${usersString} schreibt...`;
                 UI.typingIndicator.style.display = 'block';
            } else {
                 UI.typingIndicator.style.display = 'none';
            }
        } else {
            UI.typingIndicator.style.display = 'none';
        }
    }

    // Aktualisiert die dynamische UI für die Audio-Steuerung der Remote-Peers
    function updateRemoteAudioControls(remoteUsers = []) {
         if (!UI.remoteAudioControls) return;

         const mutedStates = new Map();
         state.remoteAudioElements.forEach((audioEl, peerId) => {
             mutedStates.set(peerId, audioEl.muted);
         });

         UI.remoteAudioControls.innerHTML = '';

         if (remoteUsers.length > 0) {
             const title = document.createElement('h3');
             title.textContent = 'Sprach-Teilnehmer';
             UI.remoteAudioControls.appendChild(title);

             remoteUsers.forEach(user => {
                 const itemDiv = document.createElement('div');
                 itemDiv.classList.add('remote-audio-item');
                 itemDiv.id = `remoteAudioItem_${user.id}`;

                 const nameSpan = document.createElement('span');
                 nameSpan.textContent = escapeHTML(user.username);
                 nameSpan.style.color = escapeHTML(user.color || getUserColor(user.id));
                 itemDiv.appendChild(nameSpan);

                 const muteBtn = document.createElement('button');
                 muteBtn.textContent = 'Stumm schalten';
                 muteBtn.classList.add('mute-btn');
                 muteBtn.dataset.peerId = user.id;
                 muteBtn.addEventListener('click', toggleRemoteAudioMute);

                 const isMuted = mutedStates.has(user.id) ? mutedStates.get(user.id) : false;
                 muteBtn.classList.toggle('muted', isMuted);
                 muteBtn.textContent = isMuted ? 'Stumm AN' : 'Stumm schalten';


                 itemDiv.appendChild(muteBtn);

                 UI.remoteAudioControls.appendChild(itemDiv);

                  ensureRemoteAudioElementExists(user.id);
             });
         }
    }

    // Stellt sicher, dass ein <audio> Element für einen Remote-Peer existiert
    function ensureRemoteAudioElementExists(peerId) {
        let audioElement = state.remoteAudioElements.get(peerId);
        if (!audioElement) {
            console.log(`[WebRTC] Erstelle neues Audio-Element für Peer ${peerId}.`);
            audioElement = new Audio();
            audioElement.autoplay = true;
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);

            state.remoteAudioElements.set(peerId, audioElement);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} erstellt und hinzugefügt.`);

             const muteButton = UI.remoteAudioControls.querySelector(`.mute-btn[data-peer-id='${peerId}']`);
             if (muteButton) {
                  audioElement.muted = muteButton.classList.contains('muted');
             } else {
                  audioElement.muted = false;
             }
        }
         return audioElement;
    }

    // Entfernt das Audio-Element eines Remote-Peers
    function removeRemoteAudioElement(peerId) {
         const audioElement = state.remoteAudioElements.get(peerId);
         if (audioElement) {
             console.log(`[WebRTC] Entferne Audio-Element für Peer ${peerId}.`);
             audioElement.pause();
             audioElement.srcObject = null;
             audioElement.remove();
             state.remoteAudioElements.delete(peerId);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} entfernt.`);
         }
         const itemDiv = document.getElementById(`remoteAudioItem_${peerId}`);
         if (itemDiv) {
             itemDiv.remove();
         }
    }

     // Schaltet das lokale Mikrofon stumm/aktiv
    function toggleLocalAudioMute() {
         if (!state.localAudioStream) {
             console.warn("[WebRTC] toggleLocalAudioMute: Lokaler Audio-Stream nicht verfügbar.");
             return;
         }
         state.localAudioMuted = !state.localAudioMuted;
         console.log(`[WebRTC] Lokales Mikrofon: ${state.localAudioMuted ? 'Stumm' : 'Aktiv'}`);

         state.localAudioStream.getAudioTracks().forEach(track => {
             track.enabled = !state.localAudioMuted;
         });

         updateLocalMuteButtonUI();
    }

     // Aktualisiert die UI des lokalen Mute-Buttons
     function updateLocalMuteButtonUI() {
         const localMuteBtn = document.getElementById('localMuteBtn');
         if (localMuteBtn) {
             localMuteBtn.textContent = state.localAudioMuted ? 'Mikro Stumm AN' : 'Mikro stumm schalten';
             localMuteBtn.classList.toggle('muted', state.localAudioMuted);
             localMuteBtn.classList.toggle('active', !state.localAudioMuted); // Zusätzliche Klasse für Aktiv-Status (optional für CSS)
         }
     }

     // Schaltet den Audio-Stream eines Remote-Peers lokal stumm/aktiv
     function toggleRemoteAudioMute(event) {
         const peerId = event.target.dataset.peerId;
         const audioElement = state.remoteAudioElements.get(peerId);
         if (!audioElement) {
             console.warn(`[WebRTC] toggleRemoteAudioMute: Audio-Element für Peer ${peerId} nicht gefunden.`);
             return;
         }

         audioElement.muted = !audioElement.muted;
         console.log(`[WebRTC] Audio von Peer ${peerId} lokal ${audioElement.muted ? 'gemutet' : 'aktiviert'}.`);

         event.target.textContent = audioElement.muted ? 'Stumm AN' : 'Stumm schalten';
         event.target.classList.toggle('muted', audioElement.muted);
     }


    // --- WebSocket Logic ---
    function connect() {
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
            // userListUpdate wird direkt nach joinSuccess vom Server gesendet,
            // was update PeerConnections und updateRemoteAudioControls triggert.
            // update UserList hier initial aufrufen, um die UI sofort zu setzen
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
            // Hier wird geprüft, ob neue Benutzer hinzugekommen sind, um den Sound zu spielen.
            // Die eigentliche UI-Aktualisierung und WebRTC-Logik passiert in updateUserList.
             updateUserList(currentUsersList); // Diese Funktion enthält die Logik zum Abspielen des Sounds bei neuen Usern

        });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            // Sound abspielen, wenn es keine eigene Nachricht ist
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

        // --- WebRTC Signalisierungs-Listener (Multi-Peer) ---
        socket.on('webRTC-signal', async ({ from, type, payload }) => {
             // console.log(`[WebRTC Signal] Empfange '${type}' von Peer ${from}.`); // Zu viele Logs
             if (from === state.socketId) {
                 return;
             }

             let pc = state.peerConnections.get(from);
             if (!pc) {
                 console.warn(`[WebRTC Signal] Empfange Signal von unbekanntem Peer ${from}. Erstelle PeerConnection.`);
                 pc = await createPeerConnection(from);
                 addLocalStreamToPeerConnection(pc);
             }

            try {
                 if (type === 'offer') {
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Offer).`); // Signaling State: ${pc.signalingState}
                    const isPolite = state.socketId < from;

                    if (pc.signalingState !== 'stable' && pc.localDescription && isPolite) {
                         console.warn(`[WebRTC Signal] Peer ${from}: Glare erkannt (Polite). Ignoriere Offer.`);
                         return;
                    }

                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                    console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Offer) gesetzt.`); // Neuer Signaling State: ${pc.signalingState}

                    console.log(`[WebRTC Signal] Peer ${from}: Erstelle Answer.`);
                    const answer = await pc.createAnswer();
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Local Description (Answer).`);
                    await pc.setLocalDescription(answer);
                    console.log(`[WebRTC Signal] Peer ${from}: Local Description (Answer) gesetzt.`); // Neuer Signaling State: ${pc.signalingState}

                    console.log(`[WebRTC Signal] Peer ${from}: Sende Answer.`);
                    socket.emit('webRTC-signal', { to: from, type: 'answer', payload: pc.localDescription });

                 } else if (type === 'answer') {
                     console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Answer).`); // Signaling State: ${pc.signalingState}
                    if (pc.signalingState === 'have-local-offer') {
                        await pc.setRemoteDescription(new RTCSessionDescription(payload));
                         console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Answer) gesetzt.`); // Neuer Signaling State: ${pc.signalingState}
                    } else {
                        console.warn(`[WebRTC Signal] Peer ${from}: Empfange Answer im falschen Signaling State (${pc.signalingState}). Ignoriere.`);
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
    } // End setupSocketListeners


    function disconnect() {
        console.log("[Socket.IO] Trenne Verbindung manuell.");
        if (socket) {
            socket.disconnect();
        } else {
            console.log("[Socket.IO] Kein Socket zum Trennen gefunden.");
            updateUIAfterDisconnect();
        }
    }

    // --- Chat Logic ---
    function sendMessage() {
        console.log("sendMessage() aufgerufen.");
        const content = UI.messageInput.value.trim();
        if (!content) {
            console.log("sendMessage: Inhalt leer. Abbruch.");
            return;
        }

        if (!socket || !state.connected) {
            console.error("[Chat Send Error] Cannot send message. Not connected.");
            displayError("Nicht verbunden. Nachricht kann nicht gesendet werden.");
            return;
        }

        const message = {
             content,
             timestamp: new Date().toISOString(),
             type: 'text'
             // Sender info (id, username, color) wird vom Server hinzugefügt
        };

        console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`);
        socket.emit('message', message);


        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false);
    }

    // Fügt eine eingehende (oder eigene gesendete) Nachricht zum Chat hinzu
    function appendMessage(msg) {
         if (!msg || !msg.content || !msg.id || !msg.username) {
            console.warn("appendMessage: Ungültige Nachrichtendaten erhalten.", msg);
            return;
        }

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.id === state.socketId;
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username);
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.id));

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');

        // Nur Textinhalt anzeigen
        contentDiv.textContent = escapeHTML(msg.content);

        // Zeitstempel-Logik entfernt
        // const timeSpan = document.createElement('span');
        // timeSpan.classList.add('timestamp');
        // try { ... } catch { ... }
        // msgDiv.appendChild(timeSpan); // Entfernt


        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);

        // Füge Nachricht zum Container hinzu
        UI.messagesContainer.appendChild(msgDiv);

        // Auto-Scroll
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20;
        if (isMe || isScrolledToBottom) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
    }

    function sendTyping(isTyping = true) {
        if (!socket || !state.connected || UI.messageInput.disabled) {
             return;
        }

        clearTimeout(state.typingTimeout);

        socket.emit('typing', { isTyping });

        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- WebRTC Logic (Multi-Peer Audio) ---
    async function setupLocalAudioStream() {
        console.log("[WebRTC] setupLocalAudioStream aufgerufen.");
        if (state.localAudioStream) {
            console.log("[WebRTC] Beende alten lokalen Audio-Stream.");
            state.localAudioStream.getTracks().forEach(track => track.stop());
            state.localAudioStream = null;
        }

        try {
            const selectedMicId = UI.micSelect ? UI.micSelect.value : undefined;
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined
            };
            console.log("[WebRTC] Versuche, lokalen Audio-Stream zu holen mit Constraints:", audioConstraints);

            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints
            });
            state.localAudioStream = stream;
            console.log(`[WebRTC] Lokaler Audio-Stream erhalten: ${stream.id}. Tracks: Audio: ${stream.getAudioTracks().length}`);

            state.peerConnections.forEach(pc => {
                addLocalStreamToPeerConnection(pc);
            });

             updateLocalMuteButtonUI();

            return true;
        } catch (err) {
            console.error('[WebRTC] Fehler beim Zugriff auf das Mikrofon:', err.name, err.message);
             displayError(`Mikrofonzugriff fehlgeschlagen: ${err.message}. Bitte erlaube den Zugriff.`);
             if (UI.micSelect) UI.micSelect.disabled = true;
             const localMuteBtn = document.getElementById('localMuteBtn');
             if(localMuteBtn) localMuteBtn.disabled = true;

            return false;
        }
    }

    function stopLocalAudioStream() {
         console.log("[WebRTC] stopLocalAudioStream aufgerufen.");
        if (state.localAudioStream) {
            console.log(`[WebRTC] Stoppe Tracks im lokalen Audio-Stream (${state.localAudioStream.id}).`);
            state.localAudioStream.getTracks().forEach(track => {
                 console.log(`[WebRTC] Stoppe lokalen Track ${track.id} (${track.kind}).`);
                 track.stop();
            });
            state.localAudioStream = null;
             console.log("[WebRTC] localAudioStream ist jetzt null.");
        } else {
             console.log("[WebRTC] Kein lokaler Audio-Stream zum Stoppen.");
        }
         const localMuteBtn = document.getElementById('localMuteBtn');
         if(localMuteBtn) {
              localMuteBtn.removeEventListener('click', toggleLocalAudioMute);
              localMuteBtn.classList.add('hidden');
         }
         state.localAudioMuted = false;
    }

    async function createPeerConnection(peerId) {
        console.log(`[WebRTC] createPeerConnection aufgerufen für Peer: ${peerId}.`);
        if (state.peerConnections.has(peerId)) {
            console.warn(`[WebRTC] PeerConnection mit ${peerId} existiert bereits. Gebe vorhandene zurück.`);
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
            if (event.track.kind === 'audio') {
                 const audioElement = ensureRemoteAudioElementExists(peerId);

                 if (event.streams && event.streams[0]) {
                     console.log(`[WebRTC] Verbinde Remote Audio Stream ${event.streams[0].id} mit Audio-Element für Peer ${peerId}.`);
                     audioElement.srcObject = event.streams[0];
                 } else {
                      console.log(`[WebRTC] Verbinde einzelnen Remote Audio Track ${event.track.id} mit Audio-Element für Peer ${peerId}.`);
                     const remoteStream = new MediaStream([event.track]);
                      audioElement.srcObject = remoteStream;
                 }

                 event.track.onended = () => {
                     console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                 };
                  event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                  event.track.ounmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);
            }
        };

        pc.oniceconnectionstatechange = () => {
             if (!pc) return;
            const pcState = pc.iceConnectionState;
             const peerUser = state.allUsersList.find(u => u.id === peerId);
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] ICE Connection Status zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
             switch (pcState) {
                case "new": case "checking":
                    break;
                case "connected":
                    console.log(`[WebRTC] ICE 'connected': Erfolgreich verbunden mit Peer '${peerUsername}'. Audio sollte fließen.`);
                    break;
                case "completed":
                    console.log(`[WebRTC] ICE 'completed': Alle Kandidaten für Peer '${peerUsername}' geprüft.`);
                    break;
                case "disconnected":
                    console.warn(`[WebRTC] ICE 'disconnected': Verbindung zu Peer '${peerUsername}' unterbrochen. Versuche erneut...`);
                    break;
                case "failed":
                    console.error(`[WebRTC] ICE 'failed': Verbindung zu Peer '${peerUsername}' fehlgeschlagen.`);
                     closePeerConnection(peerId);
                    break;
                case "closed":
                    console.log(`[WebRTC] ICE 'closed': Verbindung zu Peer '${peerUsername}' wurde geschlossen.`);
                     closePeerConnection(peerId);
                    break;
            }
        };

        pc.onsignalingstatechange = () => {
            if (!pc) return;
            const pcState = pc.signalingState;
             const peerUser = state.allUsersList.find(u => u.id === peerId);
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] Signaling State zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
        };

        pc.onnegotiationneeded = async () => {
             console.log(`[WebRTC] onnegotiationneeded Event für Peer ${peerId} ausgelöst.`);
             const isPolite = state.socketId < peerId;

             if (pc.signalingState !== 'stable' && isPolite) {
                 console.log(`[WebRTC] Peer ${peerId}: Bin Polite (${isPolite}). Signaling State ist nicht 'stable' (${pc.signalingState}). Überspringe Offer Erstellung.`);
                 return;
             }

             if (pc.signalingState === 'have-local-offer' && isPolite) {
                  console.log(`[WebRTC] Peer ${peerId}: Glare Situation (have-local-offer, Polite). Warte auf eingehendes Offer (Rollback).`);
                   return;
             }

             console.log(`[WebRTC] Peer ${peerId}: Erstelle Offer. Signaling State: ${pc.signalingState}. Bin Polite? ${isPolite}.`);
             try {
                 const offer = await pc.createOffer();
                 console.log(`[WebRTC] Peer ${peerId}: Offer erstellt. Setze Local Description.`);
                 await pc.setLocalDescription(offer);
                 console.log(`[WebRTC] Peer ${peerId}: Local Description (Offer) gesetzt. Sende Offer an Server.`);

                 socket.emit('webRTC-signal', {
                     to: peerId,
                     type: 'offer',
                     payload: pc.localDescription
                 });

             } catch (err) {
                 console.error(`[WebRTC] Peer ${peerId}: Fehler bei Offer Erstellung oder Setzung:`, err);
                 displayError(`Fehler bei Audio-Verhandlung (Offer) mit Peer ${peerId}.`);
                 closePeerConnection(peerId);
             }
        };

        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc;
    }

    function addLocalStreamToPeerConnection(pc) {
        if (!state.localAudioStream || !pc) {
            console.warn("[WebRTC] addLocalStreamToPeerConnection: Lokaler Stream oder PC ist null.");
            return;
        }
         console.log(`[WebRTC] Füge lokalen Audio-Stream Tracks zu PeerConnection hinzu.`);

         pc.getSenders().forEach(sender => {
             if (sender.track && sender.track.kind === 'audio') {
                 pc.removeTrack(sender);
             }
         });

        state.localAudioStream.getAudioTracks().forEach(track => {
             console.log(`[WebRTC] Füge lokalen Audio Track ${track.id} hinzu (Enabled: ${track.enabled}).`);
            pc.addTrack(track, state.localAudioStream);
        });
         console.log("[WebRTC] Lokale Audio-Tracks zur PC hinzugefügt.");
    }

    function updatePeerConnections(currentRemoteUsers) {
        console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote User: ${currentRemoteUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

        state.peerConnections.forEach((pc, peerId) => {
            const peerStillExists = currentRemoteUsers.some(user => user.id === peerId);
            if (!peerStillExists) {
                console.log(`[WebRTC] Peer ${peerId} nicht mehr in Userliste. Schließe PeerConnection.`);
                closePeerConnection(peerId);
            }
        });

        currentRemoteUsers.forEach(async user => {
            if (!state.peerConnections.has(user.id)) {
                console.log(`[WebRTC] Neuer Peer ${user.username} (${user.id}) gefunden. Erstelle PeerConnection.`);
                const pc = await createPeerConnection(user.id);
                 addLocalStreamToPeerConnection(pc);

                 const shouldInitiateOffer = state.socketId < user.id;

                 if (shouldInitiateOffer) {
                      console.log(`[WebRTC] Bin Initiator für Peer ${user.id}. Erstelle initiales Offer.`);
                 } else {
                     console.log(`[WebRTC] Bin Receiver für Peer ${user.id}. Warte auf Offer.`);
                 }
            } else {
                 const pc = state.peerConnections.get(user.id);
                 addLocalStreamToPeerConnection(pc);
            }
        });
    }

    function closePeerConnection(peerId) {
        console.log(`[WebRTC] closePeerConnection aufgerufen für Peer: ${peerId}.`);
        const pc = state.peerConnections.get(peerId);

        if (pc) {
            console.log(`[WebRTC] Schließe PeerConnection mit ${peerId}.`);
             pc.getSenders().forEach(sender => {
                 if (sender.track) {
                     pc.removeTrack(sender);
                 }
             });

            pc.close();
            state.peerConnections.delete(peerId);
             console.log(`[WebRTC] PeerConnection mit ${peerId} gelöscht.`);
        } else {
             console.log(`[WebRTC] Keine PeerConnection mit ${peerId} zum Schließen gefunden.`);
        }

         removeRemoteAudioElement(peerId);
    }

    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
        state.peerConnections.forEach((pc, peerId) => {
            closePeerConnection(peerId);
        });
         state.peerConnections.clear();
         console.log("[WebRTC] Alle PeerConnections geschlossen.");
    }

    // --- Chat Logic ---
    function sendMessage() {
        console.log("sendMessage() aufgerufen.");
        const content = UI.messageInput.value.trim();
        if (!content) {
            console.log("sendMessage: Inhalt leer. Abbruch.");
            return;
        }

        if (!socket || !state.connected) {
            console.error("[Chat Send Error] Cannot send message. Not connected.");
            displayError("Nicht verbunden. Nachricht kann nicht gesendet werden.");
            return;
        }

        const message = {
             content,
             timestamp: new Date().toISOString(), // Zeitstempel weiterhin senden, auch wenn nicht angezeigt
             type: 'text'
        };

        console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`);
        socket.emit('message', message);


        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false);
    }

    // Fügt eine eingehende (oder eigene gesendete) Nachricht zum Chat hinzu
    function appendMessage(msg) {
         if (!msg || !msg.content || !msg.id || !msg.username) {
            console.warn("appendMessage: Ungültige Nachrichtendaten erhalten.", msg);
            return;
        }

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.id === state.socketId;
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username);
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.id));

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        contentDiv.textContent = escapeHTML(msg.content);

        // Zeitstempel-Logik entfernt


        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);

        UI.messagesContainer.appendChild(msgDiv);

        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20;
        if (isMe || isScrolledToBottom) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
    }

    function sendTyping(isTyping = true) {
        if (!socket || !state.connected || UI.messageInput.disabled) {
             return;
        }

        clearTimeout(state.typingTimeout);

        socket.emit('typing', { isTyping });

        if (isTyping) {
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- Init ---
    initializeUI();

});
