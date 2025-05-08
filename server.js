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

// Speichert die verbundenen Benutzer: { socketId: { username, color, id, roomId, sharingStatus: boolean } }
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

     const usernameExistsInRoom = Array.from(connectedUsers.values()).some(user =>
         user.roomId === roomId && user.username.toLowerCase() === username.toLowerCase()
     );

     if (usernameExistsInRoom) {
          console.warn(`[Auth Warn] Benutzername '${username}' in Raum '${roomId}' bereits vergeben.`);
         return next(new Error('Benutzername in diesem Raum bereits vergeben'));
     }

    socket.username = username;
    socket.roomId = roomId;
    socket.userColor = getRandomColor(socket.id);

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

    socket.join(socket.roomId);

    // Hilfsfunktion, um die aktuelle Benutzerliste im Raum zu holen und zu senden
    const sendUserListUpdate = (roomId) => {
        const usersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === roomId);
        // Kopie erstellen, um keine Map-Interna zu senden, nur die benötigten Properties
        const usersToSend = usersInRoom.map(user => ({
             id: user.id,
             username: user.username,
             color: user.color,
             sharingStatus: user.sharingStatus // Sende den Sharing-Status mit!
        }));
        io.to(roomId).emit('userListUpdate', usersToSend);
        console.log(`[Room Update] Benutzerliste für Raum '${roomId}' aktualisiert. Benutzer: ${usersToSend.length}. Sende userListUpdate.`);
    };


    // Beim Verbinden des neuen Benutzers:
    // 1. Sende die aktuelle Liste an den neuen Benutzer (mit allen Stati, inkl. Sharing von anderen)
    socket.emit('joinSuccess', {
        id: socket.id,
        users: Array.from(connectedUsers.values()).filter(user => user.roomId === socket.roomId).map(user => ({
            id: user.id,
            username: user.username,
            color: user.color,
            sharingStatus: user.sharingStatus // Auch beim JoinSuccess den Status senden
        }))
    });
    // 2. Informiere die anderen im Raum über den neuen Benutzer (mit der aktualisierten Liste)
    sendUserListUpdate(socket.roomId); // Sendet die Liste inkl. des neuen Benutzers an alle


    // Nachrichtenverarbeitung (Text)
    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && msgData.content) {
            console.log(`[Message] Nachricht in Raum ${sender.roomId} von ${sender.username}: ${msgData.content.substring(0, 50)}...`);
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

    // Tipp-Indikator
    socket.on('typing', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            socket.to(sender.roomId).emit('typing', { username: sender.username, isTyping: data.isTyping });
        }
    });

    // --- WebRTC Signalisierung für Audio Mesh + Video Tracks ---
    // Dieses Signal leitet alle WebRTC-Nachrichten (offer, answer, candidate) zwischen zwei Peers weiter
    socket.on('webRTC-signal', (signalData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && signalData.to && signalData.type && signalData.payload) {
            const targetSocket = io.sockets.sockets.get(signalData.to);

            if (targetSocket && connectedUsers.get(signalData.to)?.roomId === sender.roomId) {
                targetSocket.emit('webRTC-signal', {
                    from: sender.id,
                    type: signalData.type,
                    payload: signalData.payload
                });
            } else {
                console.warn(`[WebRTC Signal Warn] Signal '${signalData.type}' von ${sender.username} (${sender.id}) konnte nicht an Ziel ${signalData.to} weitergeleitet werden. Ziel existiert nicht, ist nicht verbunden oder nicht im selben Raum ${sender.roomId}.`);
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
             connectedUsers.set(socket.id, sender); // Stelle sicher, dass die Änderung gespeichert wird


            // Informiere ALLE Benutzer im Raum (inklusive Sender) über den geänderten Status
            // Die userListUpdate wird gesendet, da die Clients darauf reagieren,
            // um die UI (z.B. Button "Bildschirm ansehen") zu aktualisieren.
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
            connectedUsers.delete(socket.id);

            sendUserListUpdate(formerRoomId);

        } else {
            console.log(`[Disconnect] Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
    });
});

function getRandomColor(id) {
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
