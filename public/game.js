/* Buscando Chamba — cliente del juego */
(function () {
  'use strict';

  var S = window.Shared;
  var T = S.TILE, W = S.W, H = S.H, GRID = S.GRID, TAU = Math.PI * 2;
  var $ = function (id) { return document.getElementById(id); };

  // Colores / aspecto de cada jugador (0 = azul, izquierda; 1 = naranja, derecha)
  var PCOL = [
    { main: '#3b82f6', dark: '#1d4ed8', light: '#93c5fd', tie: '#ef4444', hair: '#2b1d14', pants: '#27324a', skin: '#f1c9a5', long: false },
    { main: '#f97316', dark: '#c2410c', light: '#fdba74', tie: '#1f2937', hair: '#8a5a1f', pants: '#3a2f2a', skin: '#e9b894', long: true }
  ];

  /* ====================================================================
   *  Estado
   * ==================================================================== */
  var G = {
    screen: 'menu', you: -1, code: '', names: ['', ''], status: 'waiting',
    tl: S.GAME_SECONDS, cd: 3, total: S.GAME_SECONDS,
    sp: [null, null], papers: [],
    me: { x: 0, y: 0, dir: 'down', mv: false, phase: 0 },
    opp: { x: 0, y: 0, dir: 'down', mv: false, phase: 0 },
    carry: [0, 0], score: [0, 0],
    fx: [], texts: [], pulse: [0, 0],
    ended: false, result: null, rematchSent: false,
    cam: { x: 0, y: 0 }, lastCd: -1, prevSt: ''
  };
  var view = { zoom: 1, k: 1, w: W, h: H };
  var canvas = $('cv'), ctx = canvas.getContext('2d');
  var staticCv = null, staticK = 0;
  var bannerT = null, resultsT = null, toastT = null;

  /* ====================================================================
   *  Utilidades de UI
   * ==================================================================== */
  function showScreen(name) {
    G.screen = name;
    $('screen-menu').hidden = name !== 'menu';
    $('screen-wait').hidden = name !== 'wait';
    $('screen-game').hidden = name !== 'game';
    if (name === 'game') requestAnimationFrame(layout);
  }

  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function setMenuMsg(text, isError) {
    var el = $('menu-msg');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.className = 'msg' + (isError ? ' error' : '');
    el.hidden = false;
  }

  function showBanner(text, cls, ms) {
    var b = $('banner');
    b.className = 'banner ' + (cls || '');
    b.textContent = text; b.hidden = false;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(bannerT);
    if (ms) bannerT = setTimeout(function () { b.hidden = true; }, ms);
  }
  function hideBanner() { clearTimeout(bannerT); $('banner').hidden = true; }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* nada */ }
    ta.remove();
    return ok;
  }

  function fmtTime(sec) {
    var s = Math.max(0, Math.ceil(sec));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /* ====================================================================
   *  Sonido (WebAudio, sin archivos)
   * ==================================================================== */
  var Snd = (function () {
    var ac = null;
    var muted = false;
    try { muted = localStorage.getItem('bc_muted') === '1'; } catch (e) { /* nada */ }
    function init() {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { try { ac = new AC(); } catch (e) { ac = null; } }
      }
      if (ac && ac.state === 'suspended') ac.resume();
    }
    function tone(f, d, type, v, delay, f2) {
      if (!ac || muted) return;
      var t = ac.currentTime + (delay || 0);
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v || 0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + d + 0.03);
    }
    return {
      init: init,
      isMuted: function () { return muted; },
      toggle: function () {
        muted = !muted;
        try { localStorage.setItem('bc_muted', muted ? '1' : '0'); } catch (e) { /* nada */ }
        return muted;
      },
      pickup: function (n) { tone(520 + n * 70, 0.09, 'square', 0.05, 0, 800 + n * 70); },
      soft: function () { tone(300, 0.06, 'triangle', 0.02); },
      deposit: function (n) {
        for (var i = 0; i < Math.min(n, 5); i++) tone(520 + i * 110, 0.12, 'triangle', 0.08, i * 0.07);
        tone(1046, 0.28, 'sine', 0.06, Math.min(n, 5) * 0.07);
      },
      depositSoft: function () { tone(420, 0.16, 'triangle', 0.03); },
      full: function () { tone(150, 0.25, 'sawtooth', 0.05, 0, 90); },
      tick: function () { tone(660, 0.12, 'sine', 0.08); },
      go: function () { tone(880, 0.4, 'square', 0.06, 0, 1320); },
      win: function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.09, i * 0.12); }); },
      lose: function () { [392, 330, 262].forEach(function (f, i) { tone(f, 0.3, 'triangle', 0.08, i * 0.16); }); }
    };
  })();

  /* ====================================================================
   *  Red
   * ==================================================================== */
  var ws = null, wsReady = null, pingTimer = null;

  function ensureSocket() {
    if (ws && ws.readyState === 1) return Promise.resolve();
    if (wsReady) return wsReady;
    wsReady = new Promise(function (resolve, reject) {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var sock = new WebSocket(proto + '//' + location.host + '/ws');
      var timer = setTimeout(function () { try { sock.close(); } catch (e) { /* nada */ } reject(new Error('timeout')); }, 45000);
      sock.onopen = function () { clearTimeout(timer); ws = sock; startPing(); resolve(); };
      sock.onmessage = onMessage;
      sock.onclose = function () {
        clearTimeout(timer);
        var wasOpen = ws === sock;
        if (wasOpen) ws = null;
        wsReady = null;
        stopPing();
        if (wasOpen) onDisconnect();
        reject(new Error('closed'));
      };
      sock.onerror = function () { /* se maneja en onclose */ };
    });
    wsReady.catch(function () { /* evita "unhandled rejection" */ });
    return wsReady;
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(function () { send({ t: 'ping', ts: performance.now() }); }, 2500);
  }
  function stopPing() { clearInterval(pingTimer); pingTimer = null; }

  function onDisconnect() {
    if (G.screen !== 'menu') {
      toast('Se perdió la conexión con el servidor');
      resetToMenu();
    }
  }

  function onMessage(ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    switch (m.t) {
      case 'room': onRoom(m); break;
      case 'state': onState(m); break;
      case 'ev': onEvent(m); break;
      case 'fix': G.me.x = m.x; G.me.y = m.y; break;
      case 'end': onEnd(m); break;
      case 'rematch': onRematch(m); break;
      case 'left': onLeft(); break;
      case 'error': setMenuMsg(m.msg || 'Ocurrió un error.', true); setBusy(false); break;
      case 'pong': $('ping').textContent = Math.round(performance.now() - m.ts) + ' ms'; break;
    }
  }

  /* ====================================================================
   *  Mensajes del servidor
   * ==================================================================== */
  function onRoom(m) {
    G.you = m.you; G.code = m.code;
    G.names = [m.names[0] || '', m.names[1] || ''];
    G.status = m.status; G.total = m.seconds || S.GAME_SECONDS;
    setBusy(false); setMenuMsg('');
    if (m.status === 'waiting') {
      $('code-big').textContent = m.code;
      $('wait-n0').textContent = G.names[0] || 'Tú';
      showScreen('wait');
    } else {
      startMatch();
    }
  }

  function startMatch() {
    clearTimeout(resultsT);
    $('results').hidden = true;
    hideBanner();
    G.ended = false; G.result = null; G.rematchSent = false;
    G.papers = []; G.fx = []; G.texts = [];
    G.carry = [0, 0]; G.score = [0, 0]; G.pulse = [0, 0];
    G.lastCd = -1; G.prevSt = 'countdown';
    var you = G.you, other = 1 - G.you;
    G.me = { x: S.SPAWN[you].x, y: S.SPAWN[you].y, dir: you === 0 ? 'right' : 'left', mv: false, phase: 0 };
    G.opp = { x: S.SPAWN[other].x, y: S.SPAWN[other].y, dir: other === 0 ? 'right' : 'left', mv: false, phase: 0 };
    G.sp = [null, null];
    G.cam.x = 0; G.cam.y = 0;
    $('hud-n0').textContent = G.names[0] || '—';
    $('hud-n1').textContent = G.names[1] || '—';
    updateHud();
    showScreen('game');
  }

  function onState(m) {
    if (G.screen !== 'game') return;
    G.status = m.st; G.tl = m.tl; G.cd = m.cd; G.papers = m.q;
    for (var i = 0; i < 2; i++) {
      var p = m.p[i];
      G.sp[i] = p;
      if (p) { G.carry[i] = p.c; G.score[i] = p.s; }
    }
    // Cuenta regresiva / arranque
    if (m.st === 'countdown') {
      var n = Math.ceil(m.cd);
      if (n !== G.lastCd && n > 0) { G.lastCd = n; showBanner(String(n)); Snd.tick(); }
    } else if (m.st === 'playing' && G.prevSt === 'countdown') {
      showBanner('¡YA!', 'go', 900); Snd.go();
    }
    G.prevSt = m.st;
    updateHud();
  }

  function popScore(p) {
    var el = $('hud-s' + p);
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }

  function onEvent(m) {
    var mine = m.p === G.you;
    if (m.k === 'pickup') {
      sparkle(m.x, m.y, PCOL[m.p].light);
      if (mine) Snd.pickup(m.c); else Snd.soft();
    } else if (m.k === 'deposit') {
      var who = mine ? G.me : G.opp;
      var L = S.LOCKER[m.p];
      for (var i = 0; i < Math.min(m.n, 8); i++) {
        G.fx.push({ kind: 'fly', sx: who.x, sy: who.y - 20, tx: L.x, ty: L.y - 6, delay: i * 0.05, t: 0, dur: 0.55, rot: Math.random() * 6 });
      }
      G.texts.push({ x: L.x, y: L.y - 50, text: '+' + m.n, life: 1.3, max: 1.3, color: PCOL[m.p].light, size: 26, vy: -34 });
      G.pulse[m.p] = 1;
      G.score[m.p] = m.s;
      popScore(m.p);
      if (mine) Snd.deposit(m.n); else Snd.depositSoft();
    } else if (m.k === 'full' && mine) {
      G.texts.push({ x: G.me.x, y: G.me.y - 62, text: '¡Mochila llena!', life: 1.2, max: 1.2, color: '#fbbf24', size: 16, vy: -22 });
      Snd.full();
    }
  }

  function onEnd(m) {
    G.ended = true; G.result = m;
    G.me.mv = false;
    clearTimeout(resultsT);
    if (m.reason === 'left') {
      showResults();
    } else {
      showBanner('¡TIEMPO!', 'small');
      resultsT = setTimeout(function () { hideBanner(); showResults(); }, 1400);
    }
  }

  function showResults() {
    var r = G.result;
    if (!r) return;
    var win = r.winner === G.you, tie = r.winner === -1;
    var title = $('res-title');
    title.textContent = tie ? '¡Empate!' : win ? '¡Ganaste!' : 'Perdiste';
    title.className = tie ? '' : win ? 'win' : 'lose';
    var mine = r.scores[G.you], theirs = r.scores[1 - G.you];
    var sub;
    if (r.reason === 'left') sub = 'Tu rival salió de la partida. Ganas por abandono.';
    else if (tie) sub = 'Los dos guardaron ' + mine + ' solicitudes.';
    else if (win) sub = 'Guardaste ' + mine + ' solicitudes contra ' + theirs + '. ¡Te contratan!';
    else sub = 'Guardaste ' + mine + ' solicitudes contra ' + theirs + '. Para la próxima.';
    $('res-sub').textContent = sub;
    $('res-n0').textContent = G.names[0] || 'Jugador 1';
    $('res-n1').textContent = G.names[1] || 'Jugador 2';
    $('res-s0').textContent = r.scores[0];
    $('res-s1').textContent = r.scores[1];
    document.querySelector('.rs.p0').classList.toggle('winner', r.winner === 0);
    document.querySelector('.rs.p1').classList.toggle('winner', r.winner === 1);
    var canRematch = r.reason !== 'left';
    $('btn-rematch').hidden = !canRematch;
    $('btn-rematch').disabled = false;
    $('btn-rematch').textContent = 'Revancha';
    $('res-wait').hidden = true;
    $('results').hidden = false;
    if (win) Snd.win(); else if (!tie) Snd.lose();
  }

  function onRematch(m) {
    if (!G.ended) return;
    var mineAsked = m.flags[G.you], theirsAsked = m.flags[1 - G.you];
    var w = $('res-wait');
    if (theirsAsked && !mineAsked) { w.textContent = 'Tu rival quiere la revancha. ¡Acepta!'; w.hidden = false; }
    else if (mineAsked && !theirsAsked) { w.textContent = 'Esperando a tu rival…'; w.hidden = false; }
  }

  function onLeft() {
    if (G.screen === 'wait' || (G.screen === 'game' && !G.ended)) {
      toast('Tu rival salió de la sala');
      resetToMenu();
    } else if (G.ended) {
      $('btn-rematch').hidden = true;
      var w = $('res-wait'); w.textContent = 'Tu rival salió de la sala.'; w.hidden = false;
    }
  }

  function resetToMenu() {
    clearTimeout(resultsT); hideBanner();
    $('results').hidden = true;
    G.ended = false; G.result = null; G.you = -1; G.code = '';
    setBusy(false);
    showScreen('menu');
  }

  /* ====================================================================
   *  HUD
   * ==================================================================== */
  function updateHud() {
    $('hud-s0').textContent = G.score[0];
    $('hud-s1').textContent = G.score[1];
    var timer = $('timer');
    var t = G.status === 'countdown' ? G.total : G.tl;
    timer.textContent = fmtTime(t);
    timer.classList.toggle('warn', G.status === 'playing' && G.tl <= 15);
    var bag = $('bag'), dots = bag.querySelectorAll('i');
    var c = G.you >= 0 ? G.carry[G.you] : 0;
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < c);
    bag.classList.toggle('full', c >= S.CAPACITY);
  }

  /* ====================================================================
   *  Entrada: teclado + joystick táctil
   * ==================================================================== */
  var keys = { l: false, r: false, u: false, d: false };
  var joy = { active: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0 };

  function keyOf(e) {
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': return 'l';
      case 'ArrowRight': case 'KeyD': return 'r';
      case 'ArrowUp': case 'KeyW': return 'u';
      case 'ArrowDown': case 'KeyS': return 'd';
    }
    return null;
  }
  window.addEventListener('keydown', function (e) {
    Snd.init();
    if (G.screen !== 'game') return;
    var k = keyOf(e);
    if (k) { keys[k] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    var k = keyOf(e);
    if (k) { keys[k] = false; e.preventDefault(); }
  });
  function releaseInput() {
    keys.l = keys.r = keys.u = keys.d = false;
    joy.active = false; joy.vx = joy.vy = 0; $('joy').hidden = true;
    G.me.mv = false;
  }
  window.addEventListener('blur', releaseInput);
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseInput(); });

  var stage = $('stage');
  stage.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' || G.screen !== 'game' || joy.active) return;
    joy.active = true; joy.id = e.pointerId;
    var r = stage.getBoundingClientRect();
    joy.ox = e.clientX - r.left; joy.oy = e.clientY - r.top;
    var j = $('joy'); j.style.left = joy.ox + 'px'; j.style.top = joy.oy + 'px'; j.hidden = false;
    $('knob').style.transform = 'translate(0,0)';
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!joy.active || e.pointerId !== joy.id) return;
    var r = stage.getBoundingClientRect();
    var dx = e.clientX - r.left - joy.ox, dy = e.clientY - r.top - joy.oy;
    var max = 48, len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; len = max; }
    $('knob').style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    joy.vx = len / max < 0.18 ? 0 : dx / max;
    joy.vy = len / max < 0.18 ? 0 : dy / max;
    e.preventDefault();
  });
  function joyEnd(e) {
    if (!joy.active || e.pointerId !== joy.id) return;
    joy.active = false; joy.vx = joy.vy = 0; $('joy').hidden = true;
  }
  stage.addEventListener('pointerup', joyEnd);
  stage.addEventListener('pointercancel', joyEnd);

  /* ====================================================================
   *  Simulación local (predicción del movimiento propio)
   * ==================================================================== */
  function update(dt) {
    var me = G.me, opp = G.opp;

    // Yo
    if (G.status === 'playing' && !G.ended && G.screen === 'game') {
      var vx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0) + joy.vx;
      var vy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0) + joy.vy;
      var len = Math.hypot(vx, vy);
      if (len > 1) { vx /= len; vy /= len; }
      if (len > 0.01) {
        var r = S.move(me.x, me.y, vx * S.SPEED * dt, vy * S.SPEED * dt);
        var moved = Math.hypot(r.x - me.x, r.y - me.y) > 0.01;
        me.x = r.x; me.y = r.y; me.mv = moved;
        if (Math.abs(vx) > Math.abs(vy)) me.dir = vx > 0 ? 'right' : 'left';
        else me.dir = vy > 0 ? 'down' : 'up';
      } else {
        me.mv = false;
      }
    } else {
      me.mv = false;
    }
    if (me.mv) me.phase += dt * 11;

    // Rival: suavizado hacia la última posición recibida
    var sp = G.you >= 0 ? G.sp[1 - G.you] : null;
    if (sp) {
      var ox = opp.x, oy = opp.y, f = Math.min(1, dt * 14);
      opp.x += (sp.x - opp.x) * f; opp.y += (sp.y - opp.y) * f;
      opp.dir = sp.d;
      opp.mv = sp.m === 1 || Math.hypot(opp.x - ox, opp.y - oy) > 0.4;
      if (G.status !== 'playing') opp.mv = false;
    }
    if (opp.mv) opp.phase += dt * 11;

    // Cámara (sólo se mueve si el mapa no cabe completo)
    var tx = view.w >= W ? 0 : Math.max(0, Math.min(W - view.w, me.x - view.w / 2));
    var ty = view.h >= H ? 0 : Math.max(0, Math.min(H - view.h, me.y - view.h / 2));
    var cf = Math.min(1, dt * 9);
    G.cam.x += (tx - G.cam.x) * cf; G.cam.y += (ty - G.cam.y) * cf;

    // Efectos
    for (var i = G.fx.length - 1; i >= 0; i--) {
      var p = G.fx[i];
      if (p.kind === 'fly') {
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.t += dt;
        if (p.t >= p.dur) G.fx.splice(i, 1);
      } else {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
        if (p.life <= 0) G.fx.splice(i, 1);
      }
    }
    for (var j = G.texts.length - 1; j >= 0; j--) {
      var tx2 = G.texts[j];
      tx2.life -= dt; tx2.y += tx2.vy * dt;
      if (tx2.life <= 0) G.texts.splice(j, 1);
    }
    G.pulse[0] = Math.max(0, G.pulse[0] - dt * 2.2);
    G.pulse[1] = Math.max(0, G.pulse[1] - dt * 2.2);
  }

  // Envío de posición (20 Hz)
  var lastSent = { x: -1, y: -1, t: 0 };
  setInterval(function () {
    if (G.screen !== 'game' || G.status !== 'playing' || G.ended) return;
    var me = G.me, now = performance.now();
    var changed = Math.abs(me.x - lastSent.x) > 0.05 || Math.abs(me.y - lastSent.y) > 0.05;
    if (!changed && now - lastSent.t < 300 && !(lastSent.m && !me.mv)) return;
    send({ t: 'pos', x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, d: me.dir, m: me.mv ? 1 : 0 });
    lastSent.x = me.x; lastSent.y = me.y; lastSent.t = now; lastSent.m = me.mv;
  }, 50);

  function sparkle(x, y, color) {
    for (var i = 0; i < 9; i++) {
      var a = Math.random() * TAU, sp = 40 + Math.random() * 90;
      G.fx.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.5 + Math.random() * 0.25, max: 0.75, size: 2 + Math.random() * 2.5, color: color });
    }
  }

  /* ====================================================================
   *  Dibujo
   * ==================================================================== */
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); }
  function tileAt(tx, ty) { return (GRID[ty] && GRID[ty][tx]) || '#'; }
  function rnd(seed) { // mulberry32 sencillo
    var t = seed + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function drawFloorTile(c, tx, ty) {
    var x = tx * T, y = ty * T, even = (tx + ty) % 2 === 0;
    var room = (ty >= 1 && ty <= 6) || (ty >= 15 && ty <= 20);
    if (room) {
      var small = tx <= 7 || tx >= 28;
      c.fillStyle = small ? (even ? '#9db6cc' : '#97b0c7') : (even ? '#92b6ae' : '#8bb0a8');
      c.fillRect(x, y, T, T);
      c.fillStyle = 'rgba(0,0,0,.06)';
      for (var i = 0; i < 4; i++) c.fillRect(x + rnd(tx * 97 + ty * 13 + i) * 30, y + rnd(tx * 31 + ty * 57 + i * 7) * 30, 2, 2);
    } else {
      c.fillStyle = even ? '#eae2d1' : '#e2dac7';
      c.fillRect(x, y, T, T);
      c.strokeStyle = 'rgba(120,105,80,.16)';
      c.lineWidth = 1;
      c.strokeRect(x + .5, y + .5, T - 1, T - 1);
    }
  }

  function drawWall(c, tx, ty) {
    var x = tx * T, y = ty * T;
    c.fillStyle = '#4b5a78'; c.fillRect(x, y, T, T);
    c.fillStyle = '#5d6f92'; c.fillRect(x, y, T, 3);
    if (tileAt(tx, ty + 1) !== '#') {
      c.fillStyle = '#2f3b55'; c.fillRect(x, y + T - 12, T, 12);
      c.fillStyle = '#26304a'; c.fillRect(x, y + T - 3, T, 3);
      c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x, y + T - 12, T, 1);
    }
  }

  function drawDesk(c, tx, ty) {
    var x = tx * T, y = ty * T;
    var L = tileAt(tx - 1, ty) === 'd', R = tileAt(tx + 1, ty) === 'd';
    var U = tileAt(tx, ty - 1) === 'd', D = tileAt(tx, ty + 1) === 'd';
    var x0 = x + (L ? 0 : 2), x1 = x + T - (R ? 0 : 2), y0 = y + (U ? 0 : 3), y1 = y + T - (D ? 0 : 3);
    c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x0 + 2, y0 + 4, x1 - x0, y1 - y0);
    c.fillStyle = '#c99d6a'; c.fillRect(x0, y0, x1 - x0, y1 - y0 - (D ? 0 : 5));
    if (!D) { c.fillStyle = '#8e6742'; c.fillRect(x0, y1 - 5, x1 - x0, 5); }
    c.strokeStyle = 'rgba(80,50,25,.35)'; c.lineWidth = 1;
    c.strokeRect(x0 + .5, y0 + .5, x1 - x0 - 1, y1 - y0 - 1);
    var v = (tx * 7 + ty * 3) % 3;
    if (v !== 0) { // monitor + teclado
      c.fillStyle = '#1f2937'; rr(c, x + 7, y + 5, 18, 12, 2); c.fill();
      c.fillStyle = v === 1 ? '#60a5fa' : '#34d399'; c.fillRect(x + 9, y + 7, 14, 8);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x + 10, y + 8, 6, 2);
      c.fillStyle = '#374151'; c.fillRect(x + 14, y + 17, 4, 2);
      c.fillStyle = '#e5e7eb'; c.fillRect(x + 9, y + 20, 14, 4);
    } else { // papeles y taza
      c.fillStyle = '#fff'; c.fillRect(x + 6, y + 8, 12, 15); c.fillStyle = '#e5e7eb'; c.fillRect(x + 8, y + 6, 12, 15);
      c.fillStyle = '#b6bdc9'; c.fillRect(x + 10, y + 10, 8, 1.5); c.fillRect(x + 10, y + 14, 8, 1.5);
      c.fillStyle = '#ef4444'; c.beginPath(); c.arc(x + 25, y + 14, 4, 0, TAU); c.fill();
      c.fillStyle = '#7f1d1d'; c.beginPath(); c.arc(x + 25, y + 14, 2.2, 0, TAU); c.fill();
    }
  }

  function drawPlant(c, tx, ty) {
    var x = tx * T, y = ty * T;
    c.fillStyle = 'rgba(0,0,0,.2)'; ell(c, x + 17, y + 28, 12, 4); c.fill();
    c.fillStyle = '#27874c'; c.beginPath(); c.arc(x + 9, y + 12, 8, 0, TAU); c.fill();
    c.fillStyle = '#2f9e5b'; c.beginPath(); c.arc(x + 23, y + 11, 8, 0, TAU); c.fill();
    c.fillStyle = '#37b36a'; c.beginPath(); c.arc(x + 16, y + 7, 8, 0, TAU); c.fill();
    c.fillStyle = '#2f9e5b'; c.beginPath(); c.arc(x + 16, y + 15, 8, 0, TAU); c.fill();
    c.fillStyle = '#b4553a';
    c.beginPath(); c.moveTo(x + 7, y + 18); c.lineTo(x + 25, y + 18); c.lineTo(x + 22, y + 30); c.lineTo(x + 10, y + 30); c.closePath(); c.fill();
    c.fillStyle = '#8f3f28'; c.fillRect(x + 7, y + 18, 18, 3);
  }

  function drawCabinet(c, tx, ty) {
    var x = tx * T, y = ty * T;
    c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x + 5, y + 5, 26, 26);
    c.fillStyle = '#9aa3af'; c.fillRect(x + 3, y + 2, 26, 27);
    c.fillStyle = '#b9c1cc'; c.fillRect(x + 3, y + 2, 26, 4);
    c.fillStyle = '#7b8492'; c.fillRect(x + 3, y + 24, 26, 5);
    c.strokeStyle = '#6b7380'; c.lineWidth = 1.5;
    c.strokeRect(x + 6, y + 8, 20, 8); c.strokeRect(x + 6, y + 17, 20, 7);
    c.fillStyle = '#374151'; c.fillRect(x + 13, y + 11, 6, 2); c.fillRect(x + 13, y + 19.5, 6, 2);
  }

  function drawCooler(c, tx, ty) {
    var x = tx * T, y = ty * T;
    c.fillStyle = 'rgba(0,0,0,.2)'; ell(c, x + 17, y + 29, 11, 4); c.fill();
    c.fillStyle = '#e5e7eb'; rr(c, x + 8, y + 14, 16, 16, 2); c.fill();
    c.fillStyle = '#cbd5e1'; c.fillRect(x + 8, y + 14, 16, 3);
    c.fillStyle = 'rgba(125,211,252,.85)'; rr(c, x + 9, y + 1, 14, 14, 5); c.fill();
    c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(x + 11, y + 4, 3, 7);
    c.fillStyle = '#3b82f6'; c.fillRect(x + 12, y + 20, 3, 4); c.fillStyle = '#ef4444'; c.fillRect(x + 17, y + 20, 3, 4);
  }

  function drawLockerBlock(c, x, y, p) {
    var col = PCOL[p];
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x + 4, y + 5, 64, 64);
    c.fillStyle = col.dark; c.fillRect(x, y, 64, 64);
    for (var j = 0; j < 2; j++) for (var i = 0; i < 2; i++) {
      var dx = x + i * 32 + 2, dy = y + j * 32 + 2;
      c.fillStyle = col.main; c.fillRect(dx, dy, 28, 28);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(dx, dy, 28, 3);
      c.fillStyle = 'rgba(0,0,0,.28)';
      for (var s = 0; s < 3; s++) c.fillRect(dx + 5, dy + 6 + s * 3.5, 18, 1.6);
      c.fillStyle = '#e5e7eb'; c.fillRect(dx + (i === 0 ? 22 : 4), dy + 16, 3, 7);
    }
  }

  function renderStatic(c) {
    var tx, ty;
    for (ty = 0; ty < S.ROWS; ty++) for (tx = 0; tx < S.COLS; tx++) {
      if (GRID[ty][tx] !== '#') drawFloorTile(c, tx, ty);
    }
    // alfombra de entrega frente a cada casillero
    for (var p = 0; p < 2; p++) {
      var L = S.LOCKER[p];
      c.fillStyle = p === 0 ? 'rgba(59,130,246,.2)' : 'rgba(249,115,22,.2)';
      c.beginPath(); c.moveTo(L.x, L.y - S.DEPOSIT_R);
      c.arc(L.x, L.y, S.DEPOSIT_R, p === 0 ? -Math.PI / 2 : Math.PI / 2, p === 0 ? Math.PI / 2 : Math.PI * 1.5);
      c.closePath(); c.fill();
    }
    for (ty = 0; ty < S.ROWS; ty++) for (tx = 0; tx < S.COLS; tx++) {
      var ch = GRID[ty][tx];
      if (ch === '#') {
        drawWall(c, tx, ty);
      }
    }
    // sombras de las paredes sobre el piso
    for (ty = 0; ty < S.ROWS - 1; ty++) for (tx = 0; tx < S.COLS; tx++) {
      if (GRID[ty][tx] === '#' && GRID[ty + 1][tx] !== '#') {
        var g = c.createLinearGradient(0, (ty + 1) * T, 0, (ty + 1) * T + 10);
        g.addColorStop(0, 'rgba(0,0,0,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(tx * T, (ty + 1) * T, T, 10);
      }
    }
    for (ty = 0; ty < S.ROWS; ty++) for (tx = 0; tx < S.COLS; tx++) {
      switch (GRID[ty][tx]) {
        case 'd': drawDesk(c, tx, ty); break;
        case 'p': drawPlant(c, tx, ty); break;
        case 'c': drawCabinet(c, tx, ty); break;
        case 'w': drawCooler(c, tx, ty); break;
        case '1': if (tileAt(tx - 1, ty) !== '1' && tileAt(tx, ty - 1) !== '1') drawLockerBlock(c, tx * T, ty * T, 0); break;
        case '2': if (tileAt(tx - 1, ty) !== '2' && tileAt(tx, ty - 1) !== '2') drawLockerBlock(c, tx * T, ty * T, 1); break;
      }
    }
  }

  function buildStatic() {
    var k = view.k;
    staticCv = document.createElement('canvas');
    staticCv.width = Math.ceil(W * k); staticCv.height = Math.ceil(H * k);
    var c = staticCv.getContext('2d');
    c.scale(k, k);
    renderStatic(c);
    staticK = k;
  }

  function layout() {
    var aw = stage.clientWidth, ah = stage.clientHeight;
    if (!aw || !ah) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var fit = Math.min(aw / W, ah / H);
    var zoom = Math.min(1.8, Math.max(fit, 0.75));
    view.zoom = zoom;
    view.w = Math.min(W, aw / zoom);
    view.h = Math.min(H, ah / zoom);
    var cssW = Math.floor(view.w * zoom), cssH = Math.floor(view.h * zoom);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    view.k = zoom * dpr;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    if (!staticCv || Math.abs(staticK - view.k) > 0.001) buildStatic();
    var portrait = window.innerHeight > window.innerWidth;
    $('rotate').hidden = !(portrait && ('ontouchstart' in window) && view.w < W);
  }
  window.addEventListener('resize', function () { if (G.screen === 'game') layout(); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { if (G.screen === 'game') layout(); }, 200); });

  function drawPaper(c, p, t) {
    var bob = Math.sin(t * 3 + p[0]) * 1.6;
    c.save();
    c.translate(p[1], p[2] + bob);
    c.fillStyle = 'rgba(0,0,0,.22)'; ell(c, 0, 10 - bob, 8, 3); c.fill();
    var g = c.createRadialGradient(0, 0, 2, 0, 0, 21);
    g.addColorStop(0, 'rgba(255,226,110,.6)'); g.addColorStop(1, 'rgba(255,226,110,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 21, 0, TAU); c.fill();
    c.rotate(p[3] * Math.PI / 180);
    c.fillStyle = '#fff'; c.strokeStyle = '#8f99a8'; c.lineWidth = 1;
    rr(c, -7, -9, 14, 18, 1.5); c.fill(); c.stroke();
    c.fillStyle = '#3b82f6'; c.fillRect(-5, -7, 10, 3);
    c.fillStyle = '#b6bdc9'; c.fillRect(-5, -2, 10, 1.3); c.fillRect(-5, 1, 10, 1.3); c.fillRect(-5, 4, 6, 1.3);
    c.fillStyle = '#d5dce6'; c.beginPath(); c.moveTo(7, 3); c.lineTo(7, 9); c.lineTo(1, 9); c.closePath(); c.fill();
    c.restore();
  }

  function drawPlayer(c, x, y, idx, dir, mv, phase, carry, name, isMe, t) {
    var col = PCOL[idx];
    var sw = mv ? Math.sin(phase) : 0;
    var bob = mv ? Math.abs(Math.sin(phase)) * 1.6 : 0;
    var side = dir === 'left' || dir === 'right';
    c.save();
    c.translate(x, y + 10);

    c.fillStyle = 'rgba(0,0,0,.28)'; ell(c, 0, 0, 11, 5); c.fill();
    if (isMe) { c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2; ell(c, 0, 0, 14, 7); c.stroke(); }

    // piernas
    if (side) {
      var l1 = Math.max(0, sw) * 3, l2 = Math.max(0, -sw) * 3;
      c.fillStyle = col.pants;
      c.fillRect(-4 + sw * 4, -10, 5, 10 - l1); c.fillRect(-1 - sw * 4, -10, 5, 10 - l2);
      c.fillStyle = '#111827';
      c.fillRect(-4 + sw * 4, -l1 - 2, 5, 2); c.fillRect(-1 - sw * 4, -l2 - 2, 5, 2);
    } else {
      var la = Math.max(0, sw) * 3, lb = Math.max(0, -sw) * 3;
      c.fillStyle = col.pants;
      c.fillRect(-6, -10, 5, 10 - la); c.fillRect(1, -10, 5, 10 - lb);
      c.fillStyle = '#111827';
      c.fillRect(-6, -la - 2, 5, 2); c.fillRect(1, -lb - 2, 5, 2);
    }

    c.translate(0, -bob);

    // pelo largo (atrás)
    if (col.long && dir !== 'down') {
      c.fillStyle = col.hair; rr(c, -9.5, -37, 19, dir === 'up' ? 20 : 16, 6); c.fill();
    }

    // torso
    c.fillStyle = col.main; rr(c, -9, -25, 18, 16, 3); c.fill();
    c.fillStyle = col.dark; c.fillRect(-9, -12, 18, 3);
    if (dir === 'down') {
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-4, -25); c.lineTo(4, -25); c.lineTo(0, -20); c.closePath(); c.fill();
      c.fillStyle = col.tie; c.beginPath(); c.moveTo(0, -21); c.lineTo(-2.4, -17); c.lineTo(0, -11); c.lineTo(2.4, -17); c.closePath(); c.fill();
    } else if (side) {
      c.fillStyle = col.dark; c.fillRect(dir === 'right' ? 4 : -6, -24, 2, 12);
    }

    // brazos
    c.fillStyle = col.main;
    if (carry > 0) { // cargando la pila sobre la cabeza
      c.fillRect(-13, -33, 4, 11); c.fillRect(9, -33, 4, 11);
      c.fillStyle = col.skin; c.fillRect(-13, -36, 4, 4); c.fillRect(9, -36, 4, 4);
    } else if (side) {
      c.fillRect(-2 + sw * 4, -24, 4, 11);
      c.fillStyle = col.skin; c.fillRect(-2 + sw * 4, -14, 4, 3);
    } else {
      c.fillRect(-13, -24 + sw * 2, 4, 11); c.fillRect(9, -24 - sw * 2, 4, 11);
      c.fillStyle = col.skin; c.fillRect(-13, -14 + sw * 2, 4, 3); c.fillRect(9, -14 - sw * 2, 4, 3);
    }

    // cabeza
    c.fillStyle = col.skin; c.beginPath(); c.arc(0, -31, 8.5, 0, TAU); c.fill();
    c.fillStyle = col.hair;
    if (dir === 'up') {
      c.beginPath(); c.arc(0, -31, 8.7, 0, TAU); c.fill();
      if (col.long) { c.fillRect(-8, -31, 16, 11); }
    } else {
      c.beginPath(); c.arc(0, -31, 8.8, Math.PI, TAU); c.fill();
      c.fillRect(-8.8, -33, 17.6, 3.5);
      if (col.long) { c.fillRect(-9.5, -33, 3, 13); c.fillRect(6.5, -33, 3, 13); }
      c.fillStyle = '#1f2937';
      if (dir === 'down') { c.beginPath(); c.arc(-3, -30, 1.5, 0, TAU); c.arc(3, -30, 1.5, 0, TAU); c.fill(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-1.5, -26, 3, 1); }
      else { c.beginPath(); c.arc(dir === 'right' ? 4.5 : -4.5, -30, 1.5, 0, TAU); c.fill(); }
    }

    // pila de solicitudes sobre la cabeza
    var wob = mv ? Math.sin(phase * 1.2) * 0.8 : 0;
    for (var i = 0; i < carry; i++) {
      var sy = -41 - i * 3.4, sx = -8 + ((i % 2) ? 1 : -1) * 0.8 + wob;
      c.fillStyle = '#fff'; c.strokeStyle = '#8f99a8'; c.lineWidth = 0.8;
      c.fillRect(sx, sy, 16, 3.2); c.strokeRect(sx, sy, 16, 3.2);
      c.fillStyle = i % 2 ? '#3b82f6' : '#f97316'; c.fillRect(sx + 1.5, sy + 0.8, 5, 1.2);
    }

    // etiqueta con el nombre
    var ty = -55 - carry * 3.4;
    c.font = 'bold 11px "Trebuchet MS", system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    var label = name || (idx === 0 ? 'Jugador 1' : 'Jugador 2');
    var tw = c.measureText(label).width + 12;
    c.fillStyle = 'rgba(8,12,22,.7)'; rr(c, -tw / 2, ty - 8, tw, 16, 8); c.fill();
    c.strokeStyle = col.light; c.lineWidth = 1.5; rr(c, -tw / 2, ty - 8, tw, 16, 8); c.stroke();
    c.fillStyle = '#fff'; c.fillText(label, 0, ty + 0.5);
    c.restore();
  }

  function drawLockerFx(c, t) {
    for (var p = 0; p < 2; p++) {
      var L = S.LOCKER[p], col = PCOL[p];
      var pulse = G.pulse[p];

      // marcador LED encima del casillero
      c.fillStyle = '#0b1220'; rr(c, L.x - 27, L.y - 30, 54, 16, 3); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 1; rr(c, L.x - 27, L.y - 30, 54, 16, 3); c.stroke();
      c.fillStyle = '#a3e635'; c.font = 'bold 13px "Courier New", monospace';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(G.score[p]), L.x, L.y - 21.5);

      // contorno animado de la zona de entrega
      c.save();
      c.setLineDash([9, 9]);
      c.lineDashOffset = (p === 0 ? -1 : 1) * t * 22;
      c.strokeStyle = col.light;
      c.globalAlpha = 0.55 + Math.sin(t * 3) * 0.2 + pulse * 0.25;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(L.x, L.y, S.DEPOSIT_R, p === 0 ? -Math.PI / 2 : Math.PI / 2, p === 0 ? Math.PI / 2 : Math.PI * 1.5);
      c.stroke();
      if (pulse > 0) {
        c.setLineDash([]); c.globalAlpha = pulse * 0.8; c.lineWidth = 4;
        c.beginPath();
        c.arc(L.x, L.y, S.DEPOSIT_R + (1 - pulse) * 26, p === 0 ? -Math.PI / 2 : Math.PI / 2, p === 0 ? Math.PI / 2 : Math.PI * 1.5);
        c.stroke();
      }
      c.restore();
    }

    // guía: "entrega aquí" cuando llevas solicitudes
    if (G.you >= 0 && G.carry[G.you] > 0 && G.status === 'playing') {
      var Lm = S.LOCKER[G.you], d = Math.hypot(G.me.x - Lm.x, G.me.y - Lm.y);
      if (d > S.DEPOSIT_R) {
        var bob = Math.sin(t * 6) * 3;
        var lx = Lm.x, ly = Lm.y - 62 + bob;
        c.font = 'bold 12px "Trebuchet MS", system-ui, sans-serif';
        var txt = '¡ENTREGA AQUÍ!', w = c.measureText(txt).width + 18;
        c.fillStyle = PCOL[G.you].main; rr(c, lx - w / 2, ly - 11, w, 22, 11); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; rr(c, lx - w / 2, ly - 11, w, 22, 11); c.stroke();
        c.beginPath(); c.moveTo(lx - 6, ly + 10); c.lineTo(lx + 6, ly + 10); c.lineTo(lx, ly + 17); c.closePath();
        c.fillStyle = PCOL[G.you].main; c.fill();
        c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, lx, ly + 0.5);
      }
    }
  }

  function drawFx(c) {
    var i, p;
    for (i = 0; i < G.fx.length; i++) {
      p = G.fx[i];
      if (p.kind === 'spark') {
        var a = Math.max(0, p.life / p.max);
        c.globalAlpha = a; c.fillStyle = p.color;
        c.save(); c.translate(p.x, p.y); c.rotate(p.life * 9);
        c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        c.restore(); c.globalAlpha = 1;
      } else if (p.kind === 'fly' && p.delay <= 0) {
        var e = p.t / p.dur, ee = e * e * (3 - 2 * e);
        var x = p.sx + (p.tx - p.sx) * ee, y = p.sy + (p.ty - p.sy) * ee - Math.sin(Math.PI * e) * 34;
        c.save(); c.translate(x, y); c.rotate(p.rot + e * 8); c.globalAlpha = 1 - e * 0.4;
        c.fillStyle = '#fff'; c.strokeStyle = '#8f99a8'; c.lineWidth = 1;
        c.fillRect(-5, -6, 10, 12); c.strokeRect(-5, -6, 10, 12);
        c.fillStyle = '#3b82f6'; c.fillRect(-3.5, -4.5, 7, 2);
        c.restore();
      }
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (i = 0; i < G.texts.length; i++) {
      var tx = G.texts[i], al = Math.min(1, tx.life / (tx.max * 0.5));
      c.globalAlpha = al;
      c.font = '900 ' + tx.size + 'px "Trebuchet MS", system-ui, sans-serif';
      c.lineWidth = 5; c.strokeStyle = 'rgba(8,12,22,.85)'; c.lineJoin = 'round';
      c.strokeText(tx.text, tx.x, tx.y);
      c.fillStyle = tx.color; c.fillText(tx.text, tx.x, tx.y);
      c.globalAlpha = 1;
    }
  }

  function render(t) {
    if (!staticCv) return;
    var k = view.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCv, G.cam.x * k, G.cam.y * k, view.w * k, view.h * k, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, -G.cam.x * k, -G.cam.y * k);

    drawLockerFx(ctx, t);
    for (var i = 0; i < G.papers.length; i++) drawPaper(ctx, G.papers[i], t);

    if (G.you >= 0) {
      var list = [
        { idx: G.you, o: G.me, me: true },
        { idx: 1 - G.you, o: G.opp, me: false }
      ].sort(function (a, b) { return a.o.y - b.o.y; });
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        drawPlayer(ctx, e.o.x, e.o.y, e.idx, e.o.dir, e.o.mv, e.o.phase, G.carry[e.idx], G.names[e.idx], e.me, t);
      }
    }
    drawFx(ctx);
  }

  var lastT = performance.now() / 1000;
  function frame(ts) {
    var now = ts / 1000;
    var dt = Math.min(0.05, Math.max(0, now - lastT));
    lastT = now;
    if (G.screen === 'game') { update(dt); render(now); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ====================================================================
   *  Menú / sala de espera
   * ==================================================================== */
  var nameEl = $('name'), codeEl = $('code');

  function getName() {
    var n = nameEl.value.replace(/\s+/g, ' ').trim().slice(0, 12);
    try { localStorage.setItem('bc_name', n); } catch (e) { /* nada */ }
    return n;
  }
  function setBusy(b) {
    $('btn-create').disabled = b; $('btn-join').disabled = b;
  }

  function doCreate() {
    Snd.init();
    var name = getName();
    setBusy(true);
    setMenuMsg('Conectando con el servidor… (si estaba dormido puede tardar unos segundos)');
    ensureSocket().then(function () { send({ t: 'create', name: name }); })
      .catch(function () { setMenuMsg('No se pudo conectar con el servidor. Intenta de nuevo.', true); setBusy(false); });
  }

  function doJoin() {
    Snd.init();
    var code = codeEl.value.trim().toUpperCase();
    if (code.length < 5) { setMenuMsg('Escribe el código de 5 letras/números de la sala.', true); codeEl.focus(); return; }
    var name = getName();
    setBusy(true);
    setMenuMsg('Conectando con el servidor… (si estaba dormido puede tardar unos segundos)');
    ensureSocket().then(function () { send({ t: 'join', code: code, name: name }); })
      .catch(function () { setMenuMsg('No se pudo conectar con el servidor. Intenta de nuevo.', true); setBusy(false); });
  }

  $('btn-create').addEventListener('click', doCreate);
  $('btn-join').addEventListener('click', doJoin);
  codeEl.addEventListener('input', function () {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  codeEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
  nameEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { if (codeEl.value.length >= 5) doJoin(); else doCreate(); }
  });

  function roomLink() {
    return location.origin + location.pathname + '?sala=' + G.code;
  }
  $('btn-copy-code').addEventListener('click', function () { copyText(G.code).then(function (ok) { toast(ok ? 'Código copiado' : 'No se pudo copiar'); }); });
  $('code-big').addEventListener('click', function () { copyText(G.code).then(function (ok) { toast(ok ? 'Código copiado' : 'No se pudo copiar'); }); });
  $('btn-copy-link').addEventListener('click', function () { copyText(roomLink()).then(function (ok) { toast(ok ? 'Enlace copiado' : 'No se pudo copiar'); }); });
  if (navigator.share) {
    $('btn-share').hidden = false;
    $('btn-share').addEventListener('click', function () {
      navigator.share({ title: 'Buscando Chamba', text: 'Únete a mi sala de Buscando Chamba. Código: ' + G.code, url: roomLink() }).catch(function () { /* cancelado */ });
    });
  }
  $('btn-cancel').addEventListener('click', function () { send({ t: 'leave' }); resetToMenu(); });

  $('btn-rematch').addEventListener('click', function () {
    if (G.rematchSent) return;
    G.rematchSent = true;
    send({ t: 'rematch' });
    $('btn-rematch').disabled = true; $('btn-rematch').textContent = 'Esperando al rival…';
  });
  $('btn-exit').addEventListener('click', function () { send({ t: 'leave' }); resetToMenu(); });

  function paintMute() {
    var m = Snd.isMuted();
    $('snd-on').hidden = m; $('snd-off').hidden = !m;
  }
  $('btn-mute').addEventListener('click', function () { Snd.init(); Snd.toggle(); paintMute(); });
  paintMute();
  document.addEventListener('pointerdown', Snd.init);

  // Valores iniciales del menú
  try { nameEl.value = localStorage.getItem('bc_name') || ''; } catch (e) { /* nada */ }
  var params = new URLSearchParams(location.search);
  var inv = (params.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (inv) {
    codeEl.value = inv;
    setMenuMsg('Te invitaron a la sala ' + inv + '. Escribe tu nombre y presiona «Unirme».');
    (nameEl.value ? codeEl : nameEl).focus();
  }

  // Despierta el servidor (los hosts gratuitos se duermen) mientras el jugador escribe su nombre
  try { fetch('/healthz', { cache: 'no-store' }).catch(function () { /* nada */ }); } catch (e) { /* nada */ }

  // Para pruebas automáticas
  window.__BC = { G: G, view: view };
})();
