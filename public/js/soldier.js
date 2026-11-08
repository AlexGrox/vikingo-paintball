/* ==========================================================================
   Jugador de paintball en 3D con ciclo de carrera procedural.
   Mira hacia +X; su lado derecho hacia +Z. Origen en el suelo, bajo la cadera.
   Se usa para renderizar la hoja de fotogramas del corredor (img/corredor-sheet.webp).
   update(phase): phase en [0, 1) = un ciclo completo (dos pasos).
   ========================================================================== */
import * as THREE from 'three';
import { buildMarker } from './scene.js';

const L_THIGH = 0.44, L_SHIN = 0.44, ANKLE_H = 0.075;
const LEAN = 0.36; // inclinación del tronco hacia delante (rad)

const mat = (color, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const M = {
  jersey: mat(0x1c1c1f, 0.85),
  accent: mat(0xd77a22, 0.7),
  pants: mat(0x2c2d31, 0.9),
  pad: mat(0x121214, 0.6),
  boot: mat(0x2b2119, 0.75),
  sole: mat(0x0f0d0b, 0.9),
  glove: mat(0x141416, 0.7),
  mask: mat(0x18181a, 0.45, 0.1),
  maskAccent: mat(0xd77a22, 0.5),
  lens: new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.5 }),
  wrap: mat(0x3a2a1a, 0.95),
  harness: mat(0x25262a, 0.85),
  pod: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.9 }),
};

/** Cilindro redondeado entre dos puntos (capsule) */
function limb(a, b, r1, r2, material) {
  const len = a.distanceTo(b);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 14), material);
  body.position.y = len / 2;
  g.add(body);
  for (const [y, r] of [[0, r1], [len, r2]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), material);
    s.position.y = y;
    g.add(s);
  }
  g.position.copy(a);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return g;
}

/** Codo para un brazo de dos segmentos que llega del hombro S al objetivo T */
function elbow(S, T, a, b, pole) {
  const d = Math.min(S.distanceTo(T), a + b - 1e-3);
  const dir = T.clone().sub(S).normalize();
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const ortho = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return S.clone().addScaledVector(dir, along).addScaledVector(ortho, h);
}

function buildLeg(side) {
  const hip = new THREE.Group();
  hip.position.set(0, 0, side * 0.1);
  hip.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -L_THIGH, 0), 0.11, 0.085, M.pants));
  const knee = new THREE.Group();
  knee.position.y = -L_THIGH;
  hip.add(knee);
  const pad = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10, 0, Math.PI), M.pad);
  pad.rotation.y = Math.PI / 2;
  pad.scale.set(1, 1.3, 0.8);
  pad.position.set(0.05, -0.04, 0);
  knee.add(pad);
  knee.add(limb(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -L_SHIN, 0), 0.085, 0.062, M.pants));
  const ankle = new THREE.Group();
  ankle.position.y = -L_SHIN;
  knee.add(ankle);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.11), M.boot);
  boot.position.set(0.06, -0.035, 0);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.12, 12), M.boot);
  shaft.position.set(0, 0.02, 0);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.025, 0.115), M.sole);
  sole.position.set(0.06, -0.085, 0);
  ankle.add(boot, shaft, sole);
  return { hip, knee, ankle };
}

