/* ==========================================================================
   Registro de vouchers de Vikingo Paintball (Google Apps Script)
   --------------------------------------------------------------------------
   Va pegado en una hoja de cálculo de Google (Extensiones → Apps Script).
   - Al empezar el juego, la web pide un permiso de partida (queda anotada la hora).
     Se niega si ese dispositivo ganó un voucher en los últimos 7 días.
   - Al ganar y dejar el e-mail, comprueba que el permiso sea válido, que la partida
     haya durado lo razonable, que ni ese e-mail ni ese dispositivo hayan ganado en
     los últimos 7 días y que no se haya superado el máximo diario.
   - Genera un código único (VK-XXXXXX), lo anota en la hoja «Vouchers», envía el voucher
     al jugador y te avisa a vos por e-mail.
   La hoja es tu registro: cuando alguien venga con su código, lo buscás y cambiás
   «Estado» a «Canjeado».
   - Botón de arrepentimiento: cada solicitud queda en la hoja «Arrepentimientos» con
     un código (AR-XXXXXX) que se le envía al cliente; a vos te llega un aviso.
   - Login con Google (si CONFIG.GOOGLE_CLIENT_ID tiene el ID de cliente): para jugar hay que
     entrar con una cuenta de Google; las oportunidades del día se cuentan por cuenta en la
     hoja «Partidas» y el voucher se envía a esa cuenta.
   - Pedidos de la tienda: el total se recalcula con los precios publicados en la web
     (content.json), el pedido queda en la hoja «Pedidos» con un código (PD-XXXXXX), el
     cliente recibe la confirmación y a vos te llega el pedido. La hoja «Productos» copia
     la lista de la tienda (los precios se cambian desde la web).
   ========================================================================== */

const CONFIG = {
  HOJA: 'Vouchers',
  PREMIO: 'Voucher por 100 disparos',
  VALIDEZ_DIAS: 30,              // días para usarlo desde que lo gana
  ESPERA_DIAS: 7,                // quien gana no puede volver a ganar hasta pasados estos días
  CONDICIONES: 'Presentá este código el día de tu partida. Válido para una persona y un solo uso.',
  AVISAR_A: '',                  // a quién avisar de cada ganador (vacío = a la cuenta dueña del script)
  WHATSAPP: '+54 9 351 763-0322',
  RESERVAS: 'https://www.vikingo-paintball.com/reservas/',
  MIN_SEGUNDOS: 5,               // una partida ganada más rápido que esto no es creíble
  MAX_POR_DIA: 30,               // tope de vouchers por día (frena abusos)
  ZONA: 'America/Argentina/Cordoba',
  HOJA_ARREPENTIMIENTOS: 'Arrepentimientos',
  MAX_ARREPENTIMIENTOS_POR_DIA: 15, // frena abusos (cada solicitud envía dos e-mails)
  // Login con Google antes de jugar: pegá acá el «ID de cliente» de Google Cloud
  // (termina en .apps.googleusercontent.com). Vacío = se juega sin login, como antes.
  GOOGLE_CLIENT_ID: '1002465928516-op1k286mjvh9h5vfde0n41dcmnpnrod5.apps.googleusercontent.com',
  INTENTOS_POR_DIA: 3,           // oportunidades por cuenta de Google y por día (con login)
  HOJA_PARTIDAS: 'Partidas',     // una fila por partida empezada (se limpia sola: guarda 8 días)
  // Tienda
  SITIO: 'https://www.vikingo-paintball.com', // de acá se leen los productos y precios publicados
  HOJA_PEDIDOS: 'Pedidos',
  HOJA_PRODUCTOS: 'Productos',   // copia de la tienda de la web (se actualiza sola)
  MAX_PEDIDOS_POR_DIA: 30,       // frena abusos (cada pedido envía dos e-mails)
  MAX_UNIDADES: 50,              // por producto en un pedido
};

const COLUMNAS = ['Fecha', 'Código', 'E-mail', 'Premio', 'Vence', 'Aciertos', 'Segundos de juego', 'Dispositivo', 'Estado', 'Inicio de la partida', 'ID del dispositivo'];
// columnas (desde 0): 0 fecha · 1 código · 2 e-mail · 8 estado · 10 ID del dispositivo

