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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Neuer Benutzer verbunden: ${socket.id}`);

    socket.on('join', (data) => {
        if (!data.username || data.username.trim() === '') {
            socket.emit('joinError', { message: 'Benutzername darf nicht leer sein.' });
            return;
        }
        // Optional: Prüfen, ob Benutzername bereits vergeben ist
        for (let user of connectedUsers.values()) {
            if (user.username === data.username) {
                socket.emit('joinError', { message: 'Benutzername bereits vergeben.' });
                return;
            }
        }

        const newUser = {
            id: socket.id,
            username: data.username,
            color: data.color,
        };
        connectedUsers.set(socket.id, newUser);

        socket.emit('joinSuccess', {
            id: socket.id,
            users: Array.from(connectedUsers.values())
        });

        io.emit('userListUpdate', Array.from(connectedUsers.values()));
        console.log(`${data.username} (${socket.id}) ist beigetreten. Aktuelle Benutzer: ${connectedUsers.size}`);
    });

    socket.on('message', (msgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            io.emit('message', { ...msgData, username: sender.username, color: sender.color });
            console.log(`Nachricht von ${sender.username}: ${msgData.text}`);
        }
    });

    socket.on('file', (fileMsgData) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            io.emit('file', { ...fileMsgData, username: sender.username, color: sender.color });
            console.log(`Datei von ${sender.username}: ${fileMsgData.fileName}`);
        }
    });

    socket.on('typing', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender) {
            socket.broadcast.emit('typing', { username: sender.username, isTyping: data.isTyping });
        }
    });

    socket.on('webrtcSignaling', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (sender && data.target) {
            io.to(data.target).emit('webrtcSignaling', { ...data, from: socket.id });
        } else if (sender && !data.target) {
            console.warn(`WebRTC Signal von ${sender.username} ohne Ziel empfangen.`);
        }
    });

    socket.on('disconnect', (reason) => {
        const disconnectingUser = connectedUsers.get(socket.id);
        if (disconnectingUser) {
            console.log(`${disconnectingUser.username} (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
            connectedUsers.delete(socket.id);
            io.emit('userListUpdate', Array.from(connectedUsers.values()));
            console.log(`Aktuelle Benutzer: ${connectedUsers.size}`);
        } else {
            console.log(`Unbekannter Benutzer (${socket.id}) hat die Verbindung getrennt. Grund: ${reason}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`EDMBook Chat Server läuft auf Port ${PORT}`);
});