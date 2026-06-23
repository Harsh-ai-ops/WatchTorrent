import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './room-manager.js';
import { TorrentEngine } from './torrent-engine.js';
import { ChatService } from './chat-service.js';
import { PeerServer } from 'peer';

process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  if (msg.includes("Cannot read properties of null") || msg.includes("reading 'length'")) {
    return;
  }
  if (msg.includes("piece.reserve") || msg.includes("_reserve")) {
    return;
  }
  console.error('[crash] uncaught exception:', msg);
});

process.on('unhandledRejection', (err) => {
  const msg = err?.message || '';
  if (msg.includes("Cannot read properties of null") || msg.includes("reading 'length'")) {
    return;
  }
  console.error('[crash] unhandled rejection:', msg);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e7,
});

app.use(cors());
app.use(express.json());

const roomManager = new RoomManager();
const torrentEngine = new TorrentEngine();
const chatService = new ChatService(io, roomManager);

PeerServer({ port: 9000, path: '/peerjs' });

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  socket.on('create-room', (data, callback) => {
    const { name } = data || {};
    const roomId = roomManager.createRoom(socket.id, name || 'Host');
    socket.join(roomId);
    callback({ roomId, users: roomManager.getRoomUsers(roomId) });
  });

  socket.on('join-room', (data, callback) => {
    const { roomId, name } = data || {};
    if (!roomManager.roomExists(roomId)) {
      return callback({ error: 'Room not found' });
    }
    roomManager.addUser(roomId, socket.id, name || 'Anonymous');
    socket.join(roomId);
    const users = roomManager.getRoomUsers(roomId);
    io.to(roomId).emit('user-joined', { users, userId: socket.id, name: name || 'Anonymous' });
    const messages = chatService.getRoomMessages(roomId);
    socket.emit('chat-messages', messages);
    callback({ roomId, users, messages });
  });

  socket.on('start-torrent', async (data, callback) => {
    const { roomId, uri } = data || {};
    if (!roomId || !uri) return callback?.({ error: 'Missing roomId or uri' });
    try {
      const result = await torrentEngine.addTorrent(uri);
      roomManager.setTorrentInfo(roomId, {
        infoHash: result.infoHash,
        name: result.name,
        files: result.files,
        selectedFile: result.files[0] || null,
      });
      io.to(roomId).emit('torrent-ready', {
        infoHash: result.infoHash,
        name: result.name,
        files: result.files,
      });

      const torrent = torrentEngine.getTorrent(result.infoHash);
      if (torrent) {
        if (torrent.done) {
          io.to(roomId).emit('torrent-progress', {
            downloaded: torrent.length, total: torrent.length, progress: 1, peers: 0, speed: 0,
          });
        } else {
          const interval = setInterval(() => {
            if (!roomManager.roomExists(roomId)) { clearInterval(interval); return; }
            io.to(roomId).emit('torrent-progress', {
              downloaded: torrent.downloaded,
              total: torrent.length,
              progress: torrent.progress,
              peers: torrent.numPeers,
              speed: torrent.downloadSpeed,
            });
            if (torrent.done) { clearInterval(interval); }
          }, 2000);
          torrent.once('done', () => { clearInterval(interval); });
        }
      }

      callback?.({ success: true });
    } catch (err) {
      callback?.({ error: err.message });
    }
  });

  socket.on('select-file', (data, callback) => {
    const { roomId, fileIndex } = data || {};
    const info = roomManager.getTorrentInfo(roomId);
    if (!info) return callback?.({ error: 'No torrent loaded' });
    if (!info.files || !info.files[fileIndex]) return callback?.({ error: 'Invalid file index' });
    const file = info.files[fileIndex];
    roomManager.setSelectedFile(roomId, file);
    socket.to(roomId).emit('file-selected', { file });
    callback?.({ success: true, file });
  });

  socket.on('get-stream-url', (data, callback) => {
    const { roomId } = data || {};
    const info = roomManager.getTorrentInfo(roomId);
    if (!info) return callback?.({ error: 'No torrent loaded' });

    const streamUrl = torrentEngine.getStreamUrl(info.infoHash, info.selectedFile?.index || 0);
    if (streamUrl) callback?.({ url: streamUrl });
    else callback?.({ error: 'Stream not available' });
  });

  socket.on('sync-play', (data) => {
    const { roomId, position } = data || {};
    socket.to(roomId).emit('sync-play', { position, timestamp: Date.now(), by: socket.id });
  });

  socket.on('sync-pause', (data) => {
    const { roomId, position } = data || {};
    socket.to(roomId).emit('sync-pause', { position, timestamp: Date.now(), by: socket.id });
  });

  socket.on('sync-seek', (data) => {
    const { roomId, position } = data || {};
    socket.to(roomId).emit('sync-seek', { position, timestamp: Date.now(), by: socket.id });
  });

  socket.on('sync-speed', (data) => {
    const { roomId, speed } = data || {};
    socket.to(roomId).emit('sync-speed', { speed, by: socket.id });
  });

  socket.on('chat-message', (data) => chatService.handleMessage(socket, data));

  socket.on('subtitle', (data) => {
    const { roomId, subtitles } = data || {};
    io.to(roomId).emit('subtitle', { subtitles });
  });

  socket.on('signal', (data) => {
    const { roomId } = data || {};
    if (!roomId) return;
    socket.to(roomId).emit('signal', data);
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const rooms = roomManager.getUserRooms(socket.id);
    rooms.forEach((roomId) => {
      roomManager.removeUser(roomId, socket.id);
      const users = roomManager.getRoomUsers(roomId);
      io.to(roomId).emit('user-left', { users, userId: socket.id });
      if (roomManager.getRoomUsers(roomId).length === 0) {
        const info = roomManager.getTorrentInfo(roomId);
        if (info) torrentEngine.removeTorrent(info.infoHash);
        chatService.clearRoom(roomId);
        roomManager.deleteRoom(roomId);
        console.log(`[room] ${roomId} deleted - empty`);
      }
    });
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: roomManager.getRoomCount() });
});

