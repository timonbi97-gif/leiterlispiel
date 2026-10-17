'use strict';
/* =========================================================
   Leiterlispiel Online
   - Peer-to-Peer über PeerJS (WebRTC), kein eigener Server nötig
   - Der Host ist "Server": er würfelt, prüft Züge und verteilt den Zustand
   - Private Spiele: Peer-ID aus 5-stelligem Code
   - Öffentliche Lobbys: feste Peer-IDs pub-1 … pub-8
   (Themen und Brett-Zeichnung: themes.js)
   ========================================================= */

const $ = s => document.querySelector(s);
const PREFIX = 'leiterli-tb2-';
const MAX_PLAYERS = 6;
const PUBLIC_LOBBIES = 8;
const TURN_MS = 30000;          // Auto-Wurf, wenn jemand nicht würfelt
const DUR = { step: 170, slide: 110, jump: 750, portal: 700 };
const COLORS = ['#e63946', '#1d72f2', '#2a9d3a', '#f4a300', '#8e44ad', '#ff6fb5'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_NAMES = ['Robo', 'Bip', 'Byte', 'Chip', 'Pixel', 'Servo'];

/* ---------------- Spielbretter ---------------- */
const CLASSIC_JUMPS = {
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};
const ADVENTURE_SPECIALS = {
  12: 'bonus', 58: 'bonus', 89: 'bonus', 7: 'fwd', 33: 'fwd', 69: 'fwd', 45: 'back', 77: 'back', 92: 'back',
  23: 'freeze', 66: 'freeze', 18: 'portal', 83: 'portal', 29: 'gift', 54: 'gift', 85: 'gift', 40: 'shield', 74: 'shield',
};
const BOARD_MODES = {
  abenteuer: { name: '🗺️ Abenteuer', desc: 'Klassisches Brett + Spezialfelder' },
  zufall: { name: '🎲 Zufall', desc: 'Jede Runde ein neues, zufälliges Brett' },
  pur: { name: '🪜 Klassisch pur', desc: 'Nur Hoch & Runter, keine Spezialfelder' },
};

function makeBoard(mode) {
  if (mode === 'zufall') return randomBoard();
  return { id: mode, mode, jumps: { ...CLASSIC_JUMPS }, specials: mode === 'abenteuer' ? { ...ADVENTURE_SPECIALS } : {} };
}

function randomBoard() {
  const seed = Math.floor(Math.random() * 1e9), r = rng(seed);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const used = new Set([1, 100]), jumps = {};
  const row = n => Math.floor((n - 1) / 10);
  const perRow = new Array(10).fill(0);   // Startfelder pro Reihe -> gleichmässig verteilt
  const place = (count, up) => {
    for (let made = 0, tries = 0; made < count && tries < 2000; tries++) {
      const from = up ? ri(2, 85) : ri(18, 99);
      const to = up ? from + ri(12, 42) : from - ri(12, 46);
      if (to > 99 || to < 2 || row(from) === row(to)) continue;
      if (used.has(from) || used.has(to) || perRow[row(from)] >= 2) continue;
      if (Object.keys(jumps).some(f => Math.abs(f - from) < 3)) continue;
      used.add(from); used.add(to); jumps[from] = to; perRow[row(from)]++; made++;
    }
  };
  place(8, true); place(9, false);
  const specials = {};
  const types = ['bonus', 'bonus', 'fwd', 'fwd', 'fwd', 'back', 'back', 'back', 'freeze', 'freeze',
    'gift', 'gift', 'gift', 'shield', 'shield', 'portal', 'portal'];
  for (const t of types) {
    for (let tries = 0; tries < 300; tries++) {
      const c = ri(3, 97);
      if (used.has(c)) continue;
      used.add(c); specials[c] = t; break;
    }
  }
  return { id: 'z' + seed, mode: 'zufall', jumps, specials };
}

/* ---------------- Hilfsfunktionen ---------------- */
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}
let connecting = false;
function busy(text) {
  connecting = !!text;
  $('#busy-text').textContent = text || '';
  $('#busy').classList.toggle('hidden', !text);
}
function show(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + screen));
}
function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch (e) { return null; }
}
function cleanName(n) {
  n = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Spieler' + Math.floor(Math.random() * 90 + 10);
}
function myName() { return cleanName($('#inp-name').value); }
function genCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ---------------- Sound ---------------- */
let audioCtx = null;
function beep(freq, dur = 0.08, type = 'sine', vol = 0.06, slideTo) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* kein Audio */ }
}
const chime = (notes, gap = 90, type = 'triangle') => notes.forEach((f, i) => setTimeout(() => beep(f, 0.15, type, 0.05), i * gap));

/* =========================================================
   BRETT-DARSTELLUNG
   ========================================================= */
const canvas = $('#board');
const ctx = canvas.getContext('2d');
let dpr = 1, boardCache = null, cacheKey = '';
let hoverCell = 0, shakeUntil = 0, banner = null;
const particles = [], floaters = [], trails = new Map();

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = BW * dpr; canvas.height = BH * dpr;
  cacheKey = '';
}

function slotXY(cell, idx) {
  if (cell <= 0) return { x: 130 + idx * 80, y: 669 };
  return cellXY(cell);
}

function burst(x, y, color, n = 18, speed = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, color, size: 2 + Math.random() * 3 });
  }
}
function confetti() {
  const cols = ['#ff5e7a', '#ffd23f', '#3ccf6e', '#3fc1ff', '#b26bff', '#fff'];
  for (let i = 0; i < 160; i++) {
    particles.push({ x: Math.random() * BW, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 3,
      life: 2.5, color: pick(cols), size: 3 + Math.random() * 4, rect: true, rot: Math.random() * 6 });
  }
}
function floatText(x, y, text, color) { floaters.push({ x, y, text, color, t0: performance.now() }); }
function showBanner(text, color) { banner = { text, color, t0: performance.now() }; }

/* ---------------- Animation ---------------- */
const anims = new Map();      // playerId -> {segs, start, total, started, ended, idx}
let lastSeq = -1;

function pathDur(path) { return path.reduce((t, s) => t + DUR[s.kind], 0); }

function startMoveAnims(lm) {
  for (const mv of lm.moves) {
    const segs = [];
    let cur = mv.from, t = 0;
    for (const p of mv.path) {
      segs.push({ a: cur, b: p.to, t0: t, dur: DUR[p.kind], kind: p.kind, fx: p.fx });
      t += DUR[p.kind]; cur = p.to;
    }
    anims.set(mv.id, { segs, start: performance.now() + 150 + (mv.delay || 0), total: t, started: 0, ended: 0 });
  }
}

