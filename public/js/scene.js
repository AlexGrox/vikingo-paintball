/* ==========================================================================
   Escena 3D de la portada
   - Campo de paintball (tierra, neumáticos, empalizada vikinga, árboles, caja)
   - Pórtico con 4 carteles de madera (menú) y escudo vikingo con el logo
   - Marcadora procedural en primera persona que apunta a la mira del ratón
   - Disparo de bolas de pintura con trayectoria, salpicadura y partículas
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { playShot, playSplat, playWood } from './audio.js';
import { createAtmosphere } from './atmosphere.js';
import { mediaUrl } from './media.js';
import { tireAssets, TIRE_HEIGHT, createDrum, DRUM_HEIGHT, createWoodBarrel, cardboardMaterial, thatchMaterial } from './props.js';
import { createRunner, PAINT as RUNNER_PAINT } from './runners.js';
import { screenSplat, preloadScreenSplats } from './screen-splats.js';

const PAINT_COLORS = ['#ff3b1f', '#ffd60a', '#27e36b', '#1e90ff', '#ff2d92', '#b45cff', '#ff8a00', '#00e5ff'];
const BALL_SPEED = 38; // m/s (exagerado a escala de juego)
const MAX_SPLATS = 90;
const SPLAT_HOLD = 4; // segundos que la mancha se ve nítida
const SPLAT_SIZE = 0.5; // tamaño real de la mancha (m): la perspectiva la hace pequeña a lo lejos
const SPLAT_FADE = 3; // segundos que tarda en desvanecerse
const DEPTH = 9; // distancia del pórtico de carteles
const HOME_POS = new THREE.Vector3(0, 1.6, 0); // posición de la cámara en la portada

/* Perfil de calidad: en móviles se reduce lo que más cuesta sin cambiar el aspecto general.
   Además, la resolución se ajusta sola si los fotogramas por segundo bajan (ver frame()). */
const IS_MOBILE = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
export const QUALITY = IS_MOBILE
  ? { mobile: true, pixelRatio: 1.75, minPixelRatio: 1, antialias: true, shadowSize: 1024, softShadows: false,
      shadowEvery: 3, keepTree: (i) => i % 3 !== 2, keepTwig: (k) => k % 2 === 0, twigShadows: false,
      mist: 26, rays: 20, mistDetail: false, pointLights: false, aniso: 4, stationHalfRate: true, spawnTries: 4 }
  : { mobile: false, pixelRatio: 2, minPixelRatio: 1, antialias: true, shadowSize: 2048, softShadows: true,
      shadowEvery: 1, keepTree: () => true, keepTwig: () => true, twigShadows: true,
      mist: 80, rays: 42, mistDetail: true, pointLights: true, aniso: 16, stationHalfRate: false, spawnTries: 10 };
// Fondo fotográfico del escenario (public/img/fondo-bosque.jpg, a partir de fondo.png)
const BACKDROP = {
  url: 'img/fondo-bosque.jpg',
  radius: 115, // distancia del panorama
  arc: 150, // grados que abarca, centrado al frente
  eye: 0.47, // altura relativa del horizonte en la foto (0 = arriba)
  sunAzimuth: 46, // el sol de la foto queda 46° a la derecha del frente (81 % del ancho)
};
const BOARD_RATIO = 2.56; // ancho/alto de los carteles

