'use strict';
/* =========================================================
   Leiterlispiel Online
   - Peer-to-Peer über PeerJS (WebRTC), kein eigener Server nötig
   - Der Host ist "Server": er würfelt, prüft Züge und verteilt den Zustand
   - Private Spiele: Peer-ID aus 5-stelligem Code
   - Öffentliche Lobbys: feste Peer-IDs pub-1 … pub-8
   ========================================================= */

const $ = s => document.querySelector(s);
const PREFIX = 'leiterli-tb1-';
const MAX_PLAYERS = 6;
const PUBLIC_LOBBIES = 8;
const TURN_MS = 30000;          // Auto-Wurf, wenn jemand nicht würfelt
const STEP_MS = 170;
const JUMP_MS = 750;
const COLORS = ['#e63946', '#1d72f2', '#2a9d3a', '#f4a300', '#8e44ad', '#ff6fb5'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const BOT_NAMES = ['Robo', 'Bip', 'Byte', 'Chip', 'Pixel', 'Servo'];

// Leitern (hoch) und Schlangen (runter)
const JUMPS = {
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};

/* ---------------- Hilfsfunktionen ---------------- */
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}
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
function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

/* =========================================================
   THEMEN
   ========================================================= */
const THEMES = {
  flugzeuge: {
    name: '✈️ Flugzeuge', up: 'Aufwind', down: 'Turbulenz', upIcon: '✈️', downIcon: '🌪️',
    goal: '🛬', token: 'plane', num: '#2b4a66',
    cells: ['rgba(255,255,255,0.82)', 'rgba(205,232,255,0.82)'],
    bg(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#4fb3f6'); g.addColorStop(1, '#bfe6ff');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const r = rng(7);
      for (let i = 0; i < 9; i++) cloud(ctx, r() * W, r() * 600, 18 + r() * 22);
    },
    drawUp(ctx, a, b) { // Kondensstreifen mit steigendem Flugzeug
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const px = -Math.sin(ang) * 5, py = Math.cos(ang) * 5;
      ctx.save();
      ctx.lineCap = 'round';
      for (const s of [1, -1]) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 5;
        ctx.setLineDash([10, 7]);
        ctx.beginPath(); ctx.moveTo(a.x + px * s, a.y + py * s); ctx.lineTo(b.x + px * s, b.y + py * s); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(29,114,242,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      drawPlane(ctx, b.x, b.y, ang, 40, '#ffffff', '#1d72f2');
      drawPlane(ctx, a.x, a.y, ang, 18, 'rgba(255,255,255,0.7)', 'rgba(29,114,242,0.5)');
    },
    drawDown(ctx, a, b) { // Sturzflug durch Turbulenz
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      ctx.save();
      ctx.strokeStyle = 'rgba(70,70,80,0.55)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath();
      const steps = Math.max(4, Math.round(len / 22));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, z = (i % 2 ? 1 : -1) * 9 * (i && i < steps ? 1 : 0);
        const x = a.x + (b.x - a.x) * t + nx * z, y = a.y + (b.y - a.y) * t + ny * z;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      const r = rng(Math.round(a.x * 7 + b.y));
      for (let i = 1; i < steps * 2; i++) {
        const t = i / (steps * 2);
        ctx.fillStyle = `rgba(90,90,100,${0.15 + t * 0.35})`;
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * t + (r() - 0.5) * 10, a.y + (b.y - a.y) * t + (r() - 0.5) * 10, 4 + t * 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.font = '22px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🌪️', a.x, a.y - 2);
      drawPlane(ctx, b.x, b.y, ang, 36, '#e63946', '#7a1219');
    },
  },

  klassisch: {
    name: '🐍 Klassisch', up: 'Leiter', down: 'Schlange', upIcon: '🪜', downIcon: '🐍',
    goal: '🏆', token: 'pawn', num: '#5a3a1a',
    cells: ['#ffe8a3', '#ffc9a3', '#c7f0b4', '#b4dcf0', '#f0c4e0'],
    bg(ctx, W, H) { ctx.fillStyle = '#e9c38a'; ctx.fillRect(0, 0, W, H); },
    drawUp(ctx, a, b) { drawLadder(ctx, a, b, '#9a5b25', '#6b3a12'); },
    drawDown(ctx, a, b) { drawSerpent(ctx, a, b, { body: '#3aa845', dark: '#1d5e23', spots: '#f4d35e', head: 'snake' }); },
  },

  weltraum: {
    name: '🚀 Weltraum', up: 'Raketen-Boost', down: 'Schwarzes Loch', upIcon: '🚀', downIcon: '🕳️',
    goal: '🪐', token: 'ufo', num: '#c9c2ff',
    cells: ['rgba(60,45,130,0.72)', 'rgba(25,22,70,0.72)'],
    bg(ctx, W, H) {
      ctx.fillStyle = '#0b0b1e'; ctx.fillRect(0, 0, W, H);
      const r = rng(3);
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
        ctx.fillRect(r() * W, r() * H, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1);
      }
      const g = ctx.createRadialGradient(470, 120, 10, 470, 120, 260);
      g.addColorStop(0, 'rgba(177,76,255,0.35)'); g.addColorStop(1, 'rgba(177,76,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    },
    drawUp(ctx, a, b) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, 'rgba(255,200,0,0)'); g.addColorStop(0.6, 'rgba(255,140,0,0.7)'); g.addColorStop(1, 'rgba(255,240,150,0.95)');
      ctx.save();
      ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      drawRocket(ctx, b.x, b.y, ang, 38);
    },
    drawDown(ctx, a, b) {
      ctx.save();
      ctx.strokeStyle = 'rgba(177,76,255,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([3, 7]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2 + 40, (a.y + b.y) / 2, b.x, b.y); ctx.stroke();
      ctx.restore();
      blackHole(ctx, a.x, a.y, 24);
      blackHole(ctx, b.x, b.y, 10);
    },
  },

  unterwasser: {
    name: '🐙 Unterwasser', up: 'Luftblasen', down: 'Krake', upIcon: '🫧', downIcon: '🐙',
    goal: '💎', token: 'fish', num: '#06324f',
    cells: ['rgba(140,230,240,0.72)', 'rgba(80,190,220,0.72)'],
    bg(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1fa3c9'); g.addColorStop(1, '#063a5e');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(60 + i * 130, 0); ctx.lineTo(120 + i * 130, 0); ctx.lineTo(20 + i * 140, H); ctx.lineTo(-30 + i * 140, H); ctx.fill();
      }
    },
    drawUp(ctx, a, b) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(5, Math.round(len / 18));
      ctx.save();
      for (let i = 0; i <= n; i++) {
        const t = i / n, w = Math.sin(t * Math.PI * 4) * 6;
        const x = a.x + (b.x - a.x) * t + w, y = a.y + (b.y - a.y) * t;
        const r = 4 + t * 7;
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    },
    drawDown(ctx, a, b) { drawSerpent(ctx, a, b, { body: '#9b4dca', dark: '#4e1f6e', spots: '#f2c6ff', head: 'octopus' }); },
  },
};

