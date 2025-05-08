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

    // ... (updateUIAfterConnect, updateUIAfterDisconnect, saveStateToLocalStorage,
    //      loadStateFromLocalStorage, populateMicList, updateUserList,
    //      updateTypingIndicatorDisplay, updateRemoteAudioControls,
    //      updateRemoteScreenDisplay, ensureRemoteAudioElementExists, removeRemoteAudioElement,
    //      toggleLocalAudioMute, updateLocalMuteButtonUI, toggleRemoteAudioMute,
    //      setupLocalAudioStream, stopLocalAudioStream, startScreenSharing,
    //      stopScreenSharing, toggleScreenSharing, updateShareScreenButtonUI,
    //      createPeerConnection, addLocalStreamTracksToPeerConnection,
    //      updatePeerConnections, closePeerConnection, closeAllPeerConnections,
    //      sendMessage, appendMessage, sendTyping, handleViewScreenClick
    //      Funktionen bleiben wie zuvor außerhalb von initializeUI definiert) ...

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
                  console.log(`[WebRTC] Stoppe Screen Track ${track.id} (${track.kind}).`);
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
                 state.remoteStreams.set(peerId, remoteStream);
                  console.log(`[WebRTC] Erstelle neuen remoteStream ${remoteStream.id} für Peer ${peerId}.`);
             }

             if (!remoteStream.getTrackById(event.track.id)) {
                 console.log(`[WebRTC] Füge Track ${event.track.id} (${event.track.kind}) zu remoteStream ${remoteStream.id} für Peer ${peerId} hinzu.`);
                 remoteStream.addTrack(event.track);
             } else {
                 console.log(`[WebRTC] Track ${event.track.id} (${event.track.kind}) ist bereits in remoteStream ${remoteStream.id} für Peer ${peerId}.`);
             }


            if (event.track.kind === 'audio') {
                 console.log(`[WebRTC] Track ${event.track.id} ist Audio.`);
                 const audioElement = ensureRemoteAudioElementExists(peerId);
                 audioElement.srcObject = remoteStream;
                 audioElement.play().catch(e => console.warn(`[WebRTC] Fehler beim Abspielen von Remote Audio für Peer ${peerId}:`, e));

                 event.track.onended = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                 event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.ounmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);


            } else if (event.track.kind === 'video') {
                console.log(`[WebRTC] Track ${event.track.id} ist Video. Von Peer ${peerId}.`);

                 if (state.currentlyViewingPeerId === peerId) {
                     console.log(`[WebRTC] Erhaltener Video Track von aktuell betrachtetem Peer ${peerId}. Aktualisiere Anzeige.`);
                     updateRemoteScreenDisplay(peerId);
                 }

                 event.track.onended = () => {
                     console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} beendet.`);
                     const remoteStreamForPeer = state.remoteStreams.get(peerId);
                     if (remoteStreamForPeer && remoteStreamForPeer.getVideoTracks().length === 0) {
                         console.log(`[WebRTC] Peer ${peerId} sendet keine Video-Tracks mehr. Aktualisiere Bildschirmanzeige.`);
                          if (state.currentlyViewingPeerId === peerId) {
                               console.log(`[WebRTC] Der Peer (${peerId}), dessen Bildschirm ich ansehe, sendet keine Video-Tracks mehr. Stoppe Anzeige.`);
                               handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
                          }
                     }
                 };

                  event.track.onmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} gemutet.`);
                  event.track.ounmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} entmutet.`);
            }

             remoteStream.onremovetrack = (event) => {
                  console.log(`[WebRTC] Track ${event.track.id} von Peer ${peerId} aus Stream ${remoteStream.id} entfernt.`);
                 if (remoteStream.getTracks().length === 0) {
                      console.log(`[WebRTC] Stream ${remoteStream.id} von Peer ${peerId} hat keine Tracks mehr. Entferne Stream aus Map.`);
                      state.remoteStreams.delete(peerId);
                      if (state.currentlyViewingPeerId === peerId) {
                           console.log(`[WebRTC] Aktuell betrachteter Peer (${peerId}) hat keine Tracks mehr im Stream. Stoppe Anzeige.`);
                           handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
                      }
                 } else {
                      if (event.track.kind === 'video' && state.currentlyViewingPeerId === peerId) {
                           console.log(`[WebRTC] Video Track von aktuell betrachtetem Peer (${peerId}) entfernt. Aktualisiere Anzeige.`);
                            updateRemoteScreenDisplay(peerId);
                      }
                 }
             };
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

             if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {

                 if (pc.signalingState === 'have-remote-offer' && isPolite) {
                      console.log(`[WebRTC] Peer ${peerId}: Glare Situation (have-remote-offer, Polite). Warte auf eingehendes Offer.`);
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
                     displayError(`Fehler bei Audio/Video-Verhandlung (Offer) mit Peer ${peerId}.`);
                     closePeerConnection(peerId);
                 }
            } else {
                 console.log(`[WebRTC] Peer ${peerId}: Signaling State (${pc.signalingState}) erlaubt keine Offer Erstellung. Warte.`);
            }
        };

        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc;
    }

    function addLocalStreamTracksToPeerConnection(pc, streamToAdd) {
        console.log(`[WebRTC] addLocalStreamTracksToPeerConnection aufgerufen. Stream ID: ${streamToAdd ? streamToAdd.id : 'null'}.`);
        if (!pc) {
            console.warn("[WebRTC] addLocalStreamTracksToPeerConnection: PeerConnection ist null.");
            return;
        }

        const senders = pc.getSenders();
        const tracksToAdd = streamToAdd ? streamToAdd.getTracks() : [];

        console.log(`[WebRTC] PC hat ${senders.length} Sender. Stream hat ${tracksToAdd.length} Tracks.`);

        tracksToAdd.forEach(track => {
            const existingSender = senders.find(s => s.track && s.track.kind === track.kind);

            if (existingSender) {
                if (existingSender.track !== track) {
                     console.log(`[WebRTC] Ersetze Track ${track.kind} im Sender (${existingSender.track?.id || 'none'}) durch Track ${track.id}.`);
                    existingSender.replaceTrack(track).catch(e => {
                        console.error(`[WebRTC] Fehler beim Ersetzen des Tracks ${track.kind}:`, e);
                    });
                } else {
                    console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits im Sender. Kein Ersetzen nötig.`);
                }
            } else {
                console.log(`[WebRTC] Füge neuen Track ${track.kind} (${track.id}) hinzu.`);
                pc.addTrack(track, streamToAdd);
            }
        });

        senders.forEach(sender => {
            if (sender.track && !tracksToAdd.some(track => track.id === sender.track.id)) {
                 const trackKind = sender.track.kind;
                 console.log(`[WebRTC] Entferne Sender für Track ${sender.track.id} (${trackKind}), da er nicht mehr im aktuellen Stream ist.`);
                pc.removeTrack(sender);
            } else if (!sender.track) {
            }
        });

        console.log("[WebRTC] Tracks in PC aktualisiert.");
    }


    function updatePeerConnections(currentRemoteUsers) {
        console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote User: ${currentRemoteUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

        Array.from(state.peerConnections.keys()).forEach(peerId => {
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

                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                      console.log(`[WebRTC] Füge Tracks vom aktuellen lokalen Stream (${currentLocalStream.id || 'none'}) zur neuen PC (${user.id}) hinzu.`);
                      addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                 } else {
                      console.log(`[WebRTC] Kein lokaler Stream zum Hinzufügen zur neuen PC (${user.id}).`);
                       addLocalStreamTracksToPeerConnection(pc, null);
                 }

                 const shouldInitiateOffer = state.socketId < user.id;
                 if (shouldInitiateOffer) {
                      console.log(`[WebRTC] Bin Initiator für Peer ${user.id}. Erstelle initiales Offer.`);
                 } else {
                     console.log(`[WebRTC] Bin Receiver für Peer ${user.id}. Warte auf Offer.`);
                 }
            } else {
                 const pc = state.peerConnections.get(user.id);
                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                      addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                 } else {
                      console.log(`[WebRTC] Peer ${user.id} existiert, aber kein lokaler Stream zum Aktualisieren.`);
                       addLocalStreamTracksToPeerConnection(pc, null);
                 }
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

         if (state.remoteStreams.has(peerId)) {
              console.log(`[WebRTC] Entferne remoteStream für Peer ${peerId}.`);
              const streamToRemove = state.remoteStreams.get(peerId);
              streamToRemove.getTracks().forEach(track => track.stop());
              state.remoteStreams.delete(peerId);
         }

         if (state.currentlyViewingPeerId === peerId) {
              console.log(`[WebRTC] Geschlossener Peer ${peerId} wurde betrachtet. Stoppe Anzeige.`);
              handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
         }

    }

    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
        Array.from(state.peerConnections.keys()).forEach(peerId => {
            closePeerConnection(peerId);
        });
         state.peerConnections.clear();
         console.log("[WebRTC] Alle PeerConnections geschlossen.");

         state.remoteStreams.forEach(stream => {
             stream.getTracks().forEach(track => track.stop());
         });
         state.remoteStreams.clear();
          console.log("[WebRTC] Alle empfangenen Streams gestoppt und gelöscht.");

          updateRemoteScreenDisplay(null);
    }


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
        };

        console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`);
        socket.emit('message', message);


        UI.messageInput.value = '';
        UI.messageInput.style.height = 'auto';
        UI.messageInput.focus();
        sendTyping(false);
    }

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

    function handleViewScreenClick(event, forceStop = false) {
         console.log(`[UI] handleViewScreenClick aufgerufen. forceStop: ${forceStop}`);
         const clickedButton = event.target;
         const peerId = clickedButton.dataset.peerId;

         if (!peerId) {
             console.error("[UI] handleViewScreenClick: Keine Peer ID im Dataset gefunden.");
             return;
         }

         const isCurrentlyViewing = state.currentlyViewingPeerId === peerId;

         if (isCurrentlyViewing && !forceStop) {
             console.log(`[UI] Klick auf "Anzeige stoppen" für Peer ${peerId}.`);
             updateRemoteScreenDisplay(null);

              state.allUsersList.forEach(user => {
                  if (user.id !== state.socketId && user.sharingStatus) {
                       const sharerButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                       if (sharerButton) sharerButton.disabled = false;
                  }
              });
         } else if (!isCurrentlyViewing) {
             console.log(`[UI] Klick auf "Bildschirm ansehen" für Peer ${peerId}.`);

             const sharerUser = state.allUsersList.find(user => user.id === peerId && user.sharingStatus);
             const sharerStream = state.remoteStreams.get(peerId);

             if (sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0) {
                  console.log(`[UI] Peer ${peerId} teilt und Stream ist verfügbar. Zeige Bildschirm an.`);

                  if (state.currentlyViewingPeerId !== null && state.currentlyViewingPeerId !== peerId) {
                      console.log(`[UI] Stoppe vorherige Anzeige von Peer ${state.currentlyViewingPeerId}.`);
                      handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true);
                  }

                 updateRemoteScreenDisplay(peerId);

                 state.allUsersList.forEach(user => {
                      if (user.id !== state.socketId && user.sharingStatus && user.id !== peerId) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true;
                      }
                 });

                  clickedButton.textContent = 'Anzeige stoppen';
                  clickedButton.classList.remove('view');
                  clickedButton.classList.add('stop');


             } else {
                 console.warn(`[UI] Peer ${peerId} teilt nicht oder Stream nicht verfügbar. Kann Bildschirm nicht ansehen.`);
                 displayError(`Bildschirm von ${sharerUser ? escapeHTML(sharerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden.`);
                 updateRemoteScreenDisplay(null);
             }
         } else if (isCurrentlyViewing && forceStop) {
              console.log(`[UI] Force Stop Anzeige für Peer ${peerId}.`);
              updateRemoteScreenDisplay(null);

              const viewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${peerId}']`);
               if (viewButton) {
                    viewButton.textContent = 'Bildschirm ansehen';
                    viewButton.classList.remove('stop');
                    viewButton.classList.add('view');
               }

              state.allUsersList.forEach(user => {
                   if (user.id !== state.socketId && user.sharingStatus) {
                         const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                         if (otherViewButton) otherViewButton.disabled = false;
                   }
              });
         }
    }


    // --- Event Listener Zuweisungen (JETZT INNERHALB von initializeUI) ---
    // Dieser Block wird jetzt nicht mehr außerhalb von initializeUI verwendet.
    // Die Zuweisungen sind in initializeUI verschoben.


    // --- Init ---
    console.log("[App] DOMContentLoaded. App wird initialisiert.");
    // Hier wird initializeUI aufgerufen, was nun die Event Listener zuweist
    initializeUI();

});
