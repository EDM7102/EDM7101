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
        // FIX: Event-Name von 'userListUpdate' zu 'user list' geändert
        io.to(roomId).emit('user list', usersToSend);
        console.log(`[Room Update] Benutzerliste für Raum '${roomId}' aktualisiert. Benutzer: ${usersToSend.length}. Sende 'user list'.`);
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
        if (sender) {
             // Sende 'typing' Event an alle anderen im selben Raum
            socket.to(sender.roomId).emit('typing', { username: sender.username, isTyping: data.isTyping });
        }
    });

    // WebRTC Signalisierung für Audio Mesh + Video Tracks
    // Dieses Signal leitet alle WebRTC-Nachrichten (offer, answer, candidate) zwischen zwei Peers weiter
    socket.on('webRTC-signal', (signalData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && signalData.to && signalData.type && signalData.payload) {
            const targetSocket = io.sockets.sockets.get(signalData.to);

            // Stelle sicher, dass das Ziel existiert und im selben Raum ist
            if (targetSocket && connectedUsers.get(signalData.to)?.roomId === sender.roomId) {
                console.log(`[WebRTC Signal] Leite Signal '${signalData.type}' von ${sender.id} an ${signalData.to} in Raum ${sender.roomId} weiter.`);
                targetSocket.emit('webRTC-signal', {
                    from: sender.id,
                    type: signalData.type,
                    payload: signalData.payload
                });
            } else {
                console.warn(`[WebRTC Signal Warn] Signal '${signalData.type}' von ${sender.username} (${sender.id}) konnte nicht an Ziel ${signalData.to} weitergeleitet werden. Ziel existiert nicht, ist nicht verbunden oder nicht im selben Raum ${sender.roomId}.`);
                // Optional: Dem Sender Bescheid geben, dass das Ziel ungültig ist
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
             connectedUsers.set(socket.id, sender);

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
            connectedUsers.delete(socket.id);

            // Informiere die verbleibenden Clients über die Änderung
            sendUserListUpdate(formerRoomId);

        } else {
            console.log(`[Disconnect] Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
    });

    // Server lauscht nicht explizit auf 'requestInitialState'.
    // Der Client erhält seinen Initialzustand (eigene ID und Benutzerliste)
    // durch das 'joinSuccess' Event und das nachfolgende 'user list' Broadcast.
    // socket.on('requestInitialState', () => { ... }); // NICHT BENÖTIGT mit der aktuellen Logik

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
