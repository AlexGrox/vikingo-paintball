/* ==========================================================================
   Objetos realistas del escenario (modelos por revolución + texturas procedurales):
   - Neumático: banda de rodadura con dibujo de invierno (surcos en V, canal central, láminas),
     hombros redondeados, flancos con nervaduras y marcas en relieve.
   - Bidón metálico de 200 L: aros de rodadura, bordes, tapa con tapones, pintura gastada y óxido.
   - Barril de madera: abombado, duelas y aros de hierro.
   - Cartón de embalar con cinta.
   Todo usa su propio generador aleatorio: no altera la distribución del resto del escenario.
   ========================================================================== */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(77031);
const R = (a, b) => a + (b - a) * rnd();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Mapa de normales a partir de un canvas de alturas (gris) */
function normalFromHeight(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  const [nc, ng] = canvas(w, h);
  const out = ng.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const k = (y * w + x) * 4;
      out.data[k] = Math.max(0, Math.min(255, 128 - dx * 127));
      out.data[k + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
      out.data[k + 2] = 255;
      out.data[k + 3] = 255;
    }
  }
  ng.putImageData(out, 0, 0);
  return nc;
}

function tex(c, { srgb = true, aniso = 8, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Torno con V de textura según la longitud real del perfil y normales con aristas nítidas */
function lathe(points, segments, crease = 35) {
  const pts = points.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, segments);
  const arc = [0];
  for (let j = 1; j < pts.length; j++) arc.push(arc[j - 1] + pts[j].distanceTo(pts[j - 1]));
  const total = arc[arc.length - 1];
  const uv = geo.attributes.uv;
  for (let i = 0; i <= segments; i++) for (let j = 0; j < pts.length; j++) uv.setY(i * pts.length + j, arc[j] / total);
  return { geo: toCreasedNormals(geo, THREE.MathUtils.degToRad(crease)), arc: arc.map((a) => a / total) };
}

/* ==========================================================================
   Neumático
   ========================================================================== */
// sección del neumático (radio, altura), recorrida en sentido antihorario: normales hacia fuera
const TIRE_PROFILE = [
  [0.215, -0.095], [0.225, -0.125], [0.25, -0.14], // talón inferior
  [0.3, -0.147], [0.35, -0.15], [0.385, -0.147], // flanco inferior
  [0.405, -0.138], [0.416, -0.124], [0.42, -0.108], // hombro
  [0.421, -0.07], [0.422, 0], [0.421, 0.07], [0.42, 0.108], // banda de rodadura
  [0.416, 0.124], [0.405, 0.138], [0.385, 0.147], // hombro
  [0.35, 0.15], [0.3, 0.147], [0.25, 0.14], [0.225, 0.125], [0.215, 0.095], // flanco y talón superior
  [0.215, -0.095], // cierre
];
export const TIRE_HEIGHT = 0.3;

let tireCache = null;
export function tireAssets() {
  if (tireCache) return tireCache;
  const { geo, arc } = lathe(TIRE_PROFILE, 64, 30);
  const vTread0 = arc[8], vTread1 = arc[12], vShoulder0 = arc[6], vShoulder1 = arc[14];
  const W = 1024, Hh = 512;
  const [hc, hg] = canvas(W, Hh); // alturas
  hg.fillStyle = 'rgb(150,150,150)';
  hg.fillRect(0, 0, W, Hh);
  const Y = (v) => v * Hh;

  // --- flancos: nervaduras concéntricas y marcas en relieve ---
  const side = (v0, v1, flip) => {
    for (let k = 0; k < 7; k++) {
      const v = v0 + (v1 - v0) * (0.08 + k * 0.05);
      hg.fillStyle = 'rgb(175,175,175)';
      hg.fillRect(0, Y(v), W, 1.2);
    }
    // "letras": grupos de pequeños bloques en relieve en el centro del flanco
    const vm = v0 + (v1 - v0) * (flip ? 0.62 : 0.38);
    for (let gx = 0; gx < W; gx += 256) {
      let x = gx + 30;
      for (let l = 0; l < 9; l++) {
        const lw = R(5, 11);
        hg.fillStyle = 'rgb(205,205,205)';
        hg.fillRect(x, Y(vm) - 6, lw, 12);
        hg.fillStyle = 'rgb(150,150,150)';
        if (rnd() < 0.6) hg.fillRect(x + lw * 0.35, Y(vm) - 3, lw * 0.3, 6);
        x += lw + 4;
      }
      hg.fillStyle = 'rgb(195,195,195)';
      hg.fillRect(gx + 150, Y(vm) - 3, 60, 6); // medida del neumático
    }
  };
  side(arc[2], vShoulder0, false);
  side(vShoulder1, arc[18], true);

  // --- banda de rodadura: bloques de invierno con surcos en V y láminas ---
  const t0 = Y(vShoulder0), t1 = Y(vShoulder1), tm = (t0 + t1) / 2, th = t1 - t0;
  hg.fillStyle = 'rgb(225,225,225)'; // superficie de los tacos
  hg.fillRect(0, t0, W, th);
  const N = 36, pitch = W / N;
  hg.strokeStyle = 'rgb(25,25,25)';
  hg.lineCap = 'round';
  for (let i = 0; i <= N; i++) {
    const x = i * pitch;
    // surcos en V (direccionales) desde el canal central hacia los hombros
    hg.lineWidth = 7;
    for (const s of [-1, 1]) {
      hg.beginPath();
      hg.moveTo(x, tm + s * 6);
      hg.quadraticCurveTo(x + pitch * 0.35, tm + s * th * 0.25, x + pitch * 0.55, tm + s * th * 0.52);
      hg.stroke();
      // ranura lateral del hombro
      hg.lineWidth = 6;
      hg.beginPath();
      hg.moveTo(x + pitch * 0.25, tm + s * th * 0.42);
      hg.lineTo(x + pitch * 0.25, tm + s * th * 0.56);
      hg.stroke();
      hg.lineWidth = 7;
    }
    // láminas (sipes) en zigzag dentro de cada bloque
    hg.lineWidth = 1.6;
    hg.strokeStyle = 'rgb(90,90,90)';
    for (const s of [-1, 1]) {
      for (let k = 1; k <= 3; k++) {
        const bx = x + pitch * (0.12 + k * 0.17);
        const y0 = tm + s * th * (0.06 + k * 0.035), y1 = tm + s * th * (0.3 + k * 0.04);
        hg.beginPath();
        hg.moveTo(bx, y0);
        for (let z = 1; z <= 5; z++) hg.lineTo(bx + (z % 2 ? 3 : -3) + z * 2.5, y0 + ((y1 - y0) * z) / 5);
        hg.stroke();
      }
    }
    hg.strokeStyle = 'rgb(25,25,25)';
  }
  // canal central y canales circunferenciales
  hg.fillStyle = 'rgb(20,20,20)';
  hg.fillRect(0, tm - 5, W, 10);
  hg.fillRect(0, tm - th * 0.3 - 3, W, 6);
  hg.fillRect(0, tm + th * 0.3 - 3, W, 6);
  // desgaste e irregularidad del caucho
  for (let i = 0; i < 9000; i++) {
    const v = R(0, 1);
    hg.fillStyle = `rgba(${v < 0.5 ? 0 : 255},${v < 0.5 ? 0 : 255},${v < 0.5 ? 0 : 255},${R(0.02, 0.07)})`;
    hg.fillRect(R(0, W), R(0, Hh), R(1, 3), R(1, 3));
  }

  // --- color: caucho casi negro; los surcos más oscuros; polvo en los flancos ---
  const hd = hg.getImageData(0, 0, W, Hh).data;
  const [cc, cg] = canvas(W, Hh);
  const cd = cg.createImageData(W, Hh);
  for (let i = 0; i < W * Hh; i++) {
    const h = hd[i * 4] / 255;
    const v = Math.floor(i / W) / Hh;
    const inTread = v > vShoulder0 && v < vShoulder1;
    let L = inTread ? 10 + h * 22 : 16 + h * 12;
    L += (Math.random() - 0.5) * 3;
    const dust = inTread ? 0 : 3; // flancos con algo de polvo
    cd.data[i * 4] = L + dust + 1;
    cd.data[i * 4 + 1] = L + dust;
    cd.data[i * 4 + 2] = L;
    cd.data[i * 4 + 3] = 255;
  }
  cg.putImageData(cd, 0, 0);
  // rugosidad: tacos más mates, flancos algo más satinados
  const [rc, rg] = canvas(4, Hh);
  for (let y = 0; y < Hh; y++) {
    const v = y / Hh;
    const r = v > vShoulder0 && v < vShoulder1 ? 225 : 170;
    rg.fillStyle = `rgb(${r},${r},${r})`;
    rg.fillRect(0, y, 4, 1);
  }
  const map = tex(cc), normalMap = tex(normalFromHeight(hc, 3.2), { srgb: false }), roughnessMap = tex(rc, { srgb: false });
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughnessMap, roughness: 1, metalness: 0 });
  tireCache = { geo, mat };
  return tireCache;
}