function doGet() {
  return out({ ok: true, servicio: 'Vouchers Vikingo Paintball' });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'Solicitud no válida.' });
  }
  if (data.action === 'hello') return out({ ok: true, clientId: CONFIG.GOOGLE_CLIENT_ID || '', tries: CONFIG.INTENTOS_POR_DIA });
  if (data.action === 'login') return out(login(data));
  if (data.action === 'start') return out(start(data));
  if (data.action === 'claim') return out(claim(data));
  if (data.action === 'arrepentimiento') return out(arrepentimiento(data));
  if (data.action === 'pedido') return out(pedido(data));
  return out({ ok: false, error: 'Acción desconocida.' });
}

/* ---------- login con Google ---------- */
/** Comprueba con Google que el «credential» del botón sea auténtico y de esta web */
function verifyGoogle(idToken) {
  if (!CONFIG.GOOGLE_CLIENT_ID || !idToken) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(idToken)), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const t = JSON.parse(res.getContentText());
  const okIss = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  const verified = t.email_verified === true || t.email_verified === 'true';
  if (t.aud !== CONFIG.GOOGLE_CLIENT_ID || !okIss || !verified || Number(t.exp) * 1000 < Date.now() || !t.email) return null;
  return { email: String(t.email).toLowerCase(), name: String(t.given_name || t.name || '').slice(0, 60) };
}

/** Cuántas partidas empezó hoy esa cuenta */
function triesToday(email) {
  const today = fmt(new Date(), 'yyyy-MM-dd');
  return getPlaysSheet().getDataRange().getValues().slice(1)
    .filter((r) => r[0] instanceof Date && fmt(r[0], 'yyyy-MM-dd') === today && String(r[1]).toLowerCase() === email).length;
}

/** Estado de juego de una cuenta: oportunidades que le quedan hoy y si ganó esta semana */
function playerStatus(email) {
  const last = lastWin(getSheet().getDataRange().getValues().slice(1), (r) => String(r[2]).toLowerCase() === email);
  return {
    left: Math.max(0, CONFIG.INTENTOS_POR_DIA - triesToday(email)),
    nextPlay: last ? fmt(nextPlay(last), 'dd/MM') : '',
  };
}

function login(d) {
  const user = verifyGoogle(d.idToken);
  if (!user) return { ok: false, error: 'No se pudo verificar tu cuenta de Google. Probá de nuevo.' };
  const sid = Utilities.getUuid();
  CacheService.getScriptCache().put('s_' + sid, user.email, 21600); // la sesión vale 6 horas
  const st = playerStatus(user.email);
  return { ok: true, sid: sid, email: user.email, name: user.name, left: st.left, nextPlay: st.nextPlay };
}

/* ---------- permiso de partida ---------- */
function start(d) {
  const cache = CacheService.getScriptCache();
  let email = '';
  if (CONFIG.GOOGLE_CLIENT_ID) {
    // con login: la cuenta manda (el modo incógnito o borrar datos no da más oportunidades)
    email = cache.get('s_' + d.sid) || '';
    if (!email) return { ok: false, error: 'Tu sesión venció. Volvé a entrar con Google.', relogin: true };
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const st = playerStatus(email);
      if (email === ownerEmail()) st.nextPlay = '', st.left = Math.max(st.left, 1); // vos podés probar sin límites
      if (st.nextPlay) return { ok: false, error: 'Ya ganaste un voucher esta semana. Podés volver a jugar desde el ' + st.nextPlay + '.' };
      if (st.left <= 0) return { ok: false, error: 'Ya usaste tus ' + CONFIG.INTENTOS_POR_DIA + ' oportunidades de hoy. Volvé mañana.', left: 0 };
      getPlaysSheet().appendRow([new Date(), cell(email), cell(String(d.deviceId || '').slice(0, 20))]);
      const token = Utilities.getUuid();
      cache.put('t_' + token, JSON.stringify({ at: Date.now(), email: email }), 21600); // vale 6 horas
      return { ok: true, token: token, left: st.left - 1 };
    } finally {
      lock.releaseLock();
    }
  }
  const deviceId = String(d.deviceId || '').slice(0, 20);
  const last = deviceId && lastWin(getSheet().getDataRange().getValues().slice(1), (r) => r[10] === deviceId);
  if (last) return { ok: false, error: 'Ya ganaste un voucher esta semana. Podés volver a jugar desde el ' + fmt(nextPlay(last), 'dd/MM') + '.' };
  const token = Utilities.getUuid();
  cache.put('t_' + token, JSON.stringify({ at: Date.now(), email: '' }), 21600); // vale 6 horas
  return { ok: true, token: token };
}

function getPlaysSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HOJA_PARTIDAS);
  if (!sh) sh = ss.insertSheet(CONFIG.HOJA_PARTIDAS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Fecha', 'E-mail', 'ID del dispositivo']);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8b13a');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
  }
  return sh;
}

/** Borra las partidas de hace más de 8 días (solo sirven para contar las oportunidades del día) */
function limpiarPartidas() {
  const sh = getPlaysSheet();
  const last = sh.getLastRow();
  if (last < 2) return;
  const limite = Date.now() - 8 * 86400000;
  const fechas = sh.getRange(2, 1, last - 1, 1).getValues();
  let viejas = 0;
  while (viejas < fechas.length && fechas[viejas][0] instanceof Date && fechas[viejas][0].getTime() < limite) viejas++;
  if (viejas) sh.deleteRows(2, viejas);
}

/* ---------- reclamar el voucher ---------- */
function claim(d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cache = CacheService.getScriptCache();
    let t = null;
    try { t = JSON.parse(cache.get('t_' + d.token) || 'null'); } catch (err) { t = null; }
    if (typeof t === 'number') t = { at: t, email: '' }; // permisos emitidos antes del login
    const started = t && Number(t.at);
    if (!started) return { ok: false, error: 'La partida venció o no es válida. Volvé a intentarlo desde la web.' };
    // con login, el voucher va a la cuenta de Google con la que se jugó (no a un e-mail escrito a mano)
    const email = t.email || String(d.email || '').trim().toLowerCase();
    if (CONFIG.GOOGLE_CLIENT_ID && !t.email) return { ok: false, error: 'La partida no es válida. Volvé a intentarlo desde la web.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Revisá el e-mail: parece que le falta algo.' };
    if (Date.now() - started < CONFIG.MIN_SEGUNDOS * 1000) return { ok: false, error: 'Partida no válida.' };

    // las pruebas (sin límites) solo valen con el e-mail de la cuenta dueña: así nadie puede saltarse las reglas
    const test = d.test === true;
    if (test && email !== ownerEmail()) return { ok: false, error: 'Para probar, usá el e-mail de la cuenta dueña del registro.' };

    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    if (!test) {
      const deviceId = String(d.deviceId || '').slice(0, 20);
      const last = lastWin(rows, (r) => String(r[2]).toLowerCase() === email || (deviceId && r[10] === deviceId));
      if (last) {
        return { ok: false, error: 'Ese e-mail ya ganó un voucher esta semana. Podés volver a ganar desde el ' + fmt(nextPlay(last), 'dd/MM') + '.' };
      }
      const today = fmt(new Date(), 'yyyy-MM-dd');
      const todayCount = rows.filter((r) => r[0] instanceof Date && fmt(r[0], 'yyyy-MM-dd') === today && r[8] !== 'PRUEBA').length;
      if (todayCount >= CONFIG.MAX_POR_DIA) return { ok: false, error: 'Por hoy se agotaron los vouchers. Probá mañana.' };
    }

    const used = new Set(rows.map((r) => r[1]));
    let code;
    do code = 'VK-' + randomCode(6); while (used.has(code));

    const now = new Date();
    const vence = new Date(now.getTime() + CONFIG.VALIDEZ_DIAS * 86400000);
    sheet.appendRow([
      now, code, cell(email), CONFIG.PREMIO, vence,
      Number(d.hits) || '', Number(d.seconds) || '', cell(String(d.device || '').slice(0, 20)),
      test ? 'PRUEBA' : 'Pendiente', new Date(started), cell(String(d.deviceId || '').slice(0, 20)),
    ]);
    cache.remove('t_' + d.token); // cada partida da un solo voucher

    sendVoucher(email, code, vence, test);
    notifyOwner(email, code, d, test);
    return { ok: true, code: code };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- botón de arrepentimiento ---------- */
const NL = String.fromCharCode(10); // salto de línea en los e-mails
const COLUMNAS_ARR = ['Fecha', 'Código', 'Nombre', 'E-mail', 'Teléfono', 'Fecha de la reserva o compra', 'Detalle', 'Estado'];

function arrepentimiento(d) {
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const nombre = clip(d.nombre, 120), email = clip(d.email, 160).toLowerCase(), detalle = clip(d.detalle, 1500);
  if (!nombre || !detalle) return { ok: false, error: 'Completá tu nombre y qué querés cancelar.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Revisá el e-mail: parece que le falta algo.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getRegretSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    const today = fmt(new Date(), 'yyyy-MM-dd');
    const todayCount = rows.filter((r) => r[0] instanceof Date && fmt(r[0], 'yyyy-MM-dd') === today).length;
    if (todayCount >= CONFIG.MAX_ARREPENTIMIENTOS_POR_DIA) return { ok: false, error: 'No se pudo registrar. Escribinos por WhatsApp.' };

    const used = new Set(rows.map((r) => r[1]));
    let code;
    do code = 'AR-' + randomCode(6); while (used.has(code));
    const now = new Date();
    sheet.appendRow([now, code, cell(nombre), cell(email), cell(clip(d.telefono, 40)), cell(clip(d.fecha, 20)), cell(detalle), 'Pendiente']);

    const resumen = ['Nombre: ' + nombre, 'E-mail: ' + email,
      d.telefono ? 'Teléfono: ' + clip(d.telefono, 40) : '',
      d.fecha ? 'Fecha de la reserva o compra: ' + clip(d.fecha, 20) : '',
      'Detalle: ' + detalle].filter(String).join(NL);
    // al cliente no se le repite lo que escribió: así nadie puede usar el formulario para mandar
    // mensajes propios (enlaces, estafas) a otras personas desde tu cuenta
    MailApp.sendEmail({
      to: email,
      subject: 'Recibimos tu solicitud de arrepentimiento: ' + code,
      body: ['Hola:', '',
        'Recibimos tu solicitud de arrepentimiento (revocación) en Vikingo Paintball Córdoba.', '',
        'Código de identificación: ' + code, 'Fecha: ' + fmt(now, 'dd/MM/yyyy HH:mm'), '',
        'Si no hiciste esta solicitud, ignorá este mensaje.', '',
        'Te vamos a contactar para completar la cancelación. Si tenés dudas, escribinos por WhatsApp al ' + CONFIG.WHATSAPP + '.', '',
        'Vikingo Paintball Córdoba'].join(NL),
      name: 'Vikingo Paintball',
    });
    const to = CONFIG.AVISAR_A || Session.getEffectiveUser().getEmail();
    if (to) {
      MailApp.sendEmail({
        to: to,
        subject: 'Botón de arrepentimiento: ' + code,
        body: ['Nueva solicitud de arrepentimiento.', '', 'Código: ' + code, resumen, '',
          'Queda anotada en la hoja «' + CONFIG.HOJA_ARREPENTIMIENTOS + '». Respondé al cliente y, cuando esté resuelta, cambiá «Estado» a «Resuelto».'].join(NL),
        replyTo: email,
      });
    }
    return { ok: true, code: code };
  } finally {
    lock.releaseLock();
  }
}

function getRegretSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HOJA_ARREPENTIMIENTOS);
  if (!sh) sh = ss.insertSheet(CONFIG.HOJA_ARREPENTIMIENTOS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNAS_ARR);
    sh.getRange(1, 1, 1, COLUMNAS_ARR.length).setFontWeight('bold').setBackground('#e8b13a');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
    const estados = SpreadsheetApp.newDataValidation().requireValueInList(['Pendiente', 'Resuelto', 'Rechazado'], true).build();
    sh.getRange('H2:H').setDataValidation(estados);
  }
  return sh;
}

