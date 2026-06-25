import { useState, useRef, useEffect, useCallback } from 'react';
import { getSocket } from '../lib/socket.ts';
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

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Native WebRTC mesh. Signaling rides the existing Socket.IO connection (the
// same transport chat/sync already use successfully), so there's no separate
// PeerJS broker to fail. Each pair negotiates one RTCPeerConnection; the peer
// with the lower socket id makes the offer (avoids glare).
export default function VideoCall({ roomId, userName }: VideoCallProps) {
  const [peers, setPeers] = useState<CallPeer[]>([]);
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [callError, setCallError] = useState('');
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);

  const myVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peersRef = useRef<Map<string, CallPeer>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const iceRef = useRef<RTCIceServer[]>(FALLBACK_ICE);
  const socket = getSocket();

  const refresh = useCallback(() => setPeers(Array.from(peersRef.current.values())), []);

  // Pull ICE servers (incl. any env-configured TURN) from the server once.
  useEffect(() => {
    fetch('/api/ice')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && Array.isArray(j.iceServers) && j.iceServers.length) iceRef.current = j.iceServers; })
      .catch(() => { /* keep STUN fallback */ });
  }, []);

  useEffect(() => {
    if (!inCall) return;
    let cancelled = false;
    setConnecting(true);
    setCallError('');
    const myId = socket.id;

    const removePeer = (peerId: string) => {
      const pc = pcsRef.current.get(peerId);
      if (pc) { try { pc.close(); } catch { /* ignore */ } pcsRef.current.delete(peerId); }
      peersRef.current.delete(peerId);
      pendingIceRef.current.delete(peerId);
      refresh();
    };

    const createPC = (peerId: string, name: string): RTCPeerConnection => {
      const existing = pcsRef.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      pcsRef.current.set(peerId, pc);
      namesRef.current.set(peerId, name);
      const local = localStreamRef.current;
      if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('signal', { type: 'call-ice', to: peerId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (!stream) return;
        peersRef.current.set(peerId, { id: peerId, stream, name: namesRef.current.get(peerId) || name });
        refresh();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch { /* best effort */ } }
        else if (pc.connectionState === 'closed') removePeer(peerId);
      };
      return pc;
    };

    const maybeOffer = async (peerId: string, name: string) => {
      if (pcsRef.current.has(peerId)) return;
      const pc = createPC(peerId, name);
      if (myId && myId < peerId) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('signal', { type: 'call-offer', to: peerId, sdp: pc.localDescription, name: userName });
        } catch { /* ignore */ }
      }
      // else: the lower-id peer offers; we answer in the call-offer handler.
    };

    const drainIce = async (peerId: string, pc: RTCPeerConnection) => {
      const q = pendingIceRef.current.get(peerId);
      if (!q) return;
      pendingIceRef.current.delete(peerId);
      for (const c of q) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
    };

    const onSignal = async (data: any) => {
      if (!data || !data.from || data.from === myId) return;
      const from = data.from;
      if (data.name) namesRef.current.set(from, data.name);
      const name = namesRef.current.get(from) || 'Friend';

      switch (data.type) {
        case 'call-join':
          // Tell the newcomer we're here, then negotiate.
          socket.emit('signal', { type: 'call-here', to: from, name: userName });
          maybeOffer(from, name);
          break;
        case 'call-here':
          maybeOffer(from, name);
          break;
        case 'call-offer': {
          const pc = createPC(from, name);
          try {
            await pc.setRemoteDescription(data.sdp);
            await drainIce(from, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', { type: 'call-answer', to: from, sdp: pc.localDescription, name: userName });
          } catch { /* ignore */ }
          break;
        }
        case 'call-answer': {
          const pc = pcsRef.current.get(from);
          if (pc) { try { await pc.setRemoteDescription(data.sdp); await drainIce(from, pc); } catch { /* ignore */ } }
          break;
        }
        case 'call-ice': {
          const pc = pcsRef.current.get(from);
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try { await pc.addIceCandidate(data.candidate); } catch { /* ignore */ }
          } else {
            const q = pendingIceRef.current.get(from) || [];
            q.push(data.candidate);
            pendingIceRef.current.set(from, q);
          }
          break;
        }
        case 'call-leave':
          removePeer(from);
          break;
      }
    };

    const onUserLeft = (d: any) => { if (d?.userId) removePeer(d.userId); };

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        setConnecting(false);
        if (myVideoRef.current) myVideoRef.current.srcObject = stream;
        socket.on('signal', onSignal);
        socket.on('user-left', onUserLeft);
        socket.emit('signal', { type: 'call-join', roomId, name: userName });
      })
      .catch(() => {
        if (cancelled) return;
        setConnecting(false);
        setCallError('Camera/mic access denied. Grant permission and try again.');
        setInCall(false);
      });

    return () => {
      cancelled = true;
      socket.off('signal', onSignal);
      socket.off('user-left', onUserLeft);
      socket.emit('signal', { type: 'call-leave', roomId });
      pcsRef.current.forEach((pc) => { try { pc.close(); } catch { /* ignore */ } });
      pcsRef.current.clear();
      peersRef.current.clear();
      pendingIceRef.current.clear();
      namesRef.current.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setPeers([]);
      setConnecting(false);
    };
  }, [inCall, roomId, socket, userName, refresh]);

  // Bind the local preview once the call UI has mounted its <video>.
  useEffect(() => {
    if (inCall && !connecting && myVideoRef.current && localStreamRef.current) {
      myVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [inCall, connecting, peers.length]);

  const stopCall = useCallback(() => { setInCall(false); setConnecting(false); setCallError(''); }, []);

  const toggleAudio = useCallback(() => {
    const s = localStreamRef.current;
    if (!s) return;
    const enabled = s.getAudioTracks().some((t) => t.enabled);
    s.getAudioTracks().forEach((t) => { t.enabled = !enabled; });
    setAudioMuted(enabled);
  }, []);

  const toggleVideo = useCallback(() => {
    const s = localStreamRef.current;
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
        <p className="text-zinc-400 text-sm text-center">Start a video call with everyone in the room</p>
        {callError && <p className="text-red-400 text-xs text-center max-w-[220px]">{callError}</p>}
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
        <button onClick={stopCall} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm cursor-pointer">Cancel</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 space-y-3">
      <div className="flex-1 grid gap-2 overflow-y-auto content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
        <div className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden">
          <video ref={myVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-zinc-300">{userName} (you)</span>
          {videoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-800">
              <span className="text-2xl font-bold text-zinc-600">{userName[0]?.toUpperCase() || '?'}</span>
            </div>
          )}
        </div>
        {peers.map((p) => (
          <div key={p.id} className="relative aspect-video bg-zinc-800 rounded-lg overflow-hidden">
            <video autoPlay playsInline className="w-full h-full object-cover" ref={(el) => { if (el && el.srcObject !== p.stream) { el.srcObject = p.stream; el.play?.().catch(() => {}); } }} />
            <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-zinc-300">{p.name}</span>
          </div>
        ))}
      </div>

      {peers.length === 0 && (
        <p className="text-center text-zinc-500 text-xs shrink-0">Waiting for others to join the call…</p>
      )}

      <div className="flex items-center justify-center gap-3 shrink-0">
        <button
          onClick={toggleAudio}
          title={audioMuted ? 'Unmute' : 'Mute'}
          className={`p-3 rounded-full transition-all cursor-pointer ${audioMuted ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          {audioMuted ? <FiMicOff className="w-4 h-4" /> : <FiMic className="w-4 h-4" />}
        </button>
        <button onClick={stopCall} title="Leave call" className="p-3 rounded-full bg-red-600 text-white hover:bg-red-500 transition-all cursor-pointer">
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
