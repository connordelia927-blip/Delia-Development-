const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = 3000;
const LOG_FILE = path.join(__dirname, 'visitor_log.txt');

app.use(express.json());
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.post('/log-ip', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.socket.remoteAddress || 'UNKNOWN';
  const userAgent = req.body.userAgent || 'UNKNOWN';
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}]\nIP      : ${ip}\nAGENT   : ${userAgent}\n--------------------------------------\n`;
  fs.appendFileSync(LOG_FILE, entry, 'utf8');
  console.log(`[LOG] ${timestamp} | ${ip}`);
  res.json({ ok: true, ip });
});

// ============================================
// IN-MEMORY STATE
// ============================================
const lobbies = new Map();
const clients = new Map();
let lobbyCounter = 0;

function genLobbyId() { return 'L' + (++lobbyCounter) + '_' + Date.now().toString(36); }

// ============================================
// HELPERS
// ============================================
function broadcast(lobbyId, msg, excludeWs) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  const data = JSON.stringify(msg);
  for (const [ws] of lobby.players) {
    if (ws !== excludeWs && ws.readyState === 1) ws.send(data);
  }
}

function broadcastAll(lobbyId, msg) { broadcast(lobbyId, msg, null); }

function sendTo(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function getLobbyList() {
  const list = [];
  for (const [id, lobby] of lobbies) {
    let ownerName = 'Unknown';
    for (const [, pd] of lobby.players) {
      if (pd.playerId === lobby.ownerId) { ownerName = pd.username || 'Unknown'; break; }
    }
    list.push({ id, name: lobby.name, count: lobby.players.size, ownerName });
  }
  return list;
}

function getScoreboardForLobby(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return [];
  const rows = [];
  for (const [, pd] of lobby.players) {
    rows.push({
      playerId: pd.playerId,
      username: pd.username || 'Unknown',
      kills: pd.kills || 0,
      deaths: pd.deaths || 0,
      ping: pd.ping || 0,
    });
  }
  rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return rows;
}

function removePFromLobby(ws) {
  const c = clients.get(ws);
  if (!c || !c.lobbyId) return;
  const lobby = lobbies.get(c.lobbyId);
  if (!lobby) { c.lobbyId = null; return; }

  const lobbyId = c.lobbyId;
  lobby.players.delete(ws);
  broadcast(lobbyId, { type: 'player_leave', player_id: c.playerId }, null);
  c.lobbyId = null;

  if (lobby.players.size === 0) {
    lobbies.delete(lobbyId);
    return;
  }

  if (lobby.ownerId === c.playerId) {
    const firstEntry = lobby.players.values().next().value;
    if (firstEntry) {
      lobby.ownerId = firstEntry.playerId;
      broadcastAll(lobbyId, { type: 'owner_changed', owner_id: firstEntry.playerId, owner_name: firstEntry.username });
    }
  }
}

// ============================================
// WEBSOCKET
// ============================================
wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).slice(2, 9);
  clients.set(ws, { playerId, username: 'Player', lobbyId: null });

  sendTo(ws, { type: 'welcome', player_id: playerId });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const c = clients.get(ws);
    if (!c) return;

    switch (msg.type) {

      case 'set_username': {
        c.username = (msg.username || 'Player').slice(0, 16);
        break;
      }

      case 'get_lobbies': {
        sendTo(ws, { type: 'lobby_list', lobbies: getLobbyList() });
        break;
      }

      case 'create_lobby': {
        removePFromLobby(ws);
        const id = genLobbyId();
        const name = (msg.name || 'LOBBY').slice(0, 20);
        const lobby = {
          name,
          ownerId: c.playerId,
          players: new Map(),
          bannedIds: new Set(),
          settings: { botsEnabled: true, cheatsAllowed: true },
        };
        const pd = {
          playerId: c.playerId, username: c.username,
          color: msg.color || 0x4488ff, x: 0, y: 1.7, z: 0, rotY: 0,
          hp: 100, kills: 0, deaths: 0, ping: 0,
        };
        lobby.players.set(ws, pd);
        lobbies.set(id, lobby);
        c.lobbyId = id;
        sendTo(ws, { type: 'lobby_created', id, name });
        sendTo(ws, { type: 'lobby_settings', settings: lobby.settings, owner_id: lobby.ownerId });
        break;
      }

      case 'join_lobby': {
        const lobby = lobbies.get(msg.lobby_id);
        if (!lobby) { sendTo(ws, { type: 'error', message: 'Lobby not found' }); break; }
        if (lobby.bannedIds.has(c.playerId)) { sendTo(ws, { type: 'banned', lobby_id: msg.lobby_id }); break; }

        removePFromLobby(ws);
        const pd = {
          playerId: c.playerId, username: c.username,
          color: msg.player_data?.color || 0x4488ff,
          x: 0, y: 1.7, z: 0, rotY: 0,
          hp: 100, kills: 0, deaths: 0, ping: 0,
        };
        lobby.players.set(ws, pd);
        c.lobbyId = msg.lobby_id;

        const existingPlayers = {};
        for (const [, epd] of lobby.players) {
          existingPlayers[epd.playerId] = { username: epd.username, color: epd.color, x: epd.x, y: epd.y, z: epd.z, rotY: epd.rotY, hp: epd.hp };
        }
        sendTo(ws, { type: 'init_players', players: existingPlayers });
        sendTo(ws, { type: 'lobby_settings', settings: lobby.settings, owner_id: lobby.ownerId });

        broadcast(msg.lobby_id, {
          type: 'player_join', player_id: c.playerId,
          player_data: { username: c.username, color: pd.color, x: 0, y: 1.7, z: 0, rotY: 0, hp: 100 },
        }, ws);
        break;
      }

      case 'leave_lobby': {
        removePFromLobby(ws);
        sendTo(ws, { type: 'left_lobby' });
        break;
      }

      case 'update': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby) break;
        const pd = lobby.players.get(ws);
        if (!pd) break;
        if (msg.state) {
          Object.assign(pd, {
            x: msg.state.x ?? pd.x, y: msg.state.y ?? pd.y, z: msg.state.z ?? pd.z,
            rotY: msg.state.rotY ?? pd.rotY, color: msg.state.color ?? pd.color,
            hp: msg.state.hp ?? pd.hp,
          });
          // Inject server-authoritative stats into the pass-through array so other clients display them natively
          msg.state.kills = pd.kills || 0;
          msg.state.deaths = pd.deaths || 0;
          msg.state.username = pd.username || c.username || 'Player';
        }
        broadcast(c.lobbyId, { type: 'update', player_id: c.playerId, state: msg.state }, ws);
        break;
      }

      case 'player_damage': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby) break;
        for (const [tws, tpd] of lobby.players) {
          if (String(tpd.playerId) === String(msg.target_id) && tws !== ws) {
            sendTo(tws, { type: 'player_damage', attacker_id: c.playerId, attacker_name: c.username, dmg: msg.dmg, headshot: msg.headshot });
            break;
          }
        }
        break;
      }

      case 'player_killed': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby) break;

        if (msg.attacker_id) {
          for (const [, tpd] of lobby.players) {
            if (String(tpd.playerId) === String(msg.attacker_id)) {
              tpd.kills = (tpd.kills || 0) + 1;
              break;
            }
          }
        }

        for (const [tws, tpd] of lobby.players) {
          if (String(tpd.playerId) === String(msg.victim_id)) {
            tpd.deaths = (tpd.deaths || 0) + 1;
            break;
          }
        }

        if (msg.attacker_id) {
          let killerName = msg.attacker_name || 'Unknown';
          for (const [, tpd] of lobby.players) {
            if (String(tpd.playerId) === String(msg.attacker_id)) {
              killerName = tpd.username || killerName;
              break;
            }
          }
          broadcastAll(c.lobbyId, {
            type: 'kill_feed',
            killer: killerName, killer_id: msg.attacker_id,
            victim: msg.victim_name || 'Player', victim_id: msg.victim_id,
            headshot: msg.headshot || false,
          });
        }

        broadcastAll(c.lobbyId, { type: 'player_died', victim_id: msg.victim_id });
        break;
      }

      case 'kick_player': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby || lobby.ownerId !== c.playerId) break;
        for (const [tws, tpd] of lobby.players) {
          if (tpd.playerId === msg.target_id) {
            sendTo(tws, { type: 'kicked' });
            const tc = clients.get(tws);
            if (tc) { lobby.players.delete(tws); tc.lobbyId = null; }
            broadcast(c.lobbyId, { type: 'player_leave', player_id: msg.target_id });
            break;
          }
        }
        break;
      }

      case 'ban_player': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby || lobby.ownerId !== c.playerId) break;
        lobby.bannedIds.add(msg.target_id);
        for (const [tws, tpd] of lobby.players) {
          if (tpd.playerId === msg.target_id) {
            sendTo(tws, { type: 'banned', lobby_id: c.lobbyId });
            const tc = clients.get(tws);
            if (tc) { lobby.players.delete(tws); tc.lobbyId = null; }
            broadcast(c.lobbyId, { type: 'player_leave', player_id: msg.target_id });
            break;
          }
        }
        break;
      }

      case 'transfer_owner': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby || lobby.ownerId !== c.playerId) break;
        for (const [, tpd] of lobby.players) {
          if (tpd.playerId === msg.target_id) {
            lobby.ownerId = msg.target_id;
            broadcastAll(c.lobbyId, { type: 'owner_changed', owner_id: msg.target_id, owner_name: tpd.username });
            break;
          }
        }
        break;
      }

      case 'toggle_bots': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby || lobby.ownerId !== c.playerId) break;
        lobby.settings.botsEnabled = !!msg.enabled;
        broadcastAll(c.lobbyId, { type: 'lobby_settings', settings: lobby.settings, owner_id: lobby.ownerId });
        break;
      }

      case 'toggle_cheats': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby || lobby.ownerId !== c.playerId) break;
        lobby.settings.cheatsAllowed = !!msg.enabled;
        broadcastAll(c.lobbyId, { type: 'lobby_settings', settings: lobby.settings, owner_id: lobby.ownerId });
        break;
      }

      case 'pong': {
        if (!c.lobbyId) break;
        const lobby = lobbies.get(c.lobbyId);
        if (!lobby) break;
        const pd = lobby.players.get(ws);
        if (pd && msg.t) pd.ping = Math.round((Date.now() - msg.t) / 2);
        break;
      }

      case 'player_shot': {
        if (!c.lobbyId) break;
        broadcast(c.lobbyId, { type: 'player_shot', player_id: c.playerId }, ws);
        break;
      }

      case 'player_respawned': {
        if (!c.lobbyId) break;
        broadcastAll(c.lobbyId, { type: 'player_respawned', player_id: c.playerId });
        break;
      }
    }
  });

  ws.on('close', () => {
    removePFromLobby(ws);
    clients.delete(ws);
  });
});

// Ping loop — every 3 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ws, c] of clients) {
    if (c.lobbyId && ws.readyState === 1) {
      sendTo(ws, { type: 'ping', t: now });
    }
  }
}, 3000);

// Scoreboard broadcast — every 2 seconds
setInterval(() => {
  for (const [lobbyId, lobby] of lobbies) {
    const rows = getScoreboardForLobby(lobbyId);
    const msg = JSON.stringify({ type: 'scoreboard', rows, owner_id: lobby.ownerId });
    for (const [ws] of lobby.players) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}, 2000);

server.listen(PORT, () => {
  console.log(`\n  WARZONE server running at http://localhost:${PORT}\n`);
});
