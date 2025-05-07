const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Statische Dateien aus /public servieren
app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();

io.on('connection', socket => {
  let currentUser = '';

  socket.on('join', ({ username }) => {
    currentUser = username;
    users.set(socket.id, username);
    io.emit('users', Array.from(users.values()));
  });

  socket.on('message', data => {
    io.emit('message', data);
  });

  // WebRTC Signaling
  socket.on('offer', data => {
    socket.to(data.target).emit('offer', { from: socket.id, sdp: data.sdp });
  });

  socket.on('answer', data => {
    socket.to(data.target).emit('answer', { from: socket.id, sdp: data.sdp });
  });

  socket.on('ice', data => {
    socket.to(data.target).emit('ice', { from: socket.id, candidate: data.candidate });
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    io.emit('users', Array.from(users.values()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ EDMBOOK läuft auf http://localhost:${PORT}`);
});
