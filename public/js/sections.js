/* Renderizado del panel de una sección (vista y edición) */
import { el, icon, iconBtn, bindEditable, confirmDialog, formDialog, pickFile, toast } from './ui.js';
import { store, markDirty, uploadFile, emit } from './store.js';
import { BLOCK_TYPES, createBlock, richEditor } from './blocks.js';
import { mediaUrl } from './media.js';

const body = () => document.getElementById('panel-body');
let currentKey = null;

export function currentSection() {
  return currentKey;
}

export function renderTabs(activeKey) {
  const c = store.content;
  const tabs = document.getElementById('panel-tabs');
  tabs.replaceChildren(
    ...c.order.map((k) => el('a', { href: '#/' + k, 'aria-current': k === activeKey ? 'page' : null }, c.sections[k].label))
  );
  document.getElementById('panel-sitename').textContent = c.site.name;
  document.getElementById('panel-logo').src = c.site.logo;
}

export function renderSection(key, { keepScroll = false } = {}) {
  const c = store.content;
  const sec = c.sections[key];
  if (!sec) return;
  currentKey = key;
  const panel = document.getElementById('panel');
  const scroll = panel.scrollTop;
  const editing = store.editing;
  const changed = () => markDirty();
  const rerender = () => renderSection(key, { keepScroll: true });

  renderTabs(key);
  panel.classList.toggle('editing', editing);

  /* ----- cabecera ----- */
  const h1 = el('h1', {}, sec.title || '');
  const sub = el('p.subtitle', {}, sec.subtitle || '');
  const hero = el('header.hero' + (sec.cover ? '.has-cover' : ''), {},
    sec.cover ? el('div.hero-bg', { style: { backgroundImage: `url("${mediaUrl(sec.cover)}")` } }) : null,
    h1,
    sub
  );
  if (editing) {
    bindEditable(h1, sec, 'title', changed, { placeholder: 'Título de la sección' });
    bindEditable(sub, sec, 'subtitle', changed, { multiline: true, placeholder: 'Subtítulo (opcional)' });
    hero.append(el('div.edit-overlay', {},
      el('button.btn.small', {
        type: 'button',
        onclick: async () => {
          const file = await pickFile('image/*');
          if (!file) return;
          try {
            toast('Subiendo imagen…');
            sec.cover = (await uploadFile(file)).url;
            changed();
            rerender();
          } catch (e) { toast(e.message, 'err'); }
        },
      }, sec.cover ? 'Cambiar fondo' : 'Imagen de fondo'),
      sec.cover ? el('button.btn.small.ghost', { type: 'button', onclick: () => { sec.cover = ''; changed(); rerender(); } }, 'Quitar fondo') : null,
      el('button.btn.small.ghost', {
        type: 'button',
        onclick: async () => {
          const r = await formDialog({ title: 'Nombre en el cartel 3D y en el menú', fields: [{ key: 'label', label: 'Texto del cartel' }], values: sec });
          if (r && r.label.trim()) {
            sec.label = r.label.trim().toUpperCase();
            changed();
            emit('labels');
            rerender();
          }
        },
      }, `Cartel: ${sec.label}`)
    ));
  } else if (!sec.subtitle) sub.remove();

  /* ----- bloques ----- */
  const content = el('div.content');
  const blocks = sec.blocks;
  if (editing) content.append(inserter(blocks, 0, changed, rerender));
  blocks.forEach((b, i) => {
    const type = BLOCK_TYPES[b.type];
    if (!type) return;
    const ctx = { editing, changed, rerender };
    const wrap = el('section.block.block-' + b.type, { dataset: { id: b.id } });
    if (editing) {
      wrap.append(el('div.block-tools', {},
        el('span.bt-type', {}, type.label),
        iconBtn('up', 'Subir bloque', () => moveBlock(blocks, i, -1) && (changed(), rerender())),
        iconBtn('down', 'Bajar bloque', () => moveBlock(blocks, i, 1) && (changed(), rerender())),
        iconBtn('copy', 'Duplicar bloque', () => {
          const copy = structuredClone(b);
          copy.id = createBlock('text').id;
          blocks.splice(i + 1, 0, copy);
          changed();
          rerender();
        }),
        iconBtn('trash', 'Eliminar bloque', async () => {
          if (await confirmDialog(`Se eliminará este bloque de tipo «${type.label}».`, 'Eliminar')) {
            blocks.splice(i, 1);
            changed();
            rerender();
          }
        }, 'danger')
      ));
    }
    wrap.append(type.render(b, ctx));
    content.append(wrap);
    if (editing) content.append(inserter(blocks, i + 1, changed, rerender));
  });
  if (!blocks.length && !editing) content.append(el('p.empty', {}, 'Muy pronto habrá contenido aquí.'));

  /* ----- pie ----- */
  const footer = el('footer.site-footer');
  if (editing) footer.append(richEditor(c.site, 'footerHtml', changed, { mini: true, placeholder: 'Pie de página: dirección, teléfono, redes…' }));
  else footer.append(el('div.rich', { html: c.site.footerHtml || '' }));

  body().replaceChildren(el('div.panel-inner', {}, hero, content, footer));
  panel.scrollTop = keepScroll ? scroll : 0;
}

function moveBlock(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

function inserter(blocks, index, changed, rerender) {
  const wrap = el('div.inserter');
  const trigger = el('button.btn.small.ghost', { type: 'button', 'aria-expanded': 'false' }, icon('plus', 14), 'Añadir bloque');
  let menu = null;
  const close = () => {
    menu?.remove();
    menu = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside);
  };
  const outside = (e) => !wrap.contains(e.target) && close();
  trigger.addEventListener('click', () => {
    if (menu) return close();
    menu = el('div.add-menu', { role: 'menu' },
      Object.entries(BLOCK_TYPES).map(([type, def]) =>
        el('button', {
          type: 'button',
          role: 'menuitem',
          onclick: () => {
            blocks.splice(index, 0, createBlock(type));
            close();
            changed();
            rerender();
          },
        }, icon(def.icon, 18), def.label)
      )
    );
    wrap.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('mousedown', outside));
  });
  wrap.append(trigger);
  return wrap;
}