/* ---------- tienda: pedidos ---------- */
const COLUMNAS_PED = ['Fecha', 'Código', 'Nombre', 'E-mail', 'Teléfono', 'Productos', 'Unidades', 'Total', 'Comentario', 'Estado'];
const COLUMNAS_PROD = ['Producto', 'Precio', 'Descripción', 'Sección', 'ID', 'Actualizado'];

function pedido(d) {
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const nombre = clip(d.nombre, 120), email = clip(d.email, 160).toLowerCase();
  const telefono = clip(d.telefono, 40), nota = clip(d.nota, 500);
  if (!nombre) return { ok: false, error: 'Completá tu nombre y apellido.' };
  if (!telefono) return { ok: false, error: 'Dejanos un teléfono para coordinar.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Revisá el e-mail: parece que le falta algo.' };

  // cantidades pedidas (se juntan si un producto viene repetido)
  const qty = {};
  (Array.isArray(d.items) ? d.items : []).slice(0, 40).forEach((it) => {
    const id = String((it && it.id) || '').slice(0, 40), q = Math.floor(Number(it && it.qty));
    if (id && q > 0) qty[id] = (qty[id] || 0) + q;
  });
  const ids = Object.keys(qty);
  if (!ids.length) return { ok: false, error: 'Elegí al menos un producto.' };
  if (ids.some((id) => qty[id] > CONFIG.MAX_UNIDADES)) return { ok: false, error: 'Para más de ' + CONFIG.MAX_UNIDADES + ' unidades de un producto, escribinos por WhatsApp.' };

  // precios publicados en la web: el total nunca sale de lo que manda el navegador
  let products;
  try { products = shopProducts(); } catch (err) { products = null; }
  if (!products) return { ok: false, error: 'No se pudo cargar la lista de productos. Probá de nuevo en un rato o escribinos por WhatsApp.' };
  const byId = {};
  products.forEach((p) => (byId[p.id] = p));
  if (ids.some((id) => !byId[id])) return { ok: false, error: 'Algún producto cambió o ya no está. Recargá la página y armá el pedido de nuevo.' };
  const lines = ids.map((id) => ({ title: byId[id].title, price: byId[id].price, qty: qty[id], subtotal: byId[id].price * qty[id] }));
  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const detalle = lines.map((l) => l.qty + ' × ' + l.title + ' (' + money(l.price) + ' c/u) = ' + money(l.subtotal)).join(NL);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let code;
  const now = new Date();
  try {
    const sheet = getOrdersSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    const today = fmt(now, 'yyyy-MM-dd');
    const todayCount = rows.filter((r) => r[0] instanceof Date && fmt(r[0], 'yyyy-MM-dd') === today).length;
    if (todayCount >= CONFIG.MAX_PEDIDOS_POR_DIA) return { ok: false, error: 'No se pudo registrar el pedido. Escribinos por WhatsApp.' };
    const used = new Set(rows.map((r) => r[1]));
    do code = 'PD-' + randomCode(6); while (used.has(code));
    sheet.appendRow([now, code, cell(nombre), cell(email), cell(telefono), cell(detalle), units, total, cell(nota), 'Pendiente']);
  } finally {
    lock.releaseLock();
  }
  try { syncProducts(products); } catch (err) { /* la copia de productos no frena el pedido */ }

  sendOrderToClient(email, code, lines, total, now);
  const to = CONFIG.AVISAR_A || Session.getEffectiveUser().getEmail();
  if (to) {
    MailApp.sendEmail({
      to: to,
      subject: 'Nuevo pedido de la tienda: ' + code + ' · ' + money(total),
      body: ['Nuevo pedido en la tienda de la web.', '',
        'Código: ' + code, 'Fecha: ' + fmt(now, 'dd/MM/yyyy HH:mm'), '',
        'Nombre: ' + nombre, 'E-mail: ' + email, 'Teléfono: ' + telefono, '',
        detalle, '', 'Unidades: ' + units, 'TOTAL: ' + money(total),
        nota ? NL + 'Comentario: ' + nota : '', '',
        'Queda anotado en la hoja «' + CONFIG.HOJA_PEDIDOS + '». Respondé al cliente (podés contestar este e-mail) y cambiá «Estado» cuando lo confirmes o entregues.'].join(NL),
      replyTo: email,
    });
  }
  return { ok: true, code: code, total: total, units: units };
}