/* ---------- utilidades ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261105);
const sharedRnd = rnd;
const R = (a, b) => a + (b - a) * rnd();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/* ---------- texturas procedurales ---------- */
function woodCanvas(w, h, { planks = 4, hue = 28, light = 30, vertical = false } = {}) {
  const [c, g] = makeCanvas(w, h);
  for (let i = 0; i < planks; i++) {
    const x0 = vertical ? (i * w) / planks : 0;
    const y0 = vertical ? 0 : (i * h) / planks;
    const pw = vertical ? w / planks : w;
    const ph = vertical ? h : h / planks;
    g.fillStyle = `hsl(${hue + R(-4, 4)}, ${R(35, 48)}%, ${light + R(-5, 5)}%)`;
    g.fillRect(x0, y0, pw, ph);
    // vetas
    for (let k = 0; k < 46; k++) {
      g.strokeStyle = rnd() < 0.6 ? `rgba(30,15,5,${R(0.05, 0.16)})` : `rgba(255,225,180,${R(0.03, 0.08)})`;
      g.lineWidth = R(0.6, 2.6);
      g.beginPath();
      const off = R(0, vertical ? pw : ph);
      const freq = R(0.004, 0.02);
      const amp = R(1, 5);
      const len = vertical ? ph : pw;
      for (let s = 0; s <= len; s += 12) {
        const wob = Math.sin(s * freq + k) * amp;
        if (vertical) g.lineTo(x0 + off + wob, y0 + s);
        else g.lineTo(x0 + s, y0 + off + wob);
      }
      g.stroke();
    }
    // nudos
    for (let k = 0; k < 2; k++) {
      if (rnd() < 0.5) continue;
      const kx = vertical ? x0 + R(0.2, 0.8) * pw : R(0, w);
      const ky = vertical ? R(0, h) : y0 + R(0.2, 0.8) * ph;
      const r = R(4, 10);
      const grd = g.createRadialGradient(kx, ky, 0, kx, ky, r * 2);
      grd.addColorStop(0, 'rgba(25,12,4,.75)');
      grd.addColorStop(1, 'rgba(25,12,4,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(kx, ky, vertical ? r : r * 2.2, vertical ? r * 2.2 : r, 0, 0, Math.PI * 2);
      g.fill();
    }
    // separación entre tablas
    g.fillStyle = 'rgba(15,8,3,.7)';
    if (vertical) g.fillRect(x0, 0, 3, h);
    else g.fillRect(0, y0, w, 3);
  }
  return c;
}

/* Tierra húmeda: marrón oscuro con zonas empapadas casi negras y grumos.
   Devuelve también un mapa de rugosidad: las zonas mojadas brillan un poco con el sol. */
function dirtTexture(maxAniso) {
  // generador propio: así la textura no altera la posición de neumáticos, bidones, etc.
  const local = mulberry32(5150);
  const R = (a, b) => a + (b - a) * local();
  const rnd = local;
  // la textura anterior consumía 99 224 números del generador compartido: se avanzan igual
  // para que el resto del escenario mantenga exactamente su distribución
  for (let i = 0; i < 99224; i++) sharedRnd();
  const [c, g] = makeCanvas(512, 512);
  const [rc, rg] = makeCanvas(512, 512); // rugosidad (blanco = mate, gris = húmedo/brillante)
  rg.fillStyle = '#e6e6e6';
  rg.fillRect(0, 0, 512, 512);
  g.fillStyle = '#4a3624';
  g.fillRect(0, 0, 512, 512);
  // manchas grandes: tierra algo más seca y zonas empapadas (dibujadas también en los bordes para repetir sin costura)
  const blob = (ctx, x, y, r, inner) => {
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      const grd = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grd.addColorStop(0, inner);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 30; i++) {
    const x = R(0, 512), y = R(0, 512), r = R(30, 120);
    if (rnd() < 0.55) {
      blob(g, x, y, r, 'rgba(28,18,10,.45)'); // empapado
      blob(rg, x, y, r, 'rgba(70,70,70,.55)');
    } else {
      blob(g, x, y, r, 'rgba(110,84,56,.25)'); // algo más seco
    }
  }
  // grano fino de la tierra
  for (let i = 0; i < 16000; i++) {
    g.fillStyle = `hsla(${R(20, 34)}, ${R(20, 38)}%, ${R(10, 34)}%, ${R(0.3, 0.75)})`;
    const s = R(0.8, 3);
    g.fillRect(R(0, 512), R(0, 512), s, s);
  }
  // pequeños charcos / huellas con agua
  for (let i = 0; i < 9; i++) {
    const x = R(20, 492), y = R(20, 492), rx = R(6, 18), ry = rx * R(0.4, 0.8), a = R(0, 3);
    g.fillStyle = 'rgba(18,12,7,.75)';
    g.beginPath();
    g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    g.fill();
    rg.fillStyle = '#3a3a3a';
    rg.beginPath();
    rg.ellipse(x, y, rx * 0.85, ry * 0.85, a, 0, Math.PI * 2);
    rg.fill();
  }
  for (let i = 0; i < 140; i++) {
    const x = R(0, 512), y = R(0, 512), r = R(1.5, 4.5);
    g.fillStyle = `hsl(${R(20, 40)}, ${R(5, 18)}%, ${R(22, 40)}%)`;
    g.beginPath();
    g.ellipse(x, y, r, r * R(0.6, 1), R(0, 3), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(x + 1, y + 1.5, r, r * 0.5, 0, 0, Math.PI);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(rc);
  for (const tx of [t, rough]) {
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.repeat.set(70, 70);
    tx.anisotropy = maxAniso;
  }
  return { map: t, roughnessMap: rough };
}

function splatCanvas() {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#fff';
  const cx = 128, cy = 128;
  g.beginPath();
  g.arc(cx, cy, R(38, 48), 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 14; i++) {
    const a = R(0, Math.PI * 2), d = R(20, 50), r = R(14, 26);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  // rayos
  for (let i = 0; i < 11; i++) {
    const a = R(0, Math.PI * 2), len = R(60, 112), w = R(5, 11);
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -w);
    g.quadraticCurveTo(len * 0.6, -w * 0.4, len, 0);
    g.quadraticCurveTo(len * 0.6, w * 0.4, 0, w);
    g.fill();
    g.beginPath();
    g.arc(len, 0, w * R(0.6, 1.1), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // gotas sueltas
  for (let i = 0; i < 16; i++) {
    const a = R(0, Math.PI * 2), d = R(70, 120);
    g.beginPath();
    g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R(2, 6), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Corteza de pino procedural: placas irregulares alargadas (celdas tipo Voronoi, repetibles
 *  sin costuras) separadas por grietas profundas, con mapa de relieve calculado de la altura. */
export function barkTextures() {
  const Wt = 256, Ht = 512;
  // puntos de las placas (más separados en vertical: placas alargadas)
  const pts = [];
  for (let k = 0; k < 70; k++) {
    pts.push({
      x: R(0, Wt), y: R(0, Ht),
      h: R(18, 30), s: R(16, 34), l: R(15, 30), // color de la placa
      lift: R(0.75, 1), // altura de la placa
    });
  }
  const SY = 0.38; // escala vertical de la distancia → placas ~2,6 veces más altas que anchas
  const img = new ImageData(Wt, Ht);
  const height = new Float32Array(Wt * Ht);
  const tmp = new THREE.Color();
  for (let py = 0; py < Ht; py++) {
    for (let px = 0; px < Wt; px++) {
      let d1 = 1e9, d2 = 1e9, best = null;
      for (const p of pts) {
        // distancia toroidal: la textura se repite sin costuras
        let dx = Math.abs(px - p.x); dx = Math.min(dx, Wt - dx);
        let dy = Math.abs(py - p.y); dy = Math.min(dy, Ht - dy);
        // borde ondulado de las placas
        const d = Math.hypot(dx, dy * SY) + Math.sin(py * 0.15 + p.x) * 1.6;
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1; // 0 en la grieta entre dos placas
      const crack = Math.min(1, edge / 5.5); // anchura de la grieta
      const grain = Math.sin(px * 0.9 + Math.sin(py * 0.05) * 3) * 0.04 + (Math.random() - 0.5) * 0.08;
      height[py * Wt + px] = crack * crack * best.lift + grain * crack;
      // color: placa marrón-grisácea, grieta casi negra, bordes de placa algo más claros (desgaste)
      tmp.setHSL(best.h / 360, best.s / 100, Math.max(0, (best.l / 100) * (0.35 + 0.65 * crack) + (crack > 0.6 && crack < 0.85 ? 0.03 : 0) + grain * 0.25));
      const k = (py * Wt + px) * 4;
      img.data[k] = tmp.r * 255;
      img.data[k + 1] = tmp.g * 255;
      img.data[k + 2] = tmp.b * 255;
      img.data[k + 3] = 255;
    }
  }
  const [c, g] = makeCanvas(Wt, Ht);
  g.putImageData(img, 0, 0);
  // líquenes y polvo
  for (let k = 0; k < 900; k++) {
    g.fillStyle = rnd() < 0.6 ? `rgba(0,0,0,${R(0.08, 0.22)})` : `rgba(150,140,95,${R(0.05, 0.14)})`;
    g.fillRect(R(0, Wt), R(0, Ht), R(1, 3), R(1, 4));
  }
  // mapa de normales desde la altura (grietas hundidas, placas en relieve)
  const H_ = (x, y) => height[((y + Ht) % Ht) * Wt + ((x + Wt) % Wt)];
  const nimg = new ImageData(Wt, Ht);
  for (let py = 0; py < Ht; py++) {
    for (let px = 0; px < Wt; px++) {
      const dx = (H_(px + 1, py) - H_(px - 1, py)) * 2.2;
      const dy = (H_(px, py + 1) - H_(px, py - 1)) * 2.2;
      const k = (py * Wt + px) * 4;
      nimg.data[k] = Math.max(0, Math.min(255, 128 - dx * 127));
      nimg.data[k + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
      nimg.data[k + 2] = 255;
      nimg.data[k + 3] = 255;
    }
  }
  const [nc, ng] = makeCanvas(Wt, Ht);
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.CanvasTexture(nc);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 14); // 2 vueltas alrededor y 14 a lo alto del tronco
    t.anisotropy = 8;
  }
  return { map, normal };
}

/** Espray de pintura: núcleo denso y miles de gotitas que se dispersan hacia fuera */
function sprayTexture() {
  const S = 256, c = S / 2;
  const [cv, g] = makeCanvas(S, S);
  const core = g.createRadialGradient(c, c, 0, c, c, S * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,.95)');
  core.addColorStop(0.5, 'rgba(255,255,255,.5)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.pow(Math.random(), 0.7) * S * 0.47; // más densas en el centro
    const r = Math.max(0.6, (1 - d / (S * 0.47)) * 2.6 * Math.random());
    g.globalAlpha = 0.35 + Math.random() * 0.65;
    g.beginPath();
    g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softDotTexture() {
  const [c, g] = makeCanvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* Cartel de madera con texto grabado */
function drawBoard(canvas, label) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.drawImage(woodCanvas(W, H, { planks: 3, hue: 27, light: 31 }), 0, 0);
  // borde quemado
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,8,0,.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(25,12,4,.85)';
  g.lineWidth = 16;
  g.strokeRect(8, 8, W - 16, H - 16);
  // clavos
  for (const [x, y] of [[48, 44], [W - 48, 44], [48, H - 44], [W - 48, H - 44]]) {
    g.fillStyle = '#2a2622';
    g.beginPath();
    g.arc(x, y, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.arc(x - 3, y - 3, 4, 0, Math.PI * 2);
    g.fill();
  }
  // texto
  const text = (label || '').toUpperCase();
  let size = 230;
  g.font = `${size}px "Germania One", Impact, serif`;
  while (g.measureText(text).width > W * 0.8 && size > 40) {
    size -= 6;
    g.font = `${size}px "Germania One", Impact, serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const y = H / 2 + size * 0.06;
  g.lineJoin = 'round';
  g.lineWidth = size * 0.1;
  g.strokeStyle = '#1c1008';
  g.strokeText(text, W / 2, y + 4);
  g.shadowColor = 'rgba(0,0,0,.55)';
  g.shadowBlur = 14;
  g.shadowOffsetY = 7;
  g.fillStyle = '#f6e4b6';
  g.fillText(text, W / 2, y);
  g.shadowColor = 'transparent';
  // ligero desgaste sobre el texto
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(90,55,25,${R(0.08, 0.25)})`;
    g.fillRect(R(0, W), R(0, H), R(2, 14), R(1, 3));
  }
  g.globalCompositeOperation = 'source-over';
}

/* Escudo vikingo con el logo */
function drawShield(canvas, logoImg) {
  const g = canvas.getContext('2d');
  const S = canvas.width, C = S / 2;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath();
  g.arc(C, C, C, 0, Math.PI * 2);
  g.clip();
  g.drawImage(woodCanvas(S, S, { planks: 7, vertical: true, hue: 30, light: 34 }), 0, 0);
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(C, C);
    g.arc(C, C, C, (i * Math.PI) / 4 - Math.PI / 8, ((i + 1) * Math.PI) / 4 - Math.PI / 8);
    g.closePath();
    g.fillStyle = i % 2 ? 'rgba(146,26,16,.86)' : 'rgba(228,208,160,.8)';
    g.fill();
  }
  // desgaste: arañazos que dejan ver la madera
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(80,48,22,${R(0.25, 0.6)})`;
    g.lineWidth = R(1, 3);
    const x = R(0, S), y = R(0, S), a = R(0, Math.PI), l = R(6, 30);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // medallón central
  g.beginPath();
  g.arc(C, C, S * 0.385, 0, Math.PI * 2);
  g.fillStyle = '#1a120b';
  g.fill();
  g.lineWidth = S * 0.018;
  g.strokeStyle = '#c9a13b';
  g.stroke();
  if (logoImg && logoImg.width) {
    const box = S * 0.74;
    const ar = logoImg.width / logoImg.height;
    const w = ar >= 1 ? box : box * ar;
    const h = ar >= 1 ? box / ar : box;
    g.drawImage(logoImg, C - w / 2, C - h / 2, w, h);
  }
  // sombreado del borde y remaches
  const grd = g.createRadialGradient(C, C, S * 0.4, C, C, C);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.8, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const x = C + Math.cos(a) * S * 0.455, y = C + Math.sin(a) * S * 0.455;
    g.fillStyle = '#3a3633';
    g.beginPath();
    g.arc(x, y, S * 0.011, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.4)';
    g.beginPath();
    g.arc(x - 2, y - 2, S * 0.004, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ==========================================================================
   Marcadora procedural (eje +Z = cañón, origen en la empuñadura)
   ========================================================================== */
function buildMarker({ hopper = true } = {}) {
  /* Marcadora estilo carabina táctica (tipo Bravo One) con loader encima.
     Ejes: +Z = cañón, +Y = arriba; origen sobre el gatillo. Medidas aprox. en metros. */
  const root = new THREE.Group();
  const poly = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.62, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.36, metalness: 0.65 });
  const darker = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.8, metalness: 0.1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa4aab0, roughness: 0.35, metalness: 1 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.95 });
  const add = (geo, mat, x, y, z, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const cylZ = (r1, r2, len, seg = 20) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2);
  /** Perfil 2D en el plano lateral (u = z, v = y) extruido a lo ancho (x) */
  const sideShape = (pts, width, holes = []) => {
    const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
    return new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 })
      .rotateY(-Math.PI / 2)
      .translate(width / 2, 0, 0);
  };

  /* ---- receptor superior e inferior ---- */
  add(new RoundedBoxGeometry(0.052, 0.068, 0.25, 3, 0.008), metal, 0, 0.034, -0.005);
  add(new RoundedBoxGeometry(0.048, 0.052, 0.21, 3, 0.008), poly, 0, -0.022, -0.02);
  add(new RoundedBoxGeometry(0.046, 0.05, 0.075, 2, 0.006), poly, 0, -0.03, 0.07); // pozo del cargador
  // tapa de expulsión, asistente de cierre y selector
  add(new THREE.BoxGeometry(0.003, 0.026, 0.09), darker, 0.0275, 0.03, 0.02);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 12).rotateX(Math.PI / 2), metal, 0.026, 0.05, -0.085);
  add(new THREE.CylinderGeometry(0.007, 0.007, 0.006, 12).rotateZ(Math.PI / 2), metal, -0.027, -0.01, -0.05);
  add(new THREE.BoxGeometry(0.004, 0.006, 0.02), metal, -0.031, -0.008, -0.05);

  /* ---- asa de transporte con alza trasera ---- */
  add(
    sideShape(
      [[-0.115, 0.066], [0.0, 0.066], [0.0, 0.112], [-0.115, 0.112]],
      0.018,
      [[[-0.09, 0.074], [-0.025, 0.074], [-0.025, 0.1], [-0.09, 0.1]]]
    ),
    poly, 0, 0, 0
  );
  add(new THREE.BoxGeometry(0.03, 0.022, 0.03), poly, 0, 0.12, -0.1);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.034, 10).rotateZ(Math.PI / 2), metal, 0, 0.122, -0.08);

  /* ---- guardamanos estriado y anillo ---- */
  add(cylZ(0.037, 0.037, 0.018, 24), metal, 0, 0.032, 0.13);
  add(cylZ(0.032, 0.032, 0.2, 16), poly, 0, 0.032, 0.235);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rib = add(new THREE.BoxGeometry(0.008, 0.006, 0.19), poly, Math.cos(a) * 0.033, 0.032 + Math.sin(a) * 0.033, 0.235);
    rib.rotation.z = a;
  }
  add(cylZ(0.034, 0.034, 0.012, 20), metal, 0, 0.032, 0.34);

  /* ---- cañón, alza delantera en "A" y bocacha tipo jaula ---- */
  add(cylZ(0.0115, 0.0115, 0.17, 16), metal, 0, 0.032, 0.43);
  add(cylZ(0.016, 0.016, 0.024, 16), metal, 0, 0.032, 0.375);
  add(
    sideShape(
      [[0.358, 0.04], [0.392, 0.04], [0.379, 0.112], [0.371, 0.112]],
      0.012,
      [[[0.367, 0.05], [0.383, 0.05], [0.377, 0.085], [0.373, 0.085]]]
    ),
    poly, 0, 0, 0
  );
  add(new THREE.BoxGeometry(0.004, 0.018, 0.004), metal, 0, 0.12, 0.375);
  add(new THREE.TorusGeometry(0.008, 0.002, 6, 12).rotateY(Math.PI / 2), metal, 0, 0.004, 0.375); // anilla de correa
  add(cylZ(0.0145, 0.0145, 0.045, 18), metal, 0, 0.032, 0.535);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const slot = add(new THREE.BoxGeometry(0.004, 0.0035, 0.026), darker, Math.cos(a) * 0.0135, 0.032 + Math.sin(a) * 0.0135, 0.54);
    slot.rotation.z = a;
  }
  add(cylZ(0.0085, 0.0085, 0.046, 12), new THREE.MeshBasicMaterial({ color: 0x050505 }), 0, 0.032, 0.536);

  /* ---- cargador curvo (decorativo) ---- */
  const mag = new THREE.Group();
  mag.position.set(0, -0.05, 0.075);
  root.add(mag);
  for (let i = 0; i < 4; i++) {
    const seg = add(new THREE.BoxGeometry(0.026, 0.05, 0.062 - i * 0.002), poly, 0, -0.025 - i * 0.046, i * i * 0.004, mag);
    seg.rotation.x = -0.06 * i;
  }
  for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(0.028, 0.004, 0.05), darker, 0, -0.02 - i * 0.022, 0.006 + i * 0.0035, mag);
  add(new THREE.BoxGeometry(0.03, 0.012, 0.072), poly, 0, -0.2, 0.04, mag).rotation.x = -0.2;

  /* ---- guardamonte, gatillo y empuñadura ---- */
  add(new THREE.BoxGeometry(0.012, 0.006, 0.07), poly, 0, -0.066, 0.005);
  add(new THREE.BoxGeometry(0.012, 0.022, 0.006), poly, 0, -0.056, 0.038);
  const trig = add(new THREE.BoxGeometry(0.006, 0.026, 0.006), metal, 0, -0.04, 0.012);
  trig.rotation.x = 0.35;
  const grip = add(new RoundedBoxGeometry(0.034, 0.115, 0.044, 3, 0.01), poly, 0, -0.085, -0.055);
  grip.rotation.x = 0.36;
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.036, 0.004, 0.012), darker, 0, 0.02 - i * 0.025, 0.02, grip);

  /* ---- culata telescópica ---- */
  add(cylZ(0.016, 0.016, 0.22, 16), metal, 0, 0.035, -0.235);
  for (let i = 0; i < 6; i++) add(cylZ(0.0175, 0.0175, 0.004, 16), darker, 0, 0.035, -0.17 - i * 0.02);
  add(
    sideShape([[-0.235, 0.064], [-0.375, 0.064], [-0.375, -0.064], [-0.355, -0.068], [-0.245, 0.0], [-0.235, 0.012]], 0.04),
    poly, 0, 0, 0
  );
  add(new THREE.BoxGeometry(0.045, 0.138, 0.016), rubber, 0, -0.002, -0.383);
  add(new THREE.BoxGeometry(0.008, 0.012, 0.03), metal, 0, -0.03, -0.27); // palanca de ajuste

  /* ---- manguera remote (malla trenzada) ---- */
  const hose = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.13, -0.085),
    new THREE.Vector3(0, -0.17, -0.1),
    new THREE.Vector3(0.012, -0.2, -0.16),
    new THREE.Vector3(0.03, -0.22, -0.27),
    new THREE.Vector3(0.05, -0.3, -0.4),
  ]);
  add(new THREE.TubeGeometry(hose, 28, 0.0055, 8), steel, 0, 0, 0);
  add(cylZ(0.009, 0.009, 0.022, 12), metal, 0, -0.13, -0.085).rotation.x = Math.PI / 2 + 0.6;

  if (hopper) root.add(buildHopper());

  root.traverse((o) => o.isMesh && (o.castShadow = true));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.032, 0.56);
  root.add(muzzle);
  return { root, muzzle };
}

/** Loader (tolva) ahumado translúcido con bolas de pintura, montado sobre el receptor */
function buildHopper() {
  const poly = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.62, metalness: 0.15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.36, metalness: 0.65 });
  const h = new THREE.Group();
  h.position.set(0, 0, 0.09);
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    h.add(m);
    return m;
  };
  // cuello de alimentación + abrazadera
  add(new THREE.CylinderGeometry(0.0155, 0.0155, 0.07, 16), metal, 0, 0.1, 0);
  add(new THREE.CylinderGeometry(0.021, 0.021, 0.018, 16), poly, 0, 0.12, 0);
  add(new THREE.BoxGeometry(0.012, 0.012, 0.018), metal, 0.024, 0.12, 0);
  // carcasa: elipsoide translúcido ahumado
  const shell = add(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshStandardMaterial({
    color: 0x2a2d33, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false,
  }), 0, 0.19, -0.01);
  shell.scale.set(0.068, 0.062, 0.105);
  shell.renderOrder = 3;
  // costura central, base y tapa
  add(new THREE.TorusGeometry(1, 0.03, 6, 40).rotateX(Math.PI / 2), poly, 0, 0.19, -0.01).scale.set(0.069, 0.069, 0.106);
  add(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), poly, 0, 0.19, -0.01).scale.set(0.069, 0.063, 0.106);
  add(new THREE.CylinderGeometry(1, 1, 1, 28), poly, 0, 0.252, 0.01).scale.set(0.04, 0.006, 0.055);
  add(new THREE.BoxGeometry(0.03, 0.008, 0.012), metal, 0, 0.252, -0.05); // bisagra
  // bolas de pintura dentro
  const colors = [0xffd60a, 0xff8a00, 0xff3b1f, 0xffd60a, 0x27e36b];
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0088, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.25 }), 64);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  let n = 0;
  for (let y = 0; y < 4 && n < 64; y++) {
    for (let k = 0; k < 40 && n < 64; k++) {
      const px = (Math.random() * 2 - 1) * 0.05, pz = (Math.random() * 2 - 1) * 0.085;
      const py = 0.145 + y * 0.016 + Math.random() * 0.006;
      if ((px / 0.06) ** 2 + ((py - 0.19) / 0.055) ** 2 + ((pz + 0.01) / 0.096) ** 2 > 1) continue; // dentro del elipsoide
      m4.makeTranslation(px, py, pz);
      balls.setMatrixAt(n, m4);
      balls.setColorAt(n, c.set(colors[n % colors.length]));
      n++;
    }
  }
  balls.count = n;
  h.add(balls);
  h.traverse((o) => o.isMesh && (o.castShadow = true));
  return h;
}

/* ==========================================================================
   Modelo 3D real de la marcadora (GLB generado a partir de foto)
   El archivo trae el cañón hacia +X; se normaliza a los ejes de buildMarker:
   cañón hacia +Z, origen sobre el gatillo y eje del cañón a y = 0.032.
   ========================================================================== */
const MARKER_GLB = 'models/bravoone.glb';
const MARKER_LENGTH = 0.9; // longitud total deseada (m)
let markerTemplatePromise = null;

export function loadMarkerTemplate() {
  if (!markerTemplatePromise) {
    markerTemplatePromise = new GLTFLoader().loadAsync(MARKER_GLB).then(async (gltf) => {
      const model = gltf.scene;
      // El exportador incluye 4 luces direccionales (intensidad 10) para su visor: quitarlas,
      // si no, cada copia de la marcadora sobreilumina toda la escena.
      const lights = [];
      model.traverse((o) => o.isLight && lights.push(o));
      lights.forEach((l) => l.removeFromParent());
      const meshes = [];
      model.traverse((o) => o.isMesh && meshes.push(o));
      meshes.forEach(rebuildMarkerMesh);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = MARKER_LENGTH / size.x;
      const triggerX = box.min.x + size.x * 0.35; // posición del gatillo a lo largo del arma
      const boreY = box.min.y + size.y * 0.69; // altura del eje del cañón
      model.position.set(-triggerX, -boreY, -(box.min.z + box.max.z) / 2);
      const inner = new THREE.Group();
      inner.add(model);
      inner.scale.setScalar(scale);
      inner.rotation.y = -Math.PI / 2; // +X del archivo → +Z (hacia delante)
      inner.position.y = 0.032;
      // conjunto final: modelo + placas laterales proyectadas sobre su superficie
      const holder = new THREE.Group();
      holder.add(inner);
      holder.updateMatrixWorld(true);
      try {
        holder.add(await buildBadges(meshes[0]));
      } catch (e) {
        console.warn('No se pudieron crear las placas de la marcadora', e);
      }
      return { inner: holder, muzzleZ: (box.max.x - triggerX) * scale };
    });
  }
  return markerTemplatePromise;
}

/* ---------- Placas laterales con la marca (en lugar de las del fabricante) ---------- */
function drawPlate() {
  const [c, g] = makeCanvas(512, 112);
  const r = 20;
  const rr = (x, y, w, h, rad) => {
    g.beginPath();
    g.roundRect(x, y, w, h, rad);
  };
  const silver = g.createLinearGradient(0, 0, 0, 112);
  silver.addColorStop(0, '#f1f3f5'); silver.addColorStop(0.5, '#9aa1a8'); silver.addColorStop(1, '#e3e6e9');
  rr(2, 2, 508, 108, r); g.fillStyle = silver; g.fill();
  const dark = g.createLinearGradient(0, 0, 0, 112);
  dark.addColorStop(0, '#2b2c2e'); dark.addColorStop(1, '#121314');
  rr(12, 12, 488, 88, r - 8); g.fillStyle = dark; g.fill();
  g.font = '74px "Germania One", Impact, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.fillText('VIKINGO', 258, 62);
  g.fillStyle = silver;
  g.fillText('VIKINGO', 256, 59);
  return c;
}
function drawBadge(logo) {
  const [c, g] = makeCanvas(256, 320);
  const silver = g.createLinearGradient(0, 0, 256, 320);
  silver.addColorStop(0, '#f1f3f5'); silver.addColorStop(0.5, '#8d949b'); silver.addColorStop(1, '#e3e6e9');
  g.beginPath(); g.roundRect(2, 2, 252, 316, 18); g.fillStyle = silver; g.fill();
  g.beginPath(); g.roundRect(14, 14, 228, 292, 10); g.fillStyle = '#0d0e10'; g.fill();
  if (logo && logo.width) {
    const box = 210, ar = logo.width / logo.height;
    const w = ar >= 1 ? box : box * ar, h = ar >= 1 ? box / ar : box;
    g.drawImage(logo, 128 - w / 2, 160 - h / 2, w, h);
  }
  return c;
}
async function buildBadges(bodyMesh) {
  const group = new THREE.Group();
  try {
    await Promise.race([document.fonts.load('74px "Germania One"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* sin fuente web */ }
  const logo = await loadImage('img/logo-vikingo.png');
  const mat = (cnv) => new THREE.MeshStandardMaterial({
    map: canvasTex(cnv, 8), transparent: true, metalness: 0.55, roughness: 0.32, envMapIntensity: 1.4,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false,
  });
  const plateMat = mat(drawPlate());
  const badgeMat = mat(drawBadge(logo));
  const ray = new THREE.Raycaster();
  const helper = new THREE.Object3D();
  const place = (y, z, side, size, material) => {
    ray.set(new THREE.Vector3(side * 0.25, y, z), new THREE.Vector3(-side, 0, 0));
    const hit = ray.intersectObject(bodyMesh, false)[0];
    if (!hit) return;
    // proyectar casi perpendicular al lateral (la superficie generada por IA es irregular)
    const n = hit.face.normal.clone().transformDirection(bodyMesh.matrixWorld).lerp(new THREE.Vector3(side, 0, 0), 0.7).normalize();
    helper.position.copy(hit.point);
    helper.lookAt(hit.point.clone().add(n));
    const decal = new THREE.Mesh(new DecalGeometry(bodyMesh, hit.point, helper.rotation, size), material);
    decal.renderOrder = 2;
    group.add(decal);
  };
  for (const side of [1, -1]) {
    place(MARKER_BADGES.plate.y, MARKER_BADGES.plate.z, side, new THREE.Vector3(0.078, 0.017, 0.05), plateMat);
    place(MARKER_BADGES.badge.y, MARKER_BADGES.badge.z, side, new THREE.Vector3(0.026, 0.0325, 0.05), badgeMat);
  }
  return group;
}
// posición de las placas en el espacio de la marcadora (z = hacia el cañón desde el gatillo, y = altura)
const MARKER_BADGES = { plate: { y: 0.058, z: 0.035 }, badge: { y: 0.004, z: 0.045 } };

/** Zonas (coordenadas crudas del archivo, vista lateral) que en la marcadora real están huecas */
const MARKER_HOLES = [
  // abertura del asa de transporte: entre el receptor y el borde inferior del asa (inclinado hacia delante)
  (x, y) => x > -0.183 && x < -0.03 && y > 0.1225 && y < 0.183 - 0.13 * (x + 0.19) - 0.03,
  // interior del guardamonte (deja ver el gatillo)
  (x, y) => x > -0.174 && x < -0.116 && y > -0.016 && y < 0.0135,
];

/** Mapa de normales de grano fino (pintura en polvo), repetido sobre el atlas UV */
let _powderNormal = null;
function powderCoatNormal() {
  if (_powderNormal) return _powderNormal;
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const h = new Float32Array(S * S).map(() => Math.random());
  // suavizado ligero para que el grano no sea ruido puro
  const hs = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
    hs[y * S + x] = s / 9;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hs[y * S + ((x + 1) % S)] - hs[y * S + ((x - 1 + S) % S)];
    const dy = hs[((y + 1) % S) * S + x] - hs[((y - 1 + S) % S) * S + x];
    const k = (y * S + x) * 4;
    img.data[k] = 128 + dx * 400;
    img.data[k + 1] = 128 + dy * 400;
    img.data[k + 2] = 255;
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _powderNormal = new THREE.CanvasTexture(c);
  _powderNormal.wrapS = _powderNormal.wrapT = THREE.RepeatWrapping;
  _powderNormal.repeat.set(10, 10);
  return _powderNormal;
}

/** Mapa de normales de malla trenzada (diagonales cruzadas) para la manguera */
let _braidNormal = null;
function braidNormal() {
  if (_braidNormal) return _braidNormal;
  const S = 64;
  const [c, g] = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = Math.sin(((x + y) / S) * Math.PI * 8), b = Math.sin(((x - y) / S) * Math.PI * 8);
    const k = (y * S + x) * 4;
    img.data[k] = 128 + (a + b) * 50;
    img.data[k + 1] = 128 + (a - b) * 50;
    img.data[k + 2] = 255;
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _braidNormal = new THREE.CanvasTexture(c);
  _braidNormal.wrapS = _braidNormal.wrapT = THREE.RepeatWrapping;
  _braidNormal.repeat.set(40, 40);
  return _braidNormal;
}

/**
 * Reconstruye la malla generada por IA como modelo propio:
 * - normales recalculadas por ángulo de arista (superficies lisas, aristas nítidas)
 * - textura limpiada: se conserva el relieve oscuro y se eliminan las manchas claras
 *   (restos del fondo blanco de la foto)
 * - la manguera remote (zona clara bajo la empuñadura) se separa con material de acero
 */
function rebuildMarkerMesh(mesh) {
  const src = mesh.material.map && mesh.material.map.image;
  let data = null, W = 0, H = 0;
  if (src) {
    W = src.width; H = src.height;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, W, H);
    data = img.data.slice(); // copia original para clasificar
    // limpieza: los píxeles claros se funden hacia el negro del polímero y se reduce el tinte azulado
    const d = img.data;
    // tono de referencia: gris carbón (foto Bravo One), no negro puro
    const ref = [40, 42, 45];
    for (let k = 0; k < d.length; k += 4) {
      const L = (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255;
      const t = Math.min(1, Math.max(0, (L - 0.16) / 0.14));
      const w = t * t * (3 - 2 * t);
      const g = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
      for (let ch = 0; ch < 3; ch++) {
        const desat = d[k + ch] * 0.3 + g * 0.7;
        // aclarar el relieve oscuro hacia el carbón, conservando su contraste
        const lifted = Math.min(255, desat * 1.3 + 8);
        d[k + ch] = lifted * (1 - w) + ref[ch] * w;
      }
    }
    ctx.putImageData(img, 0, 0);
    var cleanTex = new THREE.CanvasTexture(c);
    cleanTex.flipY = false; // convención glTF
    cleanTex.colorSpace = THREE.SRGBColorSpace;
    cleanTex.anisotropy = 4;
  }
  const lum = (u, v) => {
    if (!data) return 0;
    const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    const k = (y * W + x) * 4;
    return (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) / 255;
  };

  // separar triángulos: cuerpo / manguera
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const body = { p: [], u: [] }, hose = { p: [], u: [] };
  for (let t = 0; t < pos.count; t += 3) {
    let L = 0, cx = 0, cy = 0, uu = 0, vv = 0;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      L += lum(uv.getX(i), uv.getY(i));
      uu += uv.getX(i); vv += uv.getY(i);
      cx += pos.getX(i); cy += pos.getY(i);
    }
    L = (L + lum(uu / 3, vv / 3)) / 4;
    cx /= 3; cy /= 3;
    // huecos que la IA rellenó (asa de transporte y guardamonte): se eliminan esos triángulos
    if (MARKER_HOLES.some((h) => h(cx, cy))) continue;
    // zona de la manguera: por debajo del gatillo y por detrás del cargador (coordenadas del archivo)
    const isHose = L > 0.26 && cy < -0.085 && cx > -0.32 && cx < -0.03;
    const dst = isHose ? hose : body;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      dst.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      dst.u.push(uv.getX(i), uv.getY(i));
    }
  }
  const build = (part) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(part.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(part.u, 2));
    return toCreasedNormals(g, THREE.MathUtils.degToRad(32));
  };

  mesh.geometry = build(body);
  mesh.material = new THREE.MeshStandardMaterial({
    map: cleanTex || null,
    color: cleanTex ? 0xffffff : 0x2a2c2f,
    roughness: 0.5,
    metalness: 0.32,
    envMapIntensity: 1.25,
    // acabado texturizado tipo pintura en polvo (grano fino)
    normalMap: powderCoatNormal(),
    normalScale: new THREE.Vector2(0.15, 0.15),
    // al abrir los huecos, el interior de la carcasa queda a la vista por los bordes
    side: THREE.DoubleSide,
  });
  mesh.castShadow = true;

  // gatillo curvo dentro del guardamonte (coordenadas crudas del archivo: cañón hacia +X)
  const trigger = new THREE.Mesh(
    new THREE.TorusGeometry(0.018, 0.0032, 8, 14, 1.35),
    new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.7 })
  );
  trigger.rotation.z = Math.PI - 0.675; // arco "(" con la punta inferior hacia delante
  trigger.position.set(-0.124, -0.001, 0);
  const tg = new THREE.Group();
  tg.add(trigger);
  tg.position.copy(mesh.position);
  tg.quaternion.copy(mesh.quaternion);
  tg.scale.copy(mesh.scale);
  mesh.parent.add(tg);
  if (hose.p.length) {
    const h = new THREE.Mesh(build(hose), new THREE.MeshStandardMaterial({
      color: 0xd2d7dc, roughness: 0.3, metalness: 1, envMapIntensity: 1.6,
      normalMap: braidNormal(), normalScale: new THREE.Vector2(0.6, 0.6),
    }));
    h.position.copy(mesh.position);
    h.quaternion.copy(mesh.quaternion);
    h.scale.copy(mesh.scale);
    h.castShadow = true;
    mesh.parent.add(h);
  }
}

/** Crea una marcadora a partir del modelo GLB (con o sin loader) */
function markerFromTemplate(tpl, { hopper = true } = {}) {
  const root = new THREE.Group();
  root.add(tpl.inner.clone());
  if (hopper) root.add(buildHopper());
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.032, tpl.muzzleZ + 0.005);
  root.add(muzzle);
  return { root, muzzle };
}

/* ==========================================================================
   Estaciones: cada sección es un lugar del escenario al que viaja la cámara
   ========================================================================== */
export const STATIONS = {
  reservas: { cam: [-13.2, 2.5, -5.2], look: [-22, 1.7, -13.8], prop: [-22, -13.8], rot: 0.83 },
  juegos: { cam: [0, 11.5, -12.5], look: [0, 0, -25.5] },
  tienda: { cam: [13.4, 2.3, -4.6], look: [21, 1.5, -11.8], prop: [21, -11.8], rot: -0.84 },
  ranking: { cam: [0, 2.9, -35.5], look: [0, 2, -45.5], prop: [0, -45.5], rot: 0 },
};
// zonas que deben quedar libres de árboles y neumáticos (x, z, radio)
const CLEAR_ZONES = [
  [-22, -13.8, 7.5], [-17.6, -9.5, 3.2], [-13.2, -5.2, 2.5],
  [21, -11.8, 6.5], [17.2, -8.2, 3], [13.4, -4.6, 2.5],
  [0, -45.5, 10], [0, -40, 4], [0, -35.5, 2.5],
];
const inClearZone = (x, z, pad = 0) => CLEAR_ZONES.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + pad);

/** Altura del terreno: campo llano, ondulación suave fuera del campo y una ladera boscosa
 *  detrás del fuerte (así el suelo del bosque asoma por encima de la empalizada).
 *  El centro (podio del Ranking) queda llano. */
const HILL = 7;
function terrainHeight(x, z) {
  const grass = clamp((Math.hypot(x / 1.3, z + 16) - 26) / 14, 0, 1);
  const wave = grass * (Math.sin(x * 0.05) + Math.cos(z * 0.04)) * 0.9;
  let k = clamp((Math.abs(x) - 9) / 7, 0, 1);
  k = k * k * (3 - 2 * k); // 0 en el centro, 1 a los lados
  const z0 = -57 + 19 * k; // la ladera empieza en z=-57 en el centro y en z=-38 a los lados
  let t = clamp((z0 - z) / (14 + 10 * (1 - k)), 0, 1); // más pronunciada a los lados
  t = t * t * (3 - 2 * t);
  return wave + HILL * t;
}

function canvasTex(c, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Tela animada (bandera sujeta por la izquierda o estandarte colgado por arriba) */
function makeCloth(w, h, tex, mode) {
  const geo = new THREE.PlaneGeometry(w, h, 18, 12);
  const base = geo.attributes.position.array.slice();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
  mesh.castShadow = true;
  const phase = R(0, 6);
  return {
    mesh,
    update(t) {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        let z;
        if (mode === 'flag') {
          const k = (x + w / 2) / w;
          z = (Math.sin(x * 2.4 - t * 4.2 + phase) * 0.2 + Math.sin(y * 1.8 + t * 2.3) * 0.05) * k;
        } else {
          const k = (h / 2 - y) / h;
          z = (Math.sin(y * 1.5 - t * 1.8 + phase) * 0.14 + Math.sin(x * 2 + t * 1.3) * 0.05) * k;
        }
        p.setZ(i, z);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

function flagCanvas(color, dark) {
  const [c, g] = makeCanvas(256, 160);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = dark;
  g.fillRect(0, 0, 256, 14);
  g.fillRect(0, 146, 256, 14);
  g.strokeStyle = '#f3e6c8';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 80, 38, 0, Math.PI * 2);
  g.moveTo(98, 50); g.lineTo(158, 110);
  g.moveTo(158, 50); g.lineTo(98, 110);
  g.stroke();
  return c;
}

function stoneMaterial() {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#8b877f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `hsla(40, ${R(0, 10)}%, ${R(35, 70)}%, ${R(0.15, 0.5)})`;
    g.fillRect(R(0, 256), R(0, 256), R(1, 4), R(1, 4));
  }
  const t = canvasTex(c);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
}

function numeralMaterial(n, color) {
  const [c, g] = makeCanvas(256, 256);
  g.drawImage(stoneMaterial().map.image, 0, 0);
  g.font = '190px "Germania One", Impact, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.45)';
  g.fillText(n, 134, 146);
  g.fillStyle = color;
  g.fillText(n, 128, 138);
  return new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.8, metalness: 0.1 });
}

function trophy(color) {
  const pts = [[0, 0], [0.2, 0], [0.2, 0.05], [0.07, 0.09], [0.05, 0.26], [0.1, 0.3], [0.22, 0.36], [0.27, 0.54], [0.28, 0.68], [0.25, 0.68], [0.23, 0.55], [0.18, 0.4], [0, 0.36]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.22 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mat));
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 16, Math.PI * 1.2), mat);
    h.position.set(s * 0.28, 0.52, 0);
    h.rotation.z = s > 0 ? -Math.PI * 0.6 : Math.PI * 0.4 + Math.PI;
    g.add(h);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

/* Fuego animado: hoja de fotogramas con transparencia (generada a partir de un GIF de fuego) */
const FIRE = { url: 'img/fuego-sheet.webp', cols: 9, rows: 9, frames: 73, fps: 25 };
let fireImage = null;
function fireTexture() {
  // cada antorcha tiene su propia textura (comparte la imagen) para ir en un fotograma distinto
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / FIRE.cols, 1 / FIRE.rows);
  if (!fireImage) fireImage = loadImage(FIRE.url);
  fireImage.then((img) => {
    if (!img) return;
    tex.image = img;
    tex.needsUpdate = true;
  });
  return tex;
}
function setFireFrame(tex, f) {
  const col = f % FIRE.cols, row = Math.floor(f / FIRE.cols);
  tex.offset.set(col / FIRE.cols, 1 - (row + 1) / FIRE.rows);
}

function torch() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0x3b2a1b, roughness: 1 }));
  pole.position.y = 0.95;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.8, roughness: 0.5 }));
  bowl.position.y = 1.95;
  // llama: sprite siempre de cara a la cámara, con la base apoyada en el cuenco
  const fireTex = fireTexture();
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true, depthWrite: false, toneMapped: false }));
  flame.center.set(0.5, 0.17); // la base de la llama está al 17 % desde abajo del fotograma
  flame.scale.set(0.95, 1.42, 1);
  flame.position.y = 2.02;
  flame.renderOrder = 3;
  // en móvil sin luz puntual (cada una encarece todos los píxeles): la llama ya es luminosa
  const light = QUALITY.pointLights ? new THREE.PointLight(0xff9a3c, 3, 9, 1.6) : null;
  if (light) light.position.y = 2.5;
  pole.castShadow = true;
  g.add(pole, bowl, flame);
  if (light) g.add(light);
  const phase = R(0, 10);
  setFireFrame(fireTex, Math.floor(phase * 7) % FIRE.frames);
  g.userData = { fireTex, light, phase };
  return g;
}

function signPosts(parent, x, z, height, span, mat) {
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, height, 8), mat);
    p.position.set(x + (s * span) / 2, height / 2, z);
    p.castShadow = true;
    parent.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, span + 0.3, 8).rotateZ(Math.PI / 2), mat);
  bar.position.set(x, height - 0.1, z);
  parent.add(bar);
}

function buildStations({ scene, woodMat, logMat, solid }) {
  const slots = {}; // grupos donde se colgará el cartel de cada sección
  const rack = []; // marcadoras expuestas en la tienda
  const animated = [];
  const torches = [];
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const place = (g, key) => {
    const st = STATIONS[key];
    g.position.set(st.prop[0], 0, st.prop[1]);
    g.rotation.y = st.rot;
    scene.add(g);
    g.traverse((o) => o.isMesh && !o.userData.noHit && solid(o));
  };
  const slot = (parent, key, x, y, z, scale) => {
    const s = new THREE.Group();
    s.position.set(x, y, z);
    s.scale.setScalar(scale);
    parent.add(s);
    slots[key] = s;
  };

  /* ---------- RESERVAS: casa larga vikinga ---------- */
  {
    const g = new THREE.Group();
    const L = 8, D = 4.6, H = 2.4, base = 0.25, top = base + H;
    const thatch = thatchMaterial(); // paja en hileras con relieve
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 });
    add(g, new THREE.BoxGeometry(L + 1, base, D + 1.8), woodMat, 0, base / 2, 0.5);
    add(g, new THREE.BoxGeometry(L, H, D), logMat, 0, base + H / 2, 0);
    const ang = Math.atan(1.6 / 2.7);
    for (const s of [-1, 1]) {
      const r = add(g, new THREE.BoxGeometry(L + 0.8, 0.22, 3.2), thatch, 0, top + 0.8, s * 1.35);
      r.rotation.x = s * ang;
    }
    const tri = new THREE.Shape([new THREE.Vector2(-2.3, 0), new THREE.Vector2(2.3, 0), new THREE.Vector2(0, 1.55)]);
    for (const s of [-1, 1]) {
      const gable = add(g, new THREE.ShapeGeometry(tri), woodMat, s * (L / 2 - 0.01), top, 0);
      gable.rotation.y = s * Math.PI / 2;
      gable.material = woodMat.clone();
      gable.material.side = THREE.DoubleSide;
      // vigas cruzadas en el hastial (cabezas de dragón)
      for (const k of [-1, 1]) {
        const beam = add(g, new THREE.BoxGeometry(0.14, 2.4, 0.14), dark, s * (L / 2 + 0.35), top + 1.7, 0);
        beam.rotation.x = k * 0.62;
      }
    }
    add(g, new THREE.BoxGeometry(1.3, 2.0, 0.1), dark, 0, base + 1, D / 2 + 0.02);
    add(g, new THREE.BoxGeometry(1.6, 0.14, 0.16), woodMat, 0, base + 2.05, D / 2 + 0.05);
    const glow = new THREE.MeshStandardMaterial({ color: 0x3a220c, emissive: 0xffa040, emissiveIntensity: 0.9 });
    for (const x of [-2.6, 2.6]) add(g, new THREE.BoxGeometry(0.8, 0.55, 0.06), glow, x, base + 1.4, D / 2 + 0.02);
    // escudos en la fachada
    const shieldMats = [0x8e1b12, 0x1f4f7a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
    const boss = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.4 });
    [-1.45, 1.45].forEach((x, i) => {
      add(g, new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24).rotateX(Math.PI / 2), shieldMats[i], x, base + 1.55, D / 2 + 0.05);
      add(g, new THREE.SphereGeometry(0.09, 12, 8), boss, x, base + 1.55, D / 2 + 0.09);
    });
    // mesa con libro de reservas y farol
    const tz = D / 2 + 1.25;
    add(g, new THREE.BoxGeometry(1.7, 0.08, 0.8), woodMat, 2.3, 0.95, tz);
    for (const [dx, dz] of [[-0.75, -0.32], [0.75, -0.32], [-0.75, 0.32], [0.75, 0.32]]) add(g, new THREE.BoxGeometry(0.08, 0.7, 0.08), woodMat, 2.3 + dx, 0.6, tz + dz);
    const book = add(g, new THREE.BoxGeometry(0.42, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: 0x7a1d14, roughness: 0.6 }), 2.1, 1.03, tz);
    book.rotation.y = 0.3;
    add(g, new THREE.BoxGeometry(0.18, 0.28, 0.18), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.7, roughness: 0.4 }), 2.85, 1.13, tz);
    add(g, new THREE.BoxGeometry(0.12, 0.18, 0.12), new THREE.MeshBasicMaterial({ color: 0xffc46b }), 2.85, 1.13, tz);
    if (QUALITY.pointLights) {
      const lamp = new THREE.PointLight(0xffb060, 2.2, 7, 1.6);
      lamp.position.set(2.85, 1.4, tz + 0.3);
      g.add(lamp);
      torches.push({ userData: { light: lamp, base: 2.2, phase: 3 } });
    }
    // barriles de madera con duelas y aros de hierro
    for (const [bx, bz, ry] of [[-2.7, D / 2 + 1.1, 0.4], [-3.4, D / 2 + 0.6, 1.9]]) {
      const b = createWoodBarrel();
      b.position.set(bx, base, bz); // apoyados sobre la tarima
      b.rotation.y = ry;
      g.add(b);
    }
    // cartel de la sección sobre postes
    signPosts(g, -1.2, D / 2 + 1.9, 2.9, 2.4, logMat);
    slot(g, 'reservas', -1.2, 2.25, D / 2 + 1.95, 2.2);
    place(g, 'reservas');
  }

  /* ---------- TIENDA: puesto de mercado ---------- */
  {
    const g = new THREE.Group();
    const [sc, sg] = makeCanvas(256, 64);
    for (let i = 0; i < 8; i++) {
      sg.fillStyle = i % 2 ? '#efe2c2' : '#a3261a';
      sg.fillRect(i * 32, 0, 32, 64);
    }
    const stripes = canvasTex(sc);
    stripes.wrapS = THREE.RepeatWrapping;
    stripes.repeat.set(2, 1);
    const canvasMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.9, side: THREE.DoubleSide });
    for (const [x, z] of [[-1.9, -1.2], [1.9, -1.2], [-1.9, 1.3], [1.9, 1.3]]) add(g, new THREE.CylinderGeometry(0.08, 0.08, 2.75, 8), logMat, x, 1.37, z);
    add(g, new THREE.BoxGeometry(3.6, 1.0, 0.85), woodMat, 0, 0.5, 0.95);
    add(g, new THREE.BoxGeometry(3.8, 2.6, 0.1), woodMat, 0, 1.3, -1.25);
    const roof = add(g, new THREE.BoxGeometry(4.3, 0.05, 3.1), canvasMat, 0, 2.8, 0.05);
    roof.rotation.x = 0.13;
    add(g, new THREE.BoxGeometry(4.3, 0.32, 0.03), canvasMat, 0, 2.47, 1.62);
    // marcadoras expuestas en la pared
    for (let i = 0; i < 3; i++) {
      const m = buildMarker({ hopper: i === 2 }).root;
      m.scale.setScalar(1.25);
      m.rotation.y = Math.PI / 2;
      m.position.set(-0.1, 1.0 + i * 0.52, -1.1);
      m.userData.hopper = i === 2;
      m.traverse((o) => (o.userData.noHit = true));
      g.add(m);
      rack.push(m);
      for (const px of [-0.45, 0.3]) add(g, new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6).rotateX(Math.PI / 2), logMat, px, 0.94 + i * 0.52, -1.15);
    }
    // cajas de bolas de colores sobre el mostrador
    const ballGeo = new THREE.SphereGeometry(0.034, 8, 6);
    ['#ffd60a', '#ff3b1f', '#27e36b', '#1e90ff'].forEach((col, ci) => {
      const cx = -1.35 + ci * 0.62;
      add(g, new THREE.BoxGeometry(0.52, 0.16, 0.42), woodMat, cx, 1.08, 0.95);
      const inst = new THREE.InstancedMesh(ballGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.25 }), 30);
      const mtx = new THREE.Matrix4();
      for (let k = 0; k < 30; k++) {
        mtx.makeTranslation(cx - 0.2 + (k % 6) * 0.08, 1.18 + Math.floor(k / 18) * 0.04, 0.8 + (Math.floor(k / 6) % 3) * 0.13);
        inst.setMatrixAt(k, mtx);
      }
      g.add(inst);
    });
    const box = cardboardMaterial(); // cajas de cartón con cinta
    add(g, new THREE.BoxGeometry(0.55, 0.42, 0.45), box, 2.45, 0.21, 1.4);
    add(g, new THREE.BoxGeometry(0.5, 0.38, 0.42), box, 2.42, 0.61, 1.38).rotation.y = 0.2;
    add(g, new THREE.BoxGeometry(0.55, 0.42, 0.45), box, -2.5, 0.21, 1.2).rotation.y = -0.3;
    slot(g, 'tienda', 0, 3.25, 1.45, 2.4);
    place(g, 'tienda');
  }

  /* ---------- RANKING: podio, trofeos, estandarte y antorchas ---------- */
  let bannerCanvas, bannerTex;
  {
    const g = new THREE.Group();
    const stone = stoneMaterial();
    const podium = [
      { x: -1.5, h: 1.0, n: '2', c: '#d8dde2', tc: 0xc8ccd0 },
      { x: 0, h: 1.45, n: '1', c: '#ffd34d', tc: 0xe2b23c },
      { x: 1.5, h: 0.7, n: '3', c: '#d9925a', tc: 0xb87333 },
    ];
    for (const p of podium) {
      const mats = [stone, stone, stone, stone, numeralMaterial(p.n, p.c), stone];
      add(g, new THREE.BoxGeometry(1.45, p.h, 1.4), mats, p.x, p.h / 2, 0);
      const tr = trophy(p.tc);
      tr.scale.setScalar(p.n === '1' ? 1.5 : 1.1);
      tr.position.set(p.x, p.h, 0);
      g.add(tr);
    }
    for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(0.13, 0.16, 5.6, 10), logMat, s * 2.6, 2.8, -1.6);
    add(g, new THREE.CylinderGeometry(0.1, 0.1, 5.8, 10).rotateZ(Math.PI / 2), logMat, 0, 5.3, -1.6);
    [bannerCanvas] = makeCanvas(512, 640);
    bannerTex = canvasTex(bannerCanvas, 16); // estandarte con el logo: siempre nítido
    const banner = makeCloth(3.4, 4.2, bannerTex, 'hang');
    banner.mesh.position.set(0, 3.15, -1.65);
    g.add(banner.mesh);
    animated.push(banner);
    for (const s of [-1, 1]) {
      const t = torch();
      t.position.set(s * 3.4, 0, 1.1);
      g.add(t);
      torches.push(t);
    }
    slot(g, 'ranking', 0, 5.95, -1.6, 2.4);
    place(g, 'ranking');
  }

  /* ---------- JUEGOS: banderas de equipo y cartel en la entrada del fuerte ---------- */
  {
    const flags = [
      { x: -9.5, z: -19.5, c: flagCanvas('#b3261a', '#6e140c') },
      { x: 9.5, z: -21.5, c: flagCanvas('#1f5fa8', '#0f3462') },
    ];
    for (const f of flags) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.6, 8), new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 0.8, roughness: 0.3 }));
      pole.position.set(f.x, 2.3, f.z);
      pole.castShadow = true;
      const cloth = makeCloth(1.6, 1.0, canvasTex(f.c), 'flag');
      cloth.mesh.position.set(f.x + 0.82, 4.0, f.z);
      scene.add(pole, cloth.mesh);
      animated.push(cloth);
    }
    const g = new THREE.Group();
    signPosts(g, 0, -26.6, 4.2, 4.2, logMat);
    slot(g, 'juegos', 0, 3.4, -26.5, 3);
    scene.add(g);
  }

  function drawBanner(logoImg) {
    const g = bannerCanvas.getContext('2d');
    const W = bannerCanvas.width, H = bannerCanvas.height;
    g.fillStyle = '#7d1810';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(0,0,0,${R(0.03, 0.1)})`;
      g.fillRect(R(0, W), R(0, H), R(1, 3), R(4, 14));
    }
    g.strokeStyle = '#d8a743';
    g.lineWidth = 16;
    g.strokeRect(26, 26, W - 52, H - 52);
    g.lineWidth = 4;
    g.strokeRect(48, 48, W - 96, H - 96);
    if (logoImg && logoImg.width) {
      const box = W * 0.66, ar = logoImg.width / logoImg.height;
      const w = ar >= 1 ? box : box * ar, h = ar >= 1 ? box / ar : box;
      g.drawImage(logoImg, (W - w) / 2, H * 0.42 - h / 2, w, h);
    }
    g.fillStyle = '#d8a743';
    g.font = '64px "Germania One", Impact, serif';
    g.textAlign = 'center';
    g.fillText('HALL OF FAME', W / 2, H - 92);
    bannerTex.needsUpdate = true;
  }

  /** Sustituye las marcadoras procedurales del expositor por el modelo GLB */
  function swapRack(tpl) {
    rack.forEach((old, i) => {
      const m = markerFromTemplate(tpl, { hopper: old.userData.hopper }).root;
      m.position.copy(old.position);
      m.rotation.copy(old.rotation);
      m.scale.copy(old.scale);
      old.parent.add(m);
      old.removeFromParent();
      rack[i] = m;
    });
  }

  return {
    slots,
    drawBanner,
    swapRack,
    animate(t) {
      for (const a of animated) a.update(t);
      for (const tc of torches) {
        const { light, fireTex, phase, base = 3 } = tc.userData;
        if (light) light.intensity = base + Math.sin(t * 13 + phase) * 0.35 + Math.sin(t * 7.3 + phase) * 0.25;
        if (fireTex) setFireFrame(fireTex, Math.floor(t * FIRE.fps + phase * 7) % FIRE.frames);
      }
    },
  };
}

/* ==========================================================================
   createScene
   ========================================================================== */
export async function createScene({ canvas, crosshair, content, onSectionHit, onFirstShot }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUALITY.antialias, powerPreference: 'high-performance' });
  const maxPixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY.pixelRatio);
  let pixelRatio = maxPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = QUALITY.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  // en móvil el mapa de sombras se recalcula cada pocos fotogramas (casi todo el escenario es estático)
  if (QUALITY.shadowEvery > 1) renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxAniso = Math.min(renderer.capabilities.getMaxAnisotropy(), QUALITY.aniso);
  // logo, carteles y estandarte: filtrado máximo en todos los dispositivos (es muy barato y mejora mucho el texto)
  const sharpAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  // Paleta tomada de fondo.png (pinar al atardecer, a contraluz):
  // bruma oliva del horizonte #57572e, franja dorada superior #8e7551, musgo #3c4621 / #242b14, sol #faf5e8
  const HORIZON = new THREE.Color(0x6e6b3c);
  scene.fog = new THREE.Fog(HORIZON, 30, 118);
  scene.background = HORIZON;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(55, 1, 0.03, 400);
  camera.position.set(0, 1.6, 0);
  scene.add(camera);

  /* ----- cielo ----- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0xb59c6c) }, mid: { value: HORIZON } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(mid, top, smoothstep(0.02, 0.55, h)); gl_FragColor = vec4(c,1.0); }',
    })
  );
  scene.add(sky);

  /* ----- luces ----- */
  // cielo cálido y rebote verde del musgo
  scene.add(new THREE.HemisphereLight(0xffe0a8, 0x3c4621, 1.15));
  // sol dorado a contraluz, en la misma dirección que el sol de la foto de fondo
  // (46° a la derecha del frente; algo más alto que en la foto para que las sombras no sean infinitas)
  const sun = new THREE.DirectionalLight(0xffc56e, 3.3);
  sun.target.position.set(0, 0, -14);
  const TO_SUN = new THREE.Vector3(); // dirección hacia el sol (la usan también los rayos de luz)
  {
    const az = THREE.MathUtils.degToRad(BACKDROP.sunAzimuth), el = THREE.MathUtils.degToRad(24);
    TO_SUN.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sun.position.copy(sun.target.position).addScaledVector(TO_SUN, 60);
  }
  sun.castShadow = true;
  sun.shadow.mapSize.set(QUALITY.shadowSize, QUALITY.shadowSize);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  // relleno cálido desde la cámara: a contraluz, las caras de los carteles no deben quedar negras
  const fill = new THREE.DirectionalLight(0xffe2b8, 0.75);
  fill.position.set(-5, 7, 14);
  fill.target.position.set(0, 2, -10);
  scene.add(fill, fill.target);

  /* ----- fondo fotográfico: panorama curvo con fondo.png ----- */
  loadImage(BACKDROP.url).then((img) => {
    if (!img) return;
    const [c, g] = makeCanvas(img.width, img.height);
    // dibujado en espejo: el cilindro se ve desde dentro
    g.save();
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(img, 0, 0);
    g.restore();
    // bordes fundidos con el cielo (laterales y parte superior)
    g.globalCompositeOperation = 'destination-in';
    const gx = g.createLinearGradient(0, 0, c.width, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)');
    gx.addColorStop(0.09, 'rgba(0,0,0,1)');
    gx.addColorStop(0.91, 'rgba(0,0,0,1)');
    gx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gx;
    g.fillRect(0, 0, c.width, c.height);
    const gy = g.createLinearGradient(0, 0, 0, c.height);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(0.1, 'rgba(0,0,0,1)');
    gy.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gy;
    g.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    const arc = THREE.MathUtils.degToRad(BACKDROP.arc);
    const height = (BACKDROP.radius * arc) / (img.width / img.height);
    const geo = new THREE.CylinderGeometry(BACKDROP.radius, BACKDROP.radius, height, 96, 1, true, Math.PI - arc / 2, arc);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    }));
    // la línea del horizonte de la foto queda a la altura de los ojos
    mesh.position.y = HOME_POS.y - (0.5 - BACKDROP.eye) * height;
    mesh.renderOrder = -1; // siempre detrás de la bruma y los rayos
    scene.add(mesh);
  });

  const solids = []; // objetos que reciben impactos
  const solid = (o) => (solids.push(o), o);

  /* ----- suelo ----- */
  const groundGeo = new THREE.PlaneGeometry(320, 320, 160, 160).rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 + Math.sin(x * 0.031 + z * 0.047) * 0.5;
      const d = Math.hypot(x / 1.3, z + 16);
      const grass = clamp((d - 26) / 14, 0, 1);
      // tierra del campo algo más cálida; fuera del campo, musgo como el de la foto de fondo
      // tierra húmeda del campo (la textura ya es oscura: aquí solo variación suave)
      c.setRGB(0.95 + n * 0.08, 0.9 + n * 0.07, 0.84 + n * 0.06);
      c.lerp(new THREE.Color(0.42, 0.8, 0.3), grass * 0.92);
      colors.push(c.r, c.g, c.b);
      // ondulación suave fuera del campo
      pos.setY(i, terrainHeight(x, z));
    }
    groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
  }
  const ground = solid(
    new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ ...dirtTexture(maxAniso), vertexColors: true, roughness: 1 }))
  );
  ground.receiveShadow = true;
  scene.add(ground);

  /* ----- materiales de madera ----- */
  const woodTex = new THREE.CanvasTexture(woodCanvas(512, 512, { planks: 4, hue: 28, light: 36 }));
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.9 });
  const logTex = new THREE.CanvasTexture(woodCanvas(256, 512, { planks: 1, hue: 26, light: 28, vertical: true }));
  logTex.colorSpace = THREE.SRGBColorSpace;
  logTex.wrapS = logTex.wrapT = THREE.RepeatWrapping;
  logTex.repeat.set(3, 1);
  const logMat = new THREE.MeshStandardMaterial({ map: logTex, roughness: 0.95 });

  /* ----- neumáticos apilados ----- */
  {
    const stacks = [];
    const tryAdd = (x, z, h) => {
      if (Math.abs(x) < 2.2 && z > -14) return;
      if (z > -6 && Math.abs(x) < 5) return; // no tapar la marcadora
      if (inClearZone(x, z, 0.8)) return;
      if (stacks.some((s) => Math.hypot(s.x - x, s.z - z) < 1.1)) return;
      stacks.push({ x, z, h });
    };
    for (let i = 0; i < 60 && stacks.length < 34; i++) tryAdd(R(-16, 16), R(-34, -3.5), Math.floor(R(2, 6)));
    // muros de neumáticos
    for (let i = 0; i < 4; i++) tryAdd(-6.5 + i * 0.95, -15, 3);
    for (let i = 0; i < 4; i++) tryAdd(4 + i * 0.95, -18, 4);
    for (let i = 0; i < 3; i++) tryAdd(-11 + i * 0.95, -7.5, 3);
    const total = stacks.reduce((a, s) => a + s.h, 0);
    // neumático real: banda de rodadura con dibujo, flancos y caucho negro (ver props.js)
    const { geo: tireGeo, mat: tireMat } = tireAssets();
    const tire = new THREE.InstancedMesh(tireGeo, tireMat, total);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let k = 0;
    for (const s of stacks) {
      // (mismas llamadas aleatorias que antes: la distribución del campo no cambia)
      const dusty = rnd() < 0.35 ? R(0.55, 0.75) : R(0.1, 0.2); // algunas pilas más polvorientas
      for (let j = 0; j < s.h; j++) {
        const tiltX = R(-0.05, 0.05), tiltZ = R(-0.05, 0.05), yaw = R(0, 6);
        e.set(tiltX * 0.5, yaw, tiltZ * 0.5);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(s.x + R(-0.04, 0.04), TIRE_HEIGHT / 2 + j * TIRE_HEIGHT * 0.98, s.z + R(-0.04, 0.04)), q, new THREE.Vector3(1, 1, 1));
        tire.setMatrixAt(k, m);
        const v = 0.92 + R(-0.04, 0.04) + (dusty > 0.5 ? 0.25 : 0);
        col.setRGB(v * 1.04, v, v * 0.94); // ligero tono de polvo/barro
        tire.setColorAt(k, col);
        k++;
      }
    }
    tire.castShadow = tire.receiveShadow = true;
    solid(tire);
    scene.add(tire);
  }

  /* ----- bidones ----- */
  {
    // bidones metálicos de 200 L con aros, tapa, pintura gastada y óxido (ver props.js)
    const colors = [0x8e2a1a, 0x24476e, 0x3d5228, 0x8e2a1a, 0x5c5e60, 0xa8821f];
    for (let i = 0; i < 7; i++) {
      const x = R(-12, 12), z = R(-28, -6);
      if (Math.abs(x) < 2.5) continue;
      const drum = createDrum(colors[i % colors.length]);
      drum.position.y = -DRUM_HEIGHT / 2; // pivote en el centro
      const b = new THREE.Group();
      b.add(drum);
      b.position.set(x, DRUM_HEIGHT / 2, z);
      b.rotation.y = (i * 2.399) % 6.28;
      if (rnd() < 0.3) { b.rotation.z = Math.PI / 2; b.position.y = 0.297; b.rotation.y = R(0, 3); } // tumbado
      scene.add(b);
      solid(drum.children[0]);
    }
  }

  /* ----- empalizada vikinga ----- */
  let palisadeLogs = null;
  {
    const pts = [];
    const seg = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.floor(len / 0.34);
      for (let i = 0; i <= n; i++) pts.push([x1 + ((x2 - x1) * i) / n, z1 + ((z2 - z1) * i) / n, R(2.2, 2.8)]);
    };
    seg(-17, -23, -6, -27);
    seg(6, -27, 17, -23);
    seg(-6, -27, -6, -31);
    seg(6, -27, 6, -31);
    const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.18, 1, 12), logMat, pts.length);
    const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.45, 9), logMat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z, h], i) => {
      m.makeScale(1, h, 1).setPosition(x, h / 2, z);
      logs.setMatrixAt(i, m);
      m.makeTranslation(x, h + 0.22, z);
      tips.setMatrixAt(i, m);
    });
    logs.castShadow = tips.castShadow = true;
    logs.receiveShadow = true;
    scene.add(solid(logs), solid(tips));
    palisadeLogs = logs; // recibirá la corteza de los pinos más abajo
  }

  /* ----- árboles ----- */
  {
    // Pinos como los del fondo fotográfico: troncos altos y gruesos (la punta queda fuera de la vista),
    // corteza con relieve y ramitas secas a lo largo del tronco.
    const N = 140;
    const bark = barkTextures();
    // la empalizada usa la misma corteza (troncos sin desbastar)
    if (palisadeLogs) {
      const pm = bark.map.clone(), pn = bark.normal.clone();
      for (const t of [pm, pn]) { t.repeat.set(1, 2.6); t.needsUpdate = true; }
      palisadeLogs.material = new THREE.MeshStandardMaterial({ map: pm, normalMap: pn, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.95 });
    }
    // perfil del tronco (radio relativo, altura relativa): base ensanchada, estrechamiento suave y punta
    const profile = [[1.3, 0], [1.0, 0.012], [0.9, 0.04], [0.78, 0.25], [0.66, 0.55], [0.52, 0.8], [0.32, 0.94], [0.04, 1]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const trunkGeo = new THREE.LatheGeometry(profile, 12);
    {
      // LatheGeometry reparte la V de la textura por puntos del perfil: rehacerla por altura real
      // (si no, la corteza sale aplastada en la base y estirada arriba)
      const pos = trunkGeo.attributes.position, uv = trunkGeo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setY(k, pos.getY(k));
      uv.needsUpdate = true;
    }
    const trunkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);

    // ramita: cilindro afinado con la base en el origen, apuntando a +Y
    const twigGeo = new THREE.CylinderGeometry(0.25, 1, 1, 5).translate(0, 0.5, 0);
    const twigMat = new THREE.MeshStandardMaterial({ map: bark.map, roughness: 1, color: 0x8a7a68 });
    const twigData = [];
    let drawn = 0;

    const m = new THREE.Matrix4(), col = new THREE.Color(), q = new THREE.Quaternion();
    const UPY = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), sub = new THREE.Vector3(), p = new THREE.Vector3();
    const radiusAt = (t) => { // radio relativo del perfil a la altura relativa t
      for (let k = 1; k < profile.length; k++) {
        if (t <= profile[k].y) {
          const a = profile[k - 1], b = profile[k];
          return a.x + ((t - a.y) / (b.y - a.y)) * (b.x - a.x);
        }
      }
      return 0.04;
    };
    for (let i = 0; i < N; i++) {
      let x, z, tries = 0;
      do {
        if (i < 80) { x = R(-75, 75); z = R(-95, -38); }
        else { const side = i % 2 ? 1 : -1; x = side * R(24, 55); z = R(-40, 6); }
      } while (inClearZone(x, z, 2.5) && ++tries < 20);
      const height = R(34, 48), radius = R(0.32, 0.55);
      const gy = terrainHeight(x, z) - 0.3; // base del tronco algo enterrada (en ladera)
      const keep = QUALITY.keepTree(i); // en móvil se dibujan ~2 de cada 3 (se calculan todos: el resto del escenario no cambia)
      m.makeScale(radius, height, radius).setPosition(x, gy, z);
      if (keep) trunks.setMatrixAt(drawn, m);
      col.setScalar(R(0.75, 1.1));
      if (keep) trunks.setColorAt(drawn++, col);

      // ramitas secas: más abundantes en la parte baja y media, como en un pinar
      const nTwigs = Math.floor(R(9, 16));
      for (let k = 0; k < nTwigs; k++) {
        const t = R(0.06, 0.45);
        const y = t * height;
        const az = R(0, Math.PI * 2);
        const rr = radiusAt(t) * radius;
        const tilt = R(1.15, 1.85); // ~66°-106° desde la vertical: casi horizontales, algunas caídas
        dir.set(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
        const len = R(0.6, 2.2) * (1 - t * 0.6);
        const thick = R(0.025, 0.05);
        p.set(x + Math.cos(az) * rr * 0.9, gy + y, z + Math.sin(az) * rr * 0.9);
        const keepTwig = keep && QUALITY.keepTwig(k);
        if (keepTwig) twigData.push({ p: p.clone(), dir: dir.clone(), len, thick });
        // pequeña bifurcación a mitad de la rama
        if (rnd() < 0.55) {
          sub.copy(dir).applyAxisAngle(UPY, R(-0.7, 0.7)).add(new THREE.Vector3(0, R(-0.25, 0.35), 0)).normalize();
          if (keepTwig) twigData.push({ p: p.clone().addScaledVector(dir, len * R(0.4, 0.65)), dir: sub.clone(), len: len * R(0.35, 0.55), thick: thick * 0.6 });
        }
      }
    }
    const twigs = new THREE.InstancedMesh(twigGeo, twigMat, twigData.length);
    twigData.forEach((tw, k) => {
      q.setFromUnitVectors(UPY, tw.dir);
      m.compose(tw.p, q, new THREE.Vector3(tw.thick, tw.len, tw.thick));
      twigs.setMatrixAt(k, m);
    });
    trunks.count = drawn;
    trunks.castShadow = trunks.receiveShadow = true;
    twigs.castShadow = QUALITY.twigShadows;
    scene.add(solid(trunks), twigs);
  }

  /* ----- bruma en movimiento y rayos de sol, solo entre los árboles ----- */
  // despejado: el campo de juego (misma elipse que el suelo de tierra) y las estaciones
  const isClearArea = (x, z, pad = 0) => Math.hypot(x / 1.3, z + 16) < 27 + pad || inClearZone(x, z, pad);
  const atmosphere = createAtmosphere({
    scene, toSun: TO_SUN, rand: rnd, isClear: isClearArea, groundHeight: terrainHeight,
    mistCount: QUALITY.mist, rayCount: QUALITY.rays, detailed: QUALITY.mistDetail,
  });

  /* ----- un jugador en silueta cruza corriendo entre los árboles (uno cada vez) ----- */
  preloadScreenSplats(RUNNER_PAINT);
  const runner = createRunner({
    scene,
    camera,
    isClear: isClearArea,
    occluders: solids,
    spawnTries: QUALITY.spawnTries,
    // solo dispara a la cámara en la portada y con la cámara quieta
    canShoot: () => mode === 'home' && !tween,
    onScreenHit: screenSplat,
    groundHeight: terrainHeight,
  });

  /* ----- caja de palés en primer plano (como en la foto) ----- */
  {
    const crate = new THREE.Group();
    const W = 1.6, H = 1.05, D = 1.15, slatH = 0.14, gap = 0.07;
    const slatGeoW = new THREE.BoxGeometry(W, slatH, 0.035);
    const slatGeoD = new THREE.BoxGeometry(0.035, slatH, D);
    for (let y = slatH / 2 + 0.02; y < H; y += slatH + gap) {
      for (const z of [-D / 2, D / 2]) {
        const s = new THREE.Mesh(slatGeoW, woodMat);
        s.position.set(0, y, z);
        s.rotation.z = R(-0.01, 0.01);
        crate.add(s);
      }
      for (const x of [-W / 2, W / 2]) {
        const s = new THREE.Mesh(slatGeoD, woodMat);
        s.position.set(x, y, 0);
        crate.add(s);
      }
    }
    for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, H + 0.05, 0.08), woodMat);
      p.position.set(x, (H + 0.05) / 2, z);
      crate.add(p);
    }
    crate.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; solid(o); } });
    crate.position.set(-2.3, 0, -3.6);
    crate.rotation.y = 0.32;
    scene.add(crate);
  }

  /* ----- estaciones de cada sección ----- */
  const stations = buildStations({ scene, woodMat, logMat, solid });

  /* ==========================================================================
     Pórtico con carteles (menú) y escudo
     ========================================================================== */
  const gate = new THREE.Group();
  scene.add(gate);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1, 12).rotateZ(Math.PI / 2), logMat);
  const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1, 12), logMat);
  const postR = postL.clone();
  for (const o of [beam, postL, postR]) { o.castShadow = true; gate.add(solid(o)); }

  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xb59a6a, roughness: 1 });
  const ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6);
  const boardGeo = new THREE.BoxGeometry(1, 1 / BOARD_RATIO, 0.05);

  const boards = [];
  function createBoard(key) {
    const pivot = new THREE.Group();
    const rig = new THREE.Group();
    pivot.add(rig);
    const cnv = document.createElement('canvas');
    cnv.width = 1024;
    cnv.height = 400;
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = sharpAniso; // texto del cartel siempre nítido
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: 0xffb347, emissiveMap: tex, emissiveIntensity: 0 });
    const mesh = new THREE.Mesh(boardGeo, [woodMat, woodMat, woodMat, woodMat, front, woodMat]);
    const ropeN = 0.18, hN = 1 / BOARD_RATIO;
    mesh.position.y = -(ropeN + hN / 2);
    mesh.castShadow = true;
    mesh.userData = { section: key, dynamic: true };
    rig.add(mesh);
    for (const x of [-0.38, 0.38]) {
      const r = new THREE.Mesh(ropeGeo, ropeMat);
      r.scale.y = ropeN + 0.02;
      r.position.set(x, -ropeN / 2, 0);
      rig.add(r);
    }
    gate.add(pivot);
    solid(mesh);
    const b = { key, pivot, rig, mesh, canvas: cnv, tex, front, label: null, swing: 0, swingV: 0, phase: R(0, 6), hover: 0 };
    boards.push(b);
    return b;
  }

  // escudo
  const shield = { pivot: new THREE.Group(), body: new THREE.Group(), swing: 0, swingV: 0 };
  const shieldCanvas = document.createElement('canvas');
  shieldCanvas.width = shieldCanvas.height = 1024;
  const shieldTex = new THREE.CanvasTexture(shieldCanvas);
  shieldTex.colorSpace = THREE.SRGBColorSpace;
  shieldTex.anisotropy = sharpAniso; // logo siempre nítido
  {
    // color < blanco atenúa el brillo del escudo (logo); roughness alta = sin reflejos
    const face = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshStandardMaterial({ map: shieldTex, color: 0xa8a29a, roughness: 0.92, envMapIntensity: 0.6 }));
    face.position.z = 0.05;
    face.userData = { shield: true, dynamic: true };
    const back = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateY(Math.PI), woodMat);
    back.position.z = -0.05;
    const side = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 72, 1, true).rotateX(Math.PI / 2), logMat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 72), new THREE.MeshStandardMaterial({ color: 0x4a4440, metalness: 0.9, roughness: 0.45 }));
    rim.position.z = 0.05;
    shield.body.add(face, back, side, rim);
    shield.body.traverse((o) => o.isMesh && (o.castShadow = true));
    shield.chains = [new THREE.Mesh(ropeGeo, ropeMat), new THREE.Mesh(ropeGeo, ropeMat)];
    shield.pivot.add(shield.body, ...shield.chains);
    gate.add(shield.pivot);
    solid(face);
    shield.face = face;
  }

  let layoutInfo = { W: 1, H: 1 };
  function layout() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 72 : aspect < 1.3 ? 63 : 55;
    camera.updateProjectionMatrix();

    const H = DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const W = H * aspect;
    layoutInfo = { W, H };
    const camY = HOME_POS.y;
    const n = boards.length || 1;
    const halfSpan = Math.min(W * 0.94, 9);
    const slot = (2 * halfSpan) / n;
    const bw = clamp(slot * 0.86, 0.8, 2.6);
    const bh = bw / BOARD_RATIO;
    const yBeam = camY + H * 0.86;
    const boardBottom = yBeam - bw * (0.18 + 1 / BOARD_RATIO);

    boards.forEach((b, i) => {
      b.pivot.position.set(-halfSpan + slot * (i + 0.5), yBeam, -DEPTH);
      b.rig.scale.setScalar(bw);
    });

    const beamLen = 2 * Math.min(W * 1.02, 10);
    beam.scale.set(beamLen, 1, 1);
    beam.position.set(0, yBeam + 0.1, -DEPTH);
    const postH = yBeam + 0.6;
    for (const [p, sx] of [[postL, -1], [postR, 1]]) {
      p.scale.set(1, postH, 1);
      p.position.set((sx * beamLen) / 2 - sx * 0.1, postH / 2, -DEPTH - 0.05);
    }

    // escudo colgado bajo los carteles
    const Rs = Math.min(W * 0.45, H * 0.33, 2.1);
    const shieldTop = boardBottom - H * 0.07;
    const chainLen = Math.max(0.2, yBeam - shieldTop);
    shield.pivot.position.set(0, yBeam, -DEPTH + 0.3);
    shield.body.scale.setScalar(Rs);
    shield.body.position.set(0, -(chainLen + Rs), 0);
    const ax = Math.min(Rs * 0.3, slot * 0.5 - bw * 0.43 - 0.05);
    const chainBottom = chainLen + Rs - Math.sqrt(Math.max(0, Rs * Rs - ax * ax));
    shield.chains.forEach((c, i) => {
      c.scale.set(1.4, chainBottom, 1.4);
      c.position.set((i ? 1 : -1) * Math.max(0.04, ax), -chainBottom / 2, 0);
    });

    positionGun();
    // el encuadre de la estación depende del ancho de pantalla
    if (mode === 'station' && currentStation) stationPose = poseFor(currentStation);
  }

  async function refresh(c) {
    const order = c.order || Object.keys(c.sections);
    order.forEach((key, i) => {
      const b = boards[i] || createBoard(key);
      b.key = key;
      b.mesh.userData.section = key;
      const label = c.sections[key]?.label || key;
      if (label !== b.label) {
        b.label = label;
        drawBoard(b.canvas, label);
        b.tex.needsUpdate = true;
      }
      // copia del cartel en la estación de la sección (comparte textura)
      const slot = stations.slots[key];
      if (slot && !slot.userData.sign) {
        const sign = new THREE.Mesh(boardGeo, [woodMat, woodMat, woodMat, woodMat, b.front, woodMat]);
        sign.castShadow = true;
        slot.add(sign);
        slot.userData.sign = sign;
      }
    });
    if (c.site.logo !== shield.logoSrc) {
      shield.logoSrc = c.site.logo;
      const img = await loadImage(mediaUrl(c.site.logo));
      drawShield(shieldCanvas, img);
      shieldTex.needsUpdate = true;
      stations.drawBanner(img);
    }
    layout();
  }

  /* ==========================================================================
     Marcadora
     ========================================================================== */
  const gunPivot = new THREE.Group();
  const gunRecoil = new THREE.Group();
  // se empieza con la marcadora procedural y se sustituye por el modelo GLB en cuanto carga
  let { root: gunModel, muzzle } = buildMarker();
  gunRecoil.add(gunModel);
  loadMarkerTemplate()
    .then((tpl) => {
      const real = markerFromTemplate(tpl);
      real.root.scale.copy(gunModel.scale);
      gunRecoil.remove(gunModel);
      gunRecoil.add(real.root);
      gunModel = real.root;
      muzzle = real.muzzle;
      stations.swapRack(tpl);
    })
    .catch((e) => console.warn('Modelo de marcadora no disponible, se usa la versión procedural.', e));
  gunPivot.add(gunRecoil);
  camera.add(gunPivot);
  // luz de relleno para que la marcadora no quede negra
  if (QUALITY.pointLights) {
    const gunLight = new THREE.PointLight(0xfff2e0, 0.6, 2.5);
    gunLight.position.set(-0.2, 0.25, 0.1);
    camera.add(gunLight);
  }

  function positionGun() {
    const d = 0.62;
    const h = d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const w = h * camera.aspect;
    const portrait = camera.aspect < 0.8;
    gunPivot.position.set(w * (portrait ? 0.42 : 0.4), -h * (portrait ? 0.52 : 0.55), -d);
    gunPivot.userData.base = gunPivot.position.clone();
    gunModel.scale.setScalar(portrait ? 0.62 : 0.74);
  }

  /* ==========================================================================
     Interacción
     ========================================================================== */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0, 0.15);
  const aimPoint = new THREE.Vector3(0, 3, -DEPTH);
  let pointerActive = false;
  let pointerDirty = true;
  let hovered = null;
  let navigating = false;
  let lastShot = 0;
  let shotCount = 0;
  let running = true;
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const curQ = new THREE.Quaternion();

  /* ----- modos de cámara: 'home' (portada), 'travel' (viajando), 'station' (en una sección) ----- */
  let mode = 'home';
  let currentStation = null;
  let stationPose = null;
  let tween = null;
  let gunAway = 0;
  const parallax = { x: 0, y: 0 };
  const UP = new THREE.Vector3(0, 1, 0);
  const homeQ = new THREE.Quaternion();

  /** Posición y orientación de la cámara en una estación (con desplazamiento lateral en pantallas anchas) */
  function poseFor(key) {
    const st = STATIONS[key] || STATIONS.juegos;
    const look = new THREE.Vector3(...st.look);
    const pos = new THREE.Vector3(...st.cam);
    // en vertical el campo de visión horizontal es estrecho: alejar la cámara para que quepa el decorado
    if (camera.aspect < 1) pos.sub(look).multiplyScalar(1 + (1 - camera.aspect) * 0.9).add(look);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, look, UP));
    const w = canvas.clientWidth || window.innerWidth;
    if (camera.aspect > 1.25 && w >= 1000) {
      // el contenido va a la izquierda: girar la cámara para que el decorado quede a la derecha
      const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, hfov * 0.25));
    } else if (camera.aspect < 1.25) {
      // pantallas verticales: el contenido va debajo, inclinar la cámara para que el decorado suba
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(camera.fov) * 0.2));
    }
    return { pos, q };
  }

  function travel(pose, to, instant) {
    if (tween) tween.resolve(false);
    hovered = null;
    crosshair.classList.remove('target', 'visible');
    return new Promise((resolve) => {
      if (instant) {
        camera.position.copy(pose.pos);
        camera.quaternion.copy(pose.q);
        mode = to === 'home' ? 'home' : 'station';
        gunAway = to === 'home' ? 0 : 1;
        tween = null;
        return resolve(true);
      }
      const p0 = camera.position.clone();
      const q0 = camera.quaternion.clone();
      const dist = p0.distanceTo(pose.pos);
      const ctrl = p0.clone().add(pose.pos).multiplyScalar(0.5);
      ctrl.y = Math.max(ctrl.y + dist * 0.22 + 2, Math.max(p0.y, pose.pos.y) + 1.5);
      mode = 'travel';
      tween = { p0, q0, ctrl, p1: pose.pos, q1: pose.q, t: 0, dur: clamp(dist / 11, 1.3, 2.6), to, resolve };
    });
  }

  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    crosshair.classList.add('visible');
    pointerActive = true;
    pointerDirty = true;
  }
  const onMove = (e) => mode === 'home' && setPointer(e);
  const onLeave = () => { crosshair.classList.remove('visible'); };
  const onDown = (e) => {
    if (e.button !== 0 || navigating || mode !== 'home') return;
    setPointer(e);
    updateAim();
    shoot();
    crosshair.classList.add('fire');
    setTimeout(() => crosshair.classList.remove('fire'), 70);
    if (e.pointerType === 'touch') setTimeout(() => crosshair.classList.remove('visible'), 900);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function updateAim() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(solids, false);
    const hit = hits.find((h) => h.distance > 1.2);
    if (hit) aimPoint.copy(hit.point);
    else raycaster.ray.at(60, aimPoint);
    const h = hit && hit.object.userData.section ? boards.find((b) => b.mesh === hit.object) : null;
    if (h !== hovered) {
      hovered = h;
      crosshair.classList.toggle('target', !!h);
    }
    pointerDirty = false;
    return hit;
  }

  /* ----- proyectiles, salpicaduras y partículas ----- */
  const splatTextures = Array.from({ length: 6 }, splatCanvas);
  const dotTex = softDotTexture();
  const ballGeo = new THREE.SphereGeometry(0.045, 14, 10);
  const dropGeo = new THREE.SphereGeometry(0.014, 6, 5);
  const shellGeo = new THREE.BoxGeometry(0.03, 0.004, 0.022); // trozo de la cáscara de gelatina
  const balls = [];
  const drops = [];
  const splats = [];
  const puffs = [];
  const mists = []; // nubes de pintura pulverizada de cada impacto
  const sprayTex = sprayTexture();

  function shoot() {
    const now = performance.now();
    if (now - lastShot < 120) return;
    lastShot = now;
    if (shotCount++ === 0 && onFirstShot) onFirstShot();

    const hit = updateAim();
    const end = hit ? hit.point.clone() : raycaster.ray.at(90, new THREE.Vector3());
    const start = muzzle.getWorldPosition(new THREE.Vector3());
    const color = new THREE.Color(PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)]);
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0, emissive: color, emissiveIntensity: 0.25 }));
    mesh.position.copy(start);
    scene.add(mesh);
    const dist = start.distanceTo(end);
    balls.push({ mesh, start, end, t: 0, dur: Math.max(0.06, dist / BALL_SPEED), arc: Math.min(0.35, dist * 0.018), hit: !!hit, color });

    // retroceso + soplo de aire
    gunRecoil.userData.kick = 1;
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    puff.position.copy(start);
    puff.scale.setScalar(0.04);
    scene.add(puff);
    puffs.push({ s: puff, life: 0 });
    playShot();
  }

  function impact(ball) {
    scene.remove(ball.mesh);
    ball.mesh.material.dispose();
    if (!ball.hit) return;
    // volver a trazar al llegar (los carteles se mueven)
    const dir = tmpV.copy(ball.end).sub(ball.start).normalize();
    raycaster.set(ball.end.clone().addScaledVector(dir, -0.6), dir);
    raycaster.near = 0;
    raycaster.far = 1.4;
    const hit = raycaster.intersectObjects(solids, false)[0];
    raycaster.near = 0;
    raycaster.far = Infinity;
    if (!hit) return;

    const normal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      normal.copy(hit.face.normal);
      if (hit.object.isInstancedMesh && hit.instanceId != null) {
        const im = new THREE.Matrix4();
        hit.object.getMatrixAt(hit.instanceId, im);
        normal.transformDirection(im);
      }
      normal.transformDirection(hit.object.matrixWorld);
    }
    if (normal.dot(dir) > 0) normal.negate();
    const dist = camera.position.distanceTo(hit.point);
    addSplat(hit, normal, ball.color, SPLAT_SIZE * R(0.8, 1.2)); // tamaño real, igual a cualquier distancia
    burst(hit.point, normal, ball.color);
    playSplat(clamp(1.4 - dist / 30, 0.25, 1));

    const ud = hit.object.userData;
    if (ud.section) {
      const b = boards.find((x) => x.mesh === hit.object);
      if (b) b.swingV += 3.2;
      playWood();
      if (!navigating) {
        navigating = true;
        const p = hit.point.clone().project(camera);
        const rect = canvas.getBoundingClientRect();
        const screen = { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
        setTimeout(() => onSectionHit(ud.section, screen, '#' + ball.color.getHexString()), 320);
      }
    } else if (ud.shield) {
      shield.swingV += 1.6;
      playWood();
    }
  }

  function addSplat(hit, normal, color, size) {
    const mat = new THREE.MeshStandardMaterial({
      map: splatTextures[Math.floor(Math.random() * splatTextures.length)],
      color,
      transparent: true,
      roughness: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    s.position.copy(hit.point).addScaledVector(normal, 0.006);
    s.lookAt(tmpV.copy(s.position).add(normal));
    s.rotateZ(Math.random() * Math.PI * 2);
    s.scale.setScalar(size * 0.2);
    s.userData.target = size * (0.8 + Math.random() * 0.4);
    s.userData.age = 0;
    s.renderOrder = 2;
    scene.add(s);
    if (hit.object.userData.dynamic) hit.object.attach(s);
    splats.push(s);
    if (splats.length > MAX_SPLATS) removeSplat(splats.shift());
  }

  function removeSplat(s) {
    s.removeFromParent();
    s.geometry.dispose();
    s.material.dispose();
  }

  /** Explosión de la bola al impactar (todo en tamaño real: de lejos se ve pequeña, de cerca grande) */
  function burst(point, normal, color) {
    // 1) nube de pintura pulverizada que se expande y se disipa
    for (const [size, life, op, flash] of [[R(0.9, 1.25), 0.42, 1, false], [R(0.35, 0.45), 0.1, 1, true]]) {
      const tint = flash ? color.clone().lerp(new THREE.Color(0xffffff), 0.5) : color; // destello central más claro
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: flash ? dotTex : sprayTex, color: tint, transparent: true, opacity: op, depthWrite: false }));
      m.material.rotation = R(0, Math.PI * 2);
      m.position.copy(point).addScaledVector(normal, flash ? 0.1 : 0.16);
      m.scale.setScalar(0.05);
      m.renderOrder = 3;
      scene.add(m);
      mists.push({ s: m, life: 0, max: life, size, op });
    }
    // ejes de la superficie impactada
    const t1 = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(normal, t1);
    // 2) gotas en abanico, casi rasantes a la superficie, que vuelan como estelas
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25 });
    for (let i = 0; i < 20; i++) {
      const a = R(0, Math.PI * 2);
      const v = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).multiplyScalar(R(1.8, 5.2))
        .addScaledVector(normal, R(0.4, 2.4));
      const d = new THREE.Mesh(dropGeo, mat);
      d.position.copy(point).addScaledVector(normal, 0.02);
      d.userData.size = R(0.5, 1.6);
      scene.add(d);
      drops.push({ d, v, life: 0, max: R(0.3, 0.6), mat });
    }
    // 3) trozos de la cáscara que salen girando
    const shellMat = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.2), roughness: 0.4, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(shellGeo, shellMat);
      d.position.copy(point).addScaledVector(normal, 0.03);
      d.rotation.set(R(0, 6), R(0, 6), R(0, 6));
      const v = normal.clone().multiplyScalar(R(1.2, 2.6)).addScaledVector(t1, R(-1.5, 1.5)).addScaledVector(t2, R(-1.5, 1.5));
      scene.add(d);
      drops.push({ d, v, life: 0, max: R(0.5, 0.8), mat: shellMat, spin: new THREE.Vector3(R(-18, 18), R(-18, 18), R(-18, 18)) });
    }
  }

  /* ==========================================================================
     Bucle de animación
     ========================================================================== */
  const clock = new THREE.Clock();
  let t = 0;
  let frameNo = 0;
  const perf = { time: 0, frames: 0, good: 0 };
  /** Resolución dinámica: baja si los FPS caen y sube despacio cuando sobra margen */
  function adaptResolution(dt) {
    perf.time += dt;
    perf.frames++;
    if (perf.time < 1.5) return;
    const fps = perf.frames / perf.time;
    perf.time = perf.frames = 0;
    if (fps < 48 && pixelRatio > QUALITY.minPixelRatio) {
      pixelRatio = Math.max(QUALITY.minPixelRatio, pixelRatio - 0.2);
      renderer.setPixelRatio(pixelRatio);
      perf.good = 0;
    } else if (fps > 57 && pixelRatio < maxPixelRatio) {
      if (++perf.good >= 3) { // varios periodos seguidos con margen antes de subir
        pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.1);
        renderer.setPixelRatio(pixelRatio);
        perf.good = 0;
      }
    } else perf.good = 0;
  }
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;

    /* ----- cámara ----- */
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - (-2 * tween.t + 2) ** 3 / 2; // easeInOutCubic
      const u = 1 - k;
      camera.position.set(0, 0, 0)
        .addScaledVector(tween.p0, u * u)
        .addScaledVector(tween.ctrl, 2 * u * k)
        .addScaledVector(tween.p1, k * k);
      // la orientación gira un poco antes que la posición para "mirar hacia dónde va"
      camera.quaternion.slerpQuaternions(tween.q0, tween.q1, Math.min(1, k * 1.25));
      if (tween.to === 'home' && tween.t > 0.6) gunAway += (0 - gunAway) * Math.min(1, dt * 6);
      if (tween.t >= 1) {
        const done = tween;
        tween = null;
        mode = done.to === 'home' ? 'home' : 'station';
        if (mode === 'home') { parallax.x = parallax.y = 0; pointerDirty = true; }
        done.resolve(true);
      }
    } else if (mode === 'home') {
      // ligero balanceo de cámara según el puntero (paralaje)
      parallax.x += (-pointer.x * 0.035 - parallax.x) * 0.05;
      parallax.y += (pointer.y * 0.02 - parallax.y) * 0.05;
      camera.position.copy(HOME_POS);
      camera.quaternion.setFromEuler(new THREE.Euler(parallax.y, parallax.x, 0, 'YXZ'));
    } else if (mode === 'station' && stationPose) {
      // respiración suave de la cámara mientras se lee la sección
      camera.position.copy(stationPose.pos).add(tmpV.set(Math.sin(t * 0.31) * 0.12, Math.sin(t * 0.47) * 0.06, Math.cos(t * 0.27) * 0.08));
      camera.quaternion.copy(stationPose.q);
    }
    camera.updateMatrixWorld();

    if (mode === 'home' && !tween) {
      if (pointerDirty || !pointerActive) {
        if (!pointerActive) pointer.set(Math.sin(t * 0.5) * 0.12, 0.2 + Math.sin(t * 0.7) * 0.05);
        updateAim();
      }
      gunAway += (0 - gunAway) * Math.min(1, dt * 6);
    } else if (!(tween && tween.to === 'home')) {
      gunAway += (1 - gunAway) * Math.min(1, dt * 5);
    }

    // marcadora apunta a la mira (suavizado) y baja cuando la cámara viaja
    curQ.copy(gunPivot.quaternion);
    gunPivot.lookAt(aimPoint);
    tmpQ.copy(gunPivot.quaternion);
    gunPivot.quaternion.copy(curQ).slerp(tmpQ, 1 - Math.pow(0.0005, dt));
    const base = gunPivot.userData.base;
    if (base) gunPivot.position.set(base.x, base.y + Math.sin(t * 1.8) * 0.003 - gunAway * 0.45, base.z + Math.sin(t * 0.9) * 0.002 + gunAway * 0.1);
    gunPivot.visible = gunAway < 0.97;
    stations.animate(t);
    atmosphere.update(t);
    runner.update(dt);
    const kick = gunRecoil.userData.kick || 0;
    gunRecoil.position.z = -kick * 0.045;
    gunRecoil.rotation.x = -kick * 0.12;
    gunRecoil.userData.kick = kick * Math.pow(0.0004, dt);

    // carteles
    for (const b of boards) {
      b.swingV += (-b.swing * 18 - b.swingV * 2.2) * dt;
      b.swing += b.swingV * dt;
      b.pivot.rotation.x = b.swing;
      b.pivot.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.018;
      const target = b === hovered ? 1 : 0;
      b.hover += (target - b.hover) * Math.min(1, dt * 10);
      b.front.emissiveIntensity = b.hover * 0.28;
      b.rig.position.z = b.hover * 0.15;
    }
    shield.swingV += (-shield.swing * 10 - shield.swingV * 1.6) * dt;
    shield.swing += shield.swingV * dt;
    shield.pivot.rotation.x = shield.swing;
    shield.pivot.rotation.z = Math.sin(t * 0.6) * 0.01;

    // bolas
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.t += dt / b.dur;
      if (b.t >= 1) {
        balls.splice(i, 1);
        impact(b);
        continue;
      }
      b.mesh.position.lerpVectors(b.start, b.end, b.t);
      b.mesh.position.y += Math.sin(Math.PI * b.t) * b.arc;
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const p = drops[i];
      p.life += dt;
      p.v.y -= 9.8 * dt;
      p.v.multiplyScalar(1 - 1.5 * dt); // rozamiento con el aire
      p.d.position.addScaledVector(p.v, dt);
      if (p.spin) {
        p.d.rotation.x += p.spin.x * dt;
        p.d.rotation.y += p.spin.y * dt;
        p.d.rotation.z += p.spin.z * dt;
      } else {
        // gota estirada en la dirección de vuelo (estela) que se va consumiendo
        const k = p.d.userData.size * (1 - p.life / p.max);
        const stretch = 1 + Math.min(4, p.v.length() * 0.9);
        p.d.scale.set(k, k, k * stretch);
        p.d.lookAt(tmpV.copy(p.d.position).add(p.v));
      }
      if (p.life > p.max || p.d.position.y < 0) {
        scene.remove(p.d);
        drops.splice(i, 1);
        if (!drops.some((o) => o.mat === p.mat)) p.mat.dispose();
      }
    }
    for (let i = mists.length - 1; i >= 0; i--) {
      const m = mists[i];
      m.life += dt;
      const k = Math.min(1, m.life / m.max);
      m.s.scale.setScalar(0.05 + m.size * (1 - (1 - k) ** 3)); // se expande rápido y frena
      m.s.material.opacity = m.op * (1 - k ** 1.6); // se mantiene densa y luego se disipa
      if (k >= 1) {
        scene.remove(m.s);
        m.s.material.dispose();
        mists.splice(i, 1);
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life += dt;
      p.s.scale.setScalar(0.04 + p.life * 1.4);
      p.s.material.opacity = Math.max(0, 0.6 - p.life * 4);
      if (p.life > 0.16) {
        scene.remove(p.s);
        p.s.material.dispose();
        puffs.splice(i, 1);
      }
    }
    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i];
      // desvanecimiento: nítida durante SPLAT_HOLD y luego se apaga suavemente
      const age = (s.userData.age += dt);
      if (age > SPLAT_HOLD) {
        const f = 1 - (age - SPLAT_HOLD) / SPLAT_FADE;
        if (f <= 0) {
          splats.splice(i, 1);
          removeSplat(s);
          continue;
        }
        s.material.opacity = f * f * (3 - 2 * f); // suavizado (smoothstep)
      }
      const tg = s.userData.target;
      if (tg && s.scale.x < tg) {
        const parentScale = s.parent && s.parent !== scene ? s.parent.getWorldScale(tmpV).x : 1;
        const k = Math.min(tg / parentScale, (s.scale.x * parentScale + dt * 14 * tg) / parentScale); // se extiende de golpe
        s.scale.setScalar(k);
        if (k >= tg / parentScale - 1e-4) s.userData.target = 0;
      }
    }

    frameNo++;
    // en una sección (cámara casi quieta) el móvil dibuja a media velocidad: más fluidez al leer y hacer scroll
    const halfRate = QUALITY.stationHalfRate && mode === 'station' && !tween;
    if (halfRate && frameNo % 2) return;
    if (QUALITY.shadowEvery > 1 && frameNo % QUALITY.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    if (!halfRate) adaptResolution(dt);
    renderer.render(scene, camera);
  }

  // fuentes listas antes de dibujar los carteles
  try {
    await Promise.race([document.fonts.load('100px "Germania One"'), new Promise((r) => setTimeout(r, 2500))]);
  } catch { /* sin fuentes web */ }
  await refresh(content);

  const ro = new ResizeObserver(() => layout());
  ro.observe(canvas);
  frame();

  return {
    refresh,
    /** Viaja a la estación de una sección. Devuelve true al llegar (false si otro viaje lo interrumpe). */
    goTo(key, { instant = false } = {}) {
      currentStation = key;
      stationPose = poseFor(key);
      navigating = true;
      return travel(stationPose, key, instant);
    },
    /** Vuelve a la portada (pórtico de carteles) */
    async goHome({ instant = false } = {}) {
      currentStation = null;
      const arrived = await travel({ pos: HOME_POS.clone(), q: homeQ }, 'home', instant);
      if (arrived) navigating = false;
      return arrived;
    },
    get mode() {
      return mode;
    },
  };
}
