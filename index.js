const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3001;

const waitingUsers = [];

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
  console.log('Client connected:', socket.id);

  socket.emit('status', { connected: true });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    removeFromWaiting(socket.id);

    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => {
      socket.to(roomId).emit('peer-leave');
      socket.leave(roomId);
    });
  });

  socket.on('find-match', (payload) => {
    const { userId, youGender, matchPref, isPremium } = payload;

    socket.data.matchInfo = { userId, gender: youGender, matchPref, isPremium };

    let partnerIndex = -1;

    if (isPremium) {
      partnerIndex = waitingUsers.findIndex(
        (u) => u.isPremium && areCompatible(u, socket.data.matchInfo)
      );
    }

    if (partnerIndex === -1) {
      partnerIndex = waitingUsers.findIndex((u) =>
        areCompatible(u, socket.data.matchInfo),
      );
    }

    if (partnerIndex === -1) {
      waitingUsers.push({
        socketId: socket.id,
        userId,
        gender: youGender,
        matchPref,
        isPremium,
      });

      socket.emit('joined', { roomId: null, peers: 0 });

      setTimeout(() => {
        const stillWaiting = waitingUsers.find((u) => u.socketId === socket.id);
        if (stillWaiting) {
          removeFromWaiting(socket.id);
          socket.emit('match-error', { message: 'timeout' });
        }
      }, 20000);

      return;
    }

    const partner = waitingUsers.splice(partnerIndex, 1)[0];
    const partnerSocket = io.sockets.sockets.get(partner.socketId);

    if (!partnerSocket) {
      socket.emit('match-error', { message: 'partner-disconnected' });
      return;
    }

    const roomId = `room_${Date.now()}`;

    socket.join(roomId);
    partnerSocket.join(roomId);

    socket.emit('joined', { roomId, peers: 1 });
    partnerSocket.emit('joined', { roomId, peers: 1 });

    socket.emit('matched', { roomId, polarity: 'caller' });
    partnerSocket.emit('matched', { roomId, polarity: 'receiver' });
  });

  socket.on('offer', ({ sdp }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => socket.to(roomId).emit('offer', { sdp }));
  });

  socket.on('answer', ({ sdp }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => socket.to(roomId).emit('answer', { sdp }));
  });

  socket.on('ice', ({ candidate }) => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => socket.to(roomId).emit('ice', { candidate }));
  });

  socket.on('leave', () => {
    const rooms = [...socket.rooms].filter((r) => r !== socket.id);
    rooms.forEach((roomId) => {
      socket.to(roomId).emit('peer-leave');
      socket.leave(roomId);
    });
  });
});

server.listen(PORT, () => {
  console.log('Signaling server running on port', PORT);
});
