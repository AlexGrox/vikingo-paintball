/* Administración: login, barra de edición, ajustes del sitio, reservas y contraseña */
import { el, icon, modal, toast, pickFile, confirmDialog } from './ui.js';
import {
  store, login, logout, saveContent, discardChanges, changePassword, uploadFile, markDirty, emit,
  getReservas, updateReserva, deleteReserva,
} from './store.js';
import { loadQuill } from './blocks.js';

let hooks = {};

export function initAdmin(h) {
  hooks = h;
  document.getElementById('admin-access').addEventListener('click', openLogin);
  window.addEventListener('beforeunload', (e) => {
    if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('keydown', (e) => {
    if (store.isAdmin && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      doSave();
    }
  });
  renderBar();
}

export function openLogin() {
  if (store.isAdmin) return;
  const input = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = el('p.form-msg.err', { hidden: true });
  const form = el('form', {}, el('label.field', {}, el('span', {}, 'Contraseña'), input), err);
  let closeFn;
  const submit = async () => {
    try {
      await login(input.value);
      closeFn();
      toast('Sesión iniciada. Activa «Editar» para modificar la web.');
      renderBar();
      hooks.onAuth && hooks.onAuth(true);
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
      input.select();
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const m = modal({
    title: 'Administración',
    body: form,
    actions: [
      { label: 'Cancelar', variant: 'ghost', onClick: (c) => c() },
      { label: 'Entrar', onClick: submit },
    ],
  });
  closeFn = m.close;
}

async function doSave() {
  if (!store.dirty) return toast('No hay cambios que guardar');
  try {
    await saveContent();
    toast('Cambios guardados ✔');
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'err');
  }
}

export async function setEditing(on) {
  if (on) {
    try { await loadQuill(); } catch (e) { toast(e.message, 'err'); return; }
  }
  store.editing = on;
  renderBar();
  hooks.onEditing && hooks.onEditing(on);
}

export function renderBar() {
  const bar = document.getElementById('admin-bar');
  document.body.classList.toggle('is-admin', store.isAdmin);
  if (!store.isAdmin) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const status = el('span.ab-status' + (store.dirty ? '.dirty' : ''), {}, store.dirty ? '● Cambios sin guardar' : 'Todo guardado');
  bar.replaceChildren(
    el('span.ab-title', {}, 'ADMIN'),
    el('label.toggle', {}, el('input', { type: 'checkbox', checked: store.editing, onchange: (e) => setEditing(e.target.checked) }), 'Editar'),
    el('button.btn.small.ghost', { type: 'button', onclick: openSiteSettings }, 'Ajustes del sitio'),
    el('button.btn.small.ghost', { type: 'button', onclick: openReservas }, 'Reservas'),
    el('span.ab-sep'),
    status,
    el('button.btn.small.ghost', {
      type: 'button',
      disabled: !store.dirty,
      onclick: async () => {
        if (await confirmDialog('Se perderán los cambios que no hayas guardado.', 'Descartar')) {
          await discardChanges();
          toast('Cambios descartados');
        }
      },
    }, 'Descartar'),
    el('button.btn.small', { type: 'button', disabled: !store.dirty, onclick: doSave, title: 'Ctrl+S' }, 'Guardar'),
    el('button.btn.small.ghost', { type: 'button', onclick: openPassword }, 'Contraseña'),
    el('button.btn.small.ghost', {
      type: 'button',
      onclick: async () => {
        if (store.dirty && !(await confirmDialog('Tienes cambios sin guardar. ¿Salir igualmente?', 'Salir'))) return;
        await logout();
        if (store.dirty) await discardChanges();
        renderBar();
        hooks.onAuth && hooks.onAuth(false);
      },
    }, 'Salir')
  );
}

/* ---------- Ajustes del sitio ---------- */
function openSiteSettings() {
  const c = store.content;
  const draft = structuredClone({ site: c.site, labels: Object.fromEntries(c.order.map((k) => [k, c.sections[k].label])) });
  const preview = el('img.logo-preview', { src: draft.site.logo, alt: 'Logo' });
  const input = (obj, key, attrs = {}) => {
    const i = el(attrs.textarea ? 'textarea' : 'input', { value: obj[key] || '', ...attrs });
    if (attrs.textarea) i.value = obj[key] || '';
    i.addEventListener('input', () => (obj[key] = i.value));
    return i;
  };
  const field = (label, node, full = true, help) =>
    el('label.field' + (full ? '.full' : ''), {}, el('span', {}, label), node, help ? el('small.help', {}, help) : null);

  const body = el('div', {},
    el('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '18px' } },
      preview,
      el('div', { style: { display: 'grid', gap: '8px' } },
        el('button.btn.small', {
          type: 'button',
          onclick: async () => {
            const f = await pickFile('image/*');
            if (!f) return;
            try {
              toast('Subiendo logo…');
              draft.site.logo = (await uploadFile(f)).url;
              preview.src = draft.site.logo;
            } catch (e) { toast(e.message, 'err'); }
          },
        }, 'Cambiar logo'),
        el('button.btn.small.ghost', { type: 'button', onclick: () => { draft.site.logo = '/img/logo-vikingo.png'; preview.src = draft.site.logo; } }, 'Logo por defecto'),
        el('small.help', {}, 'Se muestra en el escudo 3D y en la cabecera. Mejor PNG con fondo transparente o redondo.')
      )
    ),
    el('div.form-grid', {},
      field('Nombre del sitio', input(draft.site, 'name')),
      field('Texto de ayuda en la portada', input(draft.site, 'hint')),
      field('Descripción para Google (SEO)', input(draft.site, 'description', { textarea: true, rows: 2 })),
      ...c.order.map((k) => field(`Cartel «${k}»`, input(draft.labels, k), false))
    ),
    el('p.help', {}, 'El pie de página, los títulos y los bloques se editan directamente en cada sección con «Editar» activado.')
  );
  modal({
    title: 'Ajustes del sitio',
    body,
    actions: [
      { label: 'Cancelar', variant: 'ghost', onClick: (cl) => cl() },
      {
        label: 'Aplicar',
        onClick: (cl) => {
          Object.assign(c.site, draft.site);
          for (const k of c.order) if (draft.labels[k]?.trim()) c.sections[k].label = draft.labels[k].trim().toUpperCase();
          markDirty();
          emit('content');
          cl();
          toast('Aplicado. Recuerda pulsar «Guardar».');
        },
      },
    ],
  });
}

/* ---------- Reservas recibidas ---------- */
async function openReservas() {
  const box = el('div', {}, el('p.empty', {}, 'Cargando…'));
  let list = [];
  let filter = 'pendiente';
  const m = modal({ title: 'Reservas recibidas', body: box, wide: true, actions: [{ label: 'Cerrar', variant: 'ghost', onClick: (c) => c() }] });

  const fmt = (iso) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  const fmtDate = (d) => (d ? new Date(d + 'T00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const csv = () => {
    const cols = ['creada', 'estado', 'fecha', 'hora', 'nombre', 'telefono', 'email', 'jugadores', 'modalidad', 'comentarios'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const text = [cols.join(';'), ...list.map((r) => cols.map((c2) => q(r[c2])).join(';'))].join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), download: 'reservas.csv' });
    a.click();
  };

  const draw = () => {
    const shown = list.filter((r) => filter === 'todas' || r.estado === filter);
    const count = (s) => list.filter((r) => r.estado === s).length;
    const filters = el('div.res-filters', {},
      ...[['pendiente', 'Pendientes'], ['confirmada', 'Confirmadas'], ['cancelada', 'Canceladas'], ['todas', 'Todas']].map(([k, l]) =>
        el('button.btn.small' + (filter === k ? '' : '.ghost'), { type: 'button', onclick: () => { filter = k; draw(); } },
          `${l} (${k === 'todas' ? list.length : count(k)})`)
      ),
      el('span.ab-sep', { style: { flex: 1 } }),
      el('button.btn.small.ghost', { type: 'button', onclick: csv, disabled: !list.length }, 'Exportar CSV (Excel)')
    );
    if (!shown.length) return box.replaceChildren(filters, el('p.empty', {}, 'No hay reservas en este estado.'));
    const rows = shown.map((r) => {
      const tel = (r.telefono || '').replace(/[^\d+]/g, '');
      const sel = el('select.estado-' + r.estado, {
        onchange: async (e) => {
          try {
            Object.assign(r, await updateReserva(r.id, e.target.value));
            draw();
          } catch (err) { toast(err.message, 'err'); }
        },
      }, ['pendiente', 'confirmada', 'cancelada'].map((s) => el('option', { value: s, selected: r.estado === s }, s)));
      return el('tr', {},
        el('td', {}, el('strong', {}, fmtDate(r.fecha)), el('small', {}, r.hora || '')),
        el('td', {}, el('strong', {}, r.nombre), el('small', {}, `Recibida ${fmt(r.creada)}`)),
        el('td', {},
          tel ? el('a', { href: 'tel:' + tel }, r.telefono) : null,
          tel ? el('small', {}, el('a', { href: `https://wa.me/${tel.replace(/^\+/, '')}`, target: '_blank', rel: 'noopener' }, 'WhatsApp')) : null,
          r.email ? el('small', {}, el('a', { href: 'mailto:' + r.email }, r.email)) : null
        ),
        el('td', {}, String(r.jugadores)),
        el('td', {}, r.modalidad || '—'),
        el('td', { style: { maxWidth: '260px' } }, r.comentarios || ''),
        el('td', {}, sel),
        el('td', {}, el('button.icon-btn.danger', {
          type: 'button', title: 'Eliminar', 'aria-label': 'Eliminar reserva',
          onclick: async () => {
            if (!(await confirmDialog(`Eliminar la reserva de ${r.nombre}.`, 'Eliminar'))) return;
            try {
              await deleteReserva(r.id);
              list = list.filter((x) => x.id !== r.id);
              draw();
            } catch (err) { toast(err.message, 'err'); }
          },
        }, icon('trash')))
      );
    });
    box.replaceChildren(filters, el('div.table-wrap', {}, el('table.data.res-table', {},
      el('thead', {}, el('tr', {}, ['Fecha', 'Nombre', 'Contacto', 'Jug.', 'Modalidad', 'Comentarios', 'Estado', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows)
    )));
  };

  try {
    list = await getReservas();
    draw();
  } catch (e) {
    box.replaceChildren(el('p.form-msg.err', {}, e.message));
  }
  return m;
}

/* ---------- Contraseña ---------- */
function openPassword() {
  const cur = el('input', { type: 'password', autocomplete: 'current-password' });
  const n1 = el('input', { type: 'password', autocomplete: 'new-password', minlength: 6 });
  const n2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const err = el('p.form-msg.err', { hidden: true });
  const f = (l, i) => el('label.field.full', {}, el('span', {}, l), i);
  modal({
    title: 'Cambiar contraseña',
    body: el('div', {}, el('div.form-grid', {}, f('Contraseña actual', cur), f('Nueva contraseña (mín. 6 caracteres)', n1), f('Repite la nueva', n2)), err),
    actions: [
      { label: 'Cancelar', variant: 'ghost', onClick: (c) => c() },
      {
        label: 'Cambiar',
        onClick: async (c) => {
          err.hidden = true;
          if (n1.value !== n2.value) { err.hidden = false; err.textContent = 'Las contraseñas nuevas no coinciden'; return; }
          try {
            await changePassword(cur.value, n1.value);
            c();
            toast('Contraseña actualizada');
          } catch (e) { err.hidden = false; err.textContent = e.message; }
        },
      },
    ],
  });
}
