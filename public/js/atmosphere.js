/* ==========================================================================
   Atmósfera del bosque: bruma baja en movimiento y rayos de sol entre los árboles.
   - Bruma: billboards verticales (instanciados) con ruido animado, que derivan con el viento
     y se tiñen de dorado al mirar hacia el sol (dispersión a contraluz).
   - Rayos: haces paralelos a la dirección del sol, con brillo aditivo que ondula; los troncos
     que quedan delante los tapan, así que parecen colarse entre ellos.
   Todo se coloca solo en las zonas de árboles (fuera del campo y de las estaciones).
   ========================================================================== */
import * as THREE from 'three';

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.Vector3} o.toSun   dirección normalizada hacia el sol
 * @param {(x:number,z:number)=>boolean} o.isClear  true si el punto está en el campo o en una estación
 * @param {()=>number} o.rand        aleatorio reproducible 0..1
 */
export function createAtmosphere({ scene, toSun, isClear, rand, groundHeight = () => 0 }) {
  const R = (a, b) => a + (b - a) * rand();
  const uniforms = {
    uTime: { value: 0 },
    uToSun: { value: toSun.clone().normalize() },
  };

  /** Punto aleatorio en las zonas de árboles (banda del fondo y bandas laterales) */
  function forestPoint(pad) {
    for (let k = 0; k < 40; k++) {
      let x, z;
      if (rand() < 0.55) { x = R(-62, 62); z = R(-92, -36); }
      else { x = (rand() < 0.5 ? -1 : 1) * R(23, 52); z = R(-40, 4); }
      if (!isClear(x, z, pad)) return [x, z];
    }
    return [R(-60, 60), R(-90, -60)];
  }

  /* ------------------------------------------------------------------ bruma */
  const MIST = 80;
  const mistMat = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      // a contraluz la bruma se ve luminosa: crema dorado, más brillante hacia el sol
      uColor: { value: new THREE.Color(0xd2c79a) },
      uSunColor: { value: new THREE.Color(0xffe7b5) },
      uOpacity: { value: 1.45 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        vSeed = fract(sin(dot(center.xz, vec2(12.9898, 78.233))) * 43758.5453);
        // deriva lenta con el viento
        center.x += sin(uTime * 0.045 + vSeed * 6.283) * 6.0;
        center.z += cos(uTime * 0.037 + vSeed * 9.0) * 3.5;
        center.y += sin(uTime * 0.11 + vSeed * 4.0) * 0.35;
        // billboard cilíndrico: siempre de cara a la cámara pero vertical
        vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
        vec3 world = center + right * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uSunColor;
      uniform vec3 uToSun;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeed;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        vec2 p = vUv - 0.5;
        float r = length(p * vec2(1.0, 1.5));
        float shape = smoothstep(0.5, 0.08, r);
        float ground = smoothstep(0.0, 0.32, vUv.y);           // sin línea dura contra el suelo
        vec2 q = vUv * vec2(2.6, 1.6) + vec2(vSeed * 13.0 + uTime * 0.035, uTime * 0.012);
        float n = fbm(q + fbm(q * 1.7 - uTime * 0.02));        // remolinos internos
        float a = shape * ground * smoothstep(0.22, 0.72, n);
        // dispersión: mirando hacia el sol la bruma brilla dorada
        vec3 V = normalize(vWorld - cameraPosition);
        float scatter = pow(max(dot(V, uToSun), 0.0), 3.0);
        vec3 col = mix(uColor, uSunColor, 0.2 + 0.8 * scatter);
        // desvanecer de cerca (no tapar la cámara) y muy lejos (se funde con la niebla)
        float d = distance(vWorld, cameraPosition);
        float fade = smoothstep(4.0, 14.0, d) * (1.0 - smoothstep(85.0, 125.0, d));
        gl_FragColor = vec4(col, a * uOpacity * (0.55 + 0.9 * scatter) * fade);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mistMat, MIST);
  const m = new THREE.Matrix4();
  for (let i = 0; i < MIST; i++) {
    const [x, z] = forestPoint(5);
    const w = R(13, 24), h = R(6, 11);
    m.makeScale(w, h, 1).setPosition(x, groundHeight(x, z) + h * 0.42, z);
    mist.setMatrixAt(i, m);
  }
  mist.frustumCulled = false; // los vértices se recolocan en el shader
  mist.renderOrder = 1;
  scene.add(mist);

  /* ------------------------------------------------------------------ rayos de sol */
  const RAYS = 42;
  const down = toSun.clone().normalize().negate(); // del sol hacia el suelo
  const rayMat = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uAxis: { value: down },
      uColor: { value: new THREE.Color(0xffd48a) },
      uOpacity: { value: 1.7 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uAxis;
      varying vec2 vUv;
      varying float vSeed;
      varying vec3 vCenter;
      void main() {
        vUv = uv;
        vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float w = length(instanceMatrix[0].xyz);
        float len = length(instanceMatrix[1].xyz);
        vSeed = fract(sin(dot(center.xz, vec2(39.3468, 11.135))) * 24634.6345);
        vCenter = center;
        // el haz gira sobre su eje para mostrar siempre su cara a la cámara
        vec3 toCam = normalize(cameraPosition - center);
        vec3 side = normalize(cross(uAxis, toCam));
        vec3 world = center - uAxis * position.y * len + side * position.x * w;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uToSun;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vSeed;
      varying vec3 vCenter;
      ${NOISE_GLSL}
      void main() {
        float s = 1.0 - vUv.y;                                   // 0 = extremo del sol, 1 = suelo
        float x = vUv.x - 0.5;
        float across = exp(-x * x * 20.0);                       // borde suave del haz
        float along = smoothstep(0.0, 0.35, s) * (1.0 - smoothstep(0.78, 1.0, s));
        // la bruma que cruza el haz lo hace ondular
        float n = noise(vec2(vUv.x * 3.0 + vSeed * 7.0, s * 3.5 - uTime * 0.12));
        float pulse = 0.55 + 0.45 * sin(uTime * 0.23 + vSeed * 6.283);
        // más visibles al mirar hacia el sol
        vec3 V = normalize(vCenter - cameraPosition);
        float scatter = 0.3 + 0.7 * pow(max(dot(V, uToSun), 0.0), 1.5);
        float d = distance(vCenter, cameraPosition);
        float fade = smoothstep(6.0, 18.0, d) * (1.0 - smoothstep(95.0, 130.0, d));
        float a = across * along * (0.45 + 0.55 * n) * pulse * scatter * fade * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const rays = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), rayMat, RAYS);
  const up = toSun.clone().normalize();
  for (let i = 0; i < RAYS; i++) {
    const [gx, gz] = forestPoint(3);
    const len = R(34, 55), w = R(2.2, 6.5);
    // el haz termina en el suelo (gx, 0, gz) y sube hacia el sol
    const c = new THREE.Vector3(gx, groundHeight(gx, gz), gz).addScaledVector(up, len * 0.5);
    m.makeScale(w, len, 1).setPosition(c);
    rays.setMatrixAt(i, m);
  }
  rays.frustumCulled = false;
  rays.renderOrder = 2;
  scene.add(rays);

  return {
    update(t) {
      uniforms.uTime.value = t;
    },
  };
}