function segStart(s) {
  if (s.kind === 'jump') {
    if (s.b > s.a) beep(300, 0.6, 'triangle', 0.07, 900);
    else { beep(700, 0.6, 'sawtooth', 0.04, 120); shakeUntil = performance.now() + 450; }
  } else if (s.kind === 'portal') beep(400, 0.5, 'sine', 0.06, 1400);
  else beep(s.kind === 'slide' ? 760 : 540, 0.05, 'square', 0.025);
}
function segEnd(s) {
  if (!s.fx) return;
  const p = slotXY(s.b, 0);
  floatText(p.x, p.y - 20, s.fx.text, s.fx.color);
  burst(p.x, p.y, s.fx.color, 22);
  if (s.fx.sound === 'good') chime([660, 880, 1100]);
  if (s.fx.sound === 'bad') chime([440, 330, 220], 110, 'sawtooth');
}

function tokenState(p, idx, now) {
  const an = anims.get(p.id);
  if (an) {
    const e = now - an.start;
    while (an.started < an.segs.length && e >= an.segs[an.started].t0) segStart(an.segs[an.started++]);
    while (an.ended < an.segs.length && e >= an.segs[an.ended].t0 + an.segs[an.ended].dur) segEnd(an.segs[an.ended++]);
    if (e < 0) {
      const a0 = an.segs[0].a;
      return { cell: a0, ...slotXY(a0, idx), ang: rowAngle(a0), moving: false, scale: 1 };
    }
    if (e < an.total) {
      const s = an.segs.find(sg => e < sg.t0 + sg.dur);
      const k = (e - s.t0) / s.dur;
      const A = slotXY(s.a, idx), B = slotXY(s.b, idx);
      if (s.kind === 'portal') { // verschwinden & woanders auftauchen
        const out = k < 0.5, q = out ? 1 - k * 2 : k * 2 - 1;
        const P = out ? A : B;
        return { x: P.x, y: P.y, ang: (now / 80) % (Math.PI * 2), moving: true, scale: Math.max(0.05, q), spin: true };
      }
      const ease = s.kind === 'jump' ? k * k * (3 - 2 * k) : k;
      const lift = s.kind === 'jump' ? Math.sin(k * Math.PI) * (s.b > s.a ? 30 : 10) : Math.sin(k * Math.PI) * 10;
      return {
        x: A.x + (B.x - A.x) * ease, y: A.y + (B.y - A.y) * ease - lift,
        ang: s.kind === 'jump' || s.a <= 0 ? Math.atan2(B.y - A.y, B.x - A.x) : (s.b < s.a ? rowAngle(s.a) + Math.PI : rowAngle(s.a)),
        moving: true, scale: s.kind === 'jump' ? 1 + Math.sin(k * Math.PI) * 0.35 : 1,
      };
    }
    anims.delete(p.id);
  }
  return { cell: p.pos, ...slotXY(p.pos, idx), ang: rowAngle(p.pos), moving: false, scale: 1 };
}

