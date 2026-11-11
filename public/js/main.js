/* Punto de entrada: carga contenido, arranca la escena 3D, enrutado por hash y administración.
   Cada sección es un lugar del escenario: la cámara viaja hasta allí y luego aparece la página
   (con fondo transparente) sobre el entorno 3D. */
import { store, loadContent, checkSession, subscribe } from './store.js';
import { el, icon, toast } from './ui.js';
import { renderSection, renderTabs } from './sections.js';
import { initAdmin, openLogin, renderBar } from './admin.js';
import { isMuted, setMuted } from './audio.js';
import { mediaUrl } from './media.js';
import { openLinkWidget } from './widgets.js';
import { updatePriceData } from './seo.js';
import { initAnalytics, trackPage, trackEvent } from './analytics.js';

const $ = (s) => document.querySelector(s);
const home = $('#home');
const panel = $('#panel');
const hint = $('#hint');
const welcome = $('#welcome');
const loader = $('#loader');
let scene = null;
let navToken = 0; // invalida navegaciones anteriores si el usuario cambia de destino a mitad de viaje
let shownKey = null; // sección cuya página está visible

const DEFAULT_LOGO = 'img/logo-vikingo.webp';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function applySite() {
  initAnalytics(store.content.site.gaId); // Google Analytics (ID en Ajustes del sitio)
  updatePriceData(store.content); // precios de las tarjetas → datos para Google
  const { site, order, sections } = store.content;
  hint.textContent = site.hint || '';
  hint.hidden = !site.hint;
  $('meta[name=description]').content = site.description || '';
  const logo = mediaUrl(site.logo);
  $('#fallback-logo').src = logo;
  $('#fallback-logo').alt = site.name;
  // icono de pestaña: los favicons optimizados del logo oficial, o el logo si se cambia desde la web
  if (site.logo !== DEFAULT_LOGO) $('link[rel=icon]').href = logo;
  if ($('#loader img')) $('#loader img').src = logo;
  $('#fallback-links').replaceChildren(...order.map((k) => el('li', {}, el('a', { href: '#/' + k }, sections[k].label))));
  if (!shownKey) document.title = site.seoTitle || site.name;
  renderWelcome(site);
}

/** Recuadro de bienvenida (texto para buscadores). «RESERVAS» enlaza a la sección. */
function renderWelcome(site) {
  if (site.welcomeTitle) $('#welcome-title').textContent = site.welcomeTitle;
  if (site.welcomeText != null) {
    const paras = String(site.welcomeText).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
    $('#welcome-text').replaceChildren(...paras.map((t) => {
      const p = el('p');
      t.split(/(RESERVAS)/).forEach((part) => p.append(part === 'RESERVAS' ? el('a', { href: '#/reservas' }, part) : part));
      return p;
    }));
  }
  welcome.hidden = !site.welcomeTitle && !site.welcomeText && site.welcomeText != null;
}
let welcomeGone = false;
function dismissWelcome() {
  if (welcomeGone) return;
  welcomeGone = true;
  welcome.classList.add('gone');
  setTimeout(() => (welcome.style.display = 'none'), 2800); // tras el fundido lento (2,6 s en el CSS)
}

/* ---------- Enrutado ---------- */
function route() {
  const key = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
  if (key === 'admin') {
    history.replaceState(null, '', location.pathname + '#/');
    goHome();
    openLogin();
    return;
  }
  if (key && store.content.sections[key]) goToSection(key);
  else goHome();
}

async function hidePanel() {
  if (panel.hidden) return;
  panel.classList.remove('enter');
  panel.classList.add('leaving');
  await wait(260);
  panel.hidden = true;
  panel.classList.remove('leaving');
}

function showPanel(key) {
  renderSection(key);
  panel.hidden = false;
  panel.classList.remove('enter');
  void panel.offsetWidth;
  panel.classList.add('enter');
  shownKey = key;
  document.title = `${store.content.sections[key].label} · ${store.content.site.name}`;
  trackPage('/' + key, document.title);
  panel.focus({ preventScroll: true });
}

async function goToSection(key) {
  dismissWelcome();
  if (shownKey === key && !panel.hidden) return;
  const my = ++navToken;
  document.body.classList.add('in-section');
  home.inert = true;
  if (scene) {
    shownKey = null;
    await hidePanel();
    if (my !== navToken) return;
    const arrived = await scene.goTo(key);
    if (!arrived || my !== navToken) return;
  }
  showPanel(key);
}

