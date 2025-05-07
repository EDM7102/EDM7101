const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statische Dateien (HTML + JS + CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Nutzerliste
const users = new Map();

io.on('connection', socket => {
  let currentUser = '';

  socket.on('join', ({ username }) => {
    currentUser = username;
    users.set(socket.id, username);
    io.emit('users', Array.from(users.values()));
  });

  socket.on('message', (data) => {
    io.emit('message', data);
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('users', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server läuft unter http://localhost:${PORT}`);
});