function drawTrail(T, tr) {
  if (tr.length < 2) return;
  if (T.trailKind === 'line') {
    ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = i / tr.length;
      ctx.strokeStyle = T.trail.replace(/[\d.]+\)$/, `${a * 0.8})`);
      ctx.lineWidth = 2 + a * 5;
      ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
    }
  } else {
    for (let i = 0; i < tr.length; i += 2) {
      const a = i / tr.length;
      ctx.globalAlpha = a * 0.8;
      if (T.trailKind === 'bubble') {
        ctx.strokeStyle = T.trail; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(tr[i].x + Math.sin(i) * 4, tr[i].y, 2 + a * 4, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = T.trail;
        ctx.beginPath(); ctx.arc(tr[i].x + Math.sin(i * 3) * 5, tr[i].y + Math.cos(i * 2) * 5, 1 + a * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

function drawHover(T, now) {
  if (!hoverCell || !S) return;
  const { x, y } = cellXY(hoverCell);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;
  rr(ctx, x - 28, y - 28, 56, 56, 11); ctx.stroke();
  let target = S.board.jumps[hoverCell];
  if (!target && S.board.specials[hoverCell] === 'portal') {
    target = +Object.keys(S.board.specials).find(c => S.board.specials[c] === 'portal' && +c !== hoverCell);
  }
  if (target) {
    const b = cellXY(target);
    ctx.setLineDash([8, 6]); ctx.lineDashOffset = -now / 30;
    ctx.strokeStyle = target > hoverCell ? '#3ccf6e' : '#ff4d5e'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(b.x, b.y, 24 + Math.sin(now / 200) * 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(50, now - lastFrame) / 16.7; lastFrame = now;
  if (!S || !$('#scr-room').classList.contains('active')) return;
  const theme = THEMES[S.theme] ? S.theme : 'flugzeuge';
  const T = THEMES[theme];
  const key = theme + '|' + S.board.id + '|' + dpr;
  if (cacheKey !== key) { boardCache = buildBoard(theme, S.board, dpr); cacheKey = key; }

  let sx = 0, sy = 0;
  if (now < shakeUntil) { const a = (shakeUntil - now) / 450 * 7; sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(boardCache, sx * dpr, sy * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);

  T.ambient(ctx, now);

  // pulsierende Spezialfelder + Ziel
  for (const [c, type] of Object.entries(S.board.specials)) {
    if (type !== 'portal' && type !== 'gift') continue;
    const { x, y } = cellXY(+c), k = (now / 900 + +c) % 1;
    ctx.strokeStyle = SPECIAL_BASE[type].color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y + 3, 17 + k * 12, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  { const { x, y } = cellXY(100); ctx.save(); ctx.translate(x, y);
    ctx.rotate(now / 3000); ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, -40); ctx.lineTo(6, -40); ctx.fill(); }
    ctx.restore(); }

  drawHover(T, now);

  // Figuren
  const toks = S.players.map((p, i) => ({ p, i, ...tokenState(p, i, now) }));
  const groups = {};
  toks.forEach(t => { if (!t.moving && t.cell > 0) (groups[t.cell] = groups[t.cell] || []).push(t); });
  const OFF = [[-12, -10], [12, 10], [12, -10], [-12, 10], [0, -16], [0, 16]];
  for (const list of Object.values(groups)) {
    if (list.length > 1) list.forEach((t, k) => { t.x += OFF[k][0]; t.y += OFF[k][1]; t.small = true; });
  }
  for (const t of toks) {
    const tr = trails.get(t.p.id) || [];
    if (t.moving && !t.spin) tr.push({ x: t.x, y: t.y }); else if (tr.length) tr.splice(0, 2);
    if (tr.length > 22) tr.shift();
    trails.set(t.p.id, tr);
    drawTrail(T, tr);
  }
  const cur = S.phase === 'play' ? S.players[S.turn] : null;
  toks.sort((a, b) => (a.moving - b.moving) || ((cur && a.p.id === cur.id) - (cur && b.p.id === cur.id)));
  for (const t of toks) {
    const size = (t.small ? 26 : 34) * t.scale;
    let y = t.y;
    if (T.token !== 'pawn' && !t.moving) y += Math.sin(now / 450 + t.i * 1.7) * 2.5;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(t.x, t.y + size * 0.42, size * 0.38, size * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    if (cur && t.p.id === cur.id && !t.moving) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, y, size * 0.6 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
    }
    if (t.p.shield) {
      ctx.strokeStyle = 'rgba(160,200,255,0.8)'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]); ctx.lineDashOffset = now / 50;
      ctx.beginPath(); ctx.arc(t.x, y, size * 0.72, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (T.token !== 'pawn') { // farbiger Sockel, damit Figuren sich von der Brett-Deko abheben
      const gr = ctx.createRadialGradient(t.x, y, size * 0.1, t.x, y, size * 0.62);
      gr.addColorStop(0, t.p.color + 'cc'); gr.addColorStop(1, t.p.color + '33');
      ctx.fillStyle = gr; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(t.x, y, size * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    drawToken(ctx, T.token, t.x, y, size, t.p.color, t.ang, t.p.name[0].toUpperCase());
    if (t.p.skip && !t.moving) {
      ctx.font = '16px ' + EMOJI_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(specialInfo(theme, 'freeze').icon, t.x + size * 0.45, y - size * 0.45);
    }
  }

  // Partikel
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.rect ? 0.03 : 0.12) * dt; p.life -= 0.02 * dt;
    if (p.life <= 0 || p.y > BH + 20) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.life);
    ctx.fillStyle = p.color;
    if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot += 0.1 * dt); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  // schwebende Texte
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i], k = (now - f.t0) / 1600;
    if (k >= 1) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = k < 0.75 ? 1 : (1 - k) * 4;
    const sc = k < 0.12 ? k / 0.12 : 1;
    ctx.font = `900 ${Math.round(20 * sc)}px "Segoe UI", ${EMOJI_FONT}`;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(f.text, f.x, f.y - k * 40);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - k * 40);
  }
  ctx.globalAlpha = 1;
  // Banner
  if (banner) {
    const k = (now - banner.t0) / 1500;
    if (k >= 1) banner = null;
    else {
      const a = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      rr(ctx, 120, 280, 400, 70, 20); ctx.fill();
      ctx.font = `900 30px "Segoe UI", ${EMOJI_FONT}`;
      ctx.fillStyle = banner.color || '#fff';
      ctx.fillText(banner.text, BW / 2, 316 + (1 - Math.min(1, k / 0.15)) * 10);
      ctx.globalAlpha = 1;
    }
  }
  if (S.phase === 'over' && anims.size === 0 && !winShown) showWin();
  const rb = $('#btn-roll');
  if (rb.disabled && rollAllowed && anims.size === 0) rb.disabled = false;
  else if (!rb.disabled && anims.size > 0) rb.disabled = true;
}

/* ---------------- Tooltip ---------------- */
function cellDescription(n) {
  if (!S || !n) return '';
  const T = THEMES[S.theme], B = S.board;
  if (n === 100) return `${T.goal} Ziel – genau hier landen!`;
  const j = B.jumps[n];
  if (j) return j > n ? `${T.upIcon} ${T.up}: hoch auf ${j}` : `${T.downIcon} ${T.down}: runter auf ${j}`;
  const sp = B.specials[n];
  if (sp) { const i = specialInfo(S.theme, sp); return `${i.icon} ${i.name}: ${i.desc}`; }
  const here = S.players.filter(p => p.pos === n).map(p => p.name);
  return here.length ? `Feld ${n}: ${here.join(', ')}` : '';
}
function onPointer(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * BW / rect.width, y = (e.clientY - rect.top) * BH / rect.height;
  hoverCell = cellAt(x, y);
  const tip = $('#tip'), text = cellDescription(hoverCell);
  if (!text) { tip.classList.remove('show'); return; }
  tip.textContent = text;
  tip.classList.add('show');
  const wrap = canvas.parentElement.getBoundingClientRect();
  let left = e.clientX - wrap.left + 14, top = e.clientY - wrap.top + 14;
  if (left + tip.offsetWidth > wrap.width) left = e.clientX - wrap.left - tip.offsetWidth - 10;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
canvas.addEventListener('pointermove', onPointer);
canvas.addEventListener('pointerdown', onPointer);
canvas.addEventListener('pointerleave', () => { hoverCell = 0; $('#tip').classList.remove('show'); });

/* =========================================================
   HOST-LOGIK (der Host verwaltet den Spielzustand)
   ========================================================= */
let H = null;   // Host-Kontext
let C = null;   // Client-Kontext
let S = null;   // aktueller Zustand (bei allen)
let myId = null;

function newState(opts) {
  return {
    phase: 'lobby', players: [], turn: 0, winner: null, seq: 0, lastMove: null,
    theme: opts.theme || 'flugzeuge', boardMode: 'abenteuer', board: makeBoard('abenteuer'),
    log: [], public: !!opts.public, code: opts.code || null, lobbyNo: opts.lobbyNo || null,
  };
}

function hostLog(text) {
  H.state.log.unshift(text);
  H.state.log.length = Math.min(H.state.log.length, 30);
}

function freeColor() {
  const used = new Set(H.state.players.map(p => p.color));
  return COLORS.find(c => !used.has(c)) || COLORS[0];
}

function hostAddPlayer(id, name, bot) {
  H.state.players.push({ id, name, color: freeColor(), pos: 0, bot: !!bot, shield: false, skip: false });
  hostLog(`${bot ? '🤖' : '👋'} ${name} ist dabei`);
}

function hostRemovePlayer(id) {
  const st = H.state;
  const i = st.players.findIndex(p => p.id === id);
  if (i < 0) return;
  const [p] = st.players.splice(i, 1);
  hostLog(`🚪 ${p.name} hat verlassen`);
  if (st.phase === 'play') {
    if (!st.players.length) { st.phase = 'lobby'; st.turn = 0; }
    else {
      if (i < st.turn) st.turn--;
      st.turn %= st.players.length;
      hostScheduleTurn();
    }
  }
}

function hostBroadcast() {
  const st = H.state;
  const tl = H.deadline && st.phase === 'play' ? Math.max(0, H.deadline - Date.now()) : 0;
  for (const [id, conn] of H.conns) {
    if (conn.open) { try { conn.send({ t: 'state', s: st, you: id, tl }); } catch (e) { /* ignore */ } }
  }
  onState(JSON.parse(JSON.stringify(st)), 'host', tl);
}

function hostSend(conn, msg) { try { if (conn.open) conn.send(msg); } catch (e) { /* ignore */ } }

function hostSetBoardMode(mode) {
  const st = H.state;
  st.boardMode = mode;
  st.board = makeBoard(mode);
  hostBroadcast();
}

function hostStart() {
  const st = H.state;
  if (st.players.length < 1) return;
  if (st.boardMode === 'zufall' && st.phase !== 'lobby') st.board = makeBoard('zufall'); // neue Runde = neues Brett
  st.players.forEach(p => { p.pos = 0; p.shield = false; p.skip = false; });
  st.phase = 'play'; st.winner = null; st.lastMove = null;
  st.turn = Math.floor(Math.random() * st.players.length);
  st.seq++;
  hostLog(`🎬 Spiel gestartet (${BOARD_MODES[st.boardMode].name}) – ${st.players[st.turn].name} beginnt`);
  H.busyUntil = 0;
  hostScheduleTurn();
  hostBroadcast();
}

function hostToLobby() {
  const st = H.state;
  st.phase = 'lobby'; st.winner = null; st.lastMove = null;
  st.players.forEach(p => { p.pos = 0; p.shield = false; p.skip = false; });
  if (st.boardMode === 'zufall') st.board = makeBoard('zufall');
  st.seq++;
  clearTimeout(H.turnTimer); H.deadline = 0;
  hostBroadcast();
}

function hostScheduleTurn() {
  clearTimeout(H.turnTimer);
  H.deadline = 0;
  const st = H.state;
  if (st.phase !== 'play') return;
  const p = st.players[st.turn];
  if (!p) return;
  const wait = Math.max(0, H.busyUntil - Date.now());
  const delay = wait + (p.bot ? 700 + Math.random() * 500 : TURN_MS);
  if (!p.bot) H.deadline = Date.now() + delay;
  H.turnTimer = setTimeout(() => hostRoll(p.id, true), delay);
}

function hostAdvanceTurn() {
  const st = H.state, n = st.players.length;
  for (let k = 0; k < n; k++) {
    st.turn = (st.turn + 1) % n;
    const p = st.players[st.turn];
    if (!p.skip) return;
    p.skip = false;
    hostLog(`${specialInfo(st.theme, 'freeze').icon} ${p.name} setzt diese Runde aus`);
  }
}

// Figur Feld für Feld bewegen (vorwärts mit Zurückprallen an 100, rückwärts bis min. 1)
function walk(path, pos, steps, kind) {
  let dir = steps > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(steps); i++) {
    if (dir > 0 && pos === 100) dir = -1;
    if (dir < 0 && pos === 1) break;
    pos += dir;
    path.push({ to: pos, kind });
  }
  return pos;
}

function hostRoll(id, auto) {
  const st = H.state;
  if (st.phase !== 'play') return;
  const p = st.players[st.turn];
  if (!p || p.id !== id) return;
  if (!auto && Date.now() < H.busyUntil) { // Animation läuft noch -> Wurf kurz aufschieben
    clearTimeout(H.turnTimer);
    H.turnTimer = setTimeout(() => hostRoll(id, false), H.busyUntil - Date.now() + 20);
    return;
  }
  const T = THEMES[st.theme], B = st.board;
  const SI = type => specialInfo(st.theme, type);
  const roll = 1 + Math.floor(Math.random() * 6);
  const path = [];
  const moves = [{ id: p.id, from: p.pos, path }];
  let pos = walk(path, p.pos, roll, 'step');
  const parts = [`${auto && !p.bot ? '⏰ ' : ''}${p.name} würfelt ${roll} → ${pos}`];
  if (p.pos + roll > 100) parts.push('(zurückgeprallt)');
  let extra = roll === 6;
  const last = () => path[path.length - 1];

  for (let guard = 0; guard < 6; guard++) {
    const j = B.jumps[pos];
    if (j) {
      if (j < pos && p.shield) {
        p.shield = false;
        last().fx = { text: `${SI('shield').icon} Gerettet!`, color: '#9fd0ff', sound: 'good' };
        parts.push(`– ${SI('shield').name} schützt vor ${T.down}!`);
        break;
      }
      const up = j > pos;
      path.push({ to: j, kind: 'jump', fx: { text: up ? `${T.upIcon} ${T.up}!` : `${T.downIcon} ${T.down}!`, color: up ? '#5dff8f' : '#ff5e6e', sound: up ? 'good' : 'bad' } });
      parts.push(up ? `${T.upIcon} ${T.up} bis ${j}!` : `${T.downIcon} ${T.down} – runter auf ${j}!`);
      pos = j;
      continue;
    }
    const sp = B.specials[pos];
    if (!sp) break;
    let type = sp;
    if (sp === 'gift') {
      type = pick(['bonus', 'fwd', 'fwd', 'back', 'shield', 'swap', 'freeze', 'fwd5']);
      parts.push(`${SI('gift').icon} ${SI('gift').name}:`);
    }
    const info = type === 'swap' || type === 'fwd5' ? null : SI(type);
    if (type === 'bonus') {
      extra = true;
      last().fx = { text: `${info.icon} Nochmal!`, color: SPECIAL_BASE.bonus.color, sound: 'good' };
      parts.push(`${info.icon} ${info.name} – nochmal würfeln!`);
      break;
    }
    if (type === 'fwd' || type === 'fwd5') {
      const n = type === 'fwd5' ? 5 : 3, i2 = SI('fwd');
      last().fx = { text: `${i2.icon} +${n}`, color: SPECIAL_BASE.fwd.color, sound: 'good' };
      pos = walk(path, pos, n, 'slide');
      parts.push(`${i2.icon} ${i2.name} +${n} → ${pos}`);
      continue;
    }
    if (type === 'back') {
      last().fx = { text: `${info.icon} −3`, color: SPECIAL_BASE.back.color, sound: 'bad' };
      pos = walk(path, pos, -3, 'slide');
      parts.push(`${info.icon} ${info.name} −3 → ${pos}`);
      continue;
    }
    if (type === 'freeze') {
      p.skip = true;
      last().fx = { text: `${info.icon} Aussetzen!`, color: SPECIAL_BASE.freeze.color, sound: 'bad' };
      parts.push(`${info.icon} ${info.name} – nächste Runde aussetzen`);
      break;
    }
    if (type === 'shield') {
      p.shield = true;
      last().fx = { text: `${info.icon} Schutz!`, color: SPECIAL_BASE.shield.color, sound: 'good' };
      parts.push(`${info.icon} ${info.name} eingesammelt`);
      break;
    }
    if (type === 'portal') {
      const other = +Object.keys(B.specials).find(c => B.specials[c] === 'portal' && +c !== pos);
      if (!other) break;
      path.push({ to: other, kind: 'portal', fx: { text: `${info.icon} Teleport!`, color: SPECIAL_BASE.portal.color, sound: 'good' } });
      parts.push(`${info.icon} ${info.name} → ${other}`);
      pos = other;
      break;
    }
    if (type === 'swap') {
      const others = st.players.filter(o => o !== p && o.pos > 0 && o.pos !== pos && o.pos !== 100);
      if (!others.length) {
        extra = true;
        last().fx = { text: '⭐ Nochmal!', color: SPECIAL_BASE.bonus.color, sound: 'good' };
        parts.push('nochmal würfeln!');
        break;
      }
      const o = pick(others);
      const delay = pathDur(path);
      moves.push({ id: o.id, from: o.pos, delay, path: [{ to: pos, kind: 'portal', fx: { text: '🔀 Getauscht!', color: '#ffd23f' } }] });
      path.push({ to: o.pos, kind: 'portal', fx: { text: '🔀 Platztausch!', color: '#ffd23f', sound: 'good' } });
      parts.push(`🔀 Platztausch mit ${o.name} (${o.pos})!`);
      const tmp = o.pos; o.pos = pos; pos = tmp;
      break;
    }
  }

  p.pos = pos;
  st.seq++;
  st.lastMove = { seq: st.seq, id: p.id, roll, moves };
  const total = Math.max(...moves.map(m => (m.delay || 0) + pathDur(m.path)));
  H.busyUntil = Date.now() + 150 + total + 350;
  if (pos === 100) {
    st.phase = 'over'; st.winner = p.id;
    parts.push(`🏆 ${p.name} gewinnt!`);
  } else if (extra) {
    if (roll === 6 && !parts.some(t => t.includes('nochmal'))) parts.push('– 6 = nochmal!');
  } else {
    hostAdvanceTurn();
  }
  hostLog(parts.join(' '));
  hostScheduleTurn();
  hostBroadcast();
}

function hostChat(id, text) {
  text = String(text || '').trim().slice(0, 200);
  if (!text) return;
  const p = H.state.players.find(x => x.id === id);
  if (!p) return;
  const msg = { t: 'chat', name: p.name, color: p.color, text };
  for (const conn of H.conns.values()) hostSend(conn, msg);
  addChat(msg);
}

function hostOnData(conn, m) {
  if (!m || typeof m !== 'object') return;
  H.seen.set(conn.peer, Date.now());
  const st = H.state;
  switch (m.t) {
    case 'probe':
      hostSend(conn, {
        t: 'info', players: st.players.length, max: MAX_PLAYERS, phase: st.phase, theme: st.theme, boardMode: st.boardMode,
        host: st.players[0] ? st.players[0].name : '?', humans: st.players.filter(p => !p.bot).length,
      });
      setTimeout(() => conn.close(), 1500);
      break;
    case 'join':
      if (H.conns.has(conn.peer)) return;
      if (st.players.length >= MAX_PLAYERS) {
        const bot = st.players.findIndex(p => p.bot);
        if (bot < 0) { hostSend(conn, { t: 'error', msg: 'Das Spiel ist voll (6/6).' }); setTimeout(() => conn.close(), 500); return; }
        hostRemovePlayer(st.players[bot].id); // Bot macht Platz für Menschen
      }
      H.conns.set(conn.peer, conn);
      hostAddPlayer(conn.peer, cleanName(m.name));
      if (st.phase === 'play') hostLog(`↪ ${cleanName(m.name)} steigt mitten im Spiel ein`);
      hostBroadcast();
      break;
    case 'roll': hostRoll(conn.peer, false); break;
    case 'chat': hostChat(conn.peer, m.text); break;
    case 'bye': hostDrop(conn.peer); break;
  }
}

function hostDrop(id) {
  if (!H || !H.conns.has(id)) return;
  const conn = H.conns.get(id);
  H.conns.delete(id);
  try { conn.close(); } catch (e) { /* ignore */ }
  hostRemovePlayer(id);
  hostBroadcast();
}

function createPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; peer.destroy(); reject({ type: 'timeout' }); } }, 12000);
    peer.on('open', () => { if (!done) { done = true; clearTimeout(to); resolve(peer); } });
    peer.on('error', e => { if (!done) { done = true; clearTimeout(to); peer.destroy(); reject(e); } });
  });
}

