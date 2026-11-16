import { WebSocket } from 'ws';
import type {
  Card,
  GameState,
  MusicMode,
  Phase,
  PlayerAction,
  PlayerState,
  PlaylistTrack,
  Rank,
  ServerMessage,
  Suit,
  WinnerInfo,
} from '../shared/poker.ts';
import { evaluateBestHand } from '../shared/evaluator.ts';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BOT_NAMES = ['Luna', 'Mateo', 'Vega', 'Dante', 'Kira'];

function createShuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export class PokerRoom {
  private state: GameState;
  private deck: Card[] = [];
  private sockets = new Map<string, WebSocket>();
  private actedThisRound = new Set<string>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerInactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private startingChips = 1000;

  constructor(roomId: string) {
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
      turnTimeSeconds: 20,
      music: {
        mode: 'lounge',
        startedAt: Date.now(),
        currentIndex: 0,
        playlist: [
          { id: '1', title: 'NCS - Cartoon, Jéja - On & On', youtubeId: 'K4DyBUG242c' },
          { id: '2', title: 'NCS - Elektronomia - Sky High', youtubeId: 'TW9d8vYrVFQ' },
          { id: '3', title: 'NCS - Alan Walker - Fade', youtubeId: 'bM7SZ5SBzyY' },
          { id: '4', title: 'NCS - Different Heaven - Nekozilla', youtubeId: '6FNHe3kf8_s' },
        ],
      },
    };
  }

  configure(options: { smallBlind?: number; bigBlind?: number; startingChips?: number; turnTimeSeconds?: number }): void {
    if (this.state.handNumber > 0 || this.state.players.length > 0) return;
    if (options.smallBlind && options.smallBlind > 0) {
      this.state.smallBlind = options.smallBlind;
    }
    if (options.bigBlind && options.bigBlind > 0) {
      this.state.bigBlind = options.bigBlind;
      this.state.minRaise = options.bigBlind;
    }
    if (options.startingChips && options.startingChips >= 100) {
      this.startingChips = options.startingChips;
    }
    if (options.turnTimeSeconds && options.turnTimeSeconds >= 5) {
      this.state.turnTimeSeconds = options.turnTimeSeconds;
    }
  }

  addPlayer(id: string, name: string, ws: WebSocket, withBots = false, spectate = false): void {
    const existing = this.state.players.find((p) => p.id === id);
    if (existing) {
      this.sockets.set(id, ws);
      this.broadcastState();
      return;
    }
    const cleanName = name.trim();
    if (!cleanName) {
      this.sendError(ws, 'El nombre es obligatorio.');
      return;
    }
    const nameTaken =
      this.state.players.some((p) => p.name.toLowerCase() === cleanName.toLowerCase()) ||
      this.state.spectators.some((s) => s.name.toLowerCase() === cleanName.toLowerCase());
    if (nameTaken) {
      this.sendError(ws, 'Ese nombre ya está en uso en esta mesa.');
      return;
    }

    this.sockets.set(id, ws);
    if (!this.state.ownerId) {
      this.state.ownerId = id;
      this.resetOwnerInactivity();
    }

    if (spectate) {
      this.state.spectators.push({ id, name: cleanName });
      this.broadcastState();
      return;
    }

    if (this.state.players.length >= 6) {
      this.sendError(ws, 'La mesa está llena (máximo 6 jugadores).');
      return;
    }
    this.state.players.push({
      id,
      name: name.trim() || `Jugador ${this.state.players.length + 1}`,
      chips: this.startingChips,
      bet: 0,
      totalBetThisHand: 0,
      folded: this.state.phase !== 'waiting',
      allIn: false,
      isBot: false,
      seat: this.state.players.length,
      holeCards: [],
    });

    if (withBots && this.state.players.length === 1) {
      this.addBot();
      this.addBot();
      this.addBot();
    }

    this.broadcastState();
  }

  addBot(): void {
    if (this.state.players.length >= 6) return;
    const usedNames = new Set(this.state.players.map((p) => p.name));
    const botName = BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot ${this.state.players.length}`;
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
    this.broadcastState();
  }

  removePlayer(id: string): void {
    this.sockets.delete(id);
    this.state.spectators = this.state.spectators.filter((s) => s.id !== id);
    const idx = this.state.players.findIndex((p) => p.id === id);
    if (idx !== -1) {
      this.state.players.splice(idx, 1);
      this.state.players.forEach((p, i) => {
        p.seat = i;
      });
    }
    if (this.state.ownerId === id) {
      this.transferOwnership();
    }
    if (this.state.players.filter((p) => !p.isBot).length === 0 && this.state.spectators.length === 0) {
      if (this.botTimer) clearTimeout(this.botTimer);
      if (this.turnTimer) clearTimeout(this.turnTimer);
      if (this.ownerInactivityTimer) clearTimeout(this.ownerInactivityTimer);
    } else {
      this.broadcastState();
    }
  }

  joinSeat(id: string): void {
    const specIdx = this.state.spectators.findIndex((s) => s.id === id);
    if (specIdx === -1) return;
    if (this.state.players.length >= 6) {
      const ws = this.sockets.get(id);
      if (ws) this.sendError(ws, 'La mesa está llena (máximo 6 jugadores).');
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
    });
    this.broadcastState();
  }

  kickPlayer(requesterId: string, targetId: string): void {
    if (requesterId !== this.state.ownerId || requesterId === targetId) return;
    const ws = this.sockets.get(targetId);
    if (ws) {
      this.sendError(ws, 'Has sido expulsado de la mesa por el anfitrión.');
      ws.close();
    }
    this.removePlayer(targetId);
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
      this.state.players.find((p) => !p.isBot && p.id !== this.state.ownerId) ??
      this.state.spectators.find((s) => s.id !== this.state.ownerId);
    this.state.ownerId = nextHuman?.id;
    if (this.state.ownerId) {
      this.resetOwnerInactivity();
    }
    this.broadcastState();
  }

  startHand(): void {
    const eligible = this.state.players.filter((p) => p.chips > 0);
    if (eligible.length < 2) {
      // Reset busted bots/players for casual play
      for (const p of this.state.players) {
        if (p.chips <= 0) p.chips = 1000;
      }
    }
    if (this.state.players.length < 2) return;

    if (this.botTimer) clearTimeout(this.botTimer);
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

    const sbIndex = this.nextActiveIndex(this.state.dealerIndex);
    const bbIndex = this.nextActiveIndex(sbIndex);

    this.postBlind(sbIndex, this.state.smallBlind, 'SB');
    this.postBlind(bbIndex, this.state.bigBlind, 'BB');

    this.state.activePlayerIndex = this.nextActiveIndex(bbIndex);
    this.broadcastState();
    this.scheduleBotIfNeeded();
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

  handleAction(playerId: string, action: PlayerAction, raiseAmount?: number): void {
    if (this.state.phase === 'waiting' || this.state.phase === 'showdown') return;
    const active = this.state.players[this.state.activePlayerIndex];
    if (!active || active.id !== playerId) return;

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
      const targetBet =
        action === 'allin'
          ? active.bet + active.chips
          : Math.max(this.state.currentBet + this.state.minRaise, raiseAmount ?? this.state.currentBet + this.state.minRaise);
      const needed = Math.min(targetBet - active.bet, active.chips);
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
    while (this.state.players[next].folded || this.state.players[next].allIn) {
      next = (next + 1) % this.state.players.length;
    }
    this.state.activePlayerIndex = next;
    this.broadcastState();
    this.scheduleBotIfNeeded();
  }

  private advancePhase(): void {
    for (const p of this.state.players) {
      p.bet = 0;
    }
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
      // Run out remaining cards automatically
      this.broadcastState();
      setTimeout(() => this.advancePhase(), 800);
      return;
    }

    this.state.activePlayerIndex = this.nextActiveIndex(this.state.dealerIndex);
    this.broadcastState();
    this.scheduleBotIfNeeded();
  }

  private resolveWinnerByFold(winner: PlayerState): void {
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
    this.broadcastState();
  }

  private resolveShowdown(): void {
    const contenders = this.state.players.filter((p) => !p.folded);
    let bestScore = -1;
    let winners: { player: PlayerState; handName: string }[] = [];

    for (const p of contenders) {
      const evaluated = evaluateBestHand([...p.holeCards, ...this.state.communityCards]);
      p.handName = evaluated.name;
      if (evaluated.score > bestScore) {
        bestScore = evaluated.score;
        winners = [{ player: p, handName: evaluated.name }];
      } else if (evaluated.score === bestScore) {
        winners.push({ player: p, handName: evaluated.name });
      }
    }

    const share = Math.floor(this.state.pot / winners.length);
    const winnerInfos: WinnerInfo[] = winners.map((w) => {
      w.player.chips += share;
      return {
        playerId: w.player.id,
        playerName: w.player.name,
        amount: share,
        handName: w.handName,
      };
    });

    this.state.winners = winnerInfos;
    this.broadcastState();
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
      this.broadcastState();
      this.turnTimer = setTimeout(() => {
        const toCall = Math.max(0, this.state.currentBet - active.bet);
        this.handleAction(active.id, toCall === 0 ? 'check' : 'fold');
      }, ms);
      return;
    }

    this.botTimer = setTimeout(() => {
      const toCall = Math.max(0, this.state.currentBet - active.bet);
      const roll = Math.random();
      if (toCall === 0) {
        if (roll < 0.72) this.handleAction(active.id, 'check');
        else this.handleAction(active.id, 'raise', this.state.currentBet + this.state.bigBlind);
      } else if (toCall <= active.chips * 0.25) {
        if (roll < 0.15) this.handleAction(active.id, 'fold');
        else if (roll < 0.85) this.handleAction(active.id, 'call');
        else this.handleAction(active.id, 'raise', this.state.currentBet + this.state.bigBlind);
      } else {
        if (roll < 0.55) this.handleAction(active.id, 'fold');
        else this.handleAction(active.id, 'call');
      }
    }, 850);
  }

  setMusic(mode: MusicMode): void {
    this.state.music = { ...this.state.music, mode, startedAt: Date.now() };
    this.broadcastState();
  }

  seekMusic(seconds: number): void {
    this.state.music = {
      ...this.state.music,
      startedAt: Date.now() - Math.max(0, seconds) * 1000,
    };
    this.broadcastState();
  }

  updatePlaylist(playlist: PlaylistTrack[], currentIndex: number): void {
    this.state.music = {
      ...this.state.music,
      mode: 'ncs-gaming',
      playlist,
      currentIndex: Math.max(0, Math.min(currentIndex, playlist.length - 1)),
      startedAt: Date.now(),
    };
    this.broadcastState();
  }

  showPlayerCards(playerId: string): void {
    if (this.state.phase !== 'showdown') return;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || player.holeCards.length === 0) return;
    player.showCards = true;
    this.broadcastState();
    setTimeout(() => {
      player.showCards = false;
      this.broadcastState();
    }, 5000);
  }

  private broadcastState(): void {
    const isShowdown = this.state.phase === 'showdown';
    for (const [playerId, ws] of this.sockets.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const sanitized: GameState = {
        ...this.state,
        players: this.state.players.map((p) => ({
          ...p,
          holeCards:
            p.id === playerId || (isShowdown && (!p.folded || p.showCards))
              ? p.holeCards
              : p.holeCards.map(() => ({ suit: 'spades', rank: '2' })),
        })),
      };
      const msg: ServerMessage = { type: 'state', state: sanitized, yourId: playerId };
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message } satisfies ServerMessage));
    }
  }
}
