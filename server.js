const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serviert statische Dateien aus dem Ordner 'public'
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map(); // socket.id => username

io.on('connection', socket => {
  let currentUsername = '';

  socket.on('join', ({ username }) => {
    currentUsername = username;
    users.set(socket.id, username);
    sendUserList();
  });

  socket.on('message', data => {
    io.emit('message', data); // { username, text, color }
  });

  socket.on('offer', ({ target, sdp }) => {
    io.to(target).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ target, sdp }) => {
    io.to(target).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice', ({ target, candidate }) => {
    io.to(target).emit('ice', { from: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    sendUserList();
  });

  function sendUserList() {
    const list = Array.from(users.entries()).map(([id, name]) => ({ id, name }));
    io.emit('users', list);
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ EDMBOOK Server läuft auf http://localhost:${PORT}`);
});