async function startHost(peerId, opts) {
  const peer = await createPeer(peerId);
  H = { peer, conns: new Map(), seen: new Map(), state: newState(opts), busyUntil: 0, deadline: 0 };
  myId = 'host';
  hostAddPlayer('host', myName());
  peer.on('connection', conn => {
    conn.on('data', m => hostOnData(conn, m));
    conn.on('close', () => hostDrop(conn.peer));
    conn.on('error', () => hostDrop(conn.peer));
  });
  peer.on('disconnected', () => { if (H && H.peer === peer && !peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
  peer.on('error', e => console.warn('Peer-Fehler', e.type));
  H.heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [id, conn] of H.conns) {
      hostSend(conn, { t: 'ping' });
      if (now - (H.seen.get(id) || now) > 15000) hostDrop(id);
    }
  }, 3000);
  enterRoom();
  hostBroadcast();
}

/* =========================================================
   CLIENT
   ========================================================= */
function joinGame(peerId) {
  return new Promise(async (resolve, reject) => {
    let peer;
    try { peer = await createPeer(); } catch (e) { reject(e); return; }
    let done = false;
    const fail = e => {
      if (done) return;
      done = true; clearTimeout(to); peer.destroy(); reject(e);
    };
    const to = setTimeout(() => fail({ type: 'timeout' }), 12000);
    peer.on('error', e => fail(e));
    const conn = peer.connect(peerId, { reliable: true });
    conn.on('open', () => conn.send({ t: 'join', name: myName() }));
    conn.on('data', m => {
      if (!m) return;
      if (m.t === 'error') { fail({ type: 'full', msg: m.msg }); }
      if (!done && m.t === 'state') {
        done = true; clearTimeout(to);
        C = { peer, conn, lastMsg: Date.now() };
        C.heartbeat = setInterval(() => {
          try { conn.send({ t: 'ping' }); } catch (e) { /* ignore */ }
          if (Date.now() - C.lastMsg > 15000) lostHost();
        }, 3000);
        conn.on('close', lostHost);
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        resolve();
      }
      if (C && C.conn === conn) clientOnData(m);
    });
  });
}

