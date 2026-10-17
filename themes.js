'use strict';
/* =========================================================
   Themen, Spezialfelder und das Zeichnen des Spielbretts
   ========================================================= */

const BW = 640, BH = 720, CELL = 60, OX = 20, OY = 20;   // Brett 600x600 bei (20,20), darunter Startbahn

function cellXY(n) {
  const r = Math.floor((n - 1) / 10);
  let c = (n - 1) % 10;
  if (r % 2) c = 9 - c;
  return { x: OX + c * CELL + CELL / 2, y: OY + (9 - r) * CELL + CELL / 2 };
}
function cellAt(x, y) { // Brett-Koordinate -> Feldnummer
  const c = Math.floor((x - OX) / CELL), rr_ = 9 - Math.floor((y - OY) / CELL);
  if (c < 0 || c > 9 || rr_ < 0 || rr_ > 9) return 0;
  return rr_ * 10 + (rr_ % 2 ? 9 - c : c) + 1;
}
function rowAngle(n) {
  if (n <= 0) return 0;
  return Math.floor((n - 1) / 10) % 2 ? Math.PI : 0;
}
function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/* ---------------- Spezialfelder ---------------- */
const SPECIAL_BASE = {
  bonus:  { color: '#ffc93c', desc: 'Nochmal würfeln' },
  fwd:    { color: '#3ccf6e', desc: '3 Felder vorwärts' },
  back:   { color: '#ff8a3c', desc: '3 Felder zurück' },
  freeze: { color: '#7fd3ff', desc: 'Nächste Runde aussetzen' },
  portal: { color: '#b26bff', desc: 'Teleport zum anderen Portal' },
  gift:   { color: '#ff6fb5', desc: 'Zufällige Überraschung – gut oder schlecht!' },
  shield: { color: '#9fb4dd', desc: 'Schützt einmal vor dem Absturz' },
};
function specialInfo(themeKey, type) {
  const T = THEMES[themeKey] || THEMES.flugzeuge;
  const [icon, name] = T.specials[type];
  return { icon, name, ...SPECIAL_BASE[type] };
}

/* ---------------- Zeichen-Bausteine ---------------- */
function cloud(g, x, y, s, a = 0.8) {
  g.fillStyle = `rgba(255,255,255,${a})`;
  g.beginPath();
  g.arc(x, y, s, 0, Math.PI * 2);
  g.arc(x + s, y + s * 0.2, s * 0.8, 0, Math.PI * 2);
  g.arc(x - s, y + s * 0.25, s * 0.7, 0, Math.PI * 2);
  g.arc(x + s * 0.3, y - s * 0.5, s * 0.7, 0, Math.PI * 2);
  g.fill();
}

function drawPlane(g, x, y, ang, s, fill, stroke) {
  const P = [[0.5, 0], [0.38, -0.07], [0.08, -0.07], [-0.12, -0.5], [-0.24, -0.5], [-0.12, -0.07], [-0.36, -0.06],
    [-0.46, -0.22], [-0.54, -0.22], [-0.48, 0]];
  g.save();
  g.translate(x, y); g.rotate(ang); g.scale(s, s);
  g.beginPath();
  P.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
  for (let i = P.length - 2; i >= 1; i--) g.lineTo(P[i][0], -P[i][1]);
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.lineWidth = 2 / s; g.strokeStyle = stroke || 'rgba(0,0,0,0.6)'; g.stroke();
  g.fillStyle = 'rgba(120,200,255,0.95)';
  g.beginPath(); g.ellipse(0.33, 0, 0.06, 0.035, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawRocket(g, x, y, ang, s) {
  g.save();
  g.translate(x, y); g.rotate(ang); g.scale(s, s);
  g.fillStyle = '#ff5a36';
  g.beginPath(); g.moveTo(-0.3, -0.14); g.lineTo(-0.5, -0.3); g.lineTo(-0.42, 0); g.lineTo(-0.5, 0.3); g.lineTo(-0.3, 0.14); g.fill();
  g.fillStyle = '#eef0f8'; g.strokeStyle = '#555'; g.lineWidth = 0.04;
  g.beginPath(); g.moveTo(0.5, 0); g.quadraticCurveTo(0.25, -0.18, -0.38, -0.15); g.lineTo(-0.38, 0.15); g.quadraticCurveTo(0.25, 0.18, 0.5, 0); g.fill(); g.stroke();
  g.fillStyle = '#3fc1ff';
  g.beginPath(); g.arc(0.12, 0, 0.07, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ffcc33';
  g.beginPath(); g.moveTo(-0.38, -0.08); g.lineTo(-0.62, 0); g.lineTo(-0.38, 0.08); g.fill();
  g.restore();
}

function blackHole(g, x, y, r) {
  const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.45, '#000'); gr.addColorStop(0.6, 'rgba(177,76,255,0.9)'); gr.addColorStop(1, 'rgba(177,76,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r * 1.6, 0, Math.PI * 2); g.fill();
  g.save();
  g.strokeStyle = 'rgba(255,170,255,0.7)'; g.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x, y, r * (0.7 + i * 0.25), i * 2, i * 2 + 2.2); g.stroke(); }
  g.restore();
}

function drawLadder(g, a, b, wood, dark) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  g.save();
  g.translate(a.x, a.y); g.rotate(ang);
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
  g.lineCap = 'round';
  for (const [w, c] of [[8, dark], [5, wood]]) {
    g.strokeStyle = c; g.lineWidth = w;
    for (let r = 0.8; r < len - 4; r += 17) { g.beginPath(); g.moveTo(r, -11); g.lineTo(r, 11); g.stroke(); }
    for (const s of [-12, 12]) { g.beginPath(); g.moveTo(-6, s); g.lineTo(len + 6, s); g.stroke(); }
    g.shadowColor = 'transparent';
  }
  g.restore();
}

