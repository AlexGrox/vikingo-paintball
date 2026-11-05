/* ==========================================================================
   Bolas que revientan en la pantalla (como contra la máscara del jugador).
   Estilo "tinta": manchas planas de borde irregular, púas finas y gotitas despedidas,
   en cuatro variantes (doble, púas largas, erizada y estrella con goteo).
   Los colores se oscurecen: con el sol detrás, la pintura en la pantalla se ve a contraluz.
   Las imágenes se generan una vez por color y estilo, y se reutilizan.
   ========================================================================== */
import { playSplat } from './audio.js';

const cache = new Map();
const STYLES = ['double', 'spikes', 'bristle', 'star'];
const MAX_ON_SCREEN = 6;
const BACKLIGHT = 0.5; // brillo de la pintura a contraluz (1 = color original)

function rand(a, b) {
  return a + (b - a) * Math.random();
}

/** Color a contraluz: más oscuro y algo menos saturado, con un leve tinte cálido del sol */
function backlit(hex, k = BACKLIGHT) {
  const n = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  [r, g, b] = [r, g, b].map((v) => v * 0.82 + l * 0.18); // un poco menos saturado
  return `rgb(${Math.round(r * k + 10)},${Math.round(g * k + 6)},${Math.round(b * k)})`;
}

/** Mancha de borde irregular (radio con ruido) */
function blob(g, cx, cy, R, rough = 0.12) {
  const waves = Array.from({ length: 5 }, (_, i) => ({ f: 3 + i * 2 + Math.floor(rand(0, 3)), a: rand(0.2, 1) * rough / (i + 1), p: rand(0, 6.28) }));
  g.beginPath();
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    let r = 1;
    for (const w of waves) r += Math.sin(t * w.f + w.p) * w.a;
    r += rand(-0.012, 0.012); // borde levemente dentado
    const x = cx + Math.cos(t) * R * r, y = cy + Math.sin(t) * R * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
}

/** Púa fina que sale del borde (triángulo alargado), a veces con una gotita al final */
function spike(g, cx, cy, a, r0, len, w, drop = false) {
  const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0;
  const x1 = cx + Math.cos(a) * (r0 + len), y1 = cy + Math.sin(a) * (r0 + len);
  const nx = -Math.sin(a) * w / 2, ny = Math.cos(a) * w / 2;
  g.beginPath();
  g.moveTo(x0 + nx, y0 + ny);
  g.lineTo(x1, y1);
  g.lineTo(x0 - nx, y0 - ny);
  g.closePath();
  g.fill();
  if (drop) {
    const d = len * rand(0.08, 0.25);
    g.beginPath();
    g.ellipse(x1 + Math.cos(a) * d, y1 + Math.sin(a) * d, w * rand(0.35, 0.6), w * rand(0.2, 0.4), a, 0, Math.PI * 2);
    g.fill();
  }
}

/** Gotitas sueltas, alargadas en dirección radial */
function droplets(g, cx, cy, n, rMin, rMax, size, a0 = 0, spread = Math.PI * 2) {
  for (let i = 0; i < n; i++) {
    const a = a0 + rand(-spread / 2, spread / 2), d = rand(rMin, rMax), s = rand(size * 0.3, size);
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s * rand(1, 2.2), s, a, 0, Math.PI * 2);
    g.fill();
  }
}

/** Brazo grueso que se afina, con bulbo al final (estilo estrella) */
function arm(g, cx, cy, a, R, len, w) {
  const steps = 14;
  g.beginPath();
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = R * 0.6 + len * t;
    const ww = w * (1 - t * 0.85) * (1 + Math.sin(t * 9) * 0.06);
    const bend = Math.sin(t * 2.2) * 0.06;
    pts.push([cx + Math.cos(a + bend) * d, cy + Math.sin(a + bend) * d, ww, a + bend]);
  }
  pts.forEach(([x, y, ww, aa], i) => (i ? g.lineTo(x - Math.sin(aa) * ww / 2, y + Math.cos(aa) * ww / 2) : g.moveTo(x - Math.sin(aa) * ww / 2, y + Math.cos(aa) * ww / 2)));
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y, ww, aa] = pts[i];
    g.lineTo(x + Math.sin(aa) * ww / 2, y - Math.cos(aa) * ww / 2);
  }
  g.closePath();
  g.fill();
  const [ex, ey, ew] = pts[pts.length - 1];
  g.beginPath();
  g.arc(ex, ey, Math.max(3, ew * 1.6), 0, Math.PI * 2);
  g.fill();
}