function clientOnData(m) {
  C.lastMsg = Date.now();
  if (m.t === 'state') { myId = m.you; onState(m.s, 'client', m.tl); }
  else if (m.t === 'chat') addChat(m);
  else if (m.t === 'error' && m.msg === 'closed') lostHost();
}

function lostHost() {
  if (!C) return;
  leaveRoom(true);
  show('menu');
  $('#menu-msg').textContent = 'Die Verbindung zum Host wurde getrennt.';
}

function sendAction(msg) {
  if (H) {
    if (msg.t === 'roll') hostRoll('host', false);
    if (msg.t === 'chat') hostChat('host', msg.text);
  } else if (C) {
    try { C.conn.send(msg); } catch (e) { /* ignore */ }
  }
}

/* =========================================================
   ÖFFENTLICHE LOBBYS
   ========================================================= */
const pubId = n => PREFIX + 'pub-' + n;

async function probeAll() {
  const peer = await createPeer();
  const results = new Array(PUBLIC_LOBBIES + 1).fill(undefined);
  return new Promise(resolve => {
    let pending = PUBLIC_LOBBIES;
    const finish = (n, val) => {
      if (results[n] !== undefined) return;
      results[n] = val;
      if (--pending === 0) { clearTimeout(to); setTimeout(() => peer.destroy(), 200); resolve(results); }
    };
    const to = setTimeout(() => {
      for (let n = 1; n <= PUBLIC_LOBBIES; n++) finish(n, null);
    }, 7000);
    peer.on('error', e => {
      const m = /(leiterli\S+pub-(\d+))/.exec(e.message || '');
      if (e.type === 'peer-unavailable' && m) finish(+m[2], null);
    });
    for (let n = 1; n <= PUBLIC_LOBBIES; n++) {
      const conn = peer.connect(pubId(n), { reliable: true });
      conn.on('open', () => conn.send({ t: 'probe' }));
      conn.on('data', m => { if (m && m.t === 'info') { finish(n, m); conn.close(); } });
    }
  });
}

