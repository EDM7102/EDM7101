const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS für lokale Tests und flexible Deployments
const io = new Server(server, {
    cors: {
        origin: "*", // In Produktion auf spezifische Ursprünge beschränken!
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Speichert die aktuell verbundenen Benutzer: { socketId: { username, color, id, roomId, sharingStatus: boolean } }
const connectedUsers = new Map();

// Speichert die Historie der Benutzer (online/offline): { username_roomId: { userId: string, username: string, color: string, roomId: string, lastSeen: Date, isOnline: boolean, sharingStatus: boolean } }
// Wir verwenden eine Kombination aus Benutzername und Raum-ID als Key in der History, um Benutzer über Verbindungen hinweg zu verfolgen.
const userHistory = new Map();
const OFFLINE_DISPLAY_DURATION_MS = 10000 * 24 * 60 * 60 * 1000; // Zeige Offline-Benutzer für 10.000 Tage

// Statische Dateien ausliefern (HTML, CSS, Client-JS)
app.use(express.static(path.join(__dirname, 'public')));

// Route für die Hauptseite
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware für die initiale Verbindung und Authentifizierung
io.use((socket, next) => {
    const username = socket.handshake.auth.username;
    const roomId = socket.handshake.auth.roomId;

    if (!username || username.trim() === '') {
        console.error(`[Auth Error] Verbindungsversuch ohne Benutzername von Socket ${socket.id}`);
        return next(new Error('Benutzername ist erforderlich'));
    }
    if (!roomId || roomId.trim() === '') {
        console.error(`[Auth Error] Verbindungsversuch ohne Raum-ID von Socket ${socket.id}`);
        return next(new Error('Raum-ID ist erforderlich'));
    }

    const userIdentifier = `${username.toLowerCase()}-${roomId}`;

     // Prüfe, ob der Benutzername in diesem Raum bereits online ist (andere Socket ID aber gleicher Name)
     const usernameExistsOnlineInRoom = Array.from(connectedUsers.values()).some(user =>
         user.roomId === roomId && user.username.toLowerCase() === username.toLowerCase() && user.id !== socket.id
     );

     if (usernameExistsOnlineInRoom) {
          console.warn(`[Auth Warn] Benutzername '${username}' in Raum '${roomId}' bereits online.`);
         return next(new Error('Benutzername in diesem Raum bereits online'));
     }

    socket.username = username;
    socket.roomId = roomId;

    // ** FIX FOR CONSISTENT COLOR AND HISTORY UPDATE ON RECONNECT **
    // Check if user exists in history by username and room ID
    const existingHistoryEntry = userHistory.get(userIdentifier);

    if (existingHistoryEntry) {
        // User found in history, use their existing color
        socket.userColor = existingHistoryEntry.color;
        console.log(`[Auth Success] Benutzer '${username}' in Raum '${roomId}' in History gefunden. Verwende Farbe: ${socket.userColor}`);
    } else {
        // New user or first time in this room, generate a new color based on username+roomId for consistency
        socket.userColor = getRandomColor(userIdentifier); // Use userIdentifier for color consistency across sessions
        console.log(`[Auth Success] Neuer Benutzer '${username}' in Raum '${roomId}'. Generiere Farbe: ${socket.userColor}`);
    }
    // ** END FIX **


    console.log(`[Auth Success] Auth erfolgreich für: ${username} in Raum ${roomId} (Socket ID: ${socket.id}). Farbe: ${socket.userColor}`);
    next();
});

// Socket.IO Event Handling
io.on('connection', (socket) => {
    console.log(`[Connect] Benutzer '${socket.username}' (${socket.id}) verbunden mit Raum '${socket.roomId}'.`);

    const userIdentifier = `${socket.username.toLowerCase()}-${socket.roomId}`;

    const newUser = {
        id: socket.id, // Current socket ID
        username: socket.username,
        color: socket.userColor, // Use the color determined during auth
        roomId: socket.roomId,
        sharingStatus: false // Default to false on connection
    };

    connectedUsers.set(socket.id, newUser); // Add to currently connected users

    // ** FIX FOR RECONNECT BUG: Update user history on connection **
    const existingHistoryEntry = userHistory.get(userIdentifier);

    if (existingHistoryEntry) {
        // User found in history, update their status and current socket ID
        existingHistoryEntry.userId = socket.id; // Update to the new socket ID
        existingHistoryEntry.lastSeen = new Date();
        existingHistoryEntry.isOnline = true; // Mark as online
        existingHistoryEntry.sharingStatus = false; // Reset sharing status on new connection
        userHistory.set(userIdentifier, existingHistoryEntry);
        console.log(`[History Update] Bestehender History-Eintrag für '${userIdentifier}' aktualisiert (Online, neue ID: ${socket.id}).`);
    } else {
         // New history entry, if none exists for this username+roomId
         userHistory.set(userIdentifier, {
             userId: socket.id, // Store the socket ID
             username: newUser.username,
             color: newUser.color,
             roomId: newUser.roomId,
             lastSeen: new Date(),
             isOnline: true,
             sharingStatus: newUser.sharingStatus
         });
         console.log(`[History Update] Neuer History-Eintrag für '${userIdentifier}' erstellt (ID: ${socket.id}).`);
    }
    // ** END FIX **


    socket.join(socket.roomId);

    // Hilfsfunktion, um die aktuelle Benutzerliste im Raum zu holen und zu senden
    const sendUserListUpdate = (roomId) => {
        const now = new Date();
        const usersToSend = [];
        const processedUserIdentifiers = new Set(); // To prevent duplicates for the same username in the room

        // Iterate through userHistory to build the list for this room
        Array.from(userHistory.entries()).forEach(([userIdentifier, userData]) => {
            // Only process users from the relevant room
            if (userData.roomId !== roomId) {
                return;
            }

            // If this user (by username+roomId) has already been added (should not happen with the new logic, but safe check)
            if (processedUserIdentifiers.has(userIdentifier)) {
                 console.warn(`[UserList Update] Duplicate user identifier '${userIdentifier}' found in history iteration. Skipping.`);
                 return;
            }

            // Check if the user is currently online based on the history entry's userId
            const isCurrentlyConnected = connectedUsers.has(userData.userId);

            if (isCurrentlyConnected) {
                 // User is currently online. Use their live data from connectedUsers.
                 const connectedUser = connectedUsers.get(userData.userId);
                 usersToSend.push({
                     id: connectedUser.id, // Use the current socket ID
                     username: connectedUser.username,
                     color: connectedUser.color, // Use the color from connectedUsers
                     sharingStatus: connectedUser.sharingStatus,
                     isOnline: true
                 });
                 processedUserIdentifiers.add(userIdentifier); // Mark this username+room as processed

            } else {
                // User is not currently online. Check if their history should be displayed as offline.
                if (!userData.isOnline && (now.getTime() - userData.lastSeen.getTime()) <= OFFLINE_DISPLAY_DURATION_MS) {
                     usersToSend.push({
                         id: userData.userId, // Use the historical socket ID for the offline entry
                         username: userData.username,
                         color: userData.color, // Use the color from history
                         sharingStatus: userData.sharingStatus, // Include sharing status from history (should be false on disconnect)
                         isOnline: false
                     });
                     processedUserIdentifiers.add(userIdentifier); // Mark this username+room as processed
                }
                 // If they are offline and outside the display duration, they are implicitly filtered out.
            }
        });

        // Sort users (online first, then alphabetically)
        usersToSend.sort((a, b) => {
            if (a.isOnline !== b.isOnline) {
                return b.isOnline - a.isOnline; // Online users first
            }
            return a.username.localeCompare(b.username); // Sort alphabetically if same status
        });


        io.to(roomId).emit('user list', usersToSend);
        console.log(`[Room Update] Benutzerliste für Raum '${roomId}' aktualisiert. Sende 'user list'. Gesamt: ${usersToSend.length}.`);
    };


    // Beim Verbinden des neuen Benutzers:
    // 1. Bestätige dem neuen Benutzer die Verbindung (er erhält seine eigene ID)
    //    Die vollständige Benutzerliste wird direkt danach per 'user list' gesendet.
    socket.emit('joinSuccess', {
        id: socket.id
    });
    console.log(`[Join Success] Sende 'joinSuccess' an neuen Benutzer ${socket.id}.`);

    // 2. Informiere alle im Raum über den neuen Benutzer (mit der aktualisierten Liste)
    sendUserListUpdate(socket.roomId);


    // Nachrichtenverarbeitung (Text)
    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && msgData.content) {
            console.log(`[Message] Nachricht in Raum ${sender.roomId} von ${sender.username}: ${msgData.content.substring(0, 50)}...`);
            io.to(sender.roomId).emit('message', {
                id: socket.id, // Sender-ID hinzufügen
                username: sender.username,
                color: sender.color,
                content: msgData.content,
                timestamp: msgData.timestamp || new Date().toISOString(),
                type: 'text'
            });
        } else {
            console.warn(`[Message Warn] Ungültige Nachricht von Socket ${socket.id} empfangen.`, msgData);
        }
    });

    // Tipp-Indikator
    socket.on('typing', (data) => {
        const sender = connectedUsers.get(socket.id);
        // Ensure sender is connected and data has isTyping
        if (sender && data.isTyping !== undefined) {
             // Sende 'typing' Event an alle anderen im selben Raum
             // Füge die Sender-ID hinzu, damit der Client weiß, wer tippt
            socket.to(sender.roomId).emit('typing', { userId: sender.id, username: sender.username, isTyping: data.isTyping });
             console.log(`[Typing] Sende 'typing: ${data.isTyping}' von ${sender.username} (${sender.id}) in Raum ${sender.roomId}`);
        } else {
            console.warn(`[Typing Warn] Ungültiges Typing-Signal von Socket ${socket.id} empfangen.`, data);
        }
    });

    // WebRTC Signalisierung für Audio Mesh + Video Tracks
    // Dieses Signal leitet alle WebRTC-Nachrichten (offer, answer, candidate) zwischen zwei Peers weiter
    socket.on('webRTC-signal', (signalData) => {
        const sender = connectedUsers.get(socket.id);
        // Ensure sender is connected
        if (!sender) {
             console.warn(`[WebRTC Signal Warn] Signal von nicht verbundenem Socket ${socket.id} erhalten. Ignoriere.`);
             return;
        }

        if (signalData.to && signalData.type && signalData.payload) {
            const targetSocket = io.sockets.sockets.get(signalData.to);

            // Stelle sicher, dass das Ziel existiert und im selben Raum ist
            // UND dass das Ziel online ist (connectedUsers)
            const targetUser = connectedUsers.get(signalData.to);
            if (targetSocket && targetUser && targetUser.roomId === sender.roomId) {
                console.log(`[WebRTC Signal] Leite Signal '${signalData.type}' von ${sender.id} an ${signalData.to} in Raum ${sender.roomId} weiter.`);
                targetSocket.emit('webRTC-signal', {
                    from: sender.id,
                    type: signalData.type,
                    payload: signalData.payload
                });
            } else {
                console.warn(`[WebRTC Signal Warn] Signal '${signalData.type}' von ${sender.username} (${sender.id}) konnte nicht an Ziel ${signalData.to} weitergeleitet werden. Ziel existiert nicht, ist nicht online oder nicht im selben Raum ${sender.roomId}.`);
                // Optional: Dem Sender Bescheid geben, dass das Ziel ungültig ist
                 socket.emit('webRTC-error', {
                     to: signalData.to,
                     type: signalData.type,
                     message: 'Empfänger nicht online oder nicht im selben Raum.'
                 });
            }
        } else {
            console.warn(`[WebRTC Signal Warn] Ungültiges WebRTC-Signal von Socket ${socket.id} empfangen.`, signalData);
        }
    });

    // Bildschirm teilen Status Aktualisierung vom Client empfangen
    socket.on('screenShareStatus', (data) => {
        const sender = connectedUsers.get(socket.id);
        // Ensure sender is connected and data is valid
        if (sender && typeof data.sharing === 'boolean') {
            console.log(`[ScreenShare] Benutzer '${sender.username}' (${sender.id}) in Raum ${sender.roomId}: Bildschirm teilen Status: ${data.sharing}`);

            sender.sharingStatus = data.sharing;
             connectedUsers.set(socket.id, sender); // Update in connectedUsers

             // Update in userHistory as well using the userIdentifier
             const userIdentifier = `${sender.username.toLowerCase()}-${sender.roomId}`;
             const historyEntry = userHistory.get(userIdentifier);
             if(historyEntry) {
                 historyEntry.sharingStatus = data.sharing;
                 // Also update lastSeen and isOnline as user is actively sharing
                 historyEntry.lastSeen = new Date();
                 historyEntry.isOnline = true; // User is online if sharing
                 userHistory.set(userIdentifier, historyEntry);
                 console.log(`[History Update] History-Eintrag für '${userIdentifier}' mit Sharing Status ${data.sharing} aktualisiert.`);
             } else {
                 console.warn(`[ScreenShare Warn] History entry not found for userIdentifier '${userIdentifier}' during screenShareStatus update.`);
                 // This case should ideally not happen if history is updated on connect
             }


             // Informiere alle anderen Clients im Raum über die Statusänderung,
             // indem die aktualisierte Benutzerliste gesendet wird.
             sendUserListUpdate(sender.roomId);

        } else {
             console.warn(`[ScreenShare Warn] Ungültiger screenShareStatus von Socket ${socket.id} empfangen.`, data);
        }
    });


    // Benutzer verlässt den Chat
    socket.on('disconnect', (reason) => {
        const disconnectingUser = connectedUsers.get(socket.id);
        if (disconnectingUser) {
            const formerRoomId = disconnectingUser.roomId;
            const userIdentifier = `${disconnectingUser.username.toLowerCase()}-${formerRoomId}`;
            console.log(`[Disconnect] Benutzer '${disconnectingUser.username}' (${socket.id}) hat die Verbindung getrennt (Raum: ${formerRoomId}). Grund: ${reason}`);

            // ** FIX FOR RECONNECT BUG: Update userHistory status to offline **
            const historyEntry = userHistory.get(userIdentifier);
            if(historyEntry) {
                historyEntry.isOnline = false;
                historyEntry.lastSeen = new Date();
                historyEntry.sharingStatus = false; // Set sharingStatus to false on disconnect
                // Keep the userId in history for potential future reconnects from the same userIdentifier
                // historyEntry.userId = undefined; // Optional: clear the socket ID, but keeping it might help identify the last known socket.
                userHistory.set(userIdentifier, historyEntry);
                 console.log(`[History Update] History-Eintrag für '${userIdentifier}' auf offline gesetzt (ID: ${disconnectingUser.id}).`);
            } else {
                 // This case should ideally not happen if history is updated on connect
                 console.warn(`[Disconnect Warn] userHistory entry not found for disconnecting userIdentifier '${userIdentifier}'.`);
                 // Attempt to create a history entry if missing, using available info
                 userHistory.set(userIdentifier, {
                     userId: disconnectingUser.id, // Store the last known socket ID
                     username: disconnectingUser.username,
                     color: disconnectingUser.color,
                     roomId: formerRoomId,
                     lastSeen: new Date(),
                     isOnline: false,
                     sharingStatus: false
                 });
                 console.log(`[History Update] Fehlender History-Eintrag für '${userIdentifier}' erstellt (offline).`);
            }
            // ** END FIX **


            connectedUsers.delete(socket.id); // Remove from connected users

            // Informiere die verbleibenden Clients über die Änderung
            sendUserListUpdate(formerRoomId);

        } else {
            console.log(`[Disconnect] Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
             // Handle unknown disconnect - if socket ID exists in history, mark as offline.
             // This part is tricky as we don't have username/roomId for the unknown socket directly.
             // A robust history would need to map socket IDs to userIdentifiers on connect.
             // For now, we rely on the history entry being found by userIdentifier during disconnect of a known user.
             // If a socket disconnects and was never successfully authenticated and added to connectedUsers/userHistory,
             // they won't appear in the list anyway.
             console.warn(`[Disconnect Warn] Unbekannter Socket ${socket.id} getrennt. Keine History-Aktualisierung möglich ohne UserIdentifier.`);
        }
    });

});

function getRandomColor(identifier) {
     // Nutzt einen Identifier (z.B. username_roomId) um eine konsistente Farbe zu erhalten.
     const colors = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9700', '#ff5722', '#795548'];
     let hash = 0;
     const str = String(identifier);
     for (let i = 0; i < str.length; i++) {
         hash = str.charCodeAt(i) + ((hash << 5) - hash);
     }
     return colors[Math.abs(hash) % colors.length];
}


server.listen(PORT, () => {
    console.log(`✅ EDMBook Chat Server läuft auf Port ${PORT}`);
});
