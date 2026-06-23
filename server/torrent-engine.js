import WebTorrent from 'webtorrent';

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'wss://tracker.openwebtorrent.com:443/announce',
  'wss://tracker.btorrent.xyz:443/announce',
  'wss://tracker.files.fm:7073/announce/s',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:6969/announce',
  'http://tracker.bittorrent.am:80/announce',
];

const DHT_BOOTSTRAP = [
  'router.bittorrent.com:6881',
  'dht.transmissionbt.com:6881',
  'router.utorrent.com:6881',
  'dht.aelitis.com:6881',
  'router.silotis.us:6881',
  'dht.libtorrent.org:25401',
];

// How many torrents to keep in memory at once (LRU eviction beyond this).
const MAX_TORRENTS = 5;

export class TorrentEngine {
  constructor() {
    this.client = new WebTorrent({
      dht: { bootstrap: DHT_BOOTSTRAP },
      tracker: true,
      maxConns: 200,
      // µTP is UDP-based; many hosts (incl. Hugging Face Spaces) block UDP, so
      // it just wastes connection attempts. Stick to TCP, which works outbound.
      utp: false,
      upload: true,
      download: true,
      webSeeds: true,
    });
    this.torrents = new Map();
    this.pending = new Map();
    this._selected = new Map(); // infoHash -> last selected fileIndex (dedupe)
  }

  async addTorrent(uri) {
    const original = uri.trim();
    // Dedup key only — never feed a lowercased URI to WebTorrent (tracker paths
    // and base32 info hashes can be case-sensitive).
    const key = original.toLowerCase();

    if (this.pending.has(key)) {
      console.log(`[torrent] waiting for existing pending: ${key.slice(0, 40)}`);
      return this.pending.get(key);
    }

    // Robust dedup: ask WebTorrent directly. client.get() accepts a magnet,
    // info hash (hex OR base32), or .torrent id, and is async in v3 — so this
    // catches every "already added" case without hand-parsing the hash, which
    // is what previously caused "Cannot add duplicate torrent" on reload.
    try {
      const existing = await this.client.get(original);
      if (existing && existing.files && existing.files.length > 0) {
        console.log(`[torrent] reusing existing: ${existing.infoHash}`);
        this.torrents.set(existing.infoHash, existing);
        return this._fileInfo(existing);
      }
    } catch { /* not present yet — fall through and add it */ }

    if (this.torrents.size >= MAX_TORRENTS) {
      const oldest = this.torrents.keys().next().value;
      console.log(`[torrent] evicting oldest: ${oldest}`);
      this.removeTorrent(oldest);
    }

    const promise = new Promise((resolve, reject) => {
      console.log(`[torrent] adding: ${key.slice(0, 60)}...`);

      const cleanup = () => {
        this.pending.delete(key);
      };

      const enhancedUri = this._addTrackers(original);

      const torrent = this.client.add(enhancedUri, { strategy: 'sequential' });

      const timeout = setTimeout(() => {
        console.log(`[torrent] timeout for ${key.slice(0, 40)}`);
        cleanup();
        try { torrent.destroy(); } catch {}
        reject(new Error('Timed out loading torrent (120s). Try a magnet with more seeders.'));
      }, 120000);

      torrent.on('infoHash', () => {
        console.log(`[torrent] infoHash: ${torrent.infoHash}`);
      });

      torrent.on('metadata', () => {
        console.log(`[torrent] metadata received, name: ${torrent.name}`);
      });

      torrent.on('ready', () => {
        clearTimeout(timeout);
        if (!torrent.files || torrent.files.length === 0) {
          cleanup();
          reject(new Error('Torrent has no files'));
          return;
        }
        const info = this._fileInfo(torrent);
        console.log(`[torrent] READY: ${torrent.name} (${info.files.length} files, ${info.files.filter(f => f.type === 'video').length} video)`);
        this.torrents.set(torrent.infoHash, torrent);
        cleanup();
        resolve(info);
      });

      torrent.on('error', async (err) => {
        clearTimeout(timeout);
        cleanup();
        const msg = err?.message || '';
        // "Cannot add duplicate torrent <hash>" — it already exists in the
        // client (e.g. a reload re-adding before the old one finished tearing
        // down). Reuse the existing one instead of surfacing an error.
        if (msg.toLowerCase().includes('duplicate')) {
          try {
            const existing = await this.client.get(original);
            if (existing && existing.files && existing.files.length > 0) {
              this.torrents.set(existing.infoHash, existing);
              resolve(this._fileInfo(existing));
              return;
            }
          } catch { /* fall through to reject */ }
        }
        console.error('[torrent] error:', msg);
        reject(err);
      });

      torrent.on('warning', (err) => {
        console.warn(`[torrent] warning:`, err.message);
      });

      torrent.on('noPeers', (announceType) => {
        console.log(`[torrent] no peers found via ${announceType}`);
      });
    });

    this.pending.set(key, promise);
    return promise;
  }

