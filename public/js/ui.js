/* Utilidades de interfaz: creación de nodos, iconos, toasts, modales y selector de archivos */

/** Crea un elemento: el('div.clase#id', {attrs}, ...hijos) */
export function el(tag, attrs = {}, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const node = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ICONS = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  left: '<path d="M19 12H5M12 5l-7 7 7 7"/>',
  right: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  cards: '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  button: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
  gallery: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6"/>',
};
export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}
export function iconBtn(name, title, onClick, extraClass = '') {
  return el('button.icon-btn' + (extraClass ? '.' + extraClass : ''), { type: 'button', title, 'aria-label': title, onclick: onClick }, icon(name));
}

/* ---------- Toasts ---------- */
export function toast(msg, type = 'ok', ms = 2600) {
  const t = el('div.toast' + (type === 'err' ? '.err' : ''), { role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

/* ---------- Modales ---------- */
export function modal({ title, body, actions = [], wide = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const box = el('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const backdrop = el('div.modal-backdrop', {}, box);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  if (title) box.append(el('h2', {}, title));
  if (body) box.append(body);
  if (actions.length) {
    box.append(
      el('div.modal-actions', {}, actions.map((a) =>
        el('button.btn' + (a.variant ? '.' + a.variant : ''), { type: a.submit ? 'submit' : 'button', onclick: () => a.onClick && a.onClick(close) }, a.label)
      ))
    );
  }
  root.append(backdrop);
  setTimeout(() => box.querySelector('input, textarea, select, button')?.focus(), 30);
  return { close, box };
}

export function confirmDialog(message, okLabel = 'Aceptar') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: '¿Seguro?',
      body: el('p', {}, message),
      actions: [
        { label: 'Cancelar', variant: 'ghost', onClick: (c) => c() },
        { label: okLabel, variant: 'danger', onClick: (c) => { done = true; c(); } },
      ],
      onClose: () => resolve(done),
    });
    return m;
  });
}

/**
 * Formulario genérico en modal.
 * fields: [{key,label,type:'text'|'url'|'textarea'|'select'|'checkbox'|'number', options, help, full}]
 */
export function formDialog({ title, fields, values = {}, okLabel = 'Aplicar' }) {
  return new Promise((resolve) => {
    let result = null;
    const inputs = {};
    const grid = el('div.form-grid');
    for (const f of fields) {
      let input;
      const v = values[f.key] ?? '';
      if (f.type === 'textarea') input = el('textarea', { rows: f.rows || 4 }, v);
      else if (f.type === 'select') input = el('select', {}, f.options.map(([val, lab]) => el('option', { value: val, selected: String(v) === String(val) }, lab)));
      else if (f.type === 'checkbox') input = el('input', { type: 'checkbox', checked: !!v, style: { width: 'auto' } });
      else input = el('input', { type: f.type || 'text', value: v, placeholder: f.placeholder || '' });
      inputs[f.key] = input;
      grid.append(
        el('label.field' + (f.full !== false ? '.full' : ''), {}, el('span', {}, f.label), input, f.help ? el('small.help', {}, f.help) : null)
      );
    }
    const form = el('form', { onsubmit: (e) => { e.preventDefault(); submit(); } }, grid, el('button', { type: 'submit', hidden: true }));
    let closeFn;
    const submit = () => {
      result = {};
      for (const f of fields) result[f.key] = f.type === 'checkbox' ? inputs[f.key].checked : inputs[f.key].value;
      closeFn();
    };
    const m = modal({
      title,
      body: form,
      actions: [
        { label: 'Cancelar', variant: 'ghost', onClick: (c) => c() },
        { label: okLabel, onClick: () => submit() },
      ],
      onClose: () => resolve(result),
    });
    closeFn = m.close;
  });
}

/* ---------- Archivos ---------- */
export function pickFile(accept = 'image/*', multiple = false) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(multiple ? [...input.files] : input.files[0] || null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** Convierte enlaces de YouTube/Vimeo en URL de inserción; null si no es de esas plataformas */
export function embedUrl(url = '') {
  let m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0`;
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

export function escapeHTML(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Pega siempre como texto plano en elementos contenteditable */
export function plainPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
}

/** Convierte un elemento en editable de texto plano enlazado a obj[key] */
export function bindEditable(node, obj, key, onChange, { multiline = false, placeholder = '' } = {}) {
  node.contentEditable = 'true';
  node.spellcheck = true;
  node.dataset.editable = '';
  if (placeholder) node.dataset.placeholder = placeholder;
  node.addEventListener('paste', plainPaste);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); node.blur(); }
  });
  node.addEventListener('input', () => {
    obj[key] = node.innerText.replace(/\n$/, '');
    onChange && onChange();
  });
  // evitar que clics dentro de enlaces/botones editables naveguen
  node.addEventListener('click', (e) => e.preventDefault());
  return node;
}
