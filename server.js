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

// Speichert die verbundenen Benutzer: { socketId: { username, color, id, roomId } }
const connectedUsers = new Map();

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

    // Prüfen, ob Benutzername im Raum bereits vergeben ist (fall-insensitiv)
     const usernameExistsInRoom = Array.from(connectedUsers.values()).some(user =>
         user.roomId === roomId && user.username.toLowerCase() === username.toLowerCase()
     );

     if (usernameExistsInRoom) {
          console.warn(`[Auth Warn] Benutzername '${username}' in Raum '${roomId}' bereits vergeben.`);
         return next(new Error('Benutzername in diesem Raum bereits vergeben'));
     }

    socket.username = username;
    socket.roomId = roomId;
    socket.userColor = getRandomColor(socket.id); // Farbe basierend auf Socket ID

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
        roomId: socket.roomId
    };
    connectedUsers.set(socket.id, newUser);

    socket.join(socket.roomId);

    // Holen Sie sich die Liste der Benutzer im Raum (inklusive des neuen Benutzers)
    const usersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === socket.roomId);

    // Sende dem neu verbundenen Benutzer seine ID und die aktuelle Benutzerliste des Raumes
    socket.emit('joinSuccess', {
        id: socket.id,
        users: usersInRoom
    });

    // Informiere ALLE im Raum (auch den Neuen) über die aktualisierte Userliste
    // Dies triggert auf den Clients die WebRTC-Verbindungslogik zu den neuen/gehenden Peers
    io.to(socket.roomId).emit('userListUpdate', usersInRoom);
    console.log(`[Room Update] Benutzer '${socket.username}' registriert. Benutzer im Raum '${socket.roomId}': ${usersInRoom.length}. Sende userListUpdate.`);


    // Nachrichtenverarbeitung
    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && msgData.content) {
            console.log(`[Message] Nachricht in Raum ${sender.roomId} von ${sender.username}: ${msgData.content.substring(0, 50)}...`);
            // Sende die Nachricht an alle im Raum (inklusive Sender)
            io.to(sender.roomId).emit('chatMessage', {
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

    // Dateiverarbeitung
    socket.on('file', (fileMsgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && fileMsgData.file) {
             console.log(`[File] Datei in Raum ${sender.roomId} von ${sender.username}: ${fileMsgData.file.name} (${formatFileSize(fileMsgData.file.size)})`);
             // Sende die Datei-Nachricht an alle im Raum (inklusive Sender)
             io.to(sender.roomId).emit('file', {
                 id: socket.id, // Sender-ID hinzufügen
                 username: sender.username,
                 color: sender.color,
                 content: fileMsgData.content, // Optionaler Textinhalt
                 file: fileMsgData.file, // Datei-Metadaten und ggf. dataUrl
                 timestamp: fileMsgData.timestamp || new Date().toISOString(),
                 type: 'file'
             });
        } else {
             console.warn(`[File Warn] Ungültige Datei-Nachricht von Socket ${socket.id} empfangen.`, fileMsgData);
        }
    });

    // Tipp-Indikator
    socket.on('typing', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
             // Sende Tipp-Status an alle im Raum ausser dem Sender
            socket.to(sender.roomId).emit('typing', { username: sender.username, isTyping: data.isTyping });
        }
    });

    // --- WebRTC Signalisierung für Audio Mesh ---
    // Empfängt ein WebRTC Signal (offer, answer, candidate) vom SENDER und leitet es an den TARGET weiter
    socket.on('webRTC-signal', (signalData) => {
        const sender = connectedUsers.get(socket.id);
        // Stelle sicher, dass die Daten ein Ziel (to) enthalten
        if (sender && signalData.to && signalData.type && signalData.payload) {
            // Finde den Ziel-Socket
            const targetSocket = io.sockets.sockets.get(signalData.to);

            // Stelle sicher, dass der Ziel-Socket existiert UND im selben Raum ist
            // Die Raumprüfung ist wichtig, um sicherzustellen, dass WebRTC-Signale
            // nicht versehentlich zwischen Räumen gesendet werden, obwohl PCs
            // nur zwischen Nutzern im selben Raum aufgebaut werden sollten.
            if (targetSocket && connectedUsers.get(signalData.to)?.roomId === sender.roomId) {
                 console.log(`[WebRTC Signal] Leite '${signalData.type}' von ${sender.username} (${sender.id}) an ${connectedUsers.get(signalData.to)?.username} (${signalData.to}) in Raum ${sender.roomId} weiter.`);
                // Sende das Signal an den Ziel-Socket
                targetSocket.emit('webRTC-signal', {
                    from: sender.id, // Füge die Sender-ID hinzu
                    type: signalData.type, // offer, answer, candidate
                    payload: signalData.payload // Das eigentliche SDP oder ICE candidate Objekt
                });
            } else {
                console.warn(`[WebRTC Signal Warn] Signal '${signalData.type}' von ${sender.username} (${sender.id}) konnte nicht an Ziel ${signalData.to} weitergeleitet werden. Ziel existiert nicht, ist nicht verbunden oder nicht im selben Raum ${sender.roomId}.`);
                // Optional: Informiere den Sender, dass das Signal nicht zugestellt werden konnte
                // socket.emit('signalDeliveryError', { to: signalData.to, type: signalData.type, message: 'Peer not available or not in room.' });
            }
        } else {
            console.warn(`[WebRTC Signal Warn] Ungültiges WebRTC-Signal von Socket ${socket.id} empfangen.`, signalData);
        }
    });


    // Benutzer verlässt den Chat
    socket.on('disconnect', (reason) => {
        const disconnectingUser = connectedUsers.get(socket.id);
        if (disconnectingUser) {
            const formerRoomId = disconnectingUser.roomId;
            console.log(`[Disconnect] Benutzer '${disconnectingUser.username}' (${socket.id}) hat die Verbindung getrennt (Raum: ${formerRoomId}). Grund: ${reason}`);
            connectedUsers.delete(socket.id);

            // Holen Sie sich die verbleibenden Benutzer im Raum
            const remainingUsersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === formerRoomId);

            // Informiere die verbleibenden Benutzer über die aktualisierte Liste
            io.to(formerRoomId).emit('userListUpdate', remainingUsersInRoom);
            console.log(`[Room Update] Benutzerliste für Raum '${formerRoomId}' aktualisiert. Verbleibende Benutzer: ${remainingUsersInRoom.length}. Sende userListUpdate.`);

             // Optional: Signalisiere den anderen Clients im Raum, dass dieser Benutzer gegangen ist,
             // damit sie die entsprechende PeerConnection schließen können.
             // Die userListUpdate sollte dies auf den Clients bereits triggern, aber ein explizites Event kann nützlich sein.
             // io.to(formerRoomId).emit('peerDisconnected', { id: socket.id }); // Kann optional hinzugefügt werden

        } else {
            console.log(`[Disconnect] Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
    });
});

// Hilfsfunktion für Zufallsfarben
function getRandomColor(id) {
     const colors = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'];
     let hash = 0;
     const str = String(id); // Nutze die Socket ID für die Farbberechnung für Konsistenz
     for (let i = 0; i < str.length; i++) {
         hash = str.charCodeAt(i) + ((hash << 5) - hash);
     }
     return colors[Math.abs(hash) % colors.length];
}

// Hilfsfunktion zur Formatierung der Dateigröße (für Logs auf dem Server)
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


server.listen(PORT, () => {
    console.log(`✅ EDMBook Chat Server läuft auf Port ${PORT}`);
});
