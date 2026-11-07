/* Estado global: contenido, sesión de administrador y guardado.
   Dos modos, detectados automáticamente:
   - 'server': con `node server.js` (pruebas en el PC). Contraseña, subidas y reservas por la API local.
   - 'static': web publicada en GitHub Pages. El contenido se lee de content.json y, al guardar,
     se escribe en el repositorio con la API de GitHub (la web se republica sola). */
import { GITHUB, MAX_UPLOAD_MB } from './config.js';
import { setGitHubToken, checkAccess, getTextFile, putFile, textToB64, fileToB64 } from './github.js';
import { setPreview } from './media.js';

const TOKEN_KEY = 'vp_token'; // sesión del servidor local
const GH_KEY = 'vp_gh_token'; // clave de GitHub (modo estático)

const listeners = new Set();
export const store = {
  content: null,
  mode: null, // 'server' | 'static'
  token: safeGet(TOKEN_KEY),
  ghToken: safeGet(GH_KEY),
  ghSha: null, // versión de content.json en GitHub sobre la que se edita
  isAdmin: false,
  editing: false,
  dirty: false,
};

function safeGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(type, detail) {
  for (const fn of listeners) fn(type, detail);
}

export function markDirty() {
  if (!store.dirty) {
    store.dirty = true;
    emit('dirty', true);
  }
}

/** Rutas antiguas absolutas (/img/…) → relativas, para funcionar en cualquier dominio o subcarpeta */
function normalize(content) {
  return JSON.parse(JSON.stringify(content).replace(/(["'(])\/(img|uploads|models)\//g, '$1$2/'));
}

/* ---------- API del servidor local ---------- */
async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (auth && store.token) headers.Authorization = 'Bearer ' + store.token;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) {
    setToken(null);
    emit('auth', false);
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function setToken(t) {
  store.token = t;
  store.isAdmin = !!t;
  safeSet(TOKEN_KEY, t);
}
function setGhToken(t) {
  store.ghToken = t;
  store.isAdmin = !!t;
  setGitHubToken(t);
  safeSet(GH_KEY, t);
}

/* ---------- contenido ---------- */
async function detectMode() {
  // el servidor local solo existe al probar en el PC: en la web publicada no se consulta
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.port === '8090') {
    store.mode = 'static';
    return null;
  }
  try {
    const res = await fetch('api/content', { cache: 'no-store' });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
      store.mode = 'server';
      return res.json();
    }
  } catch { /* sin servidor */ }
  store.mode = 'static';
  return null;
}

async function loadFromGitHub() {
  const { text, sha } = await getTextFile(GITHUB.contentPath);
  store.ghSha = sha;
  return JSON.parse(text);
}

export async function loadContent() {
  let data = null;
  if (!store.mode) data = await detectMode();
  if (store.mode === 'server') {
    data = data || (await api('api/content'));
  } else if (store.isAdmin) {
    data = await loadFromGitHub(); // el administrador edita siempre la última versión del repositorio
  } else {
    const res = await fetch('content.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('No se encontró content.json');
    data = await res.json();
  }
  store.content = normalize(data);
  store.dirty = false;
  return store.content;
}

export async function saveContent() {
  if (store.mode === 'server') {
    const res = await api('api/content', { method: 'PUT', body: store.content, auth: true });
    store.dirty = false;
    emit('dirty', false);
    return res;
  }
  store.content.updatedAt = new Date().toISOString();
  const json = JSON.stringify(store.content, null, 2) + '\n';
  store.ghSha = await putFile(GITHUB.contentPath, textToB64(json), 'Actualizar contenido desde la web', store.ghSha);
  store.dirty = false;
  emit('dirty', false);
  return { ok: true, published: 'pending' };
}

export async function discardChanges() {
  await loadContent();
  emit('dirty', false);
  emit('content');
}

/* ---------- sesión ---------- */
export async function checkSession() {
  if (store.mode === 'server') {
    if (!store.token) return false;
    try {
      await api('api/me', { auth: true });
      store.isAdmin = true;
    } catch {
      setToken(null);
    }
    return store.isAdmin;
  }
  if (!store.ghToken) return false;
  setGitHubToken(store.ghToken);
  try {
    await checkAccess();
    store.isAdmin = true;
    await loadContent(); // versión más reciente del repositorio
  } catch {
    setGhToken(null); // clave caducada o revocada
  }
  return store.isAdmin;
}

/** Inicia sesión: contraseña (servidor local) o clave de GitHub (web publicada) */
export async function login(secret) {
  if (store.mode === 'server') {
    const { token } = await api('api/login', { method: 'POST', body: { password: secret } });
    setToken(token);
  } else {
    const t = (secret || '').trim();
    if (!t) throw new Error('Pega la clave de GitHub');
    setGitHubToken(t);
    await checkAccess();
    setGhToken(t);
    await loadContent();
    emit('content');
  }
  emit('auth', true);
}

export async function logout() {
  if (store.mode === 'server') {
    try { await api('api/logout', { method: 'POST', auth: true }); } catch { /* da igual */ }
    setToken(null);
  } else {
    setGhToken(null);
  }
  store.editing = false;
  emit('auth', false);
}

export const changePassword = (current, next) => api('api/password', { method: 'POST', body: { current, next }, auth: true });

/* ---------- subidas ---------- */
function uploadName(file) {
  const dot = file.name.lastIndexOf('.');
  const ext = (dot > 0 ? file.name.slice(dot) : '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const base = (dot > 0 ? file.name.slice(0, dot) : file.name)
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base || 'archivo'}${ext}`;
}

export async function uploadFile(file, onProgress) {
  if (store.mode === 'static') {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      throw new Error(`El archivo supera ${MAX_UPLOAD_MB} MB. Para vídeos, súbelos a YouTube y pega el enlace.`);
    }
    if (!/^(image|video)\//.test(file.type)) throw new Error('Tipo de archivo no permitido');
    const name = uploadName(file);
    onProgress && onProgress(0.2);
    await putFile(`${GITHUB.uploadsDir}/${name}`, await fileToB64(file), `Subir ${file.name}`);
    onProgress && onProgress(1);
    const url = `uploads/${name}`;
    setPreview(url, file); // se ve al momento aunque GitHub Pages tarde en publicarla
    return { url, type: file.type };
  }
  // servidor local: XHR para mostrar progreso en vídeos grandes
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/upload');
    xhr.setRequestHeader('Authorization', 'Bearer ' + store.token);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'No se pudo subir el archivo'));
    };
    xhr.onerror = () => reject(new Error('Error de red al subir'));
    xhr.send(fd);
  });
}

/* ---------- reservas (solo servidor local; en la web publicada se reservará por otra vía) ---------- */
export const sendReserva = (data) => api('api/reservas', { method: 'POST', body: data });
export const getReservas = () => api('api/reservas', { auth: true });
export const updateReserva = (id, estado) => api('api/reservas/' + id, { method: 'PATCH', body: { estado }, auth: true });
export const deleteReserva = (id) => api('api/reservas/' + id, { method: 'DELETE', auth: true });

export const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
