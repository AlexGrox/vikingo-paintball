/* Google Analytics 4 (gtag.js). El ID de medición (G-XXXXXXXXXX) se configura en
   «Ajustes del sitio». Como las secciones son rutas #/…, cada cambio de sección
   se registra como una vista de página (/reservas, /juegos…). */
let id = null;

export function initAnalytics(measurementId) {
  const m = String(measurementId || '').trim().toUpperCase();
  if (!/^G-[A-Z0-9]{4,}$/.test(m) || id === m) return;
  // no contar las visitas del propio administrador ni las pruebas en el PC
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  id = m;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // las vistas se envían a mano (rutas con #), no automáticamente
  window.gtag('config', id, { send_page_view: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.append(s);
}

export function trackPage(path, title) {
  if (!id || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_title: title || document.title,
    page_location: location.origin + path,
    page_path: path,
  });
}

export function trackEvent(name, params) {
  if (id && window.gtag) window.gtag('event', name, params || {});
}
