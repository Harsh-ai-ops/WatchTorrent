export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function generateName(): string {
  const adj = ['Swift', 'Mystic', 'Cosmic', 'Neon', 'Pixel', 'Cyber', 'Lunar', 'Solar'];
  const nouns = ['Phoenix', 'Dragon', 'Tiger', 'Falcon', 'Wolf', 'Panda', 'Raven', 'Lynx'];
  return adj[Math.floor(Math.random() * adj.length)] + nouns[Math.floor(Math.random() * nouns.length)];
}

export function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ogg', 'ogv'].includes(ext || '');
}