export function buildSoldier() {
  const root = new THREE.Group(); // en el suelo
  const pelvis = new THREE.Group(); // altura de la cadera
  root.add(pelvis);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), M.pants);
  hips.scale.set(0.16, 0.12, 0.2);
  pelvis.add(hips);

  /* ---------- tronco (inclinado hacia delante) ---------- */
  const torso = new THREE.Group();
  torso.rotation.z = -LEAN;
  pelvis.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 16), M.jersey);
  chest.scale.set(1, 1, 1.25);
  chest.position.y = 0.3;
  torso.add(chest);
  for (const z of [-0.2, 0.2]) { // paneles naranjas laterales
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.01), M.accent); // franja lateral
    p.position.set(0.02, 0.32, z * 1.08);
    torso.add(p);
  }
  // arnés con tubos de bolas en la espalda
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.32), M.harness);
  pack.position.set(-0.2, 0.1, 0);
  torso.add(pack);
  for (let i = 0; i < 4; i++) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.24, 12), M.pod);
    pod.position.set(-0.27, 0.22, -0.12 + i * 0.08);
    torso.add(pod);
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.44), M.harness);
  belt.position.y = 0.03;
  torso.add(belt);

  /* ---------- cabeza con máscara de paintball ---------- */
  const head = new THREE.Group();
  head.position.set(0.04, 0.64, 0);
  head.rotation.z = LEAN * 0.9; // mira al frente (apuntando)
  torso.add(head);
  head.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 12), M.jersey)); // cuello
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), M.wrap);
  skull.position.y = 0.12;
  skull.scale.set(1.05, 1, 0.92);
  head.add(skull);
  const mask = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 12, -Math.PI / 2.3, Math.PI / 1.15, Math.PI * 0.3, Math.PI * 0.55), M.mask);
  mask.position.set(0.02, 0.11, 0);
  mask.rotation.y = Math.PI / 2;
  head.add(mask);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.055, 0.2), M.lens);
  lens.position.set(0.122, 0.135, 0);
  head.add(lens);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.22), M.mask);
  visor.position.set(0.12, 0.175, 0);
  visor.rotation.z = -0.15;
  head.add(visor);
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.13), M.maskAccent);
  chin.position.set(0.12, 0.055, 0);
  head.add(chin);

  /* ---------- marcadora apuntando y brazos (IK, fijos respecto al tronco) ---------- */
  const marker = buildMarker({ hopper: true }).root;
  marker.scale.setScalar(0.92);
  marker.rotation.y = Math.PI / 2; // cañón hacia +X
  marker.rotation.z = LEAN * 0.95; // nivelada pese a la inclinación del tronco
  marker.position.set(0.3, 0.5, 0.1);
  torso.add(marker);
  marker.updateMatrix();
  const toTorso = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(marker.matrix);
  const grip = toTorso(0, -0.075, -0.05); // empuñadura
  const fore = toTorso(0, -0.01, 0.24); // guardamanos
  const shoulders = [new THREE.Vector3(0.02, 0.5, 0.22), new THREE.Vector3(0.02, 0.5, -0.22)];
  const targets = [grip, fore.clone().add(new THREE.Vector3(0, 0, -0.03))];
  const poles = [new THREE.Vector3(-0.2, -1, 0.6), new THREE.Vector3(0.1, -1, -0.7)];
  shoulders.forEach((S, i) => {
    const T = targets[i];
    const E = elbow(S, T, 0.3, 0.29, poles[i]);
    torso.add(limb(S, E, 0.08, 0.068, M.jersey));
    torso.add(limb(E, T, 0.066, 0.05, M.jersey));
    if (!i) torso.add(limb(S.clone().lerp(E, 0.55), E, 0.075, 0.07, M.accent)); // codera naranja
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), M.glove);
    hand.position.copy(T);
    hand.scale.set(1.2, 0.9, 0.9);
    torso.add(hand);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), M.jersey);
    sh.position.copy(S);
    torso.add(sh);
  });

  /* ---------- piernas ---------- */
  const legs = [buildLeg(1), buildLeg(-1)];
  legs.forEach((l) => pelvis.add(l.hip));

  root.traverse((o) => o.isMesh && (o.castShadow = true));
  const tmp = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function poseLeg(leg, phi) {
    const thigh = 0.2 + 0.78 * Math.sin(phi);
    const swing = Math.max(0, Math.cos(phi + 0.35)); // pierna avanzando: rodilla muy flexionada
    const stance = Math.exp(-(wrap(phi - Math.PI) ** 2) / 0.5); // amortiguación al apoyar
    const knee = 0.2 + 1.75 * swing * swing + 0.35 * stance;
    // orientación del pie: plano al apoyar, punta abajo al despegar, punta arriba al contactar
    const footWorld = -0.75 * Math.max(0, Math.cos(phi + 1.0)) ** 2 + 0.22 * Math.max(0, Math.sin(phi)) ** 3;
    leg.hip.rotation.z = thigh;
    leg.knee.rotation.z = -knee;
    leg.ankle.rotation.z = footWorld - (thigh - knee);
  }

  return {
    root,
    update(phase) {
      const phi = phase * Math.PI * 2;
      poseLeg(legs[0], phi);
      poseLeg(legs[1], phi + Math.PI);
      torso.rotation.z = -LEAN - 0.03 * Math.sin(2 * phi);
      torso.rotation.y = 0.06 * Math.sin(phi); // leve giro de cadera
      pelvis.position.y = 1;
      root.updateMatrixWorld(true);
      // apoyar en el suelo el pie más bajo; en la fase de vuelo, pequeño salto
      let minY = Infinity;
      for (const l of legs) minY = Math.min(minY, l.ankle.getWorldPosition(tmp).y - ANKLE_H - root.position.y);
      const flight = 0.07 * Math.max(0, Math.abs(Math.sin(phi)) - 0.5) / 0.5;
      pelvis.position.y = 1 - minY + flight;
      root.updateMatrixWorld(true);
    },
  };
}