  hasPeers(infoHash) {
    const torrent = this.torrents.get(infoHash);
    return torrent ? (torrent.numPeers > 0 || torrent.done) : false;
  }

  getStreamUrl(infoHash, fileIndex) {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) return null;
    return `/stream/${infoHash}/${fileIndex}`;
  }

  getTorrent(infoHash) {
    return this.torrents.get(infoHash) || null;
  }

  getFile(infoHash, fileIndex) {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) return null;
    if (!torrent.files || !torrent.files[fileIndex]) return null;
    return torrent.files[fileIndex];
  }

  getPeerCount(infoHash) {
    const torrent = this.torrents.get(infoHash);
    return torrent ? torrent.numPeers : 0;
  }

  // Prioritise the file being streamed. We only ever ADD a selection (never
  // deselect — deselecting the default whole-torrent selection can stop the
  // download entirely on some torrents), and do it once per file to avoid
  // piling up duplicate selections on every range request.
  selectFile(infoHash, fileIndex) {
    if (this._selected.get(infoHash) === fileIndex) return;
    const torrent = this.torrents.get(infoHash);
    const file = torrent?.files?.[fileIndex];
    if (!file) return;
    this._selected.set(infoHash, fileIndex);
    try { file.select(); } catch { /* ignore */ }
  }

  // Wait until the pieces backing `start` (plus a small read-ahead) actually
  // exist before we start piping a range — checking the real bitfield for THIS
  // file's offset, not a global byte count. Falls back to resolving after
  // timeoutMs so a slow/seedless torrent still gets a response instead of hanging.
  waitForRange(infoHash, fileIndex, start, timeoutMs) {
    return new Promise((resolve) => {
      const torrent = this.torrents.get(infoHash);
      const file = torrent?.files?.[fileIndex];
      if (!torrent || !file) return resolve();

      const pieceLen = torrent.pieceLength || 256 * 1024;
      const offset = (file.offset || 0) + Math.max(0, start);
      const startPiece = Math.floor(offset / pieceLen);
      const totalPieces = torrent.pieces?.length || startPiece + 6;
      const lastPiece = Math.min(startPiece + 5, totalPieces - 1);

      const ready = () => {
        if (torrent.done) return true;
        const bf = torrent.bitfield;
        if (!bf || typeof bf.get !== 'function') return false;
        for (let i = startPiece; i <= lastPiece; i++) {
          if (!bf.get(i)) return false;
        }
        return true;
      };

      // Ask WebTorrent to fetch this window first.
      try { torrent.critical?.(startPiece, lastPiece); } catch { /* ignore */ }

      if (ready()) return resolve();
      const check = setInterval(() => {
        if (ready()) { clearInterval(check); clearTimeout(to); resolve(); }
      }, 250);
      const to = setTimeout(() => { clearInterval(check); resolve(); }, timeoutMs);
    });
  }

  removeTorrent(infoHash) {
    const torrent = this.torrents.get(infoHash);
    if (torrent) {
      console.log(`[torrent] destroying: ${infoHash}`);
      try { torrent.destroy(); } catch {}
      this.torrents.delete(infoHash);
      this._selected.delete(infoHash);
    }
  }

  _addTrackers(uri) {
    // Only magnet links accept `&tr=` tracker params. Appending them to a plain
    // .torrent HTTP(S) URL would corrupt the URL, so leave those untouched.
    if (!uri.startsWith('magnet:')) return uri;
    let result = uri;
    for (const tracker of PUBLIC_TRACKERS) {
      if (!result.includes(encodeURIComponent(tracker)) && !result.includes(tracker)) {
        result += `&tr=${encodeURIComponent(tracker)}`;
      }
    }
    return result;
  }

  _fileInfo(torrent) {
    const files = (torrent.files || []).map((f, i) => ({
      index: i, name: f.name, length: f.length, type: this._getFileType(f.name),
    }));
    return { infoHash: torrent.infoHash, name: torrent.name, files };
  }

  _getFileType(name) {
    const ext = name.split('.').pop()?.toLowerCase();
    const videoExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ogg', 'ogv'];
    const audioExts = ['mp3', 'flac', 'wav', 'aac'];
    const subExts = ['srt', 'vtt', 'ass', 'ssa', 'sub'];
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (subExts.includes(ext)) return 'subtitle';
    return 'other';
  }

  _parseInfoHash(uri) {
    const m = uri.match(/[?&]xt=urn:btih:([a-fA-F0-9]{40})/);
    return m ? m[1].toLowerCase() : null;
  }
}