async function goHome() {
  const my = ++navToken;
  const wasInSection = document.body.classList.contains('in-section');
  shownKey = null;
  document.title = store.content.site.seoTitle || store.content.site.name;
  await hidePanel();
  if (my !== navToken) return;
  if (scene && wasInSection) {
    const arrived = await scene.goHome();
    if (!arrived || my !== navToken) return;
  }
  document.body.classList.remove('in-section');
  home.inert = false;
  if (wasInSection) trackPage('/', document.title);
}

/* ---------- Sonido ---------- */
function setupSound() {
  const b = $('#btn-sound');
  const draw = () => {
    b.replaceChildren(icon(isMuted() ? 'mute' : 'sound', 20));
    b.setAttribute('aria-pressed', String(!isMuted()));
  };
  b.addEventListener('click', () => { setMuted(!isMuted()); draw(); });
  draw();
}

/* ---------- Arranque ---------- */
async function start() {
  // la escena 3D (y Three.js) se descarga mientras se carga el contenido
  const sceneModule = import('./scene.js');
  sceneModule.catch(() => {});
  try {
    await loadContent();
  } catch (e) {
    loader.querySelector('span').textContent = 'No se pudo cargar el contenido. Recarga la página.';
    console.error(e);
    return;
  }
  // páginas reales por sección (/reservas/…, generadas para buscadores): se convierten en #/reservas
  const pathKey = location.pathname.replace(/^\/+|\/+$/g, '');
  if (!location.hash && store.content.sections[pathKey]) history.replaceState(null, '', '/#/' + pathKey);

  // sesión antes de pintar: en la web publicada el administrador carga la última versión del repositorio
  await checkSession();
  applySite();
  setupSound();
  panel.tabIndex = -1;

  initAdmin({
    onAuth: (on) => {
      if (!on) store.editing = false;
      if (shownKey) renderSection(shownKey, { keepScroll: true });
    },
    onEditing: (on) => {
      if (shownKey) renderSection(shownKey, { keepScroll: true });
      else if (on) toast('Dispara a un cartel (o usa las pestañas) para editar esa sección. Logo y carteles: «Ajustes del sitio».', 'ok', 5000);
    },
  });

  subscribe((type) => {
    if (type === 'dirty' || type === 'auth') renderBar();
    if (type === 'content' || type === 'labels') {
      applySite();
      scene && scene.refresh(store.content);
      if (shownKey) {
        if (type === 'content') renderSection(shownKey, { keepScroll: true });
        else renderTabs(shownKey);
      }
    }
  });

  // Escape vuelve al campo (si no hay un modal abierto ni se está escribiendo)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.body.classList.contains('in-section')) return;
    if (document.querySelector('.modal-backdrop, .lightbox')) return;
    if (e.target.closest && e.target.closest('[contenteditable="true"], .ql-editor, input, textarea, select')) return;
    location.hash = '#/';
  });

  // Escena 3D (antes de enrutar, para que la primera sección ya aparezca en su estación)
  try {
    scene = await sceneModule.then((m) =>
      m.createScene({
        canvas: $('#scene'),
        crosshair: $('#crosshair'),
        content: store.content,
        onSectionHit: (key) => {
          if (location.hash === '#/' + key) route();
          else location.hash = '#/' + key;
        },
        onLinkHit: (kind) => {
          trackEvent('click_' + kind, { origen: 'escenario_3d' }); // mapa, whatsapp, instagram…
          openLinkWidget(kind);
        },
        onFirstShot: () => {
          dismissWelcome();
          setTimeout(() => hint.classList.add('gone'), 400);
        },
      })
    );
    home.classList.add('has-scene');
  } catch (e) {
    console.error('Escena 3D no disponible:', e);
    home.classList.add('no-webgl');
  }

  // Entrada directa a una sección (#/tienda): colocar la cámara allí sin viaje
  const initialKey = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
  if (scene && initialKey && store.content.sections[initialKey]) {
    document.body.classList.add('in-section');
    home.inert = true;
    await scene.goTo(initialKey, { instant: true });
    showPanel(initialKey);
  } else {
    route();
  }
  window.addEventListener('hashchange', route);
  if (!shownKey) trackPage('/', document.title); // visita a la portada

  loader.classList.add('done');
  setTimeout(() => loader.remove(), 700);
}

start();
