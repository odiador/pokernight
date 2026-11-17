import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GripVertical,
  Maximize2,
  Minimize2,
  Music,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { X } from 'lucide-react';
import type { GameState, MusicMode, PlaylistTrack } from '../../shared/poker.ts';

interface MusicSidebarProps {
  open: boolean;
  onClose: () => void;
  gameState: GameState;
  musicOn: boolean;
  ncsMode: MusicMode;
  isOwner: boolean;
  clockOffset: number;
  onToggleMusic: () => void;
  onToggleRoomPause: () => void;
  onSelectMode: (mode: MusicMode) => void;
  onUpdatePlaylist: (playlist: PlaylistTrack[], currentIndex: number) => void;
  onSeek: (seconds: number) => void;
  onKick: (targetId: string) => void;
}

const NCS_CATALOG: Omit<PlaylistTrack, 'id'>[] = [
  { title: 'NCS - Cartoon, Jéja - On & On', youtubeId: 'K4DyBUG242c' },
  { title: 'NCS - Elektronomia - Sky High', youtubeId: 'TW9d8vYrVFQ' },
  { title: 'NCS - Alan Walker - Fade', youtubeId: 'bM7SZ5SBzyY' },
  { title: 'NCS - Different Heaven - Nekozilla', youtubeId: '6FNHe3kf8_s' },
  { title: 'NCS - Janji - Heroes Tonight', youtubeId: '3nQNiWdeH2Q' },
  { title: 'NCS - DEAF KEV - Invincible', youtubeId: 'J2X5mJ3HDYE' },
  { title: 'NCS - Disfigure - Blank', youtubeId: 'p7ZsBPK656s' },
  { title: 'NCS - Tobu - Hope', youtubeId: 'EP625xQIGzs' },
  { title: 'NCS - Syn Cole - Feel Good', youtubeId: 'q1ULJ92aldE' },
  { title: 'NCS - Warriyo - Mortals', youtubeId: 'yJg-Y5byMMw' },
  { title: 'NCS - Lost Sky - Fearless', youtubeId: '9rujCfYXhQc' },
  { title: 'NCS - Spektrem - Shine', youtubeId: 'n4tK7LYFxI0' },
];

