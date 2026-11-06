/* Widgets que se abren al disparar a los enlaces del escenario:
   mapa del campo (pin de ubicación) y redes sociales (placas de la caja). */
import { el, modal } from './ui.js';
import { store } from './store.js';
import { drawBadgeCanvas } from './links3d.js';

const digits = (v) => String(v || '').replace(/[^\d]/g, '');

/** Normaliza un usuario o enlace de red social → { url, label } */
function social(kind, value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const isUrl = /^https?:\/\//i.test(v);
  const user = v.replace(/^https?:\/\/(www\.)?[^/]+\//i, '').replace(/^@/, '').replace(/\/.*$/, '').replace(/\?.*$/, '');
  switch (kind) {
    case 'whatsapp': {
      const d = digits(v);
      return d ? { url: `https://wa.me/${d}?text=${encodeURIComponent('Hola, quiero información sobre Vikingo Paintball.')}`, label: v, button: 'Escribir por WhatsApp' } : null;
    }
    case 'instagram':
      return { url: isUrl ? v : `https://www.instagram.com/${user}/`, label: '@' + user, button: 'Ver Instagram' };
    case 'facebook':
      return { url: isUrl ? v : `https://www.facebook.com/${user}`, label: isUrl ? user || v : v, button: 'Ver Facebook' };
    case 'tiktok':
      return { url: isUrl ? v : `https://www.tiktok.com/@${user}`, label: '@' + user, button: 'Ver TikTok' };
    default:
      return null;
  }
}

const NAMES = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', map: 'Ubicación' };
const FIELD = { whatsapp: 'whatsapp', instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok' };

function icon(kind) {
  const c = drawBadgeCanvas(kind, 160);
  c.className = 'widget-icon';
  return c;
}

function notConfigured(what) {
  return el('p.help', {}, `Todavía no se ha configurado ${what}.`,
    store.isAdmin ? ' Añádelo en «Ajustes del sitio».' : '');
}

export function openLinkWidget(kind) {
  const site = (store.content && store.content.site) || {};
  if (kind === 'map') return openMap(site);
  const info = social(kind, site[FIELD[kind]]);
  const body = el('div.widget', {},
    el('div.widget-head', {}, icon(kind), el('div', {},
      el('strong', {}, NAMES[kind]),
      info ? el('span.widget-sub', {}, info.label) : null)),
    info
      ? el('a.btn', { href: info.url, target: '_blank', rel: 'noopener' }, info.button)
      : notConfigured(`el ${NAMES[kind]} del campo`)
  );
  modal({ title: 'Síguenos', body, actions: [{ label: 'Cerrar', variant: 'ghost', onClick: (c) => c() }] });
}

function openMap(site) {
  const link = String(site.mapsUrl || '').trim();
  let q = String(site.mapsQuery || '').trim();
  // sin ubicación escrita: sacar las coordenadas de un enlace largo de Google Maps
  if (!q) {
    const m = link.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) q = `${m[1]},${m[2]}`;
  }
  const isCoords = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q);
  const body = el('div.widget');
  if (q) {
    body.append(
      el('div.widget-map', {}, el('iframe', {
        src: `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`,
        title: 'Mapa de Vikingo Paintball', loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade', allowfullscreen: true,
      })),
      el('p.widget-sub', { style: { margin: '10px 0 0' } }, isCoords ? `${site.name || 'Vikingo Paintball'} · Córdoba` : q)
    );
  } else if (!link) {
    body.append(notConfigured('la ubicación del campo'));
  }
  if (q || link) {
    body.append(el('div.widget-actions', {},
      el('a.btn', { href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q || link)}`, target: '_blank', rel: 'noopener' }, 'Cómo llegar'),
      el('a.btn.secondary', { href: link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, target: '_blank', rel: 'noopener' }, 'Abrir en Google Maps')
    ));
  }
  modal({ title: 'Dónde estamos', body, wide: !!q, actions: [{ label: 'Cerrar', variant: 'ghost', onClick: (c) => c() }] });
}
