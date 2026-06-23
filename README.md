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

- **Torrent Streaming** - Paste magnet links or .torrent URLs, instant WebTorrent streaming
- **Sync Playback** - Play, pause, seek - everything synced for all room members
- **Real-time Chat** - Built-in chat with message history
- **Video/Audio Calls** - P2P WebRTC calls via PeerJS
- **Multi-file Support** - Pick which file to stream from multi-file torrents
- **No Sign-up** - Just create a room and share the 6-char code
- **Cinema UI** - Dark, minimal design focused on the video
- **Mobile Ready** - Responsive layout works on all devices

## Quick Start

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

## One-Click Deploy

[![Deploy to Hugging Face](https://img.shields.io/badge/%F0%9F%A4%97-Deploy%20to%20Hugging%20Face-blue)](https://huggingface.co/new-space?template=HarshGupta08/watchtorrent)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Harsh-ai-ops/WatchTorrent)

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4 |
| Backend | Node.js, Express, Socket.IO |
| Torrent Engine | WebTorrent (server-side, TCP/uTP + WebRTC) |
| Video/Audio Calls | PeerJS (WebRTC mesh) |
| Deployment | Docker, Hugging Face Spaces, Render |
