import WebTorrent from 'webtorrent';

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'wss://tracker.openwebtorrent.com:443/announce',
  'wss://tracker.btorrent.xyz:443/announce',
  'wss://tracker.files.fm:7073/announce/s',
  'wss://spacetradersapi.duckdns.org:443/announce',
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

export class TorrentEngine {
  constructor() {
    this.client = new WebTorrent({
      dht: { bootstrap: DHT_BOOTSTRAP },
      tracker: true,
      maxConns: 100,
      utp: true,
      upload: true,
      download: true,
      webSeeds: true,
    });
    this.torrents = new Map();
    this.pending = new Map();
  }

  addTorrent(uri) {
    const key = uri.trim().toLowerCase();

    if (this.pending.has(key)) {
      console.log(`[torrent] waiting for existing pending: ${key.slice(0, 40)}`);
      return this.pending.get(key);
    }

    if (this.torrents.size >= 3) {
      const oldest = this.torrents.keys().next().value;
      console.log(`[torrent] evicting oldest: ${oldest}`);
      this.removeTorrent(oldest);
    }

    const promise = new Promise((resolve, reject) => {
      console.log(`[torrent] adding: ${key.slice(0, 60)}...`);

      const cleanup = () => {
        this.pending.delete(key);
      };

      const enhancedUri = this._addTrackers(key);

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
        const files = torrent.files.map((f, i) => ({
          index: i,
          name: f.name,
          length: f.length,
          type: this._getFileType(f.name),
        }));
        console.log(`[torrent] READY: ${torrent.name} (${files.length} files, ${files.filter(f => f.type === 'video').length} video)`);
        this.torrents.set(torrent.infoHash, torrent);
        cleanup();
        resolve({ infoHash: torrent.infoHash, name: torrent.name, files });
      });

      torrent.on('error', (err) => {
        clearTimeout(timeout);
        console.error(`[torrent] error:`, err.message);
        cleanup();
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

  removeTorrent(infoHash) {
    const torrent = this.torrents.get(infoHash);
    if (torrent) {
      console.log(`[torrent] destroying: ${infoHash}`);
      try { torrent.destroy(); } catch {}
      this.torrents.delete(infoHash);
    }
  }

  _addTrackers(uri) {
    let result = uri;
    for (const tracker of PUBLIC_TRACKERS) {
      if (!result.includes(encodeURIComponent(tracker)) && !result.includes(tracker)) {
        result += `&tr=${encodeURIComponent(tracker)}`;
      }
    }
    return result;
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
}
