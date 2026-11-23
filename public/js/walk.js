/* ==========================================================================
   Recorrer el campo: controles para caminar por el escenario 3D.
   - Celular: pantalla horizontal (se intenta girar sola; si no, se pide girar el celular) con
     dos círculos: el izquierdo mueve al jugador (adelante, atrás y de costado) y el derecho
     mueve la mira: deslizar apunta, tocar dispara y dejar el dedo quieto dispara en ráfaga.
   - PC: W A S D (o la mira con el ratón) para moverse y apuntar, clic o espacio para disparar,
     flechas para girar y Esc para salir.
   El movimiento, los choques y la cámara están en scene.js (scene.walk).
   ========================================================================== */
import { el, icon } from './ui.js';
import { trackEvent } from './analytics.js';

const TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const AIM_SENS = 0.0046; // radianes de giro por píxel que se desliza el dedo
const MOUSE_SENS = 0.0022; // ídem por píxel de movimiento del ratón
const KEY_LOOK = 1.7; // rad/s al girar con las flechas
const DEADZONE = 0.14;
const MOVED_PX = 10; // más que esto desde que se apoya el dedo = se está apuntando (no es un toque)
const TAP_MS = 250; // un toque corto dispara un tiro
const HOLD_MS = 300; // dedo quieto este tiempo = ráfaga
const FIRE_EVERY = 150;

