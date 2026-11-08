/* ==========================================================================
   Jugador en silueta que cruza corriendo entre los árboles.
   - Un único jugador a la vez (un solo sprite y una sola textura: muy poca memoria).
   - Cada pasada se genera delante de la cámara actual, a 22-55 m, solo por zonas de árboles.
   - Los troncos que quedan delante lo tapan; la niebla del escenario lo difumina con la distancia.
   - Corre a izquierda o derecha (la hoja de fotogramas se voltea).
   - Algunos avanzan en diagonal hacia la cámara: crecen al acercarse y disparan bolas
     que revientan en la pantalla (solo en la portada).
   ========================================================================== */
import * as THREE from 'three';
import { playWhoosh } from './audio.js';

// 16 fotogramas de un jugador de paintball 3D propio (ciclo de carrera completo, mira a la derecha)
const SHEET = { url: 'img/corredor-sheet.webp', cols: 4, rows: 4, frames: 16, fps: 27, facesRight: true };
const HEIGHT = 1.81; // altura del fotograma (m): 540 px del render a 297,7 px/m (jugador de ~1,75 m)
const ASPECT = 1.0189; // alto / ancho de cada fotograma
const SPEED = [3.8, 4.8]; // m/s (trote táctico)
const PAUSE = [2, 5]; // segundos entre una pasada y la siguiente
export const PAINT = ['#ff3b1f', '#ffd60a', '#27e36b', '#1e90ff', '#ff2d92', '#b45cff', '#ff8a00', '#00e5ff'];
const UPV = new THREE.Vector3(0, 1, 0);

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {(x:number, z:number, pad?:number)=>boolean} o.isClear  true en el campo y las estaciones
 * @param {(x:number, z:number)=>number} o.groundHeight
 * @param {THREE.Object3D[]} o.occluders  objetos que pueden taparlo (para elegir recorridos visibles)
 * @param {()=>boolean} [o.canShoot]  si puede disparar a la cámara (solo en la portada)
 * @param {(x:number, y:number, color:string)=>void} [o.onScreenHit]  bola que revienta en pantalla (x, y en 0..1)
 */
