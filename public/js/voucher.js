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
const SESS_KEY = 'vp_voucher_sess';
const WIN_LOCK_DAYS = 7; // quien gana no vuelve a jugar hasta pasada una semana
const DAY = 86400000;
const SESS_MS = 6 * 3600000 - 60000; // la sesión del registro dura 6 horas
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// navegadores dentro de apps (Instagram, Facebook, TikTok…): Google no permite entrar desde ahí
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|Line\/|; wv\)|TikTok|musical_ly|Snapchat|Twitter/i.test(navigator.userAgent);

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
/* ---------- login con Google ----------
   Si el registro tiene un «ID de cliente» de Google, para jugar hay que entrar con una cuenta:
   las oportunidades del día y la semana de espera se cuentan por cuenta en el registro
   (el modo incógnito o borrar los datos del navegador no dan más oportunidades). */
let server = null; // { clientId, tries } que informa el registro
let serverPromise = null;
function loadServer() {
  if (!serverPromise) {
    serverPromise = api('hello')
      .then((r) => (server = { clientId: (r && r.clientId) || '', tries: Number(r && r.tries) || 0 }))
      .catch(() => { serverPromise = null; return (server = null); });
  }
  return serverPromise;
}
const loginMode = () => !!(server && server.clientId);

/** { sid, email, name, left, nextPlay, at } guardada para no pedir el login a cada rato */
function getSess() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESS_KEY)); } catch { /* sin almacenamiento */ }
  if (!s || !s.sid || Date.now() - s.at > SESS_MS || s.day !== today()) return null;
  return s;
}
function setSess(s) {
  try { s ? localStorage.setItem(SESS_KEY, JSON.stringify({ ...s, day: today() })) : localStorage.removeItem(SESS_KEY); } catch { /* modo privado */ }
}

let gisPromise = null;
function loadGis() {
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => (window.google && google.accounts && google.accounts.id ? resolve(google.accounts.id) : reject(new Error('gis')));
      s.onerror = () => reject(new Error('gis'));
      document.head.append(s);
    }).catch((e) => { gisPromise = null; throw e; });
  }
  return gisPromise;
}

/** Estado del jugador (con login: el de su cuenta; sin login: el de este dispositivo) */
function status() {
  const v = getSaved();
  const c = cfg();
  // ganó y todavía puede reclamar el voucher (el permiso de partida dura 6 horas)
  const pendingClaim = !!(v.win && !v.win.code && Date.now() - v.win.at < 6 * 3600000);
  if (loginMode()) {
    const s = getSess();
    const tries = server.tries || c.tries;
    const left = s ? s.left : tries;
    const locked = !!(s && s.nextPlay);
    return { v, s, tries, left, pendingClaim, locked, canPlay: !locked && left > 0 };
  }
  const left = store.isAdmin ? c.tries : Math.max(0, c.tries - (v.tries || 0)); // el administrador siempre puede probar
  const locked = !!v.win && !store.isAdmin;
  return { v, s: null, tries: c.tries, left, pendingClaim, locked, canPlay: !locked && left > 0 };
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
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, ...data }), redirect: 'follow' })
    .catch(() => { throw new Error('No se pudo conectar. Probá de nuevo en unos minutos.'); }); // registro caído o sin internet
  const json = await res.json().catch(() => null);
  if (!json) throw new Error('No se pudo conectar. Probá de nuevo en unos segundos.');
  return json;
}

/* ---------- estado de la partida ---------- */
let scene = null;
let onStartCb = null;
let onEndCb = null;
let goTo = () => {};
let btn = null;
let hud = null;
let claimOpen = false; // el cartel del premio está abierto
let game = null; // { token, hits, endAt, startedAt, timer }

export function initVoucher({ getScene, onStart, onEnd, navigate }) {
  scene = getScene;
  onStartCb = onStart;
  onEndCb = onEnd;
  goTo = navigate;
  btn = el('button#voucher-btn', { type: 'button', onclick: onButton });
  hud = el('div#voucher-hud', { hidden: true, 'aria-live': 'polite' });
  document.querySelector('#hud').append(btn, hud);
  if (isLocal) document.addEventListener('vp-debug-hit', () => registerHit()); // pruebas automáticas en el PC
  refreshVoucher();
  // se pregunta al registro si pide login, sin demorar la carga de la portada
  if (cfg().on && cfg().url) setTimeout(() => loadServer().then(refreshVoucher), 2500);
}

