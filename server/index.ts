import http from 'node:http';
import { WebSocketServer } from 'ws';
import type { ClientMessage } from '../shared/poker.ts';
import { fetchYouTubePlaylist, searchYouTube } from '../shared/youtube.ts';
import { PokerRoom } from './PokerRoom.ts';

const PORT = 3001;
const rooms = new Map<string, PokerRoom>();

function getOrCreateRoom(roomId: string): PokerRoom {
  let room = rooms.get(roomId);
  if (!room) {
    room = new PokerRoom(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/api/room-info') {
    const roomId = url.searchParams.get('room') || 'mesa-vip';
    const room = rooms.get(roomId);
    res.end(
      JSON.stringify(
        room
          ? room.engine.getRoomInfo()
          : { hasOwner: false, hasActiveGame: false, playlist: [] }
      )
    );
    return;
  }

  if (url.pathname === '/api/yt-search') {
    const q = url.searchParams.get('q') ?? '';
    res.end(JSON.stringify(await searchYouTube(q)));
    return;
  }

  if (url.pathname === '/api/yt-playlist') {
    const listId = url.searchParams.get('list') ?? '';
    const videoId = url.searchParams.get('v') ?? undefined;
    res.end(JSON.stringify(await fetchYouTubePlaylist(listId, videoId)));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let playerId = `p-${Math.random().toString(36).slice(2, 10)}`;
  let currentRoom: PokerRoom | null = null;

  ws.on('message', (raw) => {
    const text = raw.toString();
    if (text === 'ping') {
      ws.send('pong');
      return;
    }
    try {
      const msg = JSON.parse(text) as ClientMessage;
      if (msg.type === 'join_room') {
        if (msg.clientId) playerId = msg.clientId;
        currentRoom = getOrCreateRoom(msg.roomId || 'mesa-vip');
        currentRoom.configure({
          smallBlind: msg.smallBlind,
          bigBlind: msg.bigBlind,
          startingChips: msg.startingChips,
          turnTimeSeconds: msg.turnTimeSeconds,
          initialPlaylist: msg.initialPlaylist,
        });
        const bots = msg.botCount ?? (msg.withBots ? 3 : 0);
        currentRoom.addPlayer(playerId, msg.playerName, ws, bots, msg.spectate);
      } else if (msg.type === 'start_hand' && currentRoom) {
        currentRoom.startHand(playerId);
      } else if (msg.type === 'add_bot' && currentRoom) {
        currentRoom.addBot(playerId);
      } else if (msg.type === 'action' && currentRoom) {
        currentRoom.handleAction(playerId, msg.action, msg.amount);
      } else if (msg.type === 'show_cards' && currentRoom) {
        currentRoom.showPlayerCards(playerId);
      } else if (msg.type === 'set_music' && currentRoom) {
        currentRoom.setMusic(msg.mode);
      } else if (msg.type === 'update_playlist' && currentRoom) {
        currentRoom.updatePlaylist(msg.playlist, msg.currentIndex);
      } else if (msg.type === 'seek_music' && currentRoom) {
        currentRoom.seekMusic(msg.seconds);
      } else if (msg.type === 'toggle_music_pause' && currentRoom) {
        currentRoom.toggleMusicPause();
      } else if (msg.type === 'kick_player' && currentRoom) {
        currentRoom.kickPlayer(playerId, msg.targetId);
      } else if (msg.type === 'join_seat' && currentRoom) {
        currentRoom.joinSeat(playerId);
      } else if (msg.type === 'ping') {
        ws.send('pong');
      }
    } catch {
      // Ignore malformed payloads
    }
  });

  ws.on('close', () => {
    currentRoom?.handleDisconnect(playerId, ws);
  });
});

server.listen(PORT, () => {
  console.log(`🃏 Poker Night Server (WS + API) escuchando en http://localhost:${PORT}`);
});
