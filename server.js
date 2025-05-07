const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statische Dateien aus dem 'public'-Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map(); // socket.id => username

io.on('connection', socket => {
  let currentUsername = '';

  // Benutzer tritt bei
  socket.on('join', ({ username }) => {
    currentUsername = username;
    users.set(socket.id, username);
    sendUserList();
    socket.broadcast.emit('userJoined', { username }); // Optional für Ton/Benachrichtigung
  });

  // Chat-Nachrichten
  socket.on('message', data => {
    io.emit('message', data); // { username, text, color }
  });

  // Datei-Upload (Base64, kleine Dateien)
  socket.on('file', data => {
    // { username, fileName, fileType, fileData, color }
    io.emit('file', data);
  });

  // Tippanzeige ("XYZ schreibt …")
  socket.on('typing', ({ username, typing }) => {
    socket.broadcast.emit('typing', { username });
  });

  // WebRTC: Angebot (Offer)
  socket.on('offer', ({ target, sdp }) => {
    io.to(target).emit('offer', { from: socket.id, sdp });
  });

  // WebRTC: Antwort (Answer)
  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { from: socket.id, sdp });
  });

  // WebRTC: ICE-Kandidat
  socket.on('ice', ({ target, candidate }) => {
    io.to(target).emit('ice', { from: socket.id, candidate });
  });

  // Benutzer trennt Verbindung
  socket.on('disconnect', () => {
    users.delete(socket.id);
    sendUserList();
  });

  // Benutzerliste an alle senden
  function sendUserList() {
    const list = Array.from(users.entries()).map(([id, name]) => ({ id, name }));
    io.emit('users', list);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ EDMBOOK Server läuft auf http://localhost:${PORT}`);
});