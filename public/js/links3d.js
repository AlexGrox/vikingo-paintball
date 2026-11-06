/* ==========================================================================
   Enlaces dentro del escenario: se activan disparándoles.
   - Pin de ubicación (derecha): abre el mapa del campo.
   - Placas de redes sociales clavadas en la caja de palés (izquierda): WhatsApp, Instagram
     y, si están configurados, Facebook y TikTok.
   En pantallas verticales la caja queda fuera de cámara: pin y placas se recolocan en el encuadre.
   ========================================================================== */
import * as THREE from 'three';

export const NETWORKS = ['whatsapp', 'instagram', 'facebook', 'tiktok'];

/* ---------- iconos (canvas) ---------- */
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

export function createLinks3D({ scene, solids, crate, crateFrontZ, maxAniso = 8 }) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8580, metalness: 0.85, roughness: 0.4 });
  const nailMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.8, roughness: 0.5 });
  const addSolid = (m) => { solids.push(m); return m; };
  const removeSolid = (m) => { const i = solids.indexOf(m); if (i >= 0) solids.splice(i, 1); };

  /* ---------------- pin de ubicación ---------------- */
  const pin = new THREE.Group(); // apoyo (suelo o punto flotante)
  const floater = new THREE.Group(); // sube, baja y gira
  pin.add(floater);
  {
    const r = 0.27, yc = 0.62, a0 = THREE.MathUtils.degToRad(-40);
    const prof = [new THREE.Vector2(0, 0)];
    for (let i = 1; i <= 6; i++) { const t = i / 6; prof.push(new THREE.Vector2(r * Math.cos(a0) * t, (yc + r * Math.sin(a0)) * t)); }
    for (let i = 1; i <= 16; i++) {
      const a = a0 + ((Math.PI / 2 - a0) * i) / 16;
      prof.push(new THREE.Vector2(Math.max(0.0001, r * Math.cos(a)), yc + r * Math.sin(a)));
    }
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 32),
      new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.32, metalness: 0.1, emissive: 0xb71c1c, emissiveIntensity: 0.35 }));
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.56, 28).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.25 }));
    dot.position.y = yc;
    for (const m of [body, dot]) {
      m.castShadow = true;
      m.userData = { link: 'map', dynamic: true };
      floater.add(addSolid(m));
    }
  }
  // anillo en el suelo que late (invita a disparar)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3d2e, transparent: true, opacity: 0.6, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 48).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.02;
  pin.add(ring);
  pin.scale.setScalar(1.35);
  scene.add(pin);

  /* ---------------- placas de redes sociales ---------------- */
  const badgeRoot = new THREE.Group(); // se cuelga de la caja (horizontal) o de la escena (vertical)
  const backing = new THREE.Mesh(new THREE.BoxGeometry(1, 0.46, 0.04), crate ? crate.children[0].material : metal);
  backing.castShadow = true;
  backing.position.z = -0.03; // detrás de las placas
  badgeRoot.add(backing);
  const texCache = {};
  let badges = [];
  let current = '';
  const R = 0.15;
  const circle = new THREE.CircleGeometry(R, 40);
  const rim = new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.025, 40, 1, true).rotateX(Math.PI / 2);
  const nail = new THREE.SphereGeometry(0.014, 8, 6);

  function badgeTex(kind) {
    if (!texCache[kind]) {
      const t = new THREE.CanvasTexture(drawBadgeCanvas(kind, 256));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      texCache[kind] = t;
    }
    return texCache[kind];
  }

  function buildBadges(list) {
    for (const b of badges) { removeSolid(b.face); b.group.removeFromParent(); }
    badges = list.map((kind, i) => {
      const group = new THREE.Group();
      const face = new THREE.Mesh(circle, new THREE.MeshStandardMaterial({ map: badgeTex(kind), roughness: 0.45, metalness: 0.2 }));
      face.position.z = 0.013;
      face.userData = { link: kind, dynamic: true };
      const ringM = new THREE.Mesh(rim, metal);
      group.add(face, ringM);
      for (const y of [R * 0.72, -R * 0.72]) {
        const n = new THREE.Mesh(nail, nailMat);
        n.position.set(0, y, 0.022);
        group.add(n);
      }
      group.traverse((o) => o.isMesh && (o.castShadow = true));
      group.position.x = (i - (list.length - 1) / 2) * 0.4;
      group.rotation.z = (i % 2 ? 1 : -1) * 0.06; // clavadas a mano, algo torcidas
      group.userData.phase = i * 1.7;
      badgeRoot.add(group);
      addSolid(face);
      return { kind, group, face, wobble: 0, wobbleV: 0 };
    });
    backing.scale.x = list.length * 0.4 + 0.12;
  }

  let wide = true;
  let spin = 0, spinV = 0; // giro del pin (se acelera al recibir un disparo)
  return {
    pin,
    /** Rehace las placas según las redes configuradas */
    refresh(site) {
      const list = ['whatsapp', 'instagram'];
      if (site.facebook) list.push('facebook');
      if (site.tiktok) list.push('tiktok');
      const key = list.join(',');
      if (key !== current) { current = key; buildBadges(list); }
    },
    /** Coloca pin y placas según el encuadre */
    layout(camera, homeY) {
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      wide = camera.aspect >= 1.1;
      if (wide) {
        const d = 7, halfW = d * tan * camera.aspect;
        pin.position.set(Math.min(halfW * 0.8, 6.2), 0, -d);
        ring.visible = true;
        // placas clavadas en la cara frontal de la caja
        if (crate && badgeRoot.parent !== crate) crate.add(badgeRoot);
        badgeRoot.position.set(0.1, 0.6, crateFrontZ + 0.035);
        badgeRoot.rotation.set(0, 0, 0);
        backing.visible = false;
        badgeRoot.scale.setScalar(1);
      } else {
        // vertical: a los lados, por debajo del escudo y por encima de la marcadora
        const d = 6, halfH = d * tan, halfW = halfH * camera.aspect;
        const y = homeY - halfH * 0.08;
        pin.position.set(halfW * 0.66, y - 0.55, -d);
        ring.visible = false;
        if (badgeRoot.parent !== scene) scene.add(badgeRoot);
        const rows = badges.length > 2;
        badgeRoot.position.set(-halfW * 0.6, y, -d);
        badgeRoot.rotation.set(0, 0.25, 0);
        badgeRoot.scale.setScalar(rows ? 1.15 : 1.5);
        backing.visible = true;
      }
    },
    /** Animación: el pin flota y gira, el anillo late, las placas se balancean al recibir un disparo */
    update(t, dt) {
      floater.position.y = (wide ? 0.25 : 0.1) + Math.sin(t * 2.2) * 0.06;
      spin += (0.9 + spinV) * dt;
      spinV *= Math.pow(0.05, dt);
      floater.rotation.y = spin;
      const p = (t * 0.8) % 1;
      ring.scale.setScalar(1 + p * 0.9);
      ringMat.opacity = 0.65 * (1 - p);
      for (const b of badges) {
        b.wobbleV += (-b.wobble * 60 - b.wobbleV * 5) * dt;
        b.wobble += b.wobbleV * dt;
        b.group.rotation.x = b.wobble;
      }
    },
    /** Reacción al impacto */
    hit(kind) {
      if (kind === 'map') spinV += 14;
      else {
        const b = badges.find((x) => x.kind === kind);
        if (b) b.wobbleV += 3.5;
      }
    },
  };
}
