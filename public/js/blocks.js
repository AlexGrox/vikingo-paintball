/* ==========================================================================
   Bloques de contenido: cada tipo sabe pintarse en modo vista y en modo edición.
   ctx = { editing, changed(), rerender() }
   ========================================================================== */
import { el, icon, iconBtn, toast, pickFile, formDialog, embedUrl, bindEditable, confirmDialog } from './ui.js';
import { store, uploadFile, sendReserva, uid } from './store.js';
import { mediaUrl } from './media.js';
import { renderGForm, GFORM_DEFAULT } from './gform.js';

/* ---------- Quill (editor de texto enriquecido), carga bajo demanda ---------- */
let quillPromise = null;
export function loadQuill() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (!quillPromise) {
    quillPromise = new Promise((resolve, reject) => {
      const css = el('link', { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css' });
      const js = el('script', { src: 'https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.js' });
      js.onload = () => resolve(window.Quill);
      js.onerror = () => { quillPromise = null; reject(new Error('No se pudo cargar el editor de texto')); };
      document.head.append(css, js);
    });
  }
  return quillPromise;
}

const TOOLBAR_FULL = [
  [{ header: [1, 2, 3, false] }],
  [{ size: ['small', false, 'large', 'huge'] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ align: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
  ['blockquote', 'link', 'image', 'video'],
  ['clean'],
];
const TOOLBAR_MINI = [['bold', 'italic', 'underline'], [{ color: [] }], [{ align: [] }], ['link'], ['clean']];

/** Crea un editor Quill enlazado a obj[key] (HTML) */
export function richEditor(obj, key, changed, { mini = false, placeholder = 'Escribe aquí…' } = {}) {
  const wrap = el('div.rich-editor.rich');
  const area = el('div', { html: obj[key] || '' });
  wrap.append(area);
  const quill = new window.Quill(area, {
    theme: 'snow',
    placeholder,
    modules: {
      toolbar: {
        container: mini ? TOOLBAR_MINI : TOOLBAR_FULL,
        handlers: {
          image: async function () {
            const file = await pickFile('image/*');
            if (!file) return;
            try {
              toast('Subiendo imagen…');
              const { url } = await uploadFile(file);
              const range = this.quill.getSelection(true);
              this.quill.insertEmbed(range ? range.index : this.quill.getLength(), 'image', url, 'user');
            } catch (e) { toast(e.message, 'err'); }
          },
        },
      },
    },
  });
  quill.on('text-change', () => {
    obj[key] = quill.getLength() <= 1 && !quill.root.querySelector('img,iframe')
      ? ''
      : quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
    changed();
  });
  // traducir textos del tooltip de enlaces
  const tip = wrap.querySelector('.ql-tooltip');
  if (tip) {
    tip.querySelector('input[type=text]')?.setAttribute('data-link', 'https://… o #/reservas');
    tip.querySelector('input[type=text]')?.setAttribute('data-video', 'Enlace de YouTube o Vimeo');
  }
  return wrap;
}

/* ---------- utilidades comunes ---------- */
async function uploadInto(obj, key, accept, changed, rerender) {
  const file = await pickFile(accept);
  if (!file) return;
  const t0 = Date.now();
  try {
    toast('Subiendo archivo…');
    const { url } = await uploadFile(file, (p) => {
      if (p < 1 && Date.now() - t0 > 1500 && Math.round(p * 100) % 25 === 0) toast(`Subiendo… ${Math.round(p * 100)} %`);
    });
    obj[key] = url;
    changed();
    rerender();
    toast('Archivo subido');
  } catch (e) {
    toast(e.message, 'err');
  }
}

const btn = (label, onClick, variant = '') =>
  el('button.btn.small' + (variant ? '.' + variant : ''), { type: 'button', onclick: (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); } }, label);

function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}

/* ==========================================================================
   Tipos de bloque
   ========================================================================== */
export const BLOCK_TYPES = {
  text: {
    label: 'Texto',
    icon: 'text',
    create: () => ({ type: 'text', html: '' }),
    render(b, ctx) {
      if (!ctx.editing) return el('div.rich', { html: b.html || '' });
      return richEditor(b, 'html', ctx.changed);
    },
  },

  image: {
    label: 'Imagen',
    icon: 'image',
    create: () => ({ type: 'image', src: '', alt: '', caption: '', width: 'normal', link: '' }),
    render(b, ctx) {
      const fig = el('figure.media.w-' + (b.width || 'normal'), { style: { position: 'relative' } });
      if (b.src) {
        const img = el('img', { src: mediaUrl(b.src), alt: b.alt || '', loading: 'lazy' });
        fig.append(!ctx.editing && b.link ? el('a', { href: b.link, target: /^https?:/.test(b.link) ? '_blank' : null, rel: 'noopener' }, img) : img);
      } else if (ctx.editing) {
        fig.append(el('div.placeholder', {}, icon('image', 34), 'Sin imagen'));
      } else return el('div');

      if (ctx.editing) {
        fig.append(el('div.edit-overlay', {},
          btn(b.src ? 'Cambiar imagen' : 'Subir imagen', () => uploadInto(b, 'src', 'image/*', ctx.changed, ctx.rerender)),
          btn('URL', async () => {
            const r = await formDialog({ title: 'Imagen desde URL', fields: [{ key: 'src', label: 'Dirección de la imagen', type: 'url' }], values: b });
            if (r) { b.src = r.src.trim(); ctx.changed(); ctx.rerender(); }
          }, 'ghost'),
          btn('Ajustes', async () => {
            const r = await formDialog({
              title: 'Ajustes de imagen',
              values: b,
              fields: [
                { key: 'alt', label: 'Texto alternativo (accesibilidad y SEO)' },
                { key: 'width', label: 'Ancho', type: 'select', options: [['normal', 'Normal'], ['wide', 'Ancho'], ['full', 'Pantalla completa']] },
                { key: 'link', label: 'Enlace al hacer clic (opcional)', placeholder: 'https://… o #/reservas' },
              ],
            });
            if (r) { Object.assign(b, r); ctx.changed(); ctx.rerender(); }
          }, 'ghost')
        ));
        fig.append(bindEditable(el('figcaption', {}, b.caption || ''), b, 'caption', ctx.changed, { placeholder: 'Pie de foto (opcional)' }));
      } else if (b.caption) fig.append(el('figcaption', {}, b.caption));
      return fig;
    },
  },

  video: {
    label: 'Vídeo',
    icon: 'video',
    create: () => ({ type: 'video', src: '', caption: '', width: 'normal', autoplay: false }),
    render(b, ctx) {
      const fig = el('figure.media.w-' + (b.width || 'normal'), { style: { position: 'relative' } });
      const emb = embedUrl(b.src);
      if (emb) {
        fig.append(el('div.embed', {}, el('iframe', {
          src: emb, title: b.caption || 'Vídeo', loading: 'lazy',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          allowfullscreen: true, style: ctx.editing ? { pointerEvents: 'none' } : null,
        })));
      } else if (b.src) {
        const v = el('video', { src: mediaUrl(b.src), controls: !b.autoplay, playsinline: true, preload: 'metadata' });
        if (b.autoplay) { v.muted = true; v.autoplay = true; v.loop = true; }
        fig.append(v);
      } else if (ctx.editing) {
        fig.append(el('div.placeholder', {}, icon('video', 34), 'Sin vídeo', el('small', {}, 'Sube un archivo MP4/WebM o pega un enlace de YouTube/Vimeo')));
      } else return el('div');

      if (ctx.editing) {
        fig.append(el('div.edit-overlay', {},
          btn('Subir vídeo', () => uploadInto(b, 'src', 'video/mp4,video/webm,video/ogg,video/quicktime', ctx.changed, ctx.rerender)),
          btn('Enlace YouTube/Vimeo', async () => {
            const r = await formDialog({ title: 'Vídeo desde enlace', fields: [{ key: 'src', label: 'Enlace del vídeo', type: 'url', placeholder: 'https://www.youtube.com/watch?v=…' }], values: b });
            if (r) { b.src = r.src.trim(); ctx.changed(); ctx.rerender(); }
          }, 'ghost'),
          btn('Ajustes', async () => {
            const r = await formDialog({
              title: 'Ajustes de vídeo',
              values: b,
              fields: [
                { key: 'width', label: 'Ancho', type: 'select', options: [['normal', 'Normal'], ['wide', 'Ancho'], ['full', 'Pantalla completa']] },
                { key: 'autoplay', label: 'Reproducción automática en bucle y sin sonido (solo archivos subidos)', type: 'checkbox' },
              ],
            });
            if (r) { Object.assign(b, r); ctx.changed(); ctx.rerender(); }
          }, 'ghost')
        ));
        fig.append(bindEditable(el('figcaption', {}, b.caption || ''), b, 'caption', ctx.changed, { placeholder: 'Descripción (opcional)' }));
      } else if (b.caption) fig.append(el('figcaption', {}, b.caption));
      return fig;
    },
  },

  gallery: {
    label: 'Galería',
    icon: 'gallery',
    create: () => ({ type: 'gallery', images: [] }),
    render(b, ctx) {
      const grid = el('div.gallery');
      b.images.forEach((im, i) => {
        const img = el('img', { src: mediaUrl(im.src), alt: im.caption || '', loading: 'lazy' });
        if (!ctx.editing) img.addEventListener('click', () => openLightbox(mediaUrl(im.src)));
        const fig = el('figure', {}, img);
        if (ctx.editing) {
          fig.append(el('div.g-tools', {},
            iconBtn('left', 'Mover a la izquierda', () => move(b.images, i, -1) && (ctx.changed(), ctx.rerender())),
            iconBtn('right', 'Mover a la derecha', () => move(b.images, i, 1) && (ctx.changed(), ctx.rerender())),
            iconBtn('trash', 'Quitar', () => { b.images.splice(i, 1); ctx.changed(); ctx.rerender(); }, 'danger')
          ));
          fig.append(bindEditable(el('figcaption', {}, im.caption || ''), im, 'caption', ctx.changed, { placeholder: 'Pie (opcional)' }));
        } else if (im.caption) fig.append(el('figcaption', {}, im.caption));
        grid.append(fig);
      });
      if (!ctx.editing) return grid;
      return el('div', {},
        b.images.length ? grid : el('div.placeholder', {}, icon('gallery', 34), 'Galería vacía'),
        el('div.edit-row', {}, btn('Añadir imágenes', async () => {
          const files = await pickFile('image/*', true);
          if (!files || !files.length) return;
          toast(`Subiendo ${files.length} imagen(es)…`);
          for (const f of files) {
            try {
              const { url } = await uploadFile(f);
              b.images.push({ src: url, caption: '' });
            } catch (e) { toast(e.message, 'err'); }
          }
          ctx.changed();
          ctx.rerender();
        }))
      );
    },
  },

  cards: {
    label: 'Tarjetas',
    icon: 'cards',
    create: () => ({ type: 'cards', items: [{ img: '', title: 'Título', tag: '', text: 'Descripción', link: '', linkText: '' }] }),
    render(b, ctx) {
      const grid = el('div.cards');
      b.items.forEach((it, i) => {
        const media = el('div.card-img', {}, it.img ? el('img', { src: mediaUrl(it.img), alt: '', loading: 'lazy' }) : el('div.noimg', {}, icon('image', 48)));
        if (!it.img && !ctx.editing) media.hidden = true;
        const tag = el('span.card-tag', {}, it.tag || '');
        const title = el('h3', {}, it.title || '');
        const text = el('p', {}, it.text || '');
        const body = el('div.card-body', {}, tag, title, text);
        const card = el('article.card', {}, media, body);

        if (ctx.editing) {
          bindEditable(tag, it, 'tag', ctx.changed, { placeholder: 'Etiqueta / precio' });
          bindEditable(title, it, 'title', ctx.changed, { placeholder: 'Título' });
          bindEditable(text, it, 'text', ctx.changed, { multiline: true, placeholder: 'Descripción' });
          media.append(el('div.edit-overlay', {},
            btn(it.img ? 'Cambiar' : 'Imagen', () => uploadInto(it, 'img', 'image/*', ctx.changed, ctx.rerender)),
            it.img ? btn('Quitar', () => { it.img = ''; ctx.changed(); ctx.rerender(); }, 'ghost') : null
          ));
          body.append(el('div.edit-row', {},
            btn(it.link ? `Botón: ${it.linkText || 'Ver más'}` : 'Añadir botón', async () => {
              const r = await formDialog({
                title: 'Botón de la tarjeta',
                values: it,
                fields: [
                  { key: 'linkText', label: 'Texto del botón', placeholder: 'Ver más' },
                  { key: 'link', label: 'Enlace (vacío = sin botón)', placeholder: 'https://…, #/reservas, mailto:…, tel:…' },
                ],
              });
              if (r) { Object.assign(it, r); ctx.changed(); ctx.rerender(); }
            }, 'ghost')
          ));
          card.append(el('div.card-tools', {},
            iconBtn('left', 'Mover antes', () => move(b.items, i, -1) && (ctx.changed(), ctx.rerender())),
            iconBtn('right', 'Mover después', () => move(b.items, i, 1) && (ctx.changed(), ctx.rerender())),
            iconBtn('copy', 'Duplicar', () => { b.items.splice(i + 1, 0, structuredClone(it)); ctx.changed(); ctx.rerender(); }),
            iconBtn('trash', 'Eliminar tarjeta', async () => {
              if (await confirmDialog('Se eliminará esta tarjeta.', 'Eliminar')) { b.items.splice(i, 1); ctx.changed(); ctx.rerender(); }
            }, 'danger')
          ));
        } else if (it.link) {
          const ext = /^https?:/.test(it.link);
          body.append(el('a.btn.small', { href: it.link, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null }, it.linkText || 'Ver más'));
        }
        grid.append(card);
      });
      if (ctx.editing) {
        grid.append(el('button.card.add-card', {
          type: 'button',
          onclick: () => { b.items.push({ img: '', title: 'Nueva tarjeta', tag: '', text: '', link: '', linkText: '' }); ctx.changed(); ctx.rerender(); },
        }, el('span', {}, icon('plus', 28), el('br'), 'Añadir tarjeta')));
      }
      return grid;
    },
  },

  table: {
    label: 'Tabla / Ranking',
    icon: 'table',
    create: () => ({ type: 'table', podium: true, headers: ['#', 'Jugador', 'Puntos'], rows: [['1', '', '0']] }),
    render(b, ctx) {
      const podium = b.podium !== false;
      const table = el('table.data' + (podium ? '.podium' : '') + (ctx.editing ? '.editing-table' : ''));
      const thead = el('thead');
      const htr = el('tr');
      b.headers.forEach((h, ci) => {
        const label = el('span', {}, h);
        const th = el('th', { scope: 'col' }, label);
        if (ctx.editing) {
          bindEditable(label, b.headers, ci, ctx.changed, { placeholder: 'Columna' });
          th.append(el('span.col-tools', {},
            iconBtn('sort', 'Ordenar por esta columna', () => { sortBy(b, ci); ctx.changed(); ctx.rerender(); }),
            iconBtn('left', 'Mover columna', () => { moveCol(b, ci, -1) && (ctx.changed(), ctx.rerender()); }),
            iconBtn('trash', 'Eliminar columna', () => {
              if (b.headers.length <= 1) return;
              b.headers.splice(ci, 1);
              b.rows.forEach((r) => r.splice(ci, 1));
              ctx.changed(); ctx.rerender();
            }, 'danger')
          ));
        }
        htr.append(th);
      });
      if (ctx.editing) htr.append(el('th.row-del'));
      thead.append(htr);
      const tbody = el('tbody');
      b.rows.forEach((row, ri) => {
        const tr = el('tr');
        b.headers.forEach((_, ci) => {
          const td = el('td', {}, row[ci] ?? '');
          if (ctx.editing) bindEditable(td, row, ci, ctx.changed);
          tr.append(td);
        });
        if (ctx.editing) {
          tr.append(el('td.row-del', {},
            iconBtn('up', 'Subir fila', () => move(b.rows, ri, -1) && (ctx.changed(), ctx.rerender())),
            iconBtn('trash', 'Eliminar fila', () => { b.rows.splice(ri, 1); ctx.changed(); ctx.rerender(); }, 'danger')
          ));
        }
        tbody.append(tr);
      });
      table.append(thead, tbody);
      const wrap = el('div.table-wrap', {}, table);
      if (!ctx.editing) return wrap;
      return el('div', {}, wrap, el('div.edit-row', {},
        btn('+ Fila', () => { b.rows.push(b.headers.map((_, i) => (i === 0 && podium ? String(b.rows.length + 1) : ''))); ctx.changed(); ctx.rerender(); }),
        btn('+ Columna', () => { b.headers.push('Columna'); b.rows.forEach((r) => r.push('')); ctx.changed(); ctx.rerender(); }, 'ghost'),
        btn('Pegar desde Excel', async () => {
          const r = await formDialog({
            title: 'Pegar tabla',
            okLabel: 'Reemplazar tabla',
            fields: [
              { key: 'data', label: 'Copia las celdas en Excel / Google Sheets y pégalas aquí (la primera fila serán los encabezados)', type: 'textarea', rows: 10 },
            ],
          });
          if (!r || !r.data.trim()) return;
          const lines = r.data.replace(/\r/g, '').split('\n').filter((l) => l.trim());
          const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
          const grid = lines.map((l) => l.split(sep).map((c) => c.trim()));
          b.headers = grid[0];
          b.rows = grid.slice(1).map((r2) => b.headers.map((_, i) => r2[i] ?? ''));
          ctx.changed(); ctx.rerender();
        }, 'ghost'),
        el('label.toggle', {}, el('input', {
          type: 'checkbox', checked: podium,
          onchange: (e) => { b.podium = e.target.checked; ctx.changed(); ctx.rerender(); },
        }), 'Destacar podio (top 3)')
      ));
    },
  },

  button: {
    label: 'Botón',
    icon: 'button',
    create: () => ({ type: 'button', text: '¡Reserva ahora!', url: '#/reservas', style: 'primary', newTab: false }),
    render(b, ctx) {
      const ext = /^https?:/.test(b.url || '');
      const a = el('a.btn' + (b.style === 'secondary' ? '.secondary' : ''), {
        href: b.url || '#', target: !ctx.editing && (b.newTab || ext) ? '_blank' : null, rel: ext ? 'noopener' : null,
      }, b.text || 'Botón');
      const wrap = el('div.block-button', {}, a);
      if (ctx.editing) {
        bindEditable(a, b, 'text', ctx.changed, { placeholder: 'Texto del botón' });
        wrap.append(el('div.edit-row', { style: { justifyContent: 'center' } }, btn('Enlace y estilo', async () => {
          const r = await formDialog({
            title: 'Botón',
            values: b,
            fields: [
              { key: 'url', label: 'Enlace', placeholder: 'https://…, #/tienda, https://wa.me/34…, tel:…' },
              { key: 'style', label: 'Estilo', type: 'select', options: [['primary', 'Relleno'], ['secondary', 'Contorno']] },
              { key: 'newTab', label: 'Abrir en una pestaña nueva', type: 'checkbox' },
            ],
          });
          if (r) { Object.assign(b, r); ctx.changed(); ctx.rerender(); }
        }, 'ghost')));
      }
      return wrap;
    },
  },

  faq: {
    label: 'Preguntas frecuentes',
    icon: 'text',
    create: () => ({ type: 'faq', title: 'Preguntas frecuentes', items: [{ q: 'Pregunta', a: 'Respuesta' }] }),
    render(b, ctx) {
      const wrap = el('div.faq');
      const title = el('h2', {}, b.title || '');
      if (ctx.editing) bindEditable(title, b, 'title', ctx.changed, { placeholder: 'Título (opcional)' });
      if (b.title || ctx.editing) wrap.append(title);
      b.items.forEach((it, i) => {
        if (!ctx.editing) {
          wrap.append(el('details.faq-item', {}, el('summary', {}, it.q || ''), el('p.faq-a', {}, it.a || '')));
          return;
        }
        const q = el('strong.faq-q', {}, it.q || '');
        const a = el('p.faq-a', {}, it.a || '');
        bindEditable(q, it, 'q', ctx.changed, { placeholder: 'Pregunta' });
        bindEditable(a, it, 'a', ctx.changed, { multiline: true, placeholder: 'Respuesta' });
        wrap.append(el('div.faq-item.faq-edit', {},
          el('div.faq-tools', {},
            iconBtn('up', 'Subir', () => move(b.items, i, -1) && (ctx.changed(), ctx.rerender())),
            iconBtn('down', 'Bajar', () => move(b.items, i, 1) && (ctx.changed(), ctx.rerender())),
            iconBtn('trash', 'Eliminar pregunta', () => { b.items.splice(i, 1); ctx.changed(); ctx.rerender(); }, 'danger')),
          q, a));
      });
      if (ctx.editing) {
        wrap.append(el('div.edit-row', {}, btn('+ Pregunta', () => { b.items.push({ q: '', a: '' }); ctx.changed(); ctx.rerender(); }),
          el('small', { style: { color: 'var(--muted)' } }, 'Google puede mostrar estas preguntas y respuestas en los resultados de búsqueda.')));
      }
      return wrap;
    },
  },

  gform: {
    label: 'Formulario de Google',
    icon: 'form',
    create: () => structuredClone(GFORM_DEFAULT),
    render: (b, ctx) => renderGForm(b, ctx, { bindEditable, formDialog, btn }),
  },

  form: {
    label: 'Formulario de reserva',
    icon: 'form',
    create: () => ({
      type: 'form', title: 'Solicitar reserva', submitText: 'Enviar solicitud',
      successText: '¡Recibido! Te contactaremos pronto.', modalidades: 'Pack Guerrero, Pack Jarl, Pack Valhalla',
    }),
    render(b, ctx) {
      // en la web publicada (sin servidor) se reserva por WhatsApp o teléfono
      if (store.mode === 'static') return contactCard(b, ctx);
      const today = new Date().toISOString().slice(0, 10);
      const opts = (b.modalidades || '').split(',').map((s) => s.trim()).filter(Boolean);
      const f = (label, input, full) => el('label.field' + (full ? '.full' : ''), {}, el('span', {}, label), input);
      const title = el('h2', {}, b.title || '');
      const submit = el('button.btn', { type: 'submit' }, b.submitText || 'Enviar');
      const msg = el('p.form-msg', { hidden: true });
      const form = el('form', { novalidate: false },
        el('div.form-grid', {},
          f('Nombre *', el('input', { name: 'nombre', required: true, autocomplete: 'name' })),
          f('Teléfono', el('input', { name: 'telefono', type: 'tel', autocomplete: 'tel' })),
          f('Email', el('input', { name: 'email', type: 'email', autocomplete: 'email' })),
          f('Nº de jugadores', el('input', { name: 'jugadores', type: 'number', min: 1, max: 200, value: 10 })),
          f('Fecha *', el('input', { name: 'fecha', type: 'date', required: true, min: today })),
          f('Hora', el('input', { name: 'hora', type: 'time', step: 900, value: '10:00' })),
          opts.length ? f('Modalidad', el('select', { name: 'modalidad' }, opts.map((o) => el('option', {}, o))), true) : null,
          f('Comentarios', el('textarea', { name: 'comentarios', placeholder: 'Cumpleaños, despedida, alquiler de equipo extra…' }), true),
          el('input.hp', { name: 'web', tabindex: -1, autocomplete: 'off', 'aria-hidden': 'true' })
        ),
        submit, msg
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (ctx.editing) return;
        const data = Object.fromEntries(new FormData(form));
        if (!data.email && !data.telefono) {
          msg.hidden = false; msg.className = 'form-msg err'; msg.textContent = 'Indica un teléfono o un email para poder contactarte.';
          return;
        }
        submit.disabled = true;
        try {
          await sendReserva(data);
          form.reset();
          msg.hidden = false; msg.className = 'form-msg ok'; msg.textContent = b.successText || '¡Recibido!';
        } catch (err) {
          msg.hidden = false; msg.className = 'form-msg err'; msg.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      });
      const card = el('div.form-card', {}, title, form);
      if (ctx.editing) {
        bindEditable(title, b, 'title', ctx.changed, { placeholder: 'Título del formulario' });
        bindEditable(submit, b, 'submitText', ctx.changed, { placeholder: 'Texto del botón' });
        form.querySelectorAll('input, select, textarea').forEach((i) => (i.disabled = true));
        card.append(el('div.edit-row', {}, btn('Ajustes del formulario', async () => {
          const r = await formDialog({
            title: 'Formulario de reserva',
            values: b,
            fields: [
              { key: 'modalidades', label: 'Opciones de modalidad (separadas por comas)', type: 'textarea', rows: 3 },
              { key: 'successText', label: 'Mensaje tras enviar', type: 'textarea', rows: 3 },
            ],
          });
          if (r) { Object.assign(b, r); ctx.changed(); ctx.rerender(); }
        }, 'ghost'), el('small', { style: { color: 'var(--muted)' } }, 'Las solicitudes llegan a «Reservas» en la barra de administración.')));
      }
      return card;
    },
  },
};

/** Tarjeta de reserva por WhatsApp / teléfono (web publicada sin servidor) */
function contactCard(b, ctx) {
  const site = store.content.site || {};
  const digits = (v) => String(v || '').replace(/[^\d+]/g, '');
  const wa = digits(site.whatsapp).replace(/^\+/, '');
  const tel = digits(site.phone || site.whatsapp);
  const title = el('h2', {}, b.title || '');
  const text = el('p', { style: { margin: '0 0 18px', color: 'var(--muted)', whiteSpace: 'pre-line' } },
    b.contactText || 'Escríbenos por WhatsApp o llámanos para reservar tu batalla: te confirmamos disponibilidad al momento.');
  const msg = encodeURIComponent(b.whatsappMessage || 'Hola, quiero hacer una reserva en Vikingo Paintball.');
  const buttons = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px' } },
    wa ? el('a.btn', { href: `https://wa.me/${wa}?text=${msg}`, target: '_blank', rel: 'noopener' }, 'Reservar por WhatsApp') : null,
    tel ? el('a.btn.secondary', { href: `tel:${tel}` }, `Llamar ${site.phone || site.whatsapp}`) : null
  );
  const card = el('div.form-card', {}, title, text, buttons);
  if (ctx.editing) {
    bindEditable(title, b, 'title', ctx.changed, { placeholder: 'Título' });
    bindEditable(text, b, 'contactText', ctx.changed, { multiline: true, placeholder: 'Texto de reserva' });
    if (!wa && !tel) card.append(el('p.form-msg.err', {}, 'Añade tu WhatsApp o teléfono en «Ajustes del sitio» para que aparezcan los botones.'));
  }
  return card;
}

