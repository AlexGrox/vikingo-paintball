/* Estado global: contenido, sesión de administrador y llamadas a la API */
const TOKEN_KEY = 'vp_token';

const listeners = new Set();
export const store = {
  content: null,
  token: safeGet(TOKEN_KEY),
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

async function api(path, { method = 'GET', body, auth = false, raw = false } = {}) {
  const headers = {};
  if (auth && store.token) headers.Authorization = 'Bearer ' + store.token;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const data = raw ? res : await res.json().catch(() => ({}));
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

export async function loadContent() {
  store.content = await api('/api/content');
  store.dirty = false;
  return store.content;
}

export async function saveContent() {
  const res = await api('/api/content', { method: 'PUT', body: store.content, auth: true });
  store.dirty = false;
  emit('dirty', false);
  return res;
}

export async function discardChanges() {
  await loadContent();
  emit('dirty', false);
  emit('content');
}

export async function checkSession() {
  if (!store.token) return false;
  try {
    await api('/api/me', { auth: true });
    store.isAdmin = true;
  } catch {
    setToken(null);
  }
  return store.isAdmin;
}

export async function login(password) {
  const { token } = await api('/api/login', { method: 'POST', body: { password } });
  setToken(token);
  emit('auth', true);
}

export async function logout() {
  try { await api('/api/logout', { method: 'POST', auth: true }); } catch { /* da igual */ }
  setToken(null);
  store.editing = false;
  emit('auth', false);
}

export const changePassword = (current, next) => api('/api/password', { method: 'POST', body: { current, next }, auth: true });

export async function uploadFile(file, onProgress) {
  // XHR para poder mostrar progreso en vídeos grandes
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
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

export const sendReserva = (data) => api('/api/reservas', { method: 'POST', body: data });
export const getReservas = () => api('/api/reservas', { auth: true });
export const updateReserva = (id, estado) => api('/api/reservas/' + id, { method: 'PATCH', body: { estado }, auth: true });
export const deleteReserva = (id) => api('/api/reservas/' + id, { method: 'DELETE', auth: true });

export const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
