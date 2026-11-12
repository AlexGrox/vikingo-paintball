/* ==========================================================================
   Información legal (Argentina)
   - Páginas sin cartel 3D: /privacidad/, /bases-voucher/ y /arrepentimiento/ (se editan
     como cualquier sección; son las secciones que no están en «order»).
   - Enlaces al pie de cada sección y en la portada: privacidad, bases del voucher,
     botón de arrepentimiento (Res. 424/2020) y reclamos de Defensa del Consumidor.
   - Data Fiscal (Formulario 960/D de ARCA): se pega en Ajustes del sitio el código que
     da ARCA y se muestra el logo con su enlace en la portada y al pie.
   - Bloque «Botón de arrepentimiento»: formulario que registra la solicitud en el
     Apps Script (mismo registro que los vouchers) y devuelve un código; si no se puede,
     ofrece enviarla por WhatsApp o e-mail.
   ========================================================================== */
import { el } from './ui.js';
import { store } from './store.js';
import { trackEvent } from './analytics.js';

export const CONSUMER_URL = 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario';
export const DATA_FISCAL_IMG = 'https://www.afip.gob.ar/images/f960/DATAWEB.jpg';

/** Página sin estación 3D (privacidad, bases, arrepentimiento…) */
export const isPageOnly = (key) => !!store.content.sections[key] && !store.content.order.includes(key);

/** Enlace de Data Fiscal a partir del código que da ARCA (o del enlace solo).
    '' = vacío · null = no se reconoce como un enlace de ARCA/AFIP */
