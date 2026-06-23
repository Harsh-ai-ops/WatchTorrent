export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(hostId, hostName) {
    let roomId;
    do {
      roomId = this._generateRoomCode();
    } while (this.rooms.has(roomId));

    this.rooms.set(roomId, {
      id: roomId,
      hostId,
      users: [{ id: hostId, name: hostName, isHost: true }],
      torrent: null,
      createdAt: Date.now(),
    });
    return roomId;
  }

  roomExists(roomId) {
    return this.rooms.has(roomId);
  }

  addUser(roomId, userId, userName) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (!room.users.find((u) => u.id === userId)) {
      room.users.push({ id: userId, name: userName, isHost: false });
    }
    return true;
  }

  removeUser(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.users = room.users.filter((u) => u.id !== userId);
    if (room.users.length > 0 && room.hostId === userId) {
      room.hostId = room.users[0].id;
      room.users[0].isHost = true;
    }
  }

  getRoomUsers(roomId) {
    return this.rooms.get(roomId)?.users || [];
  }

  getUserRooms(userId) {
    const result = [];
    for (const [id, room] of this.rooms) {
      if (room.users.find((u) => u.id === userId)) result.push(id);
    }
    return result;
  }

  setTorrentInfo(roomId, info) {
    const room = this.rooms.get(roomId);
    if (room) room.torrent = info;
  }

  getTorrentInfo(roomId) {
    return this.rooms.get(roomId)?.torrent || null;
  }

  setSelectedFile(roomId, file) {
    const room = this.rooms.get(roomId);
    if (room?.torrent) room.torrent.selectedFile = file;
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  getRoomCount() {
    return this.rooms.size;
  }

  _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