async function renderBrowser() {
  const list = $('#lobby-list');
  list.innerHTML = '<div class="card">🔎 Suche Lobbys…</div>';
  let res;
  try { res = await probeAll(); } catch (e) {
    list.innerHTML = '<div class="card">❌ Keine Verbindung zum Lobby-Server. Internet prüfen und nochmal versuchen.</div>';
    return;
  }
  list.innerHTML = '';
  for (let n = 1; n <= PUBLIC_LOBBIES; n++) {
    const info = res[n];
    const el = document.createElement('button');
    el.className = 'card lobby';
    const full = info && info.players >= MAX_PLAYERS && info.humans >= MAX_PLAYERS;
    if (full) el.classList.add('full');
    const theme = info && THEMES[info.theme] ? THEMES[info.theme].name : '';
    const mode = info && BOARD_MODES[info.boardMode] ? ' · ' + BOARD_MODES[info.boardMode].name : '';
    el.innerHTML = `<span class="l-name">Lobby ${n}</span>` +
      (info
        ? `<span class="l-badge ${info.phase === 'lobby' ? 'open' : 'play'}">${info.phase === 'lobby' ? 'Wartet' : 'Läuft'}</span>
           <span class="l-info">👤 ${info.players}/${info.max} · Host: </span><span class="l-info">${theme}${mode}</span>`
        : `<span class="l-badge">Leer</span><span class="l-info">Klicke, um diese Lobby zu eröffnen</span>`);
    if (info) el.querySelector('.l-info').append(document.createTextNode(info.host));
    el.onclick = () => { if (!full && !connecting && !H && !C) enterPublic(n, info); };
    list.append(el);
  }
}

async function enterPublic(n, info) {
  busy(info ? `Trete Lobby ${n} bei…` : `Eröffne Lobby ${n}…`);
  try {
    if (info) {
      try { await joinGame(pubId(n)); enterRoom(); }
      catch (e) {
        if (e.type !== 'peer-unavailable') throw e;
        await startHost(pubId(n), { public: true, lobbyNo: n }); // Host war weg -> selbst eröffnen
      }
    } else {
      try { await startHost(pubId(n), { public: true, lobbyNo: n }); }
      catch (e) {
        if (e.type !== 'unavailable-id') throw e;
        await joinGame(pubId(n)); enterRoom(); // jemand war schneller -> beitreten
      }
    }
  } catch (e) {
    show('menu');
    $('#menu-msg').textContent = errText(e);
  } finally { busy(); }
}

async function quickPlay() {
  busy('Suche ein offenes Spiel…');
  let res;
  try { res = await probeAll(); } catch (e) { busy(); $('#menu-msg').textContent = errText(e); return; }
  busy();
  let best = 0, bestScore = -1;
  for (let n = 1; n <= PUBLIC_LOBBIES; n++) {
    const i = res[n];
    if (!i || i.humans >= MAX_PLAYERS) continue;
    const score = i.humans * 2 + (i.phase === 'lobby' ? 10 : 0);
    if (score > bestScore) { bestScore = score; best = n; }
  }
  if (best) return enterPublic(best, res[best]);
  for (let n = 1; n <= PUBLIC_LOBBIES; n++) if (!res[n]) return enterPublic(n, null);
  $('#menu-msg').textContent = 'Alle Lobbys sind voll – versuch es gleich nochmal.';
}

function errText(e) {
  if (!e) return 'Unbekannter Fehler.';
  if (e.type === 'peer-unavailable') return 'Kein Spiel mit diesem Code gefunden.';
  if (e.type === 'full') return e.msg;
  if (e.type === 'timeout') return 'Zeitüberschreitung – Verbindung fehlgeschlagen.';
  if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') return 'Keine Verbindung zum Server. Internet prüfen.';
  if (e.type === 'browser-incompatible') return 'Dein Browser unterstützt WebRTC nicht.';
  return 'Fehler: ' + (e.type || e.message || e);
}

/* =========================================================
   UI
   ========================================================= */
let winShown = false;
let rollAllowed = false;
let turnDeadline = 0;

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function setDie(v) {
  const pips = $('#die').children;
  for (let i = 0; i < 9; i++) pips[i].classList.toggle('on', !!v && PIPS[v].includes(i));
}

function enterRoom() {
  anims.clear(); lastSeq = -1; winShown = false;
  particles.length = 0; floaters.length = 0; trails.clear(); banner = null;
  $('#chat-msgs').innerHTML = '';
  $('#win-overlay').classList.add('hidden');
  $('#menu-msg').textContent = '';
  setDie(0);
  show('room');
  addChat({ sys: true, text: 'Willkommen! Fahre mit der Maus über ein Feld, um zu sehen, was es macht. Viel Glück 🍀' });
}

