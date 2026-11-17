import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, Coins, Copy, Crown, Music, Play, Plus, Spade, X } from 'lucide-react';
import type { ClientMessage, GameState, MusicMode, PlayerAction, PlaylistTrack, ServerMessage } from '../shared/poker.ts';
import { evaluateCurrentHand } from '../shared/evaluator.ts';
import { PlayingCard } from './components/PlayingCard.tsx';
import { MusicSidebar } from './components/MusicSidebar.tsx';
import {
  loungeMusic,
  playCheckSound,
  playChipSound,
  playClockTick,
  playDealSound,
  playFoldSound,
  playWinSound,
} from './utils/music.ts';

function getOrCreateClientId(): string {
  const existing = localStorage.getItem('pokernight_client_id');
  if (existing) return existing;
  const created = `c-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  localStorage.setItem('pokernight_client_id', created);
  return created;
}

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getRoomFromPath(): string | null {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  if (parts[0] === 'invitar' && parts.length >= 2) {
    return decodeURIComponent(parts.slice(1).join('-'));
  }
  return null;
}

function getActionBadgeStyle(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes('fold')) return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
  if (lower.includes('all-in')) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  if (lower.includes('raise')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  if (lower.includes('call')) return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
  if (lower.includes('check')) return 'bg-zinc-700/60 text-zinc-200 border-zinc-500/40';
  return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
}

export default function App() {
  const invitedRoom = getRoomFromPath();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [yourId, setYourId] = useState<string>('');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('pokernight_player_name') ?? '');
  const [roomId] = useState(() => invitedRoom ?? generateRoomCode());
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [startingChips, setStartingChips] = useState(1000);
  const [turnTimeSeconds, setTurnTimeSeconds] = useState(30);
  const [botCount, setBotCount] = useState(0);
  const [roomHasActiveOwner, setRoomHasActiveOwner] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastTickSecRef = useRef<number | null>(null);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(false);
  const [ncsMode, setNcsMode] = useState<MusicMode>('lounge');
  const [showMusicMenu, setShowMusicMenu] = useState(() => localStorage.getItem('pokernight_sidebar_open') === 'true');
  const [clockOffset, setClockOffset] = useState(0);
  const [raiseAmount, setRaiseAmount] = useState(40);
  const [showRaiseTray, setShowRaiseTray] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kickedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const lastSoundSnapRef = useRef<{
    handNumber: number;
    communityLen: number;
    winnersLen: number;
    actions: Record<string, string | undefined>;
  }>({ handNumber: 0, communityLen: 0, winnersLen: 0, actions: {} });

  useEffect(() => {
    if (!invitedRoom) return;
    fetch(`/api/room-info?room=${encodeURIComponent(invitedRoom)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { hasOwner?: boolean; hasActiveGame?: boolean } | null) => {
        if (info && (info.hasOwner || info.hasActiveGame)) {
          setRoomHasActiveOwner(true);
        }
      })
      .catch(() => {});
  }, [invitedRoom]);

  const connectAndJoin = (spectate = false, isRetry = false) => {
    const cleanName = playerName.trim();
    if (!cleanName) {
      setError('Ingresa tu nombre para entrar a la mesa.');
      return;
    }
    localStorage.setItem('pokernight_player_name', cleanName);
    if (!isRetry) {
      kickedRef.current = false;
      manualCloseRef.current = false;
      setError(null);
      loungeMusic.start();
      setMusicOn(true);
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const targetRoom = roomId.trim() || 'mesa-vip';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?room=${encodeURIComponent(targetRoom)}`);
    wsRef.current = ws;

    let pingInterval: ReturnType<typeof setInterval> | null = null;

    ws.onopen = () => {
      setReconnecting(false);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping');
        }
      }, 20000);
      const targetRoom = roomId.trim() || 'mesa-vip';
      window.history.replaceState(null, '', `/invitar/${encodeURIComponent(targetRoom)}`);
      let initialPlaylist: PlaylistTrack[] | undefined;
      try {
        const raw = localStorage.getItem('pokernight_playlist');
        if (raw) initialPlaylist = JSON.parse(raw) as PlaylistTrack[];
      } catch {
        // Ignore invalid JSON
      }
      const msg: ClientMessage = {
        type: 'join_room',
        roomId: targetRoom,
        playerName: cleanName,
        botCount: invitedRoom ? 0 : botCount,
        smallBlind,
        bigBlind,
        startingChips,
        turnTimeSeconds,
        spectate,
        initialPlaylist,
        clientId: getOrCreateClientId(),
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === 'state') {
        if (msg.serverNow) {
          setClockOffset(msg.serverNow - Date.now());
        }
        setGameState(msg.state);
        setYourId(msg.yourId);
        setRaiseAmount(msg.state.currentBet + msg.state.minRaise);
        setNcsMode(msg.state.music?.mode ?? 'lounge');
      } else if (msg.type === 'error') {
        if (msg.message.toLowerCase().includes('expulsado')) {
          kickedRef.current = true;
        }
        setError(msg.message);
      }
    };

    ws.onerror = () => {
      if (!isRetry) setError('No se pudo conectar al servidor WebSocket.');
    };

    ws.onclose = (ev) => {
      if (pingInterval) clearInterval(pingInterval);
      if (manualCloseRef.current || kickedRef.current || ev.code === 4001) {
        setReconnecting(false);
        setGameState(null);
        return;
      }
      if (ev.code !== 4000) {
        setReconnecting(true);
        reconnectTimerRef.current = setTimeout(() => {
          connectAndJoin(spectate, true);
        }, 1500);
      }
    };
  };

  useEffect(() => {
    return () => {
      manualCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  // Sync Lounge WebAudio synth with shared room pause & local mute
  useEffect(() => {
    if (!gameState) return;
    if (ncsMode === 'lounge' && musicOn && !gameState.music?.paused) {
      loungeMusic.start();
    } else {
      loungeMusic.stop();
    }
  }, [ncsMode, musicOn, gameState?.music?.paused, Boolean(gameState)]);

  // Table SFX based on GameState transitions
  useEffect(() => {
    if (!gameState) return;
    const prev = lastSoundSnapRef.current;
    if (gameState.handNumber > prev.handNumber || gameState.communityCards.length > prev.communityLen) {
      playDealSound();
    }
    if (gameState.winners.length > 0 && prev.winnersLen === 0) {
      playWinSound();
    }
    const nextActions: Record<string, string | undefined> = {};
    for (const p of gameState.players) {
      nextActions[p.id] = p.lastAction;
      if (p.lastAction && p.lastAction !== prev.actions[p.id]) {
        const lower = p.lastAction.toLowerCase();
        if (lower.includes('fold')) playFoldSound();
        else if (lower.includes('check')) playCheckSound();
        else if (lower.includes('call') || lower.includes('raise') || lower.includes('all-in')) playChipSound();
      }
    }
    lastSoundSnapRef.current = {
      handNumber: gameState.handNumber,
      communityLen: gameState.communityCards.length,
      winnersLen: gameState.winners.length,
      actions: nextActions,
    };
  }, [gameState]);

  useEffect(() => {
    if (!gameState?.turnDeadline) {
      setSecondsLeft(null);
      lastTickSecRef.current = null;
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.ceil((gameState.turnDeadline! - (Date.now() + clockOffset)) / 1000));
      setSecondsLeft(diff);
      if (diff > 0 && diff <= 10 && lastTickSecRef.current !== diff) {
        lastTickSecRef.current = diff;
        playClockTick(diff <= 3);
      }
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [gameState?.turnDeadline, clockOffset]);

  const send = (msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  const sendAction = (action: PlayerAction, amount?: number) => {
    send({ type: 'action', action, amount });
  };

  const me = gameState?.players.find((p) => p.id === yourId);
  const isOwner = gameState?.ownerId === yourId;
  const isSpectator = Boolean(gameState?.spectators?.some((s) => s.id === yourId));
  const activePlayer = gameState?.players[gameState.activePlayerIndex];
  const isMyTurn =
    activePlayer?.id === yourId &&
    gameState?.phase !== 'waiting' &&
    gameState?.phase !== 'showdown';
  const toCall = me ? Math.max(0, (gameState?.currentBet ?? 0) - me.bet) : 0;
  const minRaiseTarget = (gameState?.currentBet ?? 0) + (gameState?.minRaise ?? 0);
  const myHandName =
    gameState && me && me.holeCards.length > 0
      ? evaluateCurrentHand(me.holeCards, gameState.communityCards)
      : '';

  useEffect(() => {
    if (!isMyTurn) {
      setArmedKey(null);
      setShowRaiseTray(false);
      return;
    }
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (!['f', 'c', 'r', 'a'].includes(key)) return;

      if (armedKey === key) {
        setArmedKey(null);
        if (key === 'f') sendAction('fold');
        else if (key === 'c') sendAction(toCall === 0 ? 'check' : 'call');
        else if (key === 'r') sendAction('raise', Math.max(minRaiseTarget, raiseAmount));
        else if (key === 'a') sendAction('allin');
      } else {
        setArmedKey(key);
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => setArmedKey(null), 1500);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [isMyTurn, armedKey, toCall, minRaiseTarget, raiseAmount]);

  if (!gameState) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-950 via-zinc-950 to-zinc-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md rounded-2xl bg-zinc-900/90 border border-zinc-800 p-8 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Spade className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Poker Night</h1>
              <p className="text-xs text-zinc-400">Texas Hold&apos;em Online • Sin Phaser</p>
            </div>
          </div>

          <div className="space-y-4">
            {invitedRoom && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2.5 text-xs text-emerald-300">
                Has sido invitado a una partida privada
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Tu nombre</label>
              <input
                required
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    connectAndJoin(Boolean(invitedRoom && roomHasActiveOwner));
                  }
                }}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                placeholder="Tu nombre (obligatorio)"
              />
            </div>

            {!invitedRoom && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {[
                  {
                    label: 'Ciega Peq.',
                    value: smallBlind,
                    step: 5,
                    min: 5,
                    max: 500,
                    prefix: '$',
                    setter: setSmallBlind,
                  },
                  {
                    label: 'Ciega Gr.',
                    value: bigBlind,
                    step: 10,
                    min: 10,
                    max: 1000,
                    prefix: '$',
                    setter: setBigBlind,
                  },
                  {
                    label: 'Fichas',
                    value: startingChips,
                    step: 500,
                    min: 500,
                    max: 50000,
                    prefix: '$',
                    setter: setStartingChips,
                  },
                  {
                    label: 'Turno (s)',
                    value: turnTimeSeconds,
                    step: 5,
                    min: 10,
                    max: 120,
                    prefix: '',
                    setter: setTurnTimeSeconds,
                  },
                  {
                    label: 'Bots IA',
                    value: botCount,
                    step: 1,
                    min: 0,
                    max: 5,
                    prefix: '',
                    setter: setBotCount,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-zinc-950 border border-zinc-800 p-2">
                    <div className="text-[10px] font-medium text-zinc-400 mb-1 text-center">{item.label}</div>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => item.setter(Math.max(item.min, item.value - item.step))}
                        className="w-6 h-6 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                      <span className="text-xs font-semibold text-white">
                        {item.prefix}
                        {item.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => item.setter(Math.min(item.max, item.value + item.step))}
                        className="w-6 h-6 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <div className="pt-2 flex gap-2.5">
              {invitedRoom ? (
                <>
                  <button
                    onClick={() => connectAndJoin(false)}
                    className="flex-1 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold py-2.5 px-4 text-sm transition cursor-pointer"
                  >
                    Entrar a jugar
                  </button>
                  {roomHasActiveOwner && (
                    <button
                      onClick={() => connectAndJoin(true)}
                      className="rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-semibold py-2.5 px-4 text-sm transition cursor-pointer"
                    >
                      Espectear
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => connectAndJoin(false)}
                  className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold py-2.5 px-4 text-sm transition cursor-pointer"
                >
                  Crear sala
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between p-4 md:p-6">
      {/* Top Bar */}
      <header className="flex items-center justify-between max-w-6xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <Spade className="w-5 h-5 text-emerald-400" />
            Poker Night
          </span>
          {isSpectator && (
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-300">
                Espectador: <strong className="text-white">{playerName}</strong>
              </span>
              <button
                onClick={() => send({ type: 'join_seat' })}
                className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 transition cursor-pointer"
              >
                Entrar al siguiente juego
              </button>
            </div>
          )}
          <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 uppercase">
            {gameState.phase}
          </span>
          {reconnecting && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse">
              Reconectando...
            </span>
          )}
          {secondsLeft !== null && gameState.phase !== 'waiting' && gameState.phase !== 'showdown' && (
            <span
              className={`flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-full border ${
                secondsLeft <= 10
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 animate-pulse'
                  : 'bg-zinc-900 text-zinc-200 border-zinc-700'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {secondsLeft}s
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setShowMusicMenu((v) => {
                const next = !v;
                localStorage.setItem('pokernight_sidebar_open', String(next));
                return next;
              })
            }
            title="Panel de Sala y Música"
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition cursor-pointer"
          >
            <Music className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Música</span>
          </button>
          <button
            onClick={() => {
              const url = `${window.location.origin}/invitar/${encodeURIComponent(gameState.roomId)}`;
              navigator.clipboard.writeText(url);
              setCopiedInvite(true);
              setTimeout(() => setCopiedInvite(false), 2000);
            }}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition cursor-pointer"
          >
            {copiedInvite ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedInvite ? 'Link copiado' : 'Invitar'}
          </button>
          {isOwner && gameState.players.length < 6 && (
            <button
              onClick={() => send({ type: 'add_bot' })}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Añadir Bot
            </button>
          )}
          {isOwner && (gameState.phase === 'waiting' || gameState.phase === 'showdown') && (
            <button
              onClick={() => send({ type: 'start_hand' })}
              disabled={gameState.players.length < 2}
              className="flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-zinc-950 transition cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              {gameState.phase === 'waiting' ? 'Repartir Mano' : 'Siguiente Mano'}
            </button>
          )}
        </div>
      </header>

      {/* Main Table + Right Sidebar */}
      <div className="max-w-7xl w-full mx-auto my-4 flex-1 flex gap-6 items-stretch">
      <main className="flex-1 flex flex-col items-center justify-center gap-10 min-w-0 py-6 px-2 sm:px-6">
        {/* Oval Felt Table with Perimeter Seats */}
        {(() => {
          const players = gameState.players;
          const myIdx = players.findIndex((p) => p.id === yourId);
          const anchorIdx = myIdx >= 0 ? myIdx : 0;
          const seatLayouts: Record<number, string[]> = {
            1: ['bottom-[-30px] left-1/2 -translate-x-1/2'],
            2: ['bottom-[-30px] left-1/2 -translate-x-1/2', 'top-[-30px] left-1/2 -translate-x-1/2'],
            3: [
              'bottom-[-30px] left-1/2 -translate-x-1/2',
              'top-[12%] left-[-12px] sm:left-[2%]',
              'top-[12%] right-[-12px] sm:right-[2%]',
            ],
            4: [
              'bottom-[-30px] left-1/2 -translate-x-1/2',
              'top-1/2 -translate-y-1/2 left-[-12px] sm:left-[1%]',
              'top-[-30px] left-1/2 -translate-x-1/2',
              'top-1/2 -translate-y-1/2 right-[-12px] sm:right-[1%]',
            ],
            5: [
              'bottom-[-30px] left-1/2 -translate-x-1/2',
              'bottom-[14%] left-[-12px] sm:left-[1%]',
              'top-[10%] left-[4%]',
              'top-[10%] right-[4%]',
              'bottom-[14%] right-[-12px] sm:right-[1%]',
            ],
            6: [
              'bottom-[-30px] left-1/2 -translate-x-1/2',
              'bottom-[14%] left-[-12px] sm:left-[1%]',
              'top-[12%] left-[-12px] sm:left-[2%]',
              'top-[-30px] left-1/2 -translate-x-1/2',
              'top-[12%] right-[-12px] sm:right-[2%]',
              'bottom-[14%] right-[-12px] sm:right-[1%]',
            ],
          };
          const positions = seatLayouts[Math.min(6, Math.max(1, players.length))] ?? seatLayouts[6];
          const winningSet = new Set(
            gameState.phase === 'showdown'
              ? gameState.winners.flatMap((w) => (w.winningCards ?? []).map((c) => `${c.rank}-${c.suit}`))
              : []
          );

          return (
            <div className="relative w-full max-w-4xl aspect-[16/10] min-h-[380px] sm:min-h-[430px] rounded-[999px] bg-gradient-to-b from-emerald-900 via-emerald-900 to-emerald-950 border-[12px] border-zinc-900 shadow-[0_0_120px_rgba(16,185,129,0.22),0_0_40px_rgba(52,211,153,0.14),inset_0_0_70px_rgba(6,78,59,0.75)] flex flex-col items-center justify-center px-6 py-10">
              {/* Subtle Dealer Slot */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-16 h-2 rounded-full bg-zinc-950/70 border border-emerald-500/20" />

              {/* Pot */}
              <div className="mb-4 flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-950/70 border border-emerald-400/25 text-amber-300 font-semibold text-sm shadow">
                <Coins className="w-4 h-4" />
                <span>POT • ${gameState.pot}</span>
              </div>

              {/* 5 Community Card Slots */}
              <div className="flex items-center justify-center gap-2 sm:gap-3">
                {[0, 1, 2, 3, 4].map((slotIdx) => {
                  const card = gameState.communityCards[slotIdx];
                  if (!card) {
                    return (
                      <div
                        key={`slot-${slotIdx}`}
                        className="w-16 h-24 rounded-xl border border-emerald-400/15 bg-emerald-950/35"
                      />
                    );
                  }
                  return (
                    <PlayingCard
                      key={`${gameState.handNumber}-${card.rank}-${card.suit}-${slotIdx}`}
                      card={card}
                      index={slotIdx}
                      isCommunity
                      highlighted={winningSet.has(`${card.rank}-${card.suit}`)}
                    />
                  );
                })}
              </div>

              {/* Winners Banner */}
              {gameState.winners.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-4 px-4 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-200 text-xs sm:text-sm flex items-center gap-2"
                >
                  <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    {gameState.winners.map((w) => `${w.playerName} gana $${w.amount} (${w.handName})`).join(' • ')}
                  </span>
                </motion.div>
              )}

              {/* Perimeter Player Seats */}
              {players.map((p, idx) => {
                const relIdx = (idx - anchorIdx + players.length) % players.length;
                const posClass = positions[relIdx] ?? positions[0];
                const isTurn =
                  idx === gameState.activePlayerIndex &&
                  gameState.phase !== 'waiting' &&
                  gameState.phase !== 'showdown';
                const isMe = p.id === yourId;
                const showCards = isMe || (gameState.phase === 'showdown' && (!p.folded || p.showCards));

                const totalTurn = Math.max(1, gameState.turnTimeSeconds);
                const ratio = isTurn && secondsLeft !== null ? Math.max(0, Math.min(1, secondsLeft / totalTurn)) : 0;
                const radius = 17;
                const circumference = 2 * Math.PI * radius;
                const strokeDashoffset = circumference * (1 - ratio);
                const ringColor =
                  secondsLeft !== null && secondsLeft <= 10
                    ? '#fb7185'
                    : secondsLeft !== null && secondsLeft <= 15
                    ? '#fbbf24'
                    : '#34d399';

                return (
                  <div
                    key={p.id}
                    className={`absolute z-20 flex flex-col items-center transition-all ${posClass} ${
                      p.folded ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Fanned Hole Cards above seat pill */}
                    {p.holeCards.length > 0 && (
                      <div className="flex items-end justify-center -mb-2.5 z-10">
                        {p.holeCards.map((c, ci) => (
                          <div key={`${gameState.handNumber}-${p.id}-${ci}`} className={ci === 1 ? '-ml-2' : ''}>
                            <PlayingCard
                              card={c}
                              hidden={!showCards}
                              small
                              index={ci}
                              dealFromTop
                              fanAngle={ci === 0 ? -7 : 7}
                              highlighted={showCards && winningSet.has(`${c.rank}-${c.suit}`)}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Seat Pill with SVG Timer Ring */}
                    <div
                      className={`relative z-20 flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-full bg-zinc-900/95 border shadow-xl backdrop-blur ${
                        isTurn
                          ? 'border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.3)]'
                          : 'border-zinc-700/80'
                      }`}
                    >
                      {/* Radial Timer / Avatar Circle */}
                      <div className="relative w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-zinc-950 border border-zinc-800">
                        {isTurn && secondsLeft !== null ? (
                          <>
                            <svg className="w-10 h-10 -rotate-90" viewBox="0 0 42 42">
                              <circle
                                cx="21"
                                cy="21"
                                r={radius}
                                fill="none"
                                stroke="#27272a"
                                strokeWidth="3"
                              />
                              <circle
                                cx="21"
                                cy="21"
                                r={radius}
                                fill="none"
                                stroke={ringColor}
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                                style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.25s ease' }}
                              />
                            </svg>
                            <span
                              className={`absolute text-[11px] font-mono font-bold ${
                                secondsLeft <= 10 ? 'text-rose-300 animate-pulse' : 'text-white'
                              }`}
                            >
                              {secondsLeft}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs font-bold text-zinc-300">
                            {p.id === gameState.ownerId ? '👑' : p.seat + 1}
                          </span>
                        )}
                      </div>

                      {/* Name + Stack */}
                      <div className="min-w-[78px] max-w-[120px]">
                        <div className="text-xs font-semibold text-white truncate">
                          {p.name}
                          {isMe ? ' (Tú)' : ''}
                        </div>
                        <div className="text-[11px] font-medium text-emerald-400 flex items-center gap-1.5">
                          <span>${p.chips}</span>
                          {p.disconnected && <span className="text-[9px] text-amber-400">offline</span>}
                        </div>
                      </div>

                      {/* Dealer / Kick */}
                      <div className="flex items-center gap-1">
                        {idx === gameState.dealerIndex && (
                          <span className="w-5 h-5 rounded-full bg-amber-400 text-zinc-950 text-[10px] font-bold flex items-center justify-center">
                            D
                          </span>
                        )}
                        {isOwner && !isMe && (
                          <button
                            onClick={() => send({ type: 'kick_player', targetId: p.id })}
                            title="Expulsar de la mesa"
                            className="w-5 h-5 rounded-full bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 text-[10px] flex items-center justify-center cursor-pointer"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Hand Name (self) or Last Action Badge */}
                    <div className="mt-1.5 flex items-center gap-1.5 min-h-[20px]">
                      {isMe && myHandName && (
                        <span className="px-2.5 py-0.5 rounded-full bg-zinc-950/90 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold uppercase tracking-wider">
                          {myHandName}
                        </span>
                      )}
                      {p.lastAction && (!isMe || !myHandName || p.folded) && (
                        <motion.div
                          key={`${p.id}-${p.lastAction}`}
                          initial={{ opacity: 0, scale: 0.85, y: 3 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide ${getActionBadgeStyle(
                            p.lastAction
                          )}`}
                        >
                          {p.lastAction}
                        </motion.div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </main>
      <MusicSidebar
        open={showMusicMenu}
        onClose={() => setShowMusicMenu(false)}
        gameState={gameState}
        musicOn={musicOn}
        ncsMode={ncsMode}
        isOwner={isOwner}
        clockOffset={clockOffset}
        onToggleMusic={() => setMusicOn((v) => !v)}
        onToggleRoomPause={() => send({ type: 'toggle_music_pause' })}
        onSelectMode={(mode) => {
          send({ type: 'set_music', mode });
          setNcsMode(mode);
          if (mode === 'lounge') loungeMusic.start();
          else loungeMusic.stop();
          setMusicOn(true);
        }}
        onUpdatePlaylist={(playlist, currentIndex) => {
          loungeMusic.stop();
          setMusicOn(true);
          localStorage.setItem('pokernight_playlist', JSON.stringify(playlist));
          send({ type: 'update_playlist', playlist, currentIndex });
        }}
        onSeek={(seconds) => send({ type: 'seek_music', seconds })}
        onKick={(targetId) => send({ type: 'kick_player', targetId })}
      />
      </div>

      {/* Centralized Action Controls */}
      <footer className="max-w-xl w-full mx-auto pt-4">
        <div className="rounded-2xl bg-zinc-900/95 border border-zinc-800 p-3 shadow-2xl space-y-2.5">
          {isMyTurn ? (
            <>
              {secondsLeft !== null && (
                <div className="w-64 mx-auto h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      secondsLeft <= 10 ? 'bg-rose-500' : secondsLeft <= 15 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(100, (secondsLeft / Math.max(1, gameState.turnTimeSeconds)) * 100)}%` }}
                  />
                </div>
              )}

              {!showRaiseTray ? (
                <div className="max-w-md mx-auto grid grid-cols-3 gap-3">
                  <button
                    onClick={() => sendAction('fold')}
                    className="py-2.5 px-4 rounded-xl bg-zinc-950 hover:bg-rose-950/60 text-rose-300 border border-rose-500/30 text-sm font-semibold transition cursor-pointer"
                  >
                    Fold
                  </button>
                  {toCall === 0 ? (
                    <button
                      onClick={() => sendAction('check')}
                      className="py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 text-sm font-semibold transition cursor-pointer"
                    >
                      Check
                    </button>
                  ) : (
                    <button
                      onClick={() => sendAction('call')}
                      className="py-2.5 px-4 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/40 text-sm font-semibold transition cursor-pointer"
                    >
                      Call ${Math.min(toCall, me?.chips ?? 0)}
                    </button>
                  )}
                  <button
                    onClick={() => setShowRaiseTray(true)}
                    className="py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm font-bold transition cursor-pointer"
                  >
                    Raise
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {[
                      { label: '1/2 Pot', mult: 0.5 },
                      { label: '3/4 Pot', mult: 0.75 },
                      { label: 'Pot', mult: 1 },
                    ].map((preset) => {
                      const maxBet = (me?.chips ?? 0) + (me?.bet ?? 0);
                      const target = Math.min(
                        maxBet,
                        Math.max(
                          minRaiseTarget,
                          gameState.currentBet + Math.round((gameState.pot * preset.mult) / 10) * 10
                        )
                      );
                      return (
                        <button
                          key={preset.label}
                          onClick={() => setRaiseAmount(target)}
                          className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => {
                        setShowRaiseTray(false);
                        sendAction('allin');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold transition cursor-pointer"
                    >
                      All-In
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <input
                      type="range"
                      min={minRaiseTarget}
                      max={(me?.chips ?? 0) + (me?.bet ?? 0)}
                      step={10}
                      value={Math.max(minRaiseTarget, raiseAmount)}
                      onChange={(e) => setRaiseAmount(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono font-bold text-white">
                      ${Math.max(minRaiseTarget, raiseAmount)}
                    </span>
                    <button
                      onClick={() => {
                        setShowRaiseTray(false);
                        sendAction('raise', Math.max(minRaiseTarget, raiseAmount));
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs sm:text-sm font-bold transition cursor-pointer"
                    >
                      Subir a ${Math.max(minRaiseTarget, raiseAmount)}
                    </button>
                    <button
                      onClick={() => setShowRaiseTray(false)}
                      title="Volver"
                      className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {armedKey && (
                <div className="w-full text-center text-[11px] text-amber-300 font-medium">
                  Pulsa <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 uppercase">{armedKey}</kbd> otra vez para confirmar
                </div>
              )}
            </>
          ) : (
            <div className="w-full flex items-center justify-center gap-3 text-xs text-zinc-400 py-1.5">
              <span>
                {gameState.phase === 'waiting'
                  ? 'Esperando a que comience la mano...'
                  : gameState.phase === 'showdown'
                  ? 'Mano terminada. Pulsa "Siguiente Mano" para continuar.'
                  : `Turno de ${activePlayer?.name ?? '...'}`}
              </span>
              {isSpectator && (
                <button
                  onClick={() => send({ type: 'join_seat' })}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold transition cursor-pointer"
                >
                  Unirse a la partida (Join)
                </button>
              )}
              {gameState.phase === 'showdown' && me && me.holeCards.length > 0 && !me.showCards && (
                <button
                  onClick={() => send({ type: 'show_cards' })}
                  className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition cursor-pointer"
                >
                  Mostrar cartas (5s)
                </button>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
