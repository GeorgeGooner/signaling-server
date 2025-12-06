const { Server } = require("socket.io");

// Το Render θα δώσει PORT μέσω process.env.PORT.
// Το 10000 είναι απλώς default για τοπικό testing.
const PORT = process.env.PORT || 10000;

const io = new Server({
  cors: {
    origin: "*",
  },
});

let waitingUsers = [];

function wants(pref, gender) {
  return pref === "everyone" || pref === gender;
}

function areCompatible(a, b) {
  return wants(a.matchPref, b.gender) && wants(b.matchPref, a.gender);
}

function removeFromWaiting(socketId) {
  const idx = waitingUsers.findIndex((u) => u.socketId === socketId);
  if (idx !== -1) waitingUsers.splice(idx, 1);
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.emit("status", { connected: true });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    removeFromWaiting(socket.id);

    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => {
      socket.to(roomId).emit("peer-leave");
      socket.leave(roomId);
    });
  });

  socket.on("find-match", ({ userId, youGender, matchPref }) => {
    console.log("Find match:", userId, youGender, matchPref);

    // σιγουρευόμαστε ότι δεν μένει διπλό στην ουρά
    removeFromWaiting(socket.id);

    const partner = waitingUsers.find(
      (u) =>
        u.socketId !== socket.id &&
        areCompatible(u, { gender: youGender, matchPref })
    );

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
    rooms.forEach((roomId) => socket.to(roomId).emit("offer", { sdp }));
  });

  socket.on("answer", ({ sdp }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => socket.to(roomId).emit("answer", { sdp }));
  });

  socket.on("ice", ({ candidate }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => socket.to(roomId).emit("ice", { candidate }));
  });

  socket.on("leave", () => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => {
      socket.to(roomId).emit("peer-leave");
      socket.leave(roomId);
    });
  });
});

// ΕΔΩ σηκώνουμε πραγματικά τον server
io.listen(PORT);
console.log(`Signaling server running on port ${PORT}`);
