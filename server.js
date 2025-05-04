const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// ===== CORS-Fix (optional, aber sicher für externes Frontend) =====
app.use(cors());

// ===== Static Files =====
app.use(express.static(__dirname));
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ===== File Upload via Multer =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});
const upload = multer({ storage });

app.post('/upload', upload.array('files'), (req, res) => {
  const files = req.files.map(file => ({
    name: file.originalname,
    url: /uploads/${file.filename}
  }));
  res.json({ files });
});

app.use('/uploads', express.static(uploadDir));

// ===== Socket.IO: Chat + WebRTC Signaling =====
const userIPs = new Set();

io.on('connection', socket => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  userIPs.add(ip);

  socket.on('join', room => {
    socket.join(room);
    socket.room = room;
    io.to(room).emit('users', Array.from(userIPs));
  });

  socket.on('get_users', room => {
    io.to(socket.id).emit('users', Array.from(userIPs));
  });

  socket.on('message', data => {
    socket.to(data.room).emit('message', data);
  });

  socket.on('offer', data => {
    socket.to(data.room).emit('offer', data);
  });

  socket.on('answer', data => {
    socket.to(data.room).emit('answer', data);
  });

  socket.on('ice', data => {
    socket.to(data.room).emit('ice', data);
  });

  socket.on('disconnect', () => {
    userIPs.delete(ip);
    io.emit('users', Array.from(userIPs));
  });
});

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(✅ Server läuft auf Port ${PORT});
});
