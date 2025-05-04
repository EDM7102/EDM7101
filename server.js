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
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// CORS für Express
app.use(cors());

// Datei-Upload Konfiguration
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB Limit
});

// Datenstruktur für Räume und Benutzer
const rooms = new Map(); // { roomId: { users: Map(socketId => username) } }

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Upload-Endpoint
app.post('/upload', upload.array('files'), (req, res) => {
  const files = req.files.map(file => ({
    name: file.originalname,
    url: `/uploads/${file.filename}`,
    size: file.size
  }));
  res.json({ files });
});

// Socket.IO Logik
io.on('connection', (socket) => {
  console.log(`Neue Verbindung: ${socket.id}`);

  // Raum-Beitritt mit Benutzername
  socket.on('join', (roomId, username) => {
    socket.join(roomId);
    socket.data.room = roomId;
    socket.data.username = username;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        connections: new Map()
      });
    }

    const room = rooms.get(roomId);
    room.users.set(socket.id, username);

    // Aktualisiere Benutzerliste für alle im Raum
    updateUserList(roomId);
  });

  // WebRTC Signal: Offer
  socket.on('offer', (data) => {
    const { offer, targetUser } = data;
    const roomId = socket.data.room;
    const room = rooms.get(roomId);
    if (!room) return;

    // Finde Ziel-Socket-ID
    const targetEntry = [...room.users.entries()]
      .find(([_, username]) => username === targetUser);
    
    if (targetEntry) {
      const [targetSocketId] = targetEntry;
      io.to(targetSocketId).emit('offer', {
        offer,
        senderId: socket.id,
        senderUser: socket.data.username
      });
    }
  });

  // WebRTC Signal: Answer
  socket.on('answer', (data) => {
    const { answer, targetUser } = data;
    const roomId = socket.data.room;
    const room = rooms.get(roomId);
    if (!room) return;

    // Finde Ziel-Socket-ID
    const targetEntry = [...room.users.entries()]
      .find(([_, username]) => username === targetUser);
    
    if (targetEntry) {
      const [targetSocketId] = targetEntry;
      io.to(targetSocketId).emit('answer', {
        answer,
        senderId: socket.id,
        senderUser: socket.data.username
      });
    }
  });

  // WebRTC Signal: ICE Candidate
  socket.on('ice', (data) => {
    const { candidate, targetUser } = data;
    const roomId = socket.data.room;
    const room = rooms.get(roomId);
    if (!room) return;

    // Finde Ziel-Socket-ID
    const targetEntry = [...room.users.entries()]
      .find(([_, username]) => username === targetUser);
    
    if (targetEntry) {
      const [targetSocketId] = targetEntry;
      io.to(targetSocketId).emit('ice', {
        candidate,
        senderId: socket.id,
        senderUser: socket.data.username
      });
    }
  });

  // Chat-Nachricht
  socket.on('message', (data) => {
    socket.to(data.room).emit('message', {
      ...data,
      user: socket.data.username // Stellt sicher, dass der richtige Benutzername verwendet wird
    });
  });

  // Verbindungstrennung
  socket.on('disconnect', () => {
    const roomId = socket.data.room;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.users.delete(socket.id);
      updateUserList(roomId);
    }
  });

  // Hilfsfunktion zur Aktualisierung der Benutzerliste
  function updateUserList(roomId) {
    const room = rooms.get(roomId);
    if (room) {
      const users = [...room.users.values()];
      io.to(roomId).emit('users', users);
    }
  }
});

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
  console.log(`📁 Upload-Verzeichnis: ${uploadDir}`);
});
