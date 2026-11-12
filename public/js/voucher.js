/* ==========================================================================
   Juego «Jugar por un Voucher»
   - Un botón en la portada. Cada dispositivo tiene 3 oportunidades por día; si las pierde
     todas, vuelve a intentarlo al día siguiente. Quien gana no juega más durante una semana
     (por dispositivo y, en el registro, por e-mail).
   - Al empezar corre una cuenta regresiva (3 min por defecto). Si el jugador le pega
     3 veces al soldado antes de que llegue a 0, gana el voucher y deja su e-mail.
   - El registro lo hace un Apps Script de Google del propio dueño (ver
     tools/voucher-apps-script.gs): emite un permiso al empezar, comprueba al reclamar,
     genera el código, lo guarda en una hoja de cálculo y envía el voucher por e-mail.
   - A Google Analytics solo van eventos (inicio, ganado, perdido, reclamado), nunca el e-mail.
   ========================================================================== */
import { store } from './store.js';
import { el, modal, toast } from './ui.js';
import { trackEvent } from './analytics.js';
import { floatMessage } from './screen-splats.js';

const KEY = 'vp_voucher';
const WIN_LOCK_DAYS = 7; // quien gana no vuelve a jugar hasta pasada una semana
const DAY = 86400000;
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export const VOUCHER_DEFAULTS = {
  voucherButton: 'Jugar por un Voucher',
  voucherHits: 3,
  voucherSeconds: 180,
  voucherTries: 3,
  voucherWinText: '¡Felicidades! Te ganaste un voucher por 100 disparos en Vikingo Paintball. Colocá tu dirección de e-mail a donde quieras que te llegue.',
};

const cfg = () => {
  const s = store.content.site || {};
  const num = (v, d, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || d)));
  return {
    on: !!s.voucherOn,
    url: String(s.voucherUrl || '').trim(),
    button: s.voucherButton || VOUCHER_DEFAULTS.voucherButton,
    hits: num(s.voucherHits, VOUCHER_DEFAULTS.voucherHits, 1, 20),
    seconds: num(s.voucherSeconds, VOUCHER_DEFAULTS.voucherSeconds, 20, 900),
    tries: num(s.voucherTries, VOUCHER_DEFAULTS.voucherTries, 1, 10),
    winText: s.voucherWinText || VOUCHER_DEFAULTS.voucherWinText,
  };
};

/* ---------- memoria del dispositivo ----------
   { id, day, tries, win: { at, token, hits, seconds, code } }
   - id: identificador aleatorio de este dispositivo (va al registro junto al e-mail)
   - day/tries: oportunidades usadas hoy (se reinician al día siguiente)
   - win: el último premio; bloquea el juego durante una semana */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
function getSaved() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY)); } catch { /* sin almacenamiento */ }
  let changed = false;
  if (!v || typeof v !== 'object' || !v.id) { v = { id: 'D' + Math.random().toString(36).slice(2, 10).toUpperCase() }; changed = true; }
  if (v.day !== today()) { v.day = today(); v.tries = 0; changed = true; }
  if (v.win && Date.now() - v.win.at > WIN_LOCK_DAYS * DAY) { v.win = null; changed = true; }
  if (changed) save(v); // el identificador queda fijo desde la primera vez
  return v;
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* modo privado */ }
}
/** Estado del jugador en este dispositivo */
function status() {
  const v = getSaved();
  const c = cfg();
  const left = store.isAdmin ? c.tries : Math.max(0, c.tries - (v.tries || 0)); // el administrador siempre puede probar
  // ganó y todavía puede dejar el e-mail (el permiso de partida dura 6 horas)
  const pendingClaim = !!(v.win && !v.win.code && Date.now() - v.win.at < 6 * 3600000);
  const locked = !!v.win && !store.isAdmin;
  return { v, left, pendingClaim, locked, canPlay: !locked && left > 0 };
}

/* ---------- comunicación con el Apps Script ---------- */
async function api(action, data = {}) {
  const { url } = cfg();
  if (!url) {
    // sin servidor configurado: solo se puede probar en el PC
    if (!isLocal) throw new Error('El juego todavía no está disponible.');
    await new Promise((r) => setTimeout(r, 400));
    if (action === 'start') return { ok: true, token: 'prueba-local' };
    return { ok: true, code: 'VK-PRUEBA' };
  }
  // text/plain evita la comprobación previa (CORS) que Apps Script no responde
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, ...data }), redirect: 'follow' });
  const json = await res.json().catch(() => null);
  if (!json) throw new Error('No se pudo conectar. Probá de nuevo en unos segundos.');
  return json;
}