function onState(s, from, tl) {
  const prev = S;
  S = s;
  document.body.dataset.theme = s.theme;
  if (lastSeq < 0) lastSeq = s.seq;                  // beim Beitreten nichts nachspielen
  if (s.seq !== lastSeq) {
    if (s.lastMove && s.lastMove.seq === s.seq) {
      startMoveAnims(s.lastMove);
      rollDie(s.lastMove.roll);
    } else { anims.clear(); trails.clear(); }
    lastSeq = s.seq;
  }
  if (s.phase !== 'over') { winShown = false; $('#win-overlay').classList.add('hidden'); }
  if (prev && prev.phase !== 'play' && s.phase === 'play') { chime([523, 659, 784]); setDie(0); showBanner('Los geht’s! 🎬'); }
  const cur = s.players[s.turn];
  const prevCur = prev && prev.phase === 'play' ? prev.players[prev.turn] : null;
  if (s.phase === 'play' && cur && cur.id === myId && (!prevCur || prevCur.id !== myId || prev.seq !== s.seq) && !(prev && prev.phase !== 'play')) {
    const delay = s.lastMove ? Math.max(...s.lastMove.moves.map(m => (m.delay || 0) + pathDur(m.path))) + 400 : 0;
    setTimeout(() => { if (S && S.phase === 'play' && S.players[S.turn] && S.players[S.turn].id === myId) { showBanner('Du bist dran! 🎲', cur.color); beep(880, 0.12, 'sine', 0.05); } }, delay);
  }
  turnDeadline = tl ? Date.now() + tl : 0;
  renderSide();
}

function rollDie(v) {
  const die = $('#die');
  die.classList.remove('rolling'); void die.offsetWidth; die.classList.add('rolling');
  beep(200, 0.05, 'square', 0.04);
  let k = 0;
  const iv = setInterval(() => {
    setDie(1 + Math.floor(Math.random() * 6));
    if (++k > 6) { clearInterval(iv); setDie(v); }
  }, 60);
}

function renderSide() {
  const s = S, isHost = !!H;
  const T = THEMES[s.theme];
  $('#room-title').innerHTML = s.public
    ? `🌍 Öffentliche Lobby ${s.lobbyNo}`
    : `🔒 Code: <span class="code">${s.code}</span>`;
  $('#room-sub').textContent = `${T.name} · ${BOARD_MODES[s.boardMode].name}`;
  $('#btn-copy').style.display = s.public ? 'none' : '';

  const ul = $('#player-list');
  ul.innerHTML = '';
  s.players.forEach((p, i) => {
    const li = document.createElement('li');
    if (s.phase === 'play' && i === s.turn) li.className = 'turn';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
    const nm = document.createElement('span'); nm.className = 'pname';
    nm.textContent = (p.bot ? '🤖 ' : '') + p.name + (p.id === myId ? ' (du)' : '') + (p.id === 'host' ? ' 👑' : '')
      + (p.shield ? ' ' + specialInfo(s.theme, 'shield').icon : '') + (p.skip ? ' ' + specialInfo(s.theme, 'freeze').icon : '');
    const pos = document.createElement('span'); pos.className = 'ppos';
    pos.textContent = s.phase === 'lobby' ? '' : (p.pos ? 'Feld ' + p.pos : 'Start');
    const bar = document.createElement('span'); bar.className = 'pbar';
    bar.style.setProperty('--w', p.pos + '%'); bar.style.setProperty('--c', p.color);
    li.append(dot, nm, pos);
    if (s.phase !== 'lobby') li.append(bar);
    ul.append(li);
  });
  $('#player-count').textContent = `(${s.players.length}/${MAX_PLAYERS})`;

  const lobby = s.phase === 'lobby';
  $('#lobby-ctrl').style.display = lobby ? '' : 'none';
  $('#play-ctrl').style.display = lobby ? 'none' : '';
  $('#host-ctrl').style.display = isHost ? '' : 'none';
  $('#wait-msg').style.display = isHost ? 'none' : '';
  $('#btn-start').disabled = s.players.length < 1;
  $('#btn-start').textContent = s.players.length < 2 ? '▶ Allein starten' : '▶ Spiel starten';
  $('#btn-bot-add').disabled = s.players.length >= MAX_PLAYERS;
  $('#btn-bot-del').disabled = !s.players.some(p => p.bot);

  const tp = $('#theme-pick');
  tp.innerHTML = '';
  for (const [key, th] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'btn' + (key === s.theme ? ' sel' : '');
    b.textContent = th.name;
    b.disabled = !isHost;
    b.onclick = () => { H.state.theme = key; hostBroadcast(); };
    tp.append(b);
  }
  const bp = $('#board-pick');
  bp.innerHTML = '';
  for (const [key, bm] of Object.entries(BOARD_MODES)) {
    const b = document.createElement('button');
    b.className = 'btn' + (key === s.boardMode ? ' sel' : '');
    b.innerHTML = `<b></b><small></small>`;
    b.firstChild.textContent = bm.name; b.lastChild.textContent = bm.desc;
    b.disabled = !isHost;
    b.onclick = () => hostSetBoardMode(key);
    bp.append(b);
  }
  $('#btn-reroll').style.display = isHost && s.boardMode === 'zufall' ? '' : 'none';

  // Legende
  const counts = {};
  for (const t of Object.values(s.board.specials)) counts[t] = (counts[t] || 0) + 1;
  const leg = $('#legend');
  leg.innerHTML = '';
  const addRow = (icon, name, desc, color) => {
    const li = document.createElement('li');
    const ic = document.createElement('span'); ic.className = 'lg-icon'; ic.textContent = icon; ic.style.background = color;
    const tx = document.createElement('span'); tx.innerHTML = '<b></b> <small></small>';
    tx.firstChild.textContent = name; tx.lastChild.textContent = desc;
    li.append(ic, tx); leg.append(li);
  };
  addRow(T.upIcon, T.up, 'bringt dich nach oben', '#3ccf6e');
  addRow(T.downIcon, T.down, 'wirft dich zurück', '#ff5e6e');
  for (const type of Object.keys(SPECIAL_BASE)) {
    if (!counts[type]) continue;
    const i = specialInfo(s.theme, type);
    addRow(i.icon, i.name, i.desc, i.color);
  }

  const cur = s.players[s.turn];
  const mine = s.phase === 'play' && cur && cur.id === myId;
  $('#turn-label').textContent = s.phase === 'over'
    ? '🏆 ' + ((s.players.find(p => p.id === s.winner) || {}).name || '?') + ' hat gewonnen!'
    : mine ? '👉 Du bist dran!' : cur ? `${cur.bot ? '🤖 ' : ''}${cur.name} ist dran…` : '';
  $('#turn-label').style.color = cur && s.phase === 'play' ? cur.color : '';
  rollAllowed = mine;
  $('#btn-roll').disabled = !mine || anims.size > 0;

  const log = $('#log');
  log.innerHTML = '';
  for (const line of s.log.slice(0, 15)) {
    const li = document.createElement('li'); li.textContent = line; log.append(li);
  }
}

