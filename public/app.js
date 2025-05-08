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
        remoteScreenContainer: document.getElementById('remoteScreenContainer'), // Container für die Anzeige
        remoteScreenSharerName: document.getElementById('remoteScreenSharerName'), // Element für den Namen des Teilenden
        remoteScreenVideo: document.getElementById('remoteScreenVideo'), // Video Element
        remoteScreenFullscreenBtn: document.querySelector('#remoteScreenContainer .fullscreen-btn') // Vollbild-Button
    };

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room',
        socketId: null,
        allUsersList: [], // Komplette Liste der Benutzer im Raum vom Server (enthält jetzt sharingStatus)
        typingTimeout: null,
        typingUsers: new Set(),

        // Sound Effekt
        notificationSound: new Audio('/notif.mp3'), // Sound-Datei im public-Ordner erwartet

        // WebRTC State (Lokal)
        localAudioStream: null, // Stream vom Mikrofon
        screenStream: null, // Stream vom Bildschirm teilen
        isSharingScreen: false, // Bin ich gerade am Teilen?

        // WebRTC State (Remote)
        peerConnections: new Map(), // Map: socketId -> RTCPeerConnection (jeder Peer, mit dem ich verbunden bin)
        remoteAudioElements: new Map(), // Map: socketId -> HTMLAudioElement (Audio-Element für Remote-Peer)
        remoteStreams: new Map(), // Map: peerId -> MediaStream (speichert die aktuell empfangenen Streams pro Peer)

        // Bildschirm teilen State (Remote Anzeige)
        currentlyViewingPeerId: null, // ID des Peers, dessen Bildschirm ich gerade anschaue (null wenn keiner)

        localAudioMuted: false, // Ist mein Mikro lokal gemutet?
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

    // --- Funktionsdefinitionen (jetzt VOR den Event Listenern) ---

    // Hilfsfunktion für HTML-Escaping
    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, m => map[m]);
    }

    // Hilfsfunktion für Benutzerfarben
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
            state.notificationSound.currentTime = 0;
             state.notificationSound.play().catch(e => {
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
             });
        }
    }

    // --- UI Update Functions ---

    // Setzt den Verbindungsstatus in der UI
    function setConnectionStatus(statusClass, text) {
        if (!UI.statusIndicator) return;
        UI.statusIndicator.className = `status-indicator ${statusClass}`;
        UI.statusIndicator.textContent = text;
    }

    // Zeigt eine Fehlermeldung in der UI an
    function displayError(message) {
        if (!UI.errorMessage) return;
        UI.errorMessage.textContent = message;
        UI.errorMessage.classList.remove('hidden');
        setTimeout(() => {
            if (UI.errorMessage) UI.errorMessage.classList.add('hidden');
        }, 5000);
    }

    // Aktualisiert die UI nach erfolgreicher Verbindung
    function updateUIAfterConnect() {
        console.log("[UI] updateUIAfterConnect aufgerufen.");
        state.connected = true;

        UI.connectBtn.classList.add('hidden');
        UI.disconnectBtn.classList.remove('hidden');
        UI.shareScreenBtn.classList.remove('hidden');
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        if (UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true;
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();

        setupLocalAudioStream(); // Lokalen Audio-Stream starten
        populateMicList(); // Mikrofonliste nach erfolgreichem Verbinden laden
    }

    // Aktualisiert die UI nach Trennung der Verbindung
    function updateUIAfterDisconnect() {
        console.log("[UI] updateUIAfterDisconnect aufgerufen.");
        state.connected = false;

        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden');
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
        stopScreenSharing(false);
        closeAllPeerConnections();

        updateRemoteAudioControls();
        updateRemoteScreenDisplay(null); // Stellt sicher, dass die Anzeige aus ist und State zurückgesetzt wird

        state.users = {};
        state.allUsersList = [];
        state.socketId = null;
        state.remoteStreams.clear();
    }

    // Speichert den Benutzernamen im lokalen Speicher
    function saveStateToLocalStorage() {
        localStorage.setItem('chatClientUsername', UI.usernameInput.value);
    }

    // Lädt den Benutzernamen aus dem lokalen Speicher
    function loadStateFromLocalStorage() {
        const savedUsername = localStorage.getItem('chatClientUsername');
        if (savedUsername) {
            UI.usernameInput.value = savedUsername;
        }
    }

    // Aktualisiert die UI der Benutzerliste
    function updateUserList(usersArrayFromServer) {
        const oldUsers = state.allUsersList;
        state.allUsersList = usersArrayFromServer;

        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        const otherUsers = usersArrayFromServer.filter(user => user.id !== state.socketId);

        UI.userList.innerHTML = '';

        usersArrayFromServer.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.classList.add('user-dot');
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id));
            li.appendChild(dot);

            const nameContainer = document.createElement('span');
            nameContainer.style.flexGrow = '1';
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.overflow = 'hidden';
            nameContainer.style.textOverflow = 'ellipsis';
            nameContainer.style.whiteSpace = 'nowrap';


            const nameNode = document.createTextNode(`${escapeHTML(user.username)}`);
            if (user.id === state.socketId) {
                const strong = document.createElement('strong');
                strong.appendChild(nameNode);
                strong.appendChild(document.createTextNode(" (Du)"));
                nameContainer.appendChild(strong);

                 let localMuteBtn = document.getElementById('localMuteBtn');
                 if (!localMuteBtn) {
                     localMuteBtn = document.createElement('button');
                     localMuteBtn.id = 'localMuteBtn';
                     localMuteBtn.textContent = 'Mikro stumm schalten';
                     localMuteBtn.classList.add('mute-btn');
                     localMuteBtn.classList.add('hidden');
                     const micSelectParent = UI.micSelect ? UI.micSelect.parentNode : null;
                     if(micSelectParent) micSelectParent.insertBefore(localMuteBtn, UI.connectBtn);
                     // Füge Event Listener HIER hinzu (nachdem Button erstellt wurde)
                     localMuteBtn.addEventListener('click', toggleLocalAudioMute);
                 }
                 if (state.connected) {
                      localMuteBtn.classList.remove('hidden');
                      updateLocalMuteButtonUI();
                 } else {
                      localMuteBtn.classList.add('hidden');
                 }

                 if (UI.shareScreenBtn) {
                      if (state.connected) {
                           UI.shareScreenBtn.classList.remove('hidden');
                           updateShareScreenButtonUI();
                      } else {
                           UI.shareScreenBtn.classList.add('hidden');
                      }
                 }

            } else { // Für andere Benutzer
                nameContainer.appendChild(nameNode);

                // Teilen-Indikator hinzufügen, wenn Benutzer teilt
                if (user.sharingStatus) {
                     const sharingIndicator = document.createElement('span');
                     sharingIndicator.classList.add('sharing-indicator');
                     sharingIndicator.textContent = ' 🖥️';
                     sharingIndicator.title = `${escapeHTML(user.username)} teilt Bildschirm`;
                     nameContainer.appendChild(sharingIndicator);
                }


                // Sound abspielen, wenn NEUER Benutzer beitritt
                if (state.connected && oldUsers.length > 0 && !oldUsers.some(oldUser => oldUser.id === user.id)) {
                     console.log(`[UI] Neuer Benutzer beigetreten: ${user.username}`);
                     playNotificationSound();
                }
            }

            li.appendChild(nameContainer);

            // Button "Bildschirm ansehen" oder "Anzeige stoppen" hinzufügen
            // Diesen Button nur für ANDERE Benutzer hinzufügen, wenn diese teilen
            if (user.id !== state.socketId && user.sharingStatus) {
                 const viewButton = document.createElement('button');
                 viewButton.classList.add('view-screen-button');
                 viewButton.dataset.peerId = user.id;

                 // Prüfen, ob wir gerade den Bildschirm dieses Benutzers ansehen
                 const isViewingThisPeer = state.currentlyViewingPeerId === user.id;

                 if (isViewingThisPeer) {
                     viewButton.textContent = 'Anzeige stoppen';
                     viewButton.classList.add('stop');
                 } else {
                     viewButton.textContent = 'Bildschirm ansehen';
                     viewButton.classList.add('view');
                 }

                 // Event Listener für den Button
                 viewButton.addEventListener('click', handleViewScreenClick);

                 li.appendChild(viewButton);
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

          // Nach jeder Userlist-Aktualisierung die Bildschirmanzeige prüfen
          // Dies ist wichtig, falls der aktuell angezeigte Sharer den Raum verlässt
          // oder aufhört zu teilen (Status wird in der Liste aktualisiert vom Server).
          if (state.currentlyViewingPeerId) {
               // Finde den User in der NEUEN Liste und prüfe seinen Sharing-Status
               const sharerUser = state.allUsersList.find(user => user.id === state.currentlyViewingPeerId);
               const sharerStillSharing = sharerUser && sharerUser.sharingStatus;

               if (!sharerStillSharing) {
                    console.log(`[UI] Aktuell betrachteter Sharer (${state.currentlyViewingPeerId}) teilt laut Userliste nicht mehr. Stoppe Anzeige.`);
                    // Rufe die Stopp-Logik auf, simuliere einen Klick mit forceStop = true
                    handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true);
               } else {
                   // Der Sharer teilt noch. Stelle sicher, dass der "Anzeige stoppen" Button aktiv ist.
                   const viewingButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${state.currentlyViewingPeerId}']`);
                   if(viewingButton) {
                       viewingButton.textContent = 'Anzeige stoppen';
                       viewingButton.classList.remove('view');
                       viewingButton.classList.add('stop');
                       viewingButton.disabled = false; // Sicherstellen, dass er nicht disabled ist
                   }
                   // Deaktiviere andere "Ansehen" Buttons, falls vorhanden
                    state.allUsersList.forEach(user => {
                         if (user.id !== state.socketId && user.sharingStatus && user.id !== state.currentlyViewingPeerId) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true;
                         }
                    });
               }
          } else {
               // Wenn currentlyViewingPeerId null ist (keiner wird betrachtet), stellen wir sicher, dass alle "Ansehen" Buttons aktiv sind.
               state.allUsersList.forEach(user => {
                   if (user.id !== state.socketId && user.sharingStatus) {
                       const viewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                       if(viewButton) viewButton.disabled = false; // Aktiviere den Button
                   }
               });
          }

    } // Ende updateUserList


    // Aktualisiert den "schreibt..." Indikator
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

                  ensureRemoteAudioElementExists(user.id); // Sicherstellen, dass Audio-Element existiert
             });
         }
    }

    // Aktualisiert die Anzeige des geteilten Remote-Bildschirms
    // Zeigt den Stream des Peers an, dessen ID in peerIdToDisplay steht (oder blendet aus, wenn null)
    function updateRemoteScreenDisplay(peerIdToDisplay) {
         console.log(`[UI] updateRemoteScreenDisplay aufgerufen. Peer ID zum Anzeigen: ${peerIdToDisplay}. Aktueller betrachteter State: ${state.currentlyViewingPeerId}`);

         if (!UI.remoteScreenContainer || !UI.remoteScreenVideo || !UI.remoteScreenSharerName) {
             console.warn("[UI] updateRemoteScreenDisplay: Benötigte UI Elemente nicht gefunden.");
              state.currentlyViewingPeerId = null;
              if (UI.remoteScreenVideo && UI.remoteScreenVideo.srcObject) UI.remoteScreenVideo.srcObject = null;
             if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.add('hidden');
             if (UI.remoteScreenSharerName) UI.remoteScreenSharerName.textContent = '';
             // Optional: Vollbild verlassen
             if (document.fullscreenElement) document.exitFullscreen();

             return;
         }

         const sharerUser = state.allUsersList.find(user => user.id === peerIdToDisplay);
         const sharerStream = state.remoteStreams.get(peerIdToDisplay); // Holen aus Map aller empfangenen Streams

         // Prüfe, ob der Stream existiert und Video-Tracks hat
         const canDisplay = sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0;


         if (canDisplay) {
             // Stream existiert und hat Video -> Anzeigen
             console.log(`[UI] Zeige geteilten Bildschirm von ${sharerUser.username} (${peerIdToDisplay}).`);

             // Verbinde das Videoelement mit diesem Stream
             UI.remoteScreenVideo.srcObject = sharerStream;
             UI.remoteScreenVideo.play().catch(e => console.error("[UI] Fehler beim Abspielen des Remote-Bildschirms:", e));

             // UI aktualisieren
             UI.remoteScreenSharerName.textContent = escapeHTML(sharerUser.username);
             UI.remoteScreenContainer.classList.remove('hidden'); // Container anzeigen

             state.currentlyViewingPeerId = peerIdToDisplay; // Aktualisiere den State des aktuell ANGESCHAUTEN Sharers

         } else {
             // Kein gültiger Peer zum Anzeigen oder Stream nicht verfügbar -> Anzeige ausblenden
             console.log("[UI] Keine Bildschirmteilung zum Anzeigen oder Peer teilt nicht mehr/Stream nicht verfügbar.");

             // Wenn gerade ein Bildschirm angezeigt wurde, stoppe die Wiedergabe
             if (UI.remoteScreenVideo.srcObject) {
                 UI.remoteScreenVideo.srcObject = null;
                 console.log("[UI] Wiedergabe des Remote-Bildschirms gestoppt.");
             }

             // UI ausblenden
             UI.remoteScreenContainer.classList.add('hidden');
             UI.remoteScreenSharerName.textContent = '';

             state.currentlyViewingPeerId = null; // Kein Peer wird mehr angeschaut

              // Optional: Vollbild verlassen, falls aktiv (dieser Bildschirm)
              if (document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement))) {
                   document.exitFullscreen();
              }
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
            // Füge es zum DOM hinzu, damit es Audio abspielen kann
            document.body.appendChild(audioElement);

            state.remoteAudioElements.set(peerId, audioElement);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} erstellt und hinzugefügt.`);

             // Setze den initialen Mute-Status basierend auf dem Button in der UI (falls er schon existiert)
             // Oder einem gespeicherten State, falls wir lokalen Mute-Status pro Peer speichern würden (aktuell nicht der Fall)
             const muteButton = UI.remoteAudioControls.querySelector(`.mute-btn[data-peer-id='${peerId}']`);
             if (muteButton) {
                  audioElement.muted = muteButton.classList.contains('muted');
             } else {
                  audioElement.muted = false; // Standard: nicht gemutet
             }
        }
         return audioElement;
    }

    // Entfernt das Audio-Element eines Remote-Peers
    function removeRemoteAudioElement(peerId) {
         const audioElement = state.remoteAudioElements.get(peerId);
         if (audioElement) {
             console.log(`[WebRTC] Entferne Audio-Element für Peer ${peerId}.`);
             audioElement.pause(); // Wiedergabe stoppen
             audioElement.srcObject = null; // Stream-Verbindung trennen
             audioElement.remove(); // Aus dem DOM entfernen
             state.remoteAudioElements.delete(peerId);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} entfernt.`);
         }
         // Entferne auch die UI Controls für diesen Peer
         const itemDiv = document.getElementById(`remoteAudioItem_${peerId}`);
         if (itemDiv) {
             itemDiv.remove();
         }
          // Wenn keine Remote-Audio-Items mehr da sind, blende die Sektion aus (wird in updateUserList gemacht)
    }

     // Schaltet das lokale Mikrofon stumm/aktiv
    function toggleLocalAudioMute() {
         if (!state.localAudioStream) {
             console.warn("[WebRTC] toggleLocalAudioMute: Lokaler Audio-Stream nicht verfügbar.");
             // Optional: Fehlermeldung anzeigen
             return;
         }
         state.localAudioMuted = !state.localAudioMuted;
         console.log(`[WebRTC] Lokales Mikrofon: ${state.localAudioMuted ? 'Stumm' : 'Aktiv'}`);

         // Setze den 'enabled'-Status für alle Audio-Tracks im lokalen Stream
         state.localAudioStream.getAudioTracks().forEach(track => {
             track.enabled = !state.localAudioMuted; // 'enabled = false' mutet den Track
             console.log(`[WebRTC] Lokaler Audio Track ${track.id} enabled: ${track.enabled}`);
         });

         updateLocalMuteButtonUI();
         // Optional: Signalisiere anderen den Mute-Status (erfordert zusätzliches Socket.IO Event)
         // socket.emit('localMuteStatus', { muted: state.localAudioMuted });
    }

     // Aktualisiert die UI des lokalen Mute-Buttons
     function updateLocalMuteButtonUI() {
         const localMuteBtn = document.getElementById('localMuteBtn');
         if (localMuteBtn) {
             localMuteBtn.textContent = state.localAudioMuted ? 'Mikro Stumm AN' : 'Mikro stumm schalten';
             localMuteBtn.classList.toggle('muted', state.localAudioMuted);
             // localMuteBtn.classList.toggle('active', !state.localAudioMuted); // Optional: Zusätzliche Klasse für Aktiv-Status (für CSS)
             // Button kann nur deaktiviert sein, wenn setupLocalAudioStream fehlgeschlagen ist
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

         // Optional: Mute-Status lokal pro Peer speichern, falls die UI neu aufgebaut wird
         // und der Status erhalten bleiben soll.
     }


    // --- WebSocket Logic ---

    // Startet die Socket.IO Verbindung
    function connect() {
        console.log("[Socket.IO] connect() aufgerufen.");
        const serverUrl = window.location.origin;
        const roomId = state.roomId;
        let username = UI.usernameInput.value.trim();

        if (!username) username = `User${Math.floor(Math.random() * 10000)}`;
        UI.usernameInput.value = username;
        state.username = username; // Update state immediately

        console.log(`[Socket.IO] Verbinde mit ${serverUrl} in Raum ${state.roomId} als ${state.username}`);

        // Wenn Socket bereits existiert, trennen und neu erstellen
        if (socket) {
            console.log("[Socket.IO] Bestehende Socket-Instanz gefunden, wird getrennt.");
            socket.disconnect(); // Dies triggert den 'disconnect' Event-Handler
        }

        // Erstelle eine neue Socket-Verbindung
        socket = io(serverUrl, {
            auth: { username: state.username, roomId: state.roomId }, // Sende Auth-Daten
            transports: ['websocket'], // Bevorzuge WebSocket
            forceNew: true // Erzwinge eine neue Verbindung (nützlich bei schnellen Reconnect-Versuchen)
        });
        setConnectionStatus('connecting', 'Verbinde...'); // UI Status "Verbinde..." setzen
        setupSocketListeners(); // Socket Event Listener einrichten
    }

    // Richtet alle Socket.IO Event Listener ein
    function setupSocketListeners() {
        if (!socket) {
            console.error("[Socket.IO] setupSocketListeners: Socket ist null.");
            return;
        }
        console.log("[Socket.IO] setupSocketListeners aufgerufen.");

        // Event: Erfolgreiche Verbindung zum Socket.IO Server
        socket.on('connect', () => {
            console.log('[Socket.IO] "connect" event erhalten. Socket verbunden auf Transport:', socket.io.engine.transport.name, 'Socket ID:', socket.id);
            // Der Server sendet 'joinSuccess' nach erfolgreichem Auth und Join.
        });

        // Event: Fehler während des Verbindungsaufbaus
        socket.on('connect_error', (err) => {
            console.error('[Socket.IO] "connect_error" erhalten:', err.message, err.data);
            // state.connected wird im 'disconnect' Handler auf false gesetzt
            displayError(`Verbindungsfehler: ${err.message}. Server erreichbar?`);
            setConnectionStatus('disconnected', 'Verbindungsfehler');
            // Der Socket.IO Client löst bei connect_error selbst ein 'disconnect' aus.
        });

        // Event: Verbindung wurde getrennt
        socket.on('disconnect', (reason) => {
            console.log(`[Socket.IO] "disconnect" event erhalten: ${reason}`);
            // state.connected wird hier auf false gesetzt
            displayError(`Verbindung getrennt: ${reason}`);
            // Bereinigung und UI-Reset
            updateUIAfterDisconnect();
        });

        // Event: Erfolgreich dem Raum beigetreten (vom Server nach erfolgreichem Auth gesendet)
        socket.on('joinSuccess', ({ users: currentUsers, id: myId }) => {
            console.log(`[Socket.IO] "joinSuccess" event erhalten. Dein Socket ID: ${myId}, Benutzer im Raum:`, currentUsers);
            // state.connected wird hier auf true gesetzt
            state.socketId = myId;
             // Finde den eigenen User in der Liste, um den Server-seitig zugewiesenen Namen/Farbe zu erhalten
             const selfUser = currentUsers.find(u => u.id === myId);
             if(selfUser) {
                  state.username = selfUser.username; // Übernehme den finalen Namen vom Server
             }
            updateUIAfterConnect(); // UI anpassen, lokalen Stream starten etc.
            // Die erste Benutzerliste kommt direkt hier. update PeerConnections wird von updateUserList aufgerufen.
            updateUserList(currentUsers);
        });

        // Event: Fehler beim Versuch, dem Raum beizutreten (vom Server gesendet)
        socket.on('joinError', ({ message }) => {
            console.error(`[Socket.IO] "joinError" erhalten: ${message}`);
            displayError(message);
            // Der Server sollte nach joinError die Verbindung trennen, was den 'disconnect' Handler triggert.
            // Falls nicht, stellt forceNew: true im connect() und der folgende disconnect() Aufruf
            // (falls der Socket noch verbunden ist) eine Bereinigung sicher.
            if (socket && socket.connected) {
                 console.log("[Socket.IO] JoinError erhalten, Socket ist noch verbunden. Manuelles Trennen.");
                 socket.disconnect(); // Manuell trennen, um disconnect Handler zu triggern
             } else {
                 console.log("[Socket.IO] JoinError erhalten, Socket war bereits getrennt oder wird getrennt.");
                 // UI wird vom disconnect Handler zurückgesetzt.
             }
        });

        // Event: Benutzerliste im Raum wurde aktualisiert (Benutzer beigetreten/verlassen)
        socket.on('userListUpdate', (currentUsersList) => {
            console.log("[Socket.IO] Benutzerliste aktualisiert:", currentUsersList);
            // Diese Liste vom Server enthält jetzt auch den 'sharingStatus' für jeden Benutzer.
            // updateUserList aktualisiert die UI, die Buttons "Bildschirm ansehen" etc.
            // und triggert updatePeerConnections für WebRTC.
            updateUserList(currentUsersList);
        });

        // Event: Neue Chat-Nachricht erhalten
        socket.on('chatMessage', (message) => {
            appendMessage(message); // Nachricht zur UI hinzufügen
            // Sound abspielen, wenn es keine eigene Nachricht ist
            if (message.id !== state.socketId) {
                 console.log("[Socket.IO] Neue Nachricht von anderem Benutzer. Sound abspielen.");
                playNotificationSound();
            }
        });

        // Event: Tipp-Status von einem Benutzer hat sich geändert
        socket.on('typing', ({ username, isTyping }) => {
            if (username === state.username) return; // Ignoriere eigene Tipp-Events
            if (isTyping) {
                state.typingUsers.add(username);
            } else {
                state.typingUsers.delete(username);
            }
            updateTypingIndicatorDisplay(); // Aktualisiere die UI des Tipp-Indikators
        });

        // --- WebRTC Signalisierungs-Listener (Multi-Peer) ---
        // Empfängt WebRTC Signale vom Server, die von anderen Peers gesendet wurden
        socket.on('webRTC-signal', async ({ from, type, payload }) => {
             // console.log(`[WebRTC Signal] Empfange '${type}' von Peer ${from}.`); // Zu viele Logs
             if (from === state.socketId) {
                 // console.warn("[WebRTC Signal] Empfange eigenes Signal. Ignoriere."); // Zu viele Logs
                 return; // Ignoriere Signale von uns selbst
             }

             // Stelle sicher, dass eine PeerConnection für diesen Peer existiert
             let pc = state.peerConnections.get(from);
             if (!pc) {
                 console.warn(`[WebRTC Signal] Empfange Signal von unbekanntem Peer ${from}. Erstelle PeerConnection.`);
                 // Erstelle eine neue PC für den Peer, der uns signalisiert hat (falls sie noch nicht existiert)
                 pc = await createPeerConnection(from);
                 // Füge lokalen Stream hinzu, nachdem die PC erstellt wurde
                 // addLocalStreamTracksToPeerConnection(pc, state.isSharingScreen ? state.screenStream : state.localAudioStream); // Wird durch onnegotiationneeded getriggert

             }

            try {
                 if (type === 'offer') {
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Offer).`);
                    const isPolite = state.socketId < from; // Bestimme, wer "Polite" ist basierend auf ID

                    // Glare Handling für Polite Peer: Wenn wir Polite sind und ein lokales Offer haben,
                    // während wir ein Remote Offer erhalten, ignorieren wir das Remote Offer.
                    // Der Impolite Peer wird sein Offer bei 'have-local-offer' senden.
                    if (pc.signalingState !== 'stable' && pc.localDescription && isPolite) {
                         console.warn(`[WebRTC Signal] Peer ${from}: Glare erkannt (Polite). Ignoriere eingehendes Offer.`);
                         // Optional: Fehler melden oder Re-Negotiation initiieren.
                         // Für jetzt: Einfach ignorieren und hoffen, dass der Impolite Peer neu initiiert.
                         displayError(`Glare erkannt mit Peer ${from}. Neuverhandlung könnte nötig sein.`);
                         return;
                    }

                    // Setze das empfangene Offer als Remote Description
                    await pc.setRemoteDescription(new RTCSessionDescription(payload));
                    console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Offer) gesetzt.`);

                    // Erstelle eine Antwort (Answer) auf das Offer
                    console.log(`[WebRTC Signal] Peer ${from}: Erstelle Answer.`);
                    const answer = await pc.createAnswer();
                    // Setze die Antwort als lokale Description
                    console.log(`[WebRTC Signal] Peer ${from}: Setze Local Description (Answer).`);
                    await pc.setLocalDescription(answer);
                    console.log(`[WebRTC Signal] Peer ${from}: Local Description (Answer) gesetzt.`);

                    // Sende die Antwort über den Server an den Offer-Sender
                    console.log(`[WebRTC Signal] Peer ${from}: Sende Answer.`);
                    socket.emit('webRTC-signal', { to: from, type: 'answer', payload: pc.localDescription });

                 } else if (type === 'answer') {
                     console.log(`[WebRTC Signal] Peer ${from}: Setze Remote Description (Answer).`);
                    // Nur setzen, wenn wir ein lokales Angebot haben (have-local-offer)
                    if (pc.signalingState === 'have-local-offer') {
                        await pc.setRemoteDescription(new RTCSessionDescription(payload));
                         console.log(`[WebRTC Signal] Peer ${from}: Remote Description (Answer) gesetzt.`);
                    } else {
                        console.warn(`[WebRTC Signal] Peer ${from}: Empfange Answer im falschen Signaling State (${pc.signalingState}). Ignoriere.`);
                         // Kann bei Glare passieren. Ignorieren und hoffen, dass Neuverhandlung erfolgt.
                    }

                 } else if (type === 'candidate') {
                     // console.log(`[WebRTC Signal] Peer ${from}: Füge ICE Candidate hinzu.`); // Zu viele Logs
                     try {
                         // Füge den empfangenen ICE Kandidaten hinzu.
                         // Dies kann auch vor dem Setzen der Remote Description passieren;
                         // der Browser puffert Kandidaten in diesem Fall.
                        await pc.addIceCandidate(new RTCIceCandidate(payload));
                        // console.log(`[WebRTC Signal] Peer ${from}: ICE Candidate erfolgreich hinzugefügt.`); // Zu viele Logs
                     } catch (e) {
                         console.error(`[WebRTC Signal] Peer ${from}: Fehler beim Hinzufügen des ICE Kandidaten:`, e);
                         // Fehler können auftreten, wenn der Kandidat ungültig ist oder Remote Description nicht gesetzt werden konnte.
                     }

                 } else {
                     console.warn(`[WebRTC Signal] Unbekannter Signal-Typ '${type}' von Peer ${from} empfangen.`);
                 }
            } catch (err) {
                console.error(`[WebRTC Signal Error] Fehler bei Verarbeitung von Signal '${type}' von Peer ${from}:`, err);
                displayError(`Fehler bei Audio/Video-Verhandlung mit Peer ${from}.`);
                // Bei schwerwiegenden Fehlern: PeerConnection schließen und aus Map entfernen
                // closePeerConnection(from); // Dies könnte eine Rekursion auslösen, vorsichtig verwenden
            }
        });

        // Event: Bildschirm teilen Status Aktualisierung von einem anderen Client erhalten (vom Server weitergeleitet)
        socket.on('screenShareStatus', ({ id, sharing }) => {
            // Server sendet die komplette Userliste mit aktualisiertem Status an alle,
            // was userListUpdate triggert. Die Logik in updateUserList verarbeitet den Status.
            console.log(`[Socket.IO] screenShareStatus von ${id} erhalten: ${sharing}. (Wird von userListUpdate verarbeitet)`);
             // Hier tun wir nichts weiter, da updateUserList() bereits aufgerufen wird
             // und den Status aus der userListUpdate verwendet.
        });


    } // Ende setupSocketListeners


    // Trennt die Socket.IO Verbindung manuell
    function disconnect() {
        console.log("[Socket.IO] Trenne Verbindung manuell.");
        if (socket) {
            socket.disconnect(); // Dies triggert den 'disconnect' Event-Handler
        } else {
            console.log("[Socket.IO] Kein Socket zum Trennen gefunden.");
            updateUIAfterDisconnect(); // Stelle UI trotzdem zurück
        }
    }

    // --- Chat Logic ---

    // Sendet eine Textnachricht
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
             // Sender info (id, username, color) wird vom Server hinzugefügt
        };

        console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`);
        socket.emit('message', message); // Sende die Nachricht an den Server


        UI.messageInput.value = ''; // Eingabefeld leeren
        UI.messageInput.style.height = 'auto'; // Höhe zurücksetzen
        UI.messageInput.focus(); // Fokus im Eingabefeld behalten
        sendTyping(false); // Tipp-Status zurücksetzen
    }

    // Fügt eine eingehende (oder eigene gesendete) Nachricht zum Chat hinzu
    function appendMessage(msg) {
         if (!msg || !msg.content || !msg.id || !msg.username) {
            console.warn("appendMessage: Ungültige Nachrichtendaten erhalten.", msg);
            return;
        }

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        // Identifiziere eigene Nachrichten anhand der Socket ID vom Server
        const isMe = msg.id === state.socketId;
        if (isMe) msgDiv.classList.add('me');

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username);
        // Verwende die Farbe vom Server oder generiere eine Fallback-Farbe
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.id));

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        contentDiv.textContent = escapeHTML(msg.content);

        // Zeitstempel-Logik wurde entfernt

        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);

        UI.messagesContainer.appendChild(msgDiv); // Nachricht zum Container hinzufügen

        // Automatisch nach unten scrollen, wenn es die eigene Nachricht ist oder man nahe am Ende ist
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 20;
        if (isMe || isScrolledToBottom) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
    }

    // Sendet den Tipp-Status an den Server
    function sendTyping(isTyping = true) {
        if (!socket || !state.connected || UI.messageInput.disabled) {
             return;
        }

        clearTimeout(state.typingTimeout); // Alten Timer löschen

        socket.emit('typing', { isTyping }); // Sende den Status an den Server

        if (isTyping) {
            // Neuen Timer setzen, um nach einer Pause 'false' zu senden
            state.typingTimeout = setTimeout(() => {
                socket.emit('typing', { isTyping: false });
            }, CONFIG.TYPING_TIMER_LENGTH);
        }
         // Wenn isTyping false ist (z.B. nach dem Senden), wird kein neuer Timer benötigt.
    }

    // --- Init ---
    // Initialisiert die Anwendung beim Laden der Seite
    function initializeApp() {
        console.log("[App] initializeApp aufgerufen.");
        initializeUI(); // UI initialisieren und Status setzen
        // populateMicList() wird in updateUIAfterConnect aufgerufen
    }


    // --- App Start ---
    // App initialisieren, wenn das DOM bereit ist
    initializeApp();

}); // Ende DOMContentLoaded
