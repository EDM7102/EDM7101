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
    const username = socket.handshake.auth.username;
    const roomId = socket.handshake.auth.roomId;

    if (!username || username.trim() === '') {
        console.error(`Verbindungsversuch ohne Benutzername von Socket ${socket.id}`);
        return next(new Error('Benutzername ist erforderlich'));
    }
    if (!roomId || roomId.trim() === '') {
        console.error(`Verbindungsversuch ohne Raum-ID von Socket ${socket.id}`);
        return next(new Error('Raum-ID ist erforderlich'));
    }

    for (let user of connectedUsers.values()) {
        if (user.roomId === roomId && user.username === username) {
             console.warn(`Benutzername '${username}' in Raum '${roomId}' bereits vergeben.`);
            return next(new Error('Benutzername in diesem Raum bereits vergeben'));
        }
    }

    socket.username = username;
    socket.roomId = roomId;
    socket.userColor = getRandomColor(socket.id);

    console.log(`Auth erfolgreich für: ${username} in Raum ${roomId} (Socket ID: ${socket.id})`);
    next();
});

io.on('connection', (socket) => {
    console.log(`Benutzer '${socket.username}' (${socket.id}) verbunden mit Raum '${socket.roomId}'.`);

    const newUser = {
        id: socket.id,
        username: socket.username,
        color: socket.userColor,
        roomId: socket.roomId
    };
    connectedUsers.set(socket.id, newUser);

    socket.join(socket.roomId);

    const usersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === socket.roomId);
    // Sende an den neu verbundenen Benutzer seine ID und die aktuelle Benutzerliste des Raumes
    socket.emit('joinSuccess', { 
        id: socket.id,
        users: usersInRoom
    });

    // Informiere ALLE im Raum (auch den Neuen) über die aktualisierte Userliste
    io.to(socket.roomId).emit('userListUpdate', usersInRoom);
    console.log(`Benutzer '${socket.username}' registriert. Benutzer im Raum '${socket.roomId}': ${usersInRoom.length}`);

    // Nachrichtenverarbeitung
    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            console.log(`Nachricht in Raum ${sender.roomId} von ${sender.username}: ${msgData.content}`);
            io.to(sender.roomId).emit('message', { // Event-Name ist 'message'
                ...msgData, 
                username: sender.username,
                color: sender.color
            });
        } else {
            console.error(`Nachricht von unbekanntem Socket ${socket.id} empfangen.`);
        }
    });

    // Dateiverarbeitung
    socket.on('file', (fileMsgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && fileMsgData.file) {
             console.log(`Datei in Raum ${sender.roomId} von ${sender.username}: ${fileMsgData.file.name}`);
             io.to(sender.roomId).emit('file', {
                 ...fileMsgData,
                 username: sender.username,
                 color: sender.color,
                 timestamp: fileMsgData.timestamp || new Date().toISOString()
             });
        }
    });

    // Tipp-Indikator
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
            const formerRoomId = disconnectingUser.roomId;
            console.log(`Benutzer '${disconnectingUser.username}' (${socket.id}) hat die Verbindung getrennt (Raum: ${formerRoomId}). Grund: ${reason}`);
            connectedUsers.delete(socket.id);

            const remainingUsersInRoom = Array.from(connectedUsers.values()).filter(user => user.roomId === formerRoomId);
            io.to(formerRoomId).emit('userListUpdate', remainingUsersInRoom);
            console.log(`Benutzerliste für Raum '${formerRoomId}' aktualisiert. Verbleibende Benutzer: ${remainingUsersInRoom.length}`);
        } else {
            console.log(`Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
    });
});

// Hilfsfunktion für WebRTC Signalisierung
function handleWebRTCSignal(socket, data, eventName) {
    const sender = connectedUsers.get(socket.id);
    if (!sender) {
        console.error(`${eventName} von einem nicht registrierten Socket ${socket.id} empfangen.`);
        return;
    }
    if (data.to && data.to !== socket.id) {
        console.log(`${eventName} von ${sender.username} (${socket.id}) an ${data.to}`);
        io.to(data.to).emit(eventName, {
            ...data, 
            from: socket.id 
         });
    } else if (!data.to) {
         console.warn(`${eventName} von ${sender.username} ohne Ziel ('to') empfangen. Data:`, data);
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
