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

    // NEUE ZEILE FÜR DEBUGGING DES BUTTONS
    console.log("[App] UI.connectBtn gefunden:", !!UI.connectBtn); // Prüft, ob das Element gefunden wurde (true/false)
    if (UI.connectBtn) {
        console.log("[App] UI.connectBtn Element:", UI.connectBtn); // Zeigt das Element in der Konsole an
    }

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room',
        socketId: null,
        allUsersList: [], // Beinhaltet Benutzerobjekte { id, username, color, sharingStatus }

        typingTimeout: null,
        typingUsers: new Set(), // Set von Benutzernamen, die gerade tippen

        notificationSound: new Audio('/notif.mp3'),

        // WebRTC State (Lokal)
        localAudioStream: null,
        screenStream: null,
        isSharingScreen: false,

        // WebRTC State (Remote)
        peerConnections: new Map(), // { peerId: RTCPeerConnection }
        remoteAudioElements: new Map(), // { peerId: HTMLAudioElement }
        remoteStreams: new Map(), // { peerId: MediaStream (remote) }

        // Bildschirm teilen State (Remote Anzeige)
        currentlyViewingPeerId: null, // ID des Peers, dessen Bildschirm gerade angezeigt wird

        localAudioMuted: false,
    };

    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500, // ms
        RTC_CONFIGURATION: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Füge ggf. weitere STUN/TURN-Server hinzu
            ],
        },
        // Farben für Benutzer im Chat und der Liste
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9700', '#ff5722', '#795548'],
    };

    // --- Funktionsdefinitionen ---

    // Hilfsfunktion zum Escapen von HTML-Sonderzeichen
    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, m => map[m]);
    }

    // Hilfsfunktion zur Ermittlung der Benutzerfarbe basierend auf ID oder Namen
    function getUserColor(userIdOrName) {
        let hash = 0;
        const str = String(userIdOrName);
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return CONFIG.USER_COLORS[Math.abs(hash) % CONFIG.USER_COLORS.length];
    }

    // Spielt den Benachrichtigungssound ab
    function playNotificationSound() {
        if (state.notificationSound) {
            // Stoppe den Sound, falls er noch läuft und spiele ihn von vorne ab
            state.notificationSound.currentTime = 0;
             state.notificationSound.play().catch(e => {
                 // Fang den Fehler ab, falls Autoplay blockiert wird etc.
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
             });
        }
    }

    // Aktualisiert den Verbindungsstatus in der UI
    function setConnectionStatus(statusClass, text) {
        if (!UI.statusIndicator) return;
        UI.statusIndicator.className = `status-indicator ${statusClass}`; // Klasse für Styling setzen
        UI.statusIndicator.textContent = text; // Text setzen
    }

    // Zeigt eine temporäre Fehlermeldung in der UI an
    function displayError(message) {
        if (!UI.errorMessage) return;
        UI.errorMessage.textContent = message;
        UI.errorMessage.classList.remove('hidden');
        // Verstecke die Nachricht nach 5 Sekunden wieder
        setTimeout(() => {
            if (UI.errorMessage) UI.errorMessage.classList.add('hidden');
        }, 5000);
    }

    // Initialisiert den UI-Zustand beim Laden der Seite oder nach Trennung
    function initializeUI() {
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        // Setze UI-Elemente auf den nicht verbundenen Zustand
        if(UI.connectBtn) UI.connectBtn.classList.remove('hidden');
        if(UI.disconnectBtn) UI.disconnectBtn.classList.add('hidden');
        if(UI.shareScreenBtn) UI.shareScreenBtn.classList.add('hidden');
        if(UI.sendBtn) UI.sendBtn.disabled = true;
        if(UI.messageInput) UI.messageInput.disabled = true;
        setConnectionStatus('disconnected', 'Nicht verbunden'); // Statusanzeige
        loadStateFromLocalStorage(); // Lade gespeicherten Benutzernamen
        if (UI.micSelect) UI.micSelect.disabled = false; // Mikrofonauswahl aktivieren
        updateRemoteAudioControls(); // Remote Audio UI aufräumen/verstecken
        updateRemoteScreenDisplay(null); // Remote Screen UI aufräumen/verstecken
        updateLocalMuteButtonUI(); // Lokalen Mute Button Zustand aktualisieren (versteckt/disabled)
        updateShareScreenButtonUI(); // Share Screen Button Zustand aktualisieren (versteckt/disabled)
    }

    // Aktualisiert den UI-Zustand nach erfolgreicher Verbindung
    function updateUIAfterConnect() {
        console.log("[UI] updateUIAfterConnect aufgerufen.");
        state.connected = true; // Zustand setzen

        // Wechsle Sichtbarkeit der Buttons
        if(UI.connectBtn) UI.connectBtn.classList.add('hidden');
        if(UI.disconnectBtn) UI.disconnectBtn.classList.remove('hidden');
        if(UI.shareScreenBtn) UI.shareScreenBtn.classList.remove('hidden'); // Share Button anzeigen
        if(UI.sendBtn) UI.sendBtn.disabled = false; // Sende Button aktivieren
        if(UI.messageInput) UI.messageInput.disabled = false; // Nachrichteneingabe aktivieren
        if (UI.usernameInput) UI.usernameInput.disabled = true; // Benutzernamen sperren
        if (UI.micSelect) UI.micSelect.disabled = true; // Mikrofonauswahl sperren (Änderung erst nach Disconnect/ScreenShare Ende)
        setConnectionStatus('connected', `Verbunden als ${state.username}`); // Statusanzeige
        saveStateToLocalStorage(); // Benutzernamen speichern

        // Setup local audio stream only if not sharing screen
        if (!state.isSharingScreen) {
            setupLocalAudioStream();
        } else {
             // If already sharing, ensure its tracks are added to new PCs
             state.peerConnections.forEach(pc => {
                 addLocalStreamTracksToPeerConnection(pc, state.screenStream);
             });
        }

        populateMicList(); // Mikrofonliste füllen (auch wenn Dropdown disabled ist, für Info)
        updateLocalMuteButtonUI(); // Lokalen Mute Button anzeigen/aktivieren
        updateShareScreenButtonUI(); // Share Screen Button anzeigen/aktivieren
    }

    // Aktualisiert den UI-Zustand nach Trennung der Verbindung
    function updateUIAfterDisconnect() {
        console.log("[UI] updateUIAfterDisconnect aufgerufen.");
        state.connected = false; // Zustand setzen

        // Wechsle Sichtbarkeit der Buttons
        if(UI.connectBtn) UI.connectBtn.classList.remove('hidden');
        if(UI.disconnectBtn) UI.disconnectBtn.classList.add('hidden');
        if(UI.shareScreenBtn) UI.shareScreenBtn.classList.add('hidden'); // Share Button verstecken
        if(UI.sendBtn) UI.sendBtn.disabled = true; // Sende Button deaktivieren
        if(UI.messageInput) UI.messageInput.disabled = true; // Nachrichteneingabe deaktivieren
        if (UI.usernameInput) UI.usernameInput.disabled = false; // Benutzernamen freigeben
        if (UI.micSelect) UI.micSelect.disabled = false; // Mikrofonauswahl freigeben
        setConnectionStatus('disconnected', 'Nicht verbunden'); // Statusanzeige
        if(UI.userList) UI.userList.innerHTML = ''; // Benutzerliste leeren
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = '0'; // Benutzeranzahl zurücksetzen
        if(UI.typingIndicator) UI.typingIndicator.textContent = ''; // Tipp-Anzeige leeren
        state.typingUsers.clear(); // Tippende Benutzer zurücksetzen

        stopLocalAudioStream(); // Lokalen Audio-Stream stoppen
        stopScreenSharing(false); // Bildschirmteilung stoppen (kein Socket-Signal senden, da disconnected)
        closeAllPeerConnections(); // Alle WebRTC Verbindungen schließen

        updateRemoteAudioControls(); // Remote Audio UI aufräumen/verstecken
        updateRemoteScreenDisplay(null); // Remote Screen UI aufräumen/verstecken

        // Zustandsvariablen zurücksetzen
        state.allUsersList = [];
        state.socketId = null;
        state.remoteStreams.clear();
        state.peerConnections.clear();
        state.remoteAudioElements.forEach(el => el.remove()); // Sicherstellen, dass Audio-Elemente entfernt werden
        state.remoteAudioElements.clear();
        state.localAudioMuted = false; // Lokalen Mute-Zustand zurücksetzen

        updateLocalMuteButtonUI(); // Lokalen Mute Button verstecken/deaktivieren
        updateShareScreenButtonUI(); // Share Screen Button verstecken/deaktivieren

         // Nachrichtenverlauf löschen? Optional, je nach gewünschtem Verhalten
         // UI.messagesContainer.innerHTML = '';
    }

    // Speichert den Benutzernamen im lokalen Speicher des Browsers
    function saveStateToLocalStorage() {
        if (UI.usernameInput) {
            localStorage.setItem('chatClientUsername', UI.usernameInput.value);
        }
    }

    // Lädt den Benutzernamen aus dem lokalen Speicher beim Start
    function loadStateFromLocalStorage() {
        const savedUsername = localStorage.getItem('chatClientUsername');
        if (savedUsername && UI.usernameInput) {
            UI.usernameInput.value = savedUsername;
        }
    }

    // Füllt das Dropdown mit verfügbaren Mikrofonen
    async function populateMicList() {
        console.log("[Media] populateMicList aufgerufen.");
        if (!UI.micSelect) {
            console.warn("[Media] populateMicList: UI.micSelect nicht gefunden.");
            return;
        }
        UI.micSelect.innerHTML = '';
        UI.micSelect.appendChild(new Option("Standard-Mikrofon", "", true, true)); // Standard-Option

        try {
            // enumerateDevices benötigt vorherige Berechtigung (getUserMedia), um Gerätelabels zu sehen
            // Ruf setupLocalAudioStream() vor dem Verbinden auf, oder handle den Fehler
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');

            if (audioInputs.length > 0) {
                 audioInputs.forEach(d => {
                     // Füge nur Geräte mit Label oder ID hinzu, die nicht "default" sind
                     if (d.deviceId !== 'default' && (d.label || d.deviceId)) {
                         const opt = new Option(d.label || `Mikrofon (${d.deviceId})`, d.deviceId);
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
             opt.style.color = 'var(--error-text-color)'; // Fehler im Dropdown anzeigen
             UI.micSelect.appendChild(opt);
             if (UI.micSelect) UI.micSelect.disabled = true; // Dropdown deaktivieren
             const localMuteBtn = document.getElementById('localMuteBtn');
             if(localMuteBtn) localMuteBtn.disabled = true; // Mute Button deaktivieren
        }
    }

    // Aktualisiert die Benutzerliste in der UI basierend auf Daten vom Server
    function updateUserList(usersArrayFromServer) {
        // DIESE FUNKTION WIRD AUFGERUFEN, WENN DER CLIENT DAS 'user list'-EVENT VOM SERVER EMPFÄNGT.
        // Wenn dies passiert, wird die Liste aktualisiert.
        console.log("[UI] updateUserList aufgerufen mit", usersArrayFromServer.length, "Benutzern.");
        const oldUsers = state.allUsersList;
        state.allUsersList = usersArrayFromServer; // Benutzerliste im State speichern

        // Benutzeranzahl aktualisieren
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        // Filtere andere Benutzer für WebRTC und Remote Audio/Screen Controls
        const otherUsers = usersArrayFromServer.filter(user => user.id !== state.socketId);

        // Benutzerliste in der UI leeren
        if(UI.userList) UI.userList.innerHTML = '';

        // Iteriere über die Benutzer vom Server und erstelle Listeneinträge
        usersArrayFromServer.forEach(user => {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.classList.add('user-dot');
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id)); // Farbe setzen
            li.appendChild(dot);

            const nameContainer = document.createElement('span');
            nameContainer.style.flexGrow = '1';
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.overflow = 'hidden';
            nameContainer.style.textOverflow = 'ellipsis';
            nameContainer.style.whiteSpace = 'nowrap';


            const nameNode = document.createTextNode(`${escapeHTML(user.username)}`);
            // Spezielles Handling für den lokalen Benutzer
            if (user.id === state.socketId) {
                const strong = document.createElement('strong');
                strong.appendChild(nameNode);
                strong.appendChild(document.createTextNode(" (Du)"));
                nameContainer.appendChild(strong);

                 // Der lokale Mute Button Listener wird jetzt einmalig im DOMContentLoaded Block zugewiesen.
                 // Hier nur die UI aktualisieren, falls nötig (wird von updateUIAfterConnect/Disconnect gemacht)
                 updateLocalMuteButtonUI(); // Sicherstellen, dass der Status korrekt angezeigt wird
                 updateShareScreenButtonUI(); // Sicherstellen, dass der Status korrekt angezeigt wird

            } else {
                nameContainer.appendChild(nameNode);

                // Bildschirmteilungs-Indikator hinzufügen, falls der Benutzer teilt
                if (user.sharingStatus) {
                     const sharingIndicator = document.createElement('span');
                     sharingIndicator.classList.add('sharing-indicator');
                     sharingIndicator.textContent = ' 🖥️'; // Desktop-Symbol
                     sharingIndicator.title = `${escapeHTML(user.username)} teilt Bildschirm`;
                     nameContainer.appendChild(sharingIndicator);
                }

                // Benachrichtigung abspielen, wenn ein neuer Benutzer beitritt
                 // Überprüfe, ob der Benutzer vorher nicht in der Liste war (und ob es vorher überhaupt Benutzer gab)
                 if (state.connected && oldUsers.length > 0 && !oldUsers.some(oldUser => oldUser.id === user.id)) {
                     console.log(`[UI] Neuer Benutzer beigetreten: ${user.username}`);
                     playNotificationSound();
                 }
            }

            li.appendChild(nameContainer);

            // "Bildschirm ansehen" Button für Benutzer hinzufügen, die teilen
            if (user.id !== state.socketId && user.sharingStatus) {
                 const viewButton = document.createElement('button');
                 viewButton.classList.add('view-screen-button');
                 viewButton.dataset.peerId = user.id; // Peer ID als Data-Attribut speichern

                 // Text und Klasse basierend darauf setzen, ob dieser Peer gerade angesehen wird
                 const isViewingThisPeer = state.currentlyViewingPeerId === user.id;

                 if (isViewingThisPeer) {
                     viewButton.textContent = 'Anzeige stoppen';
                     viewButton.classList.add('stop');
                 } else {
                     viewButton.textContent = 'Bildschirm ansehen';
                     viewButton.classList.add('view');
                 }

                 viewButton.addEventListener('click', handleViewScreenClick); // Listener hinzufügen

                 li.appendChild(viewButton);
            }


            if(UI.userList) UI.userList.appendChild(li); // Listeneintrag zur UI hinzufügen
        });

         // WebRTC PeerConnections aktualisieren (erstellen für neue, schließen für gegangene)
         updatePeerConnections(otherUsers);
         // Remote Audio Controls (Mute/Unmute) aktualisieren
         updateRemoteAudioControls(otherUsers);

         // Sichtbarkeit der Remote Audio Controls Sektion umschalten
         if (UI.remoteAudioControls) {
              if (otherUsers.length > 0) {
                  UI.remoteAudioControls.classList.remove('hidden');
              } else {
                  UI.remoteAudioControls.classList.add('hidden');
              }
         }

         // Logik zur Aktualisierung des "Bildschirm ansehen/stoppen" Buttons,
         // falls der aktuell betrachtete Peer nicht mehr teilt oder verschwunden ist.
          if (state.currentlyViewingPeerId) {
               const sharerUser = state.allUsersList.find(user => user.id === state.currentlyViewingPeerId);
               const sharerStillSharing = sharerUser && sharerUser.sharingStatus;

               if (!sharerStillSharing) {
                    console.log(`[UI] Aktuell betrachteter Sharer (${state.currentlyViewingPeerId}) teilt laut Userliste nicht mehr. Stoppe Anzeige.`);
                    // Simuliere Klick auf "Anzeige stoppen" (forceStop=true)
                    handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true);
               } else {
                   // Stelle sicher, dass der Button des aktuell betrachteten Sharers korrekt aussieht und aktiv ist
                   const viewingButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${state.currentlyViewingPeerId}']`);
                   if(viewingButton) {
                        viewingButton.textContent = 'Anzeige stoppen';
                        viewingButton.classList.remove('view');
                        viewingButton.classList.add('stop');
                        viewingButton.disabled = false; // Button aktivieren, falls der User noch da ist
                   }
                   // Deaktiviere andere "Bildschirm ansehen" Buttons, während einer angesehen wird
                    state.allUsersList.forEach(user => {
                         if (user.id !== state.socketId && user.sharingStatus && user.id !== state.currentlyViewingPeerId) {
                            const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                            if (otherViewButton) otherViewButton.disabled = true;
                         }
                    });
               }
          } else {
               // Wenn niemand angesehen wird, stelle sicher, dass alle "Bildschirm ansehen" Buttons aktiv sind
               state.allUsersList.forEach(user => {
                    if (user.id !== state.socketId && user.sharingStatus) {
                        const viewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                        if(viewButton) viewButton.disabled = false;
                    }
               });
          }

    }

    // Aktualisiert die Anzeige der tippenenden Benutzer
    function updateTypingIndicatorDisplay() {
        if (!UI.typingIndicator) return;
        // Filtert den lokalen Benutzer aus der Liste der tippenenden
        const typingUsernames = Array.from(state.typingUsers).filter(name => name !== state.username);

        if (typingUsernames && typingUsernames.length > 0) {
            // Liste der tippenenden Benutzer formatieren und anzeigen
             const usersString = typingUsernames.map(escapeHTML).join(', ');
             UI.typingIndicator.textContent = `${usersString} schreibt...`;
             UI.typingIndicator.style.display = 'block'; // Anzeige einblenden
        } else {
             UI.typingIndicator.style.display = 'none'; // Anzeige ausblenden
        }
    }

    // Aktualisiert die Remote Audio Mute/Unmute Controls in der UI
    function updateRemoteAudioControls(remoteUsers = []) {
         if (!UI.remoteAudioControls) return;

         // Aktuelle Mute-Zustände beibehalten, bevor die Liste neu aufgebaut wird
         const mutedStates = new Map();
         state.remoteAudioElements.forEach((audioEl, peerId) => {
             mutedStates.set(peerId, audioEl.muted);
         });

         // Controls Sektion leeren
         UI.remoteAudioControls.innerHTML = '';

         // Controls für jeden Remote Benutzer hinzufügen
         if (remoteUsers.length > 0) {
             const title = document.createElement('h3');
             title.textContent = 'Sprach-Teilnehmer';
             UI.remoteAudioControls.appendChild(title);

             remoteUsers.forEach(user => {
                 const itemDiv = document.createElement('div');
                 itemDiv.classList.add('remote-audio-item');
                 itemDiv.id = `remoteAudioItem_${user.id}`; // ID hinzufügen zum leichteren Entfernen

                 const nameSpan = document.createElement('span');
                 nameSpan.textContent = escapeHTML(user.username);
                 nameSpan.style.color = escapeHTML(user.color || getUserColor(user.id));
                 itemDiv.appendChild(nameSpan);

                 const muteBtn = document.createElement('button');
                 muteBtn.textContent = 'Stumm schalten';
                 muteBtn.classList.add('mute-btn');
                 muteBtn.dataset.peerId = user.id; // Peer ID als Data-Attribut speichern
                 muteBtn.addEventListener('click', toggleRemoteAudioMute); // Listener hinzufügen

                 // Gespeicherten Mute-Zustand anwenden oder Standard (nicht gemutet)
                 const isMuted = mutedStates.has(user.id) ? mutedStates.get(user.id) : false;
                 muteBtn.classList.toggle('muted', isMuted);
                 muteBtn.textContent = isMuted ? 'Stumm AN' : 'Stumm schalten';


                 itemDiv.appendChild(muteBtn);

                 UI.remoteAudioControls.appendChild(itemDiv);

                  // Sicherstellen, dass ein Audio-Element für diesen Benutzer existiert und dessen Mute-Zustand setzen
                  const audioElement = ensureRemoteAudioElementExists(user.id);
                  audioElement.muted = isMuted; // Mute-Zustand des UI-Buttons auf das Audio-Element übertragen
             });
         }

         // Audio-Elemente für Benutzer entfernen, die nicht mehr in der Liste sind
         Array.from(state.remoteAudioElements.keys()).forEach(peerId => {
             const userStillExists = remoteUsers.some(user => user.id === peerId);
             if (!userStillExists) {
                 removeRemoteAudioElement(peerId);
             }
         });
    }

    // Aktualisiert die Anzeige des Remote-Bildschirms
    function updateRemoteScreenDisplay(peerIdToDisplay) {
         console.log(`[UI] updateRemoteScreenDisplay aufgerufen. Peer ID zum Anzeigen: ${peerIdToDisplay}. Aktueller betrachteter State: ${state.currentlyViewingPeerId}`);

         // Überprüfe, ob die benötigten UI-Elemente existieren
         if (!UI.remoteScreenContainer || !UI.remoteScreenVideo || !UI.remoteScreenSharerName) {
             console.warn("[UI] updateRemoteScreenDisplay: Benötigte UI Elemente nicht gefunden.");
              state.currentlyViewingPeerId = null;
              if (UI.remoteScreenVideo && UI.remoteScreenVideo.srcObject) UI.remoteScreenVideo.srcObject = null;
             if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.add('hidden');
             if (UI.remoteScreenSharerName) UI.remoteScreenSharerName.textContent = '';
             if (document.fullscreenElement) document.exitFullscreen(); // Vollbild verlassen, wenn Element entfernt wird

             // Stelle sicher, dass die is-fullscreen Klasse entfernt wird
             if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.remove('is-fullscreen');
             if (UI.remoteScreenVideo) UI.remoteScreenVideo.classList.remove('is-fullscreen');

             return;
         }

         // Finde den Benutzer und den zugehörigen Stream
         const sharerUser = state.allUsersList.find(user => user.id === peerIdToDisplay);
         const sharerStream = state.remoteStreams.get(peerIdToDisplay);

         // Prüfe, ob der Bildschirm angezeigt werden kann (Benutzer existiert, Stream existiert und hat Video-Tracks)
         const canDisplay = sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0;


         if (canDisplay) {
             console.log(`[UI] Zeige geteilten Bildschirm von ${sharerUser.username} (${peerIdToDisplay}).`);

             // Stream dem Videoelement zuweisen
             UI.remoteScreenVideo.srcObject = sharerStream;
             // Videoelement stumm schalten, da Audio separat gehandhabt wird
             UI.remoteScreenVideo.muted = true;
             // Video abspielen
             UI.remoteScreenVideo.play().catch(e => console.error("[UI] Fehler beim Abspielen des Remote-Bildschirms:", e));

             // Benutzernamen anzeigen
             UI.remoteScreenSharerName.textContent = escapeHTML(sharerUser.username);
             UI.remoteScreenContainer.classList.remove('hidden'); // Container anzeigen

             state.currentlyViewingPeerId = peerIdToDisplay; // State aktualisieren

             // Füge is-fullscreen Klasse hinzu, falls wir gerade im Vollbildmodus sind (wird durch fullscreenchange Event gehandhabt)
             if (document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement))) {
                 UI.remoteScreenContainer.classList.add('is-fullscreen');
                 UI.remoteScreenVideo.classList.add('is-fullscreen');
             }


         } else {
             console.log("[UI] Keine Bildschirmteilung zum Anzeigen oder Peer teilt nicht mehr/Stream nicht verfügbar.");

             // Videoelement stoppen und Source entfernen
             if (UI.remoteScreenVideo.srcObject) {
                 UI.remoteScreenVideo.srcObject = null;
                 console.log("[UI] Wiedergabe des Remote-Bildschirms gestoppt.");
             }

             // Container und Namen verstecken
             UI.remoteScreenContainer.classList.add('hidden');
             UI.remoteScreenSharerName.textContent = '';

             state.currentlyViewingPeerId = null; // State zurücksetzen

             // Vollbild verlassen, wenn der angezeigte Bildschirm nicht mehr verfügbar ist
              if (document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement))) {
                   document.exitFullscreen();
              }
             // Stelle sicher, dass die is-fullscreen Klasse entfernt wird
             if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.remove('is-fullscreen');
             if (UI.remoteScreenVideo) UI.remoteScreenVideo.classList.remove('is-fullscreen');
         }
    }


    // Stellt sicher, dass ein Audio-Element für einen bestimmten Peer existiert (für WebRTC Audio)
    function ensureRemoteAudioElementExists(peerId) {
        let audioElement = state.remoteAudioElements.get(peerId);
        if (!audioElement) {
             console.log(`[WebRTC] Erstelle neues Audio-Element für Peer ${peerId}.`);
             audioElement = new Audio();
             audioElement.autoplay = true; // Audio soll automatisch abspielen
             audioElement.style.display = 'none'; // Nicht sichtbar
             // Füge das Audio-Element zum DOM hinzu, z.B. direkt im Body
             document.body.appendChild(audioElement); // Zum Body hinzufügen

             state.remoteAudioElements.set(peerId, audioElement); // Im State speichern
              console.log(`[WebRTC] Audio-Element für Peer ${peerId} erstellt und hinzugefügt.`);

             // Initialen Mute-Zustand setzen, basierend auf dem UI-Button, falls vorhanden
             const muteButton = UI.remoteAudioControls ? UI.remoteAudioControls.querySelector(`.mute-btn[data-peer-id='${peerId}']`) : null;
             if (muteButton) {
                 audioElement.muted = muteButton.classList.contains('muted');
             } else {
                  // Standardmäßig nicht gemutet, falls kein Control existiert
                  audioElement.muted = false;
             }
        }
         return audioElement; // Gibt das bestehende oder neu erstellte Element zurück
    }

    // Entfernt das Audio-Element für einen Peer
    function removeRemoteAudioElement(peerId) {
         const audioElement = state.remoteAudioElements.get(peerId);
         if (audioElement) {
             console.log(`[WebRTC] Entferne Audio-Element für Peer ${peerId}.`);
             audioElement.pause();
             audioElement.srcObject = null; // Stream-Referenz entfernen
             audioElement.remove(); // Aus dem DOM entfernen
             state.remoteAudioElements.delete(peerId); // Aus dem State entfernen
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} entfernt.`);
         }
         // Entferne auch das entsprechende UI Control Element
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
         state.localAudioMuted = !state.localAudioMuted; // Mute-Zustand umschalten
         console.log(`[WebRTC] Lokales Mikrofon: ${state.localAudioMuted ? 'Stumm' : 'Aktiv'}`);

         // Alle Audio-Tracks des lokalen Streams aktualisieren (aktivieren/deaktivieren)
         state.localAudioStream.getAudioTracks().forEach(track => {
             track.enabled = !state.localAudioMuted; // track.enabled steuert das Senden des Audios
             console.log(`[WebRTC] Lokaler Audio Track ${track.id} enabled: ${track.enabled}`);
         });

         updateLocalMuteButtonUI(); // UI des Mute Buttons aktualisieren
    }

     // Aktualisiert das Aussehen des lokalen Mute Buttons
     function updateLocalMuteButtonUI() {
         const localMuteBtn = document.getElementById('localMuteBtn');
         if (localMuteBtn) {
             localMuteBtn.textContent = state.localAudioMuted ? 'Mikro Stumm AN' : 'Mikro stumm schalten';
             localMuteBtn.classList.toggle('muted', state.localAudioMuted);
             // Deaktiviere den Button, wenn nicht verbunden, Bildschirm geteilt wird (da dann Mic-Stream inaktiv ist), oder kein Mic-Stream verfügbar ist
             localMuteBtn.disabled = !state.connected || state.isSharingScreen || !state.localAudioStream;
             localMuteBtn.classList.toggle('disabled', localMuteBtn.disabled); // Füge eine Klasse für disabled Styling hinzu
         }
     }

     // Schaltet das Audio eines Remote Peers stumm/aktiv (nur lokal für diesen Client)
     function toggleRemoteAudioMute(event) {
         // Hole die Peer ID aus dem Data-Attribut des Buttons
         const peerId = event.target.dataset.peerId;
         // Finde das zugehörige Audio-Element
         const audioElement = state.remoteAudioElements.get(peerId);
         if (!audioElement) {
             console.warn(`[WebRTC] toggleRemoteAudioMute: Audio-Element für Peer ${peerId} nicht gefunden.`);
             return;
         }

         audioElement.muted = !audioElement.muted; // Audio-Element stumm schalten/aktivieren
         console.log(`[WebRTC] Audio von Peer ${peerId} lokal ${audioElement.muted ? 'gemutet' : 'aktiviert'}.`);

         // UI des Buttons aktualisieren
         event.target.textContent = audioElement.muted ? 'Stumm AN' : 'Stumm schalten';
         event.target.classList.toggle('muted', audioElement.muted);
     }

    // Fordert den lokalen Audio-Stream (Mikrofon) an und fügt ihn zu PeerConnections hinzu
    async function setupLocalAudioStream() {
        console.log("[WebRTC] setupLocalAudioStream aufgerufen.");
        // Stoppe eventuell vorhandenen alten Stream
        if (state.localAudioStream) {
            console.log("[WebRTC] Beende alten lokalen Audio-Stream.");
            state.localAudioStream.getTracks().forEach(track => track.stop());
            state.localAudioStream = null;
        }

        // Starte Mikrofon nicht, wenn bereits Bildschirm geteilt wird
        if (state.isSharingScreen) {
             console.log("[WebRTC] setupLocalAudioStream: Bildschirmteilung aktiv, überspringe Mikrofon-Setup.");
             // Füge Tracks des Screen-Streams zu bestehenden PCs hinzu, falls noch nicht geschehen
              state.peerConnections.forEach(pc => {
                   // Wichtig: Hier den screenStream übergeben
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream);
              });
             updateLocalMuteButtonUI(); // Mute Button sollte deaktiviert sein
             return true; // Erfolgreich übersprungen
        }


        try {
            // Erstelle Constraints für getUserMedia
            const selectedMicId = UI.micSelect ? UI.micSelect.value : undefined;
            const audioConstraints = {
                echoCancellation: true, // Unterdrückung von Echos
                noiseSuppression: true, // Rauschunterdrückung
                autoGainControl: true, // Automatische Lautstärkeanpassung
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined // Spezifisches Mikrofon auswählen
            };
            console.log("[WebRTC] Versuche, lokalen Audio-Stream (Mikrofon) zu holen mit Constraints:", audioConstraints);

            // Fordere den lokalen Audio-Stream vom Browser an
            const stream = await navigator.mediaDevices.getUserMedia({
                video: false, // Kein Video
                audio: audioConstraints // Audio mit den definierten Constraints
            });
            state.localAudioStream = stream; // Stream im State speichern
            state.localAudioMuted = false; // Mute-Zustand zurücksetzen
            console.log(`[WebRTC] Lokaler Audio-Stream (Mikrofon) erhalten: ${stream.id}. Tracks: Audio: ${stream.getAudioTracks().length}`);

             // Füge die Tracks des neuen Streams zu allen bestehenden PeerConnections hinzu
             state.peerConnections.forEach(pc => {
                 addLocalStreamTracksToPeerConnection(pc, state.localAudioStream);
             });

             updateLocalMuteButtonUI(); // Lokalen Mute Button aktivieren/anzeigen


            return true; // Erfolgreich
        } catch (err) {
            // Fehler beim Zugriff auf das Mikrofon
            console.error('[WebRTC] Fehler beim Zugriff auf das Mikrofon:', err.name, err.message);
             let errorMessage = `Mikrofonzugriff fehlgeschlagen: ${err.message}.`;
             if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                 errorMessage = "Mikrofonzugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
             }
             displayError(errorMessage); // Fehlermeldung anzeigen

             // UI-Elemente deaktivieren/verstecken, wenn kein Mikrofon verfügbar ist
             if (UI.micSelect) UI.micSelect.disabled = true;
             state.localAudioStream = null; // Stream-State auf null setzen
             updateLocalMuteButtonUI(); // Mute Button deaktivieren

             // Entferne eventuell vorhandene alte Audio-Tracks aus PeerConnections, wenn der Stream fehlschlägt
              state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, null); // Null übergeben, um Tracks zu entfernen
              });


            return false; // Fehler
        }
    }

    // Stoppt den lokalen Audio-Stream (Mikrofon)
    function stopLocalAudioStream() {
         console.log("[WebRTC] stopLocalAudioStream aufgerufen.");
         if (state.localAudioStream) {
             console.log(`[WebRTC] Stoppe Tracks im lokalen Audio-Stream (${state.localAudioStream.id}).`);
             // Alle Tracks im Stream beenden
             state.localAudioStream.getTracks().forEach(track => {
                 console.log(`[WebRTC] Stoppe lokalen Track ${track.id} (${track.kind}).`);
                 track.stop(); // Track stoppen
             });
             state.localAudioStream = null; // Stream-State auf null setzen
             console.log("[WebRTC] localAudioStream ist jetzt null.");

             // Entferne die Audio-Tracks von allen PeerConnections
              state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, null); // Null übergeben, um Tracks zu entfernen
              });

         } else {
             console.log("[WebRTC] Kein lokaler Audio-Stream zum Stoppen.");
         }
         state.localAudioMuted = false; // Mute-Zustand zurücksetzen
         updateLocalMuteButtonUI(); // UI des Mute Buttons aktualisieren (versteckt/disabled)
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
             // Fordere den Bildschirm-Stream über getDisplayMedia an
             const stream = await navigator.mediaDevices.getDisplayMedia({
                 video: { cursor: "always", frameRate: { ideal: 10, max: 15 } }, // Videooptionen
                 audio: true // Fordere auch System-Audio an, falls verfügbar
             });
             state.screenStream = stream; // Stream im State speichern
             state.isSharingScreen = true; // Zustand aktualisieren
             console.log(`[WebRTC] Bildschirmstream erhalten: ${stream.id}. Tracks: Video: ${stream.getVideoTracks().length}, Audio: ${stream.getAudioTracks().length}`);

             // Prüfe, ob der Bildschirm-Stream Audio enthält
             const screenAudioTrack = stream.getAudioTracks()[0];
             if (screenAudioTrack) {
                  console.log("[WebRTC] Bildschirmstream hat Audio. Stoppe lokalen Mikrofonstream.");
                  stopLocalAudioStream(); // Stoppe Mikrofon, wenn System-Audio geteilt wird
             } else {
                  console.log("[WebRTC] Bildschirmstream hat kein Audio. Lokales Mikrofon bleibt/ist inaktiv.");
                  // Auch wenn kein Audio im Screen-Stream ist, stoppe das Mikrofon, da jetzt der Bildschirm geteilt wird
                  stopLocalAudioStream();
             }

             // Ersetze die lokalen Tracks in allen PeerConnections durch die Tracks des Bildschirm-Streams
             state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream);
             });

             // Füge einen Listener hinzu, der aufgerufen wird, wenn die Bildschirmteilung über die Browser-UI beendet wird
             const screenVideoTrack = stream.getVideoTracks()[0];
             if (screenVideoTrack) {
                  screenVideoTrack.onended = () => {
                      console.log("[WebRTC] Bildschirmteilung beendet durch Browser UI.");
                      // Rufe toggleScreenSharing auf, um den Zustand im Client und auf dem Server zu aktualisieren
                      if (state.isSharingScreen) {
                          toggleScreenSharing();
                      }
                  };
                  console.log("[WebRTC] onended Listener für Screen Video Track hinzugefügt.");
             } else {
                  console.warn("[WebRTC] Kein Screen Video Track gefunden, onended Listener konnte nicht hinzugefügt werden.");
             }

              // Informiere den Server über den Start der Bildschirmteilung
              if (socket && state.connected) {
                 socket.emit('screenShareStatus', { sharing: true });
                 console.log("[Socket.IO] Sende 'screenShareStatus: true'.");
             }

             // UI-Elemente aktualisieren
             updateShareScreenButtonUI(); // Button-Text/Aussehen ändern
             updateLocalMuteButtonUI(); // Mute Button sollte deaktiviert sein

             return true; // Erfolgreich
        } catch (err) {
             // Fehler beim Starten der Bildschirmteilung
             console.error('[WebRTC] Fehler beim Starten der Bildschirmteilung:', err.name, err.message);
             let errorMessage = `Bildschirmfreigabe fehlgeschlagen: ${err.message}.`;
             if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                  errorMessage = "Bildschirmfreigabe verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
             } else if (err.name === 'AbortError') {
                  errorMessage = "Bildschirmfreigabe abgebrochen.";
             }
             displayError(errorMessage); // Fehlermeldung anzeigen

             // Zustand zurücksetzen
             state.screenStream = null;
             state.isSharingScreen = false;

             // Versuche, den lokalen Audio-Stream wieder zu starten, wenn die Bildschirmteilung fehlschlägt
             setupLocalAudioStream();

              // Informiere den Server über das Fehlschlagen/Beenden der Bildschirmteilung
              if (socket && state.connected) {
                 socket.emit('screenShareStatus', { sharing: false });
             }

             // UI-Elemente aktualisieren
             updateShareScreenButtonUI();
             updateLocalMuteButtonUI();

             return false; // Fehler
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
             // Alle Tracks im Stream beenden
             state.screenStream.getTracks().forEach(track => {
                  console.log(`[WebRTC] Stoppe Screen Track ${track.id} (${track.kind}).`);
                  track.stop();
             });
             state.screenStream = null; // Stream-State auf null setzen
             console.log("[WebRTC] screenStream ist jetzt null.");

             // Entferne die Screen-Tracks von allen PeerConnections
              state.peerConnections.forEach(pc => {
                  // Wichtig: Tracks entfernen, indem wir einen null Stream übergeben
                  addLocalStreamTracksToPeerConnection(pc, null);
              });

         } else {
              console.log("[WebRTC] stopScreenSharing: screenStream war bereits null.");
         }

         state.isSharingScreen = false; // Zustand aktualisieren
         console.log("[WebRTC] isSharingScreen ist jetzt false.");

         // Versuche, den lokalen Audio-Stream wieder zu starten
         setupLocalAudioStream();

         // Informiere den Server über das Ende der Bildschirmteilung
         if (sendSignal && socket && state.connected) {
             socket.emit('screenShareStatus', { sharing: false });
             console.log("[Socket.IO] Sende 'screenShareStatus: false'.");
         }

         // UI-Elemente aktualisieren
         updateShareScreenButtonUI(); // Button-Text/Aussehen ändern
         updateLocalMuteButtonUI(); // Mute Button sollte wieder aktiviert werden

    }

    // Schaltet die Bildschirmteilung ein/aus
    async function toggleScreenSharing() {
         console.log(`[WebRTC] toggleScreenSharing aufgerufen. Aktueller State isSharingScreen: ${state.isSharingScreen}`);
         // Prüfe, ob verbunden und Button existiert
         if (!state.connected || !UI.shareScreenBtn) {
              console.warn("[WebRTC] Nicht verbunden oder Button nicht gefunden.");
              return;
         }

         UI.shareScreenBtn.disabled = true; // Button während des Vorgangs deaktivieren

         if (state.isSharingScreen) {
             // Wenn geteilt wird, stoppe die Teilung
             stopScreenSharing(true);
         } else {
             // Wenn nicht geteilt wird, starte die Teilung
             await startScreenSharing();
         }

         UI.shareScreenBtn.disabled = false; // Button wieder aktivieren
    }

     // Aktualisiert das Aussehen des Bildschirm-Teilen Buttons
     function updateShareScreenButtonUI() {
         if (UI.shareScreenBtn) {
             UI.shareScreenBtn.textContent = state.isSharingScreen ? 'Teilen beenden' : '🖥 Bildschirm teilen';
             UI.shareScreenBtn.classList.toggle('active', state.isSharingScreen);
             // Deaktiviere den Button, wenn nicht verbunden
             UI.shareScreenBtn.disabled = !state.connected;
             UI.shareScreenBtn.classList.toggle('disabled', UI.shareScreenBtn.disabled); // Füge eine Klasse für disabled Styling hinzu
         }
     }


    // Erstellt eine neue RTCPeerConnection zu einem bestimmten Peer
    async function createPeerConnection(peerId) {
        console.log(`[WebRTC] createPeerConnection aufgerufen für Peer: ${peerId}.`);
        // Prüfe, ob bereits eine Verbindung zu diesem Peer besteht
        if (state.peerConnections.has(peerId)) {
            console.warn(`[WebRTC] PeerConnection mit ${peerId} existiert bereits.`);
            return state.peerConnections.get(peerId);
        }

        console.log(`[WebRTC] Erstelle neue RTCPeerConnection für Peer: ${peerId}`);
        // Erstelle eine neue RTCPeerConnection mit den ICE-Servern
        const pc = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.peerConnections.set(peerId, pc); // Im State speichern

        // Listener für ICE Candidates
        pc.onicecandidate = event => {
            // Wenn ein Candidate gefunden wird und wir verbunden sind, sende ihn an den Server
            if (event.candidate && socket && state.connected) {
                 console.log(`[WebRTC] Sende ICE candidate für Peer ${peerId}:`, event.candidate);
                 // Client sendet ICE Candidate AN DEN SERVER, damit dieser es an den anderen Peer schickt
                socket.emit('webRTC-signal', {
                    to: peerId, // Ziel Peer
                    type: 'candidate', // Typ des Signals
                    payload: event.candidate // Der Candidate
                });
            } else if (!event.candidate) {
                console.log(`[WebRTC] ICE candidate gathering für Peer ${peerId} beendet.`);
            }
        };

        // Listener für eintreffende Tracks von Remote Peers
        pc.ontrack = event => {
            console.log(`[WebRTC] Empfange remote track von Peer ${peerId}. Track Kind: ${event.track.kind}, Stream ID(s): ${event.streams ? event.streams.map(s => s.id).join(', ') : 'No Stream'}`);

             // Hole oder erstelle den MediaStream für diesen Remote Peer
             // Tracks können zu einem oder mehreren Streams gehören (event.streams)
             // Für dieses Beispiel fügen wir alle Tracks eines Peers zu einem einzigen remoteStream hinzu
             let remoteStream = state.remoteStreams.get(peerId);
             if (!remoteStream) {
                 console.log(`[WebRTC] Erstelle neuen remoteStream für Peer ${peerId}.`);
                 remoteStream = new MediaStream(); // Neuen Stream erstellen
                 state.remoteStreams.set(peerId, remoteStream); // Im State speichern
             }

             // Füge den Track zum Remote Stream hinzu, falls er noch nicht drin ist
             if (!remoteStream.getTrackById(event.track.id)) {
                 console.log(`[WebRTC] Füge Track ${event.track.id} (${event.track.kind}) zu remoteStream für Peer ${peerId} hinzu.`);
                 remoteStream.addTrack(event.track); // Track hinzufügen
             } else {
                  console.log(`[WebRTC] Track ${event.track.id} (${event.track.kind}) ist bereits in remoteStream für Peer ${peerId}.`);
             }


            // Verarbeite Audio-Tracks
            if (event.track.kind === 'audio') {
                 console.log(`[WebRTC] Track ${event.track.id} ist Audio.`);
                 // Stelle sicher, dass das Audio-Element für diesen Peer existiert
                 const audioElement = ensureRemoteAudioElementExists(peerId);
                 // Weise den Remote Stream (der Audio-Tracks enthält) dem Audio-Element zu
                 audioElement.srcObject = remoteStream;
                 // Versuche, das Audio abzuspielen (kann durch Browser-Richtlinien fehlschlagen)
                 audioElement.play().catch(e => console.warn(`[WebRTC] Fehler beim Abspielen von Remote Audio für Peer ${peerId}:`, e));

                 // Listener für Track-Events (optional für Debugging/Statusanzeige)
                 event.track.onended = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                 event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.onunmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);


            // Verarbeite Video-Tracks
            } else if (event.track.kind === 'video') {
                 console.log(`[WebRTC] Track ${event.track.id} ist Video. Von Peer ${peerId}.`);

                 // Wenn der Bildschirm dieses Peers gerade angesehen wird, aktualisiere die Anzeige
                 if (state.currentlyViewingPeerId === peerId) {
                     console.log(`[WebRTC] Erhaltener Video Track von aktuell betrachtetem Peer ${peerId}. Aktualisiere Anzeige.`);
                     updateRemoteScreenDisplay(peerId); // Anzeige aktualisieren
                 }

                 // Listener für Track-Events
                 event.track.onended = () => {
                     console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} beendet.`);
                     // Prüfe, ob der Stream noch Video-Tracks enthält
                     const remoteStreamForPeer = state.remoteStreams.get(peerId);
                     if (remoteStreamForPeer && remoteStreamForPeer.getVideoTracks().length === 0) {
                         console.log(`[WebRTC] Peer ${peerId} sendet keine Video-Tracks mehr. Aktualisiere Bildschirmanzeige.`);
                          // Wenn der Peer, dessen Bildschirm wir ansehen, keine Video-Tracks mehr sendet, stoppe die Anzeige
                          if (state.currentlyViewingPeerId === peerId) {
                               console.log(`[WebRTC] Der Peer (${peerId}), dessen Bildschirm ich ansehe, sendet keine Video-Tracks mehr. Stoppe Anzeige.`);
                               // Simuliere Klick auf "Anzeige stoppen"
                               handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
                          }
                     }
                 };

                 event.track.onmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.onunmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} entmutet.`);
            }

             // Listener für das Entfernen von Tracks vom Stream (kann, muss aber nicht zuverlässig feuern)
             // Dieser Listener ist am MediaStream-Objekt, nicht an der RTCPeerConnection
             // Er wird einmalig hinzugefügt, wenn der remoteStream erstellt wird.
             remoteStream.onremovetrack = (event) => {
                  console.log(`[WebRTC] Track ${event.track.id} von Peer ${peerId} aus Stream entfernt.`);
                  // Wenn der Stream keine Tracks mehr hat, kann er gelöscht werden
                   if (remoteStream.getTracks().length === 0) {
                       console.log(`[WebRTC] Stream von Peer ${peerId} hat keine Tracks mehr. Entferne Stream aus Map.`);
                       state.remoteStreams.delete(peerId);
                       // Wenn der aktuell betrachtete Peer keinen Stream mehr hat, stoppe die Anzeige
                        if (state.currentlyViewingPeerId === peerId) {
                            console.log(`[WebRTC] Aktuell betrachteter Peer (${peerId}) hat keine Tracks mehr im Stream. Stoppe Anzeige.`);
                            handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
                        }
                   } else {
                       // Wenn ein Video-Track entfernt wurde und dieser Peer gerade angesehen wird, aktualisiere die Anzeige
                        if (event.track.kind === 'video' && state.currentlyViewingPeerId === peerId) {
                            console.log(`[WebRTC] Video Track von aktuell betrachtetem Peer (${peerId}) entfernt. Aktualisiere Anzeige.`);
                            updateRemoteScreenDisplay(peerId);
                        }
                   }
             };
        };

        // Listener für ICE Connection State Änderungen (Verbindungsstatus der WebRTC-Verbindung)
        pc.oniceconnectionstatechange = () => {
             if (!pc) return; // Prüfen, ob pc noch gültig ist
            const pcState = pc.iceConnectionState; // Aktueller Zustand
             const peerUser = state.allUsersList.find(u => u.id === peerId); // Benutzerinformationen für Log
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] ICE Connection Status zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
             switch (pcState) {
                 case "new": // Neue Verbindung
                 case "checking": // ICE Kandidaten werden gesammelt/geprüft
                     break;
                 case "connected": // Verbindung aufgebaut, Audio/Video sollte funktionieren
                     console.log(`[WebRTC] ICE 'connected': Erfolgreich verbunden mit Peer '${peerUsername}'. Audio sollte fließen.`);
                     break;
                 case "completed": // Alle Kandidaten geprüft
                     console.log(`[WebRTC] ICE 'completed': Alle Kandidaten für Peer '${peerUsername}' geprüft.`);
                     break;
                 case "disconnected": // Verbindung unterbrochen (temporär)
                     console.warn(`[WebRTC] ICE 'disconnected': Verbindung zu Peer '${peerUsername}' unterbrochen. Versuche erneut...`);
                     // Hier könnte man Reconnect-Logik implementieren
                     break;
                 case "failed": // Verbindung fehlgeschlagen
                     console.error(`[WebRTC] ICE 'failed': Verbindung zu Peer '${peerUsername}' fehlgeschlagen.`);
                      closePeerConnection(peerId); // Verbindung schließen, wenn fehlgeschlagen
                     break;
                 case "closed": // Verbindung geschlossen
                     console.log(`[WebRTC] ICE 'closed': Verbindung zu Peer '${peerUsername}' wurde geschlossen.`);
                      closePeerConnection(peerId); // Ressourcen freigeben
                     break;
             }
        };

        // Listener für Signaling State Änderungen (Status des Offer/Answer-Austauschs)
        pc.onsignalingstatechange = () => {
             if (!pc) return;
            const pcState = pc.signalingState; // Aktueller Zustand
             const peerUser = state.allUsersList.find(u => u.id === peerId); // Benutzerinformationen für Log
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] Signaling State zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
             // Hier könnte man auf bestimmte Zustände reagieren (z.B. warten auf ein Offer)
        };

        // Listener, der ausgelöst wird, wenn eine Neuverhandlung (z.B. nach addTrack/removeTrack) nötig ist
        pc.onnegotiationneeded = async () => {
             console.log(`[WebRTC] onnegotiationneeded Event für Peer ${peerId} ausgelöst.`);
             // Implementierung der "polite" Methode zur Vermeidung von Glare (Offer-Kollisionen)
             // Der Client mit der niedrigeren Socket ID ist "polite" und wartet im Konfliktfall.
             const isPolite = state.socketId < peerId;

             // Erstelle nur ein Offer, wenn die Verbindung im 'stable'-Zustand ist ODER
             // wenn wir im 'have-remote-offer'-Zustand sind UND nicht 'polite' sind (der 'impolite' Peer löst Glare auf)
             if (pc.signalingState === 'stable' || (pc.signalingState === 'have-remote-offer' && !isPolite)) {

                 if (pc.signalingState === 'have-remote-offer' && isPolite) {
                      console.log(`[WebRTC] Peer ${peerId}: Glare Situation (have-remote-offer, Polite). Warte auf eingehendes Offer.`);
                      // Der polite Peer im Glare wartet auf das Offer des impolite Peers
                      return;
                 }

                 console.log(`[WebRTC] Peer ${peerId}: Erstelle Offer. Signaling State: ${pc.signalingState}. Bin Polite? ${isPolite}.`);
                 try {
                     // Offer erstellen
                     const offer = await pc.createOffer();
                     console.log(`[WebRTC] Peer ${peerId}: Offer erstellt. Setze Local Description.`);
                     // Local Description setzen (Signalingsstate wechselt zu 'have-local-offer')
                     await pc.setLocalDescription(offer);
                     console.log(`[WebRTC] Peer ${peerId}: Local Description (Offer) gesetzt. Sende Offer an Server.`);

                      // Client sendet Offer AN DEN SERVER, damit dieser es an den anderen Peer schickt
                      if (socket && state.connected) {
                           socket.emit('webRTC-signal', {
                               to: peerId, // Ziel Peer
                               type: 'offer', // Signal Typ
                               payload: pc.localDescription // Das erstellte Offer
                           });
                           console.log(`[Socket.IO] Sende 'webRTC-signal' (offer) an Peer ${peerId}.`);
                       } else {
                           console.warn(`[WebRTC] Cannot send offer to Peer ${peerId}. Socket not connected.`);
                       }

                 } catch (err) {
                     console.error(`[WebRTC] Peer ${peerId}: Fehler bei Offer Erstellung oder Setzung:`, err);
                     displayError(`Fehler bei Audio/Video-Verhandlung (Offer) mit Peer ${peerId}.`);
                     closePeerConnection(peerId); // Verbindung bei Fehler schließen
                 }
             } else {
                  console.log(`[WebRTC] Peer ${peerId}: Signaling State (${pc.signalingState}) erlaubt keine Offer Erstellung. Warte.`);
             }
        };


        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc; // Gibt das neue oder bestehende PC-Objekt zurück
    }

    // Fügt lokale Stream-Tracks (Mikrofon oder Bildschirm) zu einer PeerConnection hinzu
    function addLocalStreamTracksToPeerConnection(pc, streamToAdd) {
         console.log(`[WebRTC] addLocalStreamTracksToPeerConnection aufgerufen für PC. Stream ID: ${streamToAdd ? streamToAdd.id : 'null'}.`);
         if (!pc) {
             console.warn("[WebRTC] addLocalStreamTracksToPeerConnection: PeerConnection ist null.");
             return;
         }

         const senders = pc.getSenders(); // Aktuelle Sender dieser PC
         const tracksToAdd = streamToAdd ? streamToAdd.getTracks() : []; // Tracks aus dem Stream, die hinzugefügt/ersetzt werden sollen

         console.log(`[WebRTC] PC hat ${senders.length} Sender. Stream hat ${tracksToAdd.length} Tracks.`);

         // Füge Tracks hinzu oder ersetze bestehende Sender für den gleichen Track-Typ
         tracksToAdd.forEach(track => {
             const existingSender = senders.find(s => s.track && s.track.kind === track.kind);

             if (existingSender) {
                 // Wenn ein Sender für diesen Track-Typ (audio/video) existiert, ersetze den Track
                 if (existingSender.track !== track) {
                      console.log(`[WebRTC] Ersetze Track ${track.kind} im Sender (${existingSender.track?.id || 'none'}) durch Track ${track.id}.`);
                      // Ersetze den Track im Sender (löst onnegotiationneeded aus)
                      existingSender.replaceTrack(track).catch(e => {
                          console.error(`[WebRTC] Fehler beim Ersetzen des Tracks ${track.kind}:`, e);
                      });
                 } else {
                      console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits im Sender. Kein Ersetzen nötig.`);
                 }
             } else {
                 // Wenn kein Sender für diesen Track-Typ existiert, füge einen neuen Track hinzu
                 console.log(`[WebRTC] Füge neuen Track ${track.kind} (${track.id}) hinzu.`);
                 // Füge den Track der PC hinzu (löst onnegotiationneeded aus). Weise auch den Stream zu (wichtig für das Grouping).
                 pc.addTrack(track, streamToAdd);
             }
         });

         // Entferne Sender, deren Tracks nicht mehr im aktuellen Stream sind
         senders.forEach(sender => {
             // Wenn ein Sender einen Track hat, der NICHT in der Liste der hinzuzufügenden Tracks ist
             if (sender.track && !tracksToAdd.some(track => track.id === sender.track.id)) {
                 const trackKind = sender.track.kind;
                 console.log(`[WebRTC] Entferne Sender für Track ${sender.track.id} (${trackKind}), da er nicht mehr im aktuellen Stream ist.`);
                 pc.removeTrack(sender); // Entferne den Sender (löst onnegotiationneeded aus)
             } else if (!sender.track) {
                  console.warn("[WebRTC] Sender ohne Track gefunden. Dies sollte nicht passieren.");
                  // Eventuell Sender ohne Track entfernen, falls nötig
                  // pc.removeTrack(sender); // Vorsicht hiermit, kann zu Problemen führen
             }
         });

         console.log("[WebRTC] Tracks in PC aktualisiert.");
          // Der `onnegotiationneeded` Event Handler wird automatisch ausgelöst, wenn Tracks hinzugefügt/entfernt werden.
     }


    // Aktualisiert die PeerConnections basierend auf der aktuellen Benutzerliste vom Server
    function updatePeerConnections(currentRemoteUsers) {
         console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote User: ${currentRemoteUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

         // Schließe PeerConnections zu Benutzern, die den Raum verlassen haben
         // Iteriere über eine Kopie der Keys, da die Map im Loop modifiziert wird
         Array.from(state.peerConnections.keys()).forEach(peerId => {
             const peerStillExists = currentRemoteUsers.some(user => user.id === peerId);
             if (!peerStillExists) {
                 console.log(`[WebRTC] Peer ${peerId} nicht mehr in Userliste. Schließe PeerConnection.`);
                 closePeerConnection(peerId); // Verbindung schließen
             }
         });

         // Erstelle PeerConnections für neue Benutzer und aktualisiere Tracks für bestehende
         currentRemoteUsers.forEach(async user => {
             let pc = state.peerConnections.get(user.id);

             // Wenn noch keine PC zu diesem Benutzer besteht, erstelle eine neue
             if (!pc) {
                 console.log(`[WebRTC] Neuer Peer ${user.username} (${user.id}) gefunden. Erstelle PeerConnection.`);
                 pc = await createPeerConnection(user.id); // Neue PC erstellen

                 // Bestimme den aktuell aktiven lokalen Stream (Mikrofon oder Bildschirm)
                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                      console.log(`[WebRTC] Füge Tracks vom aktuellen lokalen Stream (${currentLocalStream.id || 'none'}) zur neuen PC (${user.id}) hinzu.`);
                     // Füge die Tracks des lokalen Streams hinzu
                     addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                 } else {
                      console.log(`[WebRTC] Kein lokaler Stream zum Hinzufügen zur neuen PC (${user.id}).`);
                      // Auch wenn kein Stream aktiv ist, rufe die Funktion auf, um sicherzustellen,
                      // dass keine alten Tracks versehentlich vorhanden sind.
                      addLocalStreamTracksToPeerConnection(pc, null);
                 }

                  // Wenn wir der "impolite" Peer sind (niedrigere Socket ID), starten wir den Offer-Austausch.
                  // Der `onnegotiationneeded` Handler übernimmt das automatische Erstellen des Offers,
                  // wenn dieser Peer der Initiator (impolite) ist.
                  // Wenn wir 'polite' sind, warten wir auf ihr Offer.
                 console.log(`[WebRTC] Initialisierung für Peer ${user.id} abgeschlossen. Negotiation wird folgen.`);

             } else {
                  console.log(`[WebRTC] Peer ${user.id} existiert. Überprüfe/aktualisiere Tracks.`);
                  // Stelle sicher, dass bestehende PCs die Tracks des aktuell aktiven lokalen Streams haben
                  const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                   if (currentLocalStream) {
                       addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                   } else {
                        // Wenn kein lokaler Stream aktiv ist, stelle sicher, dass keine lokalen Tracks gesendet werden
                        addLocalStreamTracksToPeerConnection(pc, null);
                   }
             }
         });
    }


    // Schließt eine spezifische PeerConnection zu einem Remote Peer
    function closePeerConnection(peerId) {
        console.log(`[WebRTC] closePeerConnection aufgerufen für Peer: ${peerId}.`);
        const pc = state.peerConnections.get(peerId);

        if (pc) {
            console.log(`[WebRTC] Schließe PeerConnection mit ${peerId}.`);
             // Stoppe alle Sendetracks, die mit dieser PC verbunden sind (entferne sie aus der PC)
             pc.getSenders().forEach(sender => {
                 if (sender.track) {
                      // ACHTUNG: track.stop() hier zu machen würde den Track LOKAL für ALLE PCs stoppen!
                      // Wir wollen nur den Sender von DIESER PeerConnection entfernen.
                      pc.removeTrack(sender);
                 }
             });

            pc.close(); // Schließe die RTCPeerConnection
            state.peerConnections.delete(peerId); // Aus dem State entfernen
             console.log(`[WebRTC] PeerConnection mit ${peerId} gelöscht.`);
        } else {
             console.log(`[WebRTC] Keine PeerConnection mit ${peerId} zum Schließen gefunden.`);
        }

         // Entferne das zugehörige Remote Audio Element
         removeRemoteAudioElement(peerId);

         // Entferne den zugehörigen Remote Stream
         if (state.remoteStreams.has(peerId)) {
              console.log(`[WebRTC] Entferne remoteStream für Peer ${peerId}.`);
              const streamToRemove = state.remoteStreams.get(peerId);
              // Tracks im Remote Stream stoppen (optional, da PC geschlossen ist)
              // streamToRemove.getTracks().forEach(track => track.stop()); // Auskommentiert zur Vorsicht
              state.remoteStreams.delete(peerId); // Aus dem State entfernen
         }

         // Wenn der geschlossene Peer gerade angesehen wurde, stoppe die Anzeige
         if (state.currentlyViewingPeerId === peerId) {
              console.log(`[WebRTC] Geschlossener Peer ${peerId} wurde betrachtet. Stoppe Anzeige.`);
              // Simuliere einen Force Stop
              handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
         }

         // Die Benutzerliste wird durch das Socket 'user list' Update ohnehin aktualisiert.
         // updatePeerConnections in updateUserList kümmert sich um das Schließen von PCs für entfernte Benutzer.
    }

    // Schließt alle bestehenden PeerConnections (z.B. beim Trennen vom Server)
    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
         // Iteriere über eine Kopie der Keys, da die Map im Loop modifiziert wird
        Array.from(state.peerConnections.keys()).forEach(peerId => {
            closePeerConnection(peerId);
        });
         state.peerConnections.clear(); // Stelle sicher, dass die Map leer ist
         console.log("[WebRTC] Alle PeerConnections geschlossen.");

         // Stoppe alle Remote Streams und lösche die Map
         state.remoteStreams.forEach(stream => {
              console.log(`[WebRTC] Stoppe tracks in remote stream ${stream.id}.`);
              stream.getTracks().forEach(track => track.stop());
         });
         state.remoteStreams.clear();
          console.log("[WebRTC] Alle empfangenen Streams gestoppt and gelöscht.");

         // Entferne alle Remote Audio Elemente
          state.remoteAudioElements.forEach(el => el.remove());
          state.remoteAudioElements.clear();
          console.log("[WebRTC] Alle remote Audio-Elemente entfernt.");


         // Verstecke die Remote Screen Anzeige
         updateRemoteScreenDisplay(null);
    }


    // Sendet eine Chat-Nachricht an den Server
    function sendMessage() {
        console.log("sendMessage() aufgerufen.");
        // Hole den Inhalt aus dem Eingabefeld und trimme Leerzeichen
        const content = UI.messageInput ? UI.messageInput.value.trim() : ''; // Prüfe, ob das Element existiert
        if (!content) {
            console.log("sendMessage: Inhalt leer. Abbruch.");
            return; // Sende nicht, wenn leer
        }

        // Prüfe, ob wir verbunden sind
        if (!socket || !state.connected) {
            console.error("[Chat Send Error] Cannot send message. Not connected.");
            displayError("Nicht verbunden. Nachricht kann nicht gesendet werden.");
            return;
        }

        // Erstelle das Nachrichtenobjekt
        const message = {
             content, // Nachrichtentext
             timestamp: new Date().toISOString(), // Aktueller Zeitstempel
             type: 'text' // Nachrichtentyp
        };

        console.log(`sendMessage: Sende Textnachricht: "${message.content.substring(0, Math.min(message.content.length, 50))}..."`);
         // Client sendet die Nachricht AN DEN SERVER (Server muss auf 'message' lauschen und sie weiterleiten)
         if (socket) { // Stelle sicher, dass der Socket existiert
            socket.emit('message', message); // Sende das 'message'-Event an den Server
         }


        // Eingabefeld leeren und Fokus setzen
        if (UI.messageInput) {
             UI.messageInput.value = '';
             // Setze die Höhe des Textbereichs zurück (falls Auto-Resize verwendet wird)
             if (UI.messageInput.style.height) {
                 UI.messageInput.style.height = 'auto';
             }
             UI.messageInput.focus(); // Fokus zurück auf das Eingabefeld
        }
        sendTyping(false); // Sende 'tippen: false', nachdem die Nachricht gesendet wurde
    }

    // Fügt eine empfangene Nachricht zur UI hinzu
    function appendMessage(msg) {
         // DIESE FUNKTION WIRD AUFGERUFEN, WENN DER CLIENT DAS 'message'-EVENT VOM SERVER EMPFÄNGT.
         // Wenn dies passiert, wird die Nachricht angezeigt.
         console.log("[UI] appendMessage aufgerufen:", msg); // Log zur Überprüfung, ob Nachrichten empfangen werden
         // Prüfe, ob die Nachricht gültig ist und der Nachrichtencontainer existiert
         if (!msg || msg.content === undefined || msg.id === undefined || msg.username === undefined || !UI.messagesContainer) {
             console.warn("appendMessage: Ungültige Nachrichtendaten oder Nachrichtencontainer nicht gefunden.", msg);
             return;
         }

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.id === state.socketId; // Prüfe, ob es die eigene Nachricht ist
        if (isMe) msgDiv.classList.add('me'); // Klasse für eigenes Styling hinzufügen

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username); // Benutzernamen escapen und setzen
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.id)); // Farbe setzen (vom Server oder generiert)
        msgDiv.appendChild(nameSpan); // Namen hinzufügen

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        // Setze den Textinhalt (escapen ist wichtig gegen XSS)
        // textContent behält Zeilenumbrüche aus Textareas bei, innerHTML würde sie ignorieren, wenn nicht <br> verwendet wird
        contentDiv.textContent = escapeHTML(msg.content);
        msgDiv.appendChild(contentDiv); // Inhalt hinzufügen

        UI.messagesContainer.appendChild(msgDiv); // Nachricht zum Container hinzufügen

        // Scrolle automatisch zum Ende, es sei denn, der Benutzer hat hochgescrollt
        // Überprüfe, ob der Benutzer nahe am unteren Rand ist (Toleranz von 50px)
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 50;
        if (isMe || isScrolledToBottom) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight; // Scrolle ganz nach unten
        }
    }

    // Sendet den Tipp-Status an den Server
    function sendTyping(isTyping = true) {
         // Sende nur, wenn verbunden und das Eingabefeld aktiv ist
         if (!socket || !state.connected || (UI.messageInput && UI.messageInput.disabled)) {
              return;
         }

         // Lösche eventuell vorhandenen Timeout, um 'false' nicht zu früh zu senden
         clearTimeout(state.typingTimeout);

          // Client sendet Typing-Status AN DEN SERVER (Server muss auf 'typing' lauschen und es weiterleiten)
          if (socket) { // Stelle sicher, dass der Socket existiert
              socket.emit('typing', { isTyping }); // Sende das 'typing'-Event
          }

         // Wenn der Status 'true' ist, setze einen Timeout, um später 'false' zu senden
         if (isTyping) {
              state.typingTimeout = setTimeout(() => {
                  // Sende 'typing: false', wenn der Timeout abgelaufen ist und wir noch verbunden sind
                  if (socket && state.connected) {
                       socket.emit('typing', { isTyping: false });
                       console.log("[Socket.IO] Sende 'typing: false' nach Timeout.");
                  }
              }, CONFIG.TYPING_TIMER_LENGTH); // Länge des Timeouts
         }
    }

    // Behandelt den Klick auf den "Bildschirm ansehen" oder "Anzeige stoppen" Button
    function handleViewScreenClick(event, forceStop = false) {
         console.log(`[UI] handleViewScreenClick aufgerufen. forceStop: ${forceStop}`);
         // Hole den geklickten Button und die Peer ID aus dem Data-Attribut
         const clickedButton = event.target;
         const peerId = clickedButton ? clickedButton.dataset.peerId : null; // Prüfe, ob Button existiert

         if (!peerId) {
             console.error("[UI] handleViewScreenClick: Keine Peer ID im Dataset gefunden.");
             return;
         }

         // Prüfe, ob dieser Peer gerade angesehen wird
         const isCurrentlyViewing = state.currentlyViewingPeerId === peerId;

         // Szenario 1: Klick auf "Anzeige stoppen" oder erzwungener Stop für den aktuell betrachteten Peer
         if (isCurrentlyViewing && (!event.target.classList.contains('view') || forceStop)) {
             console.log(`[UI] Klick auf "Anzeige stoppen" oder forceStop für Peer ${peerId}.`);
             updateRemoteScreenDisplay(null); // Remote Screen Anzeige verstecken

              // Aktiviere alle "Bildschirm ansehen" Buttons für andere Sharer wieder
              state.allUsersList.forEach(user => {
                   if (user.id !== state.socketId && user.sharingStatus) {
                       const sharerButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                       if (sharerButton) sharerButton.disabled = false;
                   }
              });

             // Aktualisiere den Button-Zustand für den Peer, der gerade angesehen wurde
              const wasViewingButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${peerId}']`);
              if(wasViewingButton) {
                  wasViewingButton.textContent = 'Bildschirm ansehen';
                  wasViewingButton.classList.remove('stop');
                  wasViewingButton.classList.add('view');
                  wasViewingButton.disabled = false; // Stelle sicher, dass er nach dem Stoppen aktiv ist
              }


         // Szenario 2: Klick auf "Bildschirm ansehen" für einen Peer, der aktuell NICHT angesehen wird
         } else if (!isCurrentlyViewing && event.target.classList.contains('view')) {
             console.log(`[UI] Klick auf "Bildschirm ansehen" für Peer ${peerId}.`);

             // Finde den Sharer-Benutzer und seinen Stream
             const sharerUser = state.allUsersList.find(user => user.id === peerId && user.sharingStatus);
             const sharerStream = state.remoteStreams.get(peerId);

             // Prüfe, ob der Peer tatsächlich teilt und einen Video-Stream hat
             if (sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0) {
                  console.log(`[UI] Peer ${peerId} teilt und Stream ist verfügbar. Zeige Bildschirm an.`);

                  // Wenn wir gerade einen anderen Peer ansehen, stoppe diese Anzeige zuerst
                  if (state.currentlyViewingPeerId !== null && state.currentlyViewingPeerId !== peerId) {
                       console.log(`[UI] Stoppe vorherige Anzeige von Peer ${state.currentlyViewingPeerId}.`);
                       // Simuliere Klick auf den Stopp-Button für den zuvor angesehenen Peer
                       handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true);
                  }

                 // Aktualisiere die Remote Screen Anzeige, um den Stream dieses Peers zu zeigen
                 updateRemoteScreenDisplay(peerId);

                 // Deaktiviere andere "Bildschirm ansehen" Buttons, während einer angesehen wird
                  state.allUsersList.forEach(user => {
                       if (user.id !== state.socketId && user.sharingStatus && user.id !== peerId) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true;
                       }
                  });

                 // Aktualisiere Text und Klasse des geklickten Buttons
                  clickedButton.textContent = 'Anzeige stoppen';
                  clickedButton.classList.remove('view');
                  clickedButton.classList.add('stop');


             } else {
                 console.warn(`[UI] Peer ${peerId} teilt nicht oder Stream nicht verfügbar. Kann Bildschirm nicht ansehen.`);
                 displayError(`Bildschirm von ${sharerUser ? escapeHTML(sharerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden.`);
                 // Stelle sicher, dass die Remote Screen Anzeige versteckt ist, falls sie versehentlich einen ungültigen Zustand zeigte
                 updateRemoteScreenDisplay(null);
             }
          // Szenario 3: Klick auf den "Anzeige stoppen" Button, obwohl dieser Peer nicht angesehen wird (sollte bei korrekter Logik nicht passieren, aber gut für Sicherheit)
          } else if (!isCurrentlyViewing && event.target.classList.contains('stop')) {
               console.warn(`[UI] Klick auf "Anzeige stoppen" für Peer ${peerId}, aber ich sehe ihn nicht an. Aktualisiere Button.`);
                // Korrigiere den Button-Zustand
               const incorrectStopButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${peerId}']`);
               if(incorrectStopButton) {
                   incorrectStopButton.textContent = 'Bildschirm ansehen';
                   incorrectStopButton.classList.remove('stop');
                   incorrectStopButton.classList.add('view');
                   incorrectStopButton.disabled = false; // Stelle sicher, dass er aktiv ist
               }
          }
    }

     // Schaltet das Vollbild für ein Element ein/aus
     function toggleFullscreen(element) {
         if (!element) {
              console.warn("[UI] toggleFullscreen: Element nicht gefunden.");
              return;
         }
         if (!document.fullscreenElement) { // Wenn aktuell nichts im Vollbild ist
             if (element.requestFullscreen) {
                 element.requestFullscreen().catch(err => console.error(`[UI] Fullscreen error: ${err.message}`, err));
             } else if (element.webkitRequestFullscreen) { /* Safari */
                 element.webkitRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (webkit): ${err.message}`, err));
             } else if (element.msRequestFullscreen) { /* IE11 */
                 element.msRequestFullscreen().catch(err => console.error(`[UI] Fullscreen error (ms): ${err.message}`, err));
             } else {
                  console.warn("[UI] toggleFullscreen: Browser does not support Fullscreen API on this element.");
             }
         } else { // Wenn etwas im Vollbild ist
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


    // --- Socket.IO Listener Setup ---
    function setupSocketListeners() {
         if (!socket) {
             console.error("[Socket.IO] setupSocketListeners: Socket ist null.");
             return;
         }

         console.log("[Socket.IO] Socket Listener werden eingerichtet.");

         // Client wartet auf 'joinSuccess' vom Server nach erfolgreicher Verbindung + Auth
         // Dies signalisiert, dass der Server die Verbindung akzeptiert hat und unsere ID kennt.
         socket.on('joinSuccess', (data) => {
             console.log("[Socket.IO] joinSuccess empfangen:", data);
             state.socketId = data.id; // Eigene Socket ID vom Server erhalten
             // Die vollständige Benutzerliste wird vom Server direkt danach mit dem Event 'user list' gesendet.
             updateUIAfterConnect(); // UI aktualisieren, sobald Verbindung bestätigt ist.
         });


         socket.on('disconnect', (reason) => {
             console.log("[Socket.IO] Verbindung getrennt:", reason);
             displayError(`Verbindung getrennt: ${reason}`);
             updateUIAfterDisconnect();
         });

         socket.on('connect_error', (err) => {
             console.error("[Socket.IO] Verbindungsfehler:", err.message);
             displayError(`Verbindungsfehler: ${err.message}`);
             setConnectionStatus('disconnected', 'Verbindungsfehler');
             // updateUIAfterDisconnect wird normalerweise auch durch das 'disconnect' Event ausgelöst
         });

         // Listener für eingehende Chat-Nachrichten
         socket.on('message', (msg) => {
             // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'message' AUSGELÖST.
             // Server wurde angepasst, um 'message' statt 'chatMessage' zu senden.
             console.log("[Socket.IO] Nachricht empfangen:", msg);
             appendMessage(msg); // Nachricht zur UI hinzufügen
         });

         // Listener für Aktualisierungen der Benutzerliste
         socket.on('user list', (users) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'user list' AUSGELÖST.
              // Server wurde angepasst, um 'user list' statt 'userListUpdate' zu senden.
             console.log("[Socket.IO] Userliste empfangen:", users);
             updateUserList(users); // Benutzerliste in der UI aktualisieren
         });

          // Listener für Tipp-Status von anderen Benutzern
          socket.on('typing', (data) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'typing' AUSGELÖST (weitergeleitet).
              console.log(`[Socket.IO] Typing Status empfangen von ${data.username}: ${data.isTyping}`);

              // Prüfe, ob es ein anderer Benutzer ist und er anfängt zu tippen
              const isOtherUserTyping = data.isTyping && data.username !== state.username;
              const wasNotAlreadyTyping = !state.typingUsers.has(data.username);

              if (data.isTyping) {
                  state.typingUsers.add(data.username);
                  // Bugfix: Benachrichtigung nur abspielen, wenn ein ANDERER Benutzer anfängt zu tippen
                  if (isOtherUserTyping && wasNotAlreadyTyping) {
                      console.log("[UI] Anderer Benutzer beginnt zu tippen. Spiele Benachrichtigung.");
                      playNotificationSound();
                  }
              } else {
                  state.typingUsers.delete(data.username);
              }
              updateTypingIndicatorDisplay(); // Tipp-Anzeige in der UI aktualisieren
          });

         // Listener für WebRTC Signalisierungsnachrichten
         socket.on('webRTC-signal', async (signal) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'webRTC-signal' AUSGELÖST (weitergeleitete Signale)!
              console.log(`[Socket.IO] WebRTC Signal empfangen von ${signal.from} (Type: ${signal.type}):`, signal.payload);
              const peerId = signal.from;
              const pc = state.peerConnections.get(peerId); // Finde die zugehörige PeerConnection

              // Wenn keine PC für diesen Peer existiert, warte oder ignoriere (oder erstelle ggf. eine neue)
              if (!pc) {
                  console.warn(`[WebRTC] WebRTC-signal: Keine PeerConnection für eingehendes Signal von Peer ${peerId}. Ignoriere Signal.`);
                  // In einem komplexeren Setup könnte hier die PC erstellt werden, falls sie fehlt
                   return; // Signal ignorieren
              }

              try {
                  // Verarbeite verschiedene Signal-Typen (Offer, Answer, Candidate)
                  if (signal.type === 'offer') {
                      console.log(`[WebRTC] Eingehendes Offer von Peer ${peerId}. Setze Remote Description.`);
                      // Glare-Handling: Wenn wir "polite" sind und selbst gerade ein Offer machen, ignoriere das eingehende Offer vorübergehend.
                       const isPolite = state.socketId < peerId; // Niedrigere ID ist "polite"
                       const makingOffer = pc.signalingState === 'have-local-offer';
                       const ignoreOffer = isPolite && makingOffer;

                       if (ignoreOffer) {
                           console.log(`[WebRTC] Glare Situation: Ignoriere eingehendes Offer von ${peerId} (Bin Polite und mache selbst Offer).`);
                           return; // Offer ignorieren
                       }

                      // Setze die Remote Description mit dem erhaltenen Offer
                      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                      console.log(`[WebRTC] Remote Description (Offer) für Peer ${peerId} gesetzt. Erstelle Answer.`);
                      // Erstelle ein Answer
                      const answer = await pc.createAnswer();
                      console.log(`[WebRTC] Answer erstellt. Setze Local Description.`);
                      // Setze die Local Description mit dem erstellten Answer
                      await pc.setLocalDescription(answer);
                      console.log(`[WebRTC] Local Description (Answer) für Peer ${peerId} gesetzt. Sende Answer an Server.`);
                       // Sende das Answer an den Server zur Weiterleitung an den anderen Peer
                       if (socket.connected) {
                           socket.emit('webRTC-signal', {
                               to: peerId,
                               type: 'answer',
                               payload: pc.localDescription
                           });
                           console.log(`[Socket.IO] Sende 'webRTC-signal' (answer) an Peer ${peerId}.`);
                       } else {
                           console.warn(`[WebRTC] Cannot send answer to Peer ${peerId}. Socket not connected.`);
                       }

                  } else if (signal.type === 'answer') {
                       console.log(`[WebRTC] Eingehendes Answer von Peer ${peerId}. Setze Remote Description.`);
                       // Prüfe, ob wir auf ein Answer warten (Signaling State sollte 'have-local-offer' sein)
                       if (pc.signalingState !== 'have-local-offer') {
                            console.warn(`[WebRTC] Empfing Answer von Peer ${peerId} im unerwarteten Signaling State: ${pc.signalingState}. Ignoriere Answer.`);
                            return; // Answer ignorieren
                       }
                      // Setze die Remote Description mit dem erhaltenen Answer
                      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                      console.log(`[WebRTC] Remote Description (Answer) für Peer ${peerId} gesetzt.`);

                  } else if (signal.type === 'candidate') {
                       console.log(`[WebRTC] Eingehender ICE Candidate von Peer ${peerId}. Füge Candidate hinzu.`);
                       // Füge den ICE Candidate hinzu. Muss NACH setRemoteDescription erfolgen.
                       if (!pc.remoteDescription) {
                           console.warn(`[WebRTC] Empfing ICE Candidate von Peer ${peerId}, aber Remote Description ist noch nicht gesetzt. Buffere oder ignoriere.`);
                           // In einer echten Anwendung würde man Candidates puffern, bis die Remote Description da ist.
                           return; // Candidate ignorieren
                       }
                      await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
                      console.log(`[WebRTC] ICE Candidate von Peer ${peerId} hinzugefügt.`);
                  } else {
                      console.warn(`[WebRTC] Unbekannter WebRTC Signal-Typ von Peer ${peerId}: ${signal.type}`);
                  }
              } catch (err) {
                  console.error(`[WebRTC] Fehler beim Verarbeiten von WebRTC Signal von Peer ${peerId} (${signal.type}):`, err);
                  displayError(`Fehler bei Audio/Video-Kommunikation mit Peer ${peerId}.`);
                  // Bei schwerwiegenden Fehlern kann die Verbindung geschlossen werden
                   // closePeerConnection(peerId);
              }
         });

         // Listener, wenn ein Benutzer den Raum verlässt (optional, da 'user list' aktualisiert wird)
         socket.on('user left', (userId) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'user left' AUSGELÖST (kann optional sein, wenn 'user list' immer gesendet wird).
              // Die 'user list' Aktualisierung sollte das Entfernen aus der UI übernehmen.
              console.log(`[Socket.IO] Benutzer mit ID ${userId} hat den Raum verlassen.`);
         });

          // Listener für Bildschirmteilungs-Statusänderungen von anderen Benutzern
          socket.on('screenShareStatus', ({ userId, sharing }) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'screenShareStatus' AUSGELÖST (weitergeleitet).
              // Die 'user list' Aktualisierung enthält bereits sharingStatus und aktualisiert die UI entsprechend.
              console.log(`[Socket.IO] Benutzer ${userId} hat Bildschirmteilung Status geändert zu ${sharing}.`);
              // Kein direkter Code hier nötig, da updateUserList die UI basierend auf user.sharingStatus aktualisiert.
          });

          // Listener für Server-seitige Fehler
          socket.on('error', (error) => {
              // DIESER LISTENER WIRD BEI Server-seitigen Fehlern ausgelöst.
              console.error('[Socket.IO] Server Error:', error);
              displayError(`Server Error: ${error.message || error}`);
          });

         console.log("[Socket.IO] Socket Listener eingerichtet.");
    }


    // --- Event Listener Zuweisungen ---

    console.log("[App] Event Listener werden zugewiesen."); // Log, um zu sehen, ob dieser Abschnitt erreicht wird

    // Connect Button Listener
    if (UI.connectBtn) {
        // Definiere die connect Funktion außerhalb der Listener-Zuweisung zur besseren Struktur
        function connect() {
            console.log("Connect Button clicked.");
             // Validierung des Benutzernamens
             if (!UI.usernameInput || UI.usernameInput.value.trim() === '') {
                 displayError("Bitte geben Sie einen Benutzernamen ein.");
                 console.warn("Connect attempt failed: Username is empty.");
                 return;
             }

             // Prüfe, ob bereits verbunden oder verbindend
             if (state.connected) {
                  console.warn("Connect Button clicked but already connected.");
                  return;
             }

            state.username = UI.usernameInput.value.trim(); // Benutzernamen speichern

            // Prüfe, ob der Socket bereits existiert und aktiv ist (sollte bei disabled UI nicht passieren)
            if (socket && (socket.connected || socket.connecting)) {
                 console.warn("Socket already exists and is connecting or connected. Aborting connect.");
                 return;
            }

             console.log(`[App] Versuche Verbindung als ${state.username} zu Raum ${state.roomId}...`);
            // Socket.IO-Verbindung aufbauen
             socket = io(window.location.origin, {
                 auth: { username: state.username, roomId: state.roomId }, // Auth-Daten senden
                 transports: ['websocket'], // Bevorzuge WebSocket
                 forceNew: true // Erzwinge eine neue Verbindung
             });
            setConnectionStatus('connecting', 'Verbinde…'); // Statusanzeige
            setupSocketListeners(); // Richte Socket-Listener ein, sobald der Socket erstellt ist
        }

        UI.connectBtn.addEventListener('click', connect); // Listener zuweisen
        console.log("[App] connectBtn Listener zugewiesen.");
    } else {
        console.error("[App] connectBtn Element nicht gefunden!");
    }

    // Disconnect Button Listener
    if (UI.disconnectBtn) {
        UI.disconnectBtn.addEventListener('click', () => {
            console.log("Disconnect Button clicked.");
            // Prüfe, ob der Socket existiert und verbunden ist
            if (socket && state.connected) {
                console.log("[Socket.IO] Sende 'disconnect'.");
                socket.disconnect(); // Socket trennen (löst Server-seitiges 'disconnect' aus)
            } else {
                 console.warn("Disconnect Button clicked but socket is not connected.");
                 // Wenn der Socket nicht verbunden ist, aber die UI im verbundenen Zustand war (sollte nicht passieren),
                 // erzwinge die UI-Aktualisierung.
                 if (state.connected) {
                      console.warn("Forcing UI update after disconnect button click.");
                      updateUIAfterDisconnect();
                 }
            }
        });
         console.log("[App] disconnectBtn Listener zugewiesen.");
    } else {
        console.warn("[App] disconnectBtn Element nicht gefunden.");
    }


    // Send Button Listener
     if (UI.sendBtn) {
         UI.sendBtn.addEventListener('click', sendMessage); // Listener zuweisen
          console.log("[App] sendBtn Listener zugewiesen.");
     } else {
         console.warn("[App] sendBtn Element nicht gefunden.");
     }


    // Message Input Listeners (Typing und Enter-Taste)
     if (UI.messageInput) {
         // 'input' Event für Tipp-Indikator und Auto-Resize
         UI.messageInput.addEventListener('input', () => {
             // Optional: Auto-Resize des Textbereichs
             if (UI.messageInput) { // Prüfe das Element erneut innerhalb des Listeners
                 UI.messageInput.style.height = 'auto'; // Setze Höhe zurück, um neue Höhe zu berechnen
                 UI.messageInput.style.height = UI.messageInput.scrollHeight + 'px'; // Setze Höhe basierend auf Inhalt
             }
             // Sende Tipp-Status, wenn das Eingabefeld nicht leer ist
             sendTyping(UI.messageInput ? UI.messageInput.value.trim().length > 0 : false);
         });

         // 'keydown' Event für Senden bei Enter (ohne Shift)
         UI.messageInput.addEventListener('keydown', (event) => {
             // Prüfe auf Enter-Taste und stelle sicher, dass Shift nicht gedrückt ist (für neue Zeile)
             if (event.key === 'Enter' && !event.shiftKey) {
                 event.preventDefault(); // Verhindere Standard-Verhalten (neue Zeile in Textarea)
                 sendMessage(); // Nachricht senden
             }
         });
          console.log("[App] messageInput Listeners zugewiesen.");
     } else {
         console.warn("[App] messageInput Element nicht gefunden.");
     }


    // Listener für Änderung der Mikrofonauswahl
    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        // Ändere nur den Stream, wenn verbunden und NICHT Bildschirm geteilt wird
        if (state.connected && !state.isSharingScreen) {
            console.log("[WebRTC] Mikrofonauswahl geändert. Versuche lokalen Stream zu aktualisieren.");
            await setupLocalAudioStream(); // Stream mit neuem Gerät neu einrichten
        } else if (state.isSharingScreen) {
             console.warn("[WebRTC] Mikrofonauswahl geändert während Bildschirmteilung. Änderung wird nach Beendigung der Teilung wirksam.");
             // Optional: Zeige eine Nachricht für den Benutzer an
             displayError("Mikrofonauswahl ändert sich erst nach Beendigung der Bildschirmteilung.");
        } else {
            console.log("[WebRTC] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
        }
    });

    // Listener für den lokalen Mute Button
    // BUGFIX: Listener wird hier einmalig im DOMContentLoaded Block zugewiesen, nicht wiederholt in updateUserList.
    const localMuteBtn = document.getElementById('localMuteBtn');
    if (localMuteBtn) {
         localMuteBtn.addEventListener('click', toggleLocalAudioMute);
         console.log("[App] localMuteBtn Listener zugewiesen.");
    } else {
         console.warn("[App] localMuteBtn Element nicht gefunden.");
    }


    // Listener für den Bildschirm-Teilen Button
    if (UI.shareScreenBtn) UI.shareScreenBtn.addEventListener('click', toggleScreenSharing);
     else {
         console.warn("[App] shareScreenBtn Element nicht gefunden.");
     }


    // Listener für den Vollbild Button im Remote Screen Container
     if (UI.remoteScreenFullscreenBtn) {
          UI.remoteScreenFullscreenBtn.addEventListener('click', () => {
              // Wenn der Container existiert, schalte Vollbild um
              if (UI.remoteScreenContainer) {
                  toggleFullscreen(UI.remoteScreenContainer);
              }
          });
          console.log("[App] remoteScreenFullscreenBtn Listener zugewiesen.");
     } else {
          console.warn("[App] remoteScreenFullscreenBtn Element nicht gefunden.");
     }

     // Listener für das globale fullscreenchange Event des Browsers
     // Aktualisiert den Text des Vollbild-Buttons
     document.addEventListener('fullscreenchange', () => {
          if (UI.remoteScreenFullscreenBtn && UI.remoteScreenContainer) {
               // Prüfe, ob der Remote Screen Container oder ein darin enthaltenes Element gerade im Vollbild ist
               const isRemoteScreenInFullscreen = document.fullscreenElement === UI.remoteScreenContainer || UI.remoteScreenContainer.contains(document.fullscreenElement);
               UI.remoteScreenFullscreenBtn.textContent = isRemoteScreenInFullscreen ? "Vollbild verlassen" : "Vollbild";
               // Füge/Entferne die is-fullscreen Klasse für CSS-Styling
               UI.remoteScreenContainer.classList.toggle('is-fullscreen', isRemoteScreenInFullscreen);
                // Füge/Entferne die is-fullscreen Klasse auch am Videoelement selbst
               if (UI.remoteScreenVideo) UI.remoteScreenVideo.classList.toggle('is-fullscreen', isRemoteScreenInFullscreen);
          } else if (document.fullscreenElement === null) {
              // Wenn Vollbild beendet wird, aber die Elemente nicht gefunden wurden (z.B. nach Trennung),
              // stelle sicher, dass die Klasse entfernt wird.
               if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.remove('is-fullscreen');
               if (UI.remoteScreenVideo) UI.remoteScreenVideo.classList.remove('is-fullscreen');
          }
     });
     console.log("[App] fullscreenchange Listener zugewiesen.");


    // Behandelt das Schließen/Neuladen des Browserfensters
    window.addEventListener('beforeunload', () => {
        console.log("[App] window.beforeunload event gefeuert. Versuche aufzuräumen.");
        // Trenne die Socket-Verbindung, wenn verbunden
        if (socket && socket.connected) {
            console.log("[Socket.IO] Trenne Socket vor dem Entladen.");
            socket.disconnect(); // Socket ordentlich trennen
        }
         // Stoppe lokale Medienströme und schließe Peer-Verbindungen
         stopLocalAudioStream(); // Mikrofon stoppen
         stopScreenSharing(false); // Bildschirmteilung stoppen (kein Signal senden, da Disconnect erwartet wird)
         closeAllPeerConnections(); // Alle WebRTC Verbindungen schließen
         console.log("[App] cleanup vor unload abgeschlossen.");
    });
     console.log("[App] beforeunload Listener zugewiesen.");


    // --- Init ---
    console.log("[App] DOMContentLoaded. App wird initialisiert.");
    initializeUI(); // UI in Initialzustand setzen
     // Fülle die Mikrofonliste sofort beim Laden
     populateMicList();

});
