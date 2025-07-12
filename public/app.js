document.addEventListener('DOMContentLoaded', () => {
    // UI Elemente Referenzen
    const UI = {
        usernameInput: document.getElementById('usernameInput'),
        connectBtn: document.getElementById('connectBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        // Geänderte Benutzerlisten-Elemente
        onlineUserList: document.getElementById('onlineUserList'),
        offlineUserList: document.getElementById('offlineUserList'),
        onlineUserCountPlaceholder: document.getElementById('onlineUserCountPlaceholder'),
        offlineUserCountPlaceholder: document.getElementById('offlineUserCountPlaceholder'),
        offlineUserHeader: document.getElementById('offlineUserHeader'), // Überschrift für Offline-Benutzer


        messagesContainer: document.getElementById('messagesContainer'),
        messageInput: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        typingIndicator: document.getElementById('typingIndicator'),
        statusIndicator: document.getElementById('statusIndicator'),
        connectionTime: document.getElementById('connectionTime'),
        errorMessage: document.getElementById('errorMessage'),
        micSelect: document.getElementById('micSelect'),
        remoteAudioControls: document.getElementById('remoteAudioControls'),

        // UI Elemente für Bildschirm teilen
        shareScreenBtn: document.getElementById('shareScreenBtn'),
        remoteScreenContainer: document.getElementById('remoteScreenContainer'),
        remoteScreenSharerName: document.getElementById('remoteScreenSharerName'),
        remoteScreenVideo: document.getElementById('remoteScreenVideo'),
        remoteScreenFullscreenBtn: document.querySelector('#remoteScreenContainer .fullscreen-btn'),
        
        // UI Elemente für Datei-Upload
        fileInput: document.getElementById('fileInput')
    };

    console.log("[App] UI.connectBtn gefunden:", !!UI.connectBtn);
    if (UI.connectBtn) {
        console.log("[App] UI.connectBtn Element:", UI.connectBtn);
    }

    let socket;
    let state = {
        connected: false,
        username: '',
        roomId: 'default-room', // Standardraum-ID
        socketId: null, // Eigene Socket ID
        allUsersList: [], // Beinhaltet Benutzerobjekte { id, username, color, sharingStatus: boolean, isOnline: boolean }

        typingTimeout: null,
        typingUsers: new Set(), // Set von Benutzer-IDs, die gerade tippen

        notificationSound: new Audio('/notif.mp3'), // Benachrichtigungssound

        // WebRTC State (Lokal)
        localAudioStream: null, // Lokaler Audio-Stream (Mikrofon)
        screenStream: null, // Lokaler Bildschirm-Stream
        isSharingScreen: false, // Status der Bildschirmfreigabe

        // WebRTC State (Remote)
        peerConnections: new Map(), // { peerId: RTCPeerConnection }
        remoteAudioElements: new Map(), // { peerId: HTMLAudioElement }
        remoteStreams: new Map(), // { peerId: MediaStream (remote) }

        // Bildschirm teilen State (Remote Anzeige)
        currentlyViewingPeerId: null, // ID des Peers, dessen Bildschirm gerade angezeigt wird

        localAudioMuted: false, // Status der lokalen Stummschaltung
        
        // Verbindungszeit
        connectionStartTime: null,
        connectionTimer: null,
        
        // Datei-Upload
        selectedFile: null,
    };

    // Konfigurationen
    const CONFIG = {
        TYPING_TIMER_LENGTH: 1500, // ms Timeout für Tipp-Indikator
        RTC_CONFIGURATION: { // ICE Server für WebRTC
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Füge ggf. weitere STUN/TURN-Server hinzu
            ],
        },
        // Farben für Benutzer im Chat und der Liste - Diese sind jetzt weniger wichtig, da Server Farbe sendet
        USER_COLORS: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9700', '#ff5722', '#795548'],
    };

    // --- Funktionsdefinitionen ---

    // Hilfsfunktion zum Escapen von HTML-Sonderzeichen
    function escapeHTML(str) {
        if (typeof str !== 'string') return String(str);
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, m => map[m]);
    }

    // Hilfsfunktion zur Ermittlung der Benutzerfarbe basierend auf ID oder Namen (Fallback)
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
        // Prüfe, ob der Benutzer aktuell aktiv ist (optional, um Sounds im Hintergrund zu vermeiden)
        // if (document.visibilityState === 'hidden') return;

        if (state.notificationSound) {
            // Stoppe den Sound, falls er noch läuft und spiele ihn von vorne ab
            state.notificationSound.currentTime = 0;
             state.notificationSound.play().catch(e => {
                 // Fang den Fehler ab, falls Autoplay blockiert wird etc.
                 console.warn("Benachrichtigungssound konnte nicht abgespielt werden:", e);
             });
        }
    }

    // Startet den Verbindungszeit-Timer
    function startConnectionTimer() {
        state.connectionStartTime = Date.now();
        if(UI.connectionTime) {
            UI.connectionTime.classList.remove('hidden');
        }
        updateConnectionTime();
    }

    // Stoppt den Verbindungszeit-Timer
    function stopConnectionTimer() {
        if (state.connectionTimer) {
            clearInterval(state.connectionTimer);
            state.connectionTimer = null;
        }
        state.connectionStartTime = null;
    }

    // Aktualisiert die Verbindungszeit-Anzeige
    function updateConnectionTime() {
        if (!state.connectionStartTime || !UI.connectionTime) return;
        
        const elapsed = Date.now() - state.connectionStartTime;
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        UI.connectionTime.textContent = timeString;
        
        // Timer alle Sekunde aktualisieren
        state.connectionTimer = setTimeout(updateConnectionTime, 1000);
    }

    // Datei-Upload Funktionen
    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            state.selectedFile = file;
            console.log('[File] Datei ausgewählt:', file.name, 'Größe:', file.size, 'Bytes');
            
            // Zeige Datei-Info in der Nachrichteneingabe
            if(UI.messageInput) {
                UI.messageInput.placeholder = `📎 ${file.name} (${formatFileSize(file.size)}) - Nachricht eingeben...`;
            }
        }
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function sendFile() {
        if (!state.selectedFile || !state.connected) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const fileData = {
                name: state.selectedFile.name,
                type: state.selectedFile.type,
                size: state.selectedFile.size,
                data: e.target.result
            };
            
            socket.emit('file-upload', fileData);
            console.log('[File] Datei gesendet:', state.selectedFile.name);
            
            // Reset file selection
            state.selectedFile = null;
            if(UI.fileInput) UI.fileInput.value = '';
            if(UI.messageInput) UI.messageInput.placeholder = 'Nachricht eingeben...';
        };
        
        reader.readAsDataURL(state.selectedFile);
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
        updateRemoteAudioControls([]); // Remote Audio UI aufräumen/verstecken (leere Liste)
        updateRemoteScreenDisplay(null); // Remote Screen UI aufräumen/verstecken
        updateLocalMuteButtonUI(); // Lokalen Mute Button Zustand aktualisieren (versteckt/disabled)
        updateShareScreenButtonUI(); // Share Screen Button Zustand aktualisieren (versteckt/disabled)

         // Benutzerlisten in der UI leeren und Zähler zurücksetzen
        if(UI.onlineUserList) UI.onlineUserList.innerHTML = '';
        if(UI.offlineUserList) UI.offlineUserList.innerHTML = ''; // Offline Liste auch leeren
        if (UI.onlineUserCountPlaceholder) UI.onlineUserCountPlaceholder.textContent = '0';
        if (UI.offlineUserCountPlaceholder) UI.offlineUserCountPlaceholder.textContent = '0'; // Offline Zähler zurücksetzen
        if (UI.offlineUserHeader) UI.offlineUserHeader.classList.add('hidden');


        if(UI.typingIndicator) UI.typingIndicator.textContent = ''; // Tipp-Anzeige leeren
        state.typingUsers.clear(); // Tippende Benutzer zurücksetzen
        
        // Verbindungszeit zurücksetzen
        stopConnectionTimer();
        if(UI.connectionTime) {
            UI.connectionTime.classList.add('hidden');
            UI.connectionTime.textContent = '00:00:00';
        }
        
        // Datei-Upload zurücksetzen
        state.selectedFile = null;
        if(UI.fileInput) {
            UI.fileInput.disabled = true;
            UI.fileInput.value = '';
        }
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
        if(UI.fileInput) UI.fileInput.disabled = false; // Datei-Upload aktivieren
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
        updateLocalMuteButtonUI(); // Lokalen Mute Button aktivieren/anzeigen
        updateShareScreenButtonUI(); // Share Screen Button aktivieren/anzeigen
        
        // Verbindungszeit starten
        startConnectionTimer();
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

        // Benutzerlisten in der UI leeren und Zähler zurücksetzen
        if(UI.onlineUserList) UI.onlineUserList.innerHTML = '';
        if(UI.offlineUserList) UI.offlineUserList.innerHTML = ''; // Offline Liste auch leeren
        if (UI.onlineUserCountPlaceholder) UI.onlineUserCountPlaceholder.textContent = '0';
        if (UI.offlineUserCountPlaceholder) UI.offlineUserCountPlaceholder.textContent = '0'; // Offline Zähler zurücksetzen
        if (UI.offlineUserHeader) UI.offlineUserHeader.classList.add('hidden');


        if(UI.typingIndicator) UI.typingIndicator.textContent = ''; // Tipp-Anzeige leeren
        state.typingUsers.clear(); // Tippende Benutzer zurücksetzen

        stopLocalAudioStream(); // Lokalen Audio-Stream stoppen
        stopScreenSharing(false); // Bildschirmteilung stoppen (kein Socket-Signal senden, da disconnected)
        closeAllPeerConnections(); // Alle WebRTC Verbindungen schließen

        updateRemoteAudioControls([]); // Remote Audio UI aufräumen/verstecken (leere Liste)
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
    // Diese Funktion verarbeitet jetzt eine Liste, die sowohl Online- als auch Offline-Benutzer enthalten kann
    function updateUserList(usersArrayFromServer) {
        console.log("[UI] updateUserList aufgerufen mit", usersArrayFromServer.length, "Benutzern.");

        // Speichere die alte Liste, um neue Benutzer zu erkennen
        const oldUsers = state.allUsersList;
        state.allUsersList = usersArrayFromServer; // Benutzerliste im State speichern

        const onlineUsers = usersArrayFromServer.filter(user => user.isOnline);
        const offlineUsers = usersArrayFromServer.filter(user => !user.isOnline);

        // Benutzeranzahl aktualisieren
        if (UI.onlineUserCountPlaceholder) UI.onlineUserCountPlaceholder.textContent = onlineUsers.length;
        if (UI.offlineUserCountPlaceholder) UI.offlineUserCountPlaceholder.textContent = offlineUsers.length;

        // Sichtbarkeit der Offline-Benutzer-Überschrift umschalten
         if (UI.offlineUserHeader) {
             if (offlineUsers.length > 0) {
                 UI.offlineUserHeader.classList.remove('hidden');
             } else {
                 UI.offlineUserHeader.classList.add('hidden');
             }
         }

        // Benutzerlisten in der UI leeren
        if(UI.onlineUserList) UI.onlineUserList.innerHTML = '';
        if(UI.offlineUserList) UI.offlineUserList.innerHTML = ''; // Auch Offline-Liste leeren


        // Füge Online-Benutzer zur Online-Liste hinzu
        onlineUsers.forEach(user => {
            const li = createUserListItem(user); // Verwende die neue Hilfsfunktion
            if(UI.onlineUserList) UI.onlineUserList.appendChild(li);

            // Benachrichtigung abspielen, wenn ein neuer Benutzer beitritt und vorher nicht in der Liste war
             const wasUserKnown = oldUsers.some(oldUser => oldUser.id === user.id);
             // Spielen, wenn verbunden, der Benutzer vorher nicht bekannt war UND der Benutzer online ist
             if (state.connected && !wasUserKnown && user.isOnline) {
                 console.log(`[UI] Neuer Benutzer beigetreten: ${user.username}`);
                 playNotificationSound();
             }
        });

         // Füge Offline-Benutzer zur Offline-Liste hinzu
         offlineUsers.forEach(user => {
             const li = createUserListItem(user); // Verwende die neue Hilfsfunktion
             if(UI.offlineUserList) UI.offlineUserList.appendChild(li);
         });


         // Filtere NUR online Benutzer für WebRTC und Remote Audio/Screen Controls
        const otherOnlineUsers = onlineUsers.filter(user => user.id !== state.socketId);


         // WebRTC PeerConnections aktualisieren (erstellen für neue Online, schließen für gegangene Online)
         updatePeerConnections(otherOnlineUsers);
         // Remote Audio Controls (Mute/Unmute) aktualisieren (nur für Online-Benutzer)
         updateRemoteAudioControls(otherOnlineUsers);

         // Sichtbarkeit der Remote Audio Controls Sektion umschalten
         if (UI.remoteAudioControls) {
              if (otherOnlineUsers.length > 0) {
                  UI.remoteAudioControls.classList.remove('hidden');
              } else {
                  UI.remoteAudioControls.classList.add('hidden');
              }
         }

         // Logik zur Aktualisierung des "Bildschirm ansehen/stoppen" Buttons,
         // falls der aktuell betrachtete Peer nicht mehr teilt oder offline gegangen ist.
          if (state.currentlyViewingPeerId) {
               // Finde den Sharer in der NEUEN Benutzerliste
               const sharerUser = state.allUsersList.find(user => user.id === state.currentlyViewingPeerId);
               // Prüfe, ob der Sharer noch online ist UND noch teilt
               const sharerStillSharing = sharerUser && sharerUser.isOnline && sharerUser.sharingStatus;

               if (!sharerStillSharing) {
                    console.log(`[UI] Aktuell betrachteter Sharer (${state.currentlyViewingPeerId}) ist nicht mehr online oder teilt nicht mehr. Stoppe Anzeige.`);
                    // Simuliere Klick auf "Anzeige stoppen" (forceStop=true)
                    // Finde das Listenelement des Sharers, um das dataset.peerId zu bekommen
                     const sharerListItem = document.querySelector(`#onlineUserList li[data-user-id='${state.currentlyViewingPeerId}']`) || document.querySelector(`#offlineUserList li[data-user-id='${state.currentlyViewingPeerId}']`);
                    if (sharerListItem) {
                         const viewButton = sharerListItem.querySelector('.view-screen-button');
                         if (viewButton) {
                              handleViewScreenClick({ target: viewButton }, true); // Verwende den gefundenen Button
                         } else {
                              // Fallback, wenn Button nicht gefunden wurde (sollte nicht passieren, wenn er vorher da war)
                              console.warn(`[UI] View button not found for sharer ${state.currentlyViewingPeerId} during cleanup.`);
                              updateRemoteScreenDisplay(null); // Einfach Anzeige stoppen
                         }
                    } else {
                        console.warn(`[UI] List item not found for sharer ${state.currentlyViewingPeerId} during cleanup.`);
                         updateRemoteScreenDisplay(null); // Einfach Anzeige stoppen
                    }
               } else {
                   // Stelle sicher, dass der Button des aktuell betrachteten Sharers korrekt aussieht und aktiv ist (er ist online)
                   const viewingButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${state.currentlyViewingPeerId}']`);
                   if(viewingButton) {
                        viewingButton.textContent = 'Anzeige stoppen';
                        viewingButton.classList.remove('view');
                        viewingButton.classList.add('stop');
                        viewingButton.disabled = false; // Button aktivieren
                   }
                   // Deaktiviere andere "Bildschirm ansehen" Buttons, während einer angesehen wird (nur für online Sharer)
                    onlineUsers.forEach(user => {
                         if (user.id !== state.socketId && user.sharingStatus && user.id !== state.currentlyViewingPeerId) {
                            const otherViewButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${user.id}']`);
                            if (otherViewButton) otherViewButton.disabled = true;
                         }
                    });
               }
          } else {
               // Wenn niemand angesehen wird, stelle sicher, dass alle "Bildschirm ansehen" Buttons aktiv sind (nur für online Sharer)
               onlineUsers.forEach(user => {
                    if (user.id !== state.socketId && user.sharingStatus) {
                        const viewButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${user.id}']`);
                        if(viewButton) viewButton.disabled = false;
                    }
               });
          }

    }

    // Hilfsfunktion zum Erstellen eines Benutzerlisten-Items
    function createUserListItem(user) {
        const li = document.createElement('li');
        li.dataset.userId = user.id; // Füge User ID als Data-Attribut hinzu

        const dot = document.createElement('span');
        dot.classList.add('user-dot');
        // Füge Klasse 'offline' hinzu, wenn der Benutzer offline ist
        if (!user.isOnline) {
            dot.classList.add('offline');
        }
        // Setze die Farbe des Punktes basierend auf user.color vom Server
        dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id));
        li.appendChild(dot);

        const nameContainer = document.createElement('span');
        nameContainer.style.flexGrow = '1';
        nameContainer.style.display = 'flex';
        nameContainer.style.alignItems = 'center';
        nameContainer.style.overflow = 'hidden';
        nameContainer.style.textOverflow = 'ellipsis';
        nameContainer.style.whiteSpace = 'nowrap';

        // Erstelle ein Span-Element für den Benutzernamen, um die Farbe zu setzen
        const usernameSpan = document.createElement('span');
        usernameSpan.textContent = escapeHTML(user.username);
        // Setze die Farbe des Benutzernamens basierend auf user.color vom Server
        usernameSpan.style.color = escapeHTML(user.color || getUserColor(user.id));

        // Füge den Benutzernamen (mit Farbe) zum nameContainer hinzu
        if (user.id === state.socketId && user.isOnline) {
             // Special styling for the local user when online
            const strong = document.createElement('strong');
             // Füge den farbigen usernameSpan innerhalb von strong hinzu
            strong.appendChild(usernameSpan);
            strong.appendChild(document.createTextNode(" (Du)"));
            nameContainer.appendChild(strong);
        } else {
             // For other users (online or offline), just append the colored usernameSpan
            nameContainer.appendChild(usernameSpan);
        }


        li.appendChild(nameContainer);


        // Bildschirmteilungs-Indikator hinzufügen, falls der Benutzer teilt UND online ist
        if (user.isOnline && user.sharingStatus) {
             const sharingIndicator = document.createElement('span');
             sharingIndicator.classList.add('sharing-indicator');
             sharingIndicator.textContent = ' 🖥️'; // Desktop-Symbol
             sharingIndicator.title = `${escapeHTML(user.username)} teilt Bildschirm`;
             nameContainer.appendChild(sharingIndicator);
        }

        // "Bildschirm ansehen" Button für Benutzer hinzufügen, die teilen UND online sind
        if (user.id !== state.socketId && user.isOnline && user.sharingStatus) {
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


        return li; // Gibt das erstellte Listenelement zurück
    }


    // Aktualisiert die Anzeige der tippenenden Benutzer
    function updateTypingIndicatorDisplay() {
        if (!UI.typingIndicator) return;
        // Filtere den lokalen Benutzer und Offline-Benutzer aus der Liste der tippenenden
         // Finde die Benutzernamen der tippenenden User IDs, die online sind
        const typingUsernames = Array.from(state.typingUsers)
            .map(userId => {
                const user = state.allUsersList.find(u => u.id === userId);
                // Geänderte Logik: Nur Benutzernamen von ONLINE-Usern anzeigen, die tippen
                return (user && user.isOnline && user.id !== state.socketId) ? user.username : null;
            })
            .filter(username => username !== null); // Filtert alle null Einträge heraus


        if (typingUsernames && typingUsernames.length > 0) {
            // Liste der tippenenden Benutzer formatieren und anzeigen
             const usersString = typingUsernames.map(escapeHTML).join(', ');
             UI.typingIndicator.textContent = `${usersString} schreibt...`;
             UI.typingIndicator.style.display = 'block'; // Anzeige einblenden
        } else {
             UI.typingIndicator.style.display = 'none'; // Anzeige ausblenden
        }
    }

    // Aktualisiert die Remote Audio Mute/Unmute Controls in der UI (nur für online Benutzer)
    function updateRemoteAudioControls(remoteOnlineUsers = []) {
         if (!UI.remoteAudioControls) return;

         // Aktuelle Mute-Zustände beibehalten, bevor die Liste neu aufgebaut wird
         const mutedStates = new Map();
         state.remoteAudioElements.forEach((audioEl, peerId) => {
             mutedStates.set(peerId, audioEl.muted);
         });

         // Controls Sektion leeren
         UI.remoteAudioControls.innerHTML = '';

         // Controls für jeden Remote ONLINE Benutzer hinzufügen
         if (remoteOnlineUsers.length > 0) {
             const title = document.createElement('h3');
             title.textContent = 'Sprach-Teilnehmer';
             UI.remoteAudioControls.appendChild(title);

             remoteOnlineUsers.forEach(user => {
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
                  if (audioElement) { // Only if element was created
                    audioElement.muted = isMuted; // Mute-Zustand des UI-Buttons auf das Audio-Element übertragen
                  }
             });
         }

         // Audio-Elemente für Benutzer entfernen, die nicht mehr in der ONLINE-Liste sind
         Array.from(state.remoteAudioElements.keys()).forEach(peerId => {
             const userStillOnline = remoteOnlineUsers.some(user => user.id === peerId);
             if (!userStillOnline) {
                 removeRemoteAudioElement(peerId);
             }
         });
    }

    // Aktualisiert die Anzeige des Remote-Bildschirms
    // Zeigt nur an, wenn der peerIdToDisplay ONLINE ist
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

         // Finde den Benutzer in der ALLUsersList und den zugehörigen Stream
         const sharerUser = state.allUsersList.find(user => user.id === peerIdToDisplay);
         const sharerStream = state.remoteStreams.get(peerIdToDisplay);

         // Prüfe, ob der Bildschirm angezeigt werden kann (Benutzer existiert, ist ONLINE, Stream existiert und hat Video-Tracks)
         const canDisplay = sharerUser && sharerUser.isOnline && sharerStream && sharerStream.getVideoTracks().length > 0;


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
                 if (UI.remoteScreenVideo) UI.remoteScreenVideo.classList.add('is-fullscreen'); // Auch Video Element Klasse hinzufügen
             }


         } else {
             console.log("[UI] Keine Bildschirmteilung zum Anzeigen oder Peer nicht online/teilt nicht mehr/Stream nicht verfügbar.");

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
    // Nur für Online-Benutzer relevant
    function ensureRemoteAudioElementExists(peerId) {
        // Nur erstellen, wenn der Peer auch online ist
        const peerUser = state.allUsersList.find(user => user.id === peerId && user.isOnline);
        if (!peerUser) {
             console.warn(`[WebRTC] ensureRemoteAudioElementExists: Peer ${peerId} ist nicht online. Erstelle kein Audio-Element.`);
             // Sicherstellen, dass ggf. vorhandenes Element entfernt wird
             removeRemoteAudioElement(peerId);
             return null;
        }

        let audioElement = state.remoteAudioElements.get(peerId);
        if (!audioElement) {
             console.log(`[WebRTC] Erstelle neues Audio-Element für Online Peer ${peerId}.`);
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
             const isDisabled = !state.connected || state.isSharingScreen || !state.localAudioStream;
             localMuteBtn.disabled = isDisabled;
             localMuteBtn.classList.toggle('disabled', isDisabled); // Füge eine Klasse für disabled Styling hinzu
         }
     }

     // Schaltet das Audio eines Remote Peers stumm/aktiv (nur lokal für diesen Client)
     // Funktioniert nur für Online-Benutzer
     function toggleRemoteAudioMute(event) {
         // Hole die Peer ID aus dem Data-Attribut des Buttons
         const peerId = event.target.dataset.peerId;
         // Prüfe, ob der Peer online ist, bevor du weitermachst
         const peerUser = state.allUsersList.find(user => user.id === peerId && user.isOnline);
         if (!peerUser) {
              console.warn(`[WebRTC] toggleRemoteAudioMute: Peer ${peerId} ist nicht online. Kann Audio nicht stumm schalten.`);
              // UI des Buttons aktualisieren (sollte disabled sein, falls korrekt gerendert)
              if(event.target) {
                  event.target.disabled = true;
                  event.target.classList.add('disabled');
               }
              return;
         }

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
             // Füge Tracks des Screen-Streams zu bestehenden PCs hinzu, falls noch nicht geschehen (nur für online Peers)
              state.peerConnections.forEach((pc, peerId) => {
                  const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                  if (peerUser) {
                      addLocalStreamTracksToPeerConnection(pc, state.screenStream);
                  }
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

             // Füge die Tracks des neuen Streams zu allen bestehenden PeerConnections hinzu (nur für online Peers)
             state.peerConnections.forEach((pc, peerId) => {
                 const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                 if (peerUser) {
                     addLocalStreamTracksToPeerConnection(pc, state.localAudioStream);
                 }
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

             // Entferne eventuell vorhandene alte Audio-Tracks aus PeerConnections, wenn der Stream fehlschlägt (nur für online Peers)
              state.peerConnections.forEach((pc, peerId) => {
                 const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                 if (peerUser) {
                      addLocalStreamTracksToPeerConnection(pc, null); // Null übergeben, um Tracks zu entfernen
                 }
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

             // Entferne die Audio-Tracks von allen PeerConnections (nur für online Peers)
              state.peerConnections.forEach((pc, peerId) => {
                 const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                 if (peerUser) {
                     addLocalStreamTracksToPeerConnection(pc, null); // Null übergeben, um Tracks zu entfernen
                 }
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
                  stopLocalAudioStream(); // Stellen Sie sicher, dass Mic gestoppt ist
             }

             // Ersetze die lokalen Tracks in allen PeerConnections durch die Tracks des Bildschirm-Streams (nur für online Peers)
             state.peerConnections.forEach((pc, peerId) => {
                  const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                  if (peerUser) {
                      addLocalStreamTracksToPeerConnection(pc, state.screenStream);
                  }
             });

             // Füge einen Listener hinzu, der aufgerufen wird, wenn die Bildschirmteilung über die Browser-UI beendet wird
             const screenVideoTrack = stream.getVideoTracks()[0];
             if (screenVideoTrack) {
                  screenVideoTrack.onended = () => {
                      console.log("[WebRTC] Bildschirmteilung beendet durch Browser UI.");
                      // Rufe toggleScreenSharing auf, um den Zustand im Client und auf dem Server zu aktualisieren
                      if (state.isSharingScreen) {
                          // Setze state.isSharingScreen auf false HIER, BEVOR toggleScreenSharing es toggelt
                          state.isSharingScreen = false; // Setze den Zustand hier zurück
                          toggleScreenSharing(); // Rufe toggle auf, um die Logik zum Beenden auszuführen
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
             } else if (err.name === 'NotFoundError') {
                  errorMessage = "Kein Bildschirm für die Freigabe gefunden.";
             }
             displayError(errorMessage); // Fehlermeldung anzeigen

             // Zustand zurücksetzen
             state.screenStream = null;
             state.isSharingScreen = false;

             // Versuche, den lokalen Audio-Stream wieder zu starten, wenn die Bildschirmteilung fehlschlägt
             setupLocalAudioStream();

              // Informiere den Server über das Fehlschlagen/Beenden der Bildschirmteilung (falls verbunden)
              if (socket && state.connected) {
                 socket.emit('screenShareStatus', { sharing: false });
                 console.log("[Socket.IO] Sende 'screenShareStatus: false' nach Fehler.");
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
             // Stellen Sie sicher, dass der Zustand korrekt ist, auch wenn die Funktion unnötig aufgerufen wird
             state.screenStream = null;
             updateShareScreenButtonUI(); // UI aktualisieren, falls sie nicht korrekt war
             return;
         }

         if (state.screenStream) {
             console.log(`[WebRTC] Stoppe Tracks im Bildschirmstream (${state.screenStream.id}).`);
             // Alle Tracks im Stream beenden
             state.screenStream.getTracks().forEach(track => {
                  console.log(`[WebRTC] Stoppe Screen Track ${track.id} (${track.kind}).`);
                  track.stop(); // Track stoppen
             });
             state.screenStream = null; // Stream-State auf null setzen
             console.log("[WebRTC] screenStream ist jetzt null.");

             // Entferne die Screen-tracks von allen PeerConnections (nur für online Peers)
              state.peerConnections.forEach((pc, peerId) => {
                 const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                 if (peerUser) {
                     // Wichtig: Tracks entfernen, indem wir einen null Stream übergeben
                     addLocalStreamTracksToPeerConnection(pc, null);
                 }
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

         // Deaktiviere den Button, um Doppelklicks zu verhindern
         UI.shareScreenBtn.disabled = true;
         UI.shareScreenBtn.classList.add('disabled');


         if (state.isSharingScreen) {
             // Wenn geteilt wird, stoppe die Teilung
             stopScreenSharing(true);
         } else {
             // Wenn nicht geteilt wird, starte die Teilung
             await startScreenSharing(); // Verwende await hier
         }

         // Der Button wird am Ende von startScreenSharing oder stopScreenSharing wieder aktiviert
         // UI.shareScreenBtn.disabled = false; // Dies wird jetzt in den stop/start Funktionen gemacht
         // UI.shareScreenBtn.classList.remove('disabled');
    }

     // Aktualisiert das Aussehen des Bildschirm-Teilen Buttons
     function updateShareScreenButtonUI() {
         if (UI.shareScreenBtn) {
             UI.shareScreenBtn.textContent = state.isSharingScreen ? 'Teilen beenden' : '🖥 Bildschirm teilen';
             UI.shareScreenBtn.classList.toggle('active', state.isSharingScreen);
             // Deaktiviere den Button, wenn nicht verbunden
             const isDisabled = !state.connected;
             UI.shareScreenBtn.disabled = isDisabled;
             UI.shareScreenBtn.classList.toggle('disabled', isDisabled); // Füge eine Klasse für disabled Styling hinzu
         }
     }


    // Erstellt eine neue RTCPeerConnection zu einem bestimmten Peer
    // Wird nur für online Peers aufgerufen
    async function createPeerConnection(peerId) {
        console.log(`[WebRTC] createPeerConnection aufgerufen für Peer: ${peerId}.`);
        // Prüfe, ob bereits eine Verbindung zu diesem Peer besteht ODER ob der Peer offline ist
        const peerUser = state.allUsersList.find(user => user.id === peerId);
        if (state.peerConnections.has(peerId) || !peerUser || !peerUser.isOnline) {
            if (!peerUser || !peerUser.isOnline) {
                 console.warn(`[WebRTC] Peer ${peerId} ist nicht online. Erstelle keine PeerConnection.`);
            } else {
                 console.warn(`[WebRTC] PeerConnection mit ${peerId} existiert bereits.`);
            }
            return state.peerConnections.get(peerId); // Gibt bestehende PC zurück oder undefined
        }

        console.log(`[WebRTC] Erstelle neue RTCPeerConnection für Online Peer: ${peerId}`);
        // Erstelle eine neue RTCPeerConnection mit den ICE-Servern
        const pc = new RTCPeerConnection(CONFIG.RTC_CONFIGURATION);
        state.peerConnections.set(peerId, pc); // Im State speichern

        // Listener für ICE Candidates
        pc.onicecandidate = event => {
            // Wenn ein Candidate gefunden wird und wir verbunden sind, sende ihn an den Server
            // Sende nur, wenn der Ziel-Peer noch online ist (optional, Server sollte prüfen)
            const targetUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
            if (event.candidate && socket && state.connected && targetUser) {
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


            // Verarbeite Audio-Tracks (nur relevant, wenn der Peer online ist)
            if (event.track.kind === 'audio') {
                 const remoteUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                 if (remoteUser) {
                     console.log(`[WebRTC] Track ${event.track.id} ist Audio von Online Peer ${peerId}.`);
                     // Stelle sicher, dass das Audio-Element für diesen Peer existiert
                     const audioElement = ensureRemoteAudioElementExists(peerId); // Diese Funktion prüft auch auf Online-Status
                     if(audioElement) { // Nur wenn Element erstellt wurde
                         // Weise den Remote Stream (der Audio-Tracks enthält) dem Audio-Element zu
                         audioElement.srcObject = remoteStream;
                         // Versuche, das Audio abzuspielen (kann durch Browser-Richtlinien fehlschlagen)
                         audioElement.play().catch(e => console.warn(`[WebRTC] Fehler beim Abspielen von Remote Audio für Peer ${peerId}:`, e));

                         // Listener für Track-Events (optional für Debugging/Statusanzeige)
                         event.track.onended = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                         event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                         event.track.onunmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);
                     }
                 } else {
                     console.log(`[WebRTC] Track ${event.track.id} ist Audio von Peer ${peerId}, aber Peer ist nicht online. Ignoriere Audio-Track.`);
                 }


            // Verarbeite Video-Tracks (nur relevant, wenn der Peer online ist)
            } else if (event.track.kind === 'video') {
                 const remoteUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                 if (remoteUser) {
                     console.log(`[WebRTC] Track ${event.track.id} ist Video von Online Peer ${peerId}.`);

                     // Wenn der Bildschirm dieses Peers gerade angesehen wird, aktualisiere die Anzeige
                     if (state.currentlyViewingPeerId === peerId) {
                         console.log(`[WebRTC] Erhaltener Video Track von aktuell betrachtetem Online Peer ${peerId}. Aktualisiere Anzeige.`);
                         updateRemoteScreenDisplay(peerId); // Anzeige aktualisieren
                     }

                     // Listener für Track-Events
                     event.track.onended = () => {
                         console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} beendet.`);
                         // Prüfe, ob der Stream noch Video-Tracks enthält UND der Peer noch online ist
                         const remoteStreamForPeer = state.remoteStreams.get(peerId);
                         const peerStillOnline = state.allUsersList.find(u => u.id === peerId && u.isOnline);

                         if (remoteStreamForPeer && remoteStreamForPeer.getVideoTracks().length === 0 && peerStillOnline) {
                             console.log(`[WebRTC] Peer ${peerId} sendet keine Video-Tracks mehr (ist aber noch online). Aktualisiere Bildschirmanzeige.`);
                              // Wenn der Peer, dessen Bildschirm wir ansehen, keine Video-Tracks mehr sendet, stoppe die Anzeige
                              if (state.currentlyViewingPeerId === peerId) {
                                   console.log(`[WebRTC] Der Peer (${peerId}), dessen Bildschirm ich ansehe, sendet keine Video-Tracks mehr. Stoppe Anzeige.`);
                                   // Simuliere Klick auf "Anzeige stoppen" (forceStop=true)
                                   // Finde den Button, um den Klick zu simulieren
                                    const viewButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${peerId}']`);
                                   if (viewButton) {
                                        handleViewScreenClick({ target: viewButton }, true);
                                   } else {
                                        updateRemoteScreenDisplay(null); // Fallback
                                   }
                              }
                         }
                          // Wenn der Peer offline gegangen ist, wird die Anzeige durch updateUserList und cleanup ohnehin gestoppt.
                     };

                     event.track.onmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} gemutet.`);
                     event.track.onunmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} entmutet.`);
                 } else {
                      console.log(`[WebRTC] Track ${event.track.id} ist Video von Peer ${peerId}, aber Peer ist nicht online. Ignoriere Video-Track.`);
                 }
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
                   } else {
                       // Wenn ein Video-Track entfernt wurde und dieser Peer gerade angesehen wird UND der Peer noch online ist, aktualisiere die Anzeige
                        const peerStillOnline = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                        if (event.track.kind === 'video' && state.currentlyViewingPeerId === peerId && peerStillOnline) {
                            console.log(`[WebRTC] Video Track von aktuell betrachtetm Online Peer (${peerId}) entfernt. Aktualisiere Anzeige.`);
                            updateRemoteScreenDisplay(peerId);
                        }
                   }
                   // Wenn der Peer offline gegangen ist, wird die Anzeige durch updateUserList und cleanup ohnehin gestoppt.
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
                      // closePeerConnection(peerId); // Verbindung bei Fehler schließen - wird durch UserListUpdate bei Offline-Status gemacht
                     break;
                 case "closed": // Verbindung geschlossen
                     console.log(`[WebRTC] ICE 'closed': Verbindung zu Peer '${peerUsername}' wurde geschlossen.`);
                     // closePeerConnection(peerId); // Ressourcen freigeben - wird durch UserListUpdate bei Offline-Status gemacht
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
             // Der Client mit der niedrigere Socket ID ist "polite" und wartet im Konfliktfall.
             const isPolite = state.socketId < peerId;

             // Erstelle nur ein Offer, wenn die Verbindung im 'stable'-Zustand ist ODER
             // wenn wir im 'have-remote-offer'-Zustand sind UND nicht 'polite' sind (der 'impolite' Peer löst Glare auf)
             // Stelle auch sicher, dass der Ziel-Peer noch online ist
              const targetUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
             if (!targetUser) {
                  console.warn(`[WebRTC] Ziel Peer ${peerId} ist nicht online. Kann Negotiation nicht starten.`);
                  return;
             }


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
                      // Zusätzliche Prüfung, ob der Ziel-Peer noch online ist
                       if (socket && state.connected && targetUser) {
                           socket.emit('webRTC-signal', {
                               to: peerId, // Ziel Peer
                               type: 'offer', // Signal Typ
                               payload: pc.localDescription
                           });
                           console.log(`[Socket.IO] Sende 'webRTC-signal' (offer) an Peer ${peerId}.`);
                       } else {
                           console.warn(`[WebRTC] Cannot send offer to Peer ${peerId}. Socket not connected or target offline.`);
                       }

                 } catch (err) {
                     console.error(`[WebRTC] Peer ${peerId}: Fehler bei Offer Erstellung oder Setzung:`, err);
                     displayError(`Fehler bei Audio/Video-Verhandlung (Offer) mit Peer ${peerId}.`);
                     // Bei Fehlern die Verbindung schließen, besonders wenn der Peer nicht online ist
                      closePeerConnection(peerId);
                 }
             } else {
                  console.log(`[WebRTC] Peer ${peerId}: Signaling State (${pc.signalingState}) erlaubt keine Offer Erstellung. Warte.`);
             }
        };


        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc; // Gibt das neue oder bestehende PC-Objekt zurück
    }

    // Fügt lokale Stream-Tracks (Mikrofon oder Bildschirm) zu einer PeerConnection hinzu
    // Funktioniert nur für PeerConnections zu Online-Benutzern
    function addLocalStreamTracksToPeerConnection(pc, streamToAdd) {
         // Finde die Peer ID dieser PC
         let peerId = null;
         for (const [id, connection] of state.peerConnections.entries()) {
             if (connection === pc) {
                 peerId = id;
                 break;
             }
         }
         if (!peerId) {
              console.warn("[WebRTC] addLocalStreamTracksToPeerConnection: Konnte Peer ID für PC nicht finden.");
              return;
         }

         // Prüfe, ob der Peer noch online ist. Füge nur Tracks zu Online-Peers hinzu.
         const peerUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
         if (!peerUser) {
             console.warn(`[WebRTC] addLocalStreamTracksToPeerConnection: Peer ${peerId} ist nicht online. Füge keine Tracks hinzu.`);
             // Entferne ggf. vorhandene lokale Tracks zu diesem Offline-Peer
             pc.getSenders().forEach(sender => {
                 if (sender.track) {
                      console.log(`[WebRTC] Entferne lokalen Track ${sender.track.id} von Offline-Peer ${peerId}.`);
                      pc.removeTrack(sender);
                 }
             });
             return;
         }


         console.log(`[WebRTC] addLocalStreamTracksToPeerConnection aufgerufen für Online PC zu Peer ${peerId}. Stream ID: ${streamToAdd ? streamToAdd.id : 'null'}.`);
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
                          // Bei Fehler ggf. den Sender entfernen? Oder die Verbindung schließen?
                           // pc.removeTrack(existingSender);
                      });
                 } else {
                      console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits in remoteStream für Peer ${peerId}.`);
                 }
             } else {
                 // Wenn kein Sender für diesen Track-Typ existiert, füge einen neuen Track hinzu
                 console.log(`[WebRTC] Füge neuen Track ${track.kind} (${track.id}) hinzu.`);
                 // Füge den Track der PC hinzu (löst onnegotiationneeded aus). Weise auch den Stream zu (wichtig für das Grouping).
                 pc.addTrack(track, streamToAdd);
             }
         });

         // Entferne Sender, deren Tracks nicht mehr im aktuellen Stream sind ODER deren Art nicht im Stream ist
         // Filter senders, die einen Track haben UND deren Track-ID NICHT in den tracksToAdd gefunden wird
         senders.filter(sender => sender.track && !tracksToAdd.some(track => track.id === sender.track.id)).forEach(sender => {
              const trackKind = sender.track.kind;
              console.log(`[WebRTC] Entferne Sender für Track ${sender.track.id} (${trackKind}), da er nicht mehr im aktuellen Stream ist.`);
              pc.removeTrack(sender); // Entferne den Sender (löst onnegotiationneeded aus)
          });

         console.log("[WebRTC] Tracks in PC aktualisiert.");
          // Der `onnegotiationneeded` Event Handler wird automatisch ausgelöst, wenn Tracks hinzugefügt/entfernt werden.
     }


    // Aktualisiert die PeerConnections basierend auf der aktuellen Benutzerliste vom Server
    // Erstellt/aktualisiert PCs NUR für ONLINE-Benutzer
    function updatePeerConnections(currentRemoteOnlineUsers) {
         console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote Online User: ${currentRemoteOnlineUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

         // Schließe PeerConnections zu Benutzern, die den Raum verlassen haben ODER OFFLINE gegangen sind
         // Iteriere über eine Kopie der Keys, da die Map im Loop modifiziert wird
         Array.from(state.peerConnections.keys()).forEach(peerId => {
             const peerIsStillOnline = currentRemoteOnlineUsers.some(user => user.id === peerId);
              // Finde den Benutzer in der AllUsersList, um den isOnline Status zu prüfen
              const peerUser = state.allUsersList.find(user => user.id === peerId);


             // Schließe die PC, wenn der Peer nicht mehr in der Liste der ONLINE-User ist oder offline gegangen ist
             if (!peerIsStillOnline || (peerUser && !peerUser.isOnline)) {
                 console.log(`[WebRTC] Peer ${peerId} ist nicht mehr online. Schließe PeerConnection.`);
                 closePeerConnection(peerId); // Verbindung schließen
             }
         });

         // Erstelle PeerConnections für neue ONLINE-Benutzer und aktualisiere Tracks für bestehende ONLINE-Benutzer
         currentRemoteOnlineUsers.forEach(async user => {
             let pc = state.peerConnections.get(user.id);

             // Wenn noch keine PC zu diesem Benutzer besteht, erstelle eine neue (und der Benutzer ist online)
             if (!pc && user.isOnline) {
                 console.log(`[WebRTC] Neuer Online Peer ${user.username} (${user.id}) gefunden. Erstelle PeerConnection.`);
                 pc = await createPeerConnection(user.id); // Neue PC erstellen

                 // Bestimme den aktuell aktiven lokalen Stream (Mikrofon oder Bildschirm)
                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream && pc) { // Prüfe, ob PC erfolgreich erstellt wurde
                      console.log(`[WebRTC] Füge Tracks vom aktuellen lokalen Stream (${currentLocalStream.id || 'none'}) zur neuen PC (${user.id}) hinzu.`);
                     // Füge die Tracks des lokalen Streams hinzu
                     addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                 } else if (pc) { // Wenn PC erstellt wurde, aber kein lokaler Stream aktiv ist
                      console.log(`[WebRTC] Kein lokaler Stream zum Hinzufügen zur neuen PC (${user.id}).`);
                      // Auch wenn kein Stream aktiv ist, rufe die Funktion auf, um sicherzustellen,
                      // dass keine alten Tracks versehentlich vorhanden sind.
                      addLocalStreamTracksToPeerConnection(pc, null);
                 } else {
                      console.warn(`[WebRTC] PeerConnection für ${user.id} konnte nicht erstellt werden.`);
                 }

                  // Wenn wir der "impolite" Peer sind (niedrigere Socket ID), starten wir den Offer-Austausch.
                  // Der `onnegotiationneeded` Handler übernimmt das automatische Erstellen des Offers,
                  // wenn dieser Peer der Initiator (impolite) ist.
                  // Wenn wir 'polite' sind, warten wir auf ihr Offer.
                 if (pc) console.log(`[WebRTC] Initialisierung für Peer ${user.id} abgeschlossen. Negotiation wird folgen.`);


             } else if (pc && user.isOnline) { // Wenn PC existiert UND Benutzer online ist
                  console.log(`[WebRTC] Online Peer ${user.id} existiert. Überprüfe/aktualisiere Tracks.`);
                  // Stelle sicher, dass bestehende PCs die Tracks des aktuell aktiven lokalen Streams haben
                  const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                   if (currentLocalStream) {
                       addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                   } else {
                        // Wenn kein lokaler Stream aktiv ist, stelle sicher, dass keine lokalen Tracks gesendet werden
                        addLocalStreamTracksToPeerConnection(pc, null);
                   }
             }
              // Wenn der Benutzer offline ist, wird die PC in der ersten Schleife geschlossen.
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
              // Finde den Button, um den Klick zu simulieren
               const viewButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${peerId}']`) || document.querySelector(`#offlineUserList li .view-screen-button[data-peer-id='${peerId}']`);
              if (viewButton) {
                   handleViewScreenClick({ target: viewButton }, true);
              } else {
                   updateRemoteScreenDisplay(null); // Fallback
              }
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
        
        // Prüfe, ob wir verbunden sind
        if (!socket || !state.connected) {
            console.error("[Chat Send Error] Cannot send message. Not connected.");
            displayError("Nicht verbunden. Nachricht kann nicht gesendet werden.");
            return;
        }

        // Wenn eine Datei ausgewählt ist, sende diese
        if (state.selectedFile) {
            sendFile();
            return;
        }

        // Wenn keine Nachricht und keine Datei, dann nichts senden
        if (!content) {
            console.log("sendMessage: Inhalt leer. Abbruch.");
            return; // Sende nicht, wenn leer
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
         // Sende typing: false, nachdem die Nachricht gesendet wurde
         // Verwende hier socket.id statt state.username
         if (socket && state.socketId) {
             sendTyping(false);
         }

    }

    // Fügt eine empfangene Nachricht zur UI hinzu
    function appendMessage(msg) {
         console.log("[UI] appendMessage aufgerufen:", msg);
         // Prüfe, ob die Nachricht gültig ist und der Nachrichtencontainer existiert
         if (!msg || msg.id === undefined || msg.username === undefined || !UI.messagesContainer) {
             console.warn("appendMessage: Ungültige Nachrichtendaten oder Nachrichtencontainer nicht gefunden.", msg);
             return;
         }

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message');
        const isMe = msg.id === state.socketId; // Prüfe, ob es die eigene Nachricht ist
        if (isMe) msgDiv.classList.add('me'); // Klasse für eigenes Styling hinzufügen

        // Avatar-Initialen
        const avatarDiv = document.createElement('div');
        avatarDiv.classList.add('avatar');
        const initials = (msg.username || '?').split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase();
        avatarDiv.textContent = initials;
        avatarDiv.style.background = escapeHTML(msg.color || getUserColor(msg.id));
        msgDiv.appendChild(avatarDiv);

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('name');
        nameSpan.textContent = escapeHTML(msg.username); // Benutzernamen escapen und setzen
        nameSpan.style.color = escapeHTML(msg.color || getUserColor(msg.id)); // Farbe setzen (vom Server oder generiert)
        msgDiv.appendChild(nameSpan); // Namen hinzufügen

        const contentDiv = document.createElement('div');
        contentDiv.classList.add('content');
        
        // Prüfe, ob es eine Datei-Nachricht ist
        if (msg.type === 'file' && msg.fileData) {
            const fileLink = document.createElement('a');
            fileLink.href = msg.fileData.data;
            fileLink.download = msg.fileData.name;
            fileLink.textContent = `📎 ${msg.fileData.name} (${formatFileSize(msg.fileData.size)})`;
            fileLink.style.color = 'inherit';
            fileLink.style.textDecoration = 'none';
            fileLink.target = '_blank';
            contentDiv.appendChild(fileLink);
        } else {
            // Setze den Textinhalt (escapen ist wichtig gegen XSS)
            // textContent behält Zeilenumbrüche aus Textareas bei, innerHTML würde sie ignorieren, wenn nicht <br> verwendet wird
            contentDiv.textContent = escapeHTML(msg.content || '');
        }
        
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
         // Sende nur, wenn verbunden und das Eingabefeld aktiv ist UND unsere Socket ID bekannt ist
         if (!socket || !state.connected || !state.socketId || (UI.messageInput && UI.messageInput.disabled)) {
              return;
         }

         // Lösche eventuell vorhandenen Timeout, um 'false' nicht zu früh zu senden
         clearTimeout(state.typingTimeout);

          // Client sendet Typing-Status AN DEN SERVER (Server muss auf 'typing' lauschen und es weiterleiten)
          if (socket) { // Stelle sicher, dass der Socket existiert
              // Sende hier nicht den Benutzernamen, sondern die Socket ID, da der Server den Benutzernamen kennt.
              socket.emit('typing', { userId: state.socketId, isTyping }); // Sende das 'typing'-Event mit User ID
          }

         // Wenn der Status 'true' ist, setze einen Timeout, um später 'false' zu senden
         if (isTyping) {
              state.typingTimeout = setTimeout(() => {
                  // Sende 'typing: false', wenn der Timeout abgelaufen ist und wir noch verbunden sind
                  if (socket && state.connected && state.socketId) {
                       socket.emit('typing', { userId: state.socketId, isTyping: false });
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

          // Finde den Benutzer in der AllUsersList, um den Online-Status zu prüfen
         const peerUser = state.allUsersList.find(user => user.id === peerId);
         // Stelle sicher, dass der Peer online ist, bevor der Bildschirm angesehen werden kann (es sei denn forceStop)
          if (!forceStop && (!peerUser || !peerUser.isOnline)) {
              console.warn(`[UI] handleViewScreenClick: Peer ${peerId} ist nicht online. Kann Bildschirm nicht ansehen.`);
              displayError(`Bildschirm von ${peerUser ? escapeHTML(peerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden, da er offline ist.`);
               // Deaktiviere den Button, falls er fälschlicherweise aktiv war
              if (clickedButton) {
                  clickedButton.disabled = true;
                  clickedButton.classList.add('disabled');
               }
              updateRemoteScreenDisplay(null); // Stelle sicher, dass die Anzeige gestoppt ist
              return;
          }


         // Prüfe, ob dieser Peer gerade angesehen wird
         const isCurrentlyViewing = state.currentlyViewingPeerId === peerId;

         // Szenario 1: Klick auf "Anzeige stoppen" oder erzwungener Stop für den aktuell betrachteten Peer
         // Bedingung angepasst: forceStop ODER (geclickter Button ist ein Stop Button UND der Peer ist der aktuell betrachtete)
         if (forceStop || (clickedButton && clickedButton.classList.contains('stop') && isCurrentlyViewing)) {
             console.log(`[UI] Klick auf "Anzeige stoppen" oder forceStop für Peer ${peerId}.`);
             updateRemoteScreenDisplay(null); // Remote Screen Anzeige verstecken

              // Aktiviere alle "Bildschirm ansehen" Buttons für andere Sharer wieder (nur Online-Sharer)
              state.allUsersList.forEach(user => {
                   // Finde nur Online-User, die teilen und nicht der aktuelle Benutzer sind
                   if (user.id !== state.socketId && user.isOnline && user.sharingStatus) {
                       // Finde den Button in der Online-Liste
                       const sharerButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${user.id}']`);
                       if (sharerButton) sharerButton.disabled = false;
                   }
              });

             // Aktualisiere den Button-Zustand für den Peer, der gerade angesehen wurde (kann Online oder Offline gewesen sein, aber der Button war in der Online-Liste)
              const wasViewingButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${peerId}']`);
              if(wasViewingButton) {
                  wasViewingButton.textContent = 'Bildschirm ansehen';
                  wasViewingButton.classList.remove('stop');
                  wasViewingButton.classList.add('view');
                  wasViewingButton.disabled = false; // Stelle sicher, dass er nach dem Stoppen aktiv ist (wenn der Peer noch online ist)
                   // Wenn der Peer jetzt offline ist, sollte der Button ohnehin entfernt/nicht klickbar sein.
              }


         // Szenario 2: Klick auf "Bildschirm ansehen" für einen Peer, der aktuell NICHT angesehen wird UND der Peer ist online und teilt
         } else if (!isCurrentlyViewing && clickedButton && clickedButton.classList.contains('view') && peerUser && peerUser.isOnline && peerUser.sharingStatus) {
             console.log(`[UI] Klick auf "Bildschirm ansehen" für Online Peer ${peerId}, der teilt.`);

             // Finde den Sharer-Benutzer und seinen Stream
             const sharerStream = state.remoteStreams.get(peerId);

             // Prüfe, ob der Stream tatsächlich existiert und einen Video-Track hat
             if (sharerStream && sharerStream.getVideoTracks().length > 0) {
                  console.log(`[UI] Peer ${peerId} teilt und Stream ist verfügbar. Zeige Bildschirm an.`);

                  // Wenn wir gerade einen anderen Peer ansehen, stoppe diese Anzeige zuerst
                  if (state.currentlyViewingPeerId !== null && state.currentlyViewingPeerId !== peerId) {
                       console.log(`[UI] Stoppe vorherige Anzeige von Peer ${state.currentlyViewingPeerId}.`);
                       // Simuliere Klick auf den Stopp-Button für den zuvor angesehenen Peer
                        const previousViewingButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${state.currentlyViewingPeerId}']`);
                       if (previousViewingButton) {
                            handleViewScreenClick({ target: previousViewingButton }, true);
                       } else {
                            updateRemoteScreenDisplay(null); // Fallback
                       }
                  }

                 // Aktualisiere die Remote Screen Anzeige, um den Stream dieses Peers zu zeigen
                 updateRemoteScreenDisplay(peerId);

                 // Deaktiviere andere "Bildschirm ansehen" Buttons, während einer angesehen wird (nur für online Sharer)
                  state.allUsersList.forEach(user => {
                       if (user.id !== state.socketId && user.isOnline && user.sharingStatus && user.id !== peerId) {
                           const otherViewButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true;
                       }
                  });

                 // Aktualisiere Text und Klasse des geklickten Buttons
                  clickedButton.textContent = 'Anzeige stoppen';
                  clickedButton.classList.remove('view');
                  clickedButton.classList.add('stop');


             } else {
                 console.warn(`[UI] Peer ${peerId} teilt nicht oder Stream nicht verfügbar. Kann Bildschirm nicht ansehen.`);
                 displayError(`Bildschirm von ${peerUser ? escapeHTML(peerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden.`);
                 // Stelle sicher, dass die Remote Screen Anzeige versteckt ist, falls sie versehentlich einen ungültigen Zustand zeigte
                 updateRemoteScreenDisplay(null);
                  // Korrigiere den Button-Zustand
                  if (clickedButton) {
                       clickedButton.textContent = 'Bildschirm ansehen';
                       clickedButton.classList.remove('stop');
                       clickedButton.classList.add('view');
                       clickedButton.disabled = false; // Stelle sicher, dass er aktiv ist
                   }
             }
          // Szenario 3: Klick auf den "Anzeige stoppen" Button, obwohl dieser Peer nicht angesehen wird (sollte bei korrekter Logik nicht passieren, aber gut für Sicherheit)
          } else if (!isCurrentlyViewing && clickedButton && clickedButton.classList.contains('stop')) {
               console.warn(`[UI] Klick auf "Anzeige stoppen" für Peer ${peerId}, aber ich sehe ihn nicht an. Aktualisiere Button.`);
                // Korrigiere den Button-Zustand
               const incorrectStopButton = document.querySelector(`#onlineUserList li .view-screen-button[data-peer-id='${peerId}']`);
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
              console.log("[UI] Fullscreen verlassen.");
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
             // updateUIAfterDisconnect wird aufgerufen, was die UI zurücksetzt und PeerConnections schließt.
             updateUIAfterDisconnect();
             // Die Benutzerliste wird vom Server aktualisiert, um uns als offline zu markieren.
         });

         // ** FIX FOR TOKEN ERROR / RECONNECT ISSUES **
         // Handle connection errors more explicitly.
         socket.on('connect_error', (err) => {
             console.error("[Socket.IO] Verbindungsfehler:", err.message, err);
             let errorMessage = `Verbindungsfehler: ${err.message}`;

             // Check if the error is related to authentication (e.g., invalid credentials)
             if (err.message === 'Benutzername in diesem Raum bereits online') {
                 errorMessage = 'Verbindung fehlgeschlagen: Dieser Benutzername ist in diesem Raum bereits online.';
             } else if (err.message === 'Benutzername ist erforderlich' || err.message === 'Raum-ID ist erforderlich') {
                  errorMessage = `Verbindung fehlgeschlagen: Authentifizierungsfehler - ${err.message}.`;
             } else if (err.data && err.data.type === 'UnauthorizedError') {
                 // Handle specific unauthorized errors from the server if they were sent with err.data
                  errorMessage = `Verbindung fehlgeschlagen: Authentifizierung fehlgeschlagen - ${err.data.message || err.message}.`;
             }
             // You might add more specific error checks here based on potential server errors

             displayError(errorMessage);
             setConnectionStatus('disconnected', 'Verbindungsfehler');
             // updateUIAfterDisconnect will be called by the 'disconnect' event which follows 'connect_error'
         });
         // ** END FIX **


         // Listener für eingehende Chat-Nachrichten
         socket.on('message', (msg) => {
             console.log("[Socket.IO] Nachricht empfangen:", msg);
              // Prüfe, ob der Absender online ist oder nicht (optional, je nach Logik)
              // Für Chat-Nachrichten ist es üblich, sie anzuzeigen, unabhängig vom Status des Absenders zum Zeitpunkt des Lesens.
             appendMessage(msg); // Nachricht zur UI hinzufügen
         });

         // Listener für Aktualisierungen der Benutzerliste
         socket.on('user list', (users) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'user list' AUSGELÖST.
              // Die Liste enthält jetzt online- und offline-Benutzer mit isOnline Status.
             console.log("[Socket.IO] Userliste empfangen:", users);
             updateUserList(users); // Benutzerliste in der UI aktualisieren
         });

          // Listener für Tipp-Status von anderen Benutzern
          // Erwartet userId, username, isTyping
          socket.on('typing', (data) => {
              console.log(`[Socket.IO] Typing Status empfangen von ${data.username} (${data.userId}): ${data.isTyping}`);

              // Prüfe, ob der Benutzer online ist und nicht der lokale Benutzer ist
               const typingUser = state.allUsersList.find(user => user.id === data.userId);

               if (typingUser && typingUser.isOnline && typingUser.id !== state.socketId) {
                   const wasNotAlreadyTyping = !state.typingUsers.has(data.userId);

                   if (data.isTyping) {
                       state.typingUsers.add(data.userId);
                       // Benachrichtigung nur abspielen, wenn ein ANDERER ONLINE-Benutzer anfängt zu tippen
                       if (wasNotAlreadyTyping) {
                           console.log("[UI] Anderer Online-Benutzer beginnt zu tippen. Spiele Benachrichtigung.");
                           playNotificationSound();
                       }
                   } else {
                       state.typingUsers.delete(data.userId);
                   }
                   updateTypingIndicatorDisplay(); // Tipp-Anzeige in der UI aktualisieren
               } else {
                   // Wenn der Benutzer offline ist oder der lokale Benutzer, ignoriere das Typing-Signal
                   console.log(`[UI] Ignoriere Typing-Signal von ${data.userId}. Benutzer ist nicht online oder ist der lokale Benutzer.`);
                    // Stellen Sie sicher, dass er aus der typingUsers Set entfernt wird, falls er offline geht
                    if (state.typingUsers.has(data.userId)) {
                         state.typingUsers.delete(data.userId);
                         updateTypingIndicatorDisplay(); // Anzeige aktualisieren, falls nötig
                    }
               }
          });


         // Listener für WebRTC Signalisierungsnachrichten
         socket.on('webRTC-signal', async (signal) => {
              console.log(`[Socket.IO] WebRTC Signal empfangen von ${signal.from} (Type: ${signal.type}):`, signal.payload);
              const peerId = signal.from;
              const pc = state.peerConnections.get(peerId); // Finde die zugehörige PeerConnection

              // Finde den Peer in der AllUsersList, um den Online-Status zu prüfen
              const peerUser = state.allUsersList.find(user => user.id === peerId);

              // Wenn keine PC für diesen Peer existiert ODER der Peer nicht online ist, ignoriere das Signal
              if (!pc || !peerUser || !peerUser.isOnline) {
                  console.warn(`[WebRTC] WebRTC-signal: Keine PeerConnection, Peer offline, oder User nicht gefunden für eingehendes Signal von Peer ${peerId}. Ignoriere Signal.`);
                   // Wenn der Peer offline ist, schließe eventuell vorhandene PC
                   if (peerUser && !peerUser.isOnline) {
                       closePeerConnection(peerId); // Sicherstellen, dass die PC geschlossen wird
                   }
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
                      await pc.setLocalDescription(answer);
                      console.log(`[WebRTC] Local Description (Answer) für Peer ${peerId} gesetzt. Sende Answer an Server.`);
                       // Sende das Answer an den Server zur Weiterleitung an den anderen Peer
                       // Zusätzliche Prüfung, ob der Ziel-Peer noch online ist
                       const targetUser = state.allUsersList.find(u => u.id === peerId && u.isOnline);
                       if (socket.connected && targetUser) {
                           socket.emit('webRTC-signal', {
                               to: peerId,
                               type: 'answer',
                               payload: pc.localDescription
                           });
                           console.log(`[Socket.IO] Sende 'webRTC-signal' (answer) an Peer ${peerId}.`);
                       } else {
                           console.warn(`[WebRTC] Cannot send answer to Peer ${peerId}. Socket not connected or target offline.`);
                       }

                  } else if (signal.type === 'answer') {
                       console.log(`[WebRTC] Eingehendes Answer von Peer ${peerId}. Setze Remote Description.`);
                       // Prüfe, ob wir auf ein Answer warten (Signaling State sollte 'have-local-offer' sein) UND der Peer online ist
                        if (pc.signalingState !== 'have-local-offer' || !peerUser.isOnline) {
                             console.warn(`[WebRTC] Empfing Answer von Peer ${peerId} im unerwarteten Signaling State: ${pc.signalingState} oder Peer ist offline. Ignoriere Answer.`);
                             // Wenn der Peer offline ist, schließe eventuell vorhandene PC
                             if (peerUser && !peerUser.isOnline) {
                                 closePeerConnection(peerId);
                             }
                             return; // Answer ignorieren
                        }
                      // Setze die Remote Description mit dem erhaltenen Answer
                      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                      console.log(`[WebRTC] Remote Description (Answer) für Peer ${peerId} gesetzt.`);

                  } else if (signal.type === 'candidate') {
                       console.log(`[WebRTC] Eingehender ICE Candidate von Peer ${peerId}. Füge Candidate hinzu.`);
                        // Prüfe, ob der Peer online ist
                       if (!peerUser.isOnline) {
                           console.warn(`[WebRTC] Empfing ICE Candidate von Peer ${peerId}, aber Peer ist offline. Ignoriere Candidate.`);
                           // Wenn der Peer offline ist, schließe eventuell vorhandene PC
                            closePeerConnection(peerId);
                           return; // Candidate ignorieren
                       }

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
                   closePeerConnection(peerId); // Verbindung schließen bei Fehler
              }
         });

          // Listener für Server-seitige Fehler
          socket.on('error', (error) => {
              console.error('[Socket.IO] Server Error:', error);
              displayError(`Server Error: ${error.message || error}`);
          });

         // Optional: Listener für WebRTC Errors vom Server (falls der Server Fehler beim Weiterleiten meldet)
         socket.on('webRTC-error', (error) => {
              console.error('[Socket.IO] Server reported WebRTC Error:', error);
              displayError(`WebRTC Error: ${error.message || 'Ein Fehler ist bei der WebRTC Kommunikation aufgetreten.'}`);
              // Hier könnte man spezifischer auf Fehler reagieren, z.B. die PC zu dem betroffenen Peer schließen.
              if (error.to) {
                   console.log(`[WebRTC] Schließe PeerConnection zu ${error.to} aufgrund von Server-gemeldetem Fehler.`);
                  closePeerConnection(error.to);
              }
         });


         console.log("[Socket.IO] Socket Listener eingerichtet.");
    }


    // --- Event Listener Zuweisungen ---

    console.log("[App] Event Listener werden zugewiesen.");

    // Connect Button Listener
    if (UI.connectBtn) {
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
            // ** FIX: Ensure old socket is properly handled before creating a new one **
             if (socket) {
                  console.log("[App] Existing socket found. Disconnecting it before creating a new one.");
                  socket.removeAllListeners(); // Remove all listeners from the old socket
                  socket.disconnect(); // Explicitly disconnect the old socket
                  socket = null; // Clear the reference
             }
            // ** END FIX **


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

        UI.connectBtn.addEventListener('click', connect);
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
                // updateUIAfterDisconnect wird durch das disconnect event getriggert
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
         UI.sendBtn.addEventListener('click', sendMessage);
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
              // Sende Typing-Status mit socket.id
             const isTyping = UI.messageInput ? UI.messageInput.value.trim().length > 0 : false;
             if (socket && state.socketId) {
                 sendTyping(isTyping);
             }
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

    // Listener für Datei-Upload
    if (UI.fileInput) {
        UI.fileInput.addEventListener('change', handleFileSelect);
        console.log("[App] fileInput Listener zugewiesen.");
    } else {
        console.warn("[App] fileInput Element nicht gefunden.");
    }

     // Listener für das globale fullscreenchange Event des Browsers
     // Aktualisiert den Text des Vollbild-Buttons
     document.addEventListener('fullscreenchange', () => {
          if (UI.remoteScreenFullscreenBtn && UI.remoteScreenContainer) {
               // Prüfe, ob der Remote Screen Container oder ein darin enthaltenes Element gerade im Vollbild ist
               const isRemoteScreenInFullscreen = document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement));
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
            // Sende ein Signal an den Server, dass der Benutzer geht, damit der Status sofort auf offline gesetzt wird
            // Anstatt socket.disconnect(), was sofort trennt, können wir ein Event senden und dann disconnect()
            // socket.emit('userLeaving', { userId: state.socketId, roomId: state.roomId }); // Optional: eigenes Event senden
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
