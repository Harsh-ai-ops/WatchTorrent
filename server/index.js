import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExpressPeerServer } from 'peer';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs from 'fs';
import { RoomManager } from './room-manager.js';
import { TorrentEngine } from './torrent-engine.js';
import { ChatService } from './chat-service.js';

// Prefer the bundled static binaries (ideal for local dev); fall back to ffmpeg/
// ffprobe on PATH (apt-installed in the Docker image) so a failed binary
// download during `npm install` never takes the whole app down on Hugging Face.
let FFMPEG = 'ffmpeg';
let FFPROBE = 'ffprobe';
try { const m = await import('ffmpeg-static'); if (m.default && fs.existsSync(m.default)) FFMPEG = m.default; } catch { /* use PATH */ }
try { const m = await import('ffprobe-static'); if (m.default?.path && fs.existsSync(m.default.path)) FFPROBE = m.default.path; } catch { /* use PATH */ }
console.log(`[ffmpeg] using ${FFMPEG === 'ffmpeg' ? 'system PATH' : 'bundled static'} binary`);
const PORT = process.env.PORT || 3000;

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

// Self-hosted PeerJS signaling server, mounted on the same HTTP server so it
// works behind a single port (Hugging Face Spaces / Render). The client points
// at `/peerjs` on the current origin — no reliance on the flaky public broker.
//
// IMPORTANT: a default Peer WS server attaches to the raw HTTP server and aborts
// EVERY upgrade that isn't its own — which would kill Socket.IO's websocket
// transport. So we run Peer's WS server in `noServer` mode and dispatch upgrades
// by path ourselves, leaving `/socket.io` upgrades for Socket.IO to handle.
let peerWss = null;
const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,
  allow_discovery: false,
  createWebSocketServer: () => {
    peerWss = new WebSocketServer({ noServer: true });
    return peerWss;
  },
});
peerServer.on('connection', (client) => console.log(`[peer] connect ${client.getId?.() ?? ''}`));
peerServer.on('disconnect', (client) => console.log(`[peer] disconnect ${client.getId?.() ?? ''}`));
app.use('/peerjs', peerServer);

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* keep default */ }
  if (peerWss && pathname.startsWith('/peerjs')) {
    peerWss.handleUpgrade(req, socket, head, (ws) => peerWss.emit('connection', ws, req));
  }
  // Any other path (notably /socket.io) is left for Socket.IO's own handler.
});

const roomManager = new RoomManager();
const torrentEngine = new TorrentEngine();
const chatService = new ChatService(io, roomManager);

