import { useState } from 'react';
import { getSocket } from '../lib/socket.ts';
import { generateName } from '../lib/utils.ts';
import { FiArrowRight, FiUsers } from 'react-icons/fi';

interface LandingProps {
  onEnter: (roomId: string, userName: string) => void;
}

export default function Landing({ onEnter }: LandingProps) {
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home');
  const [userName, setUserName] = useState(generateName());
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleCreate() {
    if (!userName.trim()) return setError('Enter a name');
    setLoading(true);
    setError('');
    const socket = getSocket();
    socket.emit('create-room', { name: userName.trim() }, (res: any) => {
      setLoading(false);
      if (res.error) return setError(res.error);
      onEnter(res.roomId, userName.trim());
    });
  }

  function handleJoin() {
    if (!userName.trim()) return setError('Enter a name');
    if (!joinCode.trim()) return setError('Enter a room code');
    setLoading(true);
    setError('');
    const socket = getSocket();
    socket.emit('join-room', { roomId: joinCode.trim().toUpperCase(), name: userName.trim() }, (res: any) => {
      setLoading(false);
      if (res.error) return setError(res.error);
      onEnter(res.roomId, userName.trim());
    });
  }

  if (mode === 'home') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-950 py-8">
        <div className="text-center space-y-8 animate-fade-in max-w-md px-6">
          <div className="space-y-2">
            <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              WatchTorrent
            </h1>
            <p className="text-zinc-400 text-base sm:text-lg">Watch torrents together. In perfect sync.</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => setMode('create')}
              className="w-full py-3 px-6 rounded-xl bg-purple-600 hover:bg-purple-500 transition-all font-medium text-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <FiArrowRight className="w-5 h-5" />
              Create a Room
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full py-3 px-6 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-all font-medium text-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <FiUsers className="w-5 h-5" />
              Join a Room
            </button>
          </div>

          <p className="text-zinc-600 text-sm">
            No sign-up required. Just create a room and share the code.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-950 py-8">
      <div className="w-full max-w-sm mx-auto px-6 space-y-6 animate-fade-in">
        <button
          onClick={() => { setMode('home'); setError(''); }}
          className="text-zinc-400 hover:text-white transition-colors text-sm cursor-pointer"
        >
          ← Back
        </button>

        <h2 className="text-2xl font-bold">
          {mode === 'create' ? 'Create Room' : 'Join Room'}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Your Name</label>
            <input
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-purple-500 focus:outline-none transition-colors text-white placeholder-zinc-600"
              maxLength={20}
            />
          </div>

          {mode === 'join' && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Room Code</label>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-purple-500 focus:outline-none transition-colors text-white placeholder-zinc-600 uppercase tracking-widest text-center text-lg font-mono"
                maxLength={6}
              />
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={mode === 'create' ? handleCreate : handleJoin}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition-all font-medium cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? 'Connecting...' : mode === 'create' ? 'Create Room' : 'Join Room'}
          </button>
        </div>
      </div>
    </div>
  );
}
