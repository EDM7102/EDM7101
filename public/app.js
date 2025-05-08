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
        fileInput: document.getElementById('fileInput'),
        fileUploadLabel: document.getElementById('fileUploadLabel'),
        micSelect: document.getElementById('micSelect'),
        remoteAudioControls: document.getElementById('remoteAudioControls') // Neues Element für Audio Controls
    };

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room', // Standardraum-ID
        socketId: null, // Eigene Socket-ID
        allUsersList: [], // Komplette Liste der Benutzer im Raum vom Server
        typingTimeout: null,
        typingUsers: new Set(),
        selectedFile: null,
        lastMessageTimestamp: 0, // Wird aktuell nicht verwendet, kann entfernt werden wenn nicht benötigt
        isWindowFocused: true, // Wird aktuell nicht verwendet
        unreadMessages: 0, // Wird aktuell nicht verwendet
        originalTitle: document.title, // Wird aktuell nicht verwendet
        // notificationSound: new Audio('notif.mp3'), // Optional: Bei Bedarf wieder aktivieren

        // WebRTC State
        localAudioStream: null, // Der Stream vom lokalen Mikrofon
        peerConnections: new Map(), // Map: socketId -> RTCPeerConnection
        remoteAudioElements: new Map(), // Map: socketId -> HTMLAudioElement
        localAudioMuted: false // Status, ob das eigene Mikrofon lokal gemutet ist
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500,
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5 MB
        IMAGE_PREVIEW_MAX_WIDTH: 200,
        IMAGE_PREVIEW_MAX_HEIGHT: 200,
        // ICE Server Konfiguration für WebRTC
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Weitere STUN/TURN Server hinzufügen, falls nötig (TURN erfordert Authentifizierung)
                // { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'password' },
            ],
             // iceCandidatePoolSize: 10, // Kann helfen, aber auch Traffic erhöhen
        },
        // Farben für Benutzer
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'],
    };

    // --- Initialisierung und UI-Helfer ---
    function initializeUI() {
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        UI.disconnectBtn.classList.add('hidden');
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.add('hidden');
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        if (UI.micSelect) UI.micSelect.disabled = false; // Mikrofonwahl vor Verbindung aktiv lassen
        updateRemoteAudioControls(); // UI für Remote Audio leeren/initialisieren
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
        if (UI.fileUploadLabel) UI.fileUploadLabel.classList.remove('hidden');
        if (UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true; // Mikrofonwahl während Verbindung sperren
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();

        // Lokalen Audio-Stream starten und zu PeerConnections hinzufügen
        setupLocalAudioStream();
         // populateMicList wird hier aufgerufen, nachdem ggf. Berechtigung erteilt wurde
        populateMicList();
    }

    function updateUIAfterDisconnect() {
        console.log("[UI] updateUIAfterDisconnect aufgerufen.");
        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
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

        // WebRTC Bereinigung
        stopLocalAudioStream();
        closeAllPeerConnections();
        updateRemoteAudioControls(); // UI für Remote Audio leeren

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

    // Fensterfokus/Blur Logik (optional, für Benachrichtigungen)
    // window.addEventListener('focus', () => { ... });
    // window.addEventListener('blur', () => { ... });
    // function notifyUnreadMessage() { ... }


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
    UI.fileInput.addEventListener('change', handleFileSelect);

    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        // Wenn verbunden, versuche den lokalen Stream mit dem neuen Mikrofon zu aktualisieren
        if (state.connected) {
            console.log("[WebRTC] Mikrofonauswahl geändert. Versuche lokalen Stream zu aktualisieren.");
            await setupLocalAudioStream(); // Ruft setLocalStream auf, was Tracks in PCs aktualisiert
        } else {
             console.log("[WebRTC] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
        }
    });

     // Event Listener für das lokale Mikrofon-Muting (wird dynamisch hinzugefügt)
     // Fügen wir einen Button im Sidebar hinzu, der das lokale Mikrofon umschaltet
     // Der Button muss nach dem Verbinden verfügbar sein. Fügen wir ihn in updateUIAfterConnect hinzu.


    window.addEventListener('beforeunload', () => {
        if (socket && socket.connected) {
            socket.disconnect();
        }
         // WebRTC Bereinigung bei Seitenwechsel/Schließen sicherstellen
         stopLocalAudioStream();
         closeAllPeerConnections();
    });


    // --- Utility Functions ---
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
        console.log("[Media] populateMicList aufgerufen.");
        if (!UI.micSelect) {
            console.warn("[Media] populateMicList: UI.micSelect nicht gefunden.");
            return;
        }
        UI.micSelect.innerHTML = ''; // Bestehende Optionen entfernen
        UI.micSelect.appendChild(new Option("Standard-Mikrofon", "", true, true)); // Standard-Option

        try {
             // enumerateDevices listet Geräte auf, erfordert aber in einigen Browsern/Fällen
             // dass zuvor schon mal getUserMedia erfolgreich war, um nicht-leere Labels zu bekommen.
             // Wir rufen es hier auf, nachdem getUserMedia in setupLocalAudioStream() versucht wird.
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length > 0) {
                 audioInputs.forEach(d => {
                      // Füge nur Geräte hinzu, die nicht der Standard sind, um Duplikate zu vermeiden
                      // und die ein Label haben.
                     if (d.deviceId !== 'default' && d.label) {
                          const opt = new Option(d.label, d.deviceId);
                          UI.micSelect.appendChild(opt);
                     }
                 });
                 console.log(`[Media] ${audioInputs.length} Mikrofone gefunden.`);
            } else {
                 console.warn("[Media] populateMicList: Keine Mikrofone gefunden.");
                 // Optional: Hinweis im UI
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
        state.allUsersList = usersArrayFromServer; // Komplette Liste vom Server
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        const otherUsers = usersArrayFromServer.filter(user => user.id !== state.socketId);

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

                // Füge hier den lokalen Mute-Button hinzu, falls er noch nicht existiert
                 let localMuteBtn = document.getElementById('localMuteBtn');
                 if (!localMuteBtn) {
                     localMuteBtn = document.createElement('button');
                     localMuteBtn.id = 'localMuteBtn';
                     localMuteBtn.textContent = 'Mikro stumm schalten';
                     localMuteBtn.classList.add('mute-btn'); // Reuse mute-btn style
                     localMuteBtn.addEventListener('click', toggleLocalAudioMute);
                     // Füge ihn unter der Mikrofonauswahl ein
                     UI.micSelect.parentNode.insertBefore(localMuteBtn, UI.connectBtn);
                 }
                  // Aktualisiere den Text/Klasse des lokalen Mute-Buttons basierend auf dem State
                 updateLocalMuteButtonUI();

            } else {
                li.appendChild(nameNode);
            }
            UI.userList.appendChild(li);
        });

         // Aktualisiere die Remote Audio Control UI und PeerConnections
         updateRemoteAudioControls(otherUsers);
         updatePeerConnections(otherUsers);

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

         UI.remoteAudioControls.innerHTML = ''; // Vorhandene Controls entfernen

         if (remoteUsers.length > 0) {
             const title = document.createElement('h3');
             title.textContent = 'Sprach-Teilnehmer';
             UI.remoteAudioControls.appendChild(title);

             remoteUsers.forEach(user => {
                 const itemDiv = document.createElement('div');
                 itemDiv.classList.add('remote-audio-item');
                 itemDiv.id = `remoteAudioItem_${user.id}`; // Eindeutige ID

                 const nameSpan = document.createElement('span');
                 nameSpan.textContent = escapeHTML(user.username);
                 nameSpan.style.color = escapeHTML(user.color || getUserColor(user.id)); // Zeige User-Farbe
                 itemDiv.appendChild(nameSpan);

                 // Hier könnten Lautstärkeregler oder Mute-Buttons für diesen Remote-Peer hinzugefügt werden
                 // Zum Beispiel ein einfacher Mute-Button für den Remote-Stream (lokal gesteuert)
                 const muteBtn = document.createElement('button');
                 muteBtn.textContent = 'Stumm schalten';
                 muteBtn.classList.add('mute-btn');
                 muteBtn.dataset.peerId = user.id; // Speichern der Peer-ID im Dataset
                 muteBtn.addEventListener('click', toggleRemoteAudioMute);
                 // Standardmäßig nicht gemutet, aber State müsste verwaltet werden, wenn UI den Status widerspiegeln soll
                 itemDiv.appendChild(muteBtn);


                 // Optional: Lautstärkeregler
                 // const volumeSlider = document.createElement('input');
                 // volumeSlider.type = 'range';
                 // volumeSlider.min = '0';
                 // volumeSlider.max = '1';
                 // volumeSlider.step = '0.01';
                 // volumeSlider.value = '1'; // Standardlautstärke
                 // volumeSlider.dataset.peerId = user.id;
                 // volumeSlider.addEventListener('input', setRemoteAudioVolume);
                 // itemDiv.appendChild(volumeSlider);


                 UI.remoteAudioControls.appendChild(itemDiv);

                 // Stelle sicher, dass ein <audio> Element für diesen Remote-Peer existiert (unsichtbar)
                  // und seine Audio-Quelle aktualisiert wird, wenn der Stream kommt.
                  ensureRemoteAudioElementExists(user.id);
             });
         }
         // Entferne Controls, wenn keine anderen Benutzer da sind.
         if (remoteUsers.length === 0 && UI.remoteAudioControls.firstChild) {
              UI.remoteAudioControls.innerHTML = '';
         }
    }

    // Stellt sicher, dass ein <audio> Element für einen Remote-Peer existiert
    function ensureRemoteAudioElementExists(peerId) {
        let audioElement = state.remoteAudioElements.get(peerId);
        if (!audioElement) {
            console.log(`[WebRTC] Erstelle neues Audio-Element für Peer ${peerId}.`);
            audioElement = new Audio();
            audioElement.autoplay = true; // Automatische Wiedergabe
            // audioElement.controls = true; // Controls nur zum Debugging
            audioElement.style.display = 'none'; // Unsichtbar halten
            document.body.appendChild(audioElement); // Zum DOM hinzufügen

            state.remoteAudioElements.set(peerId, audioElement);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} erstellt und hinzugefügt.`);

             // Event Listener für Lautstärkeregelung/Mute hinzufügen, wenn das Element existiert
             const muteButton = UI.remoteAudioControls.querySelector(`.mute-btn[data-peer-id='${peerId}']`);
             if (muteButton) {
                 // Status des Buttons basierend auf dem initialen gemuteten State setzen (Standard: false)
                  muteButton.classList.toggle('muted', audioElement.muted);
                  muteButton.textContent = audioElement.muted ? 'Stumm AN' : 'Stumm schalten'; // Initialer Text
             }
              // Optional: Lautstärkeregler Event Listener hinzufügen
              // const volumeSlider = UI.remoteAudioControls.querySelector(`input[type='range'][data-peer-id='${peerId}']`);
              // if (volumeSlider) {
              //     volumeSlider.value = audioElement.volume;
              // }

        }
         // Das Audio-Element bleibt im DOM, bis der Peer die Verbindung trennt.
         return audioElement;
    }


     // Entfernt das Audio-Element eines Remote-Peers
    function removeRemoteAudioElement(peerId) {
         const audioElement = state.remoteAudioElements.get(peerId);
         if (audioElement) {
             console.log(`[WebRTC] Entferne Audio-Element für Peer ${peerId}.`);
             audioElement.pause();
             audioElement.srcObject = null; // Quelle entfernen
             audioElement.remove(); // Aus dem DOM entfernen
             state.remoteAudioElements.delete(peerId);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} entfernt.`);
         }
         // Entferne auch die UI Controls für diesen Peer
         const itemDiv = document.getElementById(`remoteAudioItem_${peerId}`);
         if (itemDiv) {
             itemDiv.remove();
         }
         // Wenn keine Remote-Audio-Items mehr da sind, entferne den Titel
          if (UI.remoteAudioControls && !UI.remoteAudioControls.querySelector('.remote-audio-item')) {
              updateRemoteAudioControls();
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

         // Alle Audio-Tracks im lokalen Stream muten/entmuten
         state.localAudioStream.getAudioTracks().forEach(track => {
             track.enabled = !state.localAudioMuted; // 'enabled = false' mutet den Track
         });

         // Aktualisiere den lokalen Mute-Button in der UI
         updateLocalMuteButtonUI();

         // Optional: Signalisiere anderen, dass du dich gemutet hast (erfordert zusätzliche Socket.IO Events)
         // socket.emit('muteStatusChange', { muted: state.localAudioMuted });
    }

     // Aktualisiert die UI des lokalen Mute-Buttons
     function updateLocalMuteButtonUI() {
         const localMuteBtn = document.getElementById('localMuteBtn');
         if (localMuteBtn) {
             localMuteBtn.textContent = state.localAudioMuted ? 'Mikro Stumm AN' : 'Mikro stumm schalten';
             localMuteBtn.classList.toggle('muted', state.localAudioMuted);
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

         // Aktualisiere den Button-Text/Klasse in der UI
         event.target.textContent = audioElement.muted ? 'Stumm AN' : 'Stumm schalten';
         event.target.classList.toggle('muted', audioElement.muted);
     }

    // Optional: Setzt die Lautstärke eines Remote-Audio-Streams lokal
    // function setRemoteAudioVolume(event) {
    //     const peerId = event.target.dataset.peerId;
    //     const volume = parseFloat(event.target.value);
    //      const audioElement = state.remoteAudioElements.get(peerId);
    //      if (audioElement) {
    //          audioElement.volume = volume;
    //          console.log(`[WebRTC] Lautstärke für Peer ${peerId} auf ${volume} gesetzt.`);
    //      }
    // }


    // --- WebSocket Logic ---
    function connect() {
        console.log("[Socket.IO] connect() aufgerufen.");
        const serverUrl = window.location.origin;
        const roomId = state.roomId; // Standardraum
        let username = UI.usernameInput.value.trim();

        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username;
        state.username = username; // Update state immediately

        console.log(`[Socket.IO] Verbinde mit ${serverUrl} in Raum ${state.roomId} als ${state.username}`);

        // Wenn Socket bereits existiert, trennen und neu erstellen
        if (socket) {
            console.log("[Socket.IO] Bestehende Socket-Instanz gefunden, wird getrennt.");
            socket.disconnect();
        }

        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId },
            transports: ['websocket'],
            forceNew: true // Erzwingt eine neue Socket-Verbindung
        });
        setConnectionStatus('connecting', 'Verbinde...');
        setupSocketListeners();
    }

    function setupSocketListeners() {
        if (!socket) return;
        console.log("[Socket.IO] setupSocketListeners aufgerufen.");

        socket.on('connect', () => {
            console.log('[Socket.IO] "connect" event erhalten. Socket verbunden auf Transport:', socket.io.engine.transport.name, 'Socket ID:', socket.id);
             // Eigene ID und Userliste kommt mit 'joinSuccess'
        });

        socket.on('connect_error', (err) => {
            console.error('[Socket.IO] "connect_error" erhalten:', err.message, err.data);
            state.connected = false;
            displayError(`Verbindungsfehler: ${err.message}. Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            // disconnect() wird vom Client ausgelöst, unser disconnect Handler wird aufgerufen
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] "disconnect" event erhalten: ${reason}`);
            state.connected = false;
            displayError(`Verbindung getrennt: ${reason}`);
            updateUIAfterDisconnect(); // Bereinigung und UI-Reset
        });

        socket.on('joinSuccess', ({ users: currentUsers, id: myId }) => {
            console.log(`[Socket.IO] "joinSuccess" event erhalten. Dein Socket ID: ${myId}, Benutzer im Raum:`, currentUsers);
            state.connected = true;
            state.socketId = myId;
             // Finde den eigenen User in der Liste, um den Server-seitig zugewiesenen Namen/Farbe zu erhalten
             const selfUser = currentUsers.find(u => u.id === myId);
             if(selfUser) {
                  state.username = selfUser.username; // Übernehme den finalen Namen vom Server
             }
            updateUIAfterConnect(); // UI anpassen, lokalen Stream starten etc.
            updateUserList(currentUsers); // Userliste aktualisieren und PeerConnections initiieren
        });

        socket.on('joinError', ({ message }) => {
            console.error(`[Socket.IO] "joinError" erhalten: ${message}`);
            displayError(message);
            // Der Server sollte nach joinError die Verbindung trennen, was disconnect() auslöst.
            // Falls nicht, sorgt forceNew: true im connect() und der folgende disconnect() Aufruf
            // für eine Bereinigung. updateUIAfterDisconnect() im disconnect Handler
            // stellt sicher, dass die UI zurückgesetzt wird.
        });

        socket.on('userListUpdate', (currentUsersList) => {
            console.log("[Socket.IO] Benutzerliste aktualisiert:", currentUsersList);
             // updatePeerConnections und updateRemoteAudioControls werden von updateUserList aufgerufen.
            updateUserList(currentUsersList);
        });

        socket.on('chatMessage', (message) => {
            appendMessage(message);
            // optional: notifyUnreadMessage();
        });

        socket.on('file', (fileMsgData) => {
            appendMessage({ ...fileMsgData, type: 'file' });
            // optional: notifyUnreadMessage();
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
        // Empfängt WebRTC Signale vom Server, die von anderen Peers gesendet wurden
        socket.on('webRTC-signal', async ({ from, type, payload }) => {
             console.log(`[WebRTC Signal] Empfange '${type}' von Peer ${from}.`);
             // Ignoriere Signale von uns selbst
             if (from === state.socketId) {
                 console.warn("[WebRTC Signal] Empfange eigenes Signal. Ignoriere.");
                 return;
             }

             // Stelle sicher, dass eine PeerConnection für diesen Peer existiert
             let pc = state.peerConnections.get(from);
             if (!pc) {
                 console.warn(`[WebRTC Signal] Empfange Signal von unbekanntem Peer ${from}. Erstelle PeerConnection.`);
                 // Erstelle eine neue PC für den Peer, der uns signalisiert hat (falls sie noch nicht existiert)
                 pc = await createPeerConnection(from);
                 // Füge lokalen Stream hinzu, nachdem die PC erstellt wurde
                 addLocalStreamToPeerConnection(pc); // Füge lokale Tracks zu der neuen PC hinzu
             }

            try {
                 if (type === 'offer') {
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Offer). Signaling State: ${pc.signalingState}`);
                    // Wenn wir bereits ein lokales Angebot haben (Glare), müssen wir entscheiden, wer "polite" ist.
                    // Hier nehmen wir an, der Peer mit der kleineren ID ist "polite".
                    const isPolite = state.socketId < from;

                    if (pc.signalingState !== 'stable' && pc.localDescription && isPolite) {
                         console.warn(`[WebRTC Signal] Peer ${from}: Glare erkannt (stable=${pc.signalingState}, localDesc=${!!pc.localDescription}, polite=${isPolite}). Rollback nötig.`);
                        // Rollback (recreate offer) oder einfach Fehler melden und neue Negotiation abwarten
                        // Einfachste: Alten Offer ignorieren und neu erstellen, wenn negotiationneeded feuert.
                        // Alternativ: Unified Plan Glare Handling implementieren (Rollback).
                        // Für dieses Beispiel ignorieren wir das eingehende Offer bei Glare, wenn wir polite sind.
                         displayError(`Glare detected with peer ${from}. Negotiation might restart.`);
                         return; // Ignoriere das Offer bei Glare, wenn polite
                    }


                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                    console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Offer) gesetzt. Signaling State: ${pc.signalingState}`);

                    console.log(`[WebRTC Signal] Peer ${from}: Erstelle Answer.`);
                    const answer = await pc.createAnswer();
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Local Description (Answer).`);
                    await pc.setLocalDescription(answer);
                    console.log(`[WebRTC Signal] Peer ${from}: Local Description (Answer) gesetzt. Signaling State: ${pc.signalingState}`);

                    console.log(`[WebRTC Signal] Peer ${from}: Sende Answer.`);
                    socket.emit('webRTC-signal', { to: from, type: 'answer', payload: pc.localDescription });

                 } else if (type === 'answer') {
                     console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Answer). Signaling State: ${pc.signalingState}`);
                    // Nur setzen, wenn wir ein lokales Angebot haben (have-local-offer)
                    if (pc.signalingState === 'have-local-offer') {
                        await pc.setRemoteDescription(new RTCSessionDescription(payload));
                         console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Answer) gesetzt. Signaling State: ${pc.signalingState}`);
                    } else {
                        console.warn(`[WebRTC Signal] Peer ${from}: Empfange Answer im falschen Signaling State (${pc.signalingState}). Ignoriere.`);
                    }

                 } else if (type === 'candidate') {
                     console.log(`[WebRTC Signal] Peer ${from}: Füge ICE Candidate hinzu.`);
                     try {
                         // Ein Kandidat kann auch hinzugefügt werden, wenn remoteDescription noch null ist.
                         // Der Browser puffert sie dann intern.
                        await pc.addIceCandidate(new RTCIceCandidate(payload));
                        console.log(`[WebRTC Signal] Peer ${from}: ICE Candidate erfolgreich hinzugefügt.`);
                     } catch (e) {
                         console.error(`[WebRTC Signal] Peer ${from}: Fehler beim Hinzufügen des ICE Kandidaten:`, e);
                         // Dies kann passieren, wenn das Remote Description noch nicht gesetzt ist
                         // oder der Kandidat ungültig ist.
                     }

                 } else {
                     console.warn(`[WebRTC Signal] Unbekannter Signal-Typ '${type}' von Peer ${from} empfangen.`);
                 }
            } catch (err) {
                console.error(`[WebRTC Signal Error] Fehler bei Verarbeitung von Signal '${type}' von Peer ${from}:`, err);
                displayError(`Fehler bei Audio-Verhandlung mit Peer ${from}.`);
                // Bei schwerwiegenden Fehlern: PeerConnection schließen und neu versuchen
                // closePeerConnection(from);
            }
        });
    } // End setupSocketListeners


    function disconnect() {
        console.log("[Socket.IO] Trenne Verbindung manuell.");
        if (socket) {
            socket.disconnect(); // Triggert das 'disconnect' Event
        } else {
            console.log("[Socket.IO] Kein Socket zum Trennen gefunden.");
            updateUIAfterDisconnect();
        }
    }

    // --- Chat Logic ---
    function sendMessage() {
        console.log("sendMessage() aufgerufen.");
        const content = UI.messageInput.value.trim();
        if (!content && !state.selectedFile) {
            console.log("sendMessage: Kein Inhalt oder Datei ausgewählt. Abbruch.");
            return;
        }

        if (!socket || !state.connected) {
            console.error("[Chat Send Error] Cannot send message. Not connected.");
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
                    // dataUrl wird unten hinzugefügt, falls es ein Bild ist
                }
            };

            if (state.selectedFile.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    message.file.dataUrl = e.target.result;
                    console.log(`sendMessage: Sende Bilddatei "${message.file.name}" (${formatFileSize(message.file.size)})`);
                    // Sende an den Server
                    socket.emit('file', message);
                    resetFileInput();
                };
                reader.onerror = (err) => {
                    console.error("[File Send] Fehler beim Lesen der Bilddatei:", err);
                    displayError("Fehler beim Lesen der Bilddatei.");
                    resetFileInput();
                };
                reader.readAsDataURL(state.selectedFile);
            } else { // For other file types (send metadata only, data transfer needs separate logic if desired)
                 console.log(`sendMessage: Sende Datei-Info für "${message.file.name}" (${formatFileSize(state.selectedFile.size)})`);
                 // Für Nicht-Bild-Dateien senden wir nur die Metadaten an den Server.
                 // Die Datei selbst wird NICHT über Socket.IO gesendet, da dies ineffizient ist.
                 // Eine tatsächliche Dateiübertragung müsste separat implementiert werden (z.B. Server-Upload).
                 // Das Empfangen im appendMessage zeigt nur den Namen und Größe.
                socket.emit('file', message);
                resetFileInput();
            }
        } else { // Normal text message
            const message = { ...messageBase, type: 'text' };
            console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`);
            socket.emit('message', message);
        }

        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false); // Reset typing status
    }

    // Fügt eine eingehende (oder eigene gesendete, falls Server Echo sendet) Nachricht zum Chat hinzu
    function appendMessage(msg) {
        // Server sendet id, username, color, content, timestamp, type, [file]
         if (!msg || (!msg.content && !msg.file)) {
            console.warn("appendMessage: Ungültige Nachrichtendaten erhalten.", msg);
            return;
        }
         // Ignoriere Nachrichten ohne ID, falls sie auftreten (sollten nicht, da Server sie hinzufügen sollte)
         if (!msg.id) {
             console.warn("appendMessage: Nachricht ohne Sender-ID erhalten.", msg);
             // Ersetze durch Dummy-ID oder ignoriere? Ignorieren wir vorerst.
             // return;
             // Fallback: Wenn keine ID da ist, vergleiche Usernamen (ungenauer)
             const isMe = msg.username === state.username;
             msg.id = isMe ? state.socketId : 'unknown'; // Dummy ID
         }


        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        // Identifiziere eigene Nachrichten anhand der Socket ID vom Server
        const isMe = msg.id === state.socketId;
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username || 'Unbekannt'); // Fallback-Name
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.id || msg.username)); // Fallback-Farbe

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');

        if (msg.type === 'file' && msg.file) {
            const fileInfo = document.createElement('div');
            fileInfo.classList.add('file-attachment');

            // Anzeige für Bild-Dateien mit Data-URL
            if (msg.file.dataUrl && msg.file.type && msg.file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = msg.file.dataUrl;
                img.alt = escapeHTML(msg.file.name || 'Bilddatei');
                img.style.maxWidth = `${CONFIG.IMAGE_PREVIEW_MAX_WIDTH}px`;
                img.style.maxHeight = `${CONFIG.IMAGE_PREVIEW_MAX_HEIGHT}px`;
                // Optional: Scrollen, nachdem das Bild geladen ist, falls es sichtbar ist
                img.onload = () => {
                    const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20;
                    if (isMe || isScrolledToBottom) {
                         UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
                    }
                };
                img.onclick = () => openImageModal(img.src); // Klick öffnet Modal
                fileInfo.appendChild(img);
                 // Füge den Dateinamen/Größe unter dem Bild hinzu
                 const fileNameSpan = document.createElement('span');
                 fileNameSpan.textContent = `${escapeHTML(msg.file.name || 'Unbekannte Datei')} (${formatFileSize(msg.file.size || 0)})`;
                 fileNameSpan.style.display = 'block'; // Unter das Bild setzen
                 fileNameSpan.style.marginTop = '5px';
                 fileNameSpan.style.fontSize = '0.85em';
                 fileNameSpan.style.color = 'var(--text-muted-color)';
                 fileInfo.appendChild(fileNameSpan);


            } else { // Anzeige für andere Dateitypen (nur Icon und Name/Größe)
                 // Füge ein generisches Icon
                const iconSpan = document.createElement('span');
                iconSpan.className = 'file-icon';
                 if (msg.file.type && msg.file.type.includes('text')) iconSpan.textContent = '📄';
                 else if (msg.file.type && msg.file.type.includes('pdf')) iconSpan.textContent = 'PDF ';
                 else if (msg.file.type && (msg.file.type.includes('zip') || msg.file.type.includes('rar'))) iconSpan.textContent = '📦';
                 else if (msg.file.type && msg.file.type.includes('audio')) iconSpan.textContent = '🎵';
                 else if (msg.file.type && msg.file.type.includes('video')) iconSpan.textContent = '🎬';
                 else if (msg.file.type && (msg.file.type.includes('document') || msg.file.type.includes('word'))) iconSpan.textContent = ' DOC ';
                 else if (msg.file.type && (msg.file.type.includes('spreadsheet') || msg.file.type.includes('excel'))) iconSpan.textContent = ' XLS ';
                 else if (msg.file.type && (msg.file.type.includes('presentation') || msg.file.type.includes('powerpoint'))) iconSpan.textContent = ' PPT ';
                 else iconSpan.textContent = '📎';
                fileInfo.appendChild(iconSpan);

                // Füge den Dateinamen und die Größe hinzu
                const fileDetails = document.createElement('span');
                fileDetails.textContent = `${escapeHTML(msg.file.name || 'Unbekannte Datei')} (${formatFileSize(msg.file.size || 0)})`;
                 fileInfo.appendChild(fileDetails);

                 // Optional: Wenn Server die Datei gehostet hätte, hier einen Link erstellen
                 // if (msg.file.url) { ... }
            }

            // Füge optionalen Textinhalt unter dem Dateianhang hinzu
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
            const date = new Date(msg.timestamp);
             if (!isNaN(date.getTime())) {
                timeSpan.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
             } else {
                timeSpan.textContent = "Datum Fehler";
             }
        } catch (e) { timeSpan.textContent = "Datum Fehler"; }


        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);
        msgDiv.appendChild(timeSpan);
        UI.messagesContainer.appendChild(msgDiv);

        // Automatisch nach unten scrollen, wenn es die eigene Nachricht ist oder man nahe am Ende ist
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20;
        if (isMe || isScrolledToBottom) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
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
        img.onclick = (event) => event.stopPropagation(); // Klick auf Bild schließt Modal nicht
        img.alt = "Vollbildansicht";

        modal.appendChild(img);
        document.body.appendChild(modal);
    }


    function sendTyping(isTyping = true) {
        if (!socket || !state.connected) {
             return;
        }
        if(UI.messageInput.disabled) {
             return;
        }

        clearTimeout(state.typingTimeout);

        // Sende Tipp-Event an den Server
        socket.emit('typing', { isTyping });

        if (isTyping) {
            // Setze Timeout, um nach einer Pause 'false' zu senden
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
    }

    // --- WebRTC Logic (Multi-Peer Audio) ---

    // Holt den lokalen Audio-Stream (Mikrofon)
    async function setupLocalAudioStream() {
        console.log("[WebRTC] setupLocalAudioStream aufgerufen.");
        // Beende den alten Stream, falls vorhanden
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
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined // Nutze selectedMicId
            };
            console.log("[WebRTC] Versuche, lokalen Audio-Stream zu holen mit Constraints:", audioConstraints);

            // Hole nur Audio, kein Video
            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints
            });
            state.localAudioStream = stream;
            console.log(`[WebRTC] Lokaler Audio-Stream erhalten: ${stream.id}. Tracks: Audio: ${stream.getAudioTracks().length}`);

            // Aktualisiere die lokalen PeerConnections mit dem neuen/aktualisierten Stream
            state.peerConnections.forEach(pc => {
                addLocalStreamToPeerConnection(pc);
            });

             // Aktualisiere die UI des lokalen Mute-Buttons nach dem Stream-Setup
             updateLocalMuteButtonUI();


            return true; // Erfolgreich
        } catch (err) {
            console.error('[WebRTC] Fehler beim Zugriff auf das Mikrofon:', err.name, err.message);
             displayError(`Mikrofonzugriff fehlgeschlagen: ${err.message}. Bitte erlaube den Zugriff.`);
             // Optional: Deaktiviere Mikrofonwahl und Audio-Features in der UI
             if (UI.micSelect) UI.micSelect.disabled = true;
             const localMuteBtn = document.getElementById('localMuteBtn');
             if(localMuteBtn) localMuteBtn.disabled = true;

            return false; // Fehlgeschlagen
        }
    }

    // Stoppt den lokalen Audio-Stream
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
         // Setze den lokalen Mute-Button zurück
         const localMuteBtn = document.getElementById('localMuteBtn');
         if(localMuteBtn) {
              localMuteBtn.removeEventListener('click', toggleLocalAudioMute);
             localMuteBtn.remove(); // Entferne den Button aus dem DOM
         }
         state.localAudioMuted = false; // Reset mute state
    }


    // Erstellt eine neue RTCPeerConnection für einen spezifischen Peer
    async function createPeerConnection(peerId) {
        console.log(`[WebRTC] createPeerConnection aufgerufen für Peer: ${peerId}.`);
        // Wenn bereits eine PC für diesen Peer existiert, gib sie zurück (sollte durch updatePeerConnections gehandhabt werden)
        if (state.peerConnections.has(peerId)) {
            console.warn(`[WebRTC] PeerConnection mit ${peerId} existiert bereits. Gebe vorhandene zurück.`);
            return state.peerConnections.get(peerId);
        }

        console.log(`[WebRTC] Erstelle neue RTCPeerConnection für Peer: ${peerId}`);
        const pc = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.peerConnections.set(peerId, pc); // Speichere die PC im State

        // ICE Candidate Handling: Sende Kandidaten über Socket.IO an den Signaling Server
        pc.onicecandidate = event => {
            if (event.candidate && socket && state.connected) {
                 console.log(`[WebRTC] Sende ICE candidate zu Peer ${peerId}.`);
                // Sende das Signal über den Server an den spezifischen Peer
                socket.emit('webRTC-signal', {
                    to: peerId,
                    type: 'candidate',
                    payload: event.candidate // Das RTCIceCandidate Objekt
                });
            } else if (!event.candidate) {
                console.log(`[WebRTC] ICE candidate gathering für Peer ${peerId} beendet.`);
            }
        };

        // Remote Track Handling: Wenn ein Track (Audio) von einem Peer empfangen wird
        pc.ontrack = event => {
            console.log(`[WebRTC] Empfange remote track von Peer ${peerId}. Track Kind: ${event.track.kind}, Stream ID(s): ${event.streams ? event.streams.map(s => s.id).join(', ') : 'No Stream'}`);
            // Wir erwarten hier nur Audio-Tracks
            if (event.track.kind === 'audio') {
                // Stelle sicher, dass ein Audio-Element für diesen Peer existiert
                 const audioElement = ensureRemoteAudioElementExists(peerId);

                // Verbinde den Stream mit dem Audio-Element
                 // Ein einzelner Stream kann mehrere Tracks enthalten (z.B. Audio + Video),
                 // aber für reinen Audio-Chat sollten es nur Audio-Tracks sein.
                 // Der Browser gruppiert Tracks automatisch in Streams.
                 if (event.streams && event.streams[0]) {
                     console.log(`[WebRTC] Verbinde Remote Audio Stream ${event.streams[0].id} mit Audio-Element für Peer ${peerId}.`);
                     audioElement.srcObject = event.streams[0];
                 } else {
                     // Fallback: Erstelle einen neuen Stream aus dem einzelnen Track
                      console.log(`[WebRTC] Verbinde einzelnen Remote Audio Track ${event.track.id} mit Audio-Element für Peer ${peerId}.`);
                     const remoteStream = new MediaStream([event.track]);
                      audioElement.srcObject = remoteStream;
                 }

                 // Event Listener für das Ende des Remote-Tracks (wenn der Peer die Verbindung trennt oder stopt)
                 event.track.onended = () => {
                     console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                     // Wenn alle Tracks vom Peer beendet sind (z.B. Peer verlässt den Raum),
                     // sollten wir die PeerConnection schließen und das Audio-Element entfernen.
                     // Dies wird normalerweise durch das userListUpdate beim disconnect gehandhabt,
                     // aber dieser Listener bietet eine zusätzliche Absicherung.
                     // Hier prüfen wir einfach, ob die PC noch verbunden ist.
                      if (pc.iceConnectionState !== 'closed' && pc.iceConnectionState !== 'failed') {
                           // Track ist einzeln beendet, aber die PC ist noch aktiv.
                           console.log(`[WebRTC] Track ${event.track.id} beendet, aber PC mit ${peerId} ist noch aktiv.`);
                           // Möglicherweise muss srcObject neu zugewiesen werden, falls andere Tracks noch aktiv sind (nicht in unserem reinen Audio Fall)
                      } else {
                           console.log(`[WebRTC] Track ${event.track.id} beendet, PC mit ${peerId} ist bereits geschlossen oder fehlgeschlagen.`)
                      }
                 };

                  // Optional: onmute/onunmute Listener hinzufügen, um UI zu aktualisieren
                 event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.onunmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);
            }
        };

        // ICE Connection State Change Handling: Verfolgt den Verbindungsstatus mit dem Peer
        pc.oniceconnectionstatechange = () => {
             if (!pc) return;
            const pcState = pc.iceConnectionState;
             const peerUser = state.allUsersList.find(u => u.id === peerId);
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] ICE Connection Status zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
            // Optional: UI aktualisieren basierend auf dem Status (z.B. Symbol neben Benutzername)
            switch (pcState) {
                case "new": case "checking":
                    // Verbindungsaufbau läuft
                    break;
                case "connected":
                    console.log(`[WebRTC] ICE 'connected': Erfolgreich verbunden mit Peer '${peerUsername}'. Audio sollte fließen.`);
                    // Optional: UI anzeigen, dass Audio aktiv ist (z.B. grüner Punkt)
                    break;
                case "completed":
                    console.log(`[WebRTC] ICE 'completed': Alle Kandidaten für Peer '${peerUsername}' geprüft.`);
                    break;
                case "disconnected":
                    console.warn(`[WebRTC] ICE 'disconnected': Verbindung zu Peer '${peerUsername}' unterbrochen. Versuche erneut...`);
                    // Optional: UI anzeigen, dass Verbindung unterbrochen ist (z.B. gelber Punkt)
                    break;
                case "failed":
                    console.error(`[WebRTC] ICE 'failed': Verbindung zu Peer '${peerUsername}' fehlgeschlagen.`);
                    displayError(`Audio-Verbindung zu ${peerUsername} fehlgeschlagen.`);
                    // Bei fehlgeschlagener Verbindung, PC schließen und aus Map entfernen
                     closePeerConnection(peerId);
                    break;
                case "closed":
                    console.log(`[WebRTC] ICE 'closed': Verbindung zu Peer '${peerUsername}' wurde geschlossen.`);
                     // Bei geschlossener Verbindung, PC aus Map entfernen und Audio-Element entfernen
                     closePeerConnection(peerId); // Stellt sicher, dass Bereinigung läuft
                    break;
            }
        };

         // Signaling State Change Handling: Verfolgt den Zustand des SDP-Austauschs
        pc.onsignalingstatechange = () => {
            if (!pc) return;
            const pcState = pc.signalingState;
             const peerUser = state.allUsersList.find(u => u.id === peerId);
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] Signaling State zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
             // onnegotiationneeded feuert im 'stable' -> 'have-local-offer' Übergang.
        };

        // Negotiation Needed Handling: Wenn der Browser denkt, dass SDP neu ausgehandelt werden muss
        pc.onnegotiationneeded = async () => {
             console.log(`[WebRTC] onnegotiationneeded Event für Peer ${peerId} ausgelöst.`);
            // Prüfe, ob wir der "Polite" Peer sind (basierend auf ID-Vergleich), um Glare zu vermeiden.
            // Der "Polite" Peer erstellt nur ein Angebot, wenn der Signaling State 'stable' ist.
            // Der "Impolite" Peer kann auch im State 'have-remote-offer' ein Angebot erstellen.
             const isPolite = state.socketId < peerId;

             if (pc.signalingState !== 'stable' && isPolite) {
                 console.log(`[WebRTC] Peer ${peerId}: Bin Polite (${isPolite}). Signaling State ist nicht 'stable' (${pc.signalingState}). Überspringe Offer Erstellung.`);
                 return; // Polite Peers erstellen Offer nur im stable State
             }

             if (pc.signalingState === 'have-local-offer' && isPolite) {
                  console.log(`[WebRTC] Peer ${peerId}: Glare Situation (have-local-offer, Polite). Warte auf eingehendes Offer (Rollback).`);
                   // Hier könnte komplexeres Glare Handling nötig sein, aber oft genügt es, das eingehende Offer zu verarbeiten.
                   return;
             }

             console.log(`[WebRTC] Peer ${peerId}: Erstelle Offer. Signaling State: ${pc.signalingState}. Bin Polite? ${isPolite}.`);
             try {
                 const offer = await pc.createOffer();
                 console.log(`[WebRTC] Peer ${peerId}: Offer erstellt. Setze Local Description.`);
                 await pc.setLocalDescription(offer);
                 console.log(`[WebRTC] Peer ${peerId}: Local Description (Offer) gesetzt. Sende Offer an Server.`);

                 // Sende das Offer über den Server an den spezifischen Peer
                 socket.emit('webRTC-signal', {
                     to: peerId,
                     type: 'offer',
                     payload: pc.localDescription // Das RTCSessionDescription Objekt (Offer)
                 });

             } catch (err) {
                 console.error(`[WebRTC] Peer ${peerId}: Fehler bei Offer Erstellung oder Setzung:`, err);
                 displayError(`Fehler bei Audio-Verhandlung (Offer) mit Peer ${peerId}.`);
                 // Bei Fehler: PeerConnection schließen und aus Map entfernen
                 closePeerConnection(peerId);
             }
        };

        // Hier werden noch KEINE Tracks hinzugefügt. Das passiert, nachdem der lokale Stream geholt wurde.
        // addLocalStreamToPeerConnection(pc); // Nicht hier aufrufen, sondern nachdem Stream da ist

        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc;
    }

    // Fügt den lokalen Stream (Tracks) zu einer PeerConnection hinzu
    function addLocalStreamToPeerConnection(pc) {
        if (!state.localAudioStream || !pc) {
            console.warn("[WebRTC] addLocalStreamToPeerConnection: Lokaler Stream oder PC ist null.");
            return;
        }
         console.log(`[WebRTC] Füge lokalen Audio-Stream Tracks zu PeerConnection hinzu.`);

         // Entferne vorhandene Audio-Sender, um Duplikate zu vermeiden, bevor neue hinzugefügt werden
         pc.getSenders().forEach(sender => {
             if (sender.track && sender.track.kind === 'audio') {
                 console.log(`[WebRTC] Entferne vorhandenen Audio-Sender für Track ${sender.track.id}.`);
                 pc.removeTrack(sender);
             }
         });

        // Füge alle Audio-Tracks vom lokalen Stream zur PeerConnection hinzu
        state.localAudioStream.getAudioTracks().forEach(track => {
             console.log(`[WebRTC] Füge lokalen Audio Track ${track.id} hinzu (Enabled: ${track.enabled}).`);
            pc.addTrack(track, state.localAudioStream); // stream association is optional but good practice
        });
         console.log("[WebRTC] Lokale Audio-Tracks zur PC hinzugefügt.");

        // Das Hinzufügen/Entfernen von Tracks sollte ein 'onnegotiationneeded' Event auslösen.
    }


    // Aktualisiert die Menge der PeerConnections basierend auf der aktuellen Benutzerliste
    // Erstellt PCs für neue Benutzer und schließt PCs für Benutzer, die gegangen sind
    function updatePeerConnections(currentRemoteUsers) {
        console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote User: ${currentRemoteUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

        // Schließe PCs für Benutzer, die nicht mehr in der Liste sind
        state.peerConnections.forEach((pc, peerId) => {
            const peerStillExists = currentRemoteUsers.some(user => user.id === peerId);
            if (!peerStillExists) {
                console.log(`[WebRTC] Peer ${peerId} nicht mehr in Userliste. Schließe PeerConnection.`);
                closePeerConnection(peerId);
            }
        });

        // Erstelle PCs für neue Benutzer in der Liste
        currentRemoteUsers.forEach(async user => {
            if (!state.peerConnections.has(user.id)) {
                console.log(`[WebRTC] Neuer Peer ${user.username} (${user.id}) gefunden. Erstelle PeerConnection.`);
                const pc = await createPeerConnection(user.id);

                // Füge den lokalen Stream hinzu, NACHDEM die PC erstellt wurde
                // Dies triggert onnegotiationneeded, falls wir Initiator sind
                 addLocalStreamToPeerConnection(pc);

                 // Bestimme, ob wir der Initiator (Offer-Ersteller) sein sollen
                 // Der Peer mit der kleineren ID initiiert (Polite/Impolite)
                 const shouldInitiateOffer = state.socketId < user.id;

                 if (shouldInitiateOffer) {
                      console.log(`[WebRTC] Bin Initiator für Peer ${user.id}. Erstelle initiales Offer.`);
                     // Das onnegotiationneeded Event sollte getriggert werden und das Offer erstellen/senden.
                     // Manchmal muss man es explizit triggern, aber addTrack sollte reichen.
                     // await pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
                     //    socket.emit('webRTC-signal', { to: user.id, type: 'offer', payload: pc.localDescription });
                     // }).catch(e => console.error("Manual offer error:", e));
                 } else {
                     console.log(`[WebRTC] Bin Receiver für Peer ${user.id}. Warte auf Offer.`);
                 }
            } else {
                // console.log(`[WebRTC] Peer ${user.id} existiert bereits. PC wird wiederverwendet.`);
                // Wenn die PC bereits existiert, stelle sicher, dass der aktuelle lokale Stream hinzugefügt ist
                const pc = state.peerConnections.get(user.id);
                 addLocalStreamToPeerConnection(pc); // Stellt sicher, dass Tracks aktuell sind (verwendet replaceTrack intern)
            }
        });
    }


    // Schließt eine spezifische PeerConnection und bereinigt zugehörige Ressourcen
    function closePeerConnection(peerId) {
        console.log(`[WebRTC] closePeerConnection aufgerufen für Peer: ${peerId}.`);
        const pc = state.peerConnections.get(peerId);

        if (pc) {
            console.log(`[WebRTC] Schließe PeerConnection mit ${peerId}.`);
            // Stoppe alle Sender-Tracks (nicht die Tracks im lokalen Stream selbst)
             pc.getSenders().forEach(sender => {
                 // sender.track.stop(); // Stoppt den Track im lokalen Stream, nicht gut!
                 // removeTrack reicht, um den Sender zu entfernen. Der lokale Stream bleibt aktiv.
                 if (sender.track) {
                     pc.removeTrack(sender); // Entfernt den Sender, nicht den Track selbst
                 }
             });

            pc.close();
            state.peerConnections.delete(peerId);
             console.log(`[WebRTC] PeerConnection mit ${peerId} gelöscht.`);
        } else {
             console.log(`[WebRTC] Keine PeerConnection mit ${peerId} zum Schließen gefunden.`);
        }

         // Entferne auch das zugehörige Remote Audio Element und UI Controls
         removeRemoteAudioElement(peerId);
    }

    // Schließt ALLE PeerConnections (z.B. bei Trennung vom Server)
    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
        state.peerConnections.forEach((pc, peerId) => {
            closePeerConnection(peerId); // Ruft closePeerConnection für jeden Peer auf
        });
         state.peerConnections.clear(); // Sicherstellen, dass die Map leer ist
         console.log("[WebRTC] Alle PeerConnections geschlossen.");
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
         // Optional: FileUploadLabel Text aktualisieren
         if (UI.fileUploadLabel) {
             // Kürze langen Dateinamen für die Anzeige
             const displayFileName = file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name;
             UI.fileUploadLabel.textContent = `📎 ${escapeHTML(displayFileName)}`;
         }
    }

    function resetFileInput() {
        state.selectedFile = null;
        if (UI.fileInput) UI.fileInput.value = '';
        UI.messageInput.placeholder = 'Nachricht eingeben...';
         if (UI.fileUploadLabel) UI.fileUploadLabel.textContent = '📎';
    }


    // --- Init ---
    initializeUI();
    // populateMicList() wird in updateUIAfterConnect aufgerufen, nachdem ggf. Media-Berechtigung geholt wurde.

});
