/*
 * shared.js — constantes, mapa y colisiones compartidos entre servidor y cliente.
 * Se carga igual en Node (require) y en el navegador (window.Shared).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 32;

  // Mitad izquierda del mapa (18 columnas). La derecha es el espejo exacto,
  // así el mapa es 100% justo para los dos jugadores.
  //   #  pared      .  piso       d  escritorio   p  planta
  //   c  archivero  w  garrafón   1  casillero del jugador 1 (se espeja a 2)
  const LEFT = [
    '##################', // 0
    '#.......#........p', // 1
    '#.dd.dd.#.dd.dd...', // 2
    '#.......#.........', // 3
    '#.dd.dd.#.dd.dd...', // 4
    '#.......#.........', // 5
    '#.c...c.#.c.....c.', // 6
    '###..######..####.', // 7  (puertas)
    '#p................', // 8
    '#....w............', // 9
    '#11.............dd', // 10
    '#11.............dd', // 11
    '#....w............', // 12
    '#p................', // 13
    '###..######..####.', // 14 (puertas)
    '#.c...c.#.c.....c.', // 15
    '#.......#.........', // 16
    '#.dd.dd.#.dd.dd...', // 17
    '#.......#.........', // 18
    '#.dd.dd.#.dd.dd...', // 19
    '#.......#........p', // 20
    '##################'  // 21
  ];

  const HALF = 18;
  const COLS = HALF * 2;
  const ROWS = LEFT.length;
  const W = COLS * TILE;
  const H = ROWS * TILE;

  const GRID = LEFT.map(function (row) {
    const left = row.split('');
    const right = left.slice().reverse().map(function (c) {
      return c === '1' ? '2' : c;
    });
    return left.concat(right);
  });

  const SOLID = { '#': 1, d: 1, p: 1, c: 1, w: 1, '1': 1, '2': 1 };

  // Constantes de juego
  const SPEED = 160;          // px por segundo
  const PLAYER_HALF = 10;     // medio lado de la caja de colisión del jugador
  const CAPACITY = 5;         // solicitudes que se pueden cargar a la vez
  const PICKUP_R = 22;        // radio para recoger una solicitud
  const DEPOSIT_R = 72;       // radio alrededor del casillero para entregar
  const TARGET_PAPERS = 14;   // solicitudes en el mapa (siempre par: se crean en parejas espejo)
  const GAME_SECONDS = 120;

  const LOCKER = [
    { x: 2 * TILE, y: 11 * TILE },       // jugador 0 (izquierda, azul)
    { x: W - 2 * TILE, y: 11 * TILE }    // jugador 1 (derecha, naranja)
  ];
  const SPAWN = [
    { x: 4.5 * TILE, y: 11 * TILE },
    { x: W - 4.5 * TILE, y: 11 * TILE }
  ];

  function isSolidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
    return SOLID[GRID[ty][tx]] === 1;
  }

  // ¿La caja del jugador centrada en (x, y) choca con algo?
  function collides(x, y) {
    const x0 = Math.floor((x - PLAYER_HALF) / TILE);
    const x1 = Math.floor((x + PLAYER_HALF - 0.001) / TILE);
    const y0 = Math.floor((y - PLAYER_HALF) / TILE);
    const y1 = Math.floor((y + PLAYER_HALF - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (isSolidTile(tx, ty)) return true;
      }
    }
    return false;
  }

  // Mueve con colisiones por ejes separados (permite "resbalar" por las paredes).
  function move(x, y, dx, dy) {
    let nx = x + dx;
    if (collides(nx, y)) nx = x;
    let ny = y + dy;
    if (collides(nx, ny)) ny = y;
    return { x: nx, y: ny };
  }

  // Casillas de piso alcanzables desde el punto de aparición (BFS).
  function reachableFloor() {
    const sx = Math.floor(SPAWN[0].x / TILE);
    const sy = Math.floor(SPAWN[0].y / TILE);
    const seen = {};
    const out = [];
    const q = [[sx, sy]];
    seen[sx + ',' + sy] = true;
    while (q.length) {
      const cur = q.shift();
      out.push(cur);
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let i = 0; i < 4; i++) {
        const nx = cur[0] + dirs[i][0];
        const ny = cur[1] + dirs[i][1];
        const key = nx + ',' + ny;
        if (seen[key] || isSolidTile(nx, ny)) continue;
        seen[key] = true;
        q.push([nx, ny]);
      }
    }
    return out;
  }

  // Lugares donde pueden aparecer solicitudes: mitad izquierda, lejos del casillero.
  const PAPER_SPOTS = reachableFloor().filter(function (t) {
    const cx = t[0] * TILE + TILE / 2;
    const cy = t[1] * TILE + TILE / 2;
    const dx = cx - LOCKER[0].x;
    const dy = cy - LOCKER[0].y;
    return t[0] >= 1 && t[0] < HALF && Math.sqrt(dx * dx + dy * dy) > 130;
  });

  return {
    TILE: TILE, COLS: COLS, ROWS: ROWS, W: W, H: H, HALF: HALF, GRID: GRID,
    SPEED: SPEED, PLAYER_HALF: PLAYER_HALF, CAPACITY: CAPACITY,
    PICKUP_R: PICKUP_R, DEPOSIT_R: DEPOSIT_R, TARGET_PAPERS: TARGET_PAPERS,
    GAME_SECONDS: GAME_SECONDS, LOCKER: LOCKER, SPAWN: SPAWN,
    isSolidTile: isSolidTile, collides: collides, move: move,
    reachableFloor: reachableFloor, PAPER_SPOTS: PAPER_SPOTS
  };
});