// Track the progress-broadcast interval per room so re-loading a torrent in the
// same room never leaks timers.
const roomProgressIntervals = new Map();
function stopProgress(roomId) {
  const t = roomProgressIntervals.get(roomId);
  if (t) {
    clearInterval(t);
    roomProgressIntervals.delete(roomId);
  }
}

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
    const torrent = roomManager.getTorrentInfo(roomId);
    callback({ roomId, users, messages, torrent });

    if (torrent) {
      socket.emit('torrent-ready', {
        infoHash: torrent.infoHash,
        name: torrent.name,
        files: torrent.files,
      });
      if (torrent.selectedFile) {
        socket.emit('file-selected', { file: torrent.selectedFile });
      }
    }
  });

  // Lets a freshly-mounted client pull the current room state on demand. The
  // torrent-ready/file-selected events above can fire before the Room component
  // has registered its listeners (join happens in the Landing view), so without
  // this a new joiner would sit on the blank paste-magnet page.
  socket.on('get-room-state', (data, callback) => {
    const { roomId } = data || {};
    callback?.({
      users: roomManager.getRoomUsers(roomId),
      torrent: roomManager.getTorrentInfo(roomId),
    });
  });

  socket.on('start-torrent', async (data, callback) => {
    const { roomId, uri } = data || {};
    if (!roomId || !uri) return callback?.({ error: 'Missing roomId or uri' });
    try {
      const result = await torrentEngine.addTorrent(uri);
      // Default to the first VIDEO file, not files[0] — index 0 is often a
      // subtitle/poster, which would hand a non-playable stream to anyone who
      // adopts the default (e.g. a joiner pulling room state).
      const defaultFile = result.files.find((f) => f.type === 'video') || result.files[0] || null;
      roomManager.setTorrentInfo(roomId, {
        infoHash: result.infoHash,
        name: result.name,
        files: result.files,
        selectedFile: defaultFile,
      });
      if (defaultFile) torrentEngine.selectFile(result.infoHash, defaultFile.index);
      io.to(roomId).emit('torrent-ready', {
        infoHash: result.infoHash,
        name: result.name,
        files: result.files,
      });

      const torrent = torrentEngine.getTorrent(result.infoHash);
      if (torrent) {
        // Clear any previous progress loop for this room before starting a new one.
        stopProgress(roomId);
        if (torrent.done) {
          io.to(roomId).emit('torrent-progress', {
            downloaded: torrent.length, total: torrent.length, progress: 1, peers: 0, speed: 0,
          });
        } else {
          const interval = setInterval(() => {
            if (!roomManager.roomExists(roomId)) { stopProgress(roomId); return; }
            io.to(roomId).emit('torrent-progress', {
              downloaded: torrent.downloaded,
              total: torrent.length,
              progress: torrent.progress,
              peers: torrent.numPeers,
              speed: torrent.downloadSpeed,
            });
            if (torrent.done) { stopProgress(roomId); }
          }, 2000);
          roomProgressIntervals.set(roomId, interval);
          torrent.once('done', () => stopProgress(roomId));
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
    torrentEngine.selectFile(info.infoHash, fileIndex);
    socket.to(roomId).emit('file-selected', { file });
    callback?.({ success: true, file });
  });

  socket.on('get-stream-url', (data, callback) => {
    const { roomId } = data || {};
    const info = roomManager.getTorrentInfo(roomId);
    if (!info) return callback?.({ error: 'No torrent loaded' });

    const fileIndex = info.selectedFile?.index || 0;
    torrentEngine.selectFile(info.infoHash, fileIndex);
    const streamUrl = torrentEngine.getStreamUrl(info.infoHash, fileIndex);
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

  // A new joiner asks the room where playback currently is; existing members
  // reply directly to the requester so the joiner jumps straight into sync
  // instead of waiting for the next play/pause/seek.
  socket.on('request-sync', (data) => {
    const { roomId } = data || {};
    if (!roomId) return;
    socket.to(roomId).emit('request-sync', { requesterId: socket.id });
  });

  socket.on('provide-sync', (data) => {
    const { requesterId, position, paused } = data || {};
    if (!requesterId) return;
    io.to(requesterId).emit('apply-sync', { position, paused });
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
        stopProgress(roomId);
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
        // Convert ONLY the comma inside SRT timecodes (00:00:00,000 -> 00:00:00.000).
        // A blanket comma->dot replace would mangle every comma in the dialogue.
        content = content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
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

app.get('/stream/:infoHash/:fileIndex', async (req, res) => {
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

  // Prioritise this file's bandwidth and wait for the requested byte window to
  // actually exist before streaming, so playback resumes on real data instead
  // of immediately re-stalling.
  torrentEngine.selectFile(infoHash, parseInt(fileIndex));
  try {
    await torrentEngine.waitForRange(infoHash, parseInt(fileIndex), start, 8000);
  } catch {
    /* no data after timeout, continue anyway */
  }

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

// ---- On-the-fly transcoding (so MKV/AVI/HEVC/AC3 etc. play in any browser) ----
// ffmpeg reads the raw torrent file back through our own /stream endpoint (which
// supports byte ranges, so seeking works), remuxes it into a browser-friendly
// fragmented MP4, copies the video when it's already H.264 (cheap), transcodes
// it otherwise, and always outputs AAC stereo audio.

const probeCache = new Map(); // `${infoHash}:${idx}` -> { duration, video, audio }

function probeMedia(srcUrl, cacheKey) {
  if (probeCache.has(cacheKey)) return Promise.resolve(probeCache.get(cacheKey));
  return new Promise((resolve) => {
    const ff = spawn(FFPROBE, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name',
      '-of', 'json', srcUrl,
    ]);
    let out = '';
    ff.stdout.on('data', (d) => { out += d; });
    const killT = setTimeout(() => { try { ff.kill('SIGKILL'); } catch { /* ignore */ } }, 20000);
    ff.on('error', () => { clearTimeout(killT); resolve({ duration: 0, video: '', audio: '' }); });
    ff.on('close', () => {
      clearTimeout(killT);
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find((s) => s.codec_type === 'video');
        const a = (j.streams || []).find((s) => s.codec_type === 'audio');
        const result = { duration: parseFloat(j.format?.duration) || 0, video: v?.codec_name || '', audio: a?.codec_name || '' };
        if (result.video || result.duration) probeCache.set(cacheKey, result); // don't cache empty failures
        resolve(result);
      } catch {
        resolve({ duration: 0, video: '', audio: '' });
      }
    });
  });
}

app.get('/probe/:infoHash/:fileIndex', async (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const idx = parseInt(fileIndex);
  const file = torrentEngine.getFile(infoHash, idx);
  if (!file) return res.status(404).json({ error: 'File not found' });
  torrentEngine.selectFile(infoHash, idx);
  try { await torrentEngine.waitForRange(infoHash, idx, 0, 12000); } catch { /* continue */ }
  const info = await probeMedia(`http://127.0.0.1:${PORT}/stream/${infoHash}/${idx}`, `${infoHash}:${idx}`);
  res.json(info);
});

app.get('/transcode/:infoHash/:fileIndex', async (req, res) => {
  const { infoHash, fileIndex } = req.params;
  const idx = parseInt(fileIndex);
  const file = torrentEngine.getFile(infoHash, idx);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const start = Math.max(0, parseFloat(req.query.start) || 0);
  torrentEngine.selectFile(infoHash, idx);
  try { await torrentEngine.waitForRange(infoHash, idx, 0, 12000); } catch { /* continue */ }

  const srcUrl = `http://127.0.0.1:${PORT}/stream/${infoHash}/${idx}`;
  const info = await probeMedia(srcUrl, `${infoHash}:${idx}`);
  const copyVideo = ['h264', 'avc1'].includes(info.video);
  const copyAudio = ['aac', 'mp3'].includes(info.audio);

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-i', srcUrl,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', copyVideo ? 'copy' : 'libx264',
    ...(copyVideo ? [] : ['-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '48', '-sc_threshold', '0']),
    '-c:a', copyAudio ? 'copy' : 'aac',
    ...(copyAudio ? [] : ['-ac', '2', '-b:a', '160k']),
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '1000000',
    '-max_muxing_queue_size', '1024',
    '-f', 'mp4', 'pipe:1',
  ];

  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' });
  const ff = spawn(FFMPEG, args);
  ff.stdout.pipe(res);
  let errTail = '';
  ff.stderr.on('data', (d) => { errTail = (errTail + d).slice(-400); });
  const kill = () => { try { ff.kill('SIGKILL'); } catch { /* ignore */ } };
  res.on('close', kill);
  ff.on('error', () => { kill(); if (!res.headersSent) { try { res.status(500).end(); } catch { /* ignore */ } } else { try { res.end(); } catch { /* ignore */ } } });
  ff.on('close', (code) => {
    if (code && code !== 0 && code !== 255) console.error(`[transcode] ffmpeg exit ${code}: ${errTail.split('\n').filter(Boolean).pop() || ''}`);
  });
});

app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WatchTorrent running on http://0.0.0.0:${PORT}`);
});