/* ---------------- Zeichen-Bausteine ---------------- */
function cloud(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(x, y, s, 0, Math.PI * 2);
  ctx.arc(x + s, y + s * 0.2, s * 0.8, 0, Math.PI * 2);
  ctx.arc(x - s, y + s * 0.25, s * 0.7, 0, Math.PI * 2);
  ctx.arc(x + s * 0.3, y - s * 0.5, s * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlane(ctx, x, y, ang, s, fill, stroke) {
  const P = [[0.5, 0], [0.38, -0.07], [0.08, -0.07], [-0.12, -0.5], [-0.24, -0.5], [-0.12, -0.07], [-0.36, -0.06],
    [-0.46, -0.22], [-0.54, -0.22], [-0.48, 0]];
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
  ctx.beginPath();
  P.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
  for (let i = P.length - 2; i >= 1; i--) ctx.lineTo(P[i][0], -P[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 2 / s; ctx.strokeStyle = stroke || 'rgba(0,0,0,0.6)'; ctx.stroke();
  ctx.fillStyle = 'rgba(120,200,255,0.9)';
  ctx.beginPath(); ctx.ellipse(0.33, 0, 0.06, 0.035, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawRocket(ctx, x, y, ang, s) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
  ctx.fillStyle = '#ff5a36';
  ctx.beginPath(); ctx.moveTo(-0.3, -0.14); ctx.lineTo(-0.5, -0.3); ctx.lineTo(-0.42, 0); ctx.lineTo(-0.5, 0.3); ctx.lineTo(-0.3, 0.14); ctx.fill();
  ctx.fillStyle = '#eef0f8'; ctx.strokeStyle = '#555'; ctx.lineWidth = 0.04;
  ctx.beginPath(); ctx.moveTo(0.5, 0); ctx.quadraticCurveTo(0.25, -0.18, -0.38, -0.15); ctx.lineTo(-0.38, 0.15); ctx.quadraticCurveTo(0.25, 0.18, 0.5, 0); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3fc1ff';
  ctx.beginPath(); ctx.arc(0.12, 0, 0.07, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffcc33';
  ctx.beginPath(); ctx.moveTo(-0.38, -0.08); ctx.lineTo(-0.62, 0); ctx.lineTo(-0.38, 0.08); ctx.fill();
  ctx.restore();
}

function blackHole(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6);
  g.addColorStop(0, '#000'); g.addColorStop(0.45, '#000'); g.addColorStop(0.6, 'rgba(177,76,255,0.9)'); g.addColorStop(1, 'rgba(177,76,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,170,255,0.7)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(x, y, r * (0.7 + i * 0.25), i * 2, i * 2 + 2.2); ctx.stroke();
  }
  ctx.restore();
}

function drawLadder(ctx, a, b, wood, dark) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  ctx.save();
  ctx.translate(a.x, a.y); ctx.rotate(ang);
  ctx.lineCap = 'round';
  for (const [w, c] of [[8, dark], [5, wood]]) {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    for (let r = 0.8; r < len - 4; r += 17) {
      ctx.beginPath(); ctx.moveTo(r, -11); ctx.lineTo(r, 11); ctx.stroke();
    }
    for (const s of [-12, 12]) {
      ctx.beginPath(); ctx.moveTo(-6, s); ctx.lineTo(len + 6, s); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSerpent(ctx, a, b, o) { // Schlange bzw. Krakenarm: Kopf bei a (oben), Schwanz bei b
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const waves = Math.max(1, len / 110), amp = Math.min(20, 8 + len * 0.05);
  const N = 60, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, e = Math.sin(t * Math.PI);
    const off = Math.sin(t * Math.PI * 2 * waves) * amp * e;
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off, w: 15 - t * 11 });
  }
  ctx.save();
  ctx.lineCap = 'round';
  for (const [extra, col] of [[3, o.dark], [0, o.body]]) {
    ctx.strokeStyle = col;
    for (let i = 0; i < N; i++) {
      ctx.lineWidth = pts[i].w + extra;
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.stroke();
    }
  }
  ctx.fillStyle = o.spots;
  for (let i = 4; i < N - 4; i += 5) {
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, pts[i].w * 0.22, 0, Math.PI * 2); ctx.fill();
  }
  // Kopf
  const h = pts[0], ang = Math.atan2(pts[0].y - pts[3].y, pts[0].x - pts[3].x);
  ctx.translate(h.x, h.y);
  if (o.head === 'octopus') {
    ctx.fillStyle = o.body; ctx.strokeStyle = o.dark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, -6, 17, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const ex of [-6, 6]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, -6, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex, -5, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.rotate(ang);
    ctx.strokeStyle = '#d62828'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(20, 0); ctx.lineTo(24, -3); ctx.moveTo(20, 0); ctx.lineTo(24, 3); ctx.stroke();
    ctx.fillStyle = o.body; ctx.strokeStyle = o.dark;
    ctx.beginPath(); ctx.ellipse(2, 0, 13, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const ey of [-5, 5]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(5, ey, 3.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6, ey, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawToken(ctx, kind, x, y, s, color, ang, letter) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
  if (kind === 'plane') {
    drawPlane(ctx, x, y, ang, s * 1.5, color, '#111');
  } else if (kind === 'ufo') {
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(170,230,255,0.85)';
    ctx.beginPath(); ctx.ellipse(0, -s * 0.18, s * 0.28, s * 0.25, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = color; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.55, s * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff59a';
    for (const lx of [-0.32, 0, 0.32]) { ctx.beginPath(); ctx.arc(lx * s, s * 0.04, s * 0.05, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'fish') {
    ctx.translate(x, y); ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1);
    ctx.fillStyle = color; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-s * 0.25, 0); ctx.lineTo(-s * 0.55, -s * 0.25); ctx.lineTo(-s * 0.55, s * 0.25); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.38, s * 0.24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * 0.18, -s * 0.05, s * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.05, s * 0.04, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.translate(x, y);
    ctx.fillStyle = color; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.arc(-s * 0.13, -s * 0.13, s * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(s * 0.45)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, 0, 1);
  }
  ctx.restore();
}

/* =========================================================
   BRETT
   ========================================================= */
const BW = 600, BH = 660, CELL = 60;
const canvas = $('#board');
const ctx = canvas.getContext('2d');
let dpr = 1, boardCache = null, cacheTheme = null;

function cellXY(n) {
  const r = Math.floor((n - 1) / 10);
  let c = (n - 1) % 10;
  if (r % 2) c = 9 - c;
  return { x: c * CELL + CELL / 2, y: (9 - r) * CELL + CELL / 2 };
}
function rowAngle(n) { // Flugrichtung in der Reihe
  if (n <= 0) return 0;
  return Math.floor((n - 1) / 10) % 2 ? Math.PI : 0;
}

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = BW * dpr; canvas.height = BH * dpr;
  boardCache = null;
}

function buildBoard(themeKey) {
  const T = THEMES[themeKey];
  const c = document.createElement('canvas');
  c.width = BW * dpr; c.height = BH * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  T.bg(g, BW, BH);
  for (let n = 1; n <= 100; n++) {
    const { x, y } = cellXY(n);
    const r = Math.floor((n - 1) / 10), col = (n - 1) % 10;
    g.fillStyle = T.cells[(r + col) % T.cells.length];
    g.fillRect(x - CELL / 2 + 1, y - CELL / 2 + 1, CELL - 2, CELL - 2);
    g.fillStyle = T.num; g.font = 'bold 12px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(n, x - CELL / 2 + 5, y - CELL / 2 + 4);
  }
  g.font = '30px "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const goal = cellXY(100);
  g.fillText(T.goal, goal.x, goal.y + 4);
  // erst runter, dann hoch zeichnen (Leitern liegen oben)
  const pairs = Object.entries(JUMPS).map(([f, t]) => [+f, t]);
  for (const [f, t] of pairs) if (t < f) T.drawDown(g, cellXY(f), cellXY(t));
  for (const [f, t] of pairs) if (t > f) T.drawUp(g, cellXY(f), cellXY(t));
  // Startbereich
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 600, BW, 60);
  g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'left';
  g.fillText('START', 8, 630);
  return c;
}

/* ---------------- Animation ---------------- */
const anims = new Map();      // playerId -> {segs, t0, total}
let lastSeq = -1;

function startMoveAnim(move) {
  const segs = [];
  let cur = move.from, t = 0;
  for (const p of move.path) {
    const dur = p.jump ? JUMP_MS : STEP_MS;
    segs.push({ a: cur, b: p.to, t0: t, dur, jump: p.jump });
    t += dur; cur = p.to;
  }
  anims.set(move.id, { segs, start: performance.now() + 150, total: t, soundIdx: -1 });
}

function slotXY(cell, idx) {
  if (cell <= 0) return { x: 90 + idx * 80, y: 630 };
  return cellXY(cell);
}

function tokenState(p, idx, now) {
  const an = anims.get(p.id);
  if (an) {
    const e = now - an.start;
    if (e < 0) return { cell: an.segs[0].a, ...slotXY(an.segs[0].a, idx), ang: rowAngle(Math.max(1, an.segs[0].a)), moving: true };
    if (e < an.total) {
      const si = an.segs.findIndex(s => e < s.t0 + s.dur);
      const s = an.segs[si];
      if (si !== an.soundIdx) {
        an.soundIdx = si;
        if (s.jump) s.b > s.a ? beep(300, 0.6, 'triangle', 0.07, 900) : beep(700, 0.6, 'sawtooth', 0.04, 120);
        else beep(520 + (si % 2) * 80, 0.05, 'square', 0.03);
      }
      const k = (e - s.t0) / s.dur;
      const A = slotXY(s.a, idx), B = slotXY(s.b, idx);
      const ease = s.jump ? k * k * (3 - 2 * k) : k;
      const lift = s.jump ? 0 : Math.sin(k * Math.PI) * 10;
      return {
        x: A.x + (B.x - A.x) * ease, y: A.y + (B.y - A.y) * ease - lift,
        ang: s.jump || s.a <= 0 ? Math.atan2(B.y - A.y, B.x - A.x) : (s.b < s.a ? rowAngle(s.a) + Math.PI : rowAngle(s.a)),
        moving: true,
      };
    }
    anims.delete(p.id);
  }
  return { cell: p.pos, ...slotXY(p.pos, idx), ang: rowAngle(p.pos), moving: false };
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!S || !$('#scr-room').classList.contains('active')) return;
  const theme = THEMES[S.theme] ? S.theme : 'flugzeuge';
  if (!boardCache || cacheTheme !== theme) { boardCache = buildBoard(theme); cacheTheme = theme; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(boardCache, 0, 0);
  ctx.scale(dpr, dpr);

  const T = THEMES[theme];
  const toks = S.players.map((p, i) => ({ p, i, ...tokenState(p, i, now) }));
  // mehrere Figuren auf demselben Feld leicht versetzen
  const groups = {};
  toks.forEach(t => { if (!t.moving && t.cell > 0) (groups[t.cell] = groups[t.cell] || []).push(t); });
  const OFF = [[-12, -10], [12, 10], [12, -10], [-12, 10], [0, -16], [0, 16]];
  for (const list of Object.values(groups)) {
    if (list.length > 1) list.forEach((t, k) => { t.x += OFF[k][0]; t.y += OFF[k][1]; t.small = true; });
  }
  const cur = S.phase === 'play' ? S.players[S.turn] : null;
  toks.sort((a, b) => (a.moving - b.moving) || ((cur && a.p.id === cur.id) - (cur && b.p.id === cur.id)));
  for (const t of toks) {
    const size = t.small ? 26 : 34;
    if (cur && t.p.id === cur.id && !t.moving) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 250);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + pulse * 0.5})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, size * 0.55 + pulse * 4, 0, Math.PI * 2); ctx.stroke();
    }
    drawToken(ctx, T.token, t.x, t.y, size, t.p.color, t.ang, t.p.name[0].toUpperCase());
  }
  if (S.phase === 'over' && anims.size === 0 && !winShown) showWin();
  const rb = $('#btn-roll');
  if (rb.disabled && rollAllowed && anims.size === 0) rb.disabled = false;
  else if (!rb.disabled && anims.size > 0) rb.disabled = true;
}

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
    theme: opts.theme || 'flugzeuge', log: [], public: !!opts.public, code: opts.code || null,
    lobbyNo: opts.lobbyNo || null,
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
  const st = H.state;
  st.players.push({ id, name, color: freeColor(), pos: 0, bot: !!bot });
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

