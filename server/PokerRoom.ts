import { WebSocket } from 'ws';
import type { MusicMode, PlayerAction, PlaylistTrack, ServerMessage } from '../shared/poker.ts';
import { PokerEngine } from '../shared/PokerEngine.ts';

export class PokerRoom {
  private sockets = new Map<string, WebSocket>();
  public engine: PokerEngine;

  constructor(roomId: string) {
    this.engine = new PokerEngine(roomId, {
      onBroadcast: () => this.broadcastState(),
      onSendError: (playerId, message) => {
        const ws = this.sockets.get(playerId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message } satisfies ServerMessage));
        }
      },
      onKickSocket: (playerId) => {
        const ws = this.sockets.get(playerId);
        if (ws) {
          ws.close(4001, 'Kicked by owner');
          this.sockets.delete(playerId);
        }
      },
    });
  }

  configure(options: {
    smallBlind?: number;
    bigBlind?: number;
    startingChips?: number;
    turnTimeSeconds?: number;
    initialPlaylist?: PlaylistTrack[];
  }): void {
    this.engine.configure(options);
  }

  addPlayer(id: string, name: string, ws: WebSocket, botCount = 0, spectate = false): void {
    const oldWs = this.sockets.get(id);
    if (oldWs && oldWs !== ws) {
      try {
        oldWs.close(4000, 'Replaced by reconnect');
      } catch {
        // Ignore already-closed socket
      }
    }
    this.sockets.set(id, ws);
    this.engine.addPlayer(id, name, botCount, spectate);
  }

  handleDisconnect(id: string, ws: WebSocket): void {
    if (this.sockets.get(id) !== ws) return;
    this.sockets.delete(id);
    this.engine.handleDisconnect(id);
  }

  startHand(requesterId?: string): void {
    if (requesterId && requesterId !== this.engine.state.ownerId) return;
    this.engine.startHand();
  }

  addBot(requesterId?: string): void {
    if (requesterId && requesterId !== this.engine.state.ownerId) return;
    this.engine.addBot();
  }

  handleAction(playerId: string, action: PlayerAction, amount?: number): void {
    this.engine.handleAction(playerId, action, amount);
  }

  showPlayerCards(playerId: string): void {
    this.engine.showPlayerCards(playerId);
  }

  setMusic(mode: MusicMode): void {
    this.engine.setMusic(mode);
  }

  updatePlaylist(playlist: PlaylistTrack[], currentIndex: number): void {
    this.engine.updatePlaylist(playlist, currentIndex);
  }

  seekMusic(seconds: number): void {
    this.engine.seekMusic(seconds);
  }

  toggleMusicPause(): void {
    this.engine.toggleMusicPause();
  }

  kickPlayer(requesterId: string, targetId: string): void {
    this.engine.kickPlayer(requesterId, targetId);
  }

  joinSeat(playerId: string): void {
    this.engine.joinSeat(playerId);
  }

  private broadcastState(): void {
    const now = Date.now();
    for (const [playerId, ws] of this.sockets.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const sanitized = this.engine.getSanitizedState(playerId);
      ws.send(
        JSON.stringify({ type: 'state', state: sanitized, yourId: playerId, serverNow: now } satisfies ServerMessage)
      );
    }
  }
}
