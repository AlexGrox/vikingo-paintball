/* ==========================================================================
   Precios para buscadores (datos estructurados schema.org).
   Las secciones de la web se cargan al navegar, así que Google no ve las tarjetas.
   Aquí se genera, a partir de las tarjetas con precio ($…), un catálogo de ofertas
   invisible para el visitante que Google sí lee. Se actualiza solo al editar.
   ========================================================================== */
const SITE_ID = 'https://www.vikingo-paintball.com/#negocio';

/** «$40.000 por jugador» → { price: 40000, unit: 'por jugador' } (acepta 40.000 / 40,000 / 1.500,50) */
export function parsePrice(tag) {
  const m = String(tag || '').match(/\$\s*([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  let n = m[1].replace(/[.,]$/, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(n)) n = n.replace(/[.,]/g, ''); // separador de miles
  else n = n.replace(/\./g, '').replace(',', '.'); // coma decimal
  const price = Number(n);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, unit: m[2].trim() };
}

const clean = (s, max = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function updatePriceData(content) {
  if (!content || !content.sections) return;
  const offers = [];
  for (const key of content.order || Object.keys(content.sections)) {
    const sec = content.sections[key];
    for (const b of (sec && sec.blocks) || []) {
      if (b.type !== 'cards') continue;
      for (const it of b.items || []) {
        const p = parsePrice(it.tag);
        if (!p || !it.title) continue;
        offers.push({
          '@type': 'Offer',
          name: clean(it.title, 120),
          description: clean(it.text),
          category: clean(sec.label, 40),
          price: p.price,
          priceCurrency: 'ARS',
          availability: 'https://schema.org/InStock',
          url: `https://www.vikingo-paintball.com/${key}/`,
          ...(p.unit ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: p.price, priceCurrency: 'ARS', unitText: clean(p.unit, 40) } } : {}),
        });
      }
    }
  }
  let tag = document.getElementById('ld-precios');
  if (!offers.length) { if (tag) tag.remove(); return; }
  if (!tag) {
    tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.id = 'ld-precios';
    document.head.append(tag);
  }
  tag.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    '@id': SITE_ID, // el mismo negocio que la ficha principal del <head>
    name: 'Vikingo Paintball Córdoba',
    hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Precios de Vikingo Paintball', itemListElement: offers },
  });
}
