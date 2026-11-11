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
  if (data.action === 'start') return out(start(data));
  if (data.action === 'claim') return out(claim(data));
  return out({ ok: false, error: 'Acción desconocida.' });
}

/* ---------- permiso de partida ---------- */
function start(d) {
  const deviceId = String(d.deviceId || '').slice(0, 20);
  const last = deviceId && lastWin(getSheet().getDataRange().getValues().slice(1), (r) => r[10] === deviceId);
  if (last) return { ok: false, error: 'Ya ganaste un voucher esta semana. Podés volver a jugar desde el ' + fmt(nextPlay(last), 'dd/MM') + '.' };
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('t_' + token, String(Date.now()), 21600); // vale 6 horas
  return { ok: true, token: token };
}

/* ---------- reclamar el voucher ---------- */
function claim(d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'Revisá el e-mail: parece que le falta algo.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cache = CacheService.getScriptCache();
    const started = Number(cache.get('t_' + d.token));
    if (!started) return { ok: false, error: 'La partida venció o no es válida. Volvé a intentarlo desde la web.' };
    if (Date.now() - started < CONFIG.MIN_SEGUNDOS * 1000) return { ok: false, error: 'Partida no válida.' };

    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    const test = d.test === true;
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
      now, code, email, CONFIG.PREMIO, vence,
      Number(d.hits) || '', Number(d.seconds) || '', String(d.device || '').slice(0, 20),
      test ? 'PRUEBA' : 'Pendiente', new Date(started), String(d.deviceId || '').slice(0, 20),
    ]);
    cache.remove('t_' + d.token); // cada partida da un solo voucher

    sendVoucher(email, code, vence, test);
    notifyOwner(email, code, d, test);
    return { ok: true, code: code };
  } finally {
    lock.releaseLock();
  }
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

function fmt(d, pattern) {
  return Utilities.formatDate(d, CONFIG.ZONA, pattern);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecutalo una vez a mano (botón ▶) para crear la hoja y autorizar el envío de e-mails. */
function prepararHoja() {
  getSheet();
  Logger.log('Hoja lista. Avisos a: ' + (CONFIG.AVISAR_A || Session.getEffectiveUser().getEmail()));
}
