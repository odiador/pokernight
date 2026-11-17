import type { ClientMessage, PlaylistTrack, ServerMessage } from '../shared/poker.ts';
import { PokerEngine } from '../shared/PokerEngine.ts';
import { fetchYouTubePlaylist, searchYouTube } from '../shared/youtube.ts';

interface Env {
  POKER_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class PokerRoomDO implements DurableObject {
  private ctx: DurableObjectState;
  private engine: PokerEngine;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.engine = new PokerEngine('mesa-vip', {
      onBroadcast: () => this.broadcastState(),
      onSendError: (playerId, message) => {
        for (const ws of this.ctx.getWebSockets()) {
          if (ws.deserializeAttachment() === playerId && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message } satisfies ServerMessage));
          }
        }
      },
      onKickSocket: (playerId) => {
        for (const ws of this.ctx.getWebSockets()) {
          if (ws.deserializeAttachment() === playerId && ws.readyState === 1) {
            ws.close(4001, 'Kicked by owner');
          }
        }
      },
      onPersistPlaylist: (playlist) => {
        void this.ctx.storage.put('playlist', playlist);
      },
    });

    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<PlaylistTrack[]>('playlist');
      if (saved && saved.length > 0) {
        this.engine.setSavedPlaylist(saved);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/info') {
      return Response.json(this.engine.getRoomInfo());
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const tempId = `p-${Math.random().toString(36).slice(2, 10)}`;
    server.serializeAttachment(tempId);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (raw === 'ping') {
      ws.send('pong');
      return;
    }
    let playerId = ws.deserializeAttachment() as string;
    if (!playerId) return;

    try {
      const msg = JSON.parse(raw) as ClientMessage;
      if (msg.type === 'join_room') {
        if (msg.clientId) {
          // Close any old dead socket carrying the same clientId before reattaching
          for (const other of this.ctx.getWebSockets()) {
            if (other !== ws && other.deserializeAttachment() === msg.clientId) {
              other.serializeAttachment(`replaced-${Math.random().toString(36).slice(2, 8)}`);
              try {
                other.close(4000, 'Replaced by reconnect');
              } catch {
                // Ignore already-closed socket
              }
            }
          }
          playerId = msg.clientId;
          ws.serializeAttachment(playerId);
        }
        this.engine.configure({
          roomId: msg.roomId || 'mesa-vip',
          smallBlind: msg.smallBlind,
          bigBlind: msg.bigBlind,
          startingChips: msg.startingChips,
          turnTimeSeconds: msg.turnTimeSeconds,
          initialPlaylist: msg.initialPlaylist,
        });
        const bots = msg.botCount ?? (msg.withBots ? 3 : 0);
        this.engine.addPlayer(playerId, msg.playerName, bots, msg.spectate);
      } else if (msg.type === 'start_hand') {
        if (playerId === this.engine.state.ownerId) this.engine.startHand();
      } else if (msg.type === 'add_bot') {
        if (playerId === this.engine.state.ownerId) this.engine.addBot();
      } else if (msg.type === 'action') {
        this.engine.handleAction(playerId, msg.action, msg.amount);
      } else if (msg.type === 'show_cards') {
        this.engine.showPlayerCards(playerId);
      } else if (msg.type === 'set_music') {
        this.engine.setMusic(msg.mode);
      } else if (msg.type === 'update_playlist') {
        this.engine.updatePlaylist(msg.playlist, msg.currentIndex);
      } else if (msg.type === 'seek_music') {
        this.engine.seekMusic(msg.seconds);
      } else if (msg.type === 'toggle_music_pause') {
        this.engine.toggleMusicPause();
      } else if (msg.type === 'kick_player') {
        this.engine.kickPlayer(playerId, msg.targetId);
      } else if (msg.type === 'join_seat') {
        this.engine.joinSeat(playerId);
      } else if (msg.type === 'leave_seat') {
        this.engine.leaveSeat(playerId);
      } else if (msg.type === 'ping') {
        ws.send('pong');
      }
    } catch {
      // Ignore malformed payloads
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const playerId = ws.deserializeAttachment() as string;
    if (playerId && !playerId.startsWith('replaced-')) {
      this.engine.handleDisconnect(playerId);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const playerId = ws.deserializeAttachment() as string;
    if (playerId && !playerId.startsWith('replaced-')) {
      this.engine.handleDisconnect(playerId);
    }
  }

  private broadcastState(): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue;
      const playerId = ws.deserializeAttachment() as string;
      if (!playerId || playerId.startsWith('replaced-')) continue;
      const sanitized = this.engine.getSanitizedState(playerId);
      ws.send(JSON.stringify({ type: 'state', state: sanitized, yourId: playerId, serverNow: now } satisfies ServerMessage));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || 'mesa-vip';
      const id = env.POKER_ROOM.idFromName(room);
      return env.POKER_ROOM.get(id).fetch(request);
    }
    if (url.pathname === '/api/room-info') {
      const room = url.searchParams.get('room') || 'mesa-vip';
      const id = env.POKER_ROOM.idFromName(room);
      return env.POKER_ROOM.get(id).fetch(new Request('https://internal/info'));
    }
    if (url.pathname === '/api/yt-search') {
      const q = url.searchParams.get('q') ?? '';
      return Response.json(await searchYouTube(q));
    }
    if (url.pathname === '/api/yt-playlist') {
      const listId = url.searchParams.get('list') ?? '';
      const videoId = url.searchParams.get('v') ?? undefined;
      return Response.json(await fetchYouTubePlaylist(listId, videoId));
    }
    return env.ASSETS.fetch(request);
  },
};