/* ---------- estado de la partida ---------- */
let scene = null;
let onStartCb = null;
let goTo = () => {};
let btn = null;
let hud = null;
let claimOpen = false; // el cartel del premio está abierto
let game = null; // { token, hits, endAt, startedAt, timer }

export function initVoucher({ getScene, onStart, navigate }) {
  scene = getScene;
  onStartCb = onStart;
  goTo = navigate;
  btn = el('button#voucher-btn', { type: 'button', onclick: onButton });
  hud = el('div#voucher-hud', { hidden: true, 'aria-live': 'polite' });
  document.querySelector('#hud').append(btn, hud);
  if (isLocal) document.addEventListener('vp-debug-hit', () => registerHit()); // pruebas automáticas en el PC
  refreshVoucher();
}

/** Muestra u oculta el botón según los ajustes y si ya jugó en este dispositivo */
export function refreshVoucher() {
  if (!btn) return;
  const c = cfg();
  const st = status();
  const s = scene && scene();
  btn.hidden = !s || !c.on || !!game || claimOpen || !(st.canPlay || st.pendingClaim);
  const used = c.tries - st.left;
  const label = st.pendingClaim ? 'Reclamar mi voucher' : used > 0 ? `Intentar de nuevo (${st.left === 1 ? 'última oportunidad' : `quedan ${st.left}`})` : c.button;
  btn.replaceChildren(el('span.vb-icon', { 'aria-hidden': 'true' }, '🎯'), label);
}

export const gameActive = () => !!game;

function onButton() {
  const st = status();
  if (st.pendingClaim) return claimDialog(st.v.win);
  if (st.canPlay) introDialog();
  else refreshVoucher();
}

function introDialog() {
  const c = cfg();
  const mins = c.seconds % 60 ? `${c.seconds} segundos` : `${c.seconds / 60} minuto${c.seconds === 60 ? '' : 's'}`;
  modal({
    title: c.button,
    body: el('div.voucher-intro', {},
      el('p', {}, `Tenés ${mins} para pegarle ${c.hits} veces al soldado que cruza corriendo entre los árboles.`),
      el('p', {}, `Si lo lográs, te ganás un voucher para usar en Vikingo Paintball.`),
      el('p.help', {}, triesText(status().left)),
      legalNote('Al jugar aceptás las ')
    ),
    actions: [
      { label: 'Ahora no', variant: 'ghost', onClick: (cl) => cl() },
      { label: '¡Empezar!', onClick: (cl) => { cl(); startGame(); } },
    ],
  });
}

/** «…bases y condiciones y la política de privacidad» (se abren en otra pestaña: el cartel sigue abierto) */
function legalNote(start) {
  const a = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text);
  return el('p.form-note', {}, start, a('/bases-voucher/', 'bases y condiciones'), ' y la ', a('/privacidad/', 'política de privacidad'), '.');
}

function triesText(left) {
  return left <= 1 ? 'Es tu última oportunidad de hoy. ¡Apuntá bien!' : `Te quedan ${left} oportunidades hoy. ¡Apuntá bien!`;
}

