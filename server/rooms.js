

function randomHexColor() {
 
  const palette = ["#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#ea580c", "#0f766e"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function makeDisplayName(socketId) {

  return `User-${socketId.slice(0, 4)}`;
}

function createRooms() {
  
  const rooms = new Map();

  function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) rooms.set(roomId, { users: new Map() });
    return rooms.get(roomId);
  }

  function join(roomId, socket) {
    const room = getOrCreateRoom(roomId);

    const user = {
      id: socket.id,
      name: makeDisplayName(socket.id),
      color: randomHexColor()
    };

    room.users.set(socket.id, user);
    return user;
  }

  function leave(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    const user = room.users.get(socketId) || null;
    room.users.delete(socketId);


    if (room.users.size === 0) rooms.delete(roomId);
    return user;
  }

  function listUsers(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.users.values()).map((u) => ({ id: u.id, name: u.name, color: u.color }));
  }

  return { join, leave, listUsers };
}

module.exports = { createRooms };

