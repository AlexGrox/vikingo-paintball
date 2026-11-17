/* ==========================================================================
   Tienda con pedidos: un bloque de tarjetas con «Pedidos online» activado
   muestra un selector de cantidad en cada producto con precio ($…) y un resumen
   con el total. El pedido se envía al registro (el mismo Apps Script del voucher),
   que recalcula el total con los precios publicados, lo anota en la hoja «Pedidos»
   y manda los e-mails al cliente y al dueño.
   ========================================================================== */
import { el, modal } from './ui.js';
import { store } from './store.js';
import { parsePrice } from './seo.js';
import { trackEvent } from './analytics.js';

const CART_KEY = 'vp_cart';
const MAX_QTY = 50;

/** Error de conexión con el registro (caído, sin internet o sin DNS) */
function offline() {
  const e = new Error('No se pudo conectar.');
  e.offline = true;
  return e;
}

const money = (n) => '$' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/* ---------- carrito (queda guardado si se cambia de sección) ---------- */
let cart = {};
try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { cart = {}; }
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* modo privado */ }
}

/** Resúmenes en pantalla que hay que poner en cero al enviar el pedido */
const refreshers = new Set();
function refreshAll() {
  refreshers.forEach((r) => (r.bar.isConnected ? r.refresh() : refreshers.delete(r)));
}

