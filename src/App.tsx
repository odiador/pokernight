import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Check, Coins, Copy, Crown, Music, Play, Plus, Spade, Users } from 'lucide-react';
import type { ClientMessage, GameState, MusicMode, PlayerAction, ServerMessage } from '../shared/poker.ts';
import { evaluateCurrentHand } from '../shared/evaluator.ts';
import { PlayingCard } from './components/PlayingCard.tsx';
import { MusicSidebar } from './components/MusicSidebar.tsx';
import { loungeMusic } from './utils/music.ts';

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
  const [turnTimeSeconds, setTurnTimeSeconds] = useState(20);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(false);
  const [ncsMode, setNcsMode] = useState<MusicMode>('lounge');
  const [showMusicMenu, setShowMusicMenu] = useState(() => localStorage.getItem('pokernight_sidebar_open') === 'true');
  const [raiseAmount, setRaiseAmount] = useState(40);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectAndJoin = (withBots: boolean, spectate = false) => {
    const cleanName = playerName.trim();
    if (!cleanName) {
      setError('Ingresa tu nombre para entrar a la mesa.');
      return;
    }
    localStorage.setItem('pokernight_player_name', cleanName);
    setError(null);
    loungeMusic.start();
    setMusicOn(true);
    const targetRoom = roomId.trim() || 'mesa-vip';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?room=${encodeURIComponent(targetRoom)}`);
    wsRef.current = ws;

    let pingInterval: ReturnType<typeof setInterval> | null = null;

    ws.onopen = () => {
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
      const targetRoom = roomId.trim() || 'mesa-vip';
      window.history.replaceState(null, '', `/invitar/${encodeURIComponent(targetRoom)}`);
      const msg: ClientMessage = {
        type: 'join_room',
        roomId: targetRoom,
        playerName: playerName.trim() || 'Jugador',
        withBots,
        smallBlind,
        bigBlind,
        startingChips,
        turnTimeSeconds,
        spectate,
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === 'state') {
        setGameState(msg.state);
        setYourId(msg.yourId);
        setRaiseAmount(msg.state.currentBet + msg.state.minRaise);
        setNcsMode(msg.state.music?.mode ?? 'lounge');
      } else if (msg.type === 'error') {
        setError(msg.message);
      }
    };

    ws.onerror = () => {
      setError('No se pudo conectar al servidor WebSocket.');
    };

    ws.onclose = () => {
      if (pingInterval) clearInterval(pingInterval);
      setGameState(null);
    };
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!gameState?.turnDeadline) {
      setSecondsLeft(null);
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.ceil((gameState.turnDeadline! - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [gameState?.turnDeadline]);

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
                Invitación directa a la mesa <strong className="text-white">{invitedRoom}</strong>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Tu nombre</label>
              <input
                required
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                placeholder="Tu nombre (obligatorio)"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5">
              <span className="text-xs font-medium text-zinc-400">Código de mesa</span>
              <span className="text-sm font-mono font-bold tracking-widest text-emerald-400">{roomId}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                {
                  label: 'Ciega Peq.',
                  value: smallBlind,
                  step: 5,
                  min: 5,
                  prefix: '$',
                  setter: setSmallBlind,
                },
                {
                  label: 'Ciega Gr.',
                  value: bigBlind,
                  step: 10,
                  min: 10,
                  prefix: '$',
                  setter: setBigBlind,
                },
                {
                  label: 'Fichas',
                  value: startingChips,
                  step: 500,
                  min: 500,
                  prefix: '$',
                  setter: setStartingChips,
                },
                {
                  label: 'Turno (s)',
                  value: turnTimeSeconds,
                  step: 5,
                  min: 10,
                  prefix: '',
                  setter: setTurnTimeSeconds,
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
                      onClick={() => item.setter(item.value + item.step)}
                      className="w-6 h-6 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-bold flex items-center justify-center cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <div className="grid grid-cols-3 gap-2.5 pt-2">
              <button
                onClick={() => connectAndJoin(true, false)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold py-2.5 px-3 text-xs sm:text-sm transition cursor-pointer"
              >
                <Bot className="w-4 h-4" />
                vs IA
              </button>
              <button
                onClick={() => connectAndJoin(false, false)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-2.5 px-3 text-xs sm:text-sm transition cursor-pointer"
              >
                <Users className="w-4 h-4" />
                Mesa Online
              </button>
              <button
                onClick={() => connectAndJoin(false, true)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold py-2.5 px-3 text-xs sm:text-sm transition cursor-pointer"
              >
                Espectear
              </button>
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
          <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
            Mesa: <strong className="text-zinc-200">{gameState.roomId}</strong>
          </span>
          <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 uppercase">
            {gameState.phase}
          </span>
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
      <div className="max-w-7xl w-full mx-auto my-6 flex-1 flex gap-6 items-stretch">
      <main className="flex-1 flex flex-col items-center justify-center gap-6 min-w-0">
        {/* Felt Table with ambient bloom */}
        <div className="relative w-full rounded-[48px] bg-gradient-to-b from-emerald-900 to-emerald-950 border-[10px] border-zinc-900 shadow-[0_0_120px_rgba(16,185,129,0.28),0_0_40px_rgba(52,211,153,0.18),inset_0_0_60px_rgba(16,185,129,0.15)] p-6 md:p-10 flex flex-col items-center justify-center min-h-[300px]">
          {/* Pot */}
          <div className="mb-5 flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-950/60 border border-emerald-400/20 text-amber-300 font-semibold text-sm">
            <Coins className="w-4 h-4" />
            Bote: ${gameState.pot}
          </div>

          {/* Community Cards */}
          <div className="flex items-center justify-center gap-2.5 min-h-[96px]">
            <AnimatePresence>
              {gameState.communityCards.map((card, i) => (
                <PlayingCard
                  key={`${gameState.handNumber}-${card.rank}-${card.suit}-${i}`}
                  card={card}
                  index={i}
                  isCommunity
                />
              ))}
            </AnimatePresence>
            {gameState.communityCards.length === 0 && (
              <span className="text-xs text-emerald-200/40 tracking-widest uppercase">
                Cartas comunitarias
              </span>
            )}
          </div>

          {myHandName && (
            <motion.div
              key={myHandName}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 px-3.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-xs font-medium"
            >
              Tu mano: <strong className="text-white">{myHandName}</strong>
            </motion.div>
          )}

          {/* Winners Banner */}
          {gameState.winners.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-5 px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-200 text-sm flex items-center gap-2"
            >
              <Crown className="w-4 h-4 text-amber-400" />
              {gameState.winners.map((w) => `${w.playerName} gana $${w.amount} (${w.handName})`).join(' • ')}
            </motion.div>
          )}
        </div>

        {/* Players Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 w-full">
          {gameState.players.map((p, idx) => {
            const isTurn =
              idx === gameState.activePlayerIndex &&
              gameState.phase !== 'waiting' &&
              gameState.phase !== 'showdown';
            const isMe = p.id === yourId;
            const showCards = isMe || (gameState.phase === 'showdown' && (!p.folded || p.showCards));

            return (
              <div
                key={p.id}
                className={`rounded-2xl p-3 border transition ${
                  isTurn
                    ? 'bg-zinc-900 border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.2)]'
                    : p.folded
                    ? 'bg-zinc-900/40 border-zinc-800/60 opacity-50'
                    : 'bg-zinc-900/80 border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between mb-1 gap-1">
                  <span className="text-xs font-semibold truncate text-white">
                    {p.id === gameState.ownerId ? '👑 ' : ''}
                    {p.name} {isMe && '(Tú)'}
                  </span>
                  <div className="flex items-center gap-1">
                    {idx === gameState.dealerIndex && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400 text-zinc-950">
                        D
                      </span>
                    )}
                    {isOwner && !isMe && (
                      <button
                        onClick={() => send({ type: 'kick_player', targetId: p.id })}
                        title="Expulsar de la mesa"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-emerald-400 font-medium mb-2">${p.chips}</div>

                <div className="flex items-center gap-1.5 min-h-[64px]">
                  <AnimatePresence>
                    {p.holeCards.map((c, ci) => (
                      <PlayingCard
                        key={`${gameState.handNumber}-${p.id}-${ci}`}
                        card={c}
                        hidden={!showCards}
                        small
                        index={ci}
                      />
                    ))}
                  </AnimatePresence>
                </div>

                {p.lastAction && (
                  <motion.div
                    key={`${p.id}-${p.lastAction}`}
                    initial={{ opacity: 0, scale: 0.8, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 20 }}
                    className={`mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-semibold tracking-wide ${getActionBadgeStyle(
                      p.lastAction
                    )}`}
                  >
                    {p.lastAction}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </main>
      <MusicSidebar
        open={showMusicMenu}
        onClose={() => setShowMusicMenu(false)}
        gameState={gameState}
        musicOn={musicOn}
        ncsMode={ncsMode}
        isOwner={isOwner}
        onToggleMusic={() => {
          if (ncsMode === 'lounge') {
            setMusicOn(loungeMusic.toggle());
          } else {
            setMusicOn((v) => !v);
          }
        }}
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
          send({ type: 'update_playlist', playlist, currentIndex });
        }}
        onSeek={(seconds) => send({ type: 'seek_music', seconds })}
        onKick={(targetId) => send({ type: 'kick_player', targetId })}
      />
      </div>

      {/* Action Controls */}
      <footer className="max-w-3xl w-full mx-auto">
        <div className="rounded-2xl bg-zinc-900/90 border border-zinc-800 p-3 flex flex-wrap items-center justify-between gap-3">
          {isMyTurn ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => sendAction('fold')}
                  className="px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-sm font-semibold transition cursor-pointer"
                >
                  Fold
                </button>
                {toCall === 0 ? (
                  <button
                    onClick={() => sendAction('check')}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold transition cursor-pointer"
                  >
                    Check
                  </button>
                ) : (
                  <button
                    onClick={() => sendAction('call')}
                    className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 text-sm font-semibold transition cursor-pointer"
                  >
                    Call ${Math.min(toCall, me?.chips ?? 0)}
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {secondsLeft !== null && (
                  <span
                    className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg border ${
                      secondsLeft <= 5
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                        : 'bg-zinc-800 text-zinc-200 border-zinc-700'
                    }`}
                  >
                    {secondsLeft}s
                  </span>
                )}
                {[
                  { label: '1/2 Pot', mult: 0.5 },
                  { label: '3/4 Pot', mult: 0.75 },
                  { label: 'Pot', mult: 1 },
                ].map((preset) => {
                  const maxBet = (me?.chips ?? 0) + (me?.bet ?? 0);
                  const target = Math.min(
                    maxBet,
                    Math.max(minRaiseTarget, gameState.currentBet + Math.round((gameState.pot * preset.mult) / 10) * 10)
                  );
                  return (
                    <button
                      key={preset.label}
                      onClick={() => setRaiseAmount(target)}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <input
                  type="range"
                  min={minRaiseTarget}
                  max={(me?.chips ?? 0) + (me?.bet ?? 0)}
                  step={10}
                  value={Math.max(minRaiseTarget, raiseAmount)}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  className="w-24 accent-emerald-500"
                />
                <button
                  onClick={() => sendAction('raise', Math.max(minRaiseTarget, raiseAmount))}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm font-semibold transition cursor-pointer"
                >
                  Raise ${Math.max(minRaiseTarget, raiseAmount)}
                </button>
                <button
                  onClick={() => sendAction('allin')}
                  className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-sm font-semibold transition cursor-pointer"
                >
                  All-In
                </button>
              </div>
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
