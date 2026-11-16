export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type Phase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PlayerState {
  id: string;
  name: string;
  chips: number;
  bet: number;
  totalBetThisHand: number;
  folded: boolean;
  allIn: boolean;
  isBot: boolean;
  seat: number;
  holeCards: Card[];
  lastAction?: string;
  handName?: string;
  showCards?: boolean;
}

export interface WinnerInfo {
  playerId: string;
  playerName: string;
  amount: number;
  handName: string;
}

export type MusicMode = 'lounge' | 'ncs-chill' | 'ncs-gaming';

export interface PlaylistTrack {
  id: string;
  title: string;
  youtubeId: string;
}

export interface MusicState {
  mode: MusicMode;
  startedAt: number;
  playlist: PlaylistTrack[];
  currentIndex: number;
}

export interface SpectatorInfo {
  id: string;
  name: string;
}

export interface GameState {
  roomId: string;
  ownerId?: string;
  phase: Phase;
  pot: number;
  communityCards: Card[];
  currentBet: number;
  minRaise: number;
  dealerIndex: number;
  activePlayerIndex: number;
  players: PlayerState[];
  spectators: SpectatorInfo[];
  winners: WinnerInfo[];
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  turnTimeSeconds: number;
  turnDeadline?: number;
  music: MusicState;
}

export type ClientMessage =
  | {
      type: 'join_room';
      roomId: string;
      playerName: string;
      withBots?: boolean;
      smallBlind?: number;
      bigBlind?: number;
      startingChips?: number;
      turnTimeSeconds?: number;
      botCount?: number;
      spectate?: boolean;
      initialPlaylist?: PlaylistTrack[];
    }
  | { type: 'start_hand' }
  | { type: 'action'; action: PlayerAction; amount?: number }
  | { type: 'add_bot' }
  | { type: 'show_cards' }
  | { type: 'set_music'; mode: MusicMode }
  | { type: 'update_playlist'; playlist: PlaylistTrack[]; currentIndex: number }
  | { type: 'seek_music'; seconds: number }
  | { type: 'kick_player'; targetId: string }
  | { type: 'join_seat' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'state'; state: GameState; yourId: string; serverNow?: number }
  | { type: 'error'; message: string };