/** Muestra u oculta el botón según los ajustes y si ya jugó en este dispositivo */
export function refreshVoucher() {
  if (!btn) return;
  const c = cfg();
  const st = status();
  const s = scene && scene();
  btn.hidden = !s || !c.on || !!game || claimOpen || !(st.canPlay || st.pendingClaim);
  const used = st.tries - st.left;
  const label = st.pendingClaim ? 'Reclamar mi voucher' : used > 0 ? `Intentar de nuevo (${st.left === 1 ? 'última oportunidad' : `quedan ${st.left}`})` : c.button;
  btn.replaceChildren(el('span.vb-icon', { 'aria-hidden': 'true' }, '🎯'), label);
}

export const gameActive = () => !!game;

async function onButton() {
  if (cfg().url && !server) {
    // el registro todavía no respondió si pide login
    btn.disabled = true;
    await loadServer();
    btn.disabled = false;
    if (!server) return toast('No se pudo conectar. Probá de nuevo en unos segundos.', 'err', 4000);
  }
  const st = status();
  if (st.pendingClaim) return claimDialog(st.v.win);
  if (st.canPlay) introDialog();
  else refreshVoucher();
}

function introDialog() {
  const c = cfg();
  const st = status();
  if (loginMode() && !st.s) return loginDialog();
  const mins = c.seconds % 60 ? `${c.seconds} segundos` : `${c.seconds / 60} minuto${c.seconds === 60 ? '' : 's'}`;
  let m = null;
  const change = () => { setSess(null); m && m.close(); refreshVoucher(); loginDialog(); };
  m = modal({
    title: c.button,
    body: el('div.voucher-intro', {},
      el('p', {}, `Tenés ${mins} para pegarle ${c.hits} veces al soldado que cruza corriendo entre los árboles.`),
      el('p', {}, `Si lo lográs, te ganás un voucher para usar en Vikingo Paintball.`),
      el('p.help', {}, triesText(st.left)),
      st.s ? el('p.voucher-account', {}, 'Jugás con ', el('strong', {}, st.s.email), ' · ',
        el('button.linklike', { type: 'button', onclick: change }, 'Cambiar de cuenta')) : null,
      legalNote('Al jugar aceptás las ')
    ),
    actions: [
      { label: 'Ahora no', variant: 'ghost', onClick: (cl) => cl() },
      { label: '¡Empezar!', onClick: (cl) => { cl(); startGame(); } },
    ],
  });
}

/** Paso previo: entrar con Google (las oportunidades se cuentan por cuenta) */
function loginDialog() {
  const c = cfg();
  const slot = el('div.gsi-slot', {}, el('p.help', {}, 'Cargando el acceso con Google…'));
  const err = el('p.voucher-err', { role: 'alert' });
  const body = el('div.voucher-intro', {},
    el('p', {}, `Para jugar, entrá con tu cuenta de Google. Cada cuenta tiene ${server.tries || c.tries} oportunidades por día y, si ganás, el voucher te llega a ese e-mail.`),
    slot, err,
    legalNote('Solo usamos tu e-mail para contar tus oportunidades y enviarte el voucher. Al entrar aceptás las ')
  );
  const m = modal({
    title: c.button,
    body,
    actions: [{ label: 'Ahora no', variant: 'ghost', onClick: (cl) => cl() }],
  });
  if (IN_APP) {
    // Google bloquea su login dentro de Instagram, Facebook, etc.
    const copy = el('button.btn.small.secondary', { type: 'button' }, 'Copiar el enlace');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(location.origin + '/'); copy.textContent = '¡Copiado!'; } catch { copy.textContent = location.origin; }
    };
    slot.replaceChildren(
      el('p', {}, 'Desde esta app no se puede entrar con Google. Abrí la web en Chrome o Safari: tocá los tres puntos (⋮ o ···) y elegí «Abrir en el navegador».'),
      el('p', {}, copy));
    trackEvent('voucher_login_app');
    return;
  }
  loadGis().then((gis) => {
    gis.initialize({
      client_id: server.clientId,
      ux_mode: 'popup',
      auto_select: false,
      callback: async (resp) => {
        err.textContent = '';
        slot.replaceChildren(el('p.help', {}, 'Verificando tu cuenta…'));
        try {
          const r = await api('login', { idToken: resp.credential });
          if (!r.ok) throw new Error(r.error || 'No se pudo entrar.');
          setSess({ sid: r.sid, email: r.email, name: r.name, left: r.left, nextPlay: r.nextPlay, at: Date.now() });
          trackEvent('voucher_login');
          m.close();
          refreshVoucher();
          const st = status();
          if (st.locked) toast(`Ya ganaste un voucher esta semana. Podés volver a jugar desde el ${st.s.nextPlay}.`, 'info', 6000);
          else if (st.left <= 0) toast('Ya usaste tus oportunidades de hoy con esta cuenta. Volvé mañana.', 'info', 6000);
          else introDialog();
        } catch (e) {
          err.textContent = e.message;
          slot.replaceChildren();
          renderGisButton(gis, slot);
        }
      },
    });
    slot.replaceChildren();
    renderGisButton(gis, slot);
  }).catch(() => {
    slot.replaceChildren();
    err.textContent = 'No se pudo cargar el acceso con Google. Revisá tu conexión y volvé a intentarlo.';
  });
}

