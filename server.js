
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 2e6
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "lol rec" });
});

const rooms = new Map();

function cleanText(value, max = 40) {
  return String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, max);
}

function validImage(value) {
  return typeof value === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/.test(value) &&
    value.length <= 700000;
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, name, avatar } = {}) => {
    roomId = cleanText(roomId, 24)
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "");

    name = cleanText(name, 24);

    if (!roomId || !name) {
      socket.emit("join-error", "Informe seu nome e o código da sala.");
      return;
    }

    let room = rooms.get(roomId);

    if (!room) {
      room = {
        users: new Map(),
        avatars: new Map(),
        sharerId: null
      };
      rooms.set(roomId, room);
    }

    if (room.users.size >= 12) {
      socket.emit("join-error", "Esta sala já atingiu o limite de 12 pessoas.");
      return;
    }

    const safeAvatar = validImage(avatar) ? avatar : "";

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    room.users.set(socket.id, name);
    room.avatars.set(socket.id, safeAvatar);

    socket.emit("room-joined", {
      roomId,
      selfId: socket.id,
      users: [...room.users].map(([id, userName]) => ({
        id,
        name: userName,
        avatar: room.avatars.get(id) || ""
      })),
      sharerId: room.sharerId
    });

    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name,
      avatar: safeAvatar
    });

    io.to(roomId).emit("system-message", `${name} entrou na sala.`);
  });

  socket.on("avatar-update", (avatar) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || !validImage(avatar)) return;

    room.avatars.set(socket.id, avatar);

    io.to(roomId).emit("avatar-updated", {
      id: socket.id,
      avatar
    });
  });

  socket.on("chat-message", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (typeof data === "string") {
      const message = cleanText(data, 500);
      if (!message) return;

      io.to(roomId).emit("chat-message", {
        type: "text",
        id: socket.id,
        name: socket.data.name,
        message,
        time: new Date().toISOString()
      });

      return;
    }

    if (data?.type === "image" && validImage(data.image)) {
      io.to(roomId).emit("chat-message", {
        type: "image",
        id: socket.id,
        name: socket.data.name,
        image: data.image,
        time: new Date().toISOString()
      });
    }
  });

  socket.on("screen-start", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;

    if (room.sharerId && room.sharerId !== socket.id) {
      socket.emit("screen-error", "Outra pessoa já está compartilhando a tela.");
      return;
    }

    room.sharerId = socket.id;

    io.to(socket.data.roomId).emit("screen-started", {
      id: socket.id,
      name: socket.data.name
    });
  });

  socket.on("screen-stop", () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.sharerId !== socket.id) return;

    room.sharerId = null;
    io.to(socket.data.roomId).emit("screen-stopped", {
      id: socket.id
    });
  });

  // Sinais para compartilhamento de tela e conversa por voz.
  for (const event of [
    "webrtc-offer",
    "webrtc-answer",
    "webrtc-ice",
    "voice-offer",
    "voice-answer",
    "voice-ice"
  ]) {
    socket.on(event, ({ to, ...payload } = {}) => {
      const room = rooms.get(socket.data.roomId);
      if (!room || !room.users.has(to)) return;

      io.to(to).emit(event, {
        from: socket.id,
        ...payload
      });
    });
  }

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room) return;

    room.users.delete(socket.id);
    room.avatars.delete(socket.id);

    if (room.sharerId === socket.id) {
      room.sharerId = null;
      io.to(roomId).emit("screen-stopped", {
        id: socket.id
      });
    }

    socket.to(roomId).emit("user-left", {
      id: socket.id
    });

    if (socket.data.name) {
      io.to(roomId).emit(
        "system-message",
        `${socket.data.name} saiu da sala.`
      );
    }

    if (room.users.size === 0) {
      rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`lol rec rodando na porta ${PORT}`);
});
