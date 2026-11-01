const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, app: "lol rec" }));

const rooms = new Map(); // roomId -> { users: Map(socketId -> name), sharerId }

function cleanText(value, max = 40) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, max);
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, name } = {}) => {
    roomId = cleanText(roomId, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    name = cleanText(name, 24);
    if (!roomId || !name) {
      socket.emit("join-error", "Informe seu nome e o código da sala.");
      return;
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = { users: new Map(), sharerId: null };
      rooms.set(roomId, room);
    }
    if (room.users.size >= 12) {
      socket.emit("join-error", "Esta sala já atingiu o limite de 12 pessoas.");
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;
    room.users.set(socket.id, name);

    socket.emit("room-joined", {
      roomId,
      selfId: socket.id,
      users: [...room.users].map(([id, userName]) => ({ id, name: userName })),
      sharerId: room.sharerId
    });
    socket.to(roomId).emit("user-joined", { id: socket.id, name });
    io.to(roomId).emit("system-message", `${name} entrou na sala.`);
  });

  socket.on("chat-message", (message) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const text = cleanText(message, 500);
    if (!text) return;
    io.to(roomId).emit("chat-message", {
      id: socket.id,
      name: socket.data.name,
      message: text,
      time: new Date().toISOString()
    });
  });

  socket.on("screen-start", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.sharerId && room.sharerId !== socket.id) {
      socket.emit("screen-error", "Outra pessoa já está compartilhando a tela.");
      return;
    }
    room.sharerId = socket.id;
    io.to(roomId).emit("screen-started", { id: socket.id, name: socket.data.name });
  });

  socket.on("screen-stop", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.sharerId !== socket.id) return;
    room.sharerId = null;
    io.to(roomId).emit("screen-stopped", { id: socket.id });
  });

  // WebRTC signaling: media travels peer-to-peer, not through this server.
  for (const event of ["webrtc-offer", "webrtc-answer", "webrtc-ice"]) {
    socket.on(event, ({ to, ...payload } = {}) => {
      const roomId = socket.data.roomId;
      const room = rooms.get(roomId);
      if (!room || !room.users.has(to)) return;
      io.to(to).emit(event, { from: socket.id, ...payload });
    });
  }

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room) return;
    room.users.delete(socket.id);
    if (room.sharerId === socket.id) {
      room.sharerId = null;
      io.to(roomId).emit("screen-stopped", { id: socket.id });
    }
    socket.to(roomId).emit("user-left", { id: socket.id });
    if (socket.data.name) io.to(roomId).emit("system-message", `${socket.data.name} saiu da sala.`);
    if (room.users.size === 0) rooms.delete(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`lol rec rodando na porta ${PORT}`));
