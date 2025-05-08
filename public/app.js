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

    // --- Initialisierung und UI-Helfer ---
    function initializeUI() {
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden'); // Bildschirm teilen Button verstecken
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        if (UI.micSelect) UI.micSelect.disabled = false;
        updateRemoteAudioControls(); // UI für Remote Audio leeren
        updateRemoteScreenDisplay(null); // Remote Screen Anzeige zurücksetzen und verstecken
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
        state.connected = true; // Sicherstellen, dass der State korrekt gesetzt ist

        UI.connectBtn.classList.add('hidden');
        UI.disconnectBtn.classList.remove('hidden');
        UI.shareScreenBtn.classList.remove('hidden'); // Bildschirm teilen Button anzeigen
        UI.sendBtn.disabled = false;
        UI.messageInput.disabled = false;
        if (UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true;
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();

        // Lokalen Audio-Stream (Mikrofon) starten
        setupLocalAudioStream();
        // Mikrofonliste nach erfolgreichem Verbinden laden
        populateMicList();
    }

    function updateUIAfterDisconnect() {
        console.log("[UI] updateUIAfterDisconnect aufgerufen.");
        state.connected = false; // Sicherstellen, dass der State korrekt gesetzt ist

        UI.connectBtn.classList.remove('hidden');
        UI.disconnectBtn.classList.add('hidden');
        UI.shareScreenBtn.classList.add('hidden'); // Bildschirm teilen Button verstecken
        UI.sendBtn.disabled = true;
        UI.messageInput.disabled = true;
        if (UI.usernameInput) UI.usernameInput.disabled = false;
        if (UI.micSelect) UI.micSelect.disabled = false;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = '0';
        UI.typingIndicator.textContent = '';

        // WebRTC Bereinigung
        stopLocalAudioStream(); // Stoppt Mikrofonstream und entfernt lokalen Mute Button
        stopScreenSharing(false); // Stoppt Bildschirmstream lokal (Signal an andere wird im toggle gemacht, hier nicht senden)
        closeAllPeerConnections(); // Schließt alle P2P Verbindungen und remote Streams

        updateRemoteAudioControls(); // UI für Remote Audio leeren
        updateRemoteScreenDisplay(null); // Remote Screen Anzeige zurücksetzen und verstecken

        state.users = {}; // Alte Benutzerliste leeren
        state.allUsersList = []; // Komplette Liste leeren
        state.socketId = null;
        state.remoteStreams.clear(); // Alle empfangenen Streams löschen (redundant mit closeAllPeerConnections, aber sicher)
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

    function playNotificationSound() {
        if (state.notificationSound) {
            state.notificationSound.currentTime = 0; // Setzt die Wiedergabeposition an den Anfang
             // Das play() Promise abfangen, falls Autoplay blockiert wird
             state.notificationSound.play().catch(e => {
                 // Fehler beim Abspielen (z.B. Autoplay blockiert durch Browser-Einstellungen) abfangen
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
                 // Dem Benutzer eventuell einen Hinweis geben, dass Sounds blockiert sind und wie er sie erlauben kann
             });
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
        if (state.connected && !state.isSharingScreen) { // Nur Mikrofon ändern, wenn nicht geteilt wird
            console.log("[WebRTC] Mikrofonauswahl geändert. Versuche lokalen Stream zu aktualisieren.");
            await setupLocalAudioStream(); // Ruft setLocalStream auf, was Tracks in PCs aktualisiert
        } else if (state.isSharingScreen) {
            console.warn("[WebRTC] Mikrofonauswahl geändert während Bildschirmteilung. Ändert sich erst danach.");
        } else {
             console.log("[WebRTC] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
        }
    });

    if (UI.shareScreenBtn) UI.shareScreenBtn.addEventListener('click', toggleScreenSharing);

    // Event Listener für den Vollbild-Button des Remote-Bildschirms
     if (UI.remoteScreenFullscreenBtn) {
         UI.remoteScreenFullscreenBtn.addEventListener('click', () => {
             if (UI.remoteScreenContainer) { // Vollbild für den Container, nicht nur das Video
                  toggleFullscreen(UI.remoteScreenContainer);
             }
         });
     }
    // Listener für Fullscreenchange, um Button-Text anzupassen
     document.addEventListener('fullscreenchange', () => {
         if (UI.remoteScreenFullscreenBtn) { // Prüfe nur den Button selbst
              // Prüft, ob das Fullscreen-Element entweder der Container selbst oder ein Kindelement davon ist
              const isRemoteScreenInFullscreen = document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement));
              UI.remoteScreenFullscreenBtn.textContent = isRemoteScreenInFullscreen ? "Vollbild verlassen" : "Vollbild";
         }
     });


    window.addEventListener('beforeunload', () => {
        // Versuche, die Verbindung sauber zu trennen, bevor die Seite geschlossen wird
        if (socket && socket.connected) {
            socket.disconnect();
            // Geben dem Server einen Moment Zeit, das Disconnect-Event zu verarbeiten.
            // In der Praxis ist dies nicht 100% zuverlässig, da das Fenster schließen
            // den Prozess abrupt beenden kann.
        }
        // WICHTIG: Lokale Medien-Tracks manuell stoppen, um Ressourcen freizugeben
         stopLocalAudioStream();
         stopScreenSharing(false); // Stoppt nur lokal, kein Signal mehr senden
         // WICHTIG: PeerConnections manuell schließen, um oniceconnectionstatechange = 'closed' auszulösen
         // und Ressourcen freizugeben. Dies triggert auch onremovetrack/onended bei Remote-Peers.
         closeAllPeerConnections(); // Schließt PCs und stoppt remote Streams

    });

    // Globale Funktion für Vollbild (kann für andere Elemente wiederverwendet werden)
    function toggleFullscreen(element) {
        if (!element) {
             console.warn("[UI] toggleFullscreen: Element nicht gefunden.");
             return;
        }
        // Use the element's native fullscreen API methods
        if (!document.fullscreenElement) {
            if (element.requestFullscreen) {
                element.requestFullscreen().catch(err => console.error(`[UI] Fullscreen error: ${err.message}`, err));
            } else if (element.webkitRequestFullscreen) { /* Safari */
                element.webkitRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (webkit): ${err.message}`, err));
            } else if (element.msRequestFullscreen) { /* IE11 */
                element.msRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (ms): ${err.message}`, err));
            } else {
                 console.warn("[UI] toggleFullscreen: Browser does not support Fullscreen API on this element.");
            }
        } else {
             console.log("[UI] toggleFullscreen: Exiting Fullscreen.");
             // Check if the element itself or one of its descendants is in fullscreen
             // document.exitFullscreen() beendet den Vollbildmodus für das gesamte Dokument
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { /* Safari */
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) { /* IE11 */
                document.msExitFullscreen();
            }
             // Optional: Re-check if *any* element is still in fullscreen after attempt
             // if (document.fullscreenElement) {
             //      console.warn("[UI] Exit Fullscreen failed, another element is still in fullscreen.");
             // }
        }
    }


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

    function playNotificationSound() {
        if (state.notificationSound) {
            state.notificationSound.currentTime = 0;
             state.notificationSound.play().catch(e => {
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
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
        // Standard-Option hinzufügen
        UI.micSelect.appendChild(new Option("Standard-Mikrofon", "", true, true));

        try {
             // enumerateDevices listet Geräte auf, erfordert aber in einigen Browsern/Fällen
             // dass zuvor schon mal getUserMedia erfolgreich war, um nicht-leere Labels zu bekommen.
             // Wir rufen es hier auf, nachdem getUserMedia in setupLocalAudioStream() versucht wird.
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length > 0) {
                 audioInputs.forEach(d => {
                      // Füge nur Geräte hinzu, die nicht der Standard sind, um Duplikate zu vermeiden
                      // und die ein Label haben (oder deviceId ist nicht default).
                     if (d.deviceId !== 'default' && (d.label || d.deviceId)) {
                          const opt = new Option(d.label || `Mikrofon (${d.deviceId})`, d.deviceId);
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

    // Passt updateUserList an, um den Sharing-Status und "Ansehen"-Button anzuzeigen
    function updateUserList(usersArrayFromServer) {
        const oldUsers = state.allUsersList;
        state.allUsersList = usersArrayFromServer; // Komplette Liste vom Server (enthält jetzt sharingStatus)

        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        const otherUsers = usersArrayFromServer.filter(user => user.id !== state.socketId);

        UI.userList.innerHTML = ''; // Liste in der UI leeren

        usersArrayFromServer.forEach(user => {
            const li = document.createElement('li');
            // Benutzer-Punkt
            const dot = document.createElement('span');
            dot.classList.add('user-dot');
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id));
            li.appendChild(dot);

            // Container für Name und Sharing-Indikator (verwende Flexbox für Layout)
            const nameContainer = document.createElement('span');
            nameContainer.style.flexGrow = '1'; // Name und Indikator nehmen Platz ein
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.overflow = 'hidden'; // Verhindert, dass der Name herausragt
            nameContainer.style.textOverflow = 'ellipsis'; // Punkte für abgeschnittenen Namen
            nameContainer.style.whiteSpace = 'nowrap'; // Name in einer Zeile halten


            const nameNode = document.createTextNode(`${escapeHTML(user.username)}`);
            if (user.id === state.socketId) { // Eigener Benutzer
                const strong = document.createElement('strong');
                strong.appendChild(nameNode);
                strong.appendChild(document.createTextNode(" (Du)"));
                nameContainer.appendChild(strong);

                 // Lokaler Mute-Button hinzufügen, falls noch nicht im DOM
                 let localMuteBtn = document.getElementById('localMuteBtn');
                 if (!localMuteBtn) {
                     localMuteBtn = document.createElement('button');
                     localMuteBtn.id = 'localMuteBtn';
                     localMuteBtn.textContent = 'Mikro stumm schalten';
                     localMuteBtn.classList.add('mute-btn');
                     localMuteBtn.classList.add('hidden'); // Start Hidden
                     localMuteBtn.addEventListener('click', toggleLocalAudioMute);
                     // Füge ihn unter der Mikrofonauswahl ein (finde das parent div)
                     const micSelectParent = UI.micSelect ? UI.micSelect.parentNode : null;
                     if(micSelectParent) micSelectParent.insertBefore(localMuteBtn, UI.connectBtn);
                 }
                 // Mute Button nur anzeigen, wenn verbunden
                 if (state.connected) {
                      localMuteBtn.classList.remove('hidden');
                      updateLocalMuteButtonUI(); // Status aktualisieren
                 } else {
                      localMuteBtn.classList.add('hidden');
                 }

                 // Bildschirm teilen Button anzeigen/verstecken
                 if (UI.shareScreenBtn) {
                      if (state.connected) {
                           UI.shareScreenBtn.classList.remove('hidden');
                           updateShareScreenButtonUI(); // Aktualisiere Text und Klasse (Teilen/Beenden)
                      } else {
                           UI.shareScreenBtn.classList.add('hidden');
                      }
                 }

            } else { // Für andere Benutzer
                nameContainer.appendChild(nameNode);

                // Optional: Teilen-Indikator hinzufügen, wenn Benutzer teilt
                if (user.sharingStatus) {
                     const sharingIndicator = document.createElement('span');
                     sharingIndicator.classList.add('sharing-indicator');
                     sharingIndicator.textContent = ' 🖥️'; // Oder ein Icon-Element
                     sharingIndicator.title = `${escapeHTML(user.username)} teilt Bildschirm`;
                     nameContainer.appendChild(sharingIndicator);
                }


                // Prüfen, ob dieser Benutzer neu ist (für Sound-Benachrichtigung)
                // Nur Sound, wenn der Benutzer gerade online gegangen ist (war vorher nicht in der Liste)
                // und wir bereits verbunden sind (sonst würde Sound bei jedem Start spielen).
                if (state.connected && oldUsers.length > 0 && !oldUsers.some(oldUser => oldUser.id === user.id)) {
                     console.log(`[UI] Neuer Benutzer beigetreten: ${user.username}`);
                     playNotificationSound(); // Sound abspielen
                }
            }

            li.appendChild(nameContainer); // Name und Indikator zum Listenelement hinzufügen

            // Button "Bildschirm ansehen" oder "Anzeige stoppen" hinzufügen
            // Diesen Button nur für ANDERE Benutzer hinzufügen, wenn diese teilen
            if (user.id !== state.socketId && user.sharingStatus) {
                 const viewButton = document.createElement('button');
                 viewButton.classList.add('view-screen-button');
                 viewButton.dataset.peerId = user.id; // Peer ID speichern

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
                 // Hier direkt die Funktion referenzieren, die den Klick handhabt
                 viewButton.addEventListener('click', handleViewScreenClick);

                 li.appendChild(viewButton);
            }


            UI.userList.appendChild(li);
        }); // Ende usersArrayFromServer.forEach

         // Nach jeder Userlist-Aktualisierung die PeerConnections anpassen
         updatePeerConnections(otherUsers); // Stellt WebRTC PCs für Audio/Video sicher

         // UI für Remote Audio Controls aktualisieren
         updateRemoteAudioControls(otherUsers);

         // Stelle sicher, dass die Remote Audio Controls Sektion angezeigt/versteckt wird
         if (UI.remoteAudioControls) {
              if (otherUsers.length > 0) {
                   UI.remoteAudioControls.classList.remove('hidden');
              } else {
                   UI.remoteAudioControls.classList.add('hidden');
              }
         }

          // Nachdem die Userliste aktualisiert wurde und die Anzeige der Buttons korrekt ist,
          // prüfen wir, ob der aktuell betrachtete Sharer noch teilt.
          // Dies handhabt den Fall, dass der Sharer den Raum verlässt oder aufhört zu teilen.
          if (state.currentlyViewingPeerId) {
               // Finde den User in der NEUEN Liste
               const sharerStillSharing = state.allUsersList.some(user => user.id === state.currentlyViewingPeerId && user.sharingStatus);

               if (!sharerStillSharing) {
                    console.log(`[UI] Aktuell betrachteter Sharer (${state.currentlyViewingPeerId}) teilt laut Userliste nicht mehr. Stoppe Anzeige.`);
                    // Rufe die Stopp-Logik auf, simuliere einen Klick mit forceStop
                    handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true); // forceStop = true
               } else {
                   // Der Sharer teilt noch. Stelle sicher, dass der "Anzeige stoppen" Button aktiv ist.
                   const viewingButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${state.currentlyViewingPeerId}']`);
                   if(viewingButton) {
                       viewingButton.textContent = 'Anzeige stoppen';
                       viewingButton.classList.remove('view');
                       viewingButton.classList.add('stop');
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


    // ... (updateTypingIndicatorDisplay bleibt gleich) ...
    // ... (updateRemoteAudioControls, ensureRemoteAudioElementExists, removeRemoteAudioElement bleiben gleich) ...
    // ... (toggleLocalAudioMute, updateLocalMuteButtonUI, toggleRemoteAudioMute bleiben gleich) ...


    // --- WebRTC Logic (Multi-Peer Audio + Optional Screen Share Viewing) ---

    // ... (setupLocalAudioStream, stopLocalAudioStream bleiben gleich) ...

    // Startet die Bildschirmteilung (Sender)
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
             // Hole den Bildschirmstream (mit Video und optional Audio)
             const stream = await navigator.mediaDevices.getDisplayMedia({
                 video: { cursor: "always", frameRate: { ideal: 10, max: 15 } }, // Optionen für Video
                 audio: true // Versuche auch System-Audio zu bekommen
             });
             state.screenStream = stream;
             state.isSharingScreen = true;
             console.log(`[WebRTC] Bildschirmstream erhalten: ${stream.id}. Tracks: Video: ${stream.getVideoTracks().length}, Audio: ${stream.getAudioTracks().length}`);

             // Stoppe den lokalen Mikrofonstream, wenn ein Screen-Audio-Track vorhanden ist.
             const screenAudioTrack = stream.getAudioTracks()[0];
             if (screenAudioTrack && state.localAudioStream) {
                  console.log("[WebRTC] Bildschirmstream hat Audio. Stoppe lokalen Mikrofonstream.");
                 stopLocalAudioStream(); // Stoppt Mikrofon-Tracks und setzt localAudioStream auf null
                 // Lokaler Mute Button wird durch stopLocalAudioStream versteckt
             } else {
                  console.log("[WebRTC] Bildschirmstream hat kein Audio oder Mikrofon war nicht aktiv. Mikrofon bleibt/ist inaktiv.");
                 // Wenn kein Screen-Audio, bleibt der lokale Mute Button sichtbar (falls aktiv)
             }


             // Füge die Tracks des Screen-Streams zu allen PeerConnections hinzu
             state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream); // Füge Screen-Tracks hinzu
             });

             // Event Listener für das Ende der Bildschirmteilung (z.B. durch Browser UI)
             const screenVideoTrack = stream.getVideoTracks()[0];
             if (screenVideoTrack) {
                 screenVideoTrack.onended = () => {
                     console.log("[WebRTC] Bildschirmteilung beendet durch Browser UI.");
                     if (state.isSharingScreen) { // Sicherstellen, dass unser State noch "sharing" ist
                         toggleScreenSharing(); // Rufe toggle auf, um sauber zu beenden
                     }
                 };
                  console.log("[WebRTC] onended Listener für Screen Video Track hinzugefügt.");
             } else {
                  console.warn("[WebRTC] Kein Screen Video Track gefunden, onended Listener konnte nicht hinzugefügt werden.");
             }

             // Sende Signal an ALLE (inklusive sich selbst) dass ich anfange zu teilen
             // Der Server speichert den Status und sendet die aktualisierte userListUpdate.
             socket.emit('screenShareStatus', { sharing: true });
             console.log("[Socket.IO] Sende 'screenShareStatus: true'.");

             updateShareScreenButtonUI(); // Button UI aktualisieren

             return true; // Erfolgreich
        } catch (err) {
             console.error('[WebRTC] Fehler beim Starten der Bildschirmteilung:', err.name, err.message);
             let errorMessage = `Bildschirmfreigabe fehlgeschlagen: ${err.message}.`;
             if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                  errorMessage = "Bildschirmfreigabe verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
             } else if (err.name === 'AbortError') {
                  errorMessage = "Bildschirmfreigabe abgebrochen."; // Benutzer hat abgebrochen
             }
             displayError(errorMessage);

             state.screenStream = null;
             state.isSharingScreen = false;
             setupLocalAudioStream(); // Stelle lokalen Audio-Stream wieder her

             updateShareScreenButtonUI(); // Button UI zurücksetzen

             // Optional: Signalisiere anderen, dass Teilen fehlgeschlagen/abgebrochen wurde, falls es jemals auf true war?
             // Oder der Server setzt es eh auf false, wenn er merkt, dass kein Stream kommt?
             // Wir senden ein false Signal, damit der Status beim Server konsistent ist.
             // Wenn startScreenSharing fehlschlägt, senden wir sofort ein false Signal.
             socket.emit('screenShareStatus', { sharing: false }); // Status ist false


             return false; // Fehlgeschlagen
        }
    }

    // Stoppt die Bildschirmteilung (Sender)
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
                  track.stop(); // WICHTIG: Den Track stoppen, damit die Freigabe beendet wird!
             });
             state.screenStream = null;
             console.log("[WebRTC] screenStream ist jetzt null.");
         } else {
              console.log("[WebRTC] stopScreenSharing: screenStream war bereits null.");
         }

         state.isSharingScreen = false;
         console.log("[WebRTC] isSharingScreen ist jetzt false.");


         // Stelle den lokalen Audio-Stream (Mikrofon) wieder her
         setupLocalAudioStream(); // Startet Mikrofon neu und fügt Tracks zu PCs hinzu


         // Sende Signal an ALLE (inklusive sich selbst) dass ich aufgehört habe zu teilen (wenn gewünscht)
         if (sendSignal && socket && state.connected) {
             socket.emit('screenShareStatus', { sharing: false });
             console.log("[Socket.IO] Sende 'screenShareStatus: false'.");
         }

          updateShareScreenButtonUI(); // Button UI aktualisieren
    }

    // Umschalten der Bildschirmteilung (Sender)
    async function toggleScreenSharing() {
        console.log(`[WebRTC] toggleScreenSharing aufgerufen. Aktueller State isSharingScreen: ${state.isSharingScreen}`);
        if (!state.connected || !UI.shareScreenBtn) {
             console.warn("[WebRTC] Nicht verbunden oder Button nicht gefunden.");
             return;
        }

        UI.shareScreenBtn.disabled = true; // Button während des Vorgangs deaktivieren

        if (state.isSharingScreen) {
            stopScreenSharing(true); // Stoppe lokal und sende Signal
        } else {
            await startScreenSharing(); // Startet lokal und sendet Signal bei Erfolg
            // updateShareScreenButtonUI wird in start/stopScreenSharing aufgerufen
        }

        UI.shareScreenBtn.disabled = false; // Button nach Vorgang wieder aktivieren
    }

     // Aktualisiert die UI des Bildschirm teilen Buttons (Sender)
     function updateShareScreenButtonUI() {
         if (UI.shareScreenBtn) {
             UI.shareScreenBtn.textContent = state.isSharingScreen ? 'Teilen beenden' : '🖥 Bildschirm teilen';
             UI.shareScreenBtn.classList.toggle('active', state.isSharingScreen);
             // Der 'hidden' Status wird in updateUIAfterConnect/Disconnect gehandhabt.
         }
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
                 // console.log(`[WebRTC] Sende ICE candidate zu Peer ${peerId}.`); // Zu viele Logs
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

        // Remote Track Handling: Empfängt Tracks (Audio ODER Video) von einem Peer
        pc.ontrack = event => {
            console.log(`[WebRTC] Empfange remote track von Peer ${peerId}. Track Kind: ${event.track.kind}, Stream ID(s): ${event.streams ? event.streams.map(s => s.id).join(', ') : 'No Stream'}`);

             // Stelle sicher, dass ein MediaStream für diesen Peer in state.remoteStreams existiert
             let remoteStream = state.remoteStreams.get(peerId);
             if (!remoteStream) {
                 remoteStream = new MediaStream();
                 state.remoteStreams.set(peerId, remoteStream);
                  console.log(`[WebRTC] Erstelle neuen remoteStream ${remoteStream.id} für Peer ${peerId}.`);
             }

             // Füge den empfangenen Track zum remoteStream für diesen Peer hinzu
             // Nur hinzufügen, wenn der Track noch nicht im Stream ist (kann bei ontrack mehrmals gefeuert werden)
             if (!remoteStream.getTrackById(event.track.id)) {
                 console.log(`[WebRTC] Füge Track ${event.track.id} (${event.track.kind}) zu remoteStream ${remoteStream.id} für Peer ${peerId} hinzu.`);
                 remoteStream.addTrack(event.track);
             } else {
                 console.log(`[WebRTC] Track ${event.track.id} (${event.track.kind}) ist bereits in remoteStream ${remoteStream.id} für Peer ${peerId}.`);
             }


            if (event.track.kind === 'audio') {
                // Audio Track Handling: Verbinde mit dem unsichtbaren Audio-Element
                 console.log(`[WebRTC] Track ${event.track.id} ist Audio.`);
                 const audioElement = ensureRemoteAudioElementExists(peerId);
                 // Der remoteStream enthält jetzt den Audio-Track (und ggf. andere Tracks)
                 // Verbinde den Stream mit dem Audio-Element
                 audioElement.srcObject = remoteStream; // Verbinde den Stream, der jetzt Audio enthält
                 audioElement.play().catch(e => console.warn(`[WebRTC] Fehler beim Abspielen von Remote Audio für Peer ${peerId}:`, e));

                 event.track.onended = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                 event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.ounmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);


            } else if (event.track.kind === 'video') {
                // Video Track Handling: Dieser Track kommt vom Remote-Peer
                console.log(`[WebRTC] Track ${event.track.id} ist Video. Von Peer ${peerId}.`);

                 // Wenn dieser Peer der ist, dessen Bildschirm wir gerade ansehen,
                 // dann aktualisiere die Anzeige mit diesem Stream.
                 // Dies ist wichtig, falls der Stream neu verhandelt wird, während wir ihn anschauen.
                 if (state.currentlyViewingPeerId === peerId) {
                     console.log(`[WebRTC] Erhaltener Video Track von aktuell betrachtetem Peer ${peerId}. Aktualisiere Anzeige.`);
                     // updateRemoteScreenDisplay holt den aktuellen Stream aus remoteStreams.
                     updateRemoteScreenDisplay(peerId);
                 }


                 // Event Listener für das Ende des Remote-Video-Tracks (wenn der Peer aufhört zu teilen)
                 event.track.onended = () => {
                     console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} beendet.`);
                     // Wenn der Stream des Peers keine Video-Tracks mehr hat, und wir seinen Bildschirm ansehen,
                     // beende die Anzeige.
                     const remoteStreamForPeer = state.remoteStreams.get(peerId);
                     if (remoteStreamForPeer && remoteStreamForPeer.getVideoTracks().length === 0) {
                         console.log(`[WebRTC] Peer ${peerId} sendet keine Video-Tracks mehr. Aktualisiere Bildschirmanzeige.`);
                          if (state.currentlyViewingPeerId === peerId) {
                               console.log(`[WebRTC] Der Peer (${peerId}), dessen Bildschirm ich ansehe, sendet keine Video-Tracks mehr. Stoppe Anzeige.`);
                               // Simuliere Klick auf "Anzeige stoppen" für diesen Peer
                               handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true); // forceStop = true
                          }
                     }
                 };

                  event.track.onmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} gemutet.`);
                  event.track.ounmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} entmutet.`);
            }

             // Listener, wenn ein Track aus dem empfangenen Stream entfernt wird (z.B. bei replaceTrack(null))
             // Dies kann passieren, wenn der Sender die Art des Streams ändert (z.B. von Screen auf Audio).
             remoteStream.onremovetrack = (event) => {
                  console.log(`[WebRTC] Track ${event.track.id} von Peer ${peerId} aus Stream ${remoteStream.id} entfernt.`);
                 // Wenn der Stream keine Tracks mehr hat, kann er aus der Map entfernt werden
                 if (remoteStream.getTracks().length === 0) {
                      console.log(`[WebRTC] Stream ${remoteStream.id} von Peer ${peerId} hat keine Tracks mehr. Entferne Stream aus Map.`);
                      state.remoteStreams.delete(peerId);
                      // Wenn dieser Peer der aktuell betrachtete war, stoppe die Anzeige
                      if (state.currentlyViewingPeerId === peerId) {
                           console.log(`[WebRTC] Aktuell betrachteter Peer (${peerId}) hat keine Tracks mehr im Stream. Stoppe Anzeige.`);
                           handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true); // forceStop = true
                      }
                 } else {
                     // Stream hat noch Tracks, aber einer wurde entfernt.
                     // Wenn der entfernte Track Video war und dieser Peer betrachtet wurde,
                     // aktualisiere die Anzeige (sollte Video entfernen, aber Audio weiterspielen).
                      if (event.track.kind === 'video' && state.currentlyViewingPeerId === peerId) {
                           console.log(`[WebRTC] Video Track von aktuell betrachtetem Peer (${peerId}) entfernt. Aktualisiere Anzeige.`);
                            updateRemoteScreenDisplay(peerId); // Update Anzeige (holt Stream neu, sollte jetzt ohne Video sein)
                      }
                 }
             };

             // Der WebRTC-Stream wird auch durch das Ende der PeerConnection beendet
             // oder wenn alle Tracks im Stream enden.
        }; // Ende pc.ontrack

        // ICE Connection State Change Handling: Verfolgt den Verbindungsstatus mit dem Peer
        pc.oniceconnectionstatechange = () => {
             if (!pc) return;
            const pcState = pc.iceConnectionState;
             const peerUser = state.allUsersList.find(u => u.id === peerId);
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] ICE Connection Status zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
             switch (pcState) {
                case "new": case "checking":
                    // Verbindungsaufbau läuft
                    break;
                case "connected":
                    console.log(`[WebRTC] ICE 'connected': Erfolgreich verbunden mit Peer '${peerUsername}'. Audio sollte fließen.`);
                    // Optional: UI anzeigen, dass Audio aktiv ist (z.B. Symbol neben Benutzername)
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
                    displayError(`Audio/Video-Verbindung zu ${peerUsername} fehlgeschlagen.`);
                    // Bei fehlgeschlagener Verbindung, PC schließen und aus Map entfernen
                     closePeerConnection(peerId);
                    break;
                case "closed":
                    console.log(`[WebRTC] ICE 'closed': Verbindung zu Peer '${peerUsername}' wurde geschlossen.`);
                     // Bei geschlossener Verbindung, PC aus Map entfernen und zugehörige Ressourcen entfernen
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
        // Dies geschieht oft nach addTrack, removeTrack, replaceTrack.
        pc.onnegotiationneeded = async () => {
             console.log(`[WebRTC] onnegotiationneeded Event für Peer ${peerId} ausgelöst.`);
            // Prüfe, ob wir der "Polite" Peer sind (basierend auf ID-Vergleich), um Glare zu vermeiden.
             const isPolite = state.socketId < peerId;

             // Erstelle ein Angebot, wenn der State 'stable' ist (Polite)
             // ODER wenn der State 'have-remote-offer' ist (Impolite, Glare Fall)
             if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {

                 if (pc.signalingState === 'have-remote-offer' && isPolite) {
                      console.log(`[WebRTC] Peer ${peerId}: Glare Situation (have-remote-offer, Polite). Warte auf eingehendes Offer (Rollback).`);
                      // Glare Handling: Wenn wir Polite sind und ein Remote Offer haben, warten wir,
                      // bis unser setLocalDescription(answer) das Glare auflöst.
                      // Ein erneutes createOffer/setLocalDescription hier würde die Situation verschlimmern.
                       return; // Ignoriere onnegotiationneeded in diesem Glare-Fall, wenn Polite
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
                     displayError(`Fehler bei Audio/Video-Verhandlung (Offer) mit Peer ${peerId}.`);
                     // Bei Fehler: PeerConnection schließen und aus Map entfernen
                     closePeerConnection(peerId);
                 }
            } else {
                 // Wenn der State weder stable noch have-remote-offer ist, warten wir (z.B. have-local-offer)
                 console.log(`[WebRTC] Peer ${peerId}: Signaling State (${pc.signalingState}) erlaubt keine Offer Erstellung. Warte.`);
            }
        }; // Ende pc.onnegotiationneeded


        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc;
    }

    // Fügt die Tracks des LOKALEN STREAMS (Mikro oder Screen) zu einer PeerConnection hinzu
    // Verwendet replaceTrack, um existierende Sender desselben Typs zu ersetzen.
    function addLocalStreamTracksToPeerConnection(pc, streamToAdd) {
        console.log(`[WebRTC] addLocalStreamTracksToPeerConnection aufgerufen. Stream ID: ${streamToAdd ? streamToAdd.id : 'null'}.`);
        if (!pc) {
            console.warn("[WebRTC] addLocalStreamTracksToPeerConnection: PeerConnection ist null.");
            return;
        }

        const senders = pc.getSenders();
        const tracksToAdd = streamToAdd ? streamToAdd.getTracks() : [];

        console.log(`[WebRTC] PC hat ${senders.length} Sender. Stream hat ${tracksToAdd.length} Tracks.`);

        // Gehe durch die Tracks, die HINZUGEFÜGT werden sollen (aus dem neuen Stream)
        tracksToAdd.forEach(track => {
            const existingSender = senders.find(s => s.track && s.track.kind === track.kind);

            if (existingSender) {
                // Sender für diesen Track-Typ existiert bereits -> Track ersetzen
                if (existingSender.track !== track) { // Nur ersetzen, wenn der Track anders ist
                     console.log(`[WebRTC] Ersetze Track ${track.kind} im Sender (${existingSender.track?.id || 'none'}) durch Track ${track.id}.`);
                    existingSender.replaceTrack(track).catch(e => {
                        console.error(`[WebRTC] Fehler beim Ersetzen des Tracks ${track.kind}:`, e);
                         // Bei Fehler beim Ersetzen kann man versuchen, den Sender zu entfernen und neu hinzuzufügen.
                         // Einfachheit halber loggen wir nur.
                    });
                } else {
                    console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits im Sender. Kein Ersetzen nötig.`);
                }
            } else {
                // Sender für diesen Track-Typ existiert nicht -> Track hinzufügen
                console.log(`[WebRTC] Füge neuen Track ${track.kind} (${track.id}) hinzu.`);
                 // addTrack erstellt einen neuen Sender. Dies löst onnegotiationneeded aus.
                pc.addTrack(track, streamToAdd); // streamToAdd hier als optionalen Stream-Kontext
            }
        });

        // Gehe durch die VORHANDENEN Sender, um Tracks zu entfernen, die NICHT mehr im Stream sind
        senders.forEach(sender => {
            // Prüfe, ob der Sender einen Track hat UND ob dieser Track NICHT im streamToAdd enthalten ist
            // Wir vergleichen anhand der Track ID.
            if (sender.track && !tracksToAdd.some(track => track.id === sender.track.id)) {
                 const trackKind = sender.track.kind;
                 // Der Track des Senders ist NICHT mehr im streamToAdd
                 // Entferne den Sender (der Track im ursprünglichen Stream wird nicht gestoppt)
                 console.log(`[WebRTC] Entferne Sender für Track ${sender.track.id} (${trackKind}), da er nicht mehr im aktuellen Stream ist.`);
                pc.removeTrack(sender); // Entfernt den Sender. Dies löst onnegotiationneeded aus.
                // Die andere Seite wird durch den fehlenden Track im empfangenen Stream oder onremovetrack informiert.
            } else if (!sender.track) {
                 // Sender hat keinen Track (z.B. replaceTrack(null) wurde vorher aufgerufen)
                 // Hier machen wir nichts, wenn wir gerade keine Tracks hinzufügen.
            }
        });


        console.log("[WebRTC] Tracks in PC aktualisiert.");
        // Das Hinzufügen/Entfernen/Ersetzen von Tracks sollte 'onnegotiationneeded' auslösen.
    }


    // Aktualisiert die Menge der PeerConnections basierend auf der aktuellen Benutzerliste
    function updatePeerConnections(currentRemoteUsers) {
        console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote User: ${currentRemoteUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

        // Schließe PCs für Benutzer, die nicht mehr in der Liste sind
        state.peerConnections.forEach((pc, peerId) => {
            const peerStillExists = currentRemoteUsers.some(user => user.id === peerId);
            if (!peerStillExists) {
                console.log(`[WebRTC] Peer ${peerId} nicht mehr in Userliste. Schließe PeerConnection.`);
                closePeerConnection(peerId); // Ruft closePeerConnection für jeden Peer auf
            }
        });

        // Erstelle PCs für neue Benutzer in der Liste
        currentRemoteUsers.forEach(async user => {
            if (!state.peerConnections.has(user.id)) {
                console.log(`[WebRTC] Neuer Peer ${user.username} (${user.id}) gefunden. Erstelle PeerConnection.`);
                const pc = await createPeerConnection(user.id);

                 // Füge die Tracks des aktuellen lokalen Streams (Mikro oder Screen) zur neuen PC hinzu
                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                      console.log(`[WebRTC] Füge Tracks vom aktuellen lokalen Stream (${currentLocalStream.id || 'none'}) zur neuen PC (${user.id}) hinzu.`);
                      addLocalStreamTracksToPeerConnection(pc, currentLocalStream); // Füge Tracks hinzu
                 } else {
                      console.log(`[WebRTC] Kein lokaler Stream zum Hinzufügen zur neuen PC (${user.id}). Tracks werden später hinzugefügt.`);
                 }


                 // Bestimme, ob wir der Initiator (Offer-Ersteller) sein sollen
                 // Der Peer mit der kleineren ID initiiert (Polite/Impolite)
                 const shouldInitiateOffer = state.socketId < user.id;
                 if (shouldInitiateOffer) {
                      console.log(`[WebRTC] Bin Initiator für Peer ${user.id}. Erstelle initiales Offer.`);
                      // onnegotiationneeded wird getriggert und das Offer erstellen und senden
                 } else {
                     console.log(`[WebRTC] Bin Receiver für Peer ${user.id}. Warte auf Offer.`);
                 }
            } else {
                // Peer existiert bereits. Stelle sicher, dass die Tracks aktualisiert werden,
                // falls sich der lokale Stream geändert hat (z.B. Start/Stop Teilen).
                 const pc = state.peerConnections.get(user.id);
                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                     // console.log(`[WebRTC] Peer ${user.id} existiert. Stelle sicher, dass Tracks vom Stream (${currentLocalStream.id || 'none'}) aktuell sind.`); // Zu viele Logs
                      addLocalStreamTracksToPeerConnection(pc, currentLocalStream); // Aktualisiere Tracks
                 } else {
                      console.log(`[WebRTC] Peer ${user.id} existiert, aber kein lokaler Stream zum Aktualisieren.`);
                       // Wenn kein lokaler Stream da ist, stelle sicher, dass keine Tracks gesendet werden (replace mit null)
                       addLocalStreamTracksToPeerConnection(pc, null); // Entferne alle Tracks
                 }
            }
        }); // Ende currentRemoteUsers.forEach
    }


    // Schließt eine spezifische PeerConnection und bereinigt zugehörige Ressourcen
    function closePeerConnection(peerId) {
        console.log(`[WebRTC] closePeerConnection aufgerufen für Peer: ${peerId}.`);
        const pc = state.peerConnections.get(peerId);

        if (pc) {
            console.log(`[WebRTC] Schließe PeerConnection mit ${peerId}.`);
             // Entferne alle Sender (der Track im ursprünglichen Stream wird NICHT gestoppt)
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

         // Bereinige zugehörige Ressourcen für diesen Peer
         removeRemoteAudioElement(peerId); // Entfernt das Audio-Element

         // Entferne den empfangenen Stream für diesen Peer aus der Map und stoppe seine Tracks
         if (state.remoteStreams.has(peerId)) {
              console.log(`[WebRTC] Entferne remoteStream für Peer ${peerId}.`);
              const streamToRemove = state.remoteStreams.get(peerId);
              streamToRemove.getTracks().forEach(track => track.stop()); // Stoppe die Tracks im Stream
              state.remoteStreams.delete(peerId);
         }

         // Wenn der geteilte Bildschirm von diesem Peer kam ODER wir ihn gerade ansehen, blende ihn aus
         if (state.currentlyViewingPeerId === peerId) {
              console.log(`[WebRTC] Geschlossener Peer ${peerId} wurde betrachtet. Stoppe Anzeige.`);
              // Rufe die Stopp-Logik auf, simuliere einen Klick mit forceStop
              handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true); // forceStop = true
              // currentlyViewingPeerId wird in handleViewScreenClick auf null gesetzt
         } else {
             // Wenn der Peer, der gerade geschlossen wurde, NICHT der war, der betrachtet wurde,
             // müssen wir sicherstellen, dass falls er geteilt hat, die Info aus der Userliste verschwindet
             // und der Button "Ansehen" entfernt wird. Das passiert automatisch durch userListUpdate.
         }
    }

    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
        // Iteriere über eine Kopie der Keys, da closePeerConnection die Map ändert
        Array.from(state.peerConnections.keys()).forEach(peerId => {
            closePeerConnection(peerId); // Ruft closePeerConnection für jeden Peer auf
        });
         state.peerConnections.clear(); // Sicherstellen, dass die Map leer ist
         console.log("[WebRTC] Alle PeerConnections geschlossen.");

         // Stelle sicher, dass alle empfangenen Streams gestoppt und gelöscht werden
         state.remoteStreams.forEach(stream => {
             stream.getTracks().forEach(track => track.stop());
         });
         state.remoteStreams.clear();
          console.log("[WebRTC] Alle empfangenen Streams gestoppt und gelöscht.");

          // Stelle sicher, dass die Remote-Bildschirmanzeige ausgeschaltet ist
          updateRemoteScreenDisplay(null); // Setzt auch currentlyViewingPeerId auf null

    }


    // --- Chat Logic ---
    // ... (sendMessage, appendMessage, sendTyping bleiben gleich) ...


    // --- Remote Screen Viewing Logic ---

    // Behandelt das Klicken auf den "Bildschirm ansehen" / "Anzeige stoppen" Button
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
             // Klick auf "Anzeige stoppen" für den aktuell betrachteten Peer
             console.log(`[UI] Klick auf "Anzeige stoppen" für Peer ${peerId}.`);
             // Verstecke die Anzeige
             updateRemoteScreenDisplay(null); // Setzt currentlyViewingPeerId auf null

             // Aktualisiere alle "Ansehen" Buttons für alle Sharer (aktiviere sie wieder)
              state.allUsersList.forEach(user => {
                  if (user.id !== state.socketId && user.sharingStatus) {
                       const sharerButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                       if (sharerButton) sharerButton.disabled = false; // Alle Buttons wieder aktivieren
                  }
              });
             // Der geklickte Button wird automatisch in updateRemoteScreenDisplay(null) zurückgesetzt,
             // da updateUserList aufgerufen wird, um die UI zu aktualisieren.
             // Oder wir machen es hier explizit:
             clickedButton.textContent = 'Bildschirm ansehen';
             clickedButton.classList.remove('stop');
             clickedButton.classList.add('view');


         } else if (!isCurrentlyViewing) {
             // Klick auf "Bildschirm ansehen" für einen Peer
             console.log(`[UI] Klick auf "Bildschirm ansehen" für Peer ${peerId}.`);

             // Prüfe, ob dieser Peer auch tatsächlich teilt (sollte durch Button-Anzeige garantiert sein)
             const sharerUser = state.allUsersList.find(user => user.id === peerId && user.sharingStatus);
             // Hole den empfangenen Stream für diesen Peer
             const sharerStream = state.remoteStreams.get(peerId);

             if (sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0) {
                 // Peer teilt und wir haben einen Stream mit Video -> Anzeige starten
                  console.log(`[UI] Peer ${peerId} teilt und Stream ist verfügbar. Zeige Bildschirm an.`);
                 // **Wichtig:** Wenn bereits ein ANDERER Bildschirm angezeigt wird, stoppe diesen zuerst.
                  if (state.currentlyViewingPeerId !== null && state.currentlyViewingPeerId !== peerId) {
                      console.log(`[UI] Stoppe vorherige Anzeige von Peer ${state.currentlyViewingPeerId}.`);
                      handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true); // forceStop = true
                  }


                 updateRemoteScreenDisplay(peerId); // Startet die Anzeige für diesen Peer

                 // Deaktiviere die "Ansehen" Buttons für alle ANDEREN Sharer
                 state.allUsersList.forEach(user => {
                      if (user.id !== state.socketId && user.sharingStatus && user.id !== peerId) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true; // Andere Buttons deaktivieren
                      }
                 });

                 // Aktualisiere den geklickten Button zu "Anzeige stoppen"
                  clickedButton.textContent = 'Anzeige stoppen';
                  clickedButton.classList.remove('view');
                  clickedButton.classList.add('stop');


             } else {
                 // Peer teilt nicht mehr oder wir haben den Stream nicht (mehr)
                 console.warn(`[UI] Peer ${peerId} teilt nicht oder Stream nicht verfügbar. Kann Bildschirm nicht ansehen.`);
                 displayError(`Bildschirm von ${sharerUser ? escapeHTML(sharerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden.`);
                 // Blende Anzeige aus, falls fälschlicherweise etwas angezeigt wurde
                 updateRemoteScreenDisplay(null);
                 // Setze den Button zurück (dies wird auch durch userListUpdate gehandhabt, aber zur Sicherheit)
                 clickedButton.textContent = 'Bildschirm ansehen';
                 clickedButton.classList.remove('stop');
                 clickedButton.classList.add('view');
            }
         } else if (isCurrentlyViewing && forceStop) {
              // Force stop case (triggered internally when sharer leaves or stops, or when viewing another screen)
              console.log(`[UI] Force Stop Anzeige für Peer ${peerId}.`);
              // Verstecke die Anzeige und setze den State zurück
              updateRemoteScreenDisplay(null); // Setzt currentlyViewingPeerId auf null

              // Finde den Button für diesen Peer in der Userliste und setze ihn zurück
              const viewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${peerId}']`);
               if (viewButton) {
                    viewButton.textContent = 'Bildschirm ansehen';
                    viewButton.classList.remove('stop');
                    viewButton.classList.add('view');
               }

               // Aktiviere Buttons für andere Sharer wieder
                state.allUsersList.forEach(user => {
                     if (user.id !== state.socketId && user.sharingStatus) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = false; // Andere Buttons aktivieren
                     }
                });
         }
    } // Ende handleViewScreenClick


    // Aktualisiert die Anzeige des geteilten Remote-Bildschirms
    // Zeigt den Stream des Peers an, dessen ID in peerIdToDisplay steht (oder blendet aus, wenn null)
    function updateRemoteScreenDisplay(peerIdToDisplay) {
         console.log(`[UI] updateRemoteScreenDisplay aufgerufen. Peer ID zum Anzeigen: ${peerIdToDisplay}. Aktueller betrachteter State: ${state.currentlyViewingPeerId}`);

         if (!UI.remoteScreenContainer || !UI.remoteScreenVideo || !UI.remoteScreenSharerName) {
             console.warn("[UI] updateRemoteScreenDisplay: Benötigte UI Elemente nicht gefunden.");
             // Setze den State zurück, falls UI fehlt
              state.currentlyViewingPeerId = null;
              if (UI.remoteScreenVideo && UI.remoteScreenVideo.srcObject) UI.remoteScreenVideo.srcObject = null;
             if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.add('hidden');
             if (UI.remoteScreenSharerName) UI.remoteScreenSharerName.textContent = '';

             return;
         }

         const sharerUser = state.allUsersList.find(u => u.id === peerIdToDisplay);
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

         }
    }


    // ... (ensureRemoteAudioElementExists, removeRemoteAudioElement, toggleLocalAudioMute, updateLocalMuteButtonUI, toggleRemoteAudioMute bleiben gleich) ...

    // --- Init ---
    initializeUI();

});