/** Stock cargado en la tarjeta: número (0 = sin stock) o null si no tiene límite */
export function stockOf(it) {
  if (it.stock === '' || it.stock == null) return null;
  const n = Math.floor(Number(it.stock));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Cartel de stock al lado del precio; en edición, un campo para cambiarlo */
export function stockNode(it, ctx) {
  if (ctx.editing) {
    const input = el('input.stock-input', {
      type: 'number', min: 0, step: 1, inputmode: 'numeric', value: stockOf(it) ?? '',
      placeholder: 'sin límite', 'aria-label': 'Stock disponible',
      oninput: () => { it.stock = input.value === '' ? '' : Math.max(0, Math.floor(Number(input.value) || 0)); ctx.changed(); },
    });
    return el('label.card-stock.editing', { title: 'Vacío = sin límite · 0 = sin stock' }, 'Stock: ', input);
  }
  const s = stockOf(it);
  if (s === null) return null;
  return el('span.card-stock' + (s === 0 ? '.out' : ''), {}, s === 0 ? 'Sin stock' : `Stock: ${s}`);
}

/** Productos pedibles de un bloque: { id, title, price, max } (max = lo que se puede pedir) */
function products(b) {
  return (b.items || [])
    .map((it) => {
      const s = stockOf(it);
      return { id: it.id, title: it.title || '', price: (parsePrice(it.tag) || {}).price, max: s === null ? MAX_QTY : Math.min(MAX_QTY, s) };
    })
    .filter((p) => p.id && p.title && p.price);
}

/** En edición: cada producto necesita un identificador propio (para reconocerlo en el pedido) */
export function ensureIds(b, newId) {
  if (!b.shop) return false;
  const seen = new Set();
  let changed = false;
  for (const it of b.items || []) {
    if (!it.id || seen.has(it.id)) { it.id = newId(); changed = true; }
    seen.add(it.id);
  }
  return changed;
}

/**
 * Vista para el visitante: agrega el selector de cantidad a las tarjetas con precio
 * y devuelve el bloque con el resumen del pedido debajo.
 */
export function renderShop(b, grid) {
  const list = products(b);
  const byId = new Map(list.map((p) => [p.id, p]));
  const cards = grid.querySelectorAll(':scope > .card');
  const counters = new Map();

  const bar = el('div.cart-bar', { role: 'region', 'aria-label': 'Tu pedido', hidden: true });
  const summary = el('span.cart-sum');
  const orderBtn = el('button.btn', { type: 'button', onclick: () => openOrder(b) }, 'Hacer pedido');
  bar.append(summary, orderBtn);

  // si bajó el stock desde que se armó el carrito, se ajusta la cantidad
  let fixed = false;
  for (const p of list) {
    if (cart[p.id] > p.max) { if (p.max) cart[p.id] = p.max; else delete cart[p.id]; fixed = true; }
  }
  if (fixed) saveCart();

  const plusBtns = new Map();
  const refresh = () => {
    let units = 0, total = 0;
    for (const [id, q] of Object.entries(cart)) {
      const p = byId.get(id);
      if (!p) continue;
      units += q;
      total += q * p.price;
    }
    counters.forEach((node, id) => (node.textContent = String(cart[id] || 0)));
    plusBtns.forEach((btnPlus, id) => (btnPlus.disabled = (cart[id] || 0) >= byId.get(id).max));
    bar.hidden = units === 0;
    summary.textContent = `🛒 ${units} ${units === 1 ? 'producto' : 'productos'} · Total ${money(total)}`;
  };

  (b.items || []).forEach((it, i) => {
    const p = byId.get(it.id);
    const card = cards[i];
    if (!p || !card || !p.max) return; // sin stock: no se puede pedir
    const count = el('span.qty-n', { 'aria-live': 'polite' }, '0');
    counters.set(p.id, count);
    const change = (d) => {
      const q = Math.max(0, Math.min(p.max, (cart[p.id] || 0) + d));
      if (q) cart[p.id] = q; else delete cart[p.id];
      saveCart();
      refresh();
    };
    const plus = el('button.qty-btn', { type: 'button', 'aria-label': `Agregar uno: ${p.title}`, onclick: () => change(1) }, '+');
    plusBtns.set(p.id, plus);
    card.querySelector('.card-body').append(el('div.qty', {},
      el('button.qty-btn', { type: 'button', 'aria-label': `Quitar uno: ${p.title}`, onclick: () => change(-1) }, '−'),
      count, plus));
  });
  refresh();
  refreshers.add({ bar, refresh });
  return el('div.shop', {}, grid, bar);
}

/* ---------- formulario del pedido ---------- */
function openOrder(b) {
  const list = products(b);
  const lines = list.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  if (!lines.length) return;
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const field = (label, input, full = false, required = false) =>
    el('label.field' + (full ? '.full' : ''), {}, el('span', {}, label, required ? ' *' : ''), input);
  const inputs = {
    nombre: el('input', { name: 'nombre', required: true, autocomplete: 'name', maxlength: 120 }),
    email: el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email', inputmode: 'email', maxlength: 160 }),
    telefono: el('input', { name: 'telefono', type: 'tel', required: true, autocomplete: 'tel', inputmode: 'tel', maxlength: 40 }),
    nota: el('textarea', { name: 'nota', rows: 2, maxlength: 500, placeholder: 'Ej.: lo retiro el sábado en mi partida' }),
  };
  const table = el('table.order-lines', {},
    el('tbody', {}, lines.map((l) => el('tr', {},
      el('td', {}, `${l.qty} × ${l.title}`),
      el('td.num', {}, money(l.qty * l.price))))),
    el('tfoot', {}, el('tr', {}, el('th', {}, 'Total'), el('th.num', {}, money(total)))));
  const msg = el('div.form-msg', { hidden: true, role: 'status' });
  const form = el('form.order-form', { novalidate: true },
    table,
    el('div.form-grid', {},
      field('Nombre y apellido', inputs.nombre, false, true),
      field('Teléfono (WhatsApp)', inputs.telefono, false, true),
      field('E-mail', inputs.email, true, true),
      field('Comentario (opcional)', inputs.nota, true)),
    el('p.form-note', {}, 'Te mandamos la confirmación por e-mail y te respondemos pronto para coordinar. Los productos se retiran en el campo. ',
      'Usamos tus datos solo para gestionar tu pedido. ', el('a', { href: '/privacidad/', target: '_blank', rel: 'noopener' }, 'Política de privacidad'), '.'),
    msg);

  const show = (cls, ...nodes) => {
    msg.hidden = false;
    msg.className = 'form-msg ' + cls;
    msg.replaceChildren(...nodes);
  };

  let sending = false;
  const send = async (close, button) => {
    if (sending) return;
    const d = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()]));
    if (!d.nombre) return show('err', 'Completá tu nombre y apellido.');
    if (!d.telefono) return show('err', 'Dejanos un teléfono para coordinar.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return show('err', 'Revisá el e-mail: parece que le falta algo.');
    sending = true;
    button.disabled = true;
    button.textContent = 'Enviando…';
    try {
      const url = String((store.content && store.content.site && store.content.site.voucherUrl) || '').trim();
      if (!url) throw offline();
      const res = await fetch(url, {
        method: 'POST', redirect: 'follow',
        body: JSON.stringify({ action: 'pedido', items: lines.map((l) => ({ id: l.id, qty: l.qty })), ...d }),
      }).catch(() => { throw offline(); });
      const r = await res.json().catch(() => null);
      if (!r) throw offline();
      if (!r.ok || !r.code) throw new Error(r.error || 'No se pudo enviar el pedido.');
      cart = {};
      saveCart();
      refreshAll();
      trackEvent('generate_lead', { formulario: 'pedido' }); // pedido enviado (sin datos personales)
      form.replaceChildren(
        el('div.form-msg.ok', { role: 'status' },
          el('p', {}, '¡Listo! Recibimos tu pedido.'),
          el('p', {}, 'Código: ', el('strong.voucher-code', {}, r.code), ' · Total: ', el('strong', {}, money(r.total))),
          el('p', {}, 'Te mandamos la confirmación a ', el('strong', {}, d.email), '. Pronto te respondemos para coordinar la entrega.')));
      button.hidden = true;
      cancel.textContent = 'Cerrar';
    } catch (e) {
      if (e.offline) {
        // sin conexión con el registro: el mismo pedido, ya escrito, por WhatsApp
        const site = (store.content && store.content.site) || {};
        const wa = String(site.whatsapp || '').replace(/[^\d]/g, '');
        const text = 'Hola, quiero hacer este pedido de la tienda:\n' +
          lines.map((l) => `${l.qty} × ${l.title} = ${money(l.qty * l.price)}`).join('\n') +
          `\nTotal: ${money(total)}\n\nNombre: ${d.nombre}\nTeléfono: ${d.telefono}\nE-mail: ${d.email}` + (d.nota ? `\nComentario: ${d.nota}` : '');
        show('err',
          el('p', {}, 'No pudimos conectar con el sistema de pedidos. Podés enviarnos este mismo pedido por WhatsApp:'),
          wa ? el('p', {}, el('a.btn.small', { href: `https://wa.me/${wa}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener' }, 'Enviar pedido por WhatsApp')) : null);
      } else show('err', e.message);
      button.disabled = false;
      button.textContent = 'Enviar pedido';
    } finally {
      sending = false;
    }
  };

  const m = modal({
    title: 'Tu pedido',
    body: form,
    actions: [
      { label: 'Seguir eligiendo', variant: 'ghost', onClick: (c) => c() },
      { label: 'Enviar pedido', onClick: () => send(m.close, sendBtn) },
    ],
  });
  const [cancel, sendBtn] = m.box.querySelectorAll('.modal-actions .btn');
  form.addEventListener('submit', (e) => { e.preventDefault(); send(m.close, sendBtn); });
}
