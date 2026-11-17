import type {
  Card,
  GameState,
  MusicMode,
  Phase,
  PlayerAction,
  PlayerState,
  PlaylistTrack,
  Rank,
  Suit,
} from './poker.ts';
import { evaluateBestHand, evaluateBotHandStrength } from './evaluator.ts';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BOT_NAMES = ['Luna', 'Mateo', 'Vega', 'Dante', 'Kira'];

function createShuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export interface PokerEngineCallbacks {
  onBroadcast: () => void;
  onSendError: (playerId: string, message: string) => void;
  onKickSocket: (playerId: string) => void;
  onPersistPlaylist?: (playlist: PlaylistTrack[]) => void;
}

export class PokerEngine {
  public state: GameState;
  private deck: Card[] = [];
  private actedThisRound = new Set<string>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private autoNextTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerInactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private startingChips = 1000;
  private callbacks: PokerEngineCallbacks;

  constructor(roomId: string, callbacks: PokerEngineCallbacks) {
    this.callbacks = callbacks;
    this.state = {
      roomId,
      ownerId: undefined,
      phase: 'waiting',
      pot: 0,
      communityCards: [],
      currentBet: 0,
      minRaise: 20,
      dealerIndex: 0,
      activePlayerIndex: 0,
      players: [],
      spectators: [],
      winners: [],
      handNumber: 0,
      smallBlind: 10,
      bigBlind: 20,
      turnTimeSeconds: 30,
      music: {
        mode: 'lounge',
        startedAt: Date.now(),
        currentIndex: 0,
        paused: false,
        pausedAtSec: 0,
        playlist: [
          { id: '1', title: 'NCS - Cartoon, Jéja - On & On', youtubeId: 'K4DyBUG242c' },
          { id: '2', title: 'NCS - Elektronomia - Sky High', youtubeId: 'TW9d8vYrVFQ' },
          { id: '3', title: 'NCS - Alan Walker - Fade', youtubeId: 'bM7SZ5SBzyY' },
          { id: '4', title: 'NCS - Different Heaven - Nekozilla', youtubeId: '6FNHe3kf8_s' },
        ],
      },
    };
  }

  configure(options: {
    roomId?: string;
    smallBlind?: number;
    bigBlind?: number;
    startingChips?: number;
    turnTimeSeconds?: number;
    initialPlaylist?: PlaylistTrack[];
  }): void {
    if (options.roomId) this.state.roomId = options.roomId;
    if (this.state.handNumber > 0 || this.state.players.length > 0) return;
    if (options.smallBlind && options.smallBlind > 0) this.state.smallBlind = options.smallBlind;
    if (options.bigBlind && options.bigBlind > 0) {
      this.state.bigBlind = options.bigBlind;
      this.state.minRaise = options.bigBlind;
    }
    if (options.startingChips && options.startingChips >= 100) this.startingChips = options.startingChips;
    if (options.turnTimeSeconds && options.turnTimeSeconds >= 5) this.state.turnTimeSeconds = options.turnTimeSeconds;
    if (options.initialPlaylist && options.initialPlaylist.length > 0) {
      this.state.music.playlist = options.initialPlaylist;
      this.callbacks.onPersistPlaylist?.(options.initialPlaylist);
    }
  }

  setSavedPlaylist(playlist: PlaylistTrack[]): void {
    if (playlist.length > 0) {
      this.state.music.playlist = playlist;
    }
  }

  addPlayer(id: string, name: string, botCount = 0, spectate = false): void {
    const existing = this.state.players.find((p) => p.id === id);
    if (existing) {
      const timer = this.disconnectTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(id);
      }
      existing.disconnected = false;
      this.callbacks.onBroadcast();
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) {
      this.callbacks.onSendError(id, 'El nombre es obligatorio.');
      return;
    }

    const nameTaken =
      this.state.players.some((p) => p.name.toLowerCase() === cleanName.toLowerCase() && p.id !== id) ||
      this.state.spectators.some((s) => s.name.toLowerCase() === cleanName.toLowerCase() && s.id !== id);
    if (nameTaken) {
      this.callbacks.onSendError(id, 'Ese nombre ya está en uso en esta mesa.');
      return;
    }

    if (!this.state.ownerId) {
      this.state.ownerId = id;
      this.resetOwnerInactivity();
    }

