const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ===== Upload-Verzeichnis vorbereiten =====
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ===== Middlewares =====
app.use(cors());
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

// ===== Multer-Konfiguration für Datei-Upload =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage });

app.post('/upload', upload.array('files'), (req, res) => {
  const files = req.files.map(file => ({
    name: file.originalname,
    url: `/uploads/${file.filename}`
  }));
  res.json({ files });
});

// ===== Socket.IO: WebRTC & Chat-Management =====
const rooms = {}; // { roomName: { socketId: username } }

io.on('connection', socket => {
  console.log(`🔌 Verbindung: ${socket.id}`);

  socket.on('join', ({ room, username }) => {
    socket.join(room);
    socket.room = room;
    socket.username = username;

    if (!rooms[room]) rooms[room] = {};
    rooms[room][socket.id] = username;

    // Informiere neuen Client über alle vorhandenen Nutzer (außer sich selbst)
    const users = Object.keys(rooms[room]).filter(id => id !== socket.id);
    socket.emit('users', users.map(id => ({ id, name: rooms[room][id] })));

    // Informiere andere Clients über den Neuzugang
    socket.to(room).emit('new-user', { id: socket.id, name: username });
  });

  // WebRTC-Signale weiterleiten (direkt an bestimmte Peers)
  socket.on('offer', ({ to, sdp }) => io.to(to).emit('offer', { from: socket.id, sdp }));
  socket.on('answer', ({ to, sdp }) => io.to(to).emit('answer', { from: socket.id, sdp }));
  socket.on('ice-candidate', ({ to, candidate }) => io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

  socket.on('message', ({ room, user, text }) => {
    socket.to(room).emit('message', { user, text });
  });

  socket.on('disconnect', () => {
    const room = socket.room;
    if (room && rooms[room]) {
      delete rooms[room][socket.id];
      socket.to(room).emit('user-left', socket.id);
      if (Object.keys(rooms[room]).length === 0) delete rooms[room];
    }
    console.log(`❌ Getrennt: ${socket.id}`);
  });
});

// ===== Server starten =====
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server läuft auf Port ${PORT}`));
