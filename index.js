const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Signaling server is running.");
});

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 3001;

let waitingUsers = [];

function wants(pref, gender) {
  return pref === 'everyone' || pref === gender;
}

function areCompatible(a, b) {
  return wants(a.matchPref, b.gender) && wants(b.matchPref, a.gender);
}

function removeFromWaiting(socketId) {
  const idx = waitingUsers.findIndex((u) => u.socketId === socketId);
  if (idx !== -1) waitingUsers.splice(idx, 1);
}

io.on('connection', (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("status", { connected: true });

  socket.on('disconnect', () => {
    console.log("Client disconnected:", socket.id);
    removeFromWaiting(socket.id);

    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => {
      socket.to(roomId).emit('peer-leave');
      socket.leave(roomId);
    });
  });

  socket.on('find-match', ({ userId, youGender, matchPref }) => {
    console.log("Find match:", userId, youGender, matchPref);

    removeFromWaiting(socket.id);

    const partner = waitingUsers.find(u => u.socketId !== socket.id &&
                                            areCompatible(u, { gender: youGender, matchPref }));

    if (!partner) {
      waitingUsers.push({ socketId: socket.id, gender: youGender, matchPref });
      console.log("User added to queue:", socket.id);
      return;
    }

    removeFromWaiting(partner.socketId);

    const partnerSocket = io.sockets.sockets.get(partner.socketId);
    if (!partnerSocket) {
      socket.emit("match-error", { message: "partner-disconnected" });
      return;
    }

    const roomId = "room_" + Date.now();

    socket.join(roomId);
    partnerSocket.join(roomId);

    socket.emit("joined", { roomId, peers: 1 });
    partnerSocket.emit("joined", { roomId, peers: 1 });

    socket.emit("matched", { roomId, polarity: "caller" });
    partnerSocket.emit("matched", { roomId, polarity: "receiver" });
  });

  socket.on("offer", ({ sdp }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach(roomId => socket.to(roomId).emit("offer", { sdp }));
  });

  socket.on("answer", ({ sdp }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach(roomId => socket.to(roomId).emit("answer", { sdp }));
  });

  socket.on("ice", ({ candidate }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach(roomId => socket.to(roomId).emit("ice", { candidate }));
  });

  socket.on("leave", () => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach(roomId => {
      socket.to(roomId).emit("peer-leave");
      socket.leave(roomId);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Signaling server running on port ${PORT}`);
});
