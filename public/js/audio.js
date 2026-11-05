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

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('vp_muted', v ? '1' : '0'); } catch { /* */ }
}