function hostStart() {
  const st = H.state;
  if (st.players.length < 1) return;
  st.players.forEach(p => p.pos = 0);
  st.phase = 'play'; st.winner = null; st.lastMove = null;
  st.turn = Math.floor(Math.random() * st.players.length);
  st.seq++;
  hostLog(`🎬 Spiel gestartet – ${st.players[st.turn].name} beginnt`);
  H.busyUntil = 0;
  hostScheduleTurn();
  hostBroadcast();
}

function hostToLobby() {
  const st = H.state;
  st.phase = 'lobby'; st.winner = null; st.lastMove = null;
  st.players.forEach(p => p.pos = 0);
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
  const T = THEMES[st.theme];
  const roll = 1 + Math.floor(Math.random() * 6);
  const from = p.pos;
  const path = [];
  let pos = from, dir = 1;
  for (let i = 0; i < roll; i++) { // über 100 hinaus -> zurückprallen
    if (pos === 100) dir = -1;
    pos += dir;
    path.push({ to: pos });
  }
  let text = `${auto && !p.bot ? '⏰ ' : ''}${p.name} würfelt ${roll} → ${pos}`;
  if (from + roll > 100) text += ' (zurückgeprallt)';
  const jumpTo = JUMPS[pos];
  if (jumpTo) {
    path.push({ to: jumpTo, jump: true });
    text += jumpTo > pos ? ` ${T.upIcon} ${T.up} bis ${jumpTo}!` : ` ${T.downIcon} ${T.down} – runter auf ${jumpTo}!`;
    pos = jumpTo;
  }
  p.pos = pos;
  st.seq++;
  st.lastMove = { seq: st.seq, id: p.id, roll, from, path };
  H.busyUntil = Date.now() + 150 + path.reduce((t, s) => t + (s.jump ? JUMP_MS : STEP_MS), 0) + 300;
  if (pos === 100) {
    st.phase = 'over'; st.winner = p.id;
    text += ` 🏆 ${p.name} gewinnt!`;
  } else if (roll === 6) {
    text += ' – nochmal!';
  } else {
    st.turn = (st.turn + 1) % st.players.length;
  }
  hostLog(text);
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
        t: 'info', players: st.players.length, max: MAX_PLAYERS, phase: st.phase, theme: st.theme,
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
      if (m.t === 'error') { fail({ type: 'full', msg: m.msg }); return; }
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
      if (C) clientOnData(m);
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
    el.innerHTML = `<span class="l-name">Lobby ${n}</span>` +
      (info
        ? `<span class="l-badge ${info.phase === 'lobby' ? 'open' : 'play'}">${info.phase === 'lobby' ? 'Wartet' : 'Läuft'}</span>
           <span class="l-info">👤 ${info.players}/${info.max} · Host: </span><span class="l-info">${theme}</span>`
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
let lastRollShown = 0;

function enterRoom() {
  anims.clear(); lastSeq = -1; winShown = false;
  $('#chat-msgs').innerHTML = '';
  $('#win-overlay').classList.add('hidden');
  $('#menu-msg').textContent = '';
  show('room');
  addChat({ sys: true, text: 'Willkommen! Viel Glück 🍀' });
}

function onState(s, from, tl) {
  const prevPhase = S && S.phase;
  S = s;
  document.body.dataset.theme = s.theme;
  if (lastSeq < 0) lastSeq = s.seq;                  // beim Beitreten nichts nachspielen
  if (s.seq !== lastSeq) {
    if (s.lastMove && s.lastMove.seq === s.seq) {
      startMoveAnim(s.lastMove);
      rollDie(s.lastMove.roll);
    } else { anims.clear(); }
    lastSeq = s.seq;
  }
  if (s.phase !== 'over') { winShown = false; $('#win-overlay').classList.add('hidden'); }
  if (prevPhase === 'lobby' && s.phase === 'play') { beep(660, 0.15); $('#die').textContent = '🎲'; }
  turnDeadline = tl ? Date.now() + tl : 0;
  renderSide();
}

function rollDie(v) {
  const die = $('#die');
  die.classList.remove('rolling'); void die.offsetWidth; die.classList.add('rolling');
  beep(200, 0.05, 'square', 0.04);
  let k = 0;
  const iv = setInterval(() => {
    die.textContent = DIE_FACES[1 + Math.floor(Math.random() * 6)];
    if (++k > 5) { clearInterval(iv); die.textContent = DIE_FACES[v]; }
  }, 60);
}

function renderSide() {
  const s = S, isHost = !!H;
  const T = THEMES[s.theme];
  $('#room-title').innerHTML = s.public
    ? `🌍 Öffentliche Lobby ${s.lobbyNo}`
    : `🔒 Code: <span class="code">${s.code}</span>`;
  $('#room-sub').textContent = `${T.name} · ${T.upIcon} ${T.up} / ${T.downIcon} ${T.down}`;
  $('#btn-copy').style.display = s.public ? 'none' : '';

  const ul = $('#player-list');
  ul.innerHTML = '';
  s.players.forEach((p, i) => {
    const li = document.createElement('li');
    if (s.phase === 'play' && i === s.turn) li.className = 'turn';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
    const nm = document.createElement('span'); nm.className = 'pname';
    nm.textContent = (p.bot ? '🤖 ' : '') + p.name + (p.id === myId ? ' (du)' : '') + (i === 0 && !p.bot && p.id === 'host' ? ' 👑' : '');
    const pos = document.createElement('span'); pos.className = 'ppos';
    pos.textContent = s.phase === 'lobby' ? '' : (p.pos ? 'Feld ' + p.pos : 'Start');
    li.append(dot, nm, pos);
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

  const pick = $('#theme-pick');
  pick.innerHTML = '';
  for (const [key, th] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'btn' + (key === s.theme ? ' sel' : '');
    b.textContent = th.name;
    b.disabled = !isHost;
    b.onclick = () => { H.state.theme = key; hostBroadcast(); };
    pick.append(b);
  }

  const cur = s.players[s.turn];
  const mine = s.phase === 'play' && cur && cur.id === myId;
  $('#turn-label').textContent = s.phase === 'over'
    ? '🏆 ' + ((s.players.find(p => p.id === s.winner) || {}).name || '?') + ' hat gewonnen!'
    : mine ? '👉 Du bist dran!' : cur ? `${cur.bot ? '🤖 ' : ''}${cur.name} ist dran…` : '';
  $('#turn-label').style.color = cur && s.phase === 'play' ? cur.color : '';
  rollAllowed = mine;
  $('#btn-roll').disabled = !mine || anims.size > 0;
  if (mine && s.lastMove && s.lastMove.id !== myId) beep(880, 0.12, 'sine', 0.05);

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
  [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.06), i * 140));
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
  S = null; myId = null;
  $('#win-overlay').classList.add('hidden');
}

/* ---------------- Events ---------------- */
$('#inp-name').value = store('leiterli-name') || '';
$('#inp-name').addEventListener('change', () => store('leiterli-name', $('#inp-name').value.trim()));
$('#inp-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

let connecting = false;
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