app.get('/subtitle/:infoHash/:fileIndex', (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const peers = torrentEngine.getPeerCount(infoHash);
  const file = torrentEngine.getFile(infoHash, parseInt(fileIndex));
  if (!file) return res.status(404).json({ error: 'Subtitle file not found' });

  if (peers === 0) {
    return res.status(503).json({ error: 'Subtitles not ready - waiting for peers' });
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  const contentType = ext === 'vtt' ? 'text/vtt' : 'text/plain; charset=utf-8';

  try {
    const stream = file.createReadStream();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      let content = Buffer.concat(chunks).toString('utf-8');
      if (ext === 'srt') {
        content = content.replace(/,/g, '.');
        content = 'WEBVTT\n\n' + content;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
    stream.on('error', () => res.status(500).json({ error: 'Failed to read subtitle' }));
  } catch {
    res.status(500).json({ error: 'Subtitle read error' });
  }
});

app.get('/stream/:infoHash/:fileIndex', (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const file = torrentEngine.getFile(infoHash, parseInt(fileIndex));
  if (!file) return res.status(404).json({ error: 'File not found' });

  const ext = file.name.split('.').pop()?.toLowerCase();
  const mimeMap = { mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg', avi: 'video/x-msvideo', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4' };
  const contentType = mimeMap[ext] || 'video/mp4';

  const range = req.headers.range;
  const start = range ? parseInt(range.replace(/bytes=/, '').split('-')[0], 10) : 0;
  const end = range ? (range.split('-')[1] ? parseInt(range.split('-')[1], 10) : file.length - 1) : file.length - 1;
  const chunkSize = end - start + 1;

  try {
    if (range) {
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
    } else {
      res.writeHead(200, {
        'Content-Length': file.length,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
    }

    const stream = file.createReadStream({ start, end });
    stream.on('error', () => { try { res.end(); } catch {} });
    res.on('close', () => { try { stream.destroy(); } catch {} });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': file.length,
      });
      res.end();
    }
  }
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WatchTorrent running on http://0.0.0.0:${PORT}`);
});
