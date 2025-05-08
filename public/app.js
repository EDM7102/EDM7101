document.addEventListener('DOMContentLoaded', () => {
    const UI = {
        // ... (vorherige UI Elemente) ...
        remoteAudioControls: document.getElementById('remoteAudioControls'),

        // Neue UI Elemente für Bildschirm teilen
        shareScreenBtn: document.getElementById('shareScreenBtn'),
        remoteScreenContainer: document.getElementById('remoteScreenContainer'),
        remoteScreenSharerName: document.getElementById('remoteScreenSharerName'),
        remoteScreenVideo: document.getElementById('remoteScreenVideo'),
        remoteScreenFullscreenBtn: document.querySelector('#remoteScreenContainer .fullscreen-btn') // Vollbild-Button im Screen Container
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

        // Sound Effekt
        notificationSound: new Audio('/notif.mp3'),

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
        // remoteScreenStream wird nicht mehr im State gehalten, wir holen ihn aus remoteStreams anhand von currentlyViewingPeerId
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

    // ... (initializeUI, setConnectionStatus, displayError, updateUIAfterConnect, updateUIAfterDisconnect, saveStateToLocalStorage, loadStateFromLocalStorage, playNotificationSound Funktionen bleiben gleich) ...

    // --- Event Listener ---
    // ... (connect, disconnect, sendMessage, messageInput, micSelect event listener bleiben gleich) ...

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
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { /* Safari */
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) { /* IE11 */
                document.msExitFullscreen();
            }
             // Re-check if *any* element is still in fullscreen after attempt
             if (document.fullscreenElement) {
                  console.warn("[UI] Exit Fullscreen failed, another element is still in fullscreen.");
             }
        }
    }


    // --- Utility Functions ---
    // ... (escapeHTML, getUserColor, playNotificationSound bleiben gleich) ...

    // --- Media Device Functions ---
    // ... (populateMicList bleibt gleich) ...

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
            const dot = document.createElement('span');
            dot.className = 'user-dot';
            dot.style.backgroundColor = escapeHTML(user.color || getUserColor(user.id));
            li.appendChild(dot);

            // Container für Name und Sharing-Indikator
            const nameContainer = document.createElement('span');
            nameContainer.style.flexGrow = '1'; // Name und Indikator nehmen Platz ein
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';

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
                     localMuteBtn.addEventListener('click', toggleLocalAudioMute);
                     UI.micSelect.parentNode.insertBefore(localMuteBtn, UI.connectBtn);
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
                           updateShareScreenButtonUI(); // Aktualisiere Text und Klasse
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
                     sharingIndicator.textContent = ' 🖥️'; // Oder ein Icon
                     sharingIndicator.title = `${escapeHTML(user.username)} teilt Bildschirm`;
                     nameContainer.appendChild(sharingIndicator);
                }


                // Prüfen, ob dieser Benutzer neu ist (für Sound-Benachrichtigung)
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
                 viewButton.addEventListener('click', handleViewScreenClick);

                 li.appendChild(viewButton);
            }


            UI.userList.appendChild(li);
        });

         updateRemoteAudioControls(otherUsers);
         updatePeerConnections(otherUsers); // Stellt WebRTC PCs für Audio sicher

         if (UI.remoteAudioControls) {
              if (otherUsers.length > 0) {
                   UI.remoteAudioControls.classList.remove('hidden');
              } else {
                   UI.remoteAudioControls.classList.add('hidden');
              }
         }

         // Nach jeder Userlist-Aktualisierung die Bildschirmanzeige prüfen
         // Dies ist wichtig, falls der aktuell angezeigte Sharer den Raum verlässt
         // oder aufhört zu teilen (Status wird in der Liste aktualisiert).
          if (state.currentlyViewingPeerId) {
               const sharerStillSharing = state.allUsersList.some(user => user.id === state.currentlyViewingPeerId && user.sharingStatus);
               if (!sharerStillSharing) {
                    console.log(`[UI] Aktuell betrachteter Sharer (${state.currentlyViewingPeerId}) teilt nicht mehr. Stoppe Anzeige.`);
                    handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true); // Ruft die Stopp-Logik auf
               }
          } else {
               // Wenn currentlyViewingPeerId null ist, stellen wir sicher, dass die Anzeige versteckt ist.
               updateRemoteScreenDisplay(null);
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
                 video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
                 audio: true // Versuche auch System-Audio zu bekommen
             });
             state.screenStream = stream;
             state.isSharingScreen = true;
             console.log(`[WebRTC] Bildschirmstream erhalten: ${stream.id}. Tracks: Video: ${stream.getVideoTracks().length}, Audio: ${stream.getAudioTracks().length}`);

             // Stoppe den lokalen Mikrofonstream, wenn ein Screen-Audio-Track vorhanden ist.
             const screenAudioTrack = stream.getAudioTracks()[0];
             if (screenAudioTrack && state.localAudioStream) {
                  console.log("[WebRTC] Bildschirmstream hat Audio. Stoppe lokalen Mikrofonstream.");
                 stopLocalAudioStream();
             } else {
                  console.log("[WebRTC] Bildschirmstream hat kein Audio oder Mikrofon war nicht aktiv. Mikrofon bleibt/ist inaktiv.");
             }

             // Füge die Tracks des Screen-Streams zu allen PeerConnections hinzu
             state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream);
             });

             // Event Listener für das Ende der Bildschirmteilung (z.B. durch Browser UI)
             const screenVideoTrack = stream.getVideoTracks()[0];
             if (screenVideoTrack) {
                 screenVideoTrack.onended = () => {
                     console.log("[WebRTC] Bildschirmteilung beendet durch Browser UI.");
                     if (state.isSharingScreen) {
                         toggleScreenSharing(); // Rufe toggle auf, um sauber zu beenden
                     }
                 };
                  console.log("[WebRTC] onended Listener für Screen Video Track hinzugefügt.");
             } else {
                  console.warn("[WebRTC] Kein Screen Video Track gefunden, onended Listener konnte nicht hinzugefügt werden.");
             }

             // Sende Signal an ALLE (inklusive sich selbst) dass ich anfange zu teilen
             // Der Server sendet es an alle im Raum, was dann userListUpdate triggert.
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
                  errorMessage = "Bildschirmfreigabe abgebrochen.";
             }
             displayError(errorMessage);

             state.screenStream = null;
             state.isSharingScreen = false;
             setupLocalAudioStream(); // Stelle lokalen Audio-Stream wieder her

             updateShareScreenButtonUI(); // Button UI zurücksetzen

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

        UI.shareScreenBtn.disabled = true;

        if (state.isSharingScreen) {
            stopScreenSharing(true);
        } else {
            await startScreenSharing();
        }

        UI.shareScreenBtn.disabled = false;
         // updateShareScreenButtonUI wird in start/stopScreenSharing aufgerufen
    }

     // Aktualisiert die UI des Bildschirm teilen Buttons (Sender)
     function updateShareScreenButtonUI() {
         if (UI.shareScreenBtn) {
             UI.shareScreenBtn.textContent = state.isSharingScreen ? 'Teilen beenden' : '🖥 Bildschirm teilen';
             UI.shareScreenBtn.classList.toggle('active', state.isSharingScreen);
         }
     }


    // Erstellt eine neue RTCPeerConnection für einen spezifischen Peer
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
             // Nur hinzufügen, wenn der Track noch nicht im Stream ist
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
                     updateRemoteScreenDisplay(peerId); // Rufe updateRemoteScreenDisplay auf, um den Stream neu zuzuweisen
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
                 }
             };

             // Der WebRTC-Stream wird auch durch das Ende der PeerConnection beendet
             // oder wenn alle Tracks im Stream enden.
        }; // Ende pc.ontrack

        // ... (oniceconnectionstatechange, onsignalingstatechange, onnegotiationneeded bleiben gleich) ...

        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc;
    }

    // Fügt die Tracks des LOKALEN STREAMS (Mikro oder Screen) zu einer PeerConnection hinzu
    function addLocalStreamTracksToPeerConnection(pc, streamToAdd) {
        console.log(`[WebRTC] addLocalStreamTracksToPeerConnection aufgerufen. Stream ID: ${streamToAdd ? streamToAdd.id : 'null'}.`);
        if (!pc) {
            console.warn("[WebRTC] addLocalStreamTracksToPeerConnection: PeerConnection ist null.");
            return;
        }

        const senders = pc.getSenders();
        const tracksToAdd = streamToAdd ? streamToAdd.getTracks() : [];

        console.log(`[WebRTC] PC hat ${senders.length} Sender. Stream hat ${tracksToAdd.length} Tracks.`);

        // Gehe durch die Tracks, die HINZUGEFÜGT werden sollen
        tracksToAdd.forEach(track => {
            const existingSender = senders.find(s => s.track && s.track.kind === track.kind);

            if (existingSender) {
                // Sender existiert bereits -> Track ersetzen
                if (existingSender.track !== track) {
                     console.log(`[WebRTC] Ersetze Track ${track.kind} im Sender (${existingSender.track?.id || 'none'}) durch Track ${track.id}.`);
                    existingSender.replaceTrack(track).catch(e => {
                        console.error(`[WebRTC] Fehler beim Ersetzen des Tracks ${track.kind}:`, e);
                    });
                } else {
                    console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits im Sender. Kein Ersetzen nötig.`);
                }
            } else {
                // Sender existiert nicht -> Track hinzufügen
                console.log(`[WebRTC] Füge neuen Track ${track.kind} (${track.id}) hinzu.`);
                pc.addTrack(track, streamToAdd);
            }
        });

        // Gehe durch die VORHANDENEN Sender, um Tracks zu entfernen, die NICHT mehr im Stream sind
        senders.forEach(sender => {
            if (sender.track) {
                const trackStillExists = tracksToAdd.some(track => track.id === sender.track.id);
                 const trackKind = sender.track.kind;

                if (!trackStillExists) {
                     console.log(`[WebRTC] Entferne Sender für Track ${sender.track.id} (${trackKind}), da er nicht mehr im Stream ist.`);
                    pc.removeTrack(sender);
                } else {
                      console.log(`[WebRTC] Sender für Track ${sender.track.id} (${trackKind}) bleibt erhalten.`);
                }
            } else {
                // console.log("[WebRTC] Sender hat keinen Track."); // Kann passieren nach removeTrack
            }
        });


        console.log("[WebRTC] Tracks in PC aktualisiert.");
    }


    // Aktualisiert die Menge der PeerConnections basierend auf der aktuellen Benutzerliste
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

                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                      console.log(`[WebRTC] Füge Tracks vom aktuellen lokalen Stream (${currentLocalStream.id}) zur neuen PC (${user.id}) hinzu.`);
                      addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                 } else {
                      console.log(`[WebRTC] Kein lokaler Stream zum Hinzufügen zur neuen PC (${user.id}).`);
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
                 }
            }
        });
    }


    // Schließt eine spezifische PeerConnection und bereinigt zugehörige Ressourcen
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

         // Bereinige zugehörige Ressourcen für diesen Peer
         removeRemoteAudioElement(peerId); // Entfernt das Audio-Element

         // Entferne den empfangenen Stream für diesen Peer aus der Map
         if (state.remoteStreams.has(peerId)) {
              console.log(`[WebRTC] Entferne remoteStream für Peer ${peerId}.`);
              const streamToRemove = state.remoteStreams.get(peerId);
              streamToRemove.getTracks().forEach(track => track.stop()); // Stoppe die Tracks im Stream
              state.remoteStreams.delete(peerId);
         }

         // Wenn der geteilte Bildschirm von diesem Peer kam ODER wir ihn gerade ansehen, blende ihn aus
         if (state.remoteScreenPeerId === peerId || state.currentlyViewingPeerId === peerId) {
              console.log(`[WebRTC] Geschlossener Peer ${peerId} war Sharer oder wurde betrachtet. Stoppe Anzeige.`);
              // Simuliere Klick auf "Anzeige stoppen" für diesen Peer, falls er betrachtet wurde
              if (state.currentlyViewingPeerId === peerId) {
                   handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true); // forceStop = true
              }
              // Wenn er nur Sharer war, aber nicht betrachtet, wird nur der Stream aus der Map gelöscht.
              // Der Status in der Userliste wird durch userListUpdate aktualisiert.
         }

    }

    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
        state.peerConnections.forEach((pc, peerId) => {
            closePeerConnection(peerId);
        });
         state.peerConnections.clear();
         console.log("[WebRTC] Alle PeerConnections geschlossen.");

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
         const peerId = event.target.dataset.peerId;
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
         } else if (!isCurrentlyViewing) {
             // Klick auf "Bildschirm ansehen" für einen Peer
             console.log(`[UI] Klick auf "Bildschirm ansehen" für Peer ${peerId}.`);

             // Prüfe, ob dieser Peer auch tatsächlich teilt (sollte durch Button-Anzeige garantiert sein)
             const sharerUser = state.allUsersList.find(user => user.id === peerId && user.sharingStatus);
             const sharerStream = state.remoteStreams.get(peerId); // Holen den empfangenen Stream

             if (sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0) {
                 // Peer teilt und wir haben einen Stream mit Video -> Anzeige starten
                  console.log(`[UI] Peer ${peerId} teilt und Stream ist verfügbar. Zeige Bildschirm an.`);
                 updateRemoteScreenDisplay(peerId); // Startet die Anzeige für diesen Peer

                 // Deaktiviere den Button "Ansehen" für andere Sharer, falls vorhanden
                 state.allUsersList.forEach(user => {
                      if (user.id !== state.socketId && user.sharingStatus && user.id !== peerId) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true; // Andere Buttons deaktivieren
                      }
                 });

                 // Aktualisiere den geklickten Button zu "Anzeige stoppen"
                  event.target.textContent = 'Anzeige stoppen';
                  event.target.classList.remove('view');
                  event.target.classList.add('stop');


             } else {
                 // Peer teilt nicht mehr oder wir haben den Stream nicht (mehr)
                 console.warn(`[UI] Peer ${peerId} teilt nicht oder Stream nicht verfügbar. Kann Bildschirm nicht ansehen.`);
                 displayError(`Bildschirm von ${sharerUser ? escapeHTML(sharerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden.`);
                 // Blende Anzeige aus, falls fälschlicherweise etwas angezeigt wurde
                 updateRemoteScreenDisplay(null);
             }
         } else if (isCurrentlyViewing && forceStop) {
              // Force stop case (triggered internally when sharer leaves or stops)
              console.log(`[UI] Force Stop Anzeige für Peer ${peerId}.`);
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
         // Wenn auf "Anzeige stoppen" geklickt wird, während ein ANDERER Bildschirm angezeigt wird,
         // sollte der Klick ignoriert werden, oder zuerst die aktuelle Anzeige gestoppt werden.
         // Mit der aktuellen Logik wird nur die Anzeige des geklickten Peers gestoppt (wenn er angezeigt wird).
         // Wir brauchen eine Logik, die sicherstellt, dass immer nur EIN Bildschirm angezeigt wird.
         // updateRemoteScreenDisplay(sharerPeerId) handhabt bereits, dass nur ein srcObject aktiv ist.
         // Beim Klicken auf "Ansehen" für Peer A, während Peer B angezeigt wird:
         // 1. currentlyViewingPeerId wird auf A gesetzt.
         // 2. updateRemoteScreenDisplay(A) wird aufgerufen.
         // 3. remoteScreenVideo.srcObject wird auf Stream von A gesetzt.
         // 4. Die Anzeige von B stoppt implizit.
         // 5. Der Button für B muss auf "Bildschirm ansehen" zurückgesetzt werden.

         // Zusätzliche Logik: Wenn auf "Ansehen" geklickt wird, während ein ANDERER Bildschirm angezeigt wird,
         // stoppe zuerst die Anzeige des ANDEREN.
          if (!isCurrentlyViewing && state.currentlyViewingPeerId !== null) {
              console.log(`[UI] Beginne Anzeige von Peer ${peerId}, stoppe vorher Anzeige von Peer ${state.currentlyViewingPeerId}.`);
              // Simuliere Klick auf "Anzeige stoppen" für den aktuell betrachteten Peer
              handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true); // forceStop = true
              // Dann fährt die Logik oben mit der Anzeige von peerId fort.
          }

    } // Ende handleViewScreenClick


    // Aktualisiert die Anzeige des geteilten Remote-Bildschirms
    // Zeigt den Stream des Peers an, dessen ID in state.currentlyViewingPeerId steht
    function updateRemoteScreenDisplay(peerIdToDisplay) {
         console.log(`[UI] updateRemoteScreenDisplay aufgerufen. Peer ID zum Anzeigen: ${peerIdToDisplay}. Aktueller betrachteter State: ${state.currentlyViewingPeerId}`);

         if (!UI.remoteScreenContainer || !UI.remoteScreenVideo || !UI.remoteScreenSharerName) {
             console.warn("[UI] updateRemoteScreenDisplay: Benötigte UI Elemente nicht gefunden.");
             // Setze den State zurück, falls UI fehlt
              state.currentlyViewingPeerId = null;
              // state.remoteScreenStream bleibt null/wird nicht mehr genutzt
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
             // state.remoteScreenStream wird nicht mehr im State gehalten

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
             // state.remoteScreenStream wird nicht mehr im State gehalten

         }
    }


    // ... (ensureRemoteAudioElementExists, removeRemoteAudioElement, toggleLocalAudioMute, updateLocalMuteButtonUI, toggleRemoteAudioMute bleiben gleich) ...

    // --- Init ---
    initializeUI();

});