/** Productos con precio de los bloques de tarjetas con «Pedidos online» activado */
function shopProducts() {
  const res = UrlFetchApp.fetch(CONFIG.SITIO + '/content.json?t=' + Date.now(), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return null;
  const content = JSON.parse(res.getContentText());
  const list = [];
  const sections = content.sections || {};
  (content.order || Object.keys(sections)).forEach((key) => {
    const sec = sections[key];
    ((sec && sec.blocks) || []).forEach((b) => {
      if (b.type !== 'cards' || !b.shop) return;
      (b.items || []).forEach((it) => {
        const price = parsePrice(it.tag);
        if (it.id && it.title && price) list.push({ id: String(it.id), title: String(it.title).slice(0, 120), price: price, text: String(it.text || '').slice(0, 300), section: String(sec.label || key) });
      });
    });
  });
  return list;
}

/** «$10.000» → 10000 (acepta 10.000 / 10,000 / 1.500,50), igual que la web */
function parsePrice(tag) {
  const m = String(tag || '').match(/\$\s*([\d.,]+)/);
  if (!m) return 0;
  let n = m[1].replace(/[.,]$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(n)) n = n.replace(/[.,]/g, '');
  else n = n.replace(/\./g, '').replace(',', '.');
  const price = Number(n);
  return isFinite(price) && price > 0 ? price : 0;
}

function money(n) {
  return '$' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Copia la lista de la tienda a la hoja «Productos» */
function syncProducts(products) {
  const sh = getProductsSheet();
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, COLUMNAS_PROD.length).clearContent();
  if (!products.length) return;
  const now = new Date();
  sh.getRange(2, 1, products.length, COLUMNAS_PROD.length)
    .setValues(products.map((p) => [cell(p.title), p.price, cell(p.text), cell(p.section), p.id, now]));
}

/** Ejecutalo a mano (botón ▶) si querés ver ya mismo los precios nuevos en la hoja «Productos» */
function actualizarProductos() {
  const products = shopProducts();
  if (!products) throw new Error('No se pudo leer la web (' + CONFIG.SITIO + ').');
  syncProducts(products);
  Logger.log('Productos actualizados: ' + products.length);
}

function getOrdersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HOJA_PEDIDOS);
  if (!sh) sh = ss.insertSheet(CONFIG.HOJA_PEDIDOS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNAS_PED);
    sh.getRange(1, 1, 1, COLUMNAS_PED.length).setFontWeight('bold').setBackground('#e8b13a');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('H:H').setNumberFormat('"$"#,##0');
    sh.getRange('F:F').setWrap(true);
    sh.setColumnWidth(6, 320);
    const estados = SpreadsheetApp.newDataValidation().requireValueInList(['Pendiente', 'Confirmado', 'Entregado', 'Cancelado'], true).build();
    sh.getRange('J2:J').setDataValidation(estados);
  }
  return sh;
}

function getProductsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HOJA_PRODUCTOS);
  if (!sh) sh = ss.insertSheet(CONFIG.HOJA_PRODUCTOS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNAS_PROD);
    sh.getRange(1, 1, 1, COLUMNAS_PROD.length).setFontWeight('bold').setBackground('#e8b13a');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('"$"#,##0');
    sh.getRange('F:F').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('A1').setNote('Esta hoja se actualiza sola con la tienda de la web. Para cambiar productos o precios, editalos desde la web: los cambios hechos acá se pisan.');
  }
  return sh;
}

function sendOrderToClient(email, code, lines, total, now) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // al cliente no se le repite lo que escribió (nombre, comentario): así nadie puede usar
  // el formulario para mandar mensajes propios a otras personas desde tu cuenta
  const rowsHtml = lines.map((l) =>
    '<tr><td style="padding:6px 4px;border-bottom:1px solid #4a3a28">' + l.qty + ' × ' + esc(l.title) + '</td>' +
    '<td style="padding:6px 4px;border-bottom:1px solid #4a3a28;text-align:right;white-space:nowrap">' + money(l.subtotal) + '</td></tr>').join('');
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#1a120b;color:#f3e6c8;border-radius:14px;padding:28px;border:2px solid #e8b13a">' +
    '<h1 style="margin:0 0 6px;color:#ffd34d;font-size:26px">Recibimos tu pedido</h1>' +
    '<p style="font-size:16px;margin:0 0 16px">Gracias por tu pedido en Vikingo Paintball Córdoba. Código: <b style="color:#ffd34d">' + code + '</b></p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px;color:#f3e6c8">' + rowsHtml +
    '<tr><td style="padding:10px 4px;font-weight:bold;color:#ffd34d">Total</td><td style="padding:10px 4px;text-align:right;font-weight:bold;color:#ffd34d">' + money(total) + '</td></tr></table>' +
    '<p style="font-size:15px;margin:16px 0 8px">Pronto te vamos a responder para confirmar tu pedido y coordinar la entrega. Los productos se retiran en el campo.</p>' +
    '<p style="font-size:14px;color:#bba98a;margin:0">WhatsApp: ' + CONFIG.WHATSAPP + ' · Si no hiciste este pedido, ignorá este mensaje.</p>' +
    '</div>';
  MailApp.sendEmail({
    to: email,
    subject: 'Recibimos tu pedido: ' + code,
    htmlBody: html,
    body: ['Hola:', '', 'Recibimos tu pedido en Vikingo Paintball Córdoba.', '',
      'Código: ' + code, 'Fecha: ' + fmt(now, 'dd/MM/yyyy HH:mm'), '',
      lines.map((l) => l.qty + ' × ' + l.title + ' = ' + money(l.subtotal)).join(NL), '',
      'Total: ' + money(total), '',
      'Pronto te vamos a responder para confirmar tu pedido y coordinar la entrega. Los productos se retiran en el campo.',
      'Si no hiciste este pedido, ignorá este mensaje.', '',
      'WhatsApp: ' + CONFIG.WHATSAPP, 'Vikingo Paintball Córdoba'].join(NL),
    name: 'Vikingo Paintball',
  });
}