export function createRunner({ scene, camera, isClear, groundHeight, occluders, canShoot = () => false, onScreenHit, spawnTries = 10 }) {
  const R = (a, b) => a + (b - a) * Math.random();

  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / SHEET.cols, 1 / SHEET.rows);
  const img = new Image();
  img.onload = () => {
    tex.image = img;
    tex.needsUpdate = true;
  };
  img.src = SHEET.url;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xb3a38c, // algo oscurecido y cálido: el sol está detrás (contraluz)
    transparent: true,
    alphaTest: 0.5, // escribe profundidad: la bruma que queda detrás no se dibuja encima
  });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0.0275); // los pies en el suelo
  sprite.scale.set(HEIGHT / ASPECT, HEIGHT, 1);
  sprite.visible = false;
  sprite.renderOrder = 3; // por encima de los bancos de bruma (los troncos lo siguen tapando)
  scene.add(sprite);

  let wait = R(1, 2.5); // primera aparición poco después de cargar
  let run = null;
  const f = new THREE.Vector3(), r = new THREE.Vector3(), p = new THREE.Vector3();

  function setFrame(i, flip) {
    const col = i % SHEET.cols, row = Math.floor(i / SHEET.cols);
    // flip = corre hacia la derecha de la pantalla; si el dibujo mira al otro lado, se voltea la textura
    const mirror = SHEET.facesRight ? !flip : flip;
    tex.repeat.x = (mirror ? -1 : 1) / SHEET.cols;
    tex.offset.set((col + (mirror ? 1 : 0)) / SHEET.cols, 1 - (row + 1) / SHEET.rows);
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector3();
  const body = new THREE.Vector3();

  /** ¿Se ve el torso de un jugador en (x, z)? (no tapado por empalizada, neumáticos, terreno...) */
  function visibleAt(x, z, maxDist = Infinity) {
    body.set(x, groundHeight(x, z) + 1.1, z);
    ndc.copy(body).project(camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return false;
    const dist = camera.position.distanceTo(body);
    if (dist > maxDist) return false;
    ray.set(camera.position, body.clone().sub(camera.position).normalize());
    ray.far = dist - 0.8;
    return ray.intersectObjects(occluders, false).length === 0;
  }
  /** ¿El punto ya no se ve (fuera de pantalla o perdido en la niebla)? */
  function goneAt(x, z) {
    body.set(x, groundHeight(x, z) + 1, z);
    if (camera.position.distanceTo(body) > 100) return true;
    ndc.copy(body).project(camera);
    return ndc.z > 1 || Math.abs(ndc.x) > 1.12;
  }

  /** No se ve: fuera de pantalla, perdido en la niebla o tapado (empalizada, terreno...) */
  const unseen = (x, z) => goneAt(x, z) || !visibleAt(x, z);

  /**
   * Alarga el recorrido desde P en un sentido hasta que el jugador deje de verse.
   * Si pisa el campo o una estación estando a la vista, el recorrido no vale.
   */
  function extend(P, dir, sgn) {
    let s = 0, hidden = 0;
    while (s < 80) {
      s += 1.5;
      p.copy(P).addScaledVector(dir, s * sgn);
      if (isClear(p.x, p.z, 1.5)) return hidden >= 2 ? P.clone().addScaledVector(dir, (s - 1.5) * sgn) : null;
      if (goneAt(p.x, p.z)) return P.clone().addScaledVector(dir, (s + 2) * sgn);
      hidden = !visibleAt(p.x, p.z) ? hidden + 1 : 0;
      if (hidden >= 3) return p.clone(); // tapado varios metros seguidos (detrás de la empalizada)
    }
    return null;
  }

  /** Busca un recorrido entre árboles que la cámara vea al menos en parte.
   *  Tipos: "cruce" (de lado) y "avance" (en diagonal hacia la cámara: crece y dispara). */
  function spawn() {
    camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-4) return false;
    f.normalize();
    r.set(-f.z, 0, f.x); // derecha en pantalla
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const wantApproach = Math.random() < 0.55;
    // pocos intentos por fotograma (cada uno hace muchas comprobaciones de visibilidad): sin tirones
    for (let k = 0; k < spawnTries; k++) {
      // punto de paso: dentro del encuadre, en el bosque y visible
      const a = Math.atan(R(-0.95, 0.95) * tanH);
      const d = R(18, 70);
      const P = camera.position.clone().addScaledVector(f, Math.cos(a) * d).addScaledVector(r, Math.sin(a) * d);
      P.y = 0;
      if (isClear(P.x, P.z, 2) || !visibleAt(P.x, P.z)) continue;
      const toCam = camera.position.clone().sub(P).setY(0).normalize();
      // si se insiste mucho sin éxito, se acepta el otro tipo de recorrido
      const approach = Math.random() < 0.7 ? wantApproach : !wantApproach;
      let dir;
      if (approach) {
        // hacia la cámara, desviado 15°-45° a un lado
        dir = toCam.clone().applyAxisAngle(UPV, (Math.random() < 0.5 ? -1 : 1) * R(0.26, 0.78));
      } else {
        dir = new THREE.Vector3(-toCam.z, 0, toCam.x).applyAxisAngle(UPV, R(-0.8, 0.8));
        if (Math.random() < 0.5) dir.negate();
      }
      const start = extend(P, dir, -1);
      const end = start && extend(P, dir, 1);
      if (!end) continue;
      // que se vea al menos unos metros de carrera a una distancia legible
      let seen = 0;
      const len = start.distanceTo(end);
      const steps = Math.ceil(len / 2);
      for (let i = 0; i <= steps; i++) {
        p.lerpVectors(start, end, i / steps);
        if (visibleAt(p.x, p.z, 65)) seen++;
      }
      if (seen * 2 < 8) continue;
      // sentido en pantalla para voltear la silueta
      const sx = ndc.copy(start).project(camera).x;
      const ex = ndc.copy(end).project(camera).x;
      run = {
        start, end, len, s: 0, anim: Math.random() * 10,
        speed: R(SPEED[0], SPEED[1]),
        flip: ex > sx,
        approach,
        nextBurst: R(0.4, 1.2), // segundos hasta la primera ráfaga
        burstLeft: 0,
      };
      sprite.visible = true;
      return true;
    }
    return false;
  }

  /* ---------------- disparos hacia la cámara ---------------- */
  const BALL_SPEED = 34;
  const ballGeo = new THREE.SphereGeometry(0.045, 12, 8);
  const balls = [];
  const camRight = new THREE.Vector3();

  function fire() {
    // bocacha: delante del jugador (según hacia dónde mira en pantalla) a la altura de los hombros
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const w = sprite.scale.x, h = sprite.scale.y;
    const muzzle = sprite.position.clone()
      .addScaledVector(UPV, h * 0.8)
      .addScaledVector(camRight, (run.flip ? 1 : -1) * w * 0.47);
    // objetivo: un punto de la pantalla; algunas bolas fallan y pasan de largo
    const hit = Math.random() < 0.6;
    const nx = hit ? R(-0.75, 0.75) : (Math.random() < 0.5 ? -1 : 1) * R(1.15, 1.6);
    const ny = hit ? R(-0.6, 0.7) : R(-0.9, 0.9);
    const target = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize()
      .multiplyScalar(hit ? 0.35 : 3).add(camera.position);
    const color = new THREE.Color(PAINT[Math.floor(Math.random() * PAINT.length)]);
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(muzzle);
    mesh.renderOrder = 4;
    scene.add(mesh);
    const dist = muzzle.distanceTo(target);
    balls.push({ mesh, from: muzzle, to: target, t: 0, dur: dist / BALL_SPEED, arc: Math.min(0.9, dist * 0.012), hit, nx, ny, color });
  }

  function updateBalls(dt) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.t += dt / b.dur;
      if (b.t >= 1) {
        scene.remove(b.mesh);
        b.mesh.material.dispose();
        balls.splice(i, 1);
        if (b.hit && onScreenHit && canShoot()) onScreenHit((b.nx + 1) / 2, (1 - b.ny) / 2, '#' + b.color.getHexString());
        continue;
      }
      b.mesh.position.lerpVectors(b.from, b.to, b.t);
      b.mesh.position.y += Math.sin(Math.PI * b.t) * b.arc;
      // bola que falla: zumbido al pasar rozando, por el lado por el que pasa
      if (!b.hit && !b.whoosh && b.mesh.position.distanceTo(camera.position) < 9 && canShoot()) {
        b.whoosh = true;
        playWhoosh(Math.sign(b.nx), R(0.75, 1));
      }
    }
  }

  return {
    update(dt) {
      updateBalls(dt);
      if (!run) {
        wait -= dt;
        if (wait <= 0 && !spawn()) wait = 0.12; // sin recorrido válido aún: seguir buscando en los próximos fotogramas
        return;
      }
      run.s += run.speed * dt;
      run.anim += dt;
      if (run.s >= run.len) {
        run = null;
        sprite.visible = false;
        wait = R(PAUSE[0], PAUSE[1]);
        return;
      }
      sprite.position.lerpVectors(run.start, run.end, run.s / run.len);
      sprite.position.y = groundHeight(sprite.position.x, sprite.position.z) - 0.03; // el rebote ya va en los fotogramas
      // la perspectiva ya lo agranda al acercarse; se refuerza un poco para que se note más
      const dist = camera.position.distanceTo(sprite.position);
      const k = THREE.MathUtils.clamp(1 + (48 - dist) * 0.007, 0.88, 1.22);
      sprite.scale.set((HEIGHT / ASPECT) * k, HEIGHT * k, 1);
      setFrame(Math.floor(run.anim * SHEET.fps * (run.speed / 4.3)) % SHEET.frames, run.flip);

      // los que avanzan hacia la cámara disparan ráfagas (solo en la portada y si se le ve)
      if (run.approach && canShoot() && dist < 70) {
        run.nextBurst -= dt;
        if (run.nextBurst <= 0) {
          if (run.burstLeft === 0) {
            const vis = visibleAt(sprite.position.x, sprite.position.z);
            run.burstLeft = vis ? Math.floor(R(2, 4.99)) : 0;
            if (!vis) run.nextBurst = 0.4;
          }
          if (run.burstLeft > 0) {
            fire();
            run.burstLeft--;
            run.nextBurst = run.burstLeft > 0 ? R(0.12, 0.2) : R(1.0, 2.0);
          }
        }
      }
    },
  };
}
