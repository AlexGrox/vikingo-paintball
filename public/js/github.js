/* ==========================================================================
   Cliente mínimo de la API de GitHub para editar la web publicada en GitHub Pages.
   Guarda archivos en el repositorio (cada guardado es un commit) y GitHub Actions
   vuelve a publicar la web automáticamente.
   La clave (fine-grained token) solo vive en el navegador del administrador.
   ========================================================================== */
import { GITHUB } from './config.js';

const API = 'https://api.github.com';
let token = null;

export function setGitHubToken(t) {
  token = t;
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API}/repos/${GITHUB.owner}/${GITHUB.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con GitHub. Revisa tu conexión.');
  }
  if (res.ok) return res.status === 204 ? null : res.json();
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* sin cuerpo */ }
  const err = new Error(
    res.status === 401 ? 'La clave de GitHub no es válida o ha caducado.'
    : res.status === 403 ? 'La clave no tiene permiso para modificar el repositorio.'
    : res.status === 404 ? 'No se encuentra el repositorio o la clave no tiene acceso a él.'
    : res.status === 409 || (res.status === 422 && /sha/i.test(msg))
      ? 'El contenido cambió en GitHub mientras editabas (¿otra persona o pestaña?). Copia tus cambios, recarga y vuelve a intentarlo.'
    : `GitHub respondió con un error (${res.status}). ${msg}`
  );
  err.status = res.status;
  throw err;
}

/** Comprueba que la clave puede escribir en el repositorio */
export async function checkAccess() {
  const repo = await request('');
  if (!repo.permissions || !repo.permissions.push) {
    throw new Error('La clave no tiene permiso de escritura (Contents: Read and write) en el repositorio.');
  }
  return true;
}

/** Lee un archivo de texto del repositorio: { text, sha } */
export async function getTextFile(path) {
  const r = await request(`/contents/${encodePath(path)}?ref=${encodeURIComponent(GITHUB.branch)}`);
  let b64 = r.content;
  if (!b64) b64 = (await request(`/git/blobs/${r.sha}`)).content; // archivos de más de 1 MB
  return { text: b64ToText(b64), sha: r.sha };
}

/** Crea o actualiza un archivo. Devuelve el nuevo sha. */
export async function putFile(path, base64, message, sha) {
  const r = await request(`/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: { message, content: base64, branch: GITHUB.branch, ...(sha ? { sha } : {}) },
  });
  return r.content.sha;
}

/* ---------- base64 con UTF-8 y binarios ---------- */
function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export const textToB64 = (s) => bytesToB64(new TextEncoder().encode(s));
export async function fileToB64(file) {
  return bytesToB64(new Uint8Array(await file.arrayBuffer()));
}
