const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Speichert die verbundenen Benutzer: { socketId: { username, color, id } }
const connectedUsers = new Map();

// Statische Dateien ausliefern (HTML, CSS, Client-JS)
// Erstelle einen Ordner "public" und lege deine index.html, app.js, style.css etc. dort hinein.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Neuer Benutzer verbunden: ${socket.id}`);

    // Benutzer tritt dem Chat bei
    socket.on('join', (data) => {
        if (!data.username || data.username.trim() === '') {
            socket.emit('joinError', { message: 'Benutzername darf nicht leer sein.' });
            return;
        }
        // Optional: Prüfen, ob Benutzername bereits vergeben ist
        // for (let user of connectedUsers.values()) {
        //     if (user.username === data.username) {
        //         socket.emit('joinError', { message: 'Benutzername bereits vergeben.' });
        //         return;
        //     }
        // }

        const newUser = {
            id: socket.id,
            username: data.username,
            color: data.color,
        };
        connectedUsers.set(socket.id, newUser);

        // Erfolgsmeldung an den neuen Benutzer mit seiner ID und der aktuellen Benutzerliste
        socket.emit('joinSuccess', {
            id: socket.id,
            users: Array.from(connectedUsers.values())
        });

        // Alle anderen über den neuen Benutzer informieren (Update der Benutzerliste)
        // Wichtig: 'userListUpdate' wird auch an den neu beigetretenen Benutzer gesendet,
        // damit seine eigene Liste auch durch diese Logik aktualisiert wird.
        io.emit('userListUpdate', Array.from(connectedUsers.values()));

        console.log(`${data.username} (${socket.id}) ist beigetreten. Aktuelle Benutzer: ${connectedUsers.size}`);
    });

    // Nachrichtenverarbeitung
    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            // Sende die Nachricht an alle verbundenen Clients außer dem Absender selbst
            // socket.broadcast.emit('message', { ...msgData, username: sender.username, color: sender.color });
            // Oder an alle, inklusive Absender (Client kann Duplikate filtern oder auch nicht)
            // Deine Client-Logik `appendMessageToDOM` fügt die eigene Nachricht schon hinzu,
            // daher ist es besser, wenn der Server die Nachricht an alle *anderen* sendet,
            // oder der Client intelligent genug ist, doppelte Nachrichten zu ignorieren.
            // Für Einfachheit senden wir es an alle und der Client kann entscheiden.
            // In deiner app.js wird die eigene Nachricht nicht optimistisch hinzugefügt,
            // daher ist es okay, wenn der Server sie zurücksendet.
            io.emit('message', { ...msgData, username: sender.username, color: sender.color });
            console.log(`Nachricht von ${sender.username}: ${msgData.text}`);
        }
    });

    // Dateiverarbeitung
    socket.on('file', (fileMsgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            io.emit('file', { ...fileMsgData, username: sender.username, color: sender.color });
            console.log(`Datei von ${sender.username}: ${fileMsgData.fileName}`);
        }
    });

    // Tipp-Indikator
    socket.on('typing', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            socket.broadcast.emit('typing', { username: sender.username, isTyping: data.isTyping });
        }
    });

    // WebRTC Signalisierungsnachrichten weiterleiten
    socket.on('webrtcSignaling', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && data.target) {
            // console.log(`WebRTC Signal von ${sender.username} (${socket.id}) an ${data.target}: ${data.type}`);
            // Füge 'from' hinzu, damit der Empfänger weiß, von wem die Nachricht kommt.
            io.to(data.target).emit('webrtcSignaling', { ...data, from: socket.id });
        } else if (sender && !data.target) {
            console.warn(`WebRTC Signal von ${sender.username} ohne Ziel empfangen.`);
        }
    });

    // Benutzer verlässt den Chat
    socket.on('disconnect', (reason) => {
        const disconnectingUser = connectedUsers.get(socket.id);
        if (disconnectingUser) {
            console.log(`${disconnectingUser.username} (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
            connectedUsers.delete(socket.id);
            // Alle verbleibenden Benutzer über die Änderung informieren
            io.emit('userListUpdate', Array.from(connectedUsers.values()));
            console.log(`Aktuelle Benutzer: ${connectedUsers.size}`);
        } else {
            console.log(`Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});
