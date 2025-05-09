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

// Speichert die Historie der Benutzer (online/offline): { userId: { username, color, roomId, lastSeen: Date, isOnline: boolean, sharingStatus: boolean } }
// Wir verwenden die Socket ID als Key in der History, auch wenn der Benutzer offline ist.
const userHistory = new Map();
const OFFLINE_DISPLAY_DURATION_MS = 30 * 60 * 1000; // Zeige Offline-Benutzer für 30 Minuten

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

     // Prüfe, ob der Benutzername in diesem Raum bereits online ist (andere Socket ID aber gleicher Name)
     // Diese Prüfung sollte nur gegen aktuell VERBUNDENE Benutzer erfolgen.
     const usernameExistsOnlineInRoom = Array.from(connectedUsers.values()).some(user =>
         user.roomId === roomId && user.username.toLowerCase() === username.toLowerCase() && user.id !== socket.id
     );

     if (usernameExistsOnlineInRoom) {
          console.warn(`[Auth Warn] Benutzername '${username}' in Raum '${roomId}' bereits online.`);
         return next(new Error('Benutzername in diesem Raum bereits online'));
     }

    socket.username = username;
    socket.roomId = roomId;
    socket.userColor = getRandomColor(socket.id); // Verwende die Socket ID für eine konsistente Farbe

    console.log(`[Auth Success] Auth erfolgreich für: ${username} in Raum ${roomId} (Socket ID: ${socket.id})`);
    next();
});