export function MusicSidebar({
  open,
  onClose,
  gameState,
  musicOn,
  ncsMode,
  isOwner,
  clockOffset,
  onToggleMusic,
  onToggleRoomPause,
  onSelectMode,
  onUpdatePlaylist,
  onSeek,
  onKick,
}: MusicSidebarProps) {
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [remoteResults, setRemoteResults] = useState<Omit<PlaylistTrack, 'id'>[]>([]);
  const [searching, setSearching] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem('pokernight_volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 100 && localStorage.getItem('pokernight_volume') !== null
      ? saved
      : 70;
  });
  const [toastTitle, setToastTitle] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(() => localStorage.getItem('pokernight_sidebar_pinned') === 'true');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const endedHandledRef = useRef<string | null>(null);
  const lastDriftFixRef = useRef(0);

  const playlist = gameState.music?.playlist ?? [];
  const currentIndex = gameState.music?.currentIndex ?? 0;
  const currentTrack = playlist[currentIndex];
  const startedAt = gameState.music?.startedAt ?? 0;
  const roomPaused = Boolean(gameState.music?.paused);
  const isPlayingActive = musicOn && !roomPaused;

  const getExpectedSeconds = () =>
    roomPaused
      ? gameState.music?.pausedAtSec ?? 0
      : startedAt
      ? Math.max(0, Math.floor((Date.now() + clockOffset - startedAt) / 1000))
      : 0;

  const seekIframeTo = (sec: number) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [sec, true] }),
      '*'
    );
    if (isPlayingActive) {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
        '*'
      );
    }
  };

  // Sync when server updates startedAt (from any client)
  useEffect(() => {
    if (ncsMode === 'lounge' || !startedAt) return;
    const expected = getExpectedSeconds();
    setElapsedSec(expected);
    seekIframeTo(expected);
  }, [startedAt, ncsMode]);

  // Play / pause sync (shared room state + local musicOn)
  useEffect(() => {
    if (ncsMode === 'lounge') return;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: isPlayingActive ? 'playVideo' : 'pauseVideo', args: [] }),
      '*'
    );
  }, [isPlayingActive, ncsMode]);

  // Reset track metadata + show toast on song change
  useEffect(() => {
    setDurationSec(null);
    setElapsedSec(0);
    setSeekDraft(null);
    endedHandledRef.current = null;
    if (!currentTrack || ncsMode === 'lounge') return;
    setToastTitle(currentTrack.title);
    const t = setTimeout(() => setToastTitle(null), 4000);
    return () => clearTimeout(t);
  }, [currentTrack?.id, ncsMode]);

  // Listen to YouTube player state, duration, and drift-correct currentTime
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('{')) return;
      try {
        const data = JSON.parse(e.data);
        if (data?.info?.playerState === 0 && playlist.length > 0 && currentTrack) {
          if (endedHandledRef.current !== currentTrack.id) {
            endedHandledRef.current = currentTrack.id;
            onUpdatePlaylist(playlist, (currentIndex + 1) % playlist.length);
          }
          return;
        }
        const ytDuration = data?.info?.duration;
        if (typeof ytDuration === 'number' && ytDuration > 0) {
          setDurationSec(Math.floor(ytDuration));
        }
        const ytTime = data?.info?.currentTime;
        if (typeof ytTime === 'number' && seekDraft === null) {
          const expected = getExpectedSeconds();
          // If client drifted > 2.5s from server wall-clock (e.g. slow load), snap back in sync
          if (isPlayingActive && Math.abs(ytTime - expected) > 2.5 && Date.now() - lastDriftFixRef.current > 4000) {
            lastDriftFixRef.current = Date.now();
            seekIframeTo(expected);
            setElapsedSec(expected);
          } else {
            setElapsedSec(Math.floor(ytTime));
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [startedAt, clockOffset, seekDraft, isPlayingActive, currentTrack?.id, currentIndex, playlist.length]);

  // Persist volume (effectiveVolume = 0 when locally muted via musicOn === false)
  useEffect(() => {
    localStorage.setItem('pokernight_volume', String(volume));
    const effective = musicOn ? volume : 0;
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'setVolume', args: [effective] }),
      '*'
    );
  }, [volume, musicOn]);

  // Live YouTube search
  useEffect(() => {
    const q = newTitle.trim();
    if (q.length < 2) {
      setRemoteResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/yt-search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = (await res.json()) as Omit<PlaylistTrack, 'id'>[];
          setRemoteResults(data);
        }
      } catch {
        // Fallback to local catalog
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [newTitle]);

  const iframeSrc = useMemo(() => {
    if (!currentTrack) return '';
    const startSec = getExpectedSeconds();
    return `https://www.youtube.com/embed/${currentTrack.youtubeId}?autoplay=1&start=${startSec}&controls=0&modestbranding=1&rel=0&enablejsapi=1`;
  }, [currentTrack?.youtubeId]);

  const handleAddTrack = async () => {
    const raw = newUrl.trim();
    const remoteRoomMatch = raw.match(/invitar\/([A-Za-z0-9_-]+)/);
    if (remoteRoomMatch || /^\d{4}$/.test(raw)) {
      const targetRoom = remoteRoomMatch ? remoteRoomMatch[1] : raw;
      const origin = raw.startsWith('http') ? new URL(raw).origin : '';
      try {
        const res = await fetch(`${origin}/api/room-info?room=${encodeURIComponent(targetRoom)}`);
        if (res.ok) {
          const info = (await res.json()) as { playlist?: PlaylistTrack[] };
          if (info.playlist && info.playlist.length > 0) {
            onUpdatePlaylist(info.playlist, 0);
            setNewUrl('');
            return;
          }
        }
      } catch {
        // Ignore remote room fetch error
      }
    }
    const listMatch = raw.match(/[?&]list=([A-Za-z0-9_-]+)/);
    const vidMatch = raw.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    if (listMatch) {
      try {
        const qs = `list=${encodeURIComponent(listMatch[1])}${vidMatch ? `&v=${encodeURIComponent(vidMatch[1])}` : ''}`;
        const res = await fetch(`/api/yt-playlist?${qs}`);
        if (res.ok) {
          const items = (await res.json()) as Omit<PlaylistTrack, 'id'>[];
          if (items.length > 0) {
            const added: PlaylistTrack[] = items.map((item, i) => ({
              id: `${Date.now()}-${i}`,
              title: item.title,
              youtubeId: item.youtubeId,
            }));
            const next = [...playlist, ...added];
            onUpdatePlaylist(next, playlist.length);
            setNewTitle('');
            setNewUrl('');
            return;
          }
        }
      } catch {
        // Fallback to single video
      }
    }
    const match = raw.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    const youtubeId = match ? match[1] : raw;
    if (!youtubeId) return;
    const next: PlaylistTrack[] = [
      ...playlist,
      {
        id: String(Date.now()),
        title: newTitle.trim() || `NCS Track ${playlist.length + 1}`,
        youtubeId,
      },
    ];
    onUpdatePlaylist(next, next.length - 1);
    setNewTitle('');
    setNewUrl('');
  };

  return (
    <aside
      className={
        !open
          ? 'fixed bottom-0 right-0 w-1 h-1 opacity-0 pointer-events-none overflow-hidden'
          : isFullscreen
          ? 'fixed inset-0 z-50 w-full h-screen overflow-hidden bg-zinc-950/95 backdrop-blur flex flex-col shadow-2xl'
          : isPinned
          ? 'fixed inset-y-0 right-0 z-40 w-80 bg-zinc-900/95 backdrop-blur border-l border-zinc-800 flex flex-col shadow-2xl lg:static lg:h-auto lg:rounded-2xl lg:border'
          : 'fixed inset-y-0 right-0 z-40 w-80 bg-zinc-900/95 backdrop-blur border-l border-zinc-800 flex flex-col shadow-2xl'
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Music className="w-4 h-4 text-emerald-400" />
          Sala &amp; Música
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() =>
              setIsPinned((v) => {
                const next = !v;
                localStorage.setItem('pokernight_sidebar_pinned', String(next));
                return next;
              })
            }
            title={isPinned ? 'Despinear panel' : 'Fijar panel a la mesa'}
            className={`p-1.5 rounded-lg cursor-pointer ${
              isPinned ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        className={
          isFullscreen
            ? 'max-w-3xl w-full mx-auto flex-1 overflow-y-auto p-6 space-y-4'
            : 'flex-1 overflow-y-auto p-4 space-y-4'
        }
      >
        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: 'lounge' as const, label: 'Lounge Casino' },
            { id: 'ncs-gaming' as const, label: 'Playlist NCS' },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => onSelectMode(opt.id)}
              className={`text-xs py-2 px-2.5 rounded-xl font-medium transition cursor-pointer ${
                ncsMode === opt.id
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Visible YouTube Player + Custom HUD */}
        {ncsMode !== 'lounge' && currentTrack && iframeSrc && (
          <div className="space-y-2">
            <div className="rounded-xl overflow-hidden border border-zinc-800 bg-black aspect-video">
              <iframe
                ref={iframeRef}
                key={currentTrack.youtubeId}
                className="w-full h-full pointer-events-none"
                src={iframeSrc}
                onLoad={() => {
                  iframeRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: 'listening' }),
                    '*'
                  );
                  iframeRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: 'command', func: 'setVolume', args: [volume] }),
                    '*'
                  );
                  const expected = getExpectedSeconds();
                  if (expected > 2) seekIframeTo(expected);
                }}
                allow="autoplay; encrypted-media"
                title={currentTrack.title}
              />
            </div>

            <div className="rounded-xl bg-zinc-950/90 border border-zinc-800 p-3.5 space-y-3">
              <div>
                <div className="text-sm font-bold text-white truncate" title={currentTrack.title}>
                  {currentTrack.title.includes(' - ')
                    ? currentTrack.title.split(' - ').slice(1).join(' - ')
                    : currentTrack.title}{' '}
                  <span className="text-zinc-500 font-normal">|</span>{' '}
                  <span className="text-zinc-300 font-medium">
                    {currentTrack.title.includes(' - ') ? currentTrack.title.split(' - ')[0] : 'YouTube'}
                  </span>
                </div>
                <div className="text-xs text-zinc-400">Poker Night • Sala</div>
              </div>

              <div className="space-y-1">
                <input
                  type="range"
                  min={0}
                  max={durationSec ?? Math.max(300, elapsedSec)}
                  value={seekDraft ?? elapsedSec}
                  onChange={(e) => setSeekDraft(Number(e.target.value))}
                  onMouseUp={() => {
                    if (seekDraft !== null) {
                      setElapsedSec(seekDraft);
                      seekIframeTo(seekDraft);
                      onSeek(seekDraft);
                      setSeekDraft(null);
                    }
                  }}
                  onTouchEnd={() => {
                    if (seekDraft !== null) {
                      setElapsedSec(seekDraft);
                      seekIframeTo(seekDraft);
                      onSeek(seekDraft);
                      setSeekDraft(null);
                    }
                  }}
                  className="w-full accent-white cursor-pointer"
                />
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span>
                    {Math.floor((seekDraft ?? elapsedSec) / 60)}:
                    {String((seekDraft ?? elapsedSec) % 60).padStart(2, '0')}
                  </span>
                  <span>
                    {durationSec
                      ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
                      : '--:--'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-6">
                <button
                  onClick={() => {
                    if (playlist.length > 0) {
                      onUpdatePlaylist(playlist, (currentIndex - 1 + playlist.length) % playlist.length);
                    }
                  }}
                  className="p-2 text-zinc-300 hover:text-white transition cursor-pointer"
                  title="Anterior"
                >
                  <SkipBack className="w-5 h-5 fill-current" />
                </button>
                <button
                  onClick={onToggleRoomPause}
                  className="w-11 h-11 rounded-full bg-zinc-100 hover:bg-white text-zinc-950 flex items-center justify-center shadow-lg transition cursor-pointer"
                  title={isPlayingActive ? 'Pausar para la sala' : 'Reanudar para la sala'}
                >
                  {isPlayingActive ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>
                <button
                  onClick={() => {
                    if (playlist.length > 0) {
                      onUpdatePlaylist(playlist, (currentIndex + 1) % playlist.length);
                    }
                  }}
                  className="p-2 text-zinc-300 hover:text-white transition cursor-pointer"
                  title="Siguiente"
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={onToggleMusic}
                  title={musicOn ? 'Silenciar localmente' : 'Activar audio local'}
                  className="text-zinc-400 hover:text-white shrink-0 cursor-pointer"
                >
                  {musicOn && volume > 0 ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-rose-400" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="flex-1 accent-emerald-500 cursor-pointer"
                />
                <span className="text-[10px] font-mono text-zinc-400 w-7 text-right">{volume}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Shared Playlist */}
        <div>
          <div className="text-xs font-semibold text-zinc-400 mb-2">Playlist compartida</div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {playlist.map((track, idx) => {
              const isCurrent = idx === currentIndex && ncsMode !== 'lounge';
              return (
                <div
                  key={track.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIdx(idx);
                  }}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) {
                      const next = [...playlist];
                      const [moved] = next.splice(dragIdx, 1);
                      next.splice(idx, 0, moved);
                      const newCurrent = currentIndex === dragIdx ? idx : currentIndex;
                      onUpdatePlaylist(next, newCurrent);
                    }
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  className={`flex items-center justify-between gap-1.5 text-xs px-2 py-1.5 rounded-xl border transition ${
                    dragOverIdx === idx && dragIdx !== idx
                      ? 'border-emerald-400 bg-emerald-500/20'
                      : isCurrent
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200'
                      : 'bg-zinc-950/70 border-zinc-800/80 text-zinc-300'
                  } ${dragIdx === idx ? 'opacity-50' : ''}`}
                >
                  <GripVertical className="w-3.5 h-3.5 text-zinc-500 shrink-0 cursor-grab active:cursor-grabbing" />
                  <button
                    onClick={() => onUpdatePlaylist(playlist, idx)}
                    className="truncate text-left flex-1 hover:text-white cursor-pointer"
                    title={track.title}
                  >
                    {isCurrent ? '▶ ' : ''}
                    {track.title}
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      disabled={idx === 0}
                      onClick={() => {
                        const next = [...playlist];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        onUpdatePlaylist(next, idx - 1);
                      }}
                      className="px-1 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      ↑
                    </button>
                    <button
                      disabled={idx === playlist.length - 1}
                      onClick={() => {
                        const next = [...playlist];
                        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                        onUpdatePlaylist(next, idx + 1);
                      }}
                      className="px-1 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => {
                        const next = playlist.filter((_, i) => i !== idx);
                        onUpdatePlaylist(next, 0);
                      }}
                      className="px-1 text-rose-400 hover:text-rose-300 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Search & Add Track */}
          <div className="mt-3 space-y-1.5">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Buscar NCS o escribir nombre..."
              className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            {newTitle.trim().length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-xl bg-zinc-950 border border-zinc-800 p-1 space-y-0.5">
                {searching && <div className="text-[11px] text-zinc-400 px-2 py-1">Buscando en YouTube...</div>}
                {(remoteResults.length > 0
                  ? remoteResults
                  : NCS_CATALOG.filter((t) => t.title.toLowerCase().includes(newTitle.trim().toLowerCase()))
                ).map((item) => (
                  <button
                    key={item.youtubeId}
                    onClick={() => {
                      const next: PlaylistTrack[] = [
                        ...playlist,
                        { id: String(Date.now()), title: item.title, youtubeId: item.youtubeId },
                      ];
                      onUpdatePlaylist(next, next.length - 1);
                      setNewTitle('');
                      setRemoteResults([]);
                    }}
                    className="w-full text-left text-[11px] px-2 py-1 rounded-lg text-zinc-300 hover:bg-emerald-500/20 hover:text-emerald-200 truncate cursor-pointer"
                  >
                    + {item.title}
                  </button>
                ))}
                {!searching &&
                  remoteResults.length === 0 &&
                  NCS_CATALOG.filter((t) => t.title.toLowerCase().includes(newTitle.trim().toLowerCase())).length ===
                    0 && (
                    <div className="text-[11px] text-zinc-500 px-2 py-1">
                      Sin resultados. Pega un link de YouTube abajo.
                    </div>
                  )}
              </div>
            )}
            <div className="flex gap-1.5">
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="Link o ID de YouTube"
                className="flex-1 rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleAddTrack}
                className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Spectators */}
        {(gameState.spectators?.length ?? 0) > 0 && (
          <div className="border-t border-zinc-800 pt-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 mb-2">
              <Users className="w-3.5 h-3.5" />
              Espectadores ({gameState.spectators.length})
            </div>
            <div className="space-y-1">
              {gameState.spectators.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-xs px-2.5 py-1 rounded-lg bg-zinc-950/60 text-zinc-300"
                >
                  <span className="truncate">{s.name}</span>
                  {isOwner && (
                    <button
                      onClick={() => onKick(s.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {toastTitle && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-zinc-900/95 border border-emerald-500/40 shadow-2xl text-xs text-white flex items-center gap-2">
          <Music className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate max-w-[240px]">
            Reproduciendo: <strong>{toastTitle}</strong>
          </span>
        </div>
      )}
    </aside>
  );
}
