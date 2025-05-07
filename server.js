const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); // Korrekter Import für Socket.IO v4+
const path = require('path');

const app = express();
const server = http.createServer(app);
// Füge CORS hinzu für mehr Flexibilität (besonders für lokale Tests oder spezielle Deployments)
const io = new Server(server, {
    cors: {
        origin: "*", // Erlaube alle Ursprünge (für Produktion anpassen!)
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Speichert die verbundenen Benutzer: { socketId: { username, color, id, roomId } }
const connectedUsers = new Map();

// Statische Dateien ausliefern (HTML, CSS, Client-JS)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Middleware für die initiale Verbindung und Authentifizierung
io.use((socket, next) => {
    // Lese Daten aus socket.handshake.auth, die der Client beim io() call mitsendet
    const username = socket.handshake.auth.username;
    const roomId = socket.handshake.auth.roomId;
    // const color = socket.handshake.auth.color; // Client sendet aktuell keine Farbe bei Auth

    // Validierung
    if (!username || username.trim() === '') {
        console.error(`Verbindungsversuch ohne Benutzername von Socket ${socket.id}`);
        return next(new Error('Benutzername ist erforderlich'));
    }
    if (!roomId || roomId.trim() === '') {
        console.error(`Verbindungsversuch ohne Raum-ID von Socket ${socket.id}`);
        return next(new Error('Raum-ID ist erforderlich'));
    }

    // Optional: Prüfen, ob Benutzername bereits im Raum vergeben ist
    for (let user of connectedUsers.values()) {
        if (user.roomId === roomId && user.username === username) {
             console.warn(`Benutzername '${username}' in Raum '${roomId}' bereits vergeben.`);
            return next(new Error('Benutzername in diesem Raum bereits vergeben'));
        }
    }

    // Speichere die validierten Daten am Socket-Objekt für späteren Zugriff
    socket.username = username;
    socket.roomId = roomId;
    socket.userColor = getRandomColor(socket.id); // Weise eine Farbe zu

    console.log(`Auth erfolgreich für: ${username} in Raum ${roomId}`);
    next(); // Erlaube die Verbindung
});

io.on('connection', (socket) => {
    // Die Daten (username, roomId, userColor) sind jetzt am socket-Objekt verfügbar
    console.log(`Benutzer '${socket.username}' (${socket.id}) verbunden mit Raum '${socket.roomId}'.`);

    // Benutzer registrieren
    const newUser = {
        id: socket.id,
        username: socket.username,
        color: socket.userColor,
        roomId: socket.roomId
    };
    connectedUsers.set(socket.id, newUser);

    // Socket zum Socket.IO Raum hinzufügen
    socket.join(socket.roomId);

    // Sende Liste der User *in diesem Raum* an den neuen User
    const usersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === socket.roomId);
    socket.emit('joinSuccess', { // Oder benutze 'userListUpdate', wenn der Client das erwartet
        id: socket.id,
        users: usersInRoom
    });

    // Informiere ALLE im Raum (auch den Neuen) über die aktualisierte Userliste
    io.to(socket.roomId).emit('userListUpdate', usersInRoom);

    console.log(`Benutzer '${socket.username}' registriert. Benutzer im Raum '${socket.roomId}': ${usersInRoom.length}`);

    // Nachrichtenverarbeitung (nur an den spezifischen Raum senden)
    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            // Sende Nachricht an alle im Raum des Senders
            io.to(sender.roomId).emit('message', {
                ...msgData, // Client sendet { content, timestamp }
                username: sender.username, // Server fügt hinzu
                color: sender.color       // Server fügt hinzu
            });
            // console.log(`Nachricht in Raum ${sender.roomId} von ${sender.username}`);
        }
    });

    // Dateiverarbeitung (nur an den spezifischen Raum senden)
    socket.on('file', (fileMsgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && fileMsgData.file) {
             // Sende Datei-Info an alle im Raum des Senders
             io.to(sender.roomId).emit('file', {
                 ...fileMsgData, // Client sendet { content (optional), file: { name, type, size, dataUrl? } }
                 username: sender.username,
                 color: sender.color,
                 timestamp: fileMsgData.timestamp || new Date().toISOString()
             });
            // console.log(`Datei in Raum ${sender.roomId} von ${sender.username}: ${fileMsgData.file.name}`);
        }
    });

    // Tipp-Indikator (nur an *andere* im Raum senden)
    socket.on('typing', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            socket.to(sender.roomId).emit('typing', { username: sender.username, isTyping: data.isTyping });
        }
    });

    // WebRTC Signalisierungsnachrichten weiterleiten
    socket.on('webRTC-offer', (data) => handleWebRTCSignal(socket, data, 'webRTC-offer'));
    socket.on('webRTC-answer', (data) => handleWebRTCSignal(socket, data, 'webRTC-answer'));
    socket.on('webRTC-ice-candidate', (data) => handleWebRTCSignal(socket, data, 'webRTC-ice-candidate'));

    // Benutzer verlässt den Chat
    socket.on('disconnect', (reason) => {
        const disconnectingUser = connectedUsers.get(socket.id);
        if (disconnectingUser) {
            const formerRoomId = disconnectingUser.roomId; // Raum merken
            console.log(`Benutzer '${disconnectingUser.username}' (${socket.id}) hat die Verbindung getrennt (Raum: ${formerRoomId}). Grund: ${reason}`);
            connectedUsers.delete(socket.id);

            // Informiere verbleibende Benutzer *im selben Raum*
            const remainingUsersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === formerRoomId);
            io.to(formerRoomId).emit('userListUpdate', remainingUsersInRoom); // Nur an den Raum senden
            console.log(`Benutzer im Raum '${formerRoomId}': ${remainingUsersInRoom.length}`);
        } else {
            // console.log(`Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
        // Socket verlässt automatisch alle Räume bei disconnect
    });
});

// Hilfsfunktion für WebRTC Signalisierung
function handleWebRTCSignal(socket, data, eventName) {
    const sender = connectedUsers.get(socket.id);
    if (sender && data.to && data.to !== socket.id) {
        // Sende nur an das spezifische Ziel ('to')
        io.to(data.to).emit(eventName, {
            ...data, // Beinhaltet sdp oder candidate oder answer
            from: socket.id // Füge hinzu, wer sendet
         });
    } else if(sender && !data.to) {
         console.warn(`${eventName} von ${sender.username} ohne Ziel ('to') empfangen.`);
    }
}

// Hilfsfunktion für Zufallsfarben
function getRandomColor(id) {
     const colors = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548'];
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