export function initWalk({ scene, home, button, onStart }) {
  const walk = scene.walk;
  const canvas = home.querySelector('#scene');
  if (!walk || !button || !canvas) return null;

  let ui = null;
  let raf = 0;
  let last = 0;
  let hadLock = false;
  let beginToken = 0; // invalida los reintentos de begin() si la partida ya terminó
  const keys = new Set();
  const state = { move: null, aim: null, lastFire: 0 };
  const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };

  // El recorrido solo existe mientras dura una partida del voucher: el botón arranca oculto
  // y lo muestran begin() (al empezar a jugar) y end() (al terminar) desde el juego.
  button.hidden = true;
  button.replaceChildren(icon('compass', 20));
  button.addEventListener('click', () => (walk.active ? walk.stop() : walk.start()));
  walk.onChange = (on) => (on ? show() : hide());

  /* ---------- interfaz ---------- */
  function knobOf(pad) { return pad.querySelector('.walk-knob'); }
  function buildUi() {
    const hint = el('p.walk-hint', { role: 'status' }, TOUCH
      ? 'Izquierda: moverte · Derecha: apuntá y tocá para disparar'
      : 'W A S D: moverte · Mouse: apuntar · Clic: disparar · Esc: salir');
    const exit = el('button.walk-exit', { type: 'button', 'aria-label': 'Salir del recorrido', onclick: () => walk.stop() }, icon('close', 18), el('span', {}, TOUCH ? 'Salir' : 'Salir (Esc)'));
    const root = el('div.walk-ui' + (TOUCH ? '.touch' : ''), { 'aria-label': 'Controles para recorrer el campo' }, exit, hint);
    let movePad = null, aimPad = null;
    if (TOUCH) {
      movePad = el('div.walk-pad.walk-move', { 'aria-label': 'Mover', role: 'group' },
        el('span.walk-arrow.up'), el('span.walk-arrow.down'), el('span.walk-arrow.left'), el('span.walk-arrow.right'), el('div.walk-knob'));
      aimPad = el('div.walk-pad.walk-aim', { 'aria-label': 'Apuntar y disparar', role: 'group' },
        el('span.walk-reticle', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 8v12M32 44v12M8 32h12M44 32h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' }),
        el('div.walk-knob'));
      const rotate = el('div.walk-rotate', { role: 'status' },
        el('span.walk-phone', { 'aria-hidden': 'true' }),
        el('p', {}, 'Girá el celular para recorrer el campo'),
        el('button.btn.small', { type: 'button', onclick: () => walk.stop() }, 'Salir'));
      root.append(movePad, aimPad, rotate);
      bindMovePad(movePad);
      bindAimPad(aimPad);
      for (const pad of [movePad, aimPad]) pad.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    return { root, hint, movePad, aimPad };
  }

  function show() {
    if (ui) return;
    onStart?.();
    trackEvent('recorrer_campo', { dispositivo: TOUCH ? 'movil' : 'pc' });
    ui = buildUi();
    home.append(ui.root);
    document.body.classList.add('walking');
    button.setAttribute('aria-pressed', 'true');
    setTimeout(() => ui && ui.hint.classList.add('gone'), 7000);
    addEventListener('keydown', onKey);
    addEventListener('keyup', onKey);
    addEventListener('blur', releaseAll);
    button.blur(); // que la barra espaciadora no vuelva a activar el botón
    if (TOUCH) {
      // pantalla completa y horizontal (en iPhone no existe: se pide girar el celular)
      const de = document.documentElement;
      Promise.resolve(de.requestFullscreen?.({ navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => { /* el navegador no lo permite */ });
      addEventListener('resize', orient);
      addEventListener('orientationchange', orient);
      orient();
    } else {
      document.addEventListener('pointerlockchange', onLock);
      document.addEventListener('mousemove', onMouse);
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => { /* se gira con las flechas */ });
    }
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function hide() {
    if (!ui) return;
    cancelAnimationFrame(raf);
    ui.root.remove();
    ui = null;
    state.move = state.aim = null;
    keys.clear();
    walk.setMove(0, 0);
    document.body.classList.remove('walking');
    button.setAttribute('aria-pressed', 'false');
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKey);
    removeEventListener('blur', releaseAll);
    removeEventListener('resize', orient);
    removeEventListener('orientationchange', orient);
    document.removeEventListener('pointerlockchange', onLock);
    document.removeEventListener('mousemove', onMouse);
    hadLock = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { screen.orientation?.unlock?.(); } catch { /* sin bloqueo de orientación */ }
  }

  function orient() {
    if (!ui) return;
    const portrait = innerHeight > innerWidth;
    ui.root.classList.toggle('portrait', portrait);
    if (portrait) { state.move = state.aim = null; walk.setMove(0, 0); resetKnob(ui.movePad); resetKnob(ui.aimPad); }
  }

  /** Si la pestaña pierde el foco no deben quedar teclas «apretadas» */
  function releaseAll() {
    keys.clear();
    if (!state.move) walk.setMove(0, 0);
  }

  /* ---------- PC: teclado y ratón ---------- */
  function onLock() {
    if (document.pointerLockElement === canvas) hadLock = true;
    else if (hadLock && walk.active) { hadLock = false; walk.stop(); } // Esc con el ratón capturado: salir
  }
  function onMouse(e) {
    if (document.pointerLockElement === canvas) walk.look(-e.movementX * MOUSE_SENS, -e.movementY * MOUSE_SENS);
  }
  function onKey(e) {
    // con una ventana abierta (voucher, avisos…) o escribiendo en un campo, el teclado no mueve al jugador
    if (!walk.active || (e.target && (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.closest?.('.modal, [role="dialog"]')))) return;
    const k = e.key.toLowerCase();
    const down = e.type === 'keydown';
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.preventDefault();
      if (down) keys.add(k); else keys.delete(k);
    }
    if (down && k === 'escape') { walk.stop(); return; }
    if (down && k === ' ' && !e.repeat) walk.fire();
    if (!state.move) walk.setMove((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0));
  }

  /* ---------- bucle: flechas y ráfaga ---------- */
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (keys.size) {
      const lx = (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0);
      const ly = (keys.has('arrowup') ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0);
      if (lx || ly) walk.look(lx * KEY_LOOK * dt, ly * KEY_LOOK * dt);
    }
    if (document.body.classList.contains('in-section')) { walk.halt(); return; } // se abrió una página: el recorrido termina
    const a = state.aim;
    if (a && now - a.lastMove > HOLD_MS && now - state.lastFire > FIRE_EVERY) fire(now); // dedo quieto: ráfaga
  }
  function fire(now = performance.now()) {
    state.lastFire = now;
    walk.fire();
    vibrate(8);
    const pad = ui && ui.aimPad;
    if (pad) {
      pad.classList.add('firing');
      setTimeout(() => pad.classList.remove('firing'), 90);
    }
  }

  /* ---------- círculo izquierdo: moverse ---------- */
  function setKnob(pad, dx, dy) { knobOf(pad).style.transform = `translate(${dx}px, ${dy}px)`; }
  function resetKnob(pad) { if (pad) setKnob(pad, 0, 0); }

  function bindMovePad(pad) {
    const update = (e) => {
      const r = pad.getBoundingClientRect();
      const max = r.width * 0.34;
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      setKnob(pad, dx, dy);
      let nx = dx / max, ny = -dy / max;
      const mag = Math.hypot(nx, ny);
      if (mag < DEADZONE) { nx = ny = 0; } else { const k = (mag - DEADZONE) / (1 - DEADZONE) / mag; nx *= k; ny *= k; }
      walk.setMove(nx, ny);
    };
    pad.addEventListener('pointerdown', (e) => {
      if (state.move) return;
      e.preventDefault();
      state.move = { id: e.pointerId };
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('on');
      update(e);
    });
    pad.addEventListener('pointermove', (e) => { if (state.move && state.move.id === e.pointerId) update(e); });
    const end = (e) => {
      if (!state.move || state.move.id !== e.pointerId) return;
      state.move = null;
      pad.classList.remove('on');
      resetKnob(pad);
      walk.setMove(0, 0);
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
  }

  /* ---------- círculo derecho: apuntar y disparar ---------- */
  function bindAimPad(pad) {
    pad.addEventListener('pointerdown', (e) => {
      if (state.aim) return;
      e.preventDefault();
      const now = performance.now();
      state.aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: now, lastMove: now, moved: false };
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('on');
    });
    pad.addEventListener('pointermove', (e) => {
      const a = state.aim;
      if (!a || a.id !== e.pointerId) return;
      const dx = e.clientX - a.lx, dy = e.clientY - a.ly;
      a.lx = e.clientX;
      a.ly = e.clientY;
      walk.look(-dx * AIM_SENS, -dy * AIM_SENS);
      const off = Math.hypot(e.clientX - a.x0, e.clientY - a.y0);
      if (off > MOVED_PX) a.moved = true;
      if (Math.hypot(dx, dy) > 1.2) a.lastMove = performance.now();
      const max = pad.getBoundingClientRect().width * 0.34;
      const k = off > max ? max / off : 1;
      setKnob(pad, (e.clientX - a.x0) * k, (e.clientY - a.y0) * k);
    });
    const end = (e) => {
      const a = state.aim;
      if (!a || a.id !== e.pointerId) return;
      state.aim = null;
      pad.classList.remove('on');
      resetKnob(pad);
      if (e.type === 'pointerup' && !a.moved && performance.now() - a.t0 < TAP_MS) fire(); // toque corto = un tiro
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
  }

  /* ---------- lo maneja el juego del voucher ---------- */
  return {
    /** Empieza la partida: aparece el botón para volver a caminar y el jugador ya sale caminando */
    begin() {
      button.hidden = false;
      const mine = ++beginToken;
      let tries = 0;
      // si la cámara todavía está en un viaje (celular lento) el recorrido se rechaza: se reintenta unos segundos
      const go = () => {
        if (mine !== beginToken || walk.active) return;
        if (!walk.start() && ++tries < 12) setTimeout(go, 300);
      };
      go();
    },
    /** Termina la partida: se sale del recorrido y el botón desaparece */
    end() {
      beginToken++;
      button.hidden = true;
      if (walk.active) walk.stop();
    },
  };
}
