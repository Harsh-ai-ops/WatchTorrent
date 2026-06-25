---
title: Watchtorrent
emoji: 🐢
colorFrom: gray
colorTo: indigo
sdk: docker
pinned: false
app_port: 3000
---

# WatchTorrent

Watch torrents together with friends in perfect sync. Paste a magnet link, create a room, and everyone watches the same video with synchronized playback, chat, and video calls.

## Features

- **Torrent Streaming** - Paste magnet links or .torrent URLs, server-side WebTorrent streaming
- **Plays anything** - MKV / AVI / HEVC / AC3 are transcoded to browser-friendly MP4 on the fly (ffmpeg)
- **Sync Playback** - Play, pause, seek - everything synced for all room members
- **Real-time Chat** - Built-in chat with message history
- **Video/Audio Calls** - Native WebRTC mesh, signaled over Socket.IO (no third-party broker)
- **Multi-file Support** - Pick which file to stream from multi-file torrents
- **No Sign-up** - Just create a room and share the 6-char code
- **Cinema UI** - Dark, minimal design focused on the video
- **Mobile Ready** - Responsive layout works on all devices

## Easiest way — one-click host (Windows, no terminal)

Run it on your own machine (so torrents actually work) and get a public link to
share. **Just double-click `Start Watch Party.bat`.** It installs/builds on the
first run, starts the server, opens a free public link (via Cloudflare — no
account), and launches the app. Then:

1. Click **Create a Room** and paste your magnet / torrent link.
2. Click **Invite** to copy the room link and send it to friends.
3. They click the link → drop straight into your synced room (playback + chat +
   video/audio calls). Keep the window open during the party.

> The public link uses a free Cloudflare quick-tunnel — perfect for a few
> friends. For heavy/long sessions, a small VPS or your own domain tunnel is
> sturdier.

## Manual start

```bash
git clone <repo>
cd WatchTorrent

# Install
cd server && npm install && cd ../client && npm install && cd ..

# Build
cd client && npm run build && cd ..

# Start
node server/index.js
```

Open http://localhost:3000

## Deployment & networking (READ THIS)

This app **downloads torrents on the server**, which needs real BitTorrent
connectivity — outbound TCP, ideally UDP (DHT), and decent bandwidth. Managed
"free tier" hosts that block UDP / inbound connections (**Hugging Face Spaces,
Render, Railway**) will make torrents **stall on "Connecting to peers"** even
when the magnet is fine. The buffering overlay shows live `peers · MB/s · MB`
so you can tell whether data is actually flowing.

**Where it actually works well:**

| Host | Torrents | Notes |
|------|----------|-------|
| **Your own machine / home server** | ✅ best | `node server/index.js`, full networking |
| **Oracle Cloud "Always Free" VM** | ✅ | Real always-free VM (ARM, 4 vCPU/24GB), full networking |
| **Fly.io** | ✅ mostly | Free allowance, allows UDP + inbound |
| **A small VPS** (Hetzner/DigitalOcean) | ✅ | A few $/mo, no limits |
| Hugging Face / Render / Railway | ⚠️ webseed-only | Great for the demo; poor for real torrents |

### Video calls — TURN for restrictive networks

Calls use native WebRTC. STUN (built in) is enough on the same network or
typical home routers. For users behind strict/mobile NATs you need a **TURN
relay** — set these env vars (free creds from [metered.ca](https://www.metered.ca/)
or Twilio) and calls work everywhere, no code change:

```
TURN_URL=turn:your.turn.host:3478,turns:your.turn.host:5349
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-credential
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4 |
| Backend | Node.js, Express, Socket.IO |
| Torrent Engine | WebTorrent (server-side, TCP) |
| Transcoding | ffmpeg (ffmpeg-static, on-the-fly fragmented MP4) |
| Video/Audio Calls | Native WebRTC mesh, Socket.IO signaling |
| Deployment | Docker, any Node host (best with full networking) |