function drawSerpent(g, a, b, o) { // Kopf bei a (oben), Schwanz bei b
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  const waves = Math.max(1, len / 110), amp = Math.min(20, 8 + len * 0.05);
  const N = 60, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, e = Math.sin(t * Math.PI);
    const off = Math.sin(t * Math.PI * 2 * waves) * amp * e;
    pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off, w: 15 - t * 11 });
  }
  g.save();
  g.lineCap = 'round';
  g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
  for (const [extra, col] of [[3, o.dark], [0, o.body]]) {
    g.strokeStyle = col;
    for (let i = 0; i < N; i++) {
      g.lineWidth = pts[i].w + extra;
      g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[i + 1].x, pts[i + 1].y); g.stroke();
    }
    g.shadowColor = 'transparent';
  }
  g.fillStyle = o.spots;
  for (let i = 4; i < N - 4; i += 5) { g.beginPath(); g.arc(pts[i].x, pts[i].y, pts[i].w * 0.22, 0, Math.PI * 2); g.fill(); }
  const h = pts[0], ang = Math.atan2(pts[0].y - pts[3].y, pts[0].x - pts[3].x);
  g.translate(h.x, h.y);
  if (o.head === 'octopus') {
    g.fillStyle = o.body; g.strokeStyle = o.dark; g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, -6, 17, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    for (const ex of [-6, 6]) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, -6, 4.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(ex, -5, 2.2, 0, Math.PI * 2); g.fill();
    }
  } else {
    g.rotate(ang);
    g.strokeStyle = '#d62828'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(10, 0); g.lineTo(20, 0); g.lineTo(24, -3); g.moveTo(20, 0); g.lineTo(24, 3); g.stroke();
    g.fillStyle = o.body; g.strokeStyle = o.dark;
    g.beginPath(); g.ellipse(2, 0, 13, 10, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    for (const ey of [-5, 5]) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(5, ey, 3.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(6, ey, 1.6, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

function drawToken(g, kind, x, y, s, color, ang, letter) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 5; g.shadowOffsetY = 2;
  if (kind === 'plane') {
    drawPlane(g, x, y, ang, s * 1.3, color, '#fff');
  } else if (kind === 'ufo') {
    g.translate(x, y);
    g.fillStyle = 'rgba(170,230,255,0.85)';
    g.beginPath(); g.ellipse(0, -s * 0.18, s * 0.28, s * 0.25, 0, Math.PI, 0); g.fill();
    g.fillStyle = color; g.strokeStyle = '#111'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(0, 0, s * 0.55, s * 0.2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.shadowColor = 'transparent';
    g.fillStyle = '#fff59a';
    for (const lx of [-0.32, 0, 0.32]) { g.beginPath(); g.arc(lx * s, s * 0.04, s * 0.05, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'fish') {
    g.translate(x, y); g.rotate(ang);
    if (Math.cos(ang) < 0) g.scale(1, -1);
    g.fillStyle = color; g.strokeStyle = '#111'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-s * 0.25, 0); g.lineTo(-s * 0.55, -s * 0.25); g.lineTo(-s * 0.55, s * 0.25); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, 0, s * 0.38, s * 0.24, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.shadowColor = 'transparent';
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s * 0.18, -s * 0.05, s * 0.08, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(s * 0.2, -s * 0.05, s * 0.04, 0, Math.PI * 2); g.fill();
  } else {
    g.translate(x, y);
    const gr = g.createRadialGradient(-s * 0.15, -s * 0.15, s * 0.05, 0, 0, s * 0.45);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, color); gr.addColorStop(1, color);
    g.fillStyle = gr; g.strokeStyle = '#111'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, s * 0.42, 0, Math.PI * 2); g.fill(); g.stroke();
    g.shadowColor = 'transparent';
    g.fillStyle = '#fff'; g.font = `bold ${Math.round(s * 0.42)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.strokeText(letter, 0, 1);
    g.fillText(letter, 0, 1);
  }
  g.restore();
}

function startStrip(g, fill, label, color) {
  rr(g, OX, 634, 600, 70, 14);
  g.fillStyle = fill; g.fill();
  g.fillStyle = color; g.font = `800 14px "Segoe UI", sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(label, OX + 14, 669);
}

/* =========================================================
   THEMEN
   ========================================================= */
const THEMES = {
  flugzeuge: {
    name: '✈️ Flugzeuge', up: 'Aufwind', down: 'Turbulenz', upIcon: '✈️', downIcon: '🌪️',
    goal: '🛬', token: 'plane', num: '#24425e', trail: 'rgba(255,255,255,0.9)', trailKind: 'line',
    specials: {
      bonus: ['⛽', 'Nachtanken'], fwd: ['💨', 'Rückenwind'], back: ['🌬️', 'Gegenwind'], freeze: ['⛈️', 'Gewitter'],
      portal: ['🌀', 'Jetstream'], gift: ['🎁', 'Luftpost'], shield: ['🪂', 'Fallschirm'],
    },
    cellFill(n, r, c) {
      const t = r / 9, k = (r + c) % 2 ? -4 : 0;
      return `hsla(${110 + 95 * t},${50 + 35 * t}%,${84 + 9 * t + k}%,0.82)`;
    },
    bg(g) {
      const sky = g.createLinearGradient(0, 0, 0, BH);
      sky.addColorStop(0, '#2b8fe0'); sky.addColorStop(0.55, '#8fd0ff'); sky.addColorStop(1, '#e6f7ff');
      g.fillStyle = sky; g.fillRect(0, 0, BW, BH);
      const sun = g.createRadialGradient(570, 70, 10, 570, 70, 140);
      sun.addColorStop(0, 'rgba(255,250,200,1)'); sun.addColorStop(0.25, 'rgba(255,236,150,0.7)'); sun.addColorStop(1, 'rgba(255,236,150,0)');
      g.fillStyle = sun; g.fillRect(0, 0, BW, BH);
      const r = rng(7);
      for (let i = 0; i < 10; i++) cloud(g, r() * BW, 40 + r() * 420, 16 + r() * 22, 0.55);
      // Hügel
      g.fillStyle = '#9edb8f';
      g.beginPath(); g.moveTo(0, 560); g.bezierCurveTo(160, 480, 300, 600, 460, 520); g.bezierCurveTo(560, 470, 620, 520, BW, 500);
      g.lineTo(BW, BH); g.lineTo(0, BH); g.fill();
      g.fillStyle = '#74c46b';
      g.beginPath(); g.moveTo(0, 620); g.bezierCurveTo(140, 570, 260, 640, 420, 600); g.bezierCurveTo(520, 575, 600, 610, BW, 590);
      g.lineTo(BW, BH); g.lineTo(0, BH); g.fill();
      // Startbahn
      startStrip(g, '#454b54', '', '#fff');
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([18, 14]);
      g.beginPath(); g.moveTo(110, 669); g.lineTo(610, 669); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#fff';
      for (let i = 0; i < 6; i++) g.fillRect(32 + i * 11, 644, 6, 50);
      g.fillStyle = '#ffd23f'; g.font = '800 11px sans-serif'; g.textAlign = 'center';
      g.fillText('RUNWAY', 63, 712 - 2);
    },
    ambient(g, t) {
      for (let i = 0; i < 4; i++) {
        const sp = 0.008 + i * 0.004, y = 70 + i * 140;
        const x = ((t * sp + i * 260) % (BW + 240)) - 120;
        cloud(g, x, y, 20 + i * 4, 0.22);
      }
      // Vogelschwarm
      const bx = ((t * 0.03) % (BW + 300)) - 150, by = 110 + Math.sin(t / 2000) * 30;
      g.strokeStyle = 'rgba(30,40,60,0.55)'; g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const x = bx - i * 16, y = by + (i % 2) * 9, f = Math.sin(t / 120 + i) * 3;
        g.beginPath(); g.moveTo(x - 5, y - f); g.quadraticCurveTo(x - 2, y - 3, x, y); g.quadraticCurveTo(x + 2, y - 3, x + 5, y - f); g.stroke();
      }
    },
    drawUp(g, a, b) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const px = -Math.sin(ang) * 5, py = Math.cos(ang) * 5;
      g.save();
      g.lineCap = 'round';
      for (const s of [1, -1]) {
        g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 5; g.setLineDash([10, 7]);
        g.beginPath(); g.moveTo(a.x + px * s, a.y + py * s); g.lineTo(b.x + px * s, b.y + py * s); g.stroke();
      }
      g.setLineDash([]);
      g.strokeStyle = 'rgba(29,114,242,0.35)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.restore();
      drawPlane(g, b.x, b.y, ang, 40, '#ffffff', '#1d72f2');
      drawPlane(g, a.x, a.y, ang, 18, 'rgba(255,255,255,0.7)', 'rgba(29,114,242,0.5)');
    },
    drawDown(g, a, b) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      g.save();
      g.strokeStyle = 'rgba(70,70,80,0.55)'; g.lineWidth = 3; g.lineJoin = 'round';
      g.beginPath();
      const steps = Math.max(4, Math.round(len / 22));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, z = (i % 2 ? 1 : -1) * 9 * (i && i < steps ? 1 : 0);
        const x = a.x + (b.x - a.x) * t + nx * z, y = a.y + (b.y - a.y) * t + ny * z;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      const r = rng(Math.round(a.x * 7 + b.y));
      for (let i = 1; i < steps * 2; i++) {
        const t = i / (steps * 2);
        g.fillStyle = `rgba(90,90,100,${0.15 + t * 0.35})`;
        g.beginPath();
        g.arc(a.x + (b.x - a.x) * t + (r() - 0.5) * 10, a.y + (b.y - a.y) * t + (r() - 0.5) * 10, 4 + t * 7, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      g.font = '22px ' + EMOJI_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('🌪️', a.x, a.y - 2);
      drawPlane(g, b.x, b.y, ang, 34, '#5b6270', '#22252b');
    },
  },

  klassisch: {
    name: '🐍 Klassisch', up: 'Leiter', down: 'Schlange', upIcon: '🪜', downIcon: '🐍',
    goal: '🏆', token: 'pawn', num: '#4a2f12', trail: 'rgba(255,215,90,0.9)', trailKind: 'sparkle',
    specials: {
      bonus: ['⭐', 'Glücksstern'], fwd: ['👟', 'Sprint'], back: ['🍌', 'Ausrutscher'], freeze: ['💤', 'Nickerchen'],
      portal: ['🚪', 'Geheimtür'], gift: ['🎁', 'Überraschung'], shield: ['🛡️', 'Schild'],
    },
    cellFill(n, r, c) {
      return `hsl(${(n * 3.5 + 10) % 360},78%,${(r + c) % 2 ? 77 : 84}%)`;
    },
    bg(g) {
      const w = g.createLinearGradient(0, 0, BW, BH);
      w.addColorStop(0, '#9a6332'); w.addColorStop(1, '#6b3f1c');
      g.fillStyle = w; g.fillRect(0, 0, BW, BH);
      const r = rng(11);
      g.strokeStyle = 'rgba(60,30,10,0.25)'; g.lineWidth = 1.2;
      for (let i = 0; i < 70; i++) {
        const y = r() * BH;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= BW; x += 40) g.lineTo(x, y + Math.sin(x / 70 + i) * 4);
        g.stroke();
      }
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 16; g.shadowOffsetY = 4;
      rr(g, 10, 10, 620, 620, 18); g.fillStyle = '#fff5df'; g.fill();
      g.restore();
      g.strokeStyle = '#d9a441'; g.lineWidth = 3; rr(g, 14, 14, 612, 612, 16); g.stroke();
      startStrip(g, 'rgba(255,245,223,0.9)', 'START', '#6b3f1c');
    },
    ambient(g, t) { // Schmetterlinge
      const cols = ['#ff6fb5', '#ffd23f', '#5ec8ff', '#9b5de5'];
      for (let i = 0; i < 4; i++) {
        const x = 320 + Math.sin(t / (3100 + i * 500) + i * 2) * 280;
        const y = 320 + Math.sin(t / (2300 + i * 400) + i) * 280;
        const f = Math.abs(Math.sin(t / 90 + i));
        g.save(); g.translate(x, y); g.globalAlpha = 0.85;
        g.fillStyle = cols[i];
        g.beginPath(); g.ellipse(-4 * f, -3, 5 * f, 6, -0.4, 0, Math.PI * 2); g.ellipse(4 * f, -3, 5 * f, 6, 0.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#333'; g.fillRect(-0.8, -6, 1.6, 9);
        g.restore();
      }
    },
    drawUp(g, a, b) { drawLadder(g, a, b, '#a8642a', '#5e3410'); },
    drawDown(g, a, b) { drawSerpent(g, a, b, { body: '#3aa845', dark: '#1d5e23', spots: '#f4d35e', head: 'snake' }); },
  },

  weltraum: {
    name: '🚀 Weltraum', up: 'Raketen-Boost', down: 'Schwarzes Loch', upIcon: '🚀', downIcon: '🕳️',
    goal: '🪐', token: 'ufo', num: '#d8d2ff', trail: 'rgba(120,230,255,0.9)', trailKind: 'line',
    specials: {
      bonus: ['⭐', 'Supernova'], fwd: ['☄️', 'Komet'], back: ['🧲', 'Gravitation'], freeze: ['🧊', 'Eis-Asteroid'],
      portal: ['🌀', 'Wurmloch'], gift: ['👽', 'Alien-Geschenk'], shield: ['🛡️', 'Schutzschild'],
    },
    cellFill(n, r, c) { return `hsla(${245 + r * 6},55%,${(r + c) % 2 ? 17 : 23}%,0.8)`; },
    cellStroke(n, r) { return `hsla(${190 + r * 14},90%,65%,0.45)`; },
    bg(g) {
      g.fillStyle = '#070716'; g.fillRect(0, 0, BW, BH);
      for (const [x, y, rad, col] of [[150, 200, 260, '120,50,200'], [520, 470, 240, '20,160,170'], [470, 80, 180, '220,60,140']]) {
        const n = g.createRadialGradient(x, y, 10, x, y, rad);
        n.addColorStop(0, `rgba(${col},0.45)`); n.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = n; g.fillRect(0, 0, BW, BH);
      }
      const r = rng(3);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.75})`;
        const s = r() < 0.08 ? 2 : 1;
        g.fillRect(r() * BW, r() * BH, s, s);
      }
      // Planet mit Ring
      g.save();
      const p = g.createRadialGradient(560, 650, 5, 580, 670, 70);
      p.addColorStop(0, '#ffd59e'); p.addColorStop(1, '#c0612b');
      g.fillStyle = p; g.beginPath(); g.arc(580, 670, 60, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,220,170,0.8)'; g.lineWidth = 5;
      g.beginPath(); g.ellipse(580, 670, 100, 22, -0.3, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ccd'; g.beginPath(); g.arc(50, 600, 14, 0, Math.PI * 2); g.fill();
      g.restore();
      startStrip(g, 'rgba(20,18,50,0.75)', 'LAUNCH', '#9be7ff');
    },
    ambient(g, t) {
      const r = rng(99);
      for (let i = 0; i < 40; i++) {
        const x = r() * BW, y = r() * BH, ph = r() * 6;
        const a = Math.max(0, Math.sin(t / 600 + ph));
        g.fillStyle = `rgba(255,255,255,${a * 0.9})`;
        g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill();
      }
      const cyc = t % 7000;
      if (cyc < 900) { // Sternschnuppe
        const k = cyc / 900, x = 80 + k * 420, y = 40 + k * 160;
        const gr = g.createLinearGradient(x - 70, y - 27, x, y);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, `rgba(255,255,255,${1 - k})`);
        g.strokeStyle = gr; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 70, y - 27); g.lineTo(x, y); g.stroke();
      }
    },
    drawUp(g, a, b) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const gr = g.createLinearGradient(a.x, a.y, b.x, b.y);
      gr.addColorStop(0, 'rgba(255,200,0,0)'); gr.addColorStop(0.6, 'rgba(255,140,0,0.7)'); gr.addColorStop(1, 'rgba(255,240,150,0.95)');
      g.save();
      g.strokeStyle = gr; g.lineCap = 'round'; g.lineWidth = 10;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.restore();
      drawRocket(g, b.x, b.y, ang, 38);
    },
    drawDown(g, a, b) {
      g.save();
      g.strokeStyle = 'rgba(177,76,255,0.6)'; g.lineWidth = 3; g.setLineDash([3, 7]); g.lineCap = 'round';
      g.beginPath(); g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + b.x) / 2 + 40, (a.y + b.y) / 2, b.x, b.y); g.stroke();
      g.restore();
      blackHole(g, a.x, a.y, 24);
      blackHole(g, b.x, b.y, 10);
    },
  },

  unterwasser: {
    name: '🐙 Unterwasser', up: 'Luftblasen', down: 'Krake', upIcon: '🫧', downIcon: '🐙',
    goal: '💎', token: 'fish', num: '#06324f', trail: 'rgba(255,255,255,0.9)', trailKind: 'bubble',
    specials: {
      bonus: ['🐠', 'Glücksfisch'], fwd: ['🐬', 'Delfin-Ritt'], back: ['🌊', 'Strömung'], freeze: ['🦀', 'Krebs-Zwick'],
      portal: ['🌀', 'Strudel'], gift: ['💰', 'Schatzkiste'], shield: ['🐚', 'Muschel-Schild'],
    },
    cellFill(n, r, c) { return `hsla(${195 - r * 3},${60 + r * 2}%,${(r + c) % 2 ? 56 + r * 2.5 : 62 + r * 2.5}%,0.72)`; },
    cellStroke() { return 'rgba(255,255,255,0.35)'; },
    bg(g) {
      const w = g.createLinearGradient(0, 0, 0, BH);
      w.addColorStop(0, '#38c6e8'); w.addColorStop(0.6, '#0d6a99'); w.addColorStop(1, '#073f63');
      g.fillStyle = w; g.fillRect(0, 0, BW, BH);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      for (let i = 0; i < 6; i++) {
        g.beginPath(); g.moveTo(40 + i * 120, 0); g.lineTo(100 + i * 120, 0); g.lineTo(10 + i * 130, BH); g.lineTo(-40 + i * 130, BH); g.fill();
      }
      // Sand
      g.fillStyle = '#e9cf8f';
      g.beginPath(); g.moveTo(0, 640);
      for (let x = 0; x <= BW; x += 40) g.quadraticCurveTo(x + 20, 628 + (x % 80 ? 8 : -6), x + 40, 640);
      g.lineTo(BW, BH); g.lineTo(0, BH); g.fill();
      // Seegras + Korallen
      const r = rng(5);
      for (let i = 0; i < 9; i++) {
        const x = 10 + r() * 620, h = 40 + r() * 70;
        g.strokeStyle = r() < 0.5 ? '#2f9e5b' : '#46b86f'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x, 700);
        g.bezierCurveTo(x - 15, 700 - h / 3, x + 15, 700 - h * 0.66, x - 5, 700 - h); g.stroke();
      }
      g.fillStyle = '#ff7a8a';
      for (const x of [90, 330, 560]) {
        g.beginPath(); g.arc(x, 700, 16, Math.PI, 0); g.arc(x - 9, 686, 8, 0, Math.PI * 2); g.arc(x + 10, 684, 7, 0, Math.PI * 2); g.fill();
      }
      startStrip(g, 'rgba(255,240,200,0.55)', 'START', '#7a5a1a');
    },
    ambient(g, t) {
      const r = rng(21);
      for (let i = 0; i < 26; i++) {
        const x0 = r() * BW, sp = 0.02 + r() * 0.03, off = r() * BH, rad = 1.5 + r() * 3.5;
        const y = BH - ((t * sp + off) % (BH + 20));
        const x = x0 + Math.sin(t / 700 + i) * 6;
        g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke();
      }
      for (let i = 0; i < 2; i++) { // Fischschwarm-Silhouetten
        const dir = i ? -1 : 1, x = dir > 0 ? ((t * 0.04) % (BW + 200)) - 100 : BW + 100 - ((t * 0.03 + 300) % (BW + 200));
        const y = 150 + i * 260 + Math.sin(t / 900 + i) * 20;
        g.fillStyle = 'rgba(0,40,70,0.35)';
        for (let k = 0; k < 3; k++) {
          const fx = x - dir * k * 22, fy = y + (k % 2) * 12;
          g.beginPath(); g.ellipse(fx, fy, 9, 5, 0, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.moveTo(fx - dir * 7, fy); g.lineTo(fx - dir * 14, fy - 5); g.lineTo(fx - dir * 14, fy + 5); g.fill();
        }
      }
    },
    drawUp(g, a, b) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(5, Math.round(len / 18));
      g.save();
      for (let i = 0; i <= n; i++) {
        const t = i / n, w = Math.sin(t * Math.PI * 4) * 6;
        const x = a.x + (b.x - a.x) * t + w, y = a.y + (b.y - a.y) * t;
        const r = 4 + t * 7;
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    },
    drawDown(g, a, b) { drawSerpent(g, a, b, { body: '#9b4dca', dark: '#4e1f6e', spots: '#f2c6ff', head: 'octopus' }); },
  },
};

/* ---------------- Brett in ein Offscreen-Canvas zeichnen ---------------- */
function buildBoard(themeKey, board, dpr) {
  const T = THEMES[themeKey];
  const c = document.createElement('canvas');
  c.width = BW * dpr; c.height = BH * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  T.bg(g);

  const S_ = CELL - 6;
  for (let n = 1; n <= 100; n++) {
    const { x, y } = cellXY(n);
    const r = Math.floor((n - 1) / 10), col = (n - 1) % 10;
    const x0 = x - S_ / 2, y0 = y - S_ / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.2)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
    rr(g, x0, y0, S_, S_, 10);
    if (n === 100) {
      const gold = g.createLinearGradient(x0, y0, x0 + S_, y0 + S_);
      gold.addColorStop(0, '#fff2a8'); gold.addColorStop(0.5, '#ffd23f'); gold.addColorStop(1, '#f2a100');
      g.fillStyle = gold; g.shadowColor = 'rgba(255,200,0,0.9)'; g.shadowBlur = 18;
    } else g.fillStyle = T.cellFill(n, r, col);
    g.fill();
    g.restore();
    const gl = g.createLinearGradient(0, y0, 0, y0 + S_);
    gl.addColorStop(0, 'rgba(255,255,255,0.4)'); gl.addColorStop(0.45, 'rgba(255,255,255,0)');
    rr(g, x0, y0, S_, S_, 10); g.fillStyle = gl; g.fill();
    if (T.cellStroke) { g.strokeStyle = T.cellStroke(n, r); g.lineWidth = 1.5; rr(g, x0, y0, S_, S_, 10); g.stroke(); }
    g.fillStyle = n === 100 ? '#7a4a00' : T.num;
    g.font = '800 12px "Segoe UI", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText(n, x0 + 5, y0 + 4);
  }
  g.font = '30px ' + EMOJI_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  const goal = cellXY(100);
  g.fillText(T.goal, goal.x, goal.y + 5);

  const pairs = Object.entries(board.jumps).map(([f, t]) => [+f, t]);
  for (const [f, t] of pairs) if (t < f) T.drawDown(g, cellXY(f), cellXY(t));
  for (const [f, t] of pairs) if (t > f) T.drawUp(g, cellXY(f), cellXY(t));

  for (const [cs, type] of Object.entries(board.specials)) {
    const { x, y } = cellXY(+cs);
    const info = specialInfo(themeKey, type);
    g.save();
    g.shadowColor = info.color; g.shadowBlur = 12;
    const gr = g.createRadialGradient(x - 5, y - 2, 2, x, y + 3, 19);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, info.color); gr.addColorStop(1, info.color);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y + 3, 17, 0, Math.PI * 2); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.stroke();
    g.font = '19px ' + EMOJI_FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(info.icon, x, y + 4);
    g.restore();
  }
  return c;
}
