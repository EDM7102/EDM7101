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

    function initializeUI() {
        console.log("[UI] initializeUI aufgerufen. state.connected:", state.connected);
        if(UI.connectBtn) UI.connectBtn.classList.remove('hidden');
        if(UI.disconnectBtn) UI.disconnectBtn.classList.add('hidden');
        if(UI.shareScreenBtn) UI.shareScreenBtn.classList.add('hidden');
        if(UI.sendBtn) UI.sendBtn.disabled = true;
        if(UI.messageInput) UI.messageInput.disabled = true;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        loadStateFromLocalStorage();
        if (UI.micSelect) UI.micSelect.disabled = false;
        updateRemoteAudioControls();
        updateRemoteScreenDisplay(null);
        updateLocalMuteButtonUI(); // Ensure local mute button state is correct
        updateShareScreenButtonUI(); // Ensure share screen button state is correct
    }

    function updateUIAfterConnect() {
        console.log("[UI] updateUIAfterConnect aufgerufen.");
        state.connected = true;

        if(UI.connectBtn) UI.connectBtn.classList.add('hidden');
        if(UI.disconnectBtn) UI.disconnectBtn.classList.remove('hidden');
        if(UI.shareScreenBtn) UI.shareScreenBtn.classList.remove('hidden');
        if(UI.sendBtn) UI.sendBtn.disabled = false;
        if(UI.messageInput) UI.messageInput.disabled = false;
        if (UI.usernameInput) UI.usernameInput.disabled = true;
        if (UI.micSelect) UI.micSelect.disabled = true;
        setConnectionStatus('connected', `Verbunden als ${state.username}`);
        saveStateToLocalStorage();

        // Setup local audio stream only if not sharing screen
        if (!state.isSharingScreen) {
            setupLocalAudioStream();
        } else {
             // If already sharing, ensure its tracks are added to new PCs
             state.peerConnections.forEach(pc => {
                 addLocalStreamTracksToPeerConnection(pc, state.screenStream);
             });
        }

        populateMicList(); // Still populate list even if disabled, for display
        updateLocalMuteButtonUI(); // Show/hide/update button after connect
        updateShareScreenButtonUI(); // Show/hide/update button after connect
    }

    function updateUIAfterDisconnect() {
        console.log("[UI] updateUIAfterDisconnect aufgerufen.");
        state.connected = false;

        if(UI.connectBtn) UI.connectBtn.classList.remove('hidden');
        if(UI.disconnectBtn) UI.disconnectBtn.classList.add('hidden');
        if(UI.shareScreenBtn) UI.shareScreenBtn.classList.add('hidden');
        if(UI.sendBtn) UI.sendBtn.disabled = true;
        if(UI.messageInput) UI.messageInput.disabled = true;
        if (UI.usernameInput) UI.usernameInput.disabled = false;
        if (UI.micSelect) UI.micSelect.disabled = false;
        setConnectionStatus('disconnected', 'Nicht verbunden');
        if(UI.userList) UI.userList.innerHTML = '';
        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = '0';
        if(UI.typingIndicator) UI.typingIndicator.textContent = '';
        state.typingUsers.clear(); // Clear typing users on disconnect

        stopLocalAudioStream(); // Stop mic stream
        stopScreenSharing(false); // Stop screen stream without sending socket signal
        closeAllPeerConnections(); // Close all WebRTC connections

        updateRemoteAudioControls(); // Clear remote audio UI
        updateRemoteScreenDisplay(null); // Hide remote screen display

        // Reset state variables
        state.allUsersList = [];
        state.socketId = null;
        state.remoteStreams.clear();
        state.peerConnections.clear();
        state.remoteAudioElements.forEach(el => el.remove()); // Ensure audio elements are removed
        state.remoteAudioElements.clear();
        state.localAudioMuted = false; // Reset local mute state

        updateLocalMuteButtonUI(); // Hide local mute button
        updateShareScreenButtonUI(); // Hide share screen button

         // Clear messages container? Depends on desired behavior on disconnect.
         // UI.messagesContainer.innerHTML = '';
    }

    function saveStateToLocalStorage() {
        if (UI.usernameInput) {
            localStorage.setItem('chatClientUsername', UI.usernameInput.value);
        }
    }

    function loadStateFromLocalStorage() {
        const savedUsername = localStorage.getItem('chatClientUsername');
        if (savedUsername && UI.usernameInput) {
            UI.usernameInput.value = savedUsername;
        }
    }

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
             opt.style.color = 'var(--error-text-color)'; // Assuming you have this CSS variable
             UI.micSelect.appendChild(opt);
             if (UI.micSelect) UI.micSelect.disabled = true;
             const localMuteBtn = document.getElementById('localMuteBtn');
             if(localMuteBtn) localMuteBtn.disabled = true;
        }
    }

    function updateUserList(usersArrayFromServer) {
        // DIESE FUNKTION WIRD AUFGERUFEN, WENN DER CLIENT DAS 'user list'-EVENT VOM SERVER EMPFÄNGT.
        // Wenn dies passiert, wird die Liste aktualisiert.
        console.log("[UI] updateUserList aufgerufen mit", usersArrayFromServer.length, "Benutzern.");
        const oldUsers = state.allUsersList;
        state.allUsersList = usersArrayFromServer;

        const userCountPlaceholder = document.getElementById('userCountPlaceholder');
        if (userCountPlaceholder) userCountPlaceholder.textContent = usersArrayFromServer.length;

        const otherUsers = usersArrayFromServer.filter(user => user.id !== state.socketId);

        if(UI.userList) UI.userList.innerHTML = '';

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

                 // Ensure local mute button exists and update its state
                 let localMuteBtn = document.getElementById('localMuteBtn');
                 if (!localMuteBtn) {
                     localMuteBtn = document.createElement('button');
                     localMuteBtn.id = 'localMuteBtn';
                     localMuteBtn.textContent = 'Mikro stumm schalten';
                     localMuteBtn.classList.add('mute-btn');
                     localMuteBtn.classList.add('hidden'); // Start Hidden
                     // Find a good place to insert the button, e.g., near micSelect
                     const micSelectContainer = UI.micSelect ? UI.micSelect.closest('.input-group') : null; // Assuming micSelect is in a container
                     if(micSelectContainer) micSelectContainer.appendChild(localMuteBtn); // Append within the container
                      else if (UI.connectBtn && UI.connectBtn.parentNode) {
                          // Fallback if no specific container found
                          UI.connectBtn.parentNode.insertBefore(localMuteBtn, UI.connectBtn);
                      } else {
                           document.body.appendChild(localMuteBtn); // Last resort
                      }
                     localMuteBtn.addEventListener('click', toggleLocalAudioMute);
                 }
                 if (state.connected) {
                      localMuteBtn.classList.remove('hidden');
                      updateLocalMuteButtonUI();
                 } else {
                      localMuteBtn.classList.add('hidden');
                 }

                 // Ensure share screen button exists and update its state
                 if (UI.shareScreenBtn) {
                     if (state.connected) {
                         UI.shareScreenBtn.classList.remove('hidden');
                         updateShareScreenButtonUI();
                     } else {
                         UI.shareScreenBtn.classList.add('hidden');
                     }
                 }

            } else {
                nameContainer.appendChild(nameNode);

                if (user.sharingStatus) {
                     const sharingIndicator = document.createElement('span');
                     sharingIndicator.classList.add('sharing-indicator');
                     sharingIndicator.textContent = ' 🖥️';
                     sharingIndicator.title = `${escapeHTML(user.username)} teilt Bildschirm`;
                     nameContainer.appendChild(sharingIndicator);
                }

                // Check for new users joining (only if we had users before this update)
                 if (state.connected && oldUsers.length > 0 && !oldUsers.some(oldUser => oldUser.id === user.id)) {
                     console.log(`[UI] Neuer Benutzer beigetreten: ${user.username}`);
                     playNotificationSound();
                 }
            }

            li.appendChild(nameContainer);

            if (user.id !== state.socketId && user.sharingStatus) {
                 const viewButton = document.createElement('button');
                 viewButton.classList.add('view-screen-button');
                 viewButton.dataset.peerId = user.id;

                 const isViewingThisPeer = state.currentlyViewingPeerId === user.id;

                 if (isViewingThisPeer) {
                     viewButton.textContent = 'Anzeige stoppen';
                     viewButton.classList.add('stop');
                 } else {
                     viewButton.textContent = 'Bildschirm ansehen';
                     viewButton.classList.add('view');
                 }

                 viewButton.addEventListener('click', handleViewScreenClick);

                 li.appendChild(viewButton);
            }


            if(UI.userList) UI.userList.appendChild(li);
        });

         // Ensure peer connections and audio elements exist for all current remote users
         updatePeerConnections(otherUsers);
         updateRemoteAudioControls(otherUsers);

         if (UI.remoteAudioControls) {
              if (otherUsers.length > 0) {
                  UI.remoteAudioControls.classList.remove('hidden');
              } else {
                  UI.remoteAudioControls.classList.add('hidden');
              }
         }

         // Check if the currently viewed peer is still sharing or exists
          if (state.currentlyViewingPeerId) {
               const sharerUser = state.allUsersList.find(user => user.id === state.currentlyViewingPeerId);
               const sharerStillSharing = sharerUser && sharerUser.sharingStatus;

               if (!sharerStillSharing) {
                    console.log(`[UI] Aktuell betrachteter Sharer (${state.currentlyViewingPeerId}) teilt laut Userliste nicht mehr. Stoppe Anzeige.`);
                    // Use a temporary event object structure to simulate the call
                    handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true);
               } else {
                   // Ensure the correct button state for the currently viewed sharer
                   const viewingButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${state.currentlyViewingPeerId}']`);
                   if(viewingButton) {
                        viewingButton.textContent = 'Anzeige stoppen';
                        viewingButton.classList.remove('view');
                        viewingButton.classList.add('stop');
                        viewingButton.disabled = false; // Ensure button is enabled if user exists
                   }
                   // Disable other "Bildschirm ansehen" buttons while viewing one
                    state.allUsersList.forEach(user => {
                         if (user.id !== state.socketId && user.sharingStatus && user.id !== state.currentlyViewingPeerId) {
                            const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                            if (otherViewButton) otherViewButton.disabled = true;
                         }
                    });
               }
          } else {
               // If no one is being viewed, ensure all sharing buttons are enabled
               state.allUsersList.forEach(user => {
                    if (user.id !== state.socketId && user.sharingStatus) {
                        const viewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                        if(viewButton) viewButton.disabled = false;
                    }
               });
          }

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

    function updateRemoteAudioControls(remoteUsers = []) {
         if (!UI.remoteAudioControls) return;

         // Preserve current mute states
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
                 itemDiv.id = `remoteAudioItem_${user.id}`; // Add ID for easier removal

                 const nameSpan = document.createElement('span');
                 nameSpan.textContent = escapeHTML(user.username);
                 nameSpan.style.color = escapeHTML(user.color || getUserColor(user.id));
                 itemDiv.appendChild(nameSpan);

                 const muteBtn = document.createElement('button');
                 muteBtn.textContent = 'Stumm schalten';
                 muteBtn.classList.add('mute-btn');
                 muteBtn.dataset.peerId = user.id;
                 muteBtn.addEventListener('click', toggleRemoteAudioMute);

                 // Apply preserved mute state or default to unmuted
                 const isMuted = mutedStates.has(user.id) ? mutedStates.get(user.id) : false;
                 muteBtn.classList.toggle('muted', isMuted);
                 muteBtn.textContent = isMuted ? 'Stumm AN' : 'Stumm schalten';


                 itemDiv.appendChild(muteBtn);

                 UI.remoteAudioControls.appendChild(itemDiv);

                  // Ensure an audio element exists for this user and set its mute state
                  const audioElement = ensureRemoteAudioElementExists(user.id);
                  audioElement.muted = isMuted;
             });
         }

         // Remove audio elements for users who are no longer in the list
         Array.from(state.remoteAudioElements.keys()).forEach(peerId => {
             const userStillExists = remoteUsers.some(user => user.id === peerId);
             if (!userStillExists) {
                 removeRemoteAudioElement(peerId);
             }
         });
    }

    function updateRemoteScreenDisplay(peerIdToDisplay) {
         console.log(`[UI] updateRemoteScreenDisplay aufgerufen. Peer ID zum Anzeigen: ${peerIdToDisplay}. Aktueller betrachteter State: ${state.currentlyViewingPeerId}`);

         if (!UI.remoteScreenContainer || !UI.remoteScreenVideo || !UI.remoteScreenSharerName) {
             console.warn("[UI] updateRemoteScreenDisplay: Benötigte UI Elemente nicht gefunden.");
              state.currentlyViewingPeerId = null;
              if (UI.remoteScreenVideo && UI.remoteScreenVideo.srcObject) UI.remoteScreenVideo.srcObject = null;
             if (UI.remoteScreenContainer) UI.remoteScreenContainer.classList.add('hidden');
             if (UI.remoteScreenSharerName) UI.remoteScreenSharerName.textContent = '';
             if (document.fullscreenElement) document.exitFullscreen(); // Exit fullscreen if element is removed

             return;
         }

         const sharerUser = state.allUsersList.find(user => user.id === peerIdToDisplay);
         const sharerStream = state.remoteStreams.get(peerIdToDisplay);

         // A stream must exist AND have a video track to be displayable
         const canDisplay = sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0;


         if (canDisplay) {
             console.log(`[UI] Zeige geteilten Bildschirm von ${sharerUser.username} (${peerIdToDisplay}).`);

             UI.remoteScreenVideo.srcObject = sharerStream;
             // Ensure video plays silently if audio is handled by remoteAudioElements
             UI.remoteScreenVideo.muted = true; // Mute video element, audio is handled by separate audio element
             UI.remoteScreenVideo.play().catch(e => console.error("[UI] Fehler beim Abspielen des Remote-Bildschirms:", e));

             UI.remoteScreenSharerName.textContent = escapeHTML(sharerUser.username);
             UI.remoteScreenContainer.classList.remove('hidden');

             state.currentlyViewingPeerId = peerIdToDisplay;

         } else {
             console.log("[UI] Keine Bildschirmteilung zum Anzeigen oder Peer teilt nicht mehr/Stream nicht verfügbar.");

             if (UI.remoteScreenVideo.srcObject) {
                 UI.remoteScreenVideo.srcObject = null;
                 console.log("[UI] Wiedergabe des Remote-Bildschirms gestoppt.");
             }

             UI.remoteScreenContainer.classList.add('hidden');
             UI.remoteScreenSharerName.textContent = '';

             state.currentlyViewingPeerId = null;

             // Exit fullscreen if the displayed screen is no longer available
              if (document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement))) {
                   document.exitFullscreen();
              }
         }
    }


    function ensureRemoteAudioElementExists(peerId) {
        let audioElement = state.remoteAudioElements.get(peerId);
        if (!audioElement) {
             console.log(`[WebRTC] Erstelle neues Audio-Element für Peer ${peerId}.`);
             audioElement = new Audio();
             audioElement.autoplay = true;
             audioElement.style.display = 'none';
             // Add the audio element to a container or body where it won't affect layout
             document.body.appendChild(audioElement); // Add to body

             state.remoteAudioElements.set(peerId, audioElement);
              console.log(`[WebRTC] Audio-Element für Peer ${peerId} erstellt und hinzugefügt.`);

             // Initial mute state based on the UI control if it exists, otherwise default to unmuted
             const muteButton = UI.remoteAudioControls ? UI.remoteAudioControls.querySelector(`.mute-btn[data-peer-id='${peerId}']`) : null;
             if (muteButton) {
                 audioElement.muted = muteButton.classList.contains('muted');
             } else {
                  // Default to unmuted if no control exists yet
                  audioElement.muted = false;
             }
        }
         return audioElement;
    }

    function removeRemoteAudioElement(peerId) {
         const audioElement = state.remoteAudioElements.get(peerId);
         if (audioElement) {
             console.log(`[WebRTC] Entferne Audio-Element für Peer ${peerId}.`);
             audioElement.pause();
             audioElement.srcObject = null; // Remove stream reference
             audioElement.remove(); // Remove from DOM
             state.remoteAudioElements.delete(peerId);
             console.log(`[WebRTC] Audio-Element für Peer ${peerId} entfernt.`);
         }
         // Also remove the corresponding UI control item
         const itemDiv = document.getElementById(`remoteAudioItem_${peerId}`);
         if (itemDiv) {
             itemDiv.remove();
         }
    }

    function toggleLocalAudioMute() {
         if (!state.localAudioStream) {
             console.warn("[WebRTC] toggleLocalAudioMute: Lokaler Audio-Stream nicht verfügbar.");
             return;
         }
         state.localAudioMuted = !state.localAudioMuted;
         console.log(`[WebRTC] Lokales Mikrofon: ${state.localAudioMuted ? 'Stumm' : 'Aktiv'}`);

         state.localAudioStream.getAudioTracks().forEach(track => {
             track.enabled = !state.localAudioMuted;
             console.log(`[WebRTC] Lokaler Audio Track ${track.id} enabled: ${track.enabled}`);
         });

         updateLocalMuteButtonUI();
    }

     function updateLocalMuteButtonUI() {
         const localMuteBtn = document.getElementById('localMuteBtn');
         if (localMuteBtn) {
             localMuteBtn.textContent = state.localAudioMuted ? 'Mikro Stumm AN' : 'Mikro stumm schalten';
             localMuteBtn.classList.toggle('muted', state.localAudioMuted);
             // Disable if not connected or if screen sharing is active (mic stream isn't used)
             localMuteBtn.disabled = !state.connected || state.isSharingScreen || !state.localAudioStream;
             localMuteBtn.classList.toggle('disabled', localMuteBtn.disabled); // Add a class for styling disabled state
         }
     }

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

    async function setupLocalAudioStream() {
        console.log("[WebRTC] setupLocalAudioStream aufgerufen.");
        if (state.localAudioStream) {
            console.log("[WebRTC] Beende alten lokalen Audio-Stream.");
            state.localAudioStream.getTracks().forEach(track => track.stop());
            state.localAudioStream = null;
        }

        // Do not start mic if screen is already being shared
        if (state.isSharingScreen) {
             console.log("[WebRTC] setupLocalAudioStream: Bildschirmteilung aktiv, überspringe Mikrofon-Setup.");
             // Ensure screen stream tracks are added to existing PCs if they weren't already
              state.peerConnections.forEach(pc => {
                   // Important: Pass the screen stream here if screen sharing is active
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream);
              });
             updateLocalMuteButtonUI(); // Update button state (should be disabled)
             return true;
        }


        try {
            const selectedMicId = UI.micSelect ? UI.micSelect.value : undefined;
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                deviceId: selectedMicId ? { exact: selectedMicId } : undefined
            };
            console.log("[WebRTC] Versuche, lokalen Audio-Stream (Mikrofon) zu holen mit Constraints:", audioConstraints);

            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints
            });
            state.localAudioStream = stream;
            state.localAudioMuted = false; // Reset mute state on new stream
            console.log(`[WebRTC] Lokaler Audio-Stream (Mikrofon) erhalten: ${stream.id}. Tracks: Audio: ${stream.getAudioTracks().length}`);

             // Add tracks to existing peer connections
             state.peerConnections.forEach(pc => {
                 addLocalStreamTracksToPeerConnection(pc, state.localAudioStream);
             });

             updateLocalMuteButtonUI(); // Enable and update button state


            return true;
        } catch (err) {
            console.error('[WebRTC] Fehler beim Zugriff auf das Mikrofon:', err.name, err.message);
             let errorMessage = `Mikrofonzugriff fehlgeschlagen: ${err.message}.`;
             if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                 errorMessage = "Mikrofonzugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.";
             }
             displayError(errorMessage);

             if (UI.micSelect) UI.micSelect.disabled = true;
             state.localAudioStream = null; // Ensure stream state is null
             updateLocalMuteButtonUI(); // Disable the mute button

             // Remove any previous audio tracks from PeerConnections if stream failed
              state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, null); // Add null stream to remove existing tracks
              });


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

             // Remove audio tracks from all peer connections
              state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, null); // Pass null to signal track removal
              });

         } else {
             console.log("[WebRTC] Kein lokaler Audio-Stream zum Stoppen.");
         }
         state.localAudioMuted = false; // Reset mute state
         updateLocalMuteButtonUI(); // Update button state (should be hidden/disabled)
    }

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
             // Prefer getting system audio with screen if possible (browser dependent)
             const stream = await navigator.mediaDevices.getDisplayMedia({
                 video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
                 audio: true // Request system audio with screen
             });
             state.screenStream = stream;
             state.isSharingScreen = true;
             console.log(`[WebRTC] Bildschirmstream erhalten: ${stream.id}. Tracks: Video: ${stream.getVideoTracks().length}, Audio: ${stream.getAudioTracks().length}`);

             const screenAudioTrack = stream.getAudioTracks()[0];
             if (screenAudioTrack) {
                  console.log("[WebRTC] Bildschirmstream hat Audio. Stoppe lokalen Mikrofonstream.");
                  stopLocalAudioStream(); // Stop microphone if screen stream has audio
             } else {
                  console.log("[WebRTC] Bildschirmstream hat kein Audio. Lokales Mikrofon bleibt/ist inaktiv.");
                  // If screen has no audio, ensure mic is stopped anyway, as we are now sharing screen
                  stopLocalAudioStream();
             }

             // Replace tracks in existing peer connections with screen stream tracks
             state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, state.screenStream);
             });

             const screenVideoTrack = stream.getVideoTracks()[0];
             if (screenVideoTrack) {
                  screenVideoTrack.onended = () => {
                      console.log("[WebRTC] Bildschirmteilung beendet durch Browser UI.");
                      // If the user stops sharing via the browser's native UI, toggle state
                      if (state.isSharingScreen) {
                          toggleScreenSharing();
                      }
                  };
                  console.log("[WebRTC] onended Listener für Screen Video Track hinzugefügt.");
             } else {
                  console.warn("[WebRTC] Kein Screen Video Track gefunden, onended Listener konnte nicht hinzugefügt werden.");
             }

              // Client sendet Statusänderung AN DEN SERVER
              if (socket && state.connected) {
                 socket.emit('screenShareStatus', { sharing: true });
                 console.log("[Socket.IO] Sende 'screenShareStatus: true'.");
             }


             updateShareScreenButtonUI(); // Update button text and class
             updateLocalMuteButtonUI(); // Update mute button state (should be disabled)

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

             // Attempt to restart local audio stream if screen sharing failed
             setupLocalAudioStream();

              // Client sendet Statusänderung AN DEN SERVER
              if (socket && state.connected) {
                 socket.emit('screenShareStatus', { sharing: false });
             }

             updateShareScreenButtonUI(); // Update button text and class
             updateLocalMuteButtonUI(); // Update mute button state

             return false;
        }
    }

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

             // Remove screen tracks from all peer connections
              state.peerConnections.forEach(pc => {
                  addLocalStreamTracksToPeerConnection(pc, null); // Pass null to remove all tracks
              });

         } else {
              console.log("[WebRTC] stopScreenSharing: screenStream war bereits null.");
         }

         state.isSharingScreen = false;
         console.log("[WebRTC] isSharingScreen ist jetzt false.");

         // Attempt to restart local audio stream after stopping screen sharing
         setupLocalAudioStream();

         // Client sendet Statusänderung AN DEN SERVER
         if (sendSignal && socket && state.connected) {
             socket.emit('screenShareStatus', { sharing: false });
             console.log("[Socket.IO] Sende 'screenShareStatus: false'.");
         }

         updateShareScreenButtonUI(); // Update button text and class
         updateLocalMuteButtonUI(); // Update mute button state

    }

    async function toggleScreenSharing() {
         console.log(`[WebRTC] toggleScreenSharing aufgerufen. Aktueller State isSharingScreen: ${state.isSharingScreen}`);
         if (!state.connected || !UI.shareScreenBtn) {
              console.warn("[WebRTC] Nicht verbunden oder Button nicht gefunden.");
              return;
         }

         UI.shareScreenBtn.disabled = true; // Disable button during the process

         if (state.isSharingScreen) {
             stopScreenSharing(true);
         } else {
             await startScreenSharing();
         }

         UI.shareScreenBtn.disabled = false; // Re-enable button
    }

     function updateShareScreenButtonUI() {
         if (UI.shareScreenBtn) {
             UI.shareScreenBtn.textContent = state.isSharingScreen ? 'Teilen beenden' : '🖥 Bildschirm teilen';
             UI.shareScreenBtn.classList.toggle('active', state.isSharingScreen);
             // Disable if not connected
             UI.shareScreenBtn.disabled = !state.connected;
             UI.shareScreenBtn.classList.toggle('disabled', UI.shareScreenBtn.disabled); // Add a class for styling disabled state
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
                 console.log(`[WebRTC] Sende ICE candidate für Peer ${peerId}:`, event.candidate);
                 // Client sendet ICE Candidate AN DEN SERVER, damit dieser es an den anderen Peer schickt
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

             // Get the associated MediaStream
             // The event.streams array can contain multiple streams, but for simplicity,
             // we'll typically get one stream per addTrack call from the remote side.
             // Let's associate tracks with a single stream per peer for this application.
             let remoteStream = state.remoteStreams.get(peerId);
             if (!remoteStream) {
                 console.log(`[WebRTC] Erstelle neuen remoteStream für Peer ${peerId}.`);
                 remoteStream = new MediaStream();
                 state.remoteStreams.set(peerId, remoteStream);
             }

             // Add the track to the remote stream if it's not already there
             if (!remoteStream.getTrackById(event.track.id)) {
                 console.log(`[WebRTC] Füge Track ${event.track.id} (${event.track.kind}) zu remoteStream für Peer ${peerId} hinzu.`);
                 remoteStream.addTrack(event.track);
             } else {
                  console.log(`[WebRTC] Track ${event.track.id} (${event.track.kind}) ist bereits in remoteStream für Peer ${peerId}.`);
             }


            if (event.track.kind === 'audio') {
                 console.log(`[WebRTC] Track ${event.track.id} ist Audio.`);
                 // Ensure the remote audio element exists and assign the stream
                 const audioElement = ensureRemoteAudioElementExists(peerId);
                 // Assign the stream containing the audio track
                 // If the stream contains multiple tracks, assign the whole stream
                 // This allows the audio element to play all audio tracks in that stream
                 audioElement.srcObject = remoteStream;
                 audioElement.play().catch(e => console.warn(`[WebRTC] Fehler beim Abspielen von Remote Audio für Peer ${peerId}:`, e));

                 event.track.onended = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} beendet.`);
                 event.track.onmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.onunmute = () => console.log(`[WebRTC] Remote Audio Track ${event.track.id} von Peer ${peerId} entmutet.`);


            } else if (event.track.kind === 'video') {
                 console.log(`[WebRTC] Track ${event.track.id} ist Video. Von Peer ${peerId}.`);

                 // If this peer is currently being viewed, update the video element's source
                 if (state.currentlyViewingPeerId === peerId) {
                     console.log(`[WebRTC] Erhaltener Video Track von aktuell betrachtetem Peer ${peerId}. Aktualisiere Anzeige.`);
                     updateRemoteScreenDisplay(peerId);
                 }

                 event.track.onended = () => {
                     console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} beendet.`);
                     // Check if the stream still has video tracks
                     const remoteStreamForPeer = state.remoteStreams.get(peerId);
                     if (remoteStreamForPeer && remoteStreamForPeer.getVideoTracks().length === 0) {
                         console.log(`[WebRTC] Peer ${peerId} sendet keine Video-Tracks mehr. Aktualisiere Bildschirmanzeige.`);
                          // If the peer being viewed stops sending video, stop viewing
                          if (state.currentlyViewingPeerId === peerId) {
                               console.log(`[WebRTC] Der Peer (${peerId}), dessen Bildschirm ich ansehe, sendet keine Video-Tracks mehr. Stoppe Anzeige.`);
                               // Simulate click on the stop button
                               handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
                          }
                     }
                 };

                 event.track.onmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} gemutet.`);
                 event.track.onunmute = () => console.log(`[WebRTC] Remote Video Track ${event.track.id} von Peer ${peerId} entmutet.`);
            }

             // Handle track removal from the stream (less common, but good practice)
             // Note: This might not fire reliably in all scenarios.
             // A better approach for tracking active tracks might involve SDP negotiation or senders/receivers.
             // For this example, we rely more on `ontrack` adding and checking stream tracks.
             // The onremovetrack event is on the MediaStream, not RTCPeerConnection.
             // Attach this listener when the remoteStream is created or updated.
             remoteStream.onremovetrack = (event) => {
                  console.log(`[WebRTC] Track ${event.track.id} von Peer ${peerId} aus Stream entfernt.`);
                  // Check if the stream is now empty or has no relevant tracks
                   if (remoteStream.getTracks().length === 0) {
                       console.log(`[WebRTC] Stream von Peer ${peerId} hat keine Tracks mehr. Entferne Stream aus Map.`);
                       state.remoteStreams.delete(peerId);
                       // If the currently viewed peer's stream becomes empty, stop viewing
                        if (state.currentlyViewingPeerId === peerId) {
                            console.log(`[WebRTC] Aktuell betrachteter Peer (${peerId}) hat keine Tracks mehr im Stream. Stoppe Anzeige.`);
                            handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
                        }
                   } else {
                       // If a video track was removed from the stream of the currently viewed peer, update display
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
                     // Handle potential reconnections or failures here
                     break;
                 case "failed":
                     console.error(`[WebRTC] ICE 'failed': Verbindung zu Peer '${peerUsername}' fehlgeschlagen.`);
                      closePeerConnection(peerId); // Close connection on failure
                     break;
                 case "closed":
                     console.log(`[WebRTC] ICE 'closed': Verbindung zu Peer '${peerUsername}' wurde geschlossen.`);
                      closePeerConnection(peerId); // Ensure resources are released
                     break;
             }
        };

        pc.onsignalingstatechange = () => {
             if (!pc) return;
            const pcState = pc.signalingState;
             const peerUser = state.allUsersList.find(u => u.id === peerId);
             const peerUsername = peerUser ? peerUser.username : peerId;
            console.log(`[WebRTC] Signaling State zu Peer '${peerUsername}' (${peerId}) geändert zu: ${pcState}`);
             // Handle signaling state changes if needed (e.g., waiting for offer/answer)
        };

        pc.onnegotiationneeded = async () => {
             console.log(`[WebRTC] onnegotiationneeded Event für Peer ${peerId} ausgelöst.`);
             // Simple "polite" implementation to avoid offer/answer collisions (glare)
             // The client with the lower socket ID is "polite" and defers to the other.
             const isPolite = state.socketId < peerId;

             // Only create offer if in a stable state or if we are "impolite" and received an offer
             if (pc.signalingState === 'stable' || (pc.signalingState === 'have-remote-offer' && !isPolite)) {

                 if (pc.signalingState === 'have-remote-offer' && isPolite) {
                      console.log(`[WebRTC] Peer ${peerId}: Glare Situation (have-remote-offer, Polite). Warte auf eingehendes Offer.`);
                      // Polite peer in glare waits for the impolite peer's offer
                      return;
                 }

                 console.log(`[WebRTC] Peer ${peerId}: Erstelle Offer. Signaling State: ${pc.signalingState}. Bin Polite? ${isPolite}.`);
                 try {
                     const offer = await pc.createOffer();
                     console.log(`[WebRTC] Peer ${peerId}: Offer erstellt. Setze Local Description.`);
                     await pc.setLocalDescription(offer);
                     console.log(`[WebRTC] Peer ${peerId}: Local Description (Offer) gesetzt. Sende Offer an Server.`);

                      // Client sendet Offer AN DEN SERVER, damit dieser es an den anderen Peer schickt
                      if (socket && state.connected) {
                           socket.emit('webRTC-signal', {
                               to: peerId,
                               type: 'offer',
                               payload: pc.localDescription
                           });
                           console.log(`[Socket.IO] Sende 'webRTC-signal' (offer) an Peer ${peerId}.`);
                       } else {
                           console.warn(`[WebRTC] Cannot send offer to Peer ${peerId}. Socket not connected.`);
                       }

                 } catch (err) {
                     console.error(`[WebRTC] Peer ${peerId}: Fehler bei Offer Erstellung oder Setzung:`, err);
                     displayError(`Fehler bei Audio/Video-Verhandlung (Offer) mit Peer ${peerId}.`);
                     closePeerConnection(peerId); // Close connection on error
                 }
             } else {
                  console.log(`[WebRTC] Peer ${peerId}: Signaling State (${pc.signalingState}) erlaubt keine Offer Erstellung. Warte.`);
             }
        };


        console.log(`[WebRTC] PeerConnection Objekt für Peer ${peerId} erstellt.`);
        return pc;
    }

    function addLocalStreamTracksToPeerConnection(pc, streamToAdd) {
         console.log(`[WebRTC] addLocalStreamTracksToPeerConnection aufgerufen für PC. Stream ID: ${streamToAdd ? streamToAdd.id : 'null'}.`);
         if (!pc) {
             console.warn("[WebRTC] addLocalStreamTracksToPeerConnection: PeerConnection ist null.");
             return;
         }

         const senders = pc.getSenders();
         const tracksToAdd = streamToAdd ? streamToAdd.getTracks() : [];

         console.log(`[WebRTC] PC hat ${senders.length} Sender. Stream hat ${tracksToAdd.length} Tracks.`);

         // Add or replace tracks
         tracksToAdd.forEach(track => {
             const existingSender = senders.find(s => s.track && s.track.kind === track.kind);

             if (existingSender) {
                 // If a sender for this track kind exists, replace the track
                 if (existingSender.track !== track) {
                      console.log(`[WebRTC] Ersetze Track ${track.kind} im Sender (${existingSender.track?.id || 'none'}) durch Track ${track.id}.`);
                      existingSender.replaceTrack(track).catch(e => {
                          console.error(`[WebRTC] Fehler beim Ersetzen des Tracks ${track.kind}:`, e);
                      });
                 } else {
                      console.log(`[WebRTC] Track ${track.kind} (${track.id}) ist bereits im Sender. Kein Ersetzen nötig.`);
                 }
             } else {
                 // If no sender for this track kind exists, add a new track
                 console.log(`[WebRTC] Füge neuen Track ${track.kind} (${track.id}) hinzu.`);
                 // Add the track with the original stream (important for grouping)
                 pc.addTrack(track, streamToAdd);
             }
         });

         // Remove senders whose tracks are no longer in the current stream
         senders.forEach(sender => {
             if (sender.track && !tracksToAdd.some(track => track.id === sender.track.id)) {
                 const trackKind = sender.track.kind;
                 console.log(`[WebRTC] Entferne Sender für Track ${sender.track.id} (${trackKind}), da er nicht mehr im aktuellen Stream ist.`);
                 pc.removeTrack(sender);
             } else if (!sender.track) {
                  console.warn("[WebRTC] Sender ohne Track gefunden. Dies sollte nicht passieren.");
                  // Potentially remove senders without tracks if necessary
                  // pc.removeTrack(sender); // Be cautious with this, might cause issues
             }
         });

         console.log("[WebRTC] Tracks in PC aktualisiert.");
          // Trigger renegotiation after adding/removing tracks if needed
          // The `onnegotiationneeded` event should handle this automatically
     }


    function updatePeerConnections(currentRemoteUsers) {
         console.log(`[WebRTC] updatePeerConnections aufgerufen. Aktuelle Remote User: ${currentRemoteUsers.length}. Bestehende PCs: ${state.peerConnections.size}`);

         // Close PeerConnections for users who have left
         Array.from(state.peerConnections.keys()).forEach(peerId => {
             const peerStillExists = currentRemoteUsers.some(user => user.id === peerId);
             if (!peerStillExists) {
                 console.log(`[WebRTC] Peer ${peerId} nicht mehr in Userliste. Schließe PeerConnection.`);
                 closePeerConnection(peerId);
             }
         });

         // Create PeerConnections for new users and update tracks for existing ones
         currentRemoteUsers.forEach(async user => {
             let pc = state.peerConnections.get(user.id);

             if (!pc) {
                 console.log(`[WebRTC] Neuer Peer ${user.username} (${user.id}) gefunden. Erstelle PeerConnection.`);
                 pc = await createPeerConnection(user.id);

                 // Determine the current local stream (mic or screen)
                 const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                 if (currentLocalStream) {
                      console.log(`[WebRTC] Füge Tracks vom aktuellen lokalen Stream (${currentLocalStream.id || 'none'}) zur neuen PC (${user.id}) hinzu.`);
                     addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                 } else {
                      console.log(`[WebRTC] Kein lokaler Stream zum Hinzufügen zur neuen PC (${user.id}).`);
                      // Even if no stream, call to ensure no old tracks remain if somehow present
                      addLocalStreamTracksToPeerConnection(pc, null);
                 }

                  // Initiate offer if we are the "impolite" peer (lower socket ID)
                  // The `onnegotiationneeded` handler will take care of creating the offer
                  // if this is the initiating side (impolite).
                  // If we are polite, we wait for their offer.
                 console.log(`[WebRTC] Initialisierung für Peer ${user.id} abgeschlossen. Negotiation will follow.`);

             } else {
                  console.log(`[WebRTC] Peer ${user.id} existiert. Überprüfe/aktualisiere Tracks.`);
                  // Ensure existing PCs have the current local stream tracks
                  const currentLocalStream = state.isSharingScreen ? state.screenStream : state.localAudioStream;
                   if (currentLocalStream) {
                       addLocalStreamTracksToPeerConnection(pc, currentLocalStream);
                   } else {
                        // If no local stream is active, ensure no local tracks are being sent
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
             // Stop all sending tracks associated with this peer connection
             pc.getSenders().forEach(sender => {
                 if (sender.track) {
                      // Note: stopping the track here would stop it locally for ALL PCs
                      // We should only remove the sender from THIS peer connection
                      pc.removeTrack(sender);
                 }
             });

            pc.close(); // Close the underlying RTCPeerConnection
            state.peerConnections.delete(peerId);
             console.log(`[WebRTC] PeerConnection mit ${peerId} gelöscht.`);
        } else {
             console.log(`[WebRTC] Keine PeerConnection mit ${peerId} zum Schließen gefunden.`);
        }

         // Remove associated remote audio element
         removeRemoteAudioElement(peerId);

         // Remove the associated remote stream
         if (state.remoteStreams.has(peerId)) {
              console.log(`[WebRTC] Entferne remoteStream für Peer ${peerId}.`);
              const streamToRemove = state.remoteStreams.get(peerId);
              // Stopping tracks on the remote stream here might be redundant if the PC is closed,
              // but ensures cleanup. However, it might affect other parts if the same stream
              // is accidentally associated with multiple PCs (shouldn't happen in this setup).
              // Let's rely on PC closure and garbage collection for remote tracks.
              // streamToRemove.getTracks().forEach(track => track.stop()); // Commented out for caution
              state.remoteStreams.delete(peerId);
         }

         // If the closed peer was the one being viewed, stop the display
         if (state.currentlyViewingPeerId === peerId) {
              console.log(`[WebRTC] Geschlossener Peer ${peerId} wurde betrachtet. Stoppe Anzeige.`);
              // Simulate a force stop event
              handleViewScreenClick({ target: { dataset: { peerId: peerId } } }, true);
         }

         // Update the user list to reflect the user leaving (this is triggered by socket 'user list' update anyway)
         // The updatePeerConnections in updateUserList will handle closing PCs for removed users.
    }

    function closeAllPeerConnections() {
        console.log("[WebRTC] closeAllPeerConnections aufgerufen.");
         // Iterate over a copy of keys because the map is modified in the loop
        Array.from(state.peerConnections.keys()).forEach(peerId => {
            closePeerConnection(peerId);
        });
         state.peerConnections.clear(); // Ensure map is empty
         console.log("[WebRTC] Alle PeerConnections geschlossen.");

         // Stop all remote streams and clear the map
         state.remoteStreams.forEach(stream => {
              console.log(`[WebRTC] Stoppe tracks in remote stream ${stream.id}.`);
              stream.getTracks().forEach(track => track.stop());
         });
         state.remoteStreams.clear();
          console.log("[WebRTC] Alle empfangenen Streams gestoppt and gelöscht.");

         // Remove all remote audio elements
          state.remoteAudioElements.forEach(el => el.remove());
          state.remoteAudioElements.clear();
          console.log("[WebRTC] Alle remote Audio-Elemente entfernt.");


         // Hide the remote screen display
         updateRemoteScreenDisplay(null);
    }


    function sendMessage() {
        console.log("sendMessage() aufgerufen.");
        const content = UI.messageInput ? UI.messageInput.value.trim() : ''; // Check if messageInput exists
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
         // Client sendet die Nachricht AN DEN SERVER (Server muss auf 'message' lauschen und sie weiterleiten)
         if (socket) { // Ensure socket exists before emitting
            socket.emit('message', message);
         }


        if (UI.messageInput) {
             UI.messageInput.value = '';
             // Reset textarea height if using auto-resize
             if (UI.messageInput.style.height) {
                 UI.messageInput.style.height = 'auto';
             }
             UI.messageInput.focus();
        }
        sendTyping(false); // Stop typing indicator after sending message
    }

    function appendMessage(msg) {
         // DIESE FUNKTION WIRD AUFGERUFEN, WENN DER CLIENT DAS 'message'-EVENT VOM SERVER EMPFÄNGT.
         // Wenn dies nicht passiert (wie in deinen Logs), werden keine Nachrichten angezeigt.
         console.log("[UI] appendMessage aufgerufen:", msg); // Füge Log hinzu
         if (!msg || msg.content === undefined || msg.id === undefined || msg.username === undefined || !UI.messagesContainer) {
             console.warn("appendMessage: Ungültige Nachrichtendaten oder Nachrichtencontainer nicht gefunden.", msg);
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
        // Use innerText for simple text to preserve line breaks from textarea,
        // or innerHTML with careful escaping if allowing rich content (not in this example).
        // For this example, assuming plain text, textContent is safer.
        contentDiv.textContent = escapeHTML(msg.content);

        msgDiv.appendChild(nameSpan);
        msgDiv.appendChild(contentDiv);

        UI.messagesContainer.appendChild(msgDiv);

        // Auto-scroll to bottom unless user has scrolled up
        const isScrolledToBottom = UI.messagesContainer.scrollHeight - UI.messagesContainer.clientHeight <= UI.messagesContainer.scrollTop + 50; // Add a small tolerance
        if (isMe || isScrolledToBottom) {
            UI.messagesContainer.scrollTop = UI.messagesContainer.scrollHeight;
        }
    }

    function sendTyping(isTyping = true) {
         if (!socket || !state.connected || (UI.messageInput && UI.messageInput.disabled)) {
              return;
         }

         // Clear any existing timeout to prevent sending 'false' too early
         clearTimeout(state.typingTimeout);

          // Client sendet Typing-Status AN DEN SERVER (Server muss auf 'typing' lauschen und es weiterleiten)
          if (socket) { // Ensure socket exists before emitting
              socket.emit('typing', { isTyping });
          }

         if (isTyping) {
              // Set a timeout to send 'isTyping: false' after a delay
              state.typingTimeout = setTimeout(() => {
                  if (socket && state.connected) { // Check connection state again before sending
                       socket.emit('typing', { isTyping: false });
                       console.log("[Socket.IO] Sende 'typing: false' nach Timeout.");
                  }
              }, CONFIG.TYPING_TIMER_LENGTH);
         }
    }

    function handleViewScreenClick(event, forceStop = false) {
         console.log(`[UI] handleViewScreenClick aufgerufen. forceStop: ${forceStop}`);
         const clickedButton = event.target;
         const peerId = clickedButton ? clickedButton.dataset.peerId : null; // Check if clickedButton exists

         if (!peerId) {
             console.error("[UI] handleViewScreenClick: Keine Peer ID im Dataset gefunden.");
             return;
         }

         const isCurrentlyViewing = state.currentlyViewingPeerId === peerId;

         // Scenario 1: Clicking "Stop Viewing" or forced stop for the currently viewed peer
         if (isCurrentlyViewing && (!event.target.classList.contains('view') || forceStop)) {
             console.log(`[UI] Klick auf "Anzeige stoppen" oder forceStop für Peer ${peerId}.`);
             updateRemoteScreenDisplay(null); // Hide the remote screen display

              // Re-enable all "View Screen" buttons for other sharers
              state.allUsersList.forEach(user => {
                   if (user.id !== state.socketId && user.sharingStatus) {
                       const sharerButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                       if (sharerButton) sharerButton.disabled = false;
                   }
              });

             // Update the button state for the peer that was being viewed
              const wasViewingButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${peerId}']`);
              if(wasViewingButton) {
                  wasViewingButton.textContent = 'Bildschirm ansehen';
                  wasViewingButton.classList.remove('stop');
                  wasViewingButton.classList.add('view');
                  wasViewingButton.disabled = false; // Ensure it's enabled after stopping view
              }


         // Scenario 2: Clicking "View Screen" for a peer that is not currently being viewed
         } else if (!isCurrentlyViewing && event.target.classList.contains('view')) {
             console.log(`[UI] Klick auf "Bildschirm ansehen" für Peer ${peerId}.`);

             const sharerUser = state.allUsersList.find(user => user.id === peerId && user.sharingStatus);
             const sharerStream = state.remoteStreams.get(peerId);

             // Check if the peer is actually sharing and has a video stream
             if (sharerUser && sharerStream && sharerStream.getVideoTracks().length > 0) {
                  console.log(`[UI] Peer ${peerId} teilt und Stream ist verfügbar. Zeige Bildschirm an.`);

                  // If we are currently viewing another peer, stop that view first
                  if (state.currentlyViewingPeerId !== null && state.currentlyViewingPeerId !== peerId) {
                       console.log(`[UI] Stoppe vorherige Anzeige von Peer ${state.currentlyViewingPeerId}.`);
                       // Simulate click on the stop button for the previously viewed peer
                       handleViewScreenClick({ target: { dataset: { peerId: state.currentlyViewingPeerId } } }, true);
                  }

                 // Update the remote screen display to show this peer's stream
                 updateRemoteScreenDisplay(peerId);

                 // Disable other "View Screen" buttons while viewing one
                  state.allUsersList.forEach(user => {
                       if (user.id !== state.socketId && user.sharingStatus && user.id !== peerId) {
                           const otherViewButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${user.id}']`);
                           if (otherViewButton) otherViewButton.disabled = true;
                       }
                  });

                 // Update the clicked button's text and class
                  clickedButton.textContent = 'Anzeige stoppen';
                  clickedButton.classList.remove('view');
                  clickedButton.classList.add('stop');


             } else {
                 console.warn(`[UI] Peer ${peerId} teilt nicht oder Stream nicht verfügbar. Kann Bildschirm nicht ansehen.`);
                 displayError(`Bildschirm von ${sharerUser ? escapeHTML(sharerUser.username) : 'diesem Benutzer'} kann nicht angesehen werden.`);
                 // Ensure the remote screen display is hidden if it was somehow showing an invalid state
                 updateRemoteScreenDisplay(null);
             }
          // Scenario 3: Clicking the "Stop Viewing" button while not actually viewing (shouldn't happen with correct logic, but good for safety)
          } else if (!isCurrentlyViewing && event.target.classList.contains('stop')) {
               console.warn(`[UI] Klick auf "Anzeige stoppen" für Peer ${peerId}, aber ich sehe ihn nicht an. Aktualisiere Button.`);
                // Correct the button state
               const incorrectStopButton = document.querySelector(`#userList li .view-screen-button[data-peer-id='${peerId}']`);
               if(incorrectStopButton) {
                   incorrectStopButton.textContent = 'Bildschirm ansehen';
                   incorrectStopButton.classList.remove('stop');
                   incorrectStopButton.classList.add('view');
                   incorrectStopButton.disabled = false; // Ensure it's enabled
               }
          }
    }

     function toggleFullscreen(element) {
         if (!element) {
              console.warn("[UI] toggleFullscreen: Element nicht gefunden.");
              return;
         }
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
         socket.on('joinSuccess', (data) => {
             console.log("[Socket.IO] joinSuccess empfangen:", data);
             state.socketId = data.id; // Eigene Socket ID vom Server erhalten
             // Die Benutzerliste wird direkt nach 'joinSuccess' mit dem Event 'user list' gesendet
             updateUIAfterConnect(); // UI aktualisieren, sobald Verbindung bestätigt ist
             // Die initiale Benutzerliste wird vom Server per 'user list' gesendet,
             // der Listener dafür ist unten definiert.
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
             // updateUIAfterDisconnect will be called by 'disconnect' event
         });

         socket.on('message', (msg) => {
             // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'message' AUSGELÖST.
             // Server wurde angepasst, um 'message' statt 'chatMessage' zu senden.
             console.log("[Socket.IO] Nachricht empfangen:", msg);
             appendMessage(msg);
         });

         socket.on('user list', (users) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'user list' AUSGELÖST.
              // Server wurde angepasst, um 'user list' statt 'userListUpdate' zu senden.
             console.log("[Socket.IO] Userliste empfangen:", users);
             updateUserList(users);
         });

          socket.on('typing', (data) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'typing' AUSGELÖST (weitergeleitet).
              console.log(`[Socket.IO] Typing Status empfangen von ${data.username}: ${data.isTyping}`);
              if (data.isTyping) {
                  state.typingUsers.add(data.username);
              } else {
                  state.typingUsers.delete(data.username);
              }
              updateTypingIndicatorDisplay();
          });

         socket.on('webRTC-signal', async (signal) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'webRTC-signal' AUSGELÖST (weitergeleitete Signale).
              console.log(`[Socket.IO] WebRTC Signal empfangen von ${signal.from} (Type: ${signal.type}):`, signal.payload);
              const peerId = signal.from;
              const pc = state.peerConnections.get(peerId);

              if (!pc) {
                  console.warn(`[WebRTC] WebRTC-signal: Keine PeerConnection für eingehendes Signal von Peer ${peerId}. Ignoriere Signal.`);
                  // Optionally, create a PC here if a signal arrives unexpectedly for a new peer
                  // await createPeerConnection(peerId);
                  // pc = state.peerConnections.get(peerId);
                  // if (!pc) return; // Still no PC, give up
                   return; // Ignore signals if PC doesn't exist
              }

              try {
                  if (signal.type === 'offer') {
                      console.log(`[WebRTC] Eingehendes Offer von Peer ${peerId}. Setze Remote Description.`);
                      // Handle glare before setting remote description for polite peers
                       const isPolite = state.socketId < peerId;
                       const makingOffer = pc.signalingState === 'have-local-offer';
                       const ignoreOffer = isPolite && makingOffer;

                       if (ignoreOffer) {
                           console.log(`[WebRTC] Glare Situation: Ignoriere eingehendes Offer von ${peerId} (Bin Polite und mache selbst Offer).`);
                           return;
                       }

                      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                      console.log(`[WebRTC] Remote Description (Offer) für Peer ${peerId} gesetzt. Erstelle Answer.`);
                      const answer = await pc.createAnswer();
                      console.log(`[WebRTC] Answer erstellt. Setze Local Description.`);
                      await pc.setLocalDescription(answer);
                      console.log(`[WebRTC] Local Description (Answer) für Peer ${peerId} gesetzt. Sende Answer an Server.`);
                       // Client sendet Answer AN DEN SERVER, damit dieser es an den anderen Peer schickt
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
                       // Check if we are expecting an answer (should be in 'have-local-offer' state)
                       if (pc.signalingState !== 'have-local-offer') {
                            console.warn(`[WebRTC] Empfing Answer von Peer ${peerId} im unerwarteten Signaling State: ${pc.signalingState}. Ignoriere Answer.`);
                            return;
                       }
                      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                      console.log(`[WebRTC] Remote Description (Answer) für Peer ${peerId} gesetzt.`);

                  } else if (signal.type === 'candidate') {
                       console.log(`[WebRTC] Eingehender ICE Candidate von Peer ${peerId}. Füge Candidate hinzu.`);
                       // Ensure remote description is set before adding candidates
                       if (!pc.remoteDescription) {
                           console.warn(`[WebRTC] Empfing ICE Candidate von Peer ${peerId}, aber Remote Description ist noch nicht gesetzt. Buffere oder ignoriere.`);
                           // In a real app, you might buffer candidates until the remote description is set.
                           // For simplicity here, we'll log and ignore if remote description is missing.
                           return;
                       }
                      await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
                      console.log(`[WebRTC] ICE Candidate von Peer ${peerId} hinzugefügt.`);
                  } else {
                      console.warn(`[WebRTC] Unbekannter WebRTC Signal-Typ von Peer ${peerId}: ${signal.type}`);
                  }
              } catch (err) {
                  console.error(`[WebRTC] Fehler beim Verarbeiten von WebRTC Signal von Peer ${peerId} (${signal.type}):`, err);
                  displayError(`Fehler bei Audio/Video-Kommunikation mit Peer ${peerId}.`);
                  // Consider closing the connection on significant errors
                   // closePeerConnection(peerId);
              }
         });

         socket.on('user left', (userId) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'user left' AUSGELÖST (kann optional sein, wenn 'user list' immer gesendet wird).
              // Die 'user list' Aktualisierung sollte das Entfernen aus der UI übernehmen.
              console.log(`[Socket.IO] Benutzer mit ID ${userId} hat den Raum verlassen.`);
              // The 'user list' update should handle removing the user from the UI
              // and updatePeerConnections will handle closing the PC.
              // Just log for confirmation.
         });

          socket.on('screenShareStatus', ({ userId, sharing }) => {
              // DIESER LISTENER WIRD VOM SERVER ÜBER DAS EVENT 'screenShareStatus' AUSGELÖST (weitergeleitet).
              // Die 'user list' Aktualisierung enthält bereits sharingStatus und aktualisiert die UI entsprechend.
              console.log(`[Socket.IO] Benutzer ${userId} hat Bildschirmteilung Status geändert zu ${sharing}.`);
              // The 'user list' update already includes sharingStatus,
              // which triggers updateUserList to update the UI (add/remove share icon and button).
              // If the user stopping sharing is the one being viewed, updateUserList
              // calls updateRemoteScreenDisplay which will hide it.
              // No direct action needed here other than acknowledging the signal.
          });

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
        // Define connect function outside the listener assignment for clarity
        function connect() {
            console.log("Connect Button clicked.");
             if (!UI.usernameInput || UI.usernameInput.value.trim() === '') {
                 displayError("Bitte geben Sie einen Benutzernamen ein.");
                 console.warn("Connect attempt failed: Username is empty.");
                 return;
             }

             if (state.connected) {
                  console.warn("Connect Button clicked but already connected.");
                  return;
             }

            state.username = UI.usernameInput.value.trim();

            // Check if socket already exists and is connecting/connected (shouldn't happen with UI disabled)
            if (socket && (socket.connected || socket.connecting)) {
                 console.warn("Socket already exists and is connecting or connected. Aborting connect.");
                 return;
            }

             console.log(`[App] Versuche Verbindung als ${state.username} zu Raum ${state.roomId}...`);
            // Example: Establish Socket.IO connection
             socket = io(window.location.origin, {
                 auth: { username: state.username, roomId: state.roomId },
                 transports: ['websocket'],
                 forceNew: true // Use forceNew to ensure a new connection attempt
             });
            setConnectionStatus('connecting', 'Verbinde…');
            setupSocketListeners(); // Setup listeners right after creating the socket
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
            if (socket && state.connected) {
                console.log("[Socket.IO] Sende 'disconnect'.");
                socket.disconnect();
            } else {
                 console.warn("Disconnect Button clicked but socket is not connected.");
                 // If socket isn't connected but UI is in connected state (shouldn't happen), force UI update
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


    // Message Input Listeners (Typing and Enter key)
     if (UI.messageInput) {
         UI.messageInput.addEventListener('input', () => {
             // Auto-resize textarea (optional)
             if (UI.messageInput) { // Check again within listener
                 UI.messageInput.style.height = 'auto';
                 UI.messageInput.style.height = UI.messageInput.scrollHeight + 'px';
             }
             sendTyping(UI.messageInput ? UI.messageInput.value.trim().length > 0 : false); // Send typing status if input is not empty
         });

         UI.messageInput.addEventListener('keydown', (event) => {
             if (event.key === 'Enter' && !event.shiftKey) {
                 event.preventDefault(); // Prevent newline in textarea
                 sendMessage();
             }
         });
          console.log("[App] messageInput Listeners zugewiesen.");
     } else {
         console.warn("[App] messageInput Element nicht gefunden.");
     }


    if (UI.micSelect) UI.micSelect.addEventListener('change', async () => {
        if (state.connected && !state.isSharingScreen) {
            console.log("[WebRTC] Mikrofonauswahl geändert. Versuche lokalen Stream zu aktualisieren.");
            await setupLocalAudioStream(); // Re-setup stream with new device
        } else if (state.isSharingScreen) {
             console.warn("[WebRTC] Mikrofonauswahl geändert während Bildschirmteilung. Änderung wird nach Beendigung der Teilung wirksam.");
             // Optionally display a message to the user
             displayError("Mikrofonauswahl ändert sich erst nach Beendigung der Bildschirmteilung.");
        } else {
            console.log("[WebRTC] Mikrofonauswahl geändert (nicht verbunden). Wird bei nächster Verbindung verwendet.");
        }
    });

    // Local Mute Button Listener (assigned in updateUserList, but ensure it's functional)
    // We add the listener during element creation in updateUserList.

    if (UI.shareScreenBtn) UI.shareScreenBtn.addEventListener('click', toggleScreenSharing);


     if (UI.remoteScreenFullscreenBtn) {
          UI.remoteScreenFullscreenBtn.addEventListener('click', () => {
              if (UI.remoteScreenContainer) {
                  toggleFullscreen(UI.remoteScreenContainer);
              }
          });
          console.log("[App] remoteScreenFullscreenBtn Listener zugewiesen.");
     } else {
          console.warn("[App] remoteScreenFullscreenBtn Element nicht gefunden.");
     }


     document.addEventListener('fullscreenchange', () => {
          if (UI.remoteScreenFullscreenBtn) {
               const isRemoteScreenInFullscreen = document.fullscreenElement === UI.remoteScreenContainer || (UI.remoteScreenContainer && UI.remoteScreenContainer.contains(document.fullscreenElement));
               UI.remoteScreenFullscreenBtn.textContent = isRemoteScreenInFullscreen ? "Vollbild verlassen" : "Vollbild";
          }
     });
     console.log("[App] fullscreenchange Listener zugewiesen.");


    // Handle browser window closing/reloading
    window.addEventListener('beforeunload', () => {
        console.log("[App] window.beforeunload event gefeuert. Versuche aufzuräumen.");
        if (socket && socket.connected) {
            console.log("[Socket.IO] Trenne Socket vor dem Entladen.");
            socket.disconnect(); // Disconnect socket gracefully
        }
         // Stop local media streams and close peer connections
         stopLocalAudioStream(); // Stop mic
         stopScreenSharing(false); // Stop screen without sending socket signal (server handles disconnect)
         closeAllPeerConnections(); // Close WebRTC connections
         console.log("[App] cleanup vor unload abgeschlossen.");
    });
     console.log("[App] beforeunload Listener zugewiesen.");


    // --- Init ---
    console.log("[App] DOMContentLoaded. App wird initialisiert.");
    initializeUI();
     // Populate mic list immediately on load
     populateMicList();

});