export function createBlock(type) {
  return { id: uid(), ...BLOCK_TYPES[type].create() };
}

function sortBy(b, ci) {
  const num = (v) => parseFloat(String(v).replace(',', '.'));
  const numeric = b.rows.every((r) => r[ci] === '' || !isNaN(num(r[ci])));
  const dir = b._sort === ci ? -1 : 1; // segunda pulsación invierte el orden
  b.rows.sort((a, c) => {
    const r = numeric ? (num(c[ci]) || 0) - (num(a[ci]) || 0) : String(a[ci]).localeCompare(String(c[ci]), 'es');
    return r * dir;
  });
  b._sort = dir === 1 ? ci : null;
  // renumerar la primera columna si es la de posición
  if (/^(#|pos|posición|puesto)$/i.test(b.headers[0]) && ci !== 0) b.rows.forEach((r, i) => (r[0] = String(i + 1)));
}
function moveCol(b, ci, d) {
  const j = ci + d;
  if (j < 0 || j >= b.headers.length) return false;
  move(b.headers, ci, d);
  b.rows.forEach((r) => move(r, ci, d));
  return true;
}

function openLightbox(src) {
  const lb = el('div.lightbox', { role: 'dialog', 'aria-label': 'Imagen ampliada' }, el('img', { src, alt: '' }));
  const close = () => { lb.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  lb.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(lb);
}