/* ---------- e-mails ---------- */
function sendVoucher(email, code, vence, test) {
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#1a120b;color:#f3e6c8;border-radius:14px;padding:28px;border:2px solid #e8b13a">' +
    '<h1 style="margin:0 0 6px;color:#ffd34d;font-size:28px">¡Felicidades!</h1>' +
    '<p style="font-size:17px;margin:0 0 18px">Ganaste un <b>' + CONFIG.PREMIO.toLowerCase() + '</b> en Vikingo Paintball Córdoba.</p>' +
    '<div style="background:#2d2218;border:2px dashed #e8b13a;border-radius:10px;padding:18px;text-align:center;margin:0 0 18px">' +
    '<div style="font-size:13px;letter-spacing:2px;color:#bba98a">TU CÓDIGO</div>' +
    '<div style="font-size:34px;font-weight:bold;letter-spacing:4px;color:#ffd34d">' + code + '</div>' +
    '<div style="font-size:14px;color:#bba98a">Válido hasta el ' + fmt(vence, 'dd/MM/yyyy') + '</div></div>' +
    '<p style="font-size:15px;margin:0 0 14px">' + CONFIG.CONDICIONES + '</p>' +
    '<p style="margin:0 0 6px"><a href="' + CONFIG.RESERVAS + '" style="display:inline-block;background:#e8b13a;color:#1a120b;padding:12px 22px;border-radius:999px;font-weight:bold;text-decoration:none">Reservar mi partida</a></p>' +
    '<p style="font-size:14px;color:#bba98a;margin:14px 0 0">WhatsApp: ' + CONFIG.WHATSAPP + '</p>' +
    '</div>';
  MailApp.sendEmail({
    to: email,
    subject: (test ? '[PRUEBA] ' : '') + 'Tu voucher de Vikingo Paintball: ' + code,
    htmlBody: html,
    body: '¡Felicidades! Ganaste un ' + CONFIG.PREMIO.toLowerCase() + ' en Vikingo Paintball. Código: ' + code +
      '. Válido hasta el ' + fmt(vence, 'dd/MM/yyyy') + '. ' + CONFIG.CONDICIONES + ' Reservas: ' + CONFIG.RESERVAS,
    name: 'Vikingo Paintball',
  });
}

