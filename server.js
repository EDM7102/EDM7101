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

// Speichert die Historie der Benutzer (online/offline): { userId: { username, color, lastSeen: Date, isOnline: boolean } }
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

     // Prüfe, ob der Benutzername in diesem Raum bereits online ist
     const usernameExistsOnlineInRoom = Array.from(connectedUsers.values()).some(user =>
         user.roomId === roomId && user.username.toLowerCase() === username.toLowerCase()
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

    const newUser = {
        id: socket.id,
        username: socket.username,
        color: socket.userColor,
        roomId: socket.roomId,
        sharingStatus: false // Neuer Benutzer startet nicht mit Bildschirmteilung
    };
    connectedUsers.set(socket.id, newUser);

    // Benutzer zur Historie hinzufügen oder aktualisieren
    userHistory.set(socket.id, {
        username: newUser.username,
        color: newUser.color,
        lastSeen: new Date(),
        isOnline: true
    });


    socket.join(socket.roomId);

    // Hilfsfunktion, um die aktuelle Benutzerliste im Raum zu holen und zu senden
    const sendUserListUpdate = (roomId) => {
        const now = new Date();
        // Filter connected users for the room
        const onlineUsersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === roomId);

        // Get relevant offline users for the room from history
        // Exclude currently online users from the offline list
        const offlineUsersInRoom = Array.from(userHistory.entries())
            .filter(([userId, userData]) =>
                !userData.isOnline && // Must be marked as offline
                userData.roomId === roomId && // Must be in the same room (Need to add roomId to userHistory!)
                (now.getTime() - userData.lastSeen.getTime()) <= OFFLINE_DISPLAY_DURATION_MS && // Within display duration
                !onlineUsersInRoom.some(user => user.id === userId) // Not currently online
            )
            .map(([userId, userData]) => ({
                id: userId,
                username: userData.username,
                color: userData.color,
                isOnline: false // Explicitly mark as offline
            }));

         // Need to add roomId to userHistory when a user connects.
         // Let's update the newUser creation and history update.

        // Combine online and offline users
        // Structure includes isOnline status now
        const usersToSend = onlineUsersInRoom.map(user => ({
             id: user.id,
             username: user.username,
             color: user.color,
             sharingStatus: user.sharingStatus,
             isOnline: true // Explicitly mark as online
        })).concat(offlineUsersInRoom); // Add offline users to the list


        // Sort users (e.g., online first, then alphabetically)
        usersToSend.sort((a, b) => {
            if (a.isOnline === b.isOnline) {
                return a.username.localeCompare(b.username); // Sort alphabetically if same status
            }
            return b.isOnline - a.isOnline; // Online users first
        });


        io.to(roomId).emit('user list', usersToSend);
        console.log(`[Room Update] Benutzerliste für Raum '${roomId}' aktualisiert. Sende 'user list'. Gesamt: ${usersToSend.length}, Online: ${onlineUsersInRoom.length}, Offline (im Zeitraum): ${offlineUsersInRoom.length}.`);
    };

    // FIX: Add roomId to userHistory when user connects
    // This needs to be done inside the 'connection' handler, after auth.
    const existingUserHistory = userHistory.get(socket.id);
     userHistory.set(socket.id, {
         username: socket.username,
         color: socket.userColor, // Use the assigned color
         roomId: socket.roomId, // Store the room ID
         lastSeen: new Date(),
         isOnline: true,
          // Keep sharingStatus if it existed (e.g., if user refreshed quickly?) - Optional
          sharingStatus: existingUserHistory ? existingUserHistory.sharingStatus : false // Default to false
     });


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
            // FIX: Event-Name von 'chatMessage' zu 'message' geändert
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
        if (sender && data.isTyping !== undefined) { // Prüfe, ob isTyping vorhanden ist
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
        if (sender && signalData.to && signalData.type && signalData.payload) {
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
        if (sender && typeof data.sharing === 'boolean') {
            console.log(`[ScreenShare] Benutzer '${sender.username}' (${sender.id}) in Raum ${sender.roomId}: Bildschirm teilen Status: ${data.sharing}`);

            sender.sharingStatus = data.sharing;
             connectedUsers.set(socket.id, sender); // Update in connectedUsers

             // Update in userHistory as well
             const historyEntry = userHistory.get(socket.id);
             if(historyEntry) {
                 historyEntry.sharingStatus = data.sharing;
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
                // Optionally keep sharingStatus for a short time? No, sharing stops on disconnect.
                historyEntry.sharingStatus = false;
                userHistory.set(socket.id, historyEntry);
            } else {
                 // This case should ideally not happen if history is updated on connect
                 console.warn(`[Disconnect Warn] userHistory entry not found for disconnecting user ${socket.id}.`);
                 userHistory.set(socket.id, {
                     username: disconnectingUser.username,
                     color: disconnectingUser.color,
                     roomId: formerRoomId, // Ensure roomId is stored even if history entry was missing
                     lastSeen: new Date(),
                     isOnline: false,
                     sharingStatus: false
                 });
            }

            connectedUsers.delete(socket.id); // Remove from connected users

            // Informiere die verbleibenden Clients über die Änderung
            sendUserListUpdate(formerRoomId);

            // Clean up old offline users from history periodically (optional but recommended for memory)
            // Or clean up when sending list (done implicitly by filtering)
            // A dedicated cleanup interval might be better for long-running servers
            // checkAndCleanupUserHistory(); // Call a cleanup function

        } else {
            console.log(`[Disconnect] Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
             // Even if user was unknown in connectedUsers, they might be in history if they connected before.
             // However, we don't have their username/roomId here easily.
             // A robust history would need to handle this, maybe based on socket ID lookup in a more persistent store.
        }
    });

    // Server lauscht nicht explizit auf 'requestInitialState'.
    // Der Client erhält seinen Initialzustand (eigene ID und Benutzerliste)
    // durch das 'joinSuccess' Event und das nachfolgende 'user list' Broadcast.
    // socket.on('requestInitialState', () => { ... }); // NICHT BENÖTIGT mit der aktuellen Logik

});

// Helper function to periodically clean up old offline users from history
// function checkAndCleanupUserHistory() {
//     const now = new Date();
//     const keysToDelete = [];
//     userHistory.forEach((userData, userId) => {
//         if (!userData.isOnline && (now.getTime() - userData.lastSeen.getTime()) > OFFLINE_DISPLAY_DURATION_MS * 2) { // Clean up older than twice the display duration
//             keysToDelete.push(userId);
//         }
//     });
//     keysToDelete.forEach(key => {
//         console.log(`[History Cleanup] Removing old offline user ${key} from history.`);
//         userHistory.delete(key);
//     });
// }
// // Run cleanup periodically (e.g., every hour)
// setInterval(checkAndCleanupUserHistory, 60 * 60 * 1000);


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