/** Dibuja una salpicadura (512 px) del estilo indicado y devuelve el canvas */
function drawSplat(color, style) {
  const S = 512, c = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = backlit(color);
  const R = rand(72, 88);

  if (style === 'double') {
    // dos manchas fusionadas en diagonal + espray hacia un lado
    const a = rand(0, Math.PI * 2), off = R * 0.62;
    blob(g, c + Math.cos(a) * off, c + Math.sin(a) * off, R * 0.82, 0.14);
    blob(g, c - Math.cos(a) * off, c - Math.sin(a) * off, R * 0.74, 0.14);
    blob(g, c, c, R * 0.6, 0.1);
    const side = a + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
    for (let i = 0; i < 26; i++) spike(g, c, c, side + rand(-0.9, 0.9), R * 0.85, rand(15, 70), rand(2, 5), Math.random() < 0.3);
    for (let i = 0; i < 12; i++) spike(g, c, c, rand(0, Math.PI * 2), R * 0.9, rand(8, 30), rand(2, 4));
    droplets(g, c, c, 28, R * 1.3, R * 2.6, 4, side, 1.8);
  } else if (style === 'spikes') {
    // redonda con púas largas y finas
    blob(g, c, c, R, 0.1);
    for (let i = 0; i < 26; i++) spike(g, c, c, rand(0, Math.PI * 2), R * 0.9, rand(R * 0.35, R * 1.25), rand(3, 7), Math.random() < 0.5);
    for (let i = 0; i < 14; i++) spike(g, c, c, rand(0, Math.PI * 2), R * 0.92, rand(10, 30), rand(4, 9));
    droplets(g, c, c, 30, R * 1.4, R * 2.5, 4.5);
  } else if (style === 'bristle') {
    // redonda erizada de púas cortas y muy finas
    blob(g, c, c, R * 0.95, 0.07);
    for (let i = 0; i < 140; i++) spike(g, c, c, rand(0, Math.PI * 2), R * 0.88, rand(8, R * 0.6), rand(1.5, 4), Math.random() < 0.15);
    for (let i = 0; i < 18; i++) spike(g, c, c, rand(0, Math.PI * 2), R * 0.9, rand(R * 0.6, R * 1.1), rand(1.5, 3));
    droplets(g, c, c, 55, R * 1.15, R * 2.2, 3);
  } else {
    // estrella: brazos gruesos, alguno ramificado, y chorreones hacia abajo
    blob(g, c, c, R * 0.7, 0.16);
    const n = Math.floor(rand(6, 9));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
      const len = rand(R * 0.6, R * 1.55);
      arm(g, c, c, a, R, len, rand(R * 0.22, R * 0.36));
      if (Math.random() < 0.35) arm(g, c, c, a + rand(-0.35, 0.35), R, len * 0.6, R * 0.14);
    }
    for (let i = 0; i < 3; i++) {
      const x = c + rand(-R * 0.4, R * 0.4), w = rand(7, 12), len = rand(R * 0.8, R * 1.8);
      g.beginPath();
      g.moveTo(x - w / 2, c);
      g.lineTo(x - w * 0.35, c + len);
      g.lineTo(x + w * 0.35, c + len);
      g.lineTo(x + w / 2, c);
      g.fill();
      g.beginPath();
      g.ellipse(x, c + len + w * 0.6, w * 0.55, w * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
    droplets(g, c, c, 22, R * 1.5, R * 2.5, 5);
  }

  // sutil variación de tono (la tinta no es completamente uniforme): centro apenas más claro
  g.globalCompositeOperation = 'source-atop';
  const rg = g.createRadialGradient(c, c, 0, c, c, R * 1.6);
  rg.addColorStop(0, 'rgba(255,220,170,.07)');
  rg.addColorStop(1, 'rgba(0,0,0,.12)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  return cv;
}

function splatCanvas(color, style = STYLES[Math.floor(Math.random() * STYLES.length)]) {
  const key = color + style;
  if (!cache.has(key)) cache.set(key, drawSplat(color, style));
  return cache.get(key);
}

/** Genera de antemano las salpicaduras en los ratos libres del navegador (sin tirones al impactar) */
export function preloadScreenSplats(colors) {
  const jobs = [];
  for (const c of colors) for (const st of STYLES) jobs.push([c, st]);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 60));
  const work = (deadline) => {
    while (jobs.length && deadline.timeRemaining() > 6) splatCanvas(...jobs.shift());
    if (jobs.length) idle(work);
  };
  idle(work);
}

let root = null;
function getRoot() {
  if (!root) {
    root = document.createElement('div');
    root.id = 'screen-splats';
    root.setAttribute('aria-hidden', 'true');
    document.body.append(root);
  }
  return root;
}

/**
 * Revienta una bola en la pantalla.
 * @param {number} x posición horizontal 0..1
 * @param {number} y posición vertical 0..1
 * @param {string} color '#rrggbb'
 */
export function screenSplat(x, y, color) {
  const box = getRoot();
  while (box.children.length >= MAX_ON_SCREEN) box.firstChild.remove();
  const size = Math.round(Math.min(window.innerWidth, window.innerHeight) * rand(0.55, 0.8));
  const el = document.createElement('div');
  el.className = 'screen-splat';
  el.style.left = `${x * 100}%`;
  el.style.top = `${y * 100}%`;
  el.style.width = el.style.height = `${size}px`;
  el.style.setProperty('--r', `${Math.round(rand(-25, 25))}deg`);
  // copia del canvas ya dibujado (muy rápido)
  const src = splatCanvas(color);
  const img = document.createElement('canvas');
  img.width = src.width;
  img.height = src.height;
  img.getContext('2d').drawImage(src, 0, 0);
  el.append(img);
  box.append(el);
  playSplat(1);
  // pequeño temblor de la vista
  document.body.classList.remove('hit-shake');
  void document.body.offsetWidth;
  document.body.classList.add('hit-shake');
  setTimeout(() => el.remove(), 4300);
}

/** Limpia todas las salpicaduras (al entrar en una sección) */
export function clearScreenSplats() {
  if (root) root.replaceChildren();
}
