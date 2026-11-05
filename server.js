/* ==========================================================================
   Vikingo Paintball — servidor
   - Sirve la web estática (carpeta /public)
   - API de contenido editable (data/content.json) con copias de seguridad
   - Login de administrador (contraseña con scrypt, tokens en memoria)
   - Subida de imágenes y vídeos (public/uploads)
   - Recepción y gestión de reservas (data/reservas.json)
   ========================================================================== */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const defaultContent = require('./server/default-content');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const RESERVAS_FILE = path.join(DATA_DIR, 'reservas.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 h
const MAX_BACKUPS = 30;

for (const dir of [DATA_DIR, BACKUP_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

/* ---------- utilidades de ficheros ---------- */
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJSONAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

if (!fs.existsSync(CONTENT_FILE)) writeJSONAtomic(CONTENT_FILE, defaultContent);
if (!fs.existsSync(RESERVAS_FILE)) writeJSONAtomic(RESERVAS_FILE, []);

/* ---------- autenticación ---------- */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(password, auth) {
  if (!auth || typeof password !== 'string') return false;
  const { hash } = hashPassword(password, auth.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(auth.hash, 'hex'));
}
if (!fs.existsSync(AUTH_FILE)) {
  const initial = process.env.ADMIN_PASSWORD || 'vikingo';
  writeJSONAtomic(AUTH_FILE, hashPassword(initial));
  console.log('\n[auth] Contraseña de administrador inicial: "' + initial + '"');
  console.log('[auth] Cámbiala desde la web (Panel de edición > Contraseña).\n');
}

const tokens = new Map(); // token -> expiry
function issueToken() {
  const t = crypto.randomBytes(32).toString('hex');
  tokens.set(t, Date.now() + TOKEN_TTL_MS);
  return t;
}
function requireAuth(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const exp = tokens.get(token);
  if (!exp || exp < Date.now()) {
    tokens.delete(token);
    return res.status(401).json({ error: 'No autorizado' });
  }
  req.token = token;
  next();
}

/* Límite simple de intentos por IP */
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.n = 0;
      entry.reset = now + windowMs;
    }
    entry.n++;
    hits.set(key, entry);
    if (entry.n > max) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    next();
  };
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

/* Contenido */
app.get('/api/content', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readJSON(CONTENT_FILE, defaultContent));
});

app.put('/api/content', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.sections || !body.site) {
    return res.status(400).json({ error: 'Contenido no válido' });
  }
  // copia de seguridad de la versión anterior
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(CONTENT_FILE, path.join(BACKUP_DIR, `content-${stamp}.json`));
    const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('content-')).sort();
    while (backups.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, backups.shift()));
  } catch (e) {
    console.warn('[backup] No se pudo crear la copia:', e.message);
  }
  body.updatedAt = new Date().toISOString();
  writeJSONAtomic(CONTENT_FILE, body);
  res.json({ ok: true, updatedAt: body.updatedAt });
});

/* Auth */
app.post('/api/login', rateLimiter(10, 10 * 60 * 1000), (req, res) => {
  const auth = readJSON(AUTH_FILE, null);
  if (!checkPassword(req.body && req.body.password, auth)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  res.json({ token: issueToken() });
});
app.post('/api/logout', requireAuth, (req, res) => {
  tokens.delete(req.token);
  res.json({ ok: true });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));
app.post('/api/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const auth = readJSON(AUTH_FILE, null);
  if (!checkPassword(current, auth)) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  if (typeof next !== 'string' || next.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  writeJSONAtomic(AUTH_FILE, hashPassword(next));
  // invalidar el resto de sesiones
  for (const t of tokens.keys()) if (t !== req.token) tokens.delete(t);
  res.json({ ok: true });
});

/* Subidas */
const ALLOWED = /^(image\/(png|jpe?g|gif|webp|svg\+xml|avif)|video\/(mp4|webm|ogg|quicktime))$/;
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
      const base = path
        .basename(file.originalname, path.extname(file.originalname))
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)
        .replace(/^-|-$/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base || 'archivo'}${ext}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.test(file.mimetype)),
});
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});

/* Reservas */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
app.post('/api/reservas', rateLimiter(8, 60 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  if (b.web) return res.json({ ok: true }); // honeypot anti-spam
  const reserva = {
    id: crypto.randomUUID(),
    creada: new Date().toISOString(),
    estado: 'pendiente',
    nombre: str(b.nombre, 120),
    email: str(b.email, 160),
    telefono: str(b.telefono, 40),
    fecha: str(b.fecha, 20),
    hora: str(b.hora, 10),
    jugadores: Math.max(1, Math.min(200, parseInt(b.jugadores, 10) || 1)),
    modalidad: str(b.modalidad, 120),
    comentarios: str(b.comentarios, 2000),
  };
  if (!reserva.nombre || (!reserva.email && !reserva.telefono) || !reserva.fecha) {
    return res.status(400).json({ error: 'Faltan datos: nombre, fecha y un email o teléfono.' });
  }
  const list = readJSON(RESERVAS_FILE, []);
  list.unshift(reserva);
  writeJSONAtomic(RESERVAS_FILE, list);
  console.log(`[reserva] ${reserva.fecha} ${reserva.hora} — ${reserva.nombre} (${reserva.jugadores} jugadores)`);
  res.json({ ok: true });
});
app.get('/api/reservas', requireAuth, (req, res) => res.json(readJSON(RESERVAS_FILE, [])));
app.patch('/api/reservas/:id', requireAuth, (req, res) => {
  const list = readJSON(RESERVAS_FILE, []);
  const r = list.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'No encontrada' });
  if (['pendiente', 'confirmada', 'cancelada'].includes(req.body.estado)) r.estado = req.body.estado;
  writeJSONAtomic(RESERVAS_FILE, list);
  res.json(r);
});
app.delete('/api/reservas/:id', requireAuth, (req, res) => {
  const list = readJSON(RESERVAS_FILE, []).filter((x) => x.id !== req.params.id);
  writeJSONAtomic(RESERVAS_FILE, list);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

/* Estáticos */
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, file) => {
      if (file.includes(path.sep + 'uploads' + path.sep)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else res.set('Cache-Control', 'no-cache');
    },
  })
);
// Rutas sin extensión → la web; archivos inexistentes (.glb, .png…) → 404 real
app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('No encontrado');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Archivo demasiado grande' : 'Error del servidor' });
});

app.listen(PORT, () => console.log(`Vikingo Paintball en http://localhost:${PORT}`));