async function startGame() {
  const c = cfg();
  btn.disabled = true;
  let token;
  try {
    const r = await api('start', { deviceId: getSaved().id });
    if (!r.ok) throw new Error(r.error || 'No se pudo empezar.');
    token = r.token;
  } catch (e) {
    toast(e.message, 'err', 4000);
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  const v = getSaved();
  v.tries = (v.tries || 0) + 1; // cuenta como oportunidad usada desde que empieza
  save(v);
  const now = performance.now();
  game = { token, hits: 0, startedAt: now, endAt: now + c.seconds * 1000, need: c.hits, timer: setInterval(tick, 250) };
  scene()?.setNavLocked(true);
  onStartCb && onStartCb();
  trackEvent('voucher_inicio');
  refreshVoucher();
  hud.hidden = false;
  tick();
  floatMessage('¡A jugar!');
}

function tick() {
  if (!game) return;
  const left = Math.max(0, game.endAt - performance.now());
  const s = Math.ceil(left / 1000);
  hud.replaceChildren(
    el('span.vh-time' + (s <= 10 ? '.urgent' : ''), {}, `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`),
    el('span.vh-hits', {}, `🎯 ${game.hits}/${game.need}`)
  );
  if (left <= 0) endGame(false);
}

/** Llamado por la escena cada vez que una bola le pega al soldado. Devuelve true si el juego lo usó. */
export function registerHit() {
  if (!game) return false;
  game.hits++;
  trackEvent('voucher_impacto', { aciertos: game.hits });
  tick();
  if (game.hits >= game.need) {
    floatMessage('¡Ganaste!');
    endGame(true);
  } else {
    floatMessage(`¡Le pegaste! ${game.hits}/${game.need}`);
  }
  return true;
}

function endGame(won) {
  const g = game;
  clearInterval(g.timer);
  game = null;
  hud.hidden = true;
  scene()?.setNavLocked(false);
  const seconds = Math.round((performance.now() - g.startedAt) / 1000);
  if (won) {
    const v = getSaved();
    v.win = { at: Date.now(), token: g.token, hits: g.hits, seconds };
    save(v);
    trackEvent('voucher_ganado', { segundos: seconds });
    setTimeout(() => claimDialog(v.win), 1200); // se ve el «¡Ganaste!» y luego el cartel
  } else {
    const { left } = status();
    trackEvent('voucher_perdido', { aciertos: g.hits, oportunidades_restantes: left });
    const hitsText = `Le pegaste ${g.hits} ${g.hits === 1 ? 'vez' : 'veces'} de ${g.need}. Esta vez no hubo voucher…`;
    modal({
      title: '¡Se terminó el tiempo!',
      body: el('div.voucher-intro', {},
        el('p', {}, hitsText),
        left > 0
          ? el('p', {}, left === 1 ? 'Te queda una oportunidad más hoy.' : `Te quedan ${left} oportunidades más hoy.`)
          : el('p', {}, 'Ya usaste tus oportunidades de hoy. Volvé mañana para intentarlo de nuevo… o vení a jugar de verdad al campo.')
      ),
      actions: left > 0
        ? [
          { label: 'Más tarde', variant: 'ghost', onClick: (cl) => cl() },
          { label: 'Intentar de nuevo', onClick: (cl) => { cl(); startGame(); } },
        ]
        : [
          { label: 'Cerrar', variant: 'ghost', onClick: (cl) => cl() },
          { label: 'Ir a Reservas', onClick: (cl) => { cl(); goTo('reservas'); } },
        ],
    });
  }
  refreshVoucher();
}

/* ---------- cartel del premio con el campo de e-mail ---------- */
function claimDialog(win) {
  const c = cfg();
  const input = el('input', { type: 'email', required: true, autocomplete: 'email', inputmode: 'email', placeholder: 'tucorreo@ejemplo.com' });
  const err = el('p.voucher-err', { role: 'alert' });
  const send = el('button.btn', { type: 'submit' }, 'Enviar mi voucher');
  const form = el('form.voucher-form', { novalidate: true },
    el('label.field.full', {}, el('span', {}, 'Tu e-mail'), input),
    err,
    el('div.modal-actions', {}, send),
    legalNote('Usamos tu e-mail solo para enviarte el voucher y validarlo. Al enviarlo aceptás las ')
  );
  const m = modal({
    title: '🏆 ¡Voucher ganado!',
    body: el('div.voucher-win', {}, el('p.voucher-prize', {}, c.winText), form),
    onClose: () => { claimOpen = false; refreshVoucher(); },
  });
  claimOpen = true;
  refreshVoucher();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      err.textContent = 'Revisá el e-mail: parece que le falta algo.';
      input.focus();
      return;
    }
    err.textContent = '';
    send.disabled = true;
    send.textContent = 'Enviando…';
    try {
      const r = await api('claim', {
        token: win.token, email, hits: win.hits, seconds: win.seconds, deviceId: getSaved().id,
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'móvil' : 'PC',
        test: store.isAdmin || undefined,
      });
      if (!r.ok) throw new Error(r.error || 'No se pudo registrar el voucher.');
      const v = getSaved();
      if (v.win) v.win.code = r.code;
      save(v);
      trackEvent('voucher_reclamado');
      m.close();
      doneDialog(email, r.code);
    } catch (ex) {
      err.textContent = ex.message;
      send.disabled = false;
      send.textContent = 'Enviar mi voucher';
    }
  });
}

function doneDialog(email, code) {
  modal({
    title: '¡Listo!',
    body: el('div.voucher-intro', {},
      el('p', {}, 'Te enviamos el voucher a ', el('strong', {}, email), '. Si no lo ves, revisá la carpeta de spam.'),
      el('p.voucher-code-wrap', {}, 'Tu código: ', el('strong.voucher-code', {}, code)),
      el('p.help', {}, 'Guardalo: lo vas a necesitar al reservar tu partida.')
    ),
    actions: [
      { label: 'Cerrar', variant: 'ghost', onClick: (cl) => cl() },
      { label: 'Reservar ahora', onClick: (cl) => { cl(); goTo('reservas'); } },
    ],
  });
  refreshVoucher();
}
