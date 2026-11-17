/* ==========================================================================
   Iconos de redes y del mapa dibujados en un canvas (sin Three.js).
   Los usan las placas del escenario 3D y las ventanas de enlaces: están aparte para que
   la web pueda arrancar aunque el motor 3D no cargue.
   ========================================================================== */
export function drawBadgeCanvas(kind, S = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const k = S / 256;
  g.scale(k, k);
  const bg = { whatsapp: '#25D366', facebook: '#1877F2', tiktok: '#111111', map: '#e53935' }[kind];
  if (kind === 'instagram') {
    const grd = g.createRadialGradient(70, 250, 10, 70, 250, 330);
    grd.addColorStop(0, '#feda75');
    grd.addColorStop(0.25, '#fa7e1e');
    grd.addColorStop(0.5, '#d62976');
    grd.addColorStop(0.75, '#962fbf');
    grd.addColorStop(1, '#4f5bd5');
    g.fillStyle = grd;
  } else g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineCap = g.lineJoin = 'round';
  if (kind === 'whatsapp') {
    g.lineWidth = 14;
    g.beginPath();
    g.arc(130, 124, 70, 0.62 * Math.PI, 2.62 * Math.PI - 0.12);
    g.stroke();
    g.beginPath(); // cola del bocadillo
    g.moveTo(84, 170); g.lineTo(62, 206); g.lineTo(104, 190); g.closePath();
    g.fill();
    g.lineWidth = 24; // auricular
    g.beginPath();
    g.moveTo(104, 94);
    g.quadraticCurveTo(106, 148, 160, 152);
    g.stroke();
    for (const [x, y] of [[104, 92], [162, 152]]) { g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'instagram') {
    g.lineWidth = 16;
    g.beginPath();
    g.roundRect(62, 62, 132, 132, 40);
    g.stroke();
    g.beginPath();
    g.arc(128, 128, 32, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(166, 90, 10, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'facebook') {
    g.font = 'bold 190px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('f', 142, 146);
  } else if (kind === 'tiktok') {
    g.font = 'bold 150px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#25F4EE'; g.fillText('♪', 120, 132);
    g.fillStyle = '#FE2C55'; g.fillText('♪', 136, 140);
    g.fillStyle = '#fff'; g.fillText('♪', 128, 136);
  } else if (kind === 'map') {
    g.beginPath(); // pin dibujado (para el widget)
    g.arc(128, 104, 56, Math.PI * 0.82, Math.PI * 2.18);
    g.lineTo(128, 210);
    g.closePath();
    g.fill();
    g.fillStyle = bg;
    g.beginPath(); g.arc(128, 104, 22, 0, Math.PI * 2); g.fill();
  }
  // anillo interior oscuro (borde de chapa)
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.25)';
  g.beginPath(); g.arc(128, 128, 122, 0, Math.PI * 2); g.stroke();
  return c;
}
