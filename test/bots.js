'use strict';
// Prueba de integración: levanta el servidor y juega con dos bots por WebSocket.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const Shared = require('../public/shared.js');

const PORT = 3111;
const URL = 'ws://localhost:' + PORT + '/ws';
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? '  OK   ' : '  FALLA') + ' ' + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bot {
  constructor(name) {
    this.name = name; this.msgs = []; this.state = null; this.idx = -1;
    this.x = 0; this.y = 0; this.events = []; this.waiters = [];
  }
  connect() {
    return new Promise((res) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res);
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        this.msgs.push(m);
        if (m.t === 'state') this.state = m;
        if (m.t === 'room') { this.idx = m.you; const s = Shared.SPAWN[m.you]; this.x = s.x; this.y = s.y; }
        if (m.t === 'ev') this.events.push(m);
        if (m.t === 'fix') { this.x = m.x; this.y = m.y; }
        this.waiters = this.waiters.filter((w) => { if (w.f(m)) { w.r(m); return false; } return true; });
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  waitFor(f, ms = 8000) {
    const hit = this.msgs.find(f);
    if (hit) return Promise.resolve(hit);
    return new Promise((r, j) => {
      const w = { f, r };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); j(new Error('timeout esperando mensaje')); }, ms);
    });
  }
  clear() { this.msgs = []; this.events = []; }
  // camino por casillas (BFS) hasta un punto
  path(tx, ty) {
    const sx = Math.floor(this.x / Shared.TILE), sy = Math.floor(this.y / Shared.TILE);
    const prev = {}; const q = [[sx, sy]]; prev[sx + ',' + sy] = null;
    while (q.length) {
      const [cx, cy] = q.shift();
      if (cx === tx && cy === ty) break;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
        if (k in prev || Shared.isSolidTile(nx, ny)) continue;
        prev[k] = [cx, cy]; q.push([nx, ny]);
      }
    }
    const out = []; let cur = [tx, ty];
    while (cur) { out.push(cur); cur = prev[cur[0] + ',' + cur[1]]; }
    return out.reverse().map(([x, y]) => ({ x: x * Shared.TILE + 16, y: y * Shared.TILE + 16 }));
  }
  async walkTo(px, py, speed = 150) {
    const tx = Math.floor(px / Shared.TILE), ty = Math.floor(py / Shared.TILE);
    const pts = this.path(tx, ty); pts.push({ x: px, y: py });
    for (const p of pts) {
      let guard = 0;
      while (Math.hypot(p.x - this.x, p.y - this.y) > 1 && guard++ < 400) {
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        const step = Math.min(d, speed * 0.05);
        const nx = this.x + (p.x - this.x) / d * step, ny = this.y + (p.y - this.y) / d * step;
        const r = Shared.move(this.x, this.y, nx - this.x, ny - this.y);
        this.x = r.x; this.y = r.y;
        this.send({ t: 'pos', x: this.x, y: this.y, d: 'right', m: 1 });
        await sleep(50);
      }
    }
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), GAME_SECONDS: '35', COUNTDOWN_SECONDS: '1' }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((r) => srv.stdout.on('data', r));

  try {
    console.log('1) Crear y unirse a sala');
    const A = new Bot('Ana'), B = new Bot('Beto');
    await A.connect(); await B.connect();
    A.send({ t: 'create', name: 'Ana' });
    const roomA = await A.waitFor((m) => m.t === 'room');
    check('código de 5 caracteres', /^[A-Z2-9]{5}$/.test(roomA.code), roomA.code);
    check('creador es jugador 0 y está esperando', roomA.you === 0 && roomA.status === 'waiting');

    B.send({ t: 'join', code: 'ZZZZZ', name: 'Beto' });
    const err = await B.waitFor((m) => m.t === 'error');
    check('código inexistente da error NOT_FOUND', err.code === 'NOT_FOUND');

    B.clear();
    B.send({ t: 'join', code: roomA.code.toLowerCase(), name: 'Beto' });
    const roomB = await B.waitFor((m) => m.t === 'room');
    check('unirse con código (minúsculas ok) como jugador 1', roomB.you === 1 && roomB.names[0] === 'Ana' && roomB.names[1] === 'Beto');
    await A.waitFor((m) => m.t === 'room' && m.names[1] === 'Beto');
    check('el creador se entera del rival', true);

    const C = new Bot('Tercero'); await C.connect();
    C.send({ t: 'join', code: roomA.code, name: 'C' });
    const errFull = await C.waitFor((m) => m.t === 'error');
    check('tercer jugador rechazado (sala llena)', errFull.code === 'STARTED' || errFull.code === 'FULL', errFull.code);
    C.close();

    console.log('2) Cuenta regresiva y arranque');
    await A.waitFor((m) => m.t === 'go');
    await B.waitFor((m) => m.t === 'go');
    check('ambos reciben "go"', true);
    await sleep(120);
    check('hay 14 solicitudes en el mapa', A.state && A.state.q.length === 14, A.state && A.state.q.length);
    const xs = A.state.q.map((q) => q[1]).sort((a, b) => a - b);
    let mirrored = true;
    for (let i = 0; i < 7; i++) if (Math.abs((Shared.W - xs[13 - i]) - xs[i]) > 1) mirrored = false;
    check('las solicitudes aparecen en pares espejo (justo)', mirrored);

    console.log('3) Anti-trampa');
    A.send({ t: 'pos', x: 900, y: 100, d: 'up', m: 1 });
    const fix = await A.waitFor((m) => m.t === 'fix');
    check('teletransporte rechazado con "fix"', Math.hypot(fix.x - Shared.SPAWN[0].x, fix.y - Shared.SPAWN[0].y) < 2);
    A.clear();
    A.send({ t: 'pos', x: 70, y: 352, d: 'left', m: 1 }); // dentro del casillero (sólido)
    await sleep(150);
    check('posición dentro de pared rechazada', A.msgs.some((m) => m.t === 'fix'));

    console.log('4) Recoger y entregar (Ana)');
    A.clear(); B.clear();
    // Ana va por las solicitudes más cercanas a su casillero (lado izquierdo)
    for (let round = 0; round < 2; round++) {
      const mine = A.state.q.filter((q) => q[1] < Shared.W / 2)
        .sort((a, b) => Math.hypot(a[1] - A.x, a[2] - A.y) - Math.hypot(b[1] - A.x, b[2] - A.y));
      if (!mine.length) break;
      await A.walkTo(mine[0][1], mine[0][2]);
      await sleep(120);
    }
    console.log('     (tiempo restante al volver a recoger: ' + A.state.tl + 's)');
    const picked = A.events.filter((e) => e.k === 'pickup' && e.p === 0).length;
    check('Ana recogió solicitudes', picked >= 2, picked + ' recogidas');
    check('Beto también ve los eventos de pickup', B.events.some((e) => e.k === 'pickup' && e.p === 0));
    const carryNow = A.state.p[0].c;
    check('mochila refleja lo recogido', carryNow === picked, 'carry=' + carryNow);
    await A.walkTo(110, 352);
    await sleep(150);
    const dep = A.events.find((e) => e.k === 'deposit' && e.p === 0);
    check('entrega en casillero suma al marcador', dep && dep.n === picked && A.state.p[0].s === picked, dep && ('+' + dep.n));
    check('mochila vacía tras entregar', A.state.p[0].c === 0);

    console.log('5) Fin de partida por tiempo');
    const end = await A.waitFor((m) => m.t === 'end', 40000);
    check('gana Ana (más solicitudes)', end.winner === 0 && end.reason === 'time', JSON.stringify(end.scores));
    await B.waitFor((m) => m.t === 'end');

    console.log('6) Revancha');
    A.clear(); B.clear();
    A.send({ t: 'rematch' });
    await B.waitFor((m) => m.t === 'rematch' && m.flags[0] === true);
    check('rival ve que Ana pidió revancha', true);
    B.send({ t: 'rematch' });
    const again = await A.waitFor((m) => m.t === 'room' && m.status === 'countdown');
    check('con los dos de acuerdo, reinicia con cuenta regresiva', !!again);
    await A.waitFor((m) => m.t === 'go');
    await sleep(100);
    check('marcadores reiniciados', A.state.p[0].s === 0 && A.state.p[1].s === 0);

    console.log('7) Abandono en plena partida');
    A.clear();
    B.close();
    const endLeft = await A.waitFor((m) => m.t === 'end');
    check('Ana gana por abandono', endLeft.winner === 0 && endLeft.reason === 'left');
    A.close();

    console.log('8) Sala de espera cancelada');
    const D = new Bot('D'), E = new Bot('E');
    await D.connect(); await E.connect();
    D.send({ t: 'create', name: 'D' });
    const rd = await D.waitFor((m) => m.t === 'room');
    D.close();
    await sleep(150);
    E.send({ t: 'join', code: rd.code, name: 'E' });
    const e2 = await E.waitFor((m) => m.t === 'error');
    check('sala se elimina si el creador se va', e2.code === 'NOT_FOUND');
    E.close();
  } catch (e) {
    console.log('  FALLA excepción:', e.message);
    failures++;
  }
  srv.kill();
  console.log(failures === 0 ? '\nTODO OK' : '\n' + failures + ' FALLA(S)');
  process.exit(failures === 0 ? 0 : 1);
})();
