import { useRef, useEffect, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket.ts';
import { formatTime } from '../lib/utils.ts';

interface VideoPlayerProps {
  streamUrl: string;
  roomId: string;
  userName: string;
  subtitleUrls?: { label: string; url: string }[];
}

interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const SKIP = 10;
const BIG_SKIP = 30;

export default function VideoPlayer({ streamUrl, roomId, userName, subtitleUrls: _subUrls }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSync = useRef(0);
  const socket = getSocket();

  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [show, setShow] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const [hoverPx, setHoverPx] = useState(0);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);
  const [subCues, setSubCues] = useState<SubtitleCue[]>([]);
  const [subOn, setSubOn] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [stalled, setStalled] = useState(false);

  const el = () => videoRef.current;
  const durSec = dur || 0;
  const pct = durSec > 0 ? (time / durSec) * 100 : 0;
  const bufPct = durSec > 0 ? (buffered / durSec) * 100 : 0;

  useEffect(() => {
    const v = el();
    if (!v) return;
    const vv = v!;

    function onPlay() { setPaused(false); sync('sync-play', vv.currentTime); }
    function onPause() { setPaused(true); sync('sync-pause', vv.currentTime); }
    function onTime() { setTime(vv.currentTime); }
    function onDur() { setDur(vv.duration || 0); }
    function onProg() {
      try { if (vv.buffered.length > 0) setBuffered(vv.buffered.end(vv.buffered.length - 1)); } catch {}
    }
    function onRate() { setRate(vv.playbackRate); }
    function onWaiting() { setStalled(true); }
    function onCanPlay() { setStalled(false); }

    vv.addEventListener('play', onPlay);
    vv.addEventListener('pause', onPause);
    vv.addEventListener('timeupdate', onTime);
    vv.addEventListener('durationchange', onDur);
    vv.addEventListener('progress', onProg);
    vv.addEventListener('ratechange', onRate);
    vv.addEventListener('waiting', onWaiting);
    vv.addEventListener('canplay', onCanPlay);
    vv.addEventListener('canplaythrough', onCanPlay);
    return () => {
      vv.removeEventListener('play', onPlay);
      vv.removeEventListener('pause', onPause);
      vv.removeEventListener('timeupdate', onTime);
      vv.removeEventListener('durationchange', onDur);
      vv.removeEventListener('progress', onProg);
      vv.removeEventListener('ratechange', onRate);
      vv.removeEventListener('waiting', onWaiting);
      vv.removeEventListener('canplay', onCanPlay);
      vv.removeEventListener('canplaythrough', onCanPlay);
    };
  }, [socket]);

  useEffect(() => {
    const fn = (type: string) => (data: any) => {
      if (data.by === socket.id) return;
      const v = el();
      if (!v) return;
      lastSync.current = Date.now();
      if (type === 'seek' || type === 'play' || type === 'pause') v.currentTime = data.position;
      if (type === 'play') v.play().catch(() => {});
      if (type === 'pause') v.pause();
    };
    socket.on('sync-play', fn('play'));
    socket.on('sync-pause', fn('pause'));
    socket.on('sync-seek', fn('seek'));
    return () => {
      socket.off('sync-play', fn('play'));
      socket.off('sync-pause', fn('pause'));
      socket.off('sync-seek', fn('seek'));
    };
  }, [socket]);

  function sync(event: string, pos: number) {
    const now = Date.now();
    if (now - lastSync.current > 500) {
      socket.emit(event, { roomId, position: pos });
      lastSync.current = now;
    }
  }

  function playPause() {
    const v = el();
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }

  function seek(t: number) {
    const v = el();
    if (!v) return;
    const clamped = Math.max(0, Math.min(t, v.duration || 0));
    v.currentTime = clamped;
    setTime(clamped);
    socket.emit('sync-seek', { roomId, position: clamped });
  }

  function skip(s: number) { const v = el(); if (v) seek((v.currentTime || 0) + s); }

  function toggleMute() {
    const v = el();
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }

  function onVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const v = el();
    if (!v) return;
    const val = parseFloat(e.target.value);
    v.volume = val;
    setVol(val);
    if (val > 0) v.muted = false;
    setMuted(val === 0);
  }

  function onRateChange(r: number) {
    const v = el();
    if (!v) return;
    v.playbackRate = r;
    setRate(r);
    setSpeedOpen(false);
  }

  function toggleFS() {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setFullscreen(false)).catch(() => {});
    }
  }

  function onProgressHover(e: React.MouseEvent<HTMLDivElement>) {
    const bar = progressRef.current;
    const v = el();
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setHoverSec(x * (v.duration || 0));
    setHoverPx(e.clientX - rect.left);
  }

  function onProgressLeave() { setHoverSec(null); }

  function onProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const bar = progressRef.current;
    const v = el();
    if (!bar || !v) return;
    const rect = bar.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    seek(x * (v.duration || 0));
  }

  function onSubFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const cues = parseSub(reader.result as string, file.name.endsWith('.vtt') ? 'vtt' : 'srt');
      setSubCues(cues);
      setSubOn(true);
      setSubOpen(false);
    };
    reader.readAsText(file);
  }

  function onSubFromTorrent(url: string, label: string) {
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('Subtitle not available');
        return r.text();
      })
      .then((text) => {
        const cues = parseSub(text, label.endsWith('.vtt') ? 'vtt' : 'srt');
        setSubCues(cues);
        setSubOn(true);
        setSubOpen(false);
      })
      .catch(() => {});
  }

  function showControls() {
    setShow(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!paused) hideTimer.current = setTimeout(() => setShow(false), 3000);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ': e.preventDefault(); playPause(); break;
        case 'ArrowLeft': e.preventDefault(); skip(-(e.shiftKey ? BIG_SKIP : SKIP)); break;
        case 'ArrowRight': e.preventDefault(); skip(e.shiftKey ? BIG_SKIP : SKIP); break;
        case 'ArrowUp': e.preventDefault(); const v1 = el(); if (v1) { v1.volume = Math.min(1, v1.volume + 0.1); setVol(v1.volume); } break;
        case 'ArrowDown': e.preventDefault(); const v2 = el(); if (v2) { v2.volume = Math.max(0, v2.volume - 0.1); setVol(v2.volume); } break;
        case 'f': case 'F': toggleFS(); break;
        case 'm': case 'M': toggleMute(); break;
        case ',': const v3 = el(); if (v3 && v3.paused) v3.currentTime = Math.max(0, v3.currentTime - 1/30); break;
        case '.': const v4 = el(); if (v4 && v4.paused) v4.currentTime = Math.min(v4.duration || 0, v4.currentTime + 1/30); break;
        case '0': seek(0); break;
        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9': const v5 = el(); if (v5?.duration) seek(v5.duration * (parseInt(e.key) / 10)); break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeSub = subOn && subCues.find((c) => time >= c.start && time < c.end);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 bg-black overflow-hidden"
      onMouseMove={showControls}
      onMouseLeave={() => !paused && setShow(false)}
    >
      <video
        ref={videoRef}
        src={streamUrl}
        className="w-full h-full object-contain cursor-pointer"
        onClick={playPause}
        playsInline
        crossOrigin="anonymous"
        preload="auto"
      />

      {stalled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center gap-1 mb-2">
              <div className="w-2 h-2 bg-purple-400 rounded-full typing-dot" />
              <div className="w-2 h-2 bg-purple-400 rounded-full typing-dot" style={{animationDelay:'0.2s'}} />
              <div className="w-2 h-2 bg-purple-400 rounded-full typing-dot" style={{animationDelay:'0.4s'}} />
            </div>
            <p className="text-zinc-300 text-sm">Waiting for data from peers...</p>
            <button
              onClick={() => { const v = videoRef.current; if (v) { v.src = streamUrl.split('?')[0] + '?_=' + Date.now(); v.load(); setStalled(false); } }}
              className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors cursor-pointer"
            >
              Retry stream
            </button>
          </div>
        </div>
      )}

      {activeSub && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 pointer-events-none max-w-[80%] text-center z-10">
          <p className="text-white text-lg md:text-xl leading-relaxed [text-shadow:0_1px_3px_rgba(0,0,0,0.9),0_0_6px_rgba(0,0,0,0.7)]">
            {activeSub.text.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}
          </p>
        </div>
      )}

      <div className={`absolute inset-0 transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

        {hoverSec !== null && (
          <div
            className="absolute bottom-16 bg-black/85 text-white text-xs px-2 py-1 rounded pointer-events-none -translate-x-1/2 z-10"
            style={{ left: `calc(16px + ${hoverPx}px)` }}
          >
            {formatTime(hoverSec)}
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 pt-16 pointer-events-auto">
          <div
            ref={progressRef}
            className="relative h-1 bg-zinc-700/60 rounded-full mb-3 cursor-pointer group/progress hover:h-1.5 transition-all"
            onMouseMove={onProgressHover}
            onMouseLeave={onProgressLeave}
            onClick={onProgressClick}
          >
            <div className="absolute h-full bg-zinc-500/40 rounded-full" style={{ width: `${bufPct}%` }} />
            <div className="absolute h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-purple-400 rounded-full opacity-0 group-hover/progress:opacity-100 transition-all shadow" style={{ left: `calc(${pct}% - 7px)` }} />
            {hoverSec !== null && (
              <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow" style={{ left: `calc(${(hoverSec / (durSec || 1)) * 100}% - 4px)` }} />
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button onClick={playPause} className="p-1.5 text-white hover:text-purple-400 transition-colors cursor-pointer" title={paused ? 'Play' : 'Pause'}>
                {paused ? (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                )}
              </button>

              <button onClick={() => skip(-BIG_SKIP)} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer hidden sm:block" title="Rewind 30s">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
              <button onClick={() => skip(-SKIP)} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Rewind 10s">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/><text x="12" y="16" fill="currentColor" stroke="none" fontSize="9" textAnchor="middle">10</text></svg>
              </button>
              <button onClick={() => skip(SKIP)} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Forward 10s">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/><text x="12" y="16" fill="currentColor" stroke="none" fontSize="9" textAnchor="middle">10</text></svg>
              </button>
              <button onClick={() => skip(BIG_SKIP)} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer hidden sm:block" title="Forward 30s">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>
              </button>

              <div className="w-px h-5 bg-zinc-700 mx-1" />

              <button onClick={toggleMute} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Mute">
                {muted || vol === 0 ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                ) : vol < 0.5 ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                )}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : vol} onChange={onVolume} className="w-14 h-1 accent-purple-500 cursor-pointer" />

              <span className="text-xs text-zinc-400 tabular-nums ml-1 cursor-pointer hover:text-zinc-200" onClick={() => setShowRemaining(!showRemaining)}>
                {showRemaining ? `-${formatTime(Math.max(0, durSec - time))}` : `${formatTime(time)} / ${formatTime(durSec)}`}
              </span>
            </div>

            <div className="flex items-center gap-0.5">
              <div className="relative">
                <button onClick={() => { setSpeedOpen(!speedOpen); setSubOpen(false); }} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Speed">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
                </button>
                {speedOpen && (
                  <div className="absolute bottom-full right-0 mb-2 bg-zinc-900 border border-zinc-700 rounded-lg py-1 min-w-[120px] shadow-xl z-10" onClick={(e) => e.stopPropagation()}>
                    {RATES.map((r) => (
                      <button key={r} onClick={() => onRateChange(r)}
                        className={`w-full text-left px-3 py-1 text-sm cursor-pointer ${rate === r ? 'text-purple-400 bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                      >{r}x</button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button onClick={() => { setSubOpen(!subOpen); setSpeedOpen(false); }} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Subtitles">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={subOn ? '#a855f7' : 'currentColor'} strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/></svg>
                </button>
                {subOpen && (
                  <div className="absolute bottom-full right-0 mb-2 bg-zinc-900 border border-zinc-700 rounded-lg py-1 min-w-[160px] shadow-xl z-10 max-h-60 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setSubOn(false); setSubOpen(false); }}
                      className={`w-full text-left px-3 py-1 text-sm cursor-pointer ${!subOn ? 'text-purple-400 bg-zinc-800' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                    >Off</button>
                    {_subUrls && _subUrls.length > 0 && (
                      <>
                        <div className="px-3 py-0.5 text-[10px] text-zinc-600 uppercase tracking-wider">From torrent</div>
                        {_subUrls.map((s) => (
                          <button key={s.url} onClick={() => onSubFromTorrent(s.url, s.label)}
                            className="w-full text-left px-3 py-1 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer truncate"
                          >{s.label}</button>
                        ))}
                        <div className="mx-2 my-1 border-t border-zinc-700" />
                      </>
                    )}
                    <button onClick={() => { document.getElementById('sub-input')?.click(); }}
                      className="w-full text-left px-3 py-1 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                    >Upload SRT/VTT...</button>
                    <input id="sub-input" type="file" accept=".srt,.vtt" onChange={onSubFile} className="hidden" />
                  </div>
                )}
              </div>

              <button onClick={toggleFS} className="p-1.5 text-zinc-300 hover:text-white transition-colors cursor-pointer" title="Fullscreen">
                {fullscreen ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                )}
              </button>

              <span className="text-[10px] text-zinc-600 ml-1 hidden sm:block">{userName}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseSub(content: string, fmt: 'srt' | 'vtt'): SubtitleCue[] {
  const data = content.replace(/\r\n/g, '\n').trim();
  const blocks = data.split(/\n\n+/);
  const out: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (fmt === 'vtt' && lines[0] === 'WEBVTT') continue;
    if (lines[0]?.startsWith('NOTE')) continue;
    const timeLine = lines.find((l) => l.includes('-->')) || lines[0];
    const m = timeLine.match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
    if (!m) continue;
    const start = +m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000;
    const end = +m[5]*3600 + +m[6]*60 + +m[7] + +m[8]/1000;
    const text = lines
      .filter((l) => !l.includes('-->') && !/^\d+$/.test(l.trim()))
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (text) out.push({ id: String(out.length + 1), start, end, text });
  }
  return out;
}