function showWin() {
  winShown = true;
  const w = S.players.find(p => p.id === S.winner);
  $('#win-text').textContent = w ? (w.id === myId ? '🎉 Du hast gewonnen!' : `${w.name} hat gewonnen!`) : 'Spiel vorbei';
  $('#win-host').style.display = H ? '' : 'none';
  $('#win-wait').style.display = H ? 'none' : '';
  $('#win-overlay').classList.remove('hidden');
  confetti();
  chime([523, 659, 784, 1046], 140);
}

function addChat(m) {
  const box = $('#chat-msgs');
  const div = document.createElement('div');
  if (m.sys) { div.className = 'sys'; div.textContent = m.text; }
  else {
    const n = document.createElement('span'); n.className = 'cn'; n.style.color = m.color; n.textContent = m.name + ': ';
    div.append(n, document.createTextNode(m.text));
  }
  box.append(div);
  while (box.children.length > 80) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

function leaveRoom(silent) {
  if (H) {
    clearInterval(H.heartbeat); clearTimeout(H.turnTimer);
    for (const conn of H.conns.values()) hostSend(conn, { t: 'error', msg: 'closed' });
    const peer = H.peer;
    H = null;
    setTimeout(() => peer.destroy(), 300);
  }
  if (C) {
    clearInterval(C.heartbeat);
    if (!silent) { try { C.conn.send({ t: 'bye' }); } catch (e) { /* ignore */ } }
    const peer = C.peer;
    C = null;
    setTimeout(() => peer.destroy(), 300);
  }
  S = null; myId = null; rollAllowed = false;
  $('#win-overlay').classList.add('hidden');
}

/* ---------------- Events ---------------- */
$('#inp-name').value = store('leiterli-name') || '';
$('#inp-name').addEventListener('change', () => store('leiterli-name', $('#inp-name').value.trim()));
$('#inp-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

function needName() {
  if (connecting || H || C) return false;
  if ($('#inp-name').value.trim()) { store('leiterli-name', $('#inp-name').value.trim()); return true; }
  $('#menu-msg').textContent = 'Bitte gib zuerst einen Namen ein.';
  $('#inp-name').focus();
  return false;
}

$('#btn-host').onclick = async () => {
  if (!needName()) return;
  busy('Erstelle Spiel…');
  for (let tries = 0; tries < 4; tries++) {
    const code = genCode();
    try { await startHost(PREFIX + 'p-' + code, { code }); busy(); return; }
    catch (e) { if (e.type !== 'unavailable-id') { busy(); $('#menu-msg').textContent = errText(e); return; } }
  }
  busy(); $('#menu-msg').textContent = 'Konnte kein Spiel erstellen.';
};

async function joinByCode(code) {
  if (code.length !== 5) { $('#menu-msg').textContent = 'Der Code hat 5 Zeichen.'; return; }
  if (!needName()) return;
  busy('Trete Spiel ' + code + ' bei…');
  try { await joinGame(PREFIX + 'p-' + code); enterRoom(); }
  catch (e) { $('#menu-msg').textContent = errText(e); }
  finally { busy(); }
}
$('#btn-join').onclick = () => joinByCode($('#inp-code').value.trim());
$('#inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

$('#btn-browser').onclick = () => { if (!needName()) return; show('browser'); renderBrowser(); };
$('#btn-browser-refresh').onclick = renderBrowser;
$('#btn-browser-back').onclick = () => show('menu');
$('#btn-quick').onclick = () => { if (needName()) quickPlay(); };

$('#btn-leave').onclick = () => { leaveRoom(); show('menu'); };
$('#btn-copy').onclick = async () => {
  const url = location.origin + location.pathname + '?code=' + S.code;
  try { await navigator.clipboard.writeText(url); toast('Einladungslink kopiert!'); }
  catch (e) { toast('Code: ' + S.code); }
};
$('#btn-start').onclick = () => H && hostStart();
$('#btn-reroll').onclick = () => H && hostSetBoardMode('zufall');
$('#btn-bot-add').onclick = () => {
  if (!H || H.state.players.length >= MAX_PLAYERS) return;
  const used = new Set(H.state.players.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
  hostAddPlayer('bot-' + Math.random().toString(36).slice(2, 7), name, true);
  hostBroadcast();
};
$('#btn-bot-del').onclick = () => {
  if (!H) return;
  const bots = H.state.players.filter(p => p.bot);
  if (bots.length) { hostRemovePlayer(bots[bots.length - 1].id); hostBroadcast(); }
};
$('#btn-roll').onclick = () => { rollAllowed = false; $('#btn-roll').disabled = true; sendAction({ t: 'roll' }); };
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && !$('#btn-roll').disabled
    && $('#scr-room').classList.contains('active')) { e.preventDefault(); $('#btn-roll').click(); }
});
$('#chat-form').onsubmit = e => {
  e.preventDefault();
  const v = $('#chat-inp').value.trim();
  if (v) sendAction({ t: 'chat', text: v });
  $('#chat-inp').value = '';
};
$('#btn-again').onclick = () => H && hostStart();
$('#btn-tolobby').onclick = () => H && hostToLobby();
$('#btn-win-close').onclick = () => $('#win-overlay').classList.add('hidden');

setInterval(() => {
  // abgelaufene Animationen auch in Hintergrund-Tabs (ohne requestAnimationFrame) aufräumen
  const now = performance.now();
  for (const [id, an] of anims) if (now - an.start > an.total + 100) anims.delete(id);
  if (rollAllowed && !anims.size) $('#btn-roll').disabled = false;
  if (S && S.phase === 'over' && !anims.size && !winShown) showWin();
  const el = $('#turn-timer');
  if (!S || S.phase !== 'play' || !turnDeadline) { el.textContent = ''; return; }
  const left = Math.ceil((turnDeadline - Date.now()) / 1000);
  el.textContent = left <= 15 && left > 0 ? `Automatischer Wurf in ${left}s` : '';
}, 500);

window.addEventListener('beforeunload', () => leaveRoom());
window.addEventListener('resize', () => { const d = Math.min(window.devicePixelRatio || 1, 2); if (d !== dpr) resizeCanvas(); });

resizeCanvas();
requestAnimationFrame(frame);

// Einladungslink ?code=XXXXX
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) {
  $('#inp-code').value = urlCode.toUpperCase().slice(0, 5);
  history.replaceState(null, '', location.pathname);
  if ($('#inp-name').value.trim()) joinByCode($('#inp-code').value);
  else $('#menu-msg').textContent = 'Gib deinen Namen ein und klicke auf „Beitreten“.';
}
if (typeof Peer === 'undefined') $('#menu-msg').textContent = 'Netzwerk-Bibliothek konnte nicht geladen werden (Internet?).';
