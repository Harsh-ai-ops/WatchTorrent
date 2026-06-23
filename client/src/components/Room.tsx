import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket, disconnectSocket } from '../lib/socket.ts';
import VideoPlayer from './VideoPlayer.tsx';
import Chat from './Chat.tsx';
import VideoCall from './VideoCall.tsx';
import FileSelector from './FileSelector.tsx';
import MagnetInput from './MagnetInput.tsx';
import { FiUsers, FiMessageSquare, FiVideo, FiLogOut, FiMonitor, FiFileText, FiMusic, FiFilm } from 'react-icons/fi';
import { formatBytes } from '../lib/utils.ts';

interface RoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
}

interface User {
  id: string;
  name: string;
  isHost: boolean;
}

interface TorrentFile {
  index: number;
  name: string;
  length: number;
  type: string;
}

export default function Room({ roomId, userName, onLeave }: RoomProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [torrentName, setTorrentName] = useState('');
  const [torrentInfoHash, setTorrentInfoHash] = useState('');
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<TorrentFile | null>(null);
  const [streamUrl, setStreamUrl] = useState('');
  const [torrentLoading, setTorrentLoading] = useState(false);
  const [torrentError, setTorrentError] = useState('');
  const [torrentProgress, setTorrentProgress] = useState<{ peers: number; progress: number; speed: number } | null>(null);
  const [activePanel, setActivePanel] = useState<'chat' | 'users' | 'call' | null>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const socketRef = useRef(getSocket());

  const requestStreamUrl = useCallback((roomId: string) => {
    const socket = socketRef.current;
    socket.emit('get-stream-url', { roomId }, (res: any) => {
      if (res?.url) setStreamUrl(res.url);
    });
  }, []);

  const retryStreamUrl = useCallback(() => {
    if (!streamUrl && torrentInfoHash && selectedFile) {
      requestStreamUrl(roomId);
    }
  }, [streamUrl, torrentInfoHash, selectedFile, requestStreamUrl, roomId]);

  useEffect(() => {
    const socket = socketRef.current;

    const onUserJoined = (data: any) => setUsers(data.users);
    const onUserLeft = (data: any) => setUsers(data.users);

    const onTorrentReady = (data: any) => {
      setTorrentName(data.name);
      setTorrentInfoHash(data.infoHash || '');
      setFiles(data.files || []);
      setTorrentLoading(false);
      setTorrentError('');

      const videoFiles = (data.files || []).filter((f: TorrentFile) => f.type === 'video');
      if (videoFiles.length > 0) {
        const first = videoFiles[0];
        setSelectedFile(first);
        socket.emit('select-file', { roomId, fileIndex: first.index }, (res: any) => {
          if (res?.success) requestStreamUrl(roomId);
          else if (res?.error) setTorrentError(res.error);
        });
      }
    };

    const onFileSelected = (data: any) => {
      setSelectedFile(data.file);
      requestStreamUrl(roomId);
    };

    const onProgress = (data: any) => {
      setTorrentProgress({ peers: data.peers, progress: data.progress, speed: data.speed });
    };

    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);
    socket.on('torrent-ready', onTorrentReady);
    socket.on('file-selected', onFileSelected);
    socket.on('torrent-progress', onProgress);

    return () => {
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
      socket.off('torrent-ready', onTorrentReady);
      socket.off('file-selected', onFileSelected);
      socket.off('torrent-progress', onProgress);
    };
  }, [roomId, requestStreamUrl]);

  const handleStartTorrent = useCallback((uri: string) => {
    setTorrentLoading(true);
    setTorrentError('');
    setFiles([]);
    setSelectedFile(null);
    setStreamUrl('');
    const socket = socketRef.current;
    socket.emit('start-torrent', { roomId, uri }, (res: any) => {
      if (res?.error) {
        setTorrentError(res.error);
        setTorrentLoading(false);
      }
    });
  }, [roomId]);

  const handleSelectFile = useCallback((fileIndex: number) => {
    setStreamUrl('');
    const socket = socketRef.current;
    socket.emit('select-file', { roomId, fileIndex }, (res: any) => {
      if (res?.error) setTorrentError(res.error);
      else if (res?.success) requestStreamUrl(roomId);
    });
  }, [roomId, requestStreamUrl]);

  const handleLeave = useCallback(() => {
    disconnectSocket();
    onLeave();
  }, [onLeave]);

  const videoFiles = files.filter((f) => f.type === 'video');
  const showCall = activePanel === 'call';

  useEffect(() => {
    if (!torrentInfoHash || !selectedFile || streamUrl) return;
    const t = setTimeout(retryStreamUrl, 5000);
    return () => clearTimeout(t);
  }, [torrentInfoHash, selectedFile, streamUrl, retryStreamUrl]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      <header className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 backdrop-blur border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-purple-400 font-bold shrink-0">WT</span>
          <span className="text-zinc-300 text-sm truncate">
            Room: <span className="text-white font-mono tracking-wider">{roomId}</span>
          </span>
          {torrentName && (
            <span className="text-zinc-500 text-sm truncate hidden sm:block">
              | {torrentName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActivePanel(activePanel === 'chat' ? null : 'chat')}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${activePanel === 'chat' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            title="Chat"
          >
            <FiMessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActivePanel(activePanel === 'users' ? null : 'users')}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${activePanel === 'users' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            title="Users"
          >
            <FiUsers className="w-4 h-4" />
          </button>
          <button
            onClick={() => setActivePanel(showCall ? null : 'call')}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${showCall ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            title="Video Call"
          >
            <FiVideo className="w-4 h-4" />
          </button>
          <button
            onClick={handleLeave}
            className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Leave"
          >
            <FiLogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {!streamUrl ? (
            <div className="flex-1 flex flex-col items-center overflow-y-auto">
              <div className="max-w-lg w-full space-y-6 py-8 px-6">
                {torrentLoading && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-zinc-400">
                      <div className="typing-dot w-2 h-2 bg-purple-400 rounded-full inline-block" />
                      <div className="typing-dot w-2 h-2 bg-purple-400 rounded-full inline-block" />
                      <div className="typing-dot w-2 h-2 bg-purple-400 rounded-full inline-block" />
                      <span className="ml-2">Loading torrent metadata...</span>
                    </div>
                    {torrentProgress && (
                      <div className="text-center text-sm text-zinc-500 space-y-1">
                        <p>Peers: {torrentProgress.peers} | Progress: {(torrentProgress.progress * 100).toFixed(1)}%</p>
                        {torrentProgress.speed > 0 && (
                          <p>Speed: {(torrentProgress.speed / 1024 / 1024).toFixed(1)} MB/s</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {torrentError && (
                  <div className="bg-red-900/40 border border-red-800 rounded-lg p-3 text-red-300 text-sm">
                    {torrentError}
                  </div>
                )}
                <MagnetInput onSubmit={handleStartTorrent} loading={torrentLoading} />

                {files.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-zinc-400">Torrent Files ({files.length})</h3>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {files.map((f) => (
                        <div
                          key={f.index}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${
                            selectedFile?.index === f.index
                              ? 'bg-purple-600/20 text-purple-300 border border-purple-600/30'
                              : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                          }`}
                          onClick={() => f.type === 'video' && handleSelectFile(f.index)}
                        >
                          {f.type === 'video' && <FiFilm className="w-3.5 h-3.5 shrink-0 text-blue-400" />}
                          {f.type === 'subtitle' && <FiFileText className="w-3.5 h-3.5 shrink-0 text-green-400" />}
                          {f.type === 'audio' && <FiMusic className="w-3.5 h-3.5 shrink-0 text-yellow-400" />}
                          {f.type === 'other' && <FiFileText className="w-3.5 h-3.5 shrink-0 text-zinc-500" />}
                          <span className="truncate">{f.name}</span>
                          <span className="text-[10px] text-zinc-600 ml-auto">{formatBytes(f.length)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {videoFiles.length > 1 && (
                  <FileSelector
                    files={files}
                    selectedIndex={selectedFile?.index ?? -1}
                    onSelect={handleSelectFile}
                    compact
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="relative flex-1">
              <VideoPlayer
                streamUrl={streamUrl}
                roomId={roomId}
                userName={userName}
                subtitleUrls={torrentInfoHash ? files
                  .filter((f) => f.type === 'subtitle')
                  .map((f) => ({
                    label: f.name,
                    url: `/subtitle/${torrentInfoHash}/${f.index}`,
                  })) : undefined
                }
              />
              {torrentProgress && torrentProgress.peers === 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-amber-900/80 backdrop-blur border border-amber-700/50 rounded-lg px-4 py-2 text-amber-200 text-xs text-center max-w-md pointer-events-none">
                  No seeders found — waiting for peers. Try the test links below.
                </div>
              )}
              {torrentProgress && torrentProgress.peers > 0 && torrentProgress.progress === 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-blue-900/80 backdrop-blur border border-blue-700/50 rounded-lg px-4 py-2 text-blue-200 text-xs text-center max-w-md pointer-events-none">
                  Connecting to {torrentProgress.peers} peer{torrentProgress.peers > 1 ? 's' : ''}...
                </div>
              )}
            </div>
          )}
        </div>

        {sidebarOpen && activePanel && (
          <aside className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col shrink-0 max-md:absolute max-md:right-0 max-md:top-12 max-md:bottom-0 max-md:w-72 max-md:z-10 max-md:shadow-2xl">
            <div className="flex items-center justify-between p-3 border-b border-zinc-800">
              <span className="text-sm font-medium text-zinc-300">
                {activePanel === 'chat' && 'Chat'}
                {activePanel === 'users' && `Users (${users.length})`}
                {activePanel === 'call' && 'Video Call'}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              {activePanel === 'chat' && <Chat roomId={roomId} />}
              {activePanel === 'users' && (
                <div className="p-3 space-y-1 overflow-y-auto h-full">
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50"
                    >
                      <div className={`w-2 h-2 rounded-full ${u.isHost ? 'bg-purple-400' : 'bg-green-500'}`} />
                      <span className="text-sm text-zinc-200">{u.name}</span>
                      {u.isHost && <span className="text-xs text-purple-400 ml-auto">Host</span>}
                    </div>
                  ))}
                </div>
              )}
              {activePanel === 'call' && <VideoCall roomId={roomId} userName={userName} />}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