function renderGisButton(gis, slot) {
  const holder = el('div.gsi-btn');
  slot.append(holder);
  gis.renderButton(holder, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', locale: 'es-419', width: 260 });
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
  const sess = loginMode() ? getSess() : null;
  if (loginMode() && !sess) { btn.disabled = false; return loginDialog(); }
  try {
    const r = await api('start', { deviceId: getSaved().id, sid: sess ? sess.sid : undefined });
    if (sess && r && typeof r.left === 'number') setSess({ ...sess, left: r.left });
    if (r && r.relogin) { setSess(null); btn.disabled = false; refreshVoucher(); return loginDialog(); }
    if (!r.ok) throw new Error(r.error || 'No se pudo empezar.');
    token = r.token;
  } catch (e) {
    toast(e.message, 'err', 4000);
    btn.disabled = false;
    refreshVoucher();
    return;
  }
  btn.disabled = false;
  const v = getSaved();
  if (!sess) v.tries = (v.tries || 0) + 1; // sin login: cuenta como oportunidad usada desde que empieza
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
  onEndCb && onEndCb(); // se termina el recorrido a pie
  const seconds = Math.round((performance.now() - g.startedAt) / 1000);
  if (won) {
    const v = getSaved();
    const s = loginMode() ? getSess() : null;
    v.win = { at: Date.now(), token: g.token, hits: g.hits, seconds, ...(s ? { email: s.email } : {}) };
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
  const fixed = win.email || ''; // con login: el voucher va a la cuenta de Google con la que jugó
  const input = el('input', { type: 'email', required: true, autocomplete: 'email', inputmode: 'email', placeholder: 'tucorreo@ejemplo.com' });
  const err = el('p.voucher-err', { role: 'alert' });
  const send = el('button.btn', { type: 'submit' }, 'Enviar mi voucher');
  const form = el('form.voucher-form', { novalidate: true },
    fixed
      ? el('p', {}, 'Te lo enviamos a ', el('strong', {}, fixed), ', la cuenta con la que jugaste.')
      : el('label.field.full', {}, el('span', {}, 'Tu e-mail'), input),
    err,
    el('div.modal-actions', {}, send),
    legalNote('Usamos tu e-mail solo para enviarte el voucher y validarlo. Al enviarlo aceptás las ')
  );
  const prize = fixed ? c.winText.replace(/\s*Colocá tu dirección de e-mail[^.]*\.?/i, '') : c.winText;
  const m = modal({
    title: '🏆 ¡Voucher ganado!',
    body: el('div.voucher-win', {}, el('p.voucher-prize', {}, prize), form),
    onClose: () => { claimOpen = false; refreshVoucher(); },
  });
  claimOpen = true;
  refreshVoucher();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = fixed || input.value.trim();
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
      const s = getSess();
      if (s && fixed) {
        // con login: esa cuenta espera una semana para volver a jugar
        const d = new Date(Date.now() + WIN_LOCK_DAYS * DAY);
        setSess({ ...s, nextPlay: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` });
      }
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