function notifyOwner(email, code, d, test) {
  const to = CONFIG.AVISAR_A || Session.getEffectiveUser().getEmail();
  if (!to) return;
  MailApp.sendEmail({
    to: to,
    subject: (test ? '[PRUEBA] ' : '') + 'Nuevo voucher ganado: ' + code,
    body: 'Código: ' + code + '\nE-mail: ' + email + '\nAciertos: ' + d.hits + '\nSegundos de juego: ' + d.seconds +
      '\nDispositivo: ' + d.device + '\n\nQueda anotado en la hoja «' + CONFIG.HOJA + '».',
  });
}

/* ---------- utilidades ---------- */
/** Fecha del último voucher (no de prueba) de los últimos ESPERA_DIAS que cumpla la condición */
function lastWin(rows, match) {
  const since = Date.now() - CONFIG.ESPERA_DIAS * 86400000;
  let last = null;
  rows.forEach((r) => {
    if (r[8] === 'PRUEBA' || !(r[0] instanceof Date) || r[0].getTime() < since || !match(r)) return;
    if (!last || r[0] > last) last = r[0];
  });
  return last;
}
function nextPlay(lastDate) {
  return new Date(lastDate.getTime() + CONFIG.ESPERA_DIAS * 86400000);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.HOJA);
  if (!sh) sh = ss.insertSheet(CONFIG.HOJA);
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNAS);
    sh.getRange(1, 1, 1, COLUMNAS.length).setFontWeight('bold').setBackground('#e8b13a');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('E:E').setNumberFormat('dd/MM/yyyy');
    sh.getRange('J:J').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    const estados = SpreadsheetApp.newDataValidation().requireValueInList(['Pendiente', 'Canjeado', 'Vencido', 'PRUEBA'], true).build();
    sh.getRange('I2:I').setDataValidation(estados);
  }
  return sh;
}

function randomCode(n) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para que no se confundan
  let s = '';
  for (let i = 0; i < n; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

/** Texto escrito por el visitante → celda de texto (un «=» al principio no se ejecuta como fórmula) */
function cell(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function ownerEmail() {
  return String(CONFIG.AVISAR_A || Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
}

function fmt(d, pattern) {
  return Utilities.formatDate(d, CONFIG.ZONA, pattern);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Pasa a «Vencido» los vouchers «Pendiente» cuya fecha de «Vence» ya pasó (no toca Canjeado ni PRUEBA). */
function marcarVencidos() {
  const sh = getSheet();
  const last = sh.getLastRow();
  if (last < 2) return;
  const rango = sh.getRange(2, 5, last - 1, 5); // columnas E (Vence) a I (Estado)
  const filas = rango.getValues();
  const ahora = new Date();
  let cambios = 0;
  filas.forEach((r, i) => {
    if (r[4] === 'Pendiente' && r[0] instanceof Date && r[0] < ahora) {
      sh.getRange(i + 2, 9).setValue('Vencido');
      cambios++;
    }
  });
  Logger.log('Vouchers marcados como vencidos: ' + cambios);
  limpiarPartidas(); // la revisión diaria también borra las partidas viejas
  try { actualizarProductos(); } catch (err) { Logger.log(err.message); } // y copia los precios de la tienda
}

/** Ejecutalo una vez a mano (botón ▶): revisa los vencimientos todos los días a la madrugada. */
function activarRevisionDiaria() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'marcarVencidos')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('marcarVencidos').timeBased().everyDays(1).atHour(3).inTimezone(CONFIG.ZONA).create();
  marcarVencidos();
  Logger.log('Listo: se revisa todos los días a las 3 de la mañana.');
}

/** Ejecutalo una vez a mano (botón ▶) para crear la hoja y autorizar el envío de e-mails. */
function prepararHoja() {
  getSheet();
  getRegretSheet();
  getPlaysSheet();
  getOrdersSheet();
  try { actualizarProductos(); } catch (err) { getProductsSheet(); Logger.log(err.message); }
  if (CONFIG.GOOGLE_CLIENT_ID) UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=x', { muteHttpExceptions: true }); // pide el permiso para consultar a Google
  Logger.log('Hoja lista. Avisos a: ' + (CONFIG.AVISAR_A || Session.getEffectiveUser().getEmail()));
}