export function parseDataFiscal(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const href = (s.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || (s.match(/https?:\/\/[^\s"'<>]+/i) || [])[0];
  try {
    const u = new URL(href);
    if (/(^|\.)(afip|arca)\.gob\.ar$/i.test(u.hostname) && !/\/images\//i.test(u.pathname)) return u.href;
  } catch { /* no es un enlace */ }
  return null;
}

/** Logo de Data Fiscal con su enlace (o nada si no está configurado) */
export function dataFiscalNode(site = store.content.site || {}, cls = '') {
  if (!site.dataFiscalUrl) return null;
  return el('a.data-fiscal' + cls, { href: site.dataFiscalUrl, target: '_F960AFIPInfo', rel: 'noopener', title: 'Data Fiscal (ARCA)' },
    el('img', { src: DATA_FISCAL_IMG, alt: 'Data Fiscal', width: 63, height: 86, loading: 'lazy' }));
}

/** Enlaces legales. compact = textos cortos (portada) */
export function legalLinks({ compact = false } = {}) {
  const { site = {}, sections } = store.content;
  const items = [
    sections.privacidad && el('a', { href: '/privacidad/' }, compact ? 'Privacidad' : 'Política de privacidad'),
    sections['bases-voucher'] && site.voucherOn && el('a', { href: '/bases-voucher/' }, compact ? 'Bases del voucher' : 'Bases y condiciones del voucher'),
    sections.arrepentimiento && el('a', { href: '/arrepentimiento/' }, 'Botón de arrepentimiento'),
    el('a', {
      href: site.consumerUrl || CONSUMER_URL, target: '_blank', rel: 'noopener',
      onclick: () => trackEvent('click_reclamos'),
    }, compact ? 'Defensa del consumidor' : 'Defensa de las y los consumidores. Para reclamos ingrese aquí'),
  ].filter(Boolean);
  const nodes = [];
  items.forEach((a, i) => nodes.push(...(i ? [el('span', { 'aria-hidden': 'true' }, ' · '), a] : [a])));
  return nodes;
}

/** Bloque legal del pie de cada sección: enlaces, titular/CUIT y Data Fiscal */
export function legalFooter() {
  const site = store.content.site || {};
  const who = [site.legalName && `Titular: ${site.legalName}`, site.cuit && `CUIT ${site.cuit}`].filter(Boolean).join(' · ');
  return el('div.legal-foot', {},
    el('nav.legal-links', { 'aria-label': 'Información legal' }, ...legalLinks()),
    who ? el('p.legal-who', {}, who) : null,
    dataFiscalNode(site));
}

/** Franja legal de la portada y logo de Data Fiscal (arriba a la derecha) */
export function renderHomeLegal() {
  const strip = document.getElementById('legal-strip');
  if (strip) strip.replaceChildren(...legalLinks({ compact: true }));
  document.querySelector('#hud .hud-df')?.remove();
  const df = dataFiscalNode(store.content.site, '.hud-df');
  if (df) document.getElementById('hud')?.append(df);
}

/* ---------- Bloque «Botón de arrepentimiento» ---------- */
export const REGRET_DEFAULT = {
  type: 'regret',
  title: 'Solicitar la cancelación',
  intro: 'Completá tus datos y contanos qué querés cancelar. Te damos un código de identificación de tu solicitud.',
  submitText: 'Enviar solicitud de arrepentimiento',
};

export function renderRegret(b, ctx, { bindEditable }) {
  const site = store.content.site || {};
  const title = el('h2', {}, b.title || '');
  const intro = el('p.gf-intro', {}, b.intro || '');
  const f = (label, input, full, req) => el('label.field' + (full ? '.full' : ''), {}, el('span', {}, label, req ? el('b.gf-req', { 'aria-hidden': 'true' }, ' *') : null), input);
  const today = new Date().toISOString().slice(0, 10);
  const inputs = {
    nombre: el('input', { name: 'nombre', required: true, autocomplete: 'name', maxlength: 120 }),
    email: el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email', inputmode: 'email', maxlength: 160 }),
    telefono: el('input', { name: 'telefono', type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 40 }),
    fecha: el('input', { name: 'fecha', type: 'date', max: today }),
    detalle: el('textarea', { name: 'detalle', required: true, rows: 4, maxlength: 1500, placeholder: 'Ej.: reserva del sábado 20 para 12 personas a nombre de…' }),
  };
  const submit = el('button.btn', { type: 'submit' }, b.submitText || REGRET_DEFAULT.submitText);
  const msg = el('div.form-msg', { hidden: true, role: 'status' });
  const form = el('form.regret-form', { novalidate: true },
    el('div.form-grid', {},
      f('Nombre y apellido', inputs.nombre, false, true),
      f('E-mail', inputs.email, false, true),
      f('Teléfono', inputs.telefono),
      f('Fecha de la reserva o compra', inputs.fecha),
      f('¿Qué querés cancelar?', inputs.detalle, true, true)),
    el('div.gf-actions', {}, submit),
    el('p.form-note', {}, 'Usamos estos datos solo para tramitar tu solicitud. ', el('a', { href: '/privacidad/' }, 'Política de privacidad'), '.'),
    msg);

  const show = (cls, ...nodes) => {
    msg.hidden = false;
    msg.className = 'form-msg ' + cls;
    msg.replaceChildren(...nodes);
    msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ctx.editing) return;
    const d = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
    if (!d.nombre) return show('err', 'Completá tu nombre y apellido.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return show('err', 'Revisá el e-mail: parece que le falta algo.');
    if (!d.detalle) return show('err', 'Contanos qué querés cancelar.');
    submit.disabled = true;
    submit.textContent = 'Enviando…';
    try {
      const url = String(site.voucherUrl || '').trim();
      if (!url) throw new Error('sin registro');
      const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'arrepentimiento', ...d }), redirect: 'follow' });
      const r = await res.json().catch(() => null);
      if (!r || !r.ok || !r.code) throw new Error((r && r.error) || 'sin respuesta');
      form.reset();
      trackEvent('arrepentimiento');
      show('ok',
        el('p', {}, 'Recibimos tu solicitud de arrepentimiento.'),
        el('p', {}, 'Código de identificación: ', el('strong.voucher-code', {}, r.code)),
        el('p', {}, 'También te lo enviamos a ', el('strong', {}, d.email), '. Te contactamos para completar la cancelación.'));
    } catch {
      // sin registro disponible: la misma solicitud por WhatsApp o e-mail
      const text = `Solicitud de arrepentimiento (botón de arrepentimiento)\nNombre: ${d.nombre}\nE-mail: ${d.email}` +
        (d.telefono ? `\nTeléfono: ${d.telefono}` : '') + (d.fecha ? `\nFecha de la reserva o compra: ${d.fecha}` : '') + `\nDetalle: ${d.detalle}`;
      const wa = String(site.whatsapp || '').replace(/[^\d]/g, '');
      show('err',
        el('p', {}, 'No pudimos registrar la solicitud automáticamente. Enviala por una de estas vías y te respondemos con tu código dentro de las 24 horas:'),
        el('p.regret-alt', {},
          wa ? el('a.btn.small', { href: `https://wa.me/${wa}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, 'Enviar por WhatsApp') : null,
          site.email ? el('a.btn.small.secondary', { href: `mailto:${site.email}?subject=${encodeURIComponent('Botón de arrepentimiento')}&body=${encodeURIComponent(text)}` }, 'Enviar por e-mail') : null));
    } finally {
      submit.disabled = false;
      submit.textContent = b.submitText || REGRET_DEFAULT.submitText;
    }
  });

  const card = el('div.form-card.gf-card', {}, title, b.intro || ctx.editing ? intro : null, form);
  if (ctx.editing) {
    bindEditable(title, b, 'title', ctx.changed, { placeholder: 'Título del formulario' });
    bindEditable(intro, b, 'intro', ctx.changed, { multiline: true, placeholder: 'Texto de introducción (opcional)' });
    bindEditable(submit, b, 'submitText', ctx.changed, { placeholder: 'Texto del botón' });
    form.querySelectorAll('input, textarea').forEach((i) => (i.disabled = true));
    card.append(el('p.help', {}, 'Las solicitudes quedan en la hoja «Arrepentimientos» del registro de vouchers (Apps Script) y te llega un aviso por e-mail.'));
  }
  return card;
}
