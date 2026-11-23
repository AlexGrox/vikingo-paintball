/* Efectos de sonido sintetizados con WebAudio (sin archivos externos) */
let ctx = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('vp_muted') === '1'; } catch { /* */ }

function ensure() {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(t, dur, { type = 'lowpass', freq = 1200, q = 0.8, gain = 0.5, attack = 0.002 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
  return f;
}

/** Disparo de marcadora: "thump" neumático */
export function playShot() {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.16);
  const f = noise(t, 0.09, { type: 'bandpass', freq: 2400, q: 0.6, gain: 0.45 });
  f.frequency.exponentialRampToValueAtTime(600, t + 0.09);
}

/** Impacto de bola: "splat" húmedo */
export function playSplat(volume = 1) {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const f = noise(t, 0.22, { type: 'lowpass', freq: 3200, q: 3, gain: 0.55 * volume, attack: 0.004 });
  f.frequency.exponentialRampToValueAtTime(380, t + 0.2);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(320, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
  g.gain.setValueAtTime(0.25 * volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.12);
}

/** Golpe seco sobre madera (carteles) */
export function playWood() {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.14);
}

/**
 * Zumbido de una bola que pasa rozando: soplo de viento con caída de tono (efecto Doppler).
 * @param {number} pan  -1 = pasa por la izquierda, 1 = por la derecha
 * @param {number} volume 0..1
 */
export function playWhoosh(pan = 0, volume = 1) {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const dur = 0.42;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  // dos filtros: el silbido agudo y el cuerpo del soplo
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + dur * 0.42); // se acerca
  bp.frequency.exponentialRampToValueAtTime(900, t + dur); // se aleja (Doppler)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * volume, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let out = g;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    // recorre el estéreo: entra por delante y se va por su lado
    p.pan.setValueAtTime(pan * 0.3, t);
    p.pan.linearRampToValueAtTime(pan * 0.95, t + dur);
    g.connect(p);
    out = p;
  }
  src.connect(bp).connect(lp).connect(g);
  out.connect(ctx.destination);
  src.start(t, Math.random() * 0.05);
  src.stop(t + dur + 0.05);
}

/* ---------- Música de fondo (tema de Vikingo) ----------
   Empieza cuando comienza la partida del voucher (main.js llama a startMusic). Si el navegador
   la bloquea, arranca con el primer toque, clic o tecla. */
const MUSIC_URL = 'audio/Musica_Vikingo.mp3';
const MUSIC_VOL = 0.5;
let music = null;
let musicWanted = false; // la música debe estar sonando (no silenciada)
let fadeTimer = 0;
const UNLOCK_EVENTS = ['pointerup', 'touchend', 'keydown']; // los que el navegador cuenta como «toque de la persona»

function fadeMusic(to, ms, done) {
  clearInterval(fadeTimer);
  if (!music) return;
  const from = music.volume;
  const t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    try { music.volume = from + (to - from) * k; } catch { /* iOS: el volumen lo fija el sistema */ }
    if (k >= 1) { clearInterval(fadeTimer); done && done(); }
  }, 50);
}

function onUnlock(e) {
  if (e.type === 'keydown' && e.key === 'Escape') return;
  disarmMusic();
  if (musicWanted && !muted) playMusic();
}
function armMusic() { UNLOCK_EVENTS.forEach((t) => addEventListener(t, onUnlock, true)); }
function disarmMusic() { UNLOCK_EVENTS.forEach((t) => removeEventListener(t, onUnlock, true)); }

function playMusic() {
  if (!music) {
    music = new Audio(MUSIC_URL);
    music.loop = true;
    music.preload = 'auto';
    music.volume = 0;
  }
  let p;
  try { p = music.play(); } catch { p = Promise.reject(); }
  Promise.resolve(p).then(
    () => { if (musicWanted && !muted) fadeMusic(MUSIC_VOL, 2500); else music.pause(); },
    () => { if (musicWanted && !muted) armMusic(); } // bloqueada hasta que la persona toque la página
  );
}

let musicStarted = false; // la partida del voucher ya la pidió (antes de eso no suena aunque se active el sonido)
/** Empieza (o retoma) la música, salvo que el sonido esté silenciado */
export function startMusic() {
  musicStarted = true;
  if (muted) return; // si después se activa el sonido, arranca en ese momento
  musicWanted = true;
  playMusic();
}
function stopMusic() {
  musicWanted = false;
  disarmMusic();
  fadeMusic(0, 400, () => { if (!musicWanted && music) music.pause(); });
}
// con la pestaña oculta no debe seguir sonando
document.addEventListener('visibilitychange', () => {
  if (!music || !musicWanted || muted) return;
  if (document.hidden) music.pause(); else playMusic();
});

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('vp_muted', v ? '1' : '0'); } catch { /* */ }
  if (v) stopMusic(); else if (musicStarted) startMusic();
}