    if (spectate) {
      if (!this.state.spectators.some((s) => s.id === id)) {
        this.state.spectators.push({ id, name: cleanName });
      }
      this.callbacks.onBroadcast();
      return;
    }

    if (this.state.players.length >= 6) {
      this.callbacks.onSendError(id, 'La mesa está llena (máximo 6 jugadores).');
      return;
    }

    this.state.players.push({
      id,
      name: cleanName,
      chips: this.startingChips,
      bet: 0,
      totalBetThisHand: 0,
      folded: this.state.phase !== 'waiting',
      allIn: false,
      isBot: false,
      seat: this.state.players.length,
      holeCards: [],
      disconnected: false,
    });

    if (botCount > 0 && this.state.players.length === 1) {
      const count = Math.min(5, botCount);
      for (let i = 0; i < count; i++) {
        this.addBot();
      }
    }

    this.callbacks.onBroadcast();
    this.scheduleAutoStartIfReady(1200);
  }

  addBot(): void {
    if (this.state.players.length >= 6) return;
    const used = new Set(this.state.players.map((p) => p.name));
    const botName = BOT_NAMES.find((n) => !used.has(`${n} (IA)`)) ?? `Bot ${this.state.players.length}`;
    this.state.players.push({
      id: `bot-${Math.random().toString(36).slice(2, 8)}`,
      name: `${botName} (IA)`,
      chips: this.startingChips,
      bet: 0,
      totalBetThisHand: 0,
      folded: this.state.phase !== 'waiting',
      allIn: false,
      isBot: true,
      seat: this.state.players.length,
      holeCards: [],
    });
    this.callbacks.onBroadcast();
    this.scheduleAutoStartIfReady(1200);
  }

  handleDisconnect(id: string): void {
    const specIdx = this.state.spectators.findIndex((s) => s.id === id);
    if (specIdx !== -1) {
      this.state.spectators.splice(specIdx, 1);
      if (this.state.ownerId === id) this.transferOwnership();
      this.callbacks.onBroadcast();
      return;
    }

    const player = this.state.players.find((p) => p.id === id);
    if (!player) return;

    player.disconnected = true;
    const existingTimer = this.disconnectTimers.get(id);
    if (existingTimer) clearTimeout(existingTimer);

    const graceTimer = setTimeout(() => {
      this.disconnectTimers.delete(id);
      this.removePlayerPermanently(id);
    }, 60_000);
    this.disconnectTimers.set(id, graceTimer);

    this.callbacks.onBroadcast();
  }

  removePlayerPermanently(id: string): void {
    const graceTimer = this.disconnectTimers.get(id);
    if (graceTimer) {
      clearTimeout(graceTimer);
      this.disconnectTimers.delete(id);
    }

    this.state.spectators = this.state.spectators.filter((s) => s.id !== id);
    const idx = this.state.players.findIndex((p) => p.id === id);
    if (idx !== -1) {
      const inActiveHand = this.state.phase !== 'waiting' && this.state.phase !== 'showdown';
      const removingPlayer = this.state.players[idx];
      if (inActiveHand && !removingPlayer.folded) {
        if (this.state.activePlayerIndex === idx) {
          this.handleAction(id, 'fold');
        } else {
          removingPlayer.folded = true;
          removingPlayer.lastAction = 'Fold';
        }
      }

      const freshIdx = this.state.players.findIndex((p) => p.id === id);
      if (freshIdx !== -1) {
        this.state.players.splice(freshIdx, 1);
        this.state.players.forEach((p, i) => {
          p.seat = i;
        });

        if (freshIdx < this.state.dealerIndex) {
          this.state.dealerIndex = Math.max(0, this.state.dealerIndex - 1);
        }
        if (freshIdx < this.state.activePlayerIndex) {
          this.state.activePlayerIndex = Math.max(0, this.state.activePlayerIndex - 1);
        }
        const len = Math.max(1, this.state.players.length);
        this.state.dealerIndex %= len;
        this.state.activePlayerIndex %= len;

        if (this.state.phase !== 'waiting' && this.state.phase !== 'showdown') {
          const inHand = this.state.players.filter((p) => !p.folded);
          if (inHand.length === 1) {
            this.resolveWinnerByFold(inHand[0]);
            return;
          }
        }
      }
    }

    if (this.state.ownerId === id) {
      this.transferOwnership();
    }

    if (this.state.players.filter((p) => !p.isBot).length === 0 && this.state.spectators.length === 0) {
      this.clearAllTimers();
    } else {
      this.callbacks.onBroadcast();
    }
  }

  joinSeat(id: string): void {
    const specIdx = this.state.spectators.findIndex((s) => s.id === id);
    if (specIdx === -1) return;
    if (this.state.players.length >= 6) {
      this.callbacks.onSendError(id, 'La mesa está llena (máximo 6 jugadores).');
      return;
    }
    const [spec] = this.state.spectators.splice(specIdx, 1);
    this.state.players.push({
      id: spec.id,
      name: spec.name,
      chips: this.startingChips,
      bet: 0,
      totalBetThisHand: 0,
      folded: this.state.phase !== 'waiting',
      allIn: false,
      isBot: false,
      seat: this.state.players.length,
      holeCards: [],
      disconnected: false,
    });
    this.callbacks.onBroadcast();
    this.scheduleAutoStartIfReady(1200);
  }

  kickPlayer(requesterId: string, targetId: string): void {
    if (requesterId !== this.state.ownerId || requesterId === targetId) return;
    this.callbacks.onSendError(targetId, 'Has sido expulsado de la mesa por el anfitrión.');
    this.callbacks.onKickSocket(targetId);
    this.removePlayerPermanently(targetId);
  }

  startHand(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.autoNextTimer) clearTimeout(this.autoNextTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);

    for (const p of this.state.players) {
      if (p.chips <= 0) p.chips = this.startingChips;
    }
    if (this.state.players.length < 2) return;

    this.deck = createShuffledDeck();
    this.actedThisRound.clear();
    this.state.handNumber += 1;
    this.state.phase = 'preflop';
    this.state.pot = 0;
    this.state.communityCards = [];
    this.state.winners = [];
    this.state.currentBet = this.state.bigBlind;
    this.state.minRaise = this.state.bigBlind;
    this.state.dealerIndex = (this.state.dealerIndex + 1) % this.state.players.length;

    for (const p of this.state.players) {
      p.bet = 0;
      p.totalBetThisHand = 0;
      p.folded = p.chips <= 0;
      p.allIn = false;
      p.lastAction = undefined;
      p.handName = undefined;
      p.showCards = false;
      p.holeCards = p.folded ? [] : [this.deck.pop()!, this.deck.pop()!];
    }

    const activeIndices = this.state.players
      .map((p, i) => (!p.folded ? i : -1))
      .filter((i) => i !== -1);

    if (activeIndices.length < 2) {
      this.state.phase = 'waiting';
      this.callbacks.onBroadcast();
      return;
    }

    if (activeIndices.length === 2) {
      // Official Heads-Up rule: Dealer posts Small Blind and acts first preflop
      const sb = !this.state.players[this.state.dealerIndex].folded
        ? this.state.dealerIndex
        : this.nextActiveIndex(this.state.dealerIndex);
      const bb = this.nextActiveIndex(sb);
      this.postBlind(sb, this.state.smallBlind, 'SB');
      this.postBlind(bb, this.state.bigBlind, 'BB');
      this.state.activePlayerIndex = this.state.players[sb].allIn ? bb : sb;
    } else {
      const sb = this.nextActiveIndex(this.state.dealerIndex);
      const bb = this.nextActiveIndex(sb);
      this.postBlind(sb, this.state.smallBlind, 'SB');
      this.postBlind(bb, this.state.bigBlind, 'BB');
      this.state.activePlayerIndex = this.nextActiveIndex(bb);
    }

    this.callbacks.onBroadcast();
    this.scheduleBotIfNeeded();
  }

  handleAction(playerId: string, action: PlayerAction, raiseAmount?: number): void {
    if (this.state.phase === 'waiting' || this.state.phase === 'showdown') return;
    const active = this.state.players[this.state.activePlayerIndex];
    if (!active || active.id !== playerId) return;

    if (playerId === this.state.ownerId) {
      this.resetOwnerInactivity();
    }

    const toCall = Math.max(0, this.state.currentBet - active.bet);

    if (action === 'fold') {
      active.folded = true;
      active.lastAction = 'Fold';
    } else if (action === 'check') {
      if (toCall > 0) return;
      active.lastAction = 'Check';
    } else if (action === 'call') {
      const paid = Math.min(toCall, active.chips);
      active.chips -= paid;
      active.bet += paid;
      active.totalBetThisHand += paid;
      this.state.pot += paid;
      if (active.chips === 0) active.allIn = true;
      active.lastAction = active.allIn ? 'All-In' : `Call $${paid}`;
    } else if (action === 'raise' || action === 'allin') {
      const target =
        action === 'allin'
          ? active.bet + active.chips
          : Math.max(
              this.state.currentBet + this.state.minRaise,
              raiseAmount ?? this.state.currentBet + this.state.minRaise
            );
      const needed = Math.min(target - active.bet, active.chips);
      if (needed <= 0) return;
      active.chips -= needed;
      active.bet += needed;
      active.totalBetThisHand += needed;
      this.state.pot += needed;
      if (active.bet > this.state.currentBet) {
        this.state.minRaise = Math.max(this.state.minRaise, active.bet - this.state.currentBet);
        this.state.currentBet = active.bet;
        this.actedThisRound.clear();
      }
      if (active.chips === 0) active.allIn = true;
      active.lastAction = active.allIn ? `All-In $${active.bet}` : `Raise $${active.bet}`;
    }

    this.actedThisRound.add(active.id);
    this.advanceTurn();
  }

  showPlayerCards(playerId: string): void {
    if (this.state.phase !== 'showdown') return;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.holeCards.length === 0) return;
    player.showCards = true;
    this.callbacks.onBroadcast();
    setTimeout(() => {
      player.showCards = false;
      this.callbacks.onBroadcast();
    }, 5000);
  }

  setMusic(mode: MusicMode): void {
    this.state.music = {
      ...this.state.music,
      mode,
      startedAt: Date.now(),
      paused: false,
      pausedAtSec: 0,
    };
    this.callbacks.onBroadcast();
  }

  updatePlaylist(playlist: PlaylistTrack[], currentIndex: number): void {
    this.state.music = {
      ...this.state.music,
      mode: 'ncs-gaming',
      playlist,
      currentIndex: Math.max(0, Math.min(currentIndex, playlist.length - 1)),
      startedAt: Date.now(),
      paused: false,
      pausedAtSec: 0,
    };
    this.callbacks.onPersistPlaylist?.(playlist);
    this.callbacks.onBroadcast();
  }

  seekMusic(seconds: number): void {
    const cleanSec = Math.max(0, seconds);
    this.state.music = {
      ...this.state.music,
      startedAt: Date.now() - cleanSec * 1000,
      pausedAtSec: cleanSec,
    };
    this.callbacks.onBroadcast();
  }

  toggleMusicPause(): void {
    if (this.state.music.paused) {
      const resumeSec = this.state.music.pausedAtSec ?? 0;
      this.state.music = {
        ...this.state.music,
        paused: false,
        startedAt: Date.now() - resumeSec * 1000,
      };
    } else {
      const currentSec = Math.max(0, Math.floor((Date.now() - this.state.music.startedAt) / 1000));
      this.state.music = {
        ...this.state.music,
        paused: true,
        pausedAtSec: currentSec,
      };
    }
    this.callbacks.onBroadcast();
  }

  getSanitizedState(playerId: string): GameState {
    const isShowdown = this.state.phase === 'showdown';
    return {
      ...this.state,
      players: this.state.players.map((p) => ({
        ...p,
        holeCards:
          p.id === playerId || (isShowdown && (!p.folded || p.showCards))
            ? p.holeCards
            : p.holeCards.map(() => ({ suit: 'spades', rank: '2' })),
      })),
    };
  }

  getRoomInfo(): { hasOwner: boolean; hasActiveGame: boolean; playlist: PlaylistTrack[] } {
    return {
      hasOwner: Boolean(this.state.ownerId),
      hasActiveGame: this.state.phase !== 'waiting' || this.state.players.length > 0,
      playlist: this.state.music.playlist,
    };
  }

  private postBlind(index: number, amount: number, label: string): void {
    const p = this.state.players[index];
    if (!p) return;
    const paid = Math.min(amount, p.chips);
    p.chips -= paid;
    p.bet += paid;
    p.totalBetThisHand += paid;
    this.state.pot += paid;
    p.lastAction = `${label} $${paid}`;
    if (p.chips === 0) p.allIn = true;
  }

  private advanceTurn(): void {
    const inHand = this.state.players.filter((p) => !p.folded);
    if (inHand.length === 1) {
      this.resolveWinnerByFold(inHand[0]);
      return;
    }

    const canAct = inHand.filter((p) => !p.allIn);
    const allMatched = canAct.every((p) => p.bet === this.state.currentBet && this.actedThisRound.has(p.id));

    if (allMatched || canAct.length <= 1) {
      this.advancePhase();
      return;
    }

    let next = (this.state.activePlayerIndex + 1) % this.state.players.length;
    let guard = 0;
    while (
      (this.state.players[next].folded || this.state.players[next].allIn) &&
      guard < this.state.players.length
    ) {
      next = (next + 1) % this.state.players.length;
      guard++;
    }
    this.state.activePlayerIndex = next;
    this.callbacks.onBroadcast();
    this.scheduleBotIfNeeded();
  }

  private advancePhase(): void {
    for (const p of this.state.players) p.bet = 0;
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.actedThisRound.clear();

    const order: Phase[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
    const nextPhase = order[order.indexOf(this.state.phase) + 1];
    this.state.phase = nextPhase;

    if (nextPhase === 'flop') {
      this.state.communityCards.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
    } else if (nextPhase === 'turn' || nextPhase === 'river') {
      this.state.communityCards.push(this.deck.pop()!);
    } else if (nextPhase === 'showdown') {
      this.resolveShowdown();
      return;
    }

    const canAct = this.state.players.filter((p) => !p.folded && !p.allIn);
    if (canAct.length <= 1) {
      this.state.turnDeadline = undefined;
      this.callbacks.onBroadcast();
      setTimeout(() => this.advancePhase(), 800);
      return;
    }

    this.state.activePlayerIndex = this.nextActiveIndex(this.state.dealerIndex);
    this.callbacks.onBroadcast();
    this.scheduleBotIfNeeded();
  }

  private resolveWinnerByFold(winner: PlayerState): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.state.turnDeadline = undefined;
    winner.chips += this.state.pot;
    this.state.phase = 'showdown';
    this.state.winners = [
      {
        playerId: winner.id,
        playerName: winner.name,
        amount: this.state.pot,
        handName: 'Todos se retiraron',
      },
    ];
    this.callbacks.onBroadcast();
    this.scheduleAutoStartIfReady(5000);
  }

  private resolveShowdown(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.state.turnDeadline = undefined;

    // 1. Return uncalled bet excess if one player bet strictly more than everyone else
    const byBet = [...this.state.players].sort((a, b) => b.totalBetThisHand - a.totalBetThisHand);
    if (byBet.length >= 2 && byBet[0].totalBetThisHand > byBet[1].totalBetThisHand && !byBet[0].folded) {
      const uncalled = byBet[0].totalBetThisHand - byBet[1].totalBetThisHand;
      byBet[0].chips += uncalled;
      byBet[0].totalBetThisHand -= uncalled;
      this.state.pot = Math.max(0, this.state.pot - uncalled);
    }

    // 2. Evaluate all remaining contenders
    const contenders = this.state.players.filter((p) => !p.folded);
    const evalMap = new Map<string, ReturnType<typeof evaluateBestHand>>();
    for (const p of contenders) {
      const evaluated = evaluateBestHand([...p.holeCards, ...this.state.communityCards]);
      p.handName = evaluated.name;
      evalMap.set(p.id, evaluated);
    }

    // 3. Build and distribute side pots from unique contender bet thresholds
    const levels = Array.from(
      new Set(contenders.map((p) => p.totalBetThisHand).filter((amt) => amt > 0))
    ).sort((a, b) => a - b);

    const payouts = new Map<string, { player: PlayerState; amount: number; handName: string; winningCards: Card[] }>();
    let prevLevel = 0;

    for (const level of levels) {
      let subPot = 0;
      for (const p of this.state.players) {
        if (p.totalBetThisHand > prevLevel) {
          subPot += Math.min(p.totalBetThisHand, level) - prevLevel;
        }
      }
      prevLevel = level;
      if (subPot <= 0) continue;

      const eligible = contenders.filter((p) => p.totalBetThisHand >= level);
      let bestScore = -1;
      let levelWinners: PlayerState[] = [];
      for (const p of eligible) {
        const score = evalMap.get(p.id)?.score ?? -1;
        if (score > bestScore) {
          bestScore = score;
          levelWinners = [p];
        } else if (score === bestScore) {
          levelWinners.push(p);
        }
      }

      if (levelWinners.length === 0) continue;
      const share = Math.floor(subPot / levelWinners.length);
      let remainder = subPot - share * levelWinners.length;

      for (const w of levelWinners) {
        const bonus = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        const won = share + bonus;
        w.chips += won;
        const evalRes = evalMap.get(w.id)!;
        const prev = payouts.get(w.id);
        if (prev) {
          prev.amount += won;
        } else {
          payouts.set(w.id, {
            player: w,
            amount: won,
            handName: evalRes.name,
            winningCards: evalRes.cards,
          });
        }
      }
    }

    this.state.winners = Array.from(payouts.values()).map((entry) => ({
      playerId: entry.player.id,
      playerName: entry.player.name,
      amount: entry.amount,
      handName: entry.handName,
      winningCards: entry.winningCards,
    }));

    this.callbacks.onBroadcast();
    this.scheduleAutoStartIfReady(5000);
  }

  private scheduleAutoStartIfReady(delayMs: number): void {
    if (this.autoNextTimer) clearTimeout(this.autoNextTimer);
    if (this.state.phase !== 'waiting' && this.state.phase !== 'showdown') return;
    if (this.state.players.length < 2) return;
    this.autoNextTimer = setTimeout(() => {
      if ((this.state.phase === 'waiting' || this.state.phase === 'showdown') && this.state.players.length >= 2) {
        this.startHand();
      }
    }, delayMs);
  }

  private nextActiveIndex(from: number): number {
    let idx = (from + 1) % this.state.players.length;
    let guard = 0;
    while ((this.state.players[idx].folded || this.state.players[idx].allIn) && guard < this.state.players.length) {
      idx = (idx + 1) % this.state.players.length;
      guard++;
    }
    return idx;
  }

  private scheduleBotIfNeeded(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.state.turnDeadline = undefined;
    if (this.state.phase === 'waiting' || this.state.phase === 'showdown') return;
    const active = this.state.players[this.state.activePlayerIndex];
    if (!active) return;

    if (!active.isBot) {
      const ms = this.state.turnTimeSeconds * 1000;
      this.state.turnDeadline = Date.now() + ms;
      this.callbacks.onBroadcast();
      this.turnTimer = setTimeout(() => {
        const toCall = Math.max(0, this.state.currentBet - active.bet);
        this.handleAction(active.id, toCall === 0 ? 'check' : 'fold');
      }, ms);
      return;
    }

    this.botTimer = setTimeout(() => {
      const toCall = Math.max(0, this.state.currentBet - active.bet);
      const strength = evaluateBotHandStrength(active.holeCards, this.state.communityCards);
      const potOdds = toCall / Math.max(1, this.state.pot + toCall);
      const noise = (Math.random() - 0.5) * 0.14;
      const effectiveStrength = strength + noise;

      if (toCall === 0) {
        if (effectiveStrength >= 0.7) {
          this.handleAction(active.id, 'raise', this.state.currentBet + this.state.bigBlind);
        } else {
          this.handleAction(active.id, 'check');
        }
      } else if (effectiveStrength >= 0.78) {
        if (Math.random() < 0.45 && active.chips > toCall + this.state.minRaise) {
          this.handleAction(active.id, 'raise', this.state.currentBet + this.state.bigBlind);
        } else {
          this.handleAction(active.id, 'call');
        }
      } else if (effectiveStrength >= potOdds + 0.12 || toCall <= this.state.bigBlind) {
        this.handleAction(active.id, 'call');
      } else {
        this.handleAction(active.id, 'fold');
      }
    }, 850);
  }

  private resetOwnerInactivity(): void {
    if (this.ownerInactivityTimer) clearTimeout(this.ownerInactivityTimer);
    if (!this.state.ownerId) return;
    this.ownerInactivityTimer = setTimeout(() => {
      this.transferOwnership();
    }, 15 * 60 * 1000);
  }

  private transferOwnership(): void {
    const nextHuman =
      this.state.players.find((p) => !p.isBot && p.id !== this.state.ownerId && !p.disconnected) ??
      this.state.players.find((p) => !p.isBot && p.id !== this.state.ownerId) ??
      this.state.spectators.find((s) => s.id !== this.state.ownerId);
    this.state.ownerId = nextHuman?.id;
    if (this.state.ownerId) {
      this.resetOwnerInactivity();
    }
    this.callbacks.onBroadcast();
  }

  private clearAllTimers(): void {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.autoNextTimer) clearTimeout(this.autoNextTimer);
    if (this.ownerInactivityTimer) clearTimeout(this.ownerInactivityTimer);
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    this.disconnectTimers.clear();
  }
}