/* ==========================================================================
   Bidón metálico de 200 L
   ========================================================================== */
const DRUM_PROFILE = [
  [0.0, 0.006], [0.27, 0.006], [0.285, 0.0], [0.297, 0.012], [0.293, 0.03], [0.287, 0.04], // fondo y borde
  [0.287, 0.27], [0.298, 0.283], [0.298, 0.302], [0.287, 0.315], // aro de rodadura
  [0.287, 0.565], [0.298, 0.578], [0.298, 0.597], [0.287, 0.61], // aro de rodadura
  [0.287, 0.84], [0.293, 0.85], [0.297, 0.868], [0.285, 0.88], [0.272, 0.874], [0.27, 0.862], [0.0, 0.862], // borde y tapa hundida
];
export const DRUM_HEIGHT = 0.88;
const drumGeoCache = {};
function drumGeometry() {
  if (!drumGeoCache.geo) Object.assign(drumGeoCache, lathe(DRUM_PROFILE, 40, 30));
  return drumGeoCache;
}

function drumTexture(baseHex, arc) {
  const W = 1024, H = 512;
  const [c, g] = canvas(W, H);
  const [hc, hg] = canvas(W, H);
  const base = new THREE.Color(baseHex);
  const css = (col, k = 1) => `rgb(${Math.round(col.r * 255 * k)},${Math.round(col.g * 255 * k)},${Math.round(col.b * 255 * k)})`;
  g.fillStyle = css(base);
  g.fillRect(0, 0, W, H);
  hg.fillStyle = 'rgb(128,128,128)';
  hg.fillRect(0, 0, W, H);
  // variación de la pintura
  for (let i = 0; i < 60; i++) {
    const x = R(0, W), y = R(0, H), r = R(20, 90);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rnd() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.07)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // etiqueta/estarcido descolorido
  g.fillStyle = 'rgba(235,230,210,.55)';
  const ly = H * (arc[10] + arc[13]) / 2;
  g.fillRect(W * 0.1, ly - 22, W * 0.16, 44);
  g.fillStyle = css(base, 0.5);
  g.font = 'bold 30px Impact, sans-serif';
  // el torno recorre la textura al revés: el texto se dibuja en espejo para leerse bien
  g.save();
  g.translate(W * 0.24, ly + 11);
  g.scale(-1, 1);
  g.fillText('200 L', 0, 0);
  g.restore();
  // bordes y aros gastados: metal oscuro y óxido
  const wearBand = (v, w) => {
    for (let i = 0; i < 260; i++) {
      const x = R(0, W), y = v * H + R(-w, w);
      g.fillStyle = rnd() < 0.55 ? `rgba(60,45,35,${R(0.4, 0.9)})` : `rgba(140,70,30,${R(0.3, 0.7)})`;
      g.fillRect(x, y, R(3, 18), R(1, 4));
    }
  };
  for (const j of [2, 7, 12, 16]) wearBand(arc[j], 9);
  // arañazos
  for (let i = 0; i < 140; i++) {
    const x = R(0, W), y = R(0, H), len = R(8, 55), a = R(-0.4, 0.4) + (rnd() < 0.5 ? 0 : Math.PI / 2);
    g.strokeStyle = rnd() < 0.85 ? `rgba(70,62,55,${R(0.25, 0.55)})` : `rgba(170,168,160,${R(0.12, 0.3)})`;
    g.lineWidth = R(0.6, 1.6);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // churretes de óxido que bajan desde el borde superior (en la textura, V alta = arriba)
  for (let i = 0; i < 28; i++) {
    const x = R(0, W), y0 = arc[16] * H, len = R(30, 160);
    const grd = g.createLinearGradient(0, y0, 0, y0 - len);
    grd.addColorStop(0, `rgba(120,55,20,${R(0.4, 0.8)})`);
    grd.addColorStop(1, 'rgba(120,55,20,0)');
    g.fillStyle = grd;
    g.fillRect(x, y0 - len, R(2, 6), len);
  }
  // abolladuras (solo en el relieve)
  for (let i = 0; i < 14; i++) {
    const x = R(0, W), y = R(arc[6] * H, arc[14] * H), r = R(15, 45);
    const grd = hg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(60,60,60,.7)');
    grd.addColorStop(1, 'rgba(128,128,128,0)');
    hg.fillStyle = grd;
    hg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // rugosidad: pintura semimate, óxido mate
  const map = tex(c);
  const normalMap = tex(normalFromHeight(hc, 1.5), { srgb: false });
  return { map, normalMap };
}

const drumMats = new Map();
/** Bidón listo para colocar (origen en la base). color: 0xRRGGBB */
export function createDrum(color) {
  const { geo, arc } = drumGeometry();
  if (!drumMats.has(color)) {
    const t = drumTexture(color, arc);
    drumMats.set(color, new THREE.MeshStandardMaterial({ ...t, metalness: 0.55, roughness: 0.52, normalScale: new THREE.Vector2(0.8, 0.8) }));
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, drumMats.get(color));
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // tapones de la tapa
  const capMat = new THREE.MeshStandardMaterial({ color: 0x4a4a48, metalness: 0.8, roughness: 0.4 });
  const capGeo = lathe([[0, 0.014], [0.03, 0.014], [0.034, 0.008], [0.034, 0], [0.03, -0.002]].reverse(), 16).geo;
  for (const [x, z, s] of [[0.17, 0.05, 1], [-0.16, -0.08, 0.7]]) {
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(x, 0.862, z);
    cap.scale.setScalar(s);
    g.add(cap);
  }
  return g;
}

/* ==========================================================================
   Barril de madera
   ========================================================================== */
let woodBarrelCache = null;
export function createWoodBarrel() {
  if (!woodBarrelCache) {
    const prof = [];
    const H = 0.9;
    prof.push([0, 0.01], [0.27, 0.01], [0.28, 0]);
    for (let i = 0; i <= 12; i++) {
      const y = (i / 12) * H;
      prof.push([0.29 + Math.sin((i / 12) * Math.PI) * 0.06, y]); // abombado
    }
    prof.push([0.28, H], [0.27, H - 0.012], [0, H - 0.012]);
    const { geo, arc } = lathe(prof, 36, 25);
    const W = 1024, Hh = 512;
    const [c, g] = canvas(W, Hh);
    const [hc, hg] = canvas(W, Hh);
    hg.fillStyle = 'rgb(160,160,160)';
    hg.fillRect(0, 0, W, Hh);
    // duelas
    const staves = 20, sw = W / staves;
    for (let s = 0; s < staves; s++) {
      const l = R(24, 34);
      g.fillStyle = `hsl(${R(24, 30)}, ${R(38, 50)}%, ${l}%)`;
      g.fillRect(s * sw, 0, sw, Hh);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(30,15,5,${R(0.1, 0.25)})`;
        g.lineWidth = R(0.6, 2);
        const x = s * sw + R(2, sw - 2);
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= Hh; y += 32) g.lineTo(x + Math.sin(y * 0.02 + k) * 2, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(15,8,3,.85)';
      g.fillRect(s * sw, 0, 2.5, Hh);
      hg.fillStyle = 'rgb(60,60,60)';
      hg.fillRect(s * sw, 0, 2.5, Hh);
    }
    // aros de hierro
    const body0 = arc[3], body1 = arc[15];
    for (const f of [0.1, 0.3, 0.7, 0.9]) {
      const y = (body0 + (body1 - body0) * f) * Hh;
      g.fillStyle = '#2b2725';
      g.fillRect(0, y - 9, W, 18);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(130,65,30,${R(0.3, 0.7)})`;
        g.fillRect(R(0, W), y + R(-9, 7), R(4, 16), R(1, 3));
      }
      hg.fillStyle = 'rgb(235,235,235)';
      hg.fillRect(0, y - 9, W, 18);
      hg.fillStyle = 'rgb(200,200,200)';
      for (let x = 0; x < W; x += 64) hg.fillRect(x, y - 3, 5, 6); // remaches
    }
    const map = tex(c);
    const normalMap = tex(normalFromHeight(hc, 2), { srgb: false });
    woodBarrelCache = { geo, mat: new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.85, metalness: 0.05 }) };
  }
  const m = new THREE.Mesh(woodBarrelCache.geo, woodBarrelCache.mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/* ==========================================================================
   Cartón de embalar
   ========================================================================== */
let cardboardCache = null;
export function cardboardMaterial() {
  if (cardboardCache) return cardboardCache;
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#a77c4f';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(80,50,25,${R(0.04, 0.12)})` : `rgba(220,190,150,${R(0.04, 0.1)})`;
    g.fillRect(R(0, S), R(0, S), R(1, 6), R(0.5, 1.5)); // fibras
  }
  // bordes más oscuros (desgaste) y manchas de humedad
  const vg = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(60,35,15,.35)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) {
    const x = R(0, S), y = R(0, S), r = R(20, 60);
    const grd = g.createRadialGradient(x, y, r * 0.6, x, y, r);
    grd.addColorStop(0, 'rgba(90,60,30,.18)');
    grd.addColorStop(0.9, 'rgba(70,45,20,.3)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // cinta de embalar
  g.fillStyle = 'rgba(200,170,110,.85)';
  g.fillRect(S * 0.4, 0, S * 0.2, S);
  g.fillStyle = 'rgba(255,240,200,.25)';
  g.fillRect(S * 0.42, 0, S * 0.03, S);
  // símbolos impresos (flechas "este lado arriba")
  g.strokeStyle = 'rgba(40,25,15,.55)';
  g.lineWidth = 6;
  for (const x of [S * 0.14, S * 0.24]) {
    g.beginPath();
    g.moveTo(x, S * 0.8);
    g.lineTo(x, S * 0.66);
    g.moveTo(x - 14, S * 0.7);
    g.lineTo(x, S * 0.65);
    g.lineTo(x + 14, S * 0.7);
    g.stroke();
  }
  const map = tex(c, { wrap: false });
  cardboardCache = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  return cardboardCache;
}

/* ==========================================================================
   Tejado de paja (capas de haces con relieve)
   ========================================================================== */
let thatchCache = null;
export function thatchMaterial() {
  if (thatchCache) return thatchCache;
  const W = 512, H = 512;
  const [c, g] = canvas(W, H);
  const [hc, hg] = canvas(W, H);
  g.fillStyle = '#4e3d22';
  g.fillRect(0, 0, W, H);
  hg.fillStyle = 'rgb(40,40,40)';
  hg.fillRect(0, 0, W, H);
  // 4 hileras de haces; cada hilera cubre el arranque de la siguiente
  const rows = 4, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 1400; i++) {
      const x = R(0, W), y0 = r * rh + R(-6, rh * 0.25), len = R(rh * 0.7, rh * 1.15);
      const l = R(22, 46);
      g.strokeStyle = `hsl(${R(34, 46)}, ${R(30, 50)}%, ${l}%)`;
      g.lineWidth = R(1, 2.4);
      const bend = R(-6, 6);
      g.beginPath();
      g.moveTo(x, y0);
      g.quadraticCurveTo(x + bend, y0 + len * 0.5, x + bend * 1.6, y0 + len);
      g.stroke();
      const hv = Math.round(90 + (l - 22) * 5);
      hg.strokeStyle = `rgb(${hv},${hv},${hv})`;
      hg.lineWidth = g.lineWidth;
      hg.beginPath();
      hg.moveTo(x, y0);
      hg.quadraticCurveTo(x + bend, y0 + len * 0.5, x + bend * 1.6, y0 + len);
      hg.stroke();
    }
    // sombra bajo el borde de cada hilera
    const sh = g.createLinearGradient(0, (r + 1) * rh - 14, 0, (r + 1) * rh + 4);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(20,12,4,.55)');
    g.fillStyle = sh;
    g.fillRect(0, (r + 1) * rh - 14, W, 18);
  }
  const map = tex(c);
  const normalMap = tex(normalFromHeight(hc, 2.5), { srgb: false });
  map.repeat.set(5, 1.2);
  normalMap.repeat.set(5, 1.2);
  thatchCache = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1 });
  return thatchCache;
}
