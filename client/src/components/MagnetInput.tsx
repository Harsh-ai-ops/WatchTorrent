import { useState, useCallback } from 'react';
import { FiLink, FiArrowRight, FiLoader } from 'react-icons/fi';

interface MagnetInputProps {
  onSubmit: (uri: string) => void;
  loading: boolean;
}

export default function MagnetInput({ onSubmit, loading }: MagnetInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSubmit(input.trim());
  }, [input, loading, onSubmit]);

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <FiLink className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 w-4 h-4" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste magnet link or torrent URL..."
          className="w-full pl-10 pr-12 py-3 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-purple-500 focus:outline-none transition-colors text-white placeholder-zinc-600 text-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? <FiLoader className="w-4 h-4 animate-spin" /> : <FiArrowRight className="w-4 h-4" />}
        </button>
      </div>
      <details className="text-center">
        <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-400">Supports magnet:?xt=... and .torrent URLs — click for test magnets</summary>
        <div className="mt-2 space-y-1">
          <button
            type="button"
            onClick={() => { setInput('magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fsintel.torrent'); }}
            className="text-xs text-purple-400 hover:text-purple-300 block w-full text-left px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
          >
            Test: Sintel (has webseed, should play immediately)
          </button>
          <button
            type="button"
            onClick={() => { setInput('magnet:?xt=urn:btih:a4f341093185750b889baaac1de296867e46fa9f&dn=ubuntu-24.04.1-desktop-amd64.iso'); }}
            className="text-xs text-purple-400 hover:text-purple-300 block w-full text-left px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
          >
            Test: Ubuntu 24.04 ISO (many seeders)
          </button>
        </div>
      </details>
    </form>
  );
}
