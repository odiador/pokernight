import { WebSocketServer } from 'ws';
import type { ClientMessage } from '../shared/poker.ts';
import { PokerRoom } from './PokerRoom.ts';

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map<string, PokerRoom>();

function getOrCreateRoom(roomId: string): PokerRoom {
  let room = rooms.get(roomId);
  if (!room) {
    room = new PokerRoom(roomId);
    rooms.set(roomId, room);
  }
  return room;
}

wss.on('connection', (ws) => {
  const playerId = `p-${Math.random().toString(36).slice(2, 10)}`;
  let currentRoom: PokerRoom | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === 'join_room') {
        currentRoom = getOrCreateRoom(msg.roomId || 'mesa-vip');
        currentRoom.configure({
          smallBlind: msg.smallBlind,
          bigBlind: msg.bigBlind,
          startingChips: msg.startingChips,
          turnTimeSeconds: msg.turnTimeSeconds,
        });
        currentRoom.addPlayer(playerId, msg.playerName, ws, msg.withBots, msg.spectate);
      } else if (msg.type === 'start_hand' && currentRoom) {
        currentRoom.startHand();
      } else if (msg.type === 'add_bot' && currentRoom) {
        currentRoom.addBot();
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
      } else if (msg.type === 'kick_player' && currentRoom) {
        currentRoom.kickPlayer(playerId, msg.targetId);
      } else if (msg.type === 'join_seat' && currentRoom) {
        currentRoom.joinSeat(playerId);
      } else if (msg.type === 'ping') {
        // Keep-alive heartbeat
      }
    } catch {
      // Ignore malformed payloads
    }
  });

  ws.on('close', () => {
    currentRoom?.removePlayer(playerId);
  });
});

console.log(`🃏 Poker Night WS Server escuchando en ws://localhost:${PORT}`);
