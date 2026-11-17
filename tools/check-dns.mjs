/* ==========================================================================
   Vigilancia del dominio (la corre GitHub todos los días, ver .github/workflows/dns-vigilancia.yml).
   Compara los registros DNS públicos de vikingo-paintball.com con los correctos y revisa que la
   web responda y que el dominio no esté por vencer. Si algo no coincide, termina con error
   y GitHub te avisa por e-mail.
   Si cambiás a propósito algún registro (por ejemplo, otro proveedor de correo), actualizá EXPECTED.
   ========================================================================== */
import { Resolver } from 'node:dns/promises';

const DOMAIN = 'vikingo-paintball.com';
const EXPECTED = {
  NS: ['ns-cloud-a1.googledomains.com', 'ns-cloud-a2.googledomains.com', 'ns-cloud-a3.googledomains.com', 'ns-cloud-a4.googledomains.com'],
  A: ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'], // GitHub Pages
  AAAA: ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153'],
  MX: ['smtp.google.com'], // Google Workspace
  WWW_CNAME: ['alexgrox.github.io'],
};
const WARN_DAYS = 45; // avisar si el dominio vence en menos de estos días

const problems = [];
const norm = (list) => [...new Set(list.map((x) => String(x).toLowerCase().replace(/\.$/, '')))].sort();
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

async function check(label, fn, expected) {
  // se pregunta a dos servidores públicos distintos (Google y Cloudflare)
  for (const server of ['8.8.8.8', '1.1.1.1']) {
    const r = new Resolver({ timeout: 8000, tries: 3 });
    r.setServers([server]);
    try {
      const got = await fn(r);
      if (!same(got, expected)) problems.push(`${label} (según ${server}): hay ${norm(got).join(', ') || 'nada'} — se esperaba ${norm(expected).join(', ')}`);
      else console.log(`OK  ${label} (${server})`);
    } catch (e) {
      problems.push(`${label} (según ${server}): no responde (${e.code || e.message})`);
    }
  }
}

await check('Servidores DNS (NS)', (r) => r.resolveNs(DOMAIN), EXPECTED.NS);
await check('Dirección IPv4 (A)', (r) => r.resolve4(DOMAIN), EXPECTED.A);
await check('Dirección IPv6 (AAAA)', (r) => r.resolve6(DOMAIN), EXPECTED.AAAA);
await check('Correo (MX)', async (r) => (await r.resolveMx(DOMAIN)).map((m) => m.exchange), EXPECTED.MX);
await check('www (CNAME)', (r) => r.resolveCname('www.' + DOMAIN), EXPECTED.WWW_CNAME);
await check('Correo autorizado (SPF)', async (r) => {
  const spf = (await r.resolveTxt(DOMAIN)).map((t) => t.join('')).filter((t) => t.startsWith('v=spf1'));
  return spf.length === 1 && spf[0].includes('include:_spf.google.com') ? ['ok'] : spf.length ? spf : ['sin SPF'];
}, ['ok']);

// la web responde y es la tuya
try {
  const res = await fetch(`https://www.${DOMAIN}/`, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const html = await res.text();
  if (res.status !== 200 || !html.includes('Vikingo Paintball')) problems.push(`La web respondió ${res.status} y no parece la de Vikingo Paintball.`);
  else console.log('OK  La web responde');
} catch (e) {
  problems.push(`La web no responde: ${e.message}`);
}

// vencimiento del dominio y bloqueo contra transferencias (registro público RDAP)
try {
  const res = await fetch(`https://rdap.verisign.com/com/v1/domain/${DOMAIN}`, { signal: AbortSignal.timeout(20000) });
  const rdap = await res.json();
  const exp = (rdap.events || []).find((e) => e.eventAction === 'expiration');
  const days = exp ? Math.floor((new Date(exp.eventDate) - Date.now()) / 86400000) : null;
  if (days === null) problems.push('No se pudo leer la fecha de vencimiento del dominio.');
  else if (days < WARN_DAYS) problems.push(`El dominio vence en ${days} días (${exp.eventDate.slice(0, 10)}). Revisá que la renovación automática esté activa en Squarespace.`);
  else console.log(`OK  El dominio vence en ${days} días`);
  if (!(rdap.status || []).includes('client transfer prohibited')) problems.push('El dominio ya no tiene el bloqueo contra transferencias. Activalo en Squarespace.');
  else console.log('OK  Bloqueo contra transferencias activo');
} catch (e) {
  console.log('Aviso: no se pudo consultar el registro del dominio (' + e.message + ')'); // no es motivo de alarma
}

if (problems.length) {
  console.error('\n⚠️  ATENCIÓN: algo cambió en el dominio ' + DOMAIN + ':\n- ' + problems.join('\n- '));
  console.error('\nSi no hiciste vos estos cambios, entrá a Squarespace, cambiá la contraseña y revisá los registros DNS.');
  process.exit(1);
}
console.log('\nTodo en orden.');
