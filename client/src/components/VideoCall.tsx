import { useState, useRef, useEffect, useCallback } from 'react';
import { getSocket } from '../lib/socket.ts';
import Peer from 'peerjs';
import { FiMic, FiMicOff, FiVideo, FiVideoOff, FiPhone, FiPhoneOff, FiLoader } from 'react-icons/fi';

interface VideoCallProps {
  roomId: string;
  userName: string;
}

interface CallPeer {
  id: string;
  stream: MediaStream;
  name: string;
}

export default function VideoCall({ roomId, userName }: VideoCallProps) {
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<CallPeer[]>([]);
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [callError, setCallError] = useState('');
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);

  const myVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, CallPeer>>(new Map());
  const socket = getSocket();

  useEffect(() => {
    if (!inCall) return;

    setConnecting(true);
    setCallError('');

    const p = new Peer(`watchtorrent-${socket.id}`);
    peerRef.current = p;

    p.on('open', (id) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          streamRef.current = stream;
          setMyStream(stream);
          setConnecting(false);
          if (myVideoRef.current) myVideoRef.current.srcObject = stream;

          p.on('call', (call) => {
            call.answer(stream);
            call.on('stream', (remoteStream) => {
              peersRef.current.set(call.peer, { id: call.peer, stream: remoteStream, name: 'Friend' });
              setPeers(Array.from(peersRef.current.values()));
            });
            call.on('close', () => {
              peersRef.current.delete(call.peer);
              setPeers(Array.from(peersRef.current.values()));
            });
          });

          socket.emit('signal', { roomId, type: 'join-call', peerId: id, name: userName });
        })
        .catch((err) => {
          setConnecting(false);
          setCallError('Camera/mic access denied. Grant permission and try again.');
          setInCall(false);
        });
    });

    p.on('error', (err) => {
      setConnecting(false);
      setCallError('Failed to connect: ' + (err.message || 'Peer server unreachable'));
      setInCall(false);
    });

    function onSignal(data: any) {
      if (data.type !== 'join-call') return;
      if (data.peerId === p.id) return;
      if (peersRef.current.has(data.peerId)) return;
      const s = streamRef.current;
      if (!s) return;
      const call = p.call(data.peerId, s);
      call.on('stream', (remoteStream) => {
        peersRef.current.set(data.peerId, { id: data.peerId, stream: remoteStream, name: data.name || 'Friend' });
        setPeers(Array.from(peersRef.current.values()));
      });
      call.on('close', () => {
        peersRef.current.delete(data.peerId);
        setPeers(Array.from(peersRef.current.values()));
      });
    }

    socket.on('signal', onSignal);

    return () => {
      socket.off('signal', onSignal);
      p.destroy();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      peersRef.current.clear();
      setPeers([]);
      setMyStream(null);
      setConnecting(false);
    };
  }, [inCall, roomId, socket]);

  const stopCall = useCallback(() => {
    peerRef.current?.destroy();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    peersRef.current.clear();
    setPeers([]);
    setMyStream(null);
    setInCall(false);
    setConnecting(false);
    setCallError('');
  }, []);

  const toggleAudio = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const enabled = s.getAudioTracks().some((t) => t.enabled);
    s.getAudioTracks().forEach((t) => { t.enabled = !enabled; });
    setAudioMuted(enabled);
  }, []);

  const toggleVideo = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const enabled = s.getVideoTracks().some((t) => t.enabled);
    s.getVideoTracks().forEach((t) => { t.enabled = !enabled; });
    setVideoOff(enabled);
  }, []);

  if (!inCall) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 space-y-4">
        <div className="w-16 h-16 rounded-full bg-purple-600/20 flex items-center justify-center">
          <FiVideo className="w-7 h-7 text-purple-400" />
        </div>
        <p className="text-zinc-400 text-sm text-center">
          Start a video call with everyone in the room
        </p>
        {callError && (
          <p className="text-red-400 text-xs text-center max-w-[200px]">{callError}</p>
        )}
        <button
          onClick={() => { setCallError(''); setInCall(true); }}
          className="px-6 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 transition-colors font-medium text-sm flex items-center gap-2 cursor-pointer"
        >
          <FiPhone className="w-4 h-4" />
          Join Call
        </button>
      </div>
    );
  }

  if (connecting) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 space-y-4">
        <FiLoader className="w-8 h-8 text-purple-400 animate-spin" />
        <p className="text-zinc-400 text-sm">Connecting to call...</p>
        <button
          onClick={stopCall}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm cursor-pointer"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 space-y-3">
      <div className="flex-1 grid gap-2 overflow-y-auto" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(140px, 1fr))` }}>
        <div className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden">
          <video ref={myVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-zinc-300">
            {userName} (you)
          </span>
          {videoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
              <span className="text-2xl font-bold text-zinc-600">{userName[0]}</span>
            </div>
          )}
        </div>
        {peers.map((p) => (
          <div key={p.id} className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden">
            <video autoPlay playsInline className="w-full h-full object-cover" ref={(el) => { if (el) el.srcObject = p.stream; }} />
            <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-zinc-300">
              {p.name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={toggleAudio}
          className={`p-3 rounded-full transition-all cursor-pointer ${audioMuted ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          {audioMuted ? <FiMicOff className="w-4 h-4" /> : <FiMic className="w-4 h-4" />}
        </button>
        <button
          onClick={stopCall}
          className="p-3 rounded-full bg-red-600 text-white hover:bg-red-500 transition-all cursor-pointer"
        >
          <FiPhoneOff className="w-4 h-4" />
        </button>
        <button
          onClick={toggleVideo}
          className={`p-3 rounded-full transition-all cursor-pointer ${videoOff ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          {videoOff ? <FiVideoOff className="w-4 h-4" /> : <FiVideo className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
