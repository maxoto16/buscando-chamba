'use strict';
/*
 * Buscando Chamba — servidor de juego (HTTP estático + WebSocket).
 *
 * El servidor es la autoridad de las reglas: decide quién recogió cada
 * solicitud, quién entregó en su casillero, el tiempo y el ganador.
 * Los clientes sólo envían su posición (validada por velocidad y colisiones).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Shared = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const GAME_SECONDS = Number(process.env.GAME_SECONDS) || Shared.GAME_SECONDS;
const COUNTDOWN_SECONDS = Number(process.env.COUNTDOWN_SECONDS) || 3;
const TICK_MS = 25;            // 40 ticks por segundo
const BROADCAST_EVERY = 2;     // estado a 20 Hz
const MAX_ROOMS = 500;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

// ---------------------------------------------------------------- HTTP
const server = http.createServer(function (req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('No encontrado'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------- Salas
const rooms = new Map();

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function cleanName(raw, fallback) {
  const s = String(raw || '').replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 12);
  return s || fallback;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj) {
  room.players.forEach(function (p) { if (p) send(p.ws, obj); });
}

function newPlayer(ws, name, idx) {
  const s = Shared.SPAWN[idx];
  return {
    ws: ws, name: name, idx: idx, x: s.x, y: s.y, dir: 'down', mv: false,
    carry: 0, score: 0, lastPosAt: Date.now(), fullCd: 0
  };
}

function sendRoom(room) {
  room.players.forEach(function (p, i) {
    if (!p) return;
    send(p.ws, {
      t: 'room', code: room.code, you: i, status: room.status,
      names: room.players.map(function (q) { return q ? q.name : null; }),
      seconds: GAME_SECONDS
    });
  });
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// Crea una pareja de solicitudes espejo (una para cada lado) para que sea justo.
function spawnPair(room) {
  const spots = Shared.PAPER_SPOTS;
  for (let attempt = 0; attempt < 40; attempt++) {
    const t = spots[Math.floor(Math.random() * spots.length)];
    const x = t[0] * Shared.TILE + Shared.TILE / 2 + (Math.random() * 12 - 6);
    const y = t[1] * Shared.TILE + Shared.TILE / 2 + (Math.random() * 12 - 6);
    const mx = Shared.W - x;
    const tooClose = room.papers.some(function (p) {
      return dist(p.x, p.y, x, y) < 56 || dist(p.x, p.y, mx, y) < 56;
    });
    if (tooClose) continue;
    const rot = Math.round((Math.random() * 60 - 30));
    room.papers.push({ id: room.nextId++, x: Math.round(x), y: Math.round(y), rot: rot });
    room.papers.push({ id: room.nextId++, x: Math.round(mx), y: Math.round(y), rot: -rot });
    return true;
  }
  return false;
}

function resetGame(room) {
  room.status = 'countdown';
  room.countdown = COUNTDOWN_SECONDS;
  room.timeLeft = GAME_SECONDS;
  room.papers = [];
  room.nextId = 1;
  room.spawnCd = 0;
  room.rematch = [false, false];
  room.players.forEach(function (p, i) {
    if (!p) return;
    const s = Shared.SPAWN[i];
    p.x = s.x; p.y = s.y; p.dir = 'down'; p.mv = false;
    p.carry = 0; p.score = 0; p.fullCd = 0; p.lastPosAt = Date.now();
  });
  for (let i = 0; i < Shared.TARGET_PAPERS / 2; i++) spawnPair(room);
  sendRoom(room);
}

function endGame(room, reason, forcedWinner) {
  if (room.status === 'ended') return;
  room.status = 'ended';
  const s0 = room.players[0] ? room.players[0].score : 0;
  const s1 = room.players[1] ? room.players[1].score : 0;
  let winner = s0 > s1 ? 0 : s1 > s0 ? 1 : -1;
  if (typeof forcedWinner === 'number') winner = forcedWinner;
  broadcastState(room);
  broadcast(room, { t: 'end', scores: [s0, s1], winner: winner, reason: reason });
}

function broadcastState(room) {
  const msg = {
    t: 'state',
    st: room.status,
    tl: Math.max(0, Math.round(room.timeLeft * 10) / 10),
    cd: Math.max(0, Math.round(room.countdown * 10) / 10),
    p: room.players.map(function (p) {
      return p ? {
        x: Math.round(p.x), y: Math.round(p.y), d: p.dir, m: p.mv ? 1 : 0,
        c: p.carry, s: p.score
      } : null;
    }),
    q: room.papers.map(function (p) { return [p.id, p.x, p.y, p.rot]; })
  };
  broadcast(room, msg);
}

function tickRoom(room, dt) {
  if (room.status === 'countdown') {
    room.countdown -= dt;
    if (room.countdown <= 0) {
      room.countdown = 0;
      room.status = 'playing';
      broadcast(room, { t: 'go' });
    }
    return;
  }
  if (room.status !== 'playing') return;

  room.timeLeft -= dt;

  // Reposición de solicitudes
  room.spawnCd -= dt;
  if (room.spawnCd <= 0) {
    room.spawnCd = 0.8;
    if (room.papers.length <= Shared.TARGET_PAPERS - 2) spawnPair(room);
  }

  room.players.forEach(function (p) {
    if (!p) return;
    p.fullCd = Math.max(0, p.fullCd - dt);

    // Recoger
    for (let i = room.papers.length - 1; i >= 0; i--) {
      const paper = room.papers[i];
      if (dist(p.x, p.y, paper.x, paper.y) > Shared.PICKUP_R) continue;
      if (p.carry < Shared.CAPACITY) {
        p.carry++;
        room.papers.splice(i, 1);
        broadcast(room, { t: 'ev', k: 'pickup', p: p.idx, x: paper.x, y: paper.y, c: p.carry });
      } else if (p.fullCd <= 0) {
        p.fullCd = 1.2;
        send(p.ws, { t: 'ev', k: 'full', p: p.idx });
      }
    }

    // Entregar en el casillero propio
    const lk = Shared.LOCKER[p.idx];
    if (p.carry > 0 && dist(p.x, p.y, lk.x, lk.y) <= Shared.DEPOSIT_R) {
      const n = p.carry;
      p.score += n;
      p.carry = 0;
      broadcast(room, { t: 'ev', k: 'deposit', p: p.idx, n: n, s: p.score });
    }
  });

  if (room.timeLeft <= 0) {
    room.timeLeft = 0;
    endGame(room, 'time');
  }
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const idx = room.players.findIndex(function (p) { return p && p.ws === ws; });
  if (idx === -1) return;
  const other = room.players[1 - idx];
  room.players[idx] = null;
  if (other) {
    // Si se iba en plena partida, el que se queda gana por abandono.
    if (room.status === 'playing') endGame(room, 'left', 1 - idx);
    else send(other.ws, { t: 'left' });
    other.ws.room = null;
  }
  rooms.delete(room.code);
}

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ server: server, path: '/ws', maxPayload: 2048 });

function handleMessage(ws, msg) {
  switch (msg.t) {
    case 'create': {
      if (ws.room) leaveRoom(ws);
      if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', code: 'BUSY', msg: 'El servidor está lleno. Intenta en un momento.' }); return; }
      const code = makeCode();
      if (!code) { send(ws, { t: 'error', code: 'BUSY', msg: 'No se pudo crear la sala. Intenta de nuevo.' }); return; }
      const room = {
        code: code, players: [null, null], status: 'waiting', countdown: 0,
        timeLeft: GAME_SECONDS, papers: [], nextId: 1, spawnCd: 0, rematch: [false, false]
      };
      room.players[0] = newPlayer(ws, cleanName(msg.name, 'Jugador 1'), 0);
      rooms.set(code, room);
      ws.room = room;
      sendRoom(room);
      return;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (ws.room) leaveRoom(ws);
      const room = rooms.get(code);
      if (!room) { send(ws, { t: 'error', code: 'NOT_FOUND', msg: 'No existe una sala con ese código.' }); return; }
      if (room.players[1] || room.status !== 'waiting') {
        send(ws, { t: 'error', code: room.status === 'waiting' ? 'FULL' : 'STARTED', msg: 'Esa sala ya está llena.' });
        return;
      }
      room.players[1] = newPlayer(ws, cleanName(msg.name, 'Jugador 2'), 1);
      ws.room = room;
      resetGame(room);
      return;
    }
    case 'pos': {
      const room = ws.room;
      if (!room || room.status !== 'playing') return;
      const p = room.players.find(function (q) { return q && q.ws === ws; });
      if (!p) return;
      const x = Number(msg.x), y = Number(msg.y);
      if (!isFinite(x) || !isFinite(y)) return;
      const now = Date.now();
      const dt = Math.min(0.5, Math.max(0.05, (now - p.lastPosAt) / 1000));
      const allowed = Shared.SPEED * dt * 1.35 + 4;
      if (dist(x, y, p.x, p.y) > allowed || Shared.collides(x, y)) {
        send(ws, { t: 'fix', x: p.x, y: p.y });
        return;
      }
      p.x = x; p.y = y; p.lastPosAt = now;
      p.dir = ['up', 'down', 'left', 'right'].indexOf(msg.d) >= 0 ? msg.d : p.dir;
      p.mv = !!msg.m;
      return;
    }
    case 'rematch': {
      const room = ws.room;
      if (!room || room.status !== 'ended' || !room.players[0] || !room.players[1]) return;
      const i = room.players.findIndex(function (q) { return q && q.ws === ws; });
      if (i === -1) return;
      room.rematch[i] = true;
      broadcast(room, { t: 'rematch', flags: room.rematch });
      if (room.rematch[0] && room.rematch[1]) resetGame(room);
      return;
    }
    case 'leave':
      leaveRoom(ws);
      return;
    case 'ping':
      send(ws, { t: 'pong', ts: msg.ts });
      return;
  }
}

wss.on('connection', function (ws) {
  ws.isAlive = true;
  ws.room = null;
  ws.on('pong', function () { ws.isAlive = true; });
  ws.on('message', function (data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handleMessage(ws, msg); } catch (e) { console.error('Error en mensaje', e); }
  });
  ws.on('close', function () { leaveRoom(ws); });
  ws.on('error', function () { /* se limpia en 'close' */ });
});

// Mantiene vivas las conexiones (proxies suelen cortar las inactivas) y limpia las muertas.
setInterval(function () {
  wss.clients.forEach(function (ws) {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignorar */ }
  });
}, 25000);

// Bucle principal del juego
let tickCount = 0;
let lastTick = Date.now();
setInterval(function () {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  tickCount++;
  rooms.forEach(function (room) {
    tickRoom(room, dt);
    if (tickCount % BROADCAST_EVERY === 0 && (room.status === 'countdown' || room.status === 'playing')) {
      broadcastState(room);
    }
  });
}, TICK_MS);

server.listen(PORT, function () {
  console.log('Buscando Chamba escuchando en http://localhost:' + PORT);
});

module.exports = { server: server, rooms: rooms };