// Socket.IO Event Handling
io.on('connection', (socket) => {
    console.log(`[Connect] Benutzer '${socket.username}' (${socket.id}) verbunden mit Raum '${socket.roomId}'.`);

    // ** FIX FOR RECONNECT BUG: Handle user history update on connection more robustly **
    const existingHistoryEntry = userHistory.get(socket.id);

    const newUser = {
        id: socket.id,
        username: socket.username,
        color: socket.userColor, // Use the color assigned during auth
        roomId: socket.roomId,
        // Use sharingStatus from history if exists, otherwise default to false
        sharingStatus: existingHistoryEntry ? existingHistoryEntry.sharingStatus : false
    };
    // Wenn ein History-Eintrag existiert, aktualisiere ihn statt einen neuen zu erstellen.
    if (existingHistoryEntry) {
        existingHistoryEntry.username = newUser.username; // Aktualisiere ggf. den Namen (nicht im Auth-Flow, aber gute Praxis)
        existingHistoryEntry.color = newUser.color; // Aktualisiere Farbe
        existingHistoryEntry.roomId = newUser.roomId; // Aktualisiere Raum
        existingHistoryEntry.lastSeen = new Date();
        existingHistoryEntry.isOnline = true; // Markiere als online
        existingHistoryEntry.sharingStatus = newUser.sharingStatus; // Übernehme Sharing Status (oder setze ihn zurück?)
        userHistory.set(socket.id, existingHistoryEntry);
        console.log(`[History Update] Bestehender History-Eintrag für ${socket.id} aktualisiert (Online).`);
    } else {
         // Neuer History-Eintrag, falls keiner existiert
         userHistory.set(socket.id, {
             username: newUser.username,
             color: newUser.color,
             roomId: newUser.roomId,
             lastSeen: new Date(),
             isOnline: true,
             sharingStatus: newUser.sharingStatus
         });
         console.log(`[History Update] Neuer History-Eintrag für ${socket.id} erstellt.`);
    }

    connectedUsers.set(socket.id, newUser); // Füge zur Liste der verbundenen Benutzer hinzu


    socket.join(socket.roomId);

    // Hilfsfunktion, um die aktuelle Benutzerliste im Raum zu holen und zu senden
    const sendUserListUpdate = (roomId) => {
        const now = new Date();
        // Filter connected users for the room
        const onlineUsersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === roomId);

        // Get relevant offline users for the room from history
        // Filter out currently online users (based on connectedUsers) from the offline list
        // Also filter by room ID stored in history
        const offlineUsersInRoom = Array.from(userHistory.entries())
            .filter(([userId, userData]) =>
                userData.roomId === roomId && // Must be in the same room as the update is for
                !userData.isOnline && // Must be marked as offline
                (now.getTime() - userData.lastSeen.getTime()) <= OFFLINE_DISPLAY_DURATION_MS && // Within display duration
                 // Double-check against connectedUsers to be safe, though isOnline flag should handle this
                !connectedUsers.has(userId)
            )
            .map(([userId, userData]) => ({
                id: userId,
                username: userData.username,
                color: userData.color, // Sende die gespeicherte Farbe
                isOnline: false, // Explicitly mark as offline
                sharingStatus: userData.sharingStatus // Include sharing status from history
            }));


        // Combine online and offline users
        const usersToSend = onlineUsersInRoom.map(user => ({
             id: user.id,
             username: user.username,
             color: user.color,
             sharingStatus: user.sharingStatus,
             isOnline: true // Explicitly mark as online
        })).concat(offlineUsersInRoom); // Add offline users to the list


        // Sort users (e.g., online first, then alphabetically)
        usersToSend.sort((a, b) => {
            // Sort by online status (online true > false)
            if (a.isOnline !== b.isOnline) {
                return b.isOnline - a.isOnline;
            }
            // Then sort by username alphabetically
            return a.username.localeCompare(b.username);
        });


        io.to(roomId).emit('user list', usersToSend);
        console.log(`[Room Update] Benutzerliste für Raum '${roomId}' aktualisiert. Sende 'user list'. Gesamt: ${usersToSend.length}, Online: ${onlineUsersInRoom.length}, Offline (im Zeitraum): ${offlineUsersInRoom.length}.`);
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

             // Update in userHistory as well
             const historyEntry = userHistory.get(socket.id);
             if(historyEntry) {
                 historyEntry.sharingStatus = data.sharing;
                 // Also update lastSeen and isOnline as user is actively sharing
                 historyEntry.lastSeen = new Date();
                 historyEntry.isOnline = true;
                 userHistory.set(socket.id, historyEntry);
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
            console.log(`[Disconnect] Benutzer '${disconnectingUser.username}' (${socket.id}) hat die Verbindung getrennt (Raum: ${formerRoomId}). Grund: ${reason}`);

            // Update userHistory status to offline and update lastSeen
            const historyEntry = userHistory.get(socket.id);
            if(historyEntry) {
                historyEntry.isOnline = false;
                historyEntry.lastSeen = new Date();
                // Set sharingStatus to false on disconnect
                historyEntry.sharingStatus = false;
                userHistory.set(socket.id, historyEntry);
                 console.log(`[History Update] History-Eintrag für ${socket.id} auf offline gesetzt.`);
            } else {
                 // This case should ideally not happen if history is updated on connect
                 console.warn(`[Disconnect Warn] userHistory entry not found for disconnecting user ${socket.id}. Attempting to create.`);
                 // Attempt to add a history entry if missing, using available info
                 userHistory.set(socket.id, {
                     username: disconnectingUser.username,
                     color: disconnectingUser.color,
                     roomId: formerRoomId,
                     lastSeen: new Date(),
                     isOnline: false,
                     sharingStatus: false // Default to false on missing history
                 });
                 console.log(`[History Update] Fehlender History-Eintrag für ${socket.id} erstellt (offline).`);
            }

            connectedUsers.delete(socket.id); // Remove from connected users

            // Informiere die verbleibenden Clients über die Änderung
            sendUserListUpdate(formerRoomId);

        } else {
            console.log(`[Disconnect] Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
             // Handle unknown disconnect - if socket ID exists in history, mark as offline.
             const historyEntry = userHistory.get(socket.id);
             if(historyEntry) {
                  historyEntry.isOnline = false;
                  historyEntry.lastSeen = new Date();
                   historyEntry.sharingStatus = false; // Sharing stops on disconnect
                  userHistory.set(socket.id, historyEntry);
                   console.log(`[History Update] History-Eintrag für unbekannten ${socket.id} auf offline gesetzt.`);
                   // If we know the room from history, send an update to that room
                   if(historyEntry.roomId) {
                       sendUserListUpdate(historyEntry.roomId);
                   }
             } else {
                  console.warn(`[History Update] Unbekannter Socket ${socket.id} war auch nicht in der History. Keine Aktion.`);
             }
        }
    });

});

function getRandomColor(id) {
     // Nutzt die Socket ID, die beim Auth gesetzt wurde, um eine konsistente Farbe zu erhalten.
     // Fällt zurück auf übergebene ID (z.B. für alte Nachrichten oder wenn Auth umgangen wird).
     const colors = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9700', '#ff5722', '#795548'];
     let hash = 0;
     const str = String(id);
     for (let i = 0; i < str.length; i++) {
         hash = str.charCodeAt(i) + ((hash << 5) - hash);
     }
     return colors[Math.abs(hash) % colors.length];
}


server.listen(PORT, () => {
    console.log(`✅ EDMBook Chat Server läuft auf Port ${PORT}`);
});
