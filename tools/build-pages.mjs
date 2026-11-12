/* ==========================================================================
   Generador de páginas para buscadores (se ejecuta al publicar, en GitHub Actions).
   Uso: node tools/build-pages.mjs <carpeta-del-sitio>
   - Crea /reservas/, /juegos/, /tienda/, /ranking/ y las páginas legales (/privacidad/…) como páginas reales: mismo HTML de
     la web, con su propio título, descripción, URL canónica y el contenido de la
     sección ya escrito (Google lo lee sin ejecutar JavaScript). Al cargar, la web
     toma el control y muestra la sección en su estación 3D como siempre.
   - Añade preguntas frecuentes (FAQPage) a las páginas que tengan un bloque FAQ.
   - Enlaces reales a las secciones en la portada y sitemap.xml con todas las páginas.
   No modifica los archivos del repositorio: trabaja sobre la copia que se publica.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const SITE = process.argv[2] || 'public';
const ORIGIN = 'https://www.vikingo-paintball.com';
const content = JSON.parse(fs.readFileSync(path.join(SITE, 'content.json'), 'utf8'));
const base = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const site = content.site || {};
const order = content.order || Object.keys(content.sections);
// páginas sin cartel 3D (privacidad, bases del voucher, arrepentimiento)
const pageOnly = Object.keys(content.sections).filter((k) => !order.includes(k));
const CONSUMER_URL = 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario';
const DATA_FISCAL_IMG = 'https://www.afip.gob.ar/images/f960/DATAWEB.jpg';

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plain = (html = '') => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const abs = (u = '') => (/^https?:/i.test(u) ? u : `${ORIGIN}/${String(u).replace(/^\//, '')}`);

/* ---------- contenido de los bloques en HTML estático ---------- */
function renderBlock(b) {
  switch (b.type) {
    case 'text':
      return `<div class="rich">${b.html || ''}</div>`;
    case 'cards':
      return `<div class="cards">${(b.items || []).map((it) => `<article class="card"><div class="card-body">${it.tag ? `<span class="card-tag">${esc(it.tag)}</span>` : ''}<h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div></article>`).join('')}</div>`;
    case 'table':
      return `<div class="table-wrap"><table class="data"><thead><tr>${(b.headers || []).map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${(b.rows || []).map((r) => `<tr>${(b.headers || []).map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'image':
      return b.src ? `<figure class="media"><img src="${esc(b.src)}" alt="${esc(b.alt || '')}" loading="lazy" />${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : '';
    case 'gallery':
      return `<div class="gallery">${(b.images || []).map((im) => `<figure><img src="${esc(im.src)}" alt="${esc(im.caption || '')}" loading="lazy" /></figure>`).join('')}</div>`;
    case 'video':
      return b.caption ? `<p>${esc(b.caption)}</p>` : '';
    case 'button':
      return `<p class="block-button"><a class="btn" href="${esc(b.url || '#')}">${esc(b.text || '')}</a></p>`;
    case 'gform':
      return `<div class="form-card"><h2>${esc(b.title)}</h2>${b.intro ? `<p>${esc(b.intro)}</p>` : ''}${b.url ? `<p><a class="btn" href="${esc(b.url)}">${esc(b.buttonText || 'Formulario de reserva')}</a></p>` : ''}</div>`;
    case 'regret':
      return `<div class="form-card"><h2>${esc(b.title || 'Solicitar la cancelación')}</h2><p>Completá el formulario de esta página para pedir la cancelación y recibir tu código de solicitud.</p></div>`;
    case 'faq':
      return `<div class="faq">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${(b.items || []).map((it) => `<details class="faq-item"><summary>${esc(it.q)}</summary><p class="faq-a">${esc(it.a)}</p></details>`).join('')}</div>`;
    default:
      return '';
  }
}

function setMeta(html, { title, desc, url }) {
  const rep = (re, val) => {
    if (!re.test(html)) throw new Error('No se encontró en index.html: ' + re);
    html = html.replace(re, val);
  };
  rep(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  rep(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(desc)}" />`);
  rep(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`);
  rep(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`);
  rep(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(title)}" />`);
  rep(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(desc)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(title)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(desc)}" />`);
  return html;
}

/* ---------- pie legal: privacidad, bases, arrepentimiento, reclamos, titular y Data Fiscal ---------- */
const legalLinks = [
  content.sections.privacidad && `<a href="/privacidad/">Política de privacidad</a>`,
  content.sections['bases-voucher'] && site.voucherOn && `<a href="/bases-voucher/">Bases y condiciones del voucher</a>`,
  content.sections.arrepentimiento && `<a href="/arrepentimiento/">Botón de arrepentimiento</a>`,
  `<a href="${esc(site.consumerUrl || CONSUMER_URL)}" target="_blank" rel="noopener">Defensa de las y los consumidores. Para reclamos ingrese aquí</a>`,
].filter(Boolean).join('<span aria-hidden="true"> · </span>');
const legalWho = [site.legalName && `Titular: ${esc(site.legalName)}`, site.cuit && `CUIT ${esc(site.cuit)}`].filter(Boolean).join(' · ');
const legalHtml = `<div class="legal-foot"><nav class="legal-links" aria-label="Información legal">${legalLinks}</nav>${legalWho ? `<p class="legal-who">${legalWho}</p>` : ''}${site.dataFiscalUrl ? `<a class="data-fiscal" href="${esc(site.dataFiscalUrl)}" target="_F960AFIPInfo" rel="noopener"><img src="${DATA_FISCAL_IMG}" alt="Data Fiscal" width="63" height="86" loading="lazy" /></a>` : ''}</div>`;

const linksHtml = order.map((k) => `<li><a href="/${k}/">${esc(content.sections[k].label)}</a></li>`).join('');

/* ---------- páginas de cada sección ---------- */
for (const key of [...order, ...pageOnly]) {
  const sec = content.sections[key];
  const url = `${ORIGIN}/${key}/`;
  const title = sec.seoTitle || `${sec.title} | ${site.name || 'Vikingo Paintball'} Córdoba`;
  const desc = sec.seoDescription || plain(sec.subtitle) || site.description || '';
  let html = setMeta(base, { title, desc, url });

  // todas las rutas relativas (css, js, img, content.json) siguen apuntando a la raíz
  if (!html.includes('<base ')) html = html.replace('<head>', '<head>\n  <base href="/" />');

  // un solo h1 por página: el de la sección (la bienvenida pasa a ser un título secundario)
  html = html.replace(/<h1 id="welcome-title">([\s\S]*?)<\/h1>/, '<p id="welcome-title" class="welcome-h">$1</p>');

  // contenido de la sección ya escrito dentro del panel
  const body = `<div class="panel-inner"><header class="hero"><h1>${esc(sec.title)}</h1>${sec.subtitle ? `<p class="subtitle">${esc(sec.subtitle)}</p>` : ''}</header><div class="content">${(sec.blocks || []).map((b) => `<section class="block block-${b.type}">${renderBlock(b)}</section>`).join('')}</div><footer class="site-footer"><div class="rich">${site.footerHtml || ''}</div>${site.reviewsUrl ? `<p class="review-link"><a href="${esc(site.reviewsUrl)}" rel="noopener">★★★★★ ${esc(site.reviewsText || '¿Ya jugaste? Dejanos tu reseña en Google')}</a></p>` : ''}${legalHtml}</footer></div>`;
  html = html.replace('<section id="panel" hidden aria-live="polite">', '<section id="panel" aria-live="polite">');
  html = html.replace('<div id="panel-body"></div>', `<div id="panel-body">${body}</div>`);
  html = html.replace('<ul id="fallback-links"></ul>', `<ul id="fallback-links">${linksHtml}</ul>`);

  // datos estructurados: migas de pan y preguntas frecuentes
  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: site.name || 'Vikingo Paintball', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: sec.title, item: url },
    ],
  }];
  const faqs = (sec.blocks || []).filter((b) => b.type === 'faq').flatMap((b) => b.items || []).filter((it) => it.q && it.a);
  if (faqs.length) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((it) => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })),
    });
  }
  html = html.replace('</head>', ld.map((d) => `  <script type="application/ld+json">${JSON.stringify(d)}</script>\n`).join('') + '</head>');

  fs.mkdirSync(path.join(SITE, key), { recursive: true });
  fs.writeFileSync(path.join(SITE, key, 'index.html'), html);
  console.log(`/${key}/  ${title}`);
}

/* ---------- portada: enlaces reales a las secciones ---------- */
fs.writeFileSync(path.join(SITE, 'index.html'), base.replace('<ul id="fallback-links"></ul>', `<ul id="fallback-links">${linksHtml}</ul>`));

/* ---------- sitemap ---------- */
const lastmod = (content.updatedAt || new Date().toISOString()).slice(0, 10);
const urls = ['', ...order.map((k) => `${k}/`), ...pageOnly.map((k) => `${k}/`)];
fs.writeFileSync(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url>
    <loc>${ORIGIN}/${u}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${!u ? '1.0' : pageOnly.includes(u.slice(0, -1)) ? '0.3' : '0.8'}</priority>${u ? '' : `
    <image:image><image:loc>${abs('img/og-vikingo.jpg')}</image:loc></image:image>`}
  </url>`).join('\n')}
</urlset>
`);
console.log('sitemap.xml:', urls.length, 'páginas');
