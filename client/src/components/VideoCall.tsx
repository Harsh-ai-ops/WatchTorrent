import { useState, useRef, useEffect, useCallback } from 'react';
import { getSocket } from '../lib/socket.ts';
import Peer from 'peerjs';
import type { MediaConnection } from 'peerjs';
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

// STUN handles direct (peer-to-peer) connections; the free public TURN relays
// (Open Relay) are the fallback for symmetric NATs and restrictive mobile
// networks where STUN alone fails — that's the usual cause of "connected but no
// video/audio". TURN traffic is relayed, so it always works but costs latency.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Connect to the PeerJS server we self-host on the same origin (mounted at
// /peerjs in server/index.js), so video calls work behind a single port and
// never depend on the rate-limited public PeerJS cloud broker.
function peerOptions() {
  const secure = window.location.protocol === 'https:';
  const port = window.location.port
    ? Number(window.location.port)
    : (secure ? 443 : 80);
  return {
    host: window.location.hostname,
    port,
    path: '/peerjs',
    secure,
    config: { iceServers: ICE_SERVERS },
  };
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
  // Peers we want to call but couldn't yet (stream/peer not ready) — drained
  // once getUserMedia resolves so no join signal is ever lost.
  const pendingRef = useRef<Map<string, string>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map());
  const announcedRef = useRef<Set<string>>(new Set());
  const socket = getSocket();

  const refreshPeers = useCallback(() => {
    setPeers(Array.from(peersRef.current.values()));
  }, []);

  useEffect(() => {
    if (!inCall) return;

    setConnecting(true);
    setCallError('');

    const myPeerId = `watchtorrent-${socket.id}`;
    const p = new Peer(myPeerId, peerOptions());
    peerRef.current = p;

    const wireCall = (call: MediaConnection, peerId: string, name: string) => {
      call.on('stream', (remoteStream) => {
        peersRef.current.set(peerId, { id: peerId, stream: remoteStream, name: namesRef.current.get(peerId) || name });
        pendingRef.current.delete(peerId);
        refreshPeers();
      });
      call.on('close', () => {
        peersRef.current.delete(peerId);
        refreshPeers();
      });
      call.on('error', () => {
        peersRef.current.delete(peerId);
        pendingRef.current.delete(peerId);
        refreshPeers();
      });
      // Drop a tile only once the underlying ICE connection truly fails/closes
      // ('disconnected' can recover, so we don't act on it).
      const pc = call.peerConnection;
      if (pc) {
        pc.addEventListener('iceconnectionstatechange', () => {
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            peersRef.current.delete(peerId);
            pendingRef.current.delete(peerId);
            refreshPeers();
          }
        });
      }
    };

    const callPeer = (peerId: string, name: string) => {
      if (peerId === p.id || peersRef.current.has(peerId)) return;
      const s = streamRef.current;
      if (!s || !peerRef.current) {
        pendingRef.current.set(peerId, name); // try again once media is ready
        return;
      }
      const call = peerRef.current.call(peerId, s);
      if (!call) return;
      pendingRef.current.delete(peerId);
      wireCall(call, peerId, name);
    };

    p.on('open', (id) => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then((stream) => {
          streamRef.current = stream;
          setMyStream(stream);
          setConnecting(false);
          if (myVideoRef.current) myVideoRef.current.srcObject = stream;

          p.on('call', (call) => {
            const name = namesRef.current.get(call.peer) || 'Friend';
            call.answer(stream);
            wireCall(call, call.peer, name);
          });

          // Drain anyone who tried to reach us before the camera was ready.
          pendingRef.current.forEach((name, peerId) => callPeer(peerId, name));

          socket.emit('signal', { roomId, type: 'join-call', peerId: id, name: userName });
        })
        .catch(() => {
          setConnecting(false);
          setCallError('Camera/mic access denied. Grant permission and try again.');
          setInCall(false);
        });
    });

    // The broker link dropped (idle reverse-proxy, network blip) but the peer
    // wasn't destroyed — reconnect instead of showing "Lost connection".
    p.on('disconnected', () => {
      if (!p.destroyed) {
        try { p.reconnect(); } catch { /* ignore */ }
      }
    });

    p.on('error', (err) => {
      // Transient errors are handled elsewhere (peer-unavailable = that peer not
      // ready yet; network/disconnected = the reconnect handler retries).
      const type = (err as unknown as { type?: string }).type;
      if (type === 'peer-unavailable' || type === 'network' || type === 'disconnected') return;
      setConnecting(false);
      setCallError('Call connection failed: ' + (err.message || 'peer server unreachable'));
      setInCall(false);
    });

    function onSignal(data: any) {
      if (!data || data.type !== 'join-call' || !data.peerId || data.peerId === p.id) return;
      const name = data.name || 'Friend';
      namesRef.current.set(data.peerId, name);
      if (peersRef.current.has(data.peerId)) return;
      // Deterministic initiator (lower id calls higher id) avoids both sides
      // dialing each other simultaneously and creating duplicate streams.
      if (p.id < data.peerId) {
        callPeer(data.peerId, name);
      } else if (!announcedRef.current.has(data.peerId)) {
        announcedRef.current.add(data.peerId);
        // Re-announce so the lower-id side knows we're here and initiates.
        socket.emit('signal', { roomId, type: 'join-call', peerId: p.id, name: userName });
      }
    }

    function onUserLeft(data: any) {
      const peerId = `watchtorrent-${data?.userId}`;
      peersRef.current.delete(peerId);
      pendingRef.current.delete(peerId);
      namesRef.current.delete(peerId);
      announcedRef.current.delete(peerId);
      refreshPeers();
    }

    socket.on('signal', onSignal);
    socket.on('user-left', onUserLeft);

    return () => {
      socket.off('signal', onSignal);
      socket.off('user-left', onUserLeft);
      p.destroy();
      peerRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      peersRef.current.clear();
      pendingRef.current.clear();
      namesRef.current.clear();
      announcedRef.current.clear();
      setPeers([]);
      setMyStream(null);
      setConnecting(false);
    };
  }, [inCall, roomId, socket, userName, refreshPeers]);

  // Keep the local preview wired even if the element mounts after the stream.
  useEffect(() => {
    if (myVideoRef.current && myStream) myVideoRef.current.srcObject = myStream;
  }, [myStream]);

  const stopCall = useCallback(() => {
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
          <p className="text-red-400 text-xs text-center max-w-[220px]">{callError}</p>
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
      <div className="flex-1 grid gap-2 overflow-y-auto content-start" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(120px, 1fr))` }}>
        <div className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden">
          <video ref={myVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-zinc-300">
            {userName} (you)
          </span>
          {videoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
              <span className="text-2xl font-bold text-zinc-600">{userName[0]?.toUpperCase() || '?'}</span>
            </div>
          )}
        </div>
        {peers.map((p) => (
          <div key={p.id} className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden">
            <video autoPlay playsInline className="w-full h-full object-cover" ref={(el) => { if (el && el.srcObject !== p.stream) el.srcObject = p.stream; }} />
            <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-zinc-300">
              {p.name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-3 shrink-0">
        <button
          onClick={toggleAudio}
          title={audioMuted ? 'Unmute' : 'Mute'}
          className={`p-3 rounded-full transition-all cursor-pointer ${audioMuted ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          {audioMuted ? <FiMicOff className="w-4 h-4" /> : <FiMic className="w-4 h-4" />}
        </button>
        <button
          onClick={stopCall}
          title="Leave call"
          className="p-3 rounded-full bg-red-600 text-white hover:bg-red-500 transition-all cursor-pointer"
        >
          <FiPhoneOff className="w-4 h-4" />
        </button>
        <button
          onClick={toggleVideo}
          title={videoOff ? 'Turn camera on' : 'Turn camera off'}
          className={`p-3 rounded-full transition-all cursor-pointer ${videoOff ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          {videoOff ? <FiVideoOff className="w-4 h-4" /> : <FiVideo className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
