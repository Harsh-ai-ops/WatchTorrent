export class ChatService {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
    this.messages = new Map();
  }

  handleMessage(socket, data) {
    const { roomId, text, type = 'text' } = data || {};
    if (!roomId || !text?.trim()) return;

    const users = this.roomManager.getRoomUsers(roomId);
    const user = users.find((u) => u.id === socket.id);
    if (!user) return;

    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: socket.id,
      name: user.name,
      text: text.trim(),
      type,
      timestamp: Date.now(),
    };

    if (!this.messages.has(roomId)) {
      this.messages.set(roomId, []);
    }
    const roomMessages = this.messages.get(roomId);
    roomMessages.push(message);
    if (roomMessages.length > 200) roomMessages.shift();

    this.io.to(roomId).emit('chat-message', message);
  }

  getRoomMessages(roomId) {
    return this.messages.get(roomId) || [];
  }

  clearRoom(roomId) {
    this.messages.delete(roomId);
  }
}
