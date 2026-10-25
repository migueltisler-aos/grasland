import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const small = Math.min(innerWidth, innerHeight) < 700;

/* ------------------------------------------------------------------ *
 * Kapitel-Ledger: Kamera und Weltzustand je Kapitel.                  *
 * Tageslauf: Morgendämmerung → Morgen → Erde → Abend → Nacht → neuer Tag *
 * ------------------------------------------------------------------ */
const CHAPTERS = [
  { id: 'ankommen',
    cam: { pos: [0, 1.15, 14], target: [0, 5.2, -40], fov: 42 },
    world: { skyTop: '#7b8aa3', skyHorizon: '#f4c381', sunColor: '#ffcf8c', sunDir: [0.08, 0.05, -1], sunInt: 2.2,
      hemiSky: '#d9c6a8', hemiGround: '#4b3a28', hemiInt: 0.75, fogColor: '#e8c597', fog: 0.016,
      exposure: 0.95, bloom: 0.4, stars: 0, roots: 0, house: 0.25, motes: 0.6, mist: 0.6, moteColor: '#fff0c8' } },
  { id: 'grasland',
    cam: { pos: [-2.2, 1.55, -6], target: [3.2, 1.25, -19], fov: 40 },
    world: { skyTop: '#86a0bd', skyHorizon: '#efcf98', sunColor: '#ffd8a0', sunDir: [0.45, 0.2, -1], sunInt: 2.4,
      hemiSky: '#d5dbd8', hemiGround: '#5a4632', hemiInt: 0.9, fogColor: '#dcc59c', fog: 0.009,
      exposure: 0.9, bloom: 0.3, stars: 0, roots: 0, house: 0.1, motes: 0.8, mist: 0.18, moteColor: '#fff4d6' } },
  { id: 'wurzeln',
    cam: { pos: [3.5, -5.2, -34], target: [2, -9.5, -47], fov: 46 },
    world: { skyTop: '#1c140d', skyHorizon: '#3a2716', sunColor: '#ffb36b', sunDir: [0.3, 0.3, -1], sunInt: 0.3,
      hemiSky: '#6a4b2c', hemiGround: '#1a120b', hemiInt: 0.35, fogColor: '#140e09', fog: 0.04,
      exposure: 1.0, bloom: 0.75, stars: 0, roots: 1, house: 0, motes: 0.5, mist: 0, moteColor: '#ffc46e' } },
  { id: 'herzenshof',
    cam: { pos: [15, 2.4, -72], target: [31, 3.2, -93], fov: 40 },
    world: { skyTop: '#3c3a58', skyHorizon: '#ec8d58', sunColor: '#ff9658', sunDir: [0.55, 0.035, -0.85], sunInt: 1.6,
      hemiSky: '#9a8fa8', hemiGround: '#3b2a20', hemiInt: 0.55, fogColor: '#9a7064', fog: 0.014,
      exposure: 1.0, bloom: 0.75, stars: 0.15, roots: 0.1, house: 1, motes: 1, mist: 0.25, moteColor: '#ffd27a' } },
  { id: 'stimme',
    cam: { pos: [4, 1.6, -98], target: [-14, 26, -185], fov: 52 },
    world: { skyTop: '#05070f', skyHorizon: '#1c2236', sunColor: '#8aa0d0', sunDir: [-0.4, -0.2, -1], sunInt: 0.0,
      hemiSky: '#56628a', hemiGround: '#14100c', hemiInt: 0.4, fogColor: '#121624', fog: 0.011,
      exposure: 1.05, bloom: 0.9, stars: 1, roots: 0.05, house: 0.8, motes: 1, mist: 0.15, moteColor: '#ffd36a' } },
  { id: 'zukunft',
    cam: { pos: [0, 2.6, -122], target: [0, 9, -320], fov: 44 },
    world: { skyTop: '#8194b2', skyHorizon: '#f7cd92', sunColor: '#ffd59a', sunDir: [0, 0.07, -1], sunInt: 2.6,
      hemiSky: '#e0cfb4', hemiGround: '#4b3a28', hemiInt: 0.85, fogColor: '#edcfa1', fog: 0.0095,
      exposure: 1.0, bloom: 0.6, stars: 0.05, roots: 0, house: 0.3, motes: 0.7, mist: 0.5, moteColor: '#fff0c8' } },
];

const NUM_KEYS = ['sunInt', 'hemiInt', 'fog', 'exposure', 'bloom', 'stars', 'roots', 'house', 'motes', 'mist'];
const COLOR_KEYS = ['skyTop', 'skyHorizon', 'sunColor', 'hemiSky', 'hemiGround', 'fogColor', 'moteColor'];
for (const c of CHAPTERS) {
  for (const k of COLOR_KEYS) c.world[k] = new THREE.Color(c.world[k]);
  c.world.sunDir = new THREE.Vector3(...c.world.sunDir).normalize();
}

/* ------------------------------ Hilfen ------------------------------ */
const smooth01 = (t) => t * t * (3 - 2 * t);
const clamp = THREE.MathUtils.clamp;
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function noise(x, z) {
  return Math.sin(x * 0.051 + Math.sin(z * 0.037) * 1.7) * 0.5 + Math.sin(z * 0.043 + Math.cos(x * 0.029) * 2.1) * 0.5;
}
// Flacher Talboden entlang der Kamerareise, sanfte Hügel zum Horizont hin.
function height(x, z) {
  const dx = Math.max(-35 - x, 0, x - 60);
  const dz = Math.max(-185 - z, 0, z - 40);
  const ramp = THREE.MathUtils.smoothstep(Math.hypot(dx, dz), 0, 120);
  const gentle = noise(x, z) * 0.35 + Math.sin(x * 0.21 + z * 0.13) * 0.08;
  const hills = (noise(x * 0.6 + 40, z * 0.6 - 20) * 0.5 + 0.6) * 22 * ramp + ramp * ramp * 8;
  return gentle + hills;
}

const FOG_GLSL = /* glsl */`
  uniform vec3 uFogColor; uniform float uFog;
  vec3 applyFog(vec3 col, vec3 world) {
    float d = length(world - cameraPosition);
    return mix(col, uFogColor, 1.0 - exp(-uFog * uFog * d * d));
  }`;

/* ------------------------------ Start ------------------------------ */
const canvas = document.getElementById('world');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('no-webgl', 'ready');
  setupDom(null);
  throw e;
}
let dprCap = small ? 1.4 : 1.75;
renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe8c597, 0.016);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 1200);

const shared = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color() },
  uFog: { value: 0.016 },
  uSunDir: { value: new THREE.Vector3(0, 0.05, -1) },
  uSunColor: { value: new THREE.Color() },
  uSunInt: { value: 2 },
  uHemiSky: { value: new THREE.Color() },
  uHemiGround: { value: new THREE.Color() },
  uHemiInt: { value: 1 },
};

const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);

/* ------------------------------ Licht ------------------------------ */
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
scene.add(sun, sun.target);

/* ------------------------------ Himmel ------------------------------ */
const skyUniforms = {
  uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uSoil: { value: new THREE.Color('#120b06') }, uUnder: { value: 0 }, uSunVis: { value: 1 },
  uFogColor: shared.uFogColor, uSunDir: shared.uSunDir, uSunColor: shared.uSunColor,
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uSoil, uFogColor, uSunDir, uSunColor;
      uniform float uUnder, uSunVis;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
        col = mix(col, uFogColor, (1.0 - smoothstep(-0.05, 0.14, h)) * 0.85);
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(s, 900.0) * 10.0 + pow(s, 80.0) * 0.4 + pow(s, 9.0) * 0.12) * uSunVis;
        col = mix(col, uSoil, uUnder);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -10;
scene.add(sky);

// Sterne
const starCount = 2600;
const starGeo = new THREE.BufferGeometry();
{
  const r = rng(11), pos = new Float32Array(starCount * 3), sz = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const u = r() * Math.PI * 2, v = Math.acos(1 - r() * 0.95);
    pos.set([Math.sin(v) * Math.cos(u) * 700, Math.cos(v) * 700, Math.sin(v) * Math.sin(u) * 700], i * 3);
    sz[i] = Math.pow(r(), 6) * 3.2 + 0.7;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
}
const starMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  uniforms: { uTime: shared.uTime, uStars: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
  vertexShader: /* glsl */`
    attribute float aSize; uniform float uTime, uPx; varying float vTw;
    void main() {
      vTw = 0.65 + 0.35 * sin(uTime * (1.0 + aSize) + position.x);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position.z = gl_Position.w * 0.9999;
      gl_PointSize = aSize * uPx;
    }`,
  fragmentShader: /* glsl */`
    uniform float uStars; varying float vTw;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * uStars * vTw;
      gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * a * 1.4, a);
    }`,
});
const stars = new THREE.Points(starGeo, starMat);
stars.renderOrder = -9;
sky.add(stars);

/* ------------------------------ Boden ------------------------------ */
{
  const geo = new THREE.PlaneGeometry(900, 900, 220, 220);
  geo.rotateX(-Math.PI / 2);
  geo.translate(10, 0, -60);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const soil = new THREE.Color('#4a3b26'), sage = new THREE.Color('#5d6a3c'), dry = new THREE.Color('#8c8048'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, height(x, z));
    const n = noise(x * 2.3, z * 2.1) * 0.5 + 0.5;
    c.copy(sage).lerp(dry, n * 0.7).lerp(soil, Math.max(0, noise(x * 4.1 + 9, z * 3.7) - 0.4));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  scene.add(ground);
}

/* ------------------------------ Gras ------------------------------ */
// Pfad der Kamera in xz, um das Gras dort zu verdichten, wo es gesehen wird.
const pathXZ = [];
for (let i = 0; i < CHAPTERS.length - 1; i++) {
  const a = CHAPTERS[i].cam, b = CHAPTERS[i + 1].cam;
  for (let t = 0; t <= 1; t += 0.1) {
    pathXZ.push([THREE.MathUtils.lerp(a.pos[0], b.pos[0], t), THREE.MathUtils.lerp(a.pos[2], b.pos[2], t)]);
    pathXZ.push([THREE.MathUtils.lerp(a.target[0], b.target[0], t) * 0.5 + THREE.MathUtils.lerp(a.pos[0], b.pos[0], t) * 0.5,
      THREE.MathUtils.lerp(a.target[2], b.target[2], t) * 0.5 + THREE.MathUtils.lerp(a.pos[2], b.pos[2], t) * 0.5]);
  }
}
const HOUSE = { x: 31, z: -93, rot: -0.65 };
function nearPath(x, z) {
  let m = 1e9;
  for (const [px, pz] of pathXZ) m = Math.min(m, (px - x) ** 2 + (pz - z) ** 2);
  return Math.sqrt(m);
}
{
  const count = small ? 26000 : 72000;
  const blade = new THREE.PlaneGeometry(1, 1, 1, 4);
  blade.translate(0, 0.5, 0);
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * 0.07 * (1 - bp.getY(i) * 0.92));
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.attributes.position = blade.attributes.position;
  geo.attributes.uv = blade.attributes.uv;
  const off = new Float32Array(count * 3), par = new Float32Array(count * 4);
  const r = rng(3);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 30) {
    const x = -50 + r() * 115, z = -185 + r() * 213;
    const d = nearPath(x, z);
    if (r() > 0.12 + 0.88 * Math.exp(-(d * d) / (2 * 14 * 14))) continue;
    // Hofplatz frei lassen
    const hx = x - HOUSE.x, hz = z - HOUSE.z;
    if (hx * hx + hz * hz < 110) continue;
    off.set([x, height(x, z) - 0.03, z], n * 3);
    const clump = noise(x * 1.7, z * 1.9) * 0.5 + 0.5;
    par.set([0.35 + r() * 0.45 + clump * 0.35, r() * Math.PI, r() * 6.28, r() * 0.6 + clump * 0.4], n * 4);
    n++;
  }
  geo.instanceCount = n;
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(par, 4));
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: shared,
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute vec3 aOffset; attribute vec4 aParams;
      varying float vY; varying float vTint; varying vec3 vWorld;
      void main() {
        vec3 p = position;
        float h = aParams.x;
        p.y *= h;
        float c = cos(aParams.y), s = sin(aParams.y);
        p.xz = mat2(c, -s, s, c) * p.xz;
        float bend = uv.y * uv.y;
        float w = sin(uTime * 1.1 + aOffset.x * 0.18 + aOffset.z * 0.12) * 0.55 + sin(uTime * 2.3 + aParams.z) * 0.18;
        p.x += w * bend * 0.32 * h;
        p.z += (w * 0.5 + 0.3) * bend * 0.25 * h;
        vec3 world = p + aOffset;
        vY = uv.y; vTint = aParams.w; vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uSunColor, uHemiSky, uHemiGround; uniform float uSunInt, uHemiInt;
      varying float vY; varying float vTint; varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        vec3 base = mix(vec3(0.05, 0.07, 0.02), vec3(0.09, 0.1, 0.03), vTint);
        vec3 tip = mix(vec3(0.42, 0.34, 0.14), vec3(0.26, 0.3, 0.1), vTint);
        vec3 alb = mix(base, tip, smoothstep(0.0, 1.0, vY));
        vec3 V = normalize(cameraPosition - vWorld);
        float back = pow(max(dot(-V, uSunDir), 0.0), 8.0);
        vec3 light = mix(uHemiGround, uHemiSky, vY) * uHemiInt + uSunColor * uSunInt * 0.28 * (0.35 + 0.65 * vY);
        vec3 col = alb * light + uSunColor * uSunInt * back * vY * vY * alb * 0.6;
        gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const grass = new THREE.Mesh(geo, mat);
  grass.frustumCulled = false;
  scene.add(grass);
}

/* ------------------------------ Wiesenblumen ------------------------------ */
// Mohn, Kamille und Kornblumen wie auf Marias Feldfotos – als Billboards, die mit dem Gras wiegen.
const flowerUniforms = { ...shared, uScale: { value: 800 } };
{
  const count = small ? 2200 : 6500, r = rng(23);
  const pos = new Float32Array(count * 3), par = new Float32Array(count * 4);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 40) {
    const x = -45 + r() * 105, z = -180 + r() * 205;
    const patch = noise(x * 0.9 + 13, z * 0.8 - 7);
    if (patch < 0.15 || r() > 0.2 + 0.8 * Math.exp(-(nearPath(x, z) ** 2) / (2 * 16 * 16))) continue;
    const hx = x - HOUSE.x, hz = z - HOUSE.z;
    if (hx * hx + hz * hz < 110) continue;
    const roll = r();
    const type = roll < 0.68 ? 0 : roll < 0.9 ? 1 : 2; // Mohn, Kamille, Kornblume
    pos.set([x, height(x, z), z], n * 3);
    par.set([0.32 + r() * 0.45, type, r() * 6.28, (type === 0 ? 0.06 : 0.04) * (0.8 + r() * 0.5)], n * 4);
    n++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
  geo.setAttribute('aParams', new THREE.BufferAttribute(par.subarray(0, n * 4), 4));
  const flowers = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: flowerUniforms,
    vertexShader: /* glsl */`
      uniform float uTime, uScale;
      attribute vec4 aParams; // Stängelhöhe, Art, Phase, Blütenradius
      varying float vType; varying vec3 vWorld; varying float vRot;
      void main() {
        float h = aParams.x;
        float w = sin(uTime * 1.1 + position.x * 0.18 + position.z * 0.12) * 0.55 + sin(uTime * 2.3 + aParams.z) * 0.18;
        vec3 p = position + vec3(w * 0.32 * h, h, (w * 0.5 + 0.3) * 0.25 * h);
        vType = aParams.y; vWorld = p; vRot = aParams.z;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Blüten direkt vor der Linse ausblenden, sonst werden sie zu roten Flecken
        gl_PointSize = -mv.z < 4.0 ? 0.0 : min(aParams.w * 2.0 * uScale / -mv.z, 26.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunColor, uHemiSky; uniform float uSunInt, uHemiInt;
      varying float vType; varying vec3 vWorld; varying float vRot;
      ${FOG_GLSL}
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = atan(q.y, q.x) + vRot;
        float d = length(q) * 2.0;
        vec3 col;
        if (vType < 0.5) {            // Mohn: vier weiche Blätter, dunkle Mitte
          if (d > 0.86 + 0.14 * cos(a * 4.0)) discard;
          col = mix(vec3(0.05, 0.02, 0.02), vec3(0.75, 0.06, 0.02), smoothstep(0.18, 0.34, d));
        } else if (vType < 1.5) {     // Kamille: viele schmale Blätter, gelbes Herz
          if (d > 0.62 + 0.38 * pow(abs(cos(a * 7.0)), 0.6)) discard;
          col = d < 0.36 ? vec3(0.85, 0.6, 0.05) : vec3(0.9, 0.88, 0.8);
        } else {                      // Kornblume: gefranst, blau
          if (d > 0.7 + 0.3 * step(0.0, cos(a * 9.0))) discard;
          col = mix(vec3(0.08, 0.1, 0.45), vec3(0.2, 0.35, 0.85), smoothstep(0.1, 0.6, d));
        }
        vec3 light = uHemiSky * uHemiInt * 0.7 + uSunColor * uSunInt * 0.22;
        gl_FragColor = vec4(applyFog(col * light, vWorld), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  flowers.frustumCulled = false;
  scene.add(flowers);
}

/* ------------------------------ Bodennebel ------------------------------ */
const mistUniforms = { uTime: shared.uTime, uMist: { value: 0.5 }, uColor: { value: new THREE.Color() } };
const mistMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: mistUniforms,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uMist; uniform vec3 uColor; varying vec3 vW;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
    void main() {
      vec2 q = vW.xz * 0.045 + vec2(uTime * 0.012, uTime * 0.007);
      float a = smoothstep(0.32, 0.78, fbm(q + fbm(q * 0.7))) * uMist;
      float d = length(vW - cameraPosition);
      a *= smoothstep(3.0, 16.0, d) * (1.0 - smoothstep(160.0, 320.0, d));
      gl_FragColor = vec4(uColor, a * 0.85);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
for (const [y, s] of [[0.5, 1], [1.5, 1.3]]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mistMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(10 * s, y, -80);
  m.renderOrder = 5;
  scene.add(m);
}

/* ------------------------------ Bäume ------------------------------ */
const foliageMat = new THREE.MeshStandardMaterial({ color: '#3f4626', roughness: 0.95, flatShading: true });
const barkMat = new THREE.MeshStandardMaterial({ color: '#3b2d20', roughness: 1 });
function canopy(r, seed, blobs = 7) {
  const rand = rng(seed), parts = [];
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(r * (0.45 + rand() * 0.35), 1);
    const a = rand() * Math.PI * 2, rr = r * rand() * 0.75;
    g.scale(1, 0.8, 1);
    g.translate(Math.cos(a) * rr, (rand() - 0.3) * r * 0.6, Math.sin(a) * rr);
    parts.push(g);
  }
  return mergeGeometries(parts);
}
// Die alte Eiche – über ihren Wurzeln taucht die Reise in die Erde.
const OAK = { x: 2, z: -46 };
{
  const y = height(OAK.x, OAK.z);
  const oak = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 6, 9), barkMat);
  trunk.position.y = 3;
  const limbs = [];
  for (const [rx, rz, l] of [[0.5, 0.2, 4], [-0.6, -0.1, 3.6], [0.1, -0.7, 3.4], [-0.2, 0.65, 3.2]]) {
    const g = new THREE.CylinderGeometry(0.12, 0.3, l, 6);
    g.translate(0, l / 2, 0);
    g.rotateX(rx); g.rotateZ(rz);
    g.translate(0, 5.2, 0);
    limbs.push(g);
  }
  oak.add(trunk, new THREE.Mesh(mergeGeometries(limbs), barkMat));
  const crown = new THREE.Mesh(canopy(5.2, 21, 11), foliageMat);
  crown.position.y = 8.6;
  oak.add(crown);
  oak.position.set(OAK.x, y, OAK.z);
  scene.add(oak);
}
// Baumreihen am Horizont
{
  const geo = canopy(1, 5, 5);
  const r = rng(9), dummy = new THREE.Object3D(), spots = [];
  for (let i = 0; i < 300; i++) spots.push([-260 + r() * 540, -215 - r() * 110]);
  for (let i = 0; i < 80; i++) spots.push([-58 - r() * 30, -180 + r() * 210]);
  for (let i = 0; i < 80; i++) spots.push([70 + r() * 35, -180 + r() * 210]);
  const trees = new THREE.InstancedMesh(geo, foliageMat, spots.length);
  spots.forEach(([x, z], i) => {
    const s = 3 + r() * 5;
    dummy.position.set(x, height(x, z) + s * 0.7, z);
    dummy.scale.set(s, s * (0.9 + r() * 0.5), s);
    dummy.rotation.y = r() * 6;
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trees);
}

/* ------------------------------ Koppelzaun ------------------------------ */
const woodMat = new THREE.MeshStandardMaterial({ color: '#8a7356', roughness: 0.9 });
{
  const posts = [], rails = [];
  const line = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 2.6);
    for (let i = 0; i <= n; i++) posts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
    for (let i = 0; i < n; i++) {
      const ax = x0 + (x1 - x0) * i / n, az = z0 + (z1 - z0) * i / n;
      const bx = x0 + (x1 - x0) * (i + 1) / n, bz = z0 + (z1 - z0) * (i + 1) / n;
      rails.push([ax, az, bx, bz, 0.55], [ax, az, bx, bz, 1.05]);
    }
  };
  line(7.5, 1, 7.5, -36);
  line(7.5, -36, 22, -36);
  const d = new THREE.Object3D();
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.35, 0.14), woodMat, posts.length);
  posts.forEach(([x, z], i) => { d.position.set(x, height(x, z) + 0.6, z); d.rotation.set(0, 0, (noise(x, z) * 0.05)); d.scale.set(1, 1, 1); d.updateMatrix(); postMesh.setMatrixAt(i, d.matrix); });
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.05), woodMat, rails.length);
  rails.forEach(([ax, az, bx, bz, y], i) => {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    d.position.set(mx, height(mx, mz) + y, mz);
    d.rotation.set(0, -Math.atan2(bz - az, bx - ax), 0);
    d.scale.set(Math.hypot(bx - ax, bz - az), 1, 1);
    d.updateMatrix();
    railMesh.setMatrixAt(i, d.matrix);
  });
  scene.add(postMesh, railMesh);
}

/* ------------------------------ Das Pferd (Linienzeichnung) ------------------------------ */
// Eine goldene Linie, die sich beim Scrollen selbst zeichnet – wie im GRASLAND-Logo.
// Tagsüber dunkle Tusche wie im Logo, im Dunkeln goldenes Leuchten.
const lineMaterial = (uniforms, additive) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms,
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uDraw, uTime, uGlow; varying vec2 vUv;
    void main() {
      if (vUv.x > uDraw) discard;
      float head = smoothstep(uDraw - 0.04, uDraw, vUv.x) * step(uDraw, 0.999);
      vec3 ink = vec3(0.12, 0.05, 0.012);
      vec3 gold = vec3(1.0, 0.68, 0.32) * (1.4 + 0.25 * sin(vUv.x * 60.0 - uTime * 3.0));
      vec3 col = mix(ink, gold, uGlow) + vec3(1.0, 0.7, 0.35) * head * 4.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const horseUniforms = { uDraw: { value: 0 }, uTime: shared.uTime, uGlow: { value: 0 } };
const skyHorseUniforms = { uDraw: { value: 0 }, uTime: shared.uTime, uGlow: { value: 1 } };
const lineMat = lineMaterial(horseUniforms, false);
let skyHorseStars;
{
  const body = [
    [-1.15, 1.45], [-0.8, 1.53], [-0.3, 1.47], [0.2, 1.5], [0.55, 1.62], [0.75, 1.85], [0.95, 2.1], [1.13, 2.27],
    [1.17, 2.43], [1.25, 2.3], [1.45, 2.06], [1.6, 1.79], [1.55, 1.68], [1.4, 1.71], [1.2, 1.86], [0.95, 1.56],
    [0.86, 1.25], [0.8, 1.0], [0.78, 0.56], [0.8, 0.5], [0.78, 0.13], [0.86, 0.0], [0.68, 0.0], [0.66, 0.13],
    [0.64, 0.55], [0.62, 0.95], [0.3, 0.98], [-0.2, 0.97], [-0.55, 1.02], [-0.62, 0.85], [-0.66, 0.5], [-0.62, 0.13],
    [-0.57, 0.0], [-0.75, 0.0], [-0.79, 0.13], [-0.86, 0.48], [-0.93, 0.6], [-0.99, 0.95], [-1.12, 1.2], [-1.15, 1.45],
    [-1.3, 1.12], [-1.34, 0.72], [-1.26, 0.5],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const mane = [[0.6, 1.66], [0.72, 1.95], [0.92, 2.22], [1.08, 2.36]].map(([x, y]) => new THREE.Vector3(x - 0.06, y + 0.04, 0.02));
  const tube = (pts, r, seg) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3), seg, r, 5, false);
  const bodyGeo = tube(body, 0.016, 700), maneGeo = tube(mane, 0.011, 60);
  const horse = new THREE.Group();
  horse.add(new THREE.Mesh(bodyGeo, lineMat), new THREE.Mesh(maneGeo, lineMat));
  horse.scale.setScalar(1.12);
  horse.position.set(4.2, height(4.2, -19.5), -19.5);
  horse.rotation.y = -0.39;
  scene.add(horse);

  // Dasselbe Pferd kehrt nachts als Sternbild zurück.
  const skyMat = lineMaterial(skyHorseUniforms, true);
  const skyHorse = new THREE.Group();
  const thin = tube(body, 0.006, 700);
  skyHorse.add(new THREE.Mesh(thin, skyMat));
  const starPts = body.filter((_, i) => i % 3 === 0).map((p) => p.clone());
  const sg = new THREE.BufferGeometry().setFromPoints(starPts);
  skyHorseStars = new THREE.Points(sg, new THREE.PointsMaterial({
    color: '#fff3d6', size: 5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  skyHorse.add(skyHorseStars);
  skyHorse.scale.setScalar(24);
  skyHorse.position.set(-34, 58, -250);
  skyHorse.lookAt(4, 1.6, -98);
  scene.add(skyHorse);
}

/* ------------------------------ Wurzelnetz ------------------------------ */
const rootUniforms = { uTime: shared.uTime, uReveal: { value: 0 }, uFogColor: shared.uFogColor, uFog: shared.uFog };
let rootMaxDist = 1;
{
  const r = rng(42), parts = [];
  const down = new THREE.Vector3(0, -1, 0);
  const grow = (start, dir, len, radius, depth, dist) => {
    const steps = Math.max(4, Math.round(len / 0.5));
    const pts = [start.clone()], d = dir.clone(), p = start.clone();
    for (let i = 0; i < steps; i++) {
      d.add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.55)).addScaledVector(down, 0.1).normalize();
      p.addScaledVector(d, len / steps);
      pts.push(p.clone());
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps * 2, Math.max(radius, 0.008), 4, false);
    const uv = geo.attributes.uv, ad = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) ad[i] = dist + uv.getX(i) * len;
    geo.setAttribute('aDist', new THREE.BufferAttribute(ad, 1));
    // Radius zur Spitze hin verjüngen
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const k = (1 - uv.getX(i) * 0.7) - 1;
      pos.setXYZ(i, pos.getX(i) + nor.getX(i) * radius * k, pos.getY(i) + nor.getY(i) * radius * k, pos.getZ(i) + nor.getZ(i) * radius * k);
    }
    geo.deleteAttribute('normal');
    parts.push(geo);
    rootMaxDist = Math.max(rootMaxDist, dist + len);
    if (depth >= 5) return;
    const kids = depth < 2 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const j = Math.floor(steps * (0.3 + r() * 0.6));
      const nd = d.clone().add(new THREE.Vector3(r() - 0.5, r() * -0.6, r() - 0.5).multiplyScalar(1.6)).normalize();
      grow(pts[j], nd, len * (0.58 + r() * 0.15), radius * 0.58, depth + 1, dist + (len * j) / steps);
    }
  };
  const base = new THREE.Vector3(OAK.x, -0.2, OAK.z);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + r() * 0.4;
    const dir = new THREE.Vector3(Math.cos(a) * 0.85, -0.55, Math.sin(a) * 0.85).normalize();
    grow(base.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6)), dir, 6.5 + r() * 2, 0.16, 0, 0);
  }
  const roots = new THREE.Mesh(mergeGeometries(parts), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: rootUniforms,
    vertexShader: /* glsl */`
      attribute float aDist; varying float vDist; varying vec3 vW;
      void main() { vDist = aDist; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uReveal; uniform vec3 uFogColor; uniform float uFog;
      varying float vDist; varying vec3 vW;
      void main() {
        if (vDist > uReveal) discard;
        float pulse = pow(0.5 + 0.5 * sin(vDist * 1.4 - uTime * 2.0), 6.0);
        float tip = smoothstep(uReveal - 1.2, uReveal, vDist);
        vec3 gold = vec3(1.0, 0.66, 0.3);
        vec3 col = gold * (0.12 + pulse * 0.7 + tip * 1.6);
        float d = length(vW - cameraPosition);
        col *= exp(-uFog * uFog * d * d * 0.8);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  roots.frustumCulled = false;
  scene.add(roots);
}

/* ------------------------------ Herzenshof ------------------------------ */
const windowMat = new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#ffb45e', emissiveIntensity: 0 });
const lanternMat = new THREE.MeshStandardMaterial({ color: '#3a2a18', emissive: '#ffc670', emissiveIntensity: 0 });
const houseLight = new THREE.PointLight('#ffb062', 0, 30, 1.6);
{
  const plaster = new THREE.MeshStandardMaterial({ color: '#e3d3b6', roughness: 0.95 });
  const tiles = new THREE.MeshStandardMaterial({ color: '#6e3b2a', roughness: 0.85 });
  const barnWood = new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 0.95 });
  const hof = new THREE.Group();
  const building = (w, h, d, wall, roofMat, pitch) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wall);
    body.position.y = h / 2;
    const ridge = (d / 2) * Math.tan(pitch);
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, ridge)]);
    const gable = new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false });
    gable.rotateY(Math.PI / 2);
    gable.translate(-w / 2, h, 0);
    const slabLen = (d / 2) / Math.cos(pitch) + 0.5;
    for (const side of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.22, slabLen), roofMat);
      slab.position.set(0, h + ridge / 2 + 0.05, side * d / 4);
      slab.rotation.x = side * pitch;
      g.add(slab);
    }
    g.add(body, new THREE.Mesh(gable, wall));
    return g;
  };
  const house = building(10, 4.4, 7, plaster, tiles, 0.72);
  const winGeo = new THREE.PlaneGeometry(0.9, 1.15);
  for (const x of [-3.6, -1.6, 2, 3.8]) {
    const w = new THREE.Mesh(winGeo, windowMat);
    w.position.set(x, 1.7, 3.51);
    house.add(w);
  }
  for (const x of [-2.5, 0.6, 3]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.9), windowMat);
    w.position.set(x, 3.45, 3.51);
    house.add(w);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), windowMat);
  door.position.set(0.1, 1.1, 3.52);
  house.add(door);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), plaster);
  chimney.position.set(2.8, 6.6, -0.8);
  house.add(chimney);
  const barn = building(7, 3.8, 8.5, barnWood, tiles, 0.62);
  barn.position.set(-10.5, 0, -1.5);
  barn.rotation.y = 0.12;
  const barnDoor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.6), windowMat);
  barnDoor.position.set(0, 1.3, 4.27);
  barn.add(barnDoor);
  hof.add(house, barn);

  // Lichterkette zwischen Haus und Scheune
  const a = new THREE.Vector3(-5.2, 3.2, 4.6), b = new THREE.Vector3(5.5, 3.4, 5.2);
  const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6);
  for (const p of [a, b]) {
    const m = new THREE.Mesh(pole, woodMat);
    m.position.set(p.x, 1.7, p.z);
    hof.add(m);
  }
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), lanternMat, 26);
  const dd = new THREE.Object3D();
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    dd.position.lerpVectors(a, b, t);
    dd.position.y -= Math.sin(t * Math.PI) * 0.9;
    dd.updateMatrix();
    bulbs.setMatrixAt(i, dd.matrix);
  }
  hof.add(bulbs);
  houseLight.position.set(0, 3, 7);
  hof.add(houseLight);

  // Hochbeete
  const bed = new THREE.BoxGeometry(3.2, 0.5, 1.2);
  for (const [x, z] of [[-3, 9], [1.2, 9.5], [5.2, 9]]) {
    const m = new THREE.Mesh(bed, woodMat);
    m.position.set(x, 0.25, z);
    hof.add(m);
    const leaf = new THREE.Mesh(canopy(0.9, x * 13 + 7, 4), foliageMat);
    leaf.scale.set(1.5, 0.35, 0.55);
    leaf.position.set(x, 0.65, z);
    hof.add(leaf);
  }

  // Ein paar Obstbäume am Hof
  const fruit = canopy(1.8, 77, 6);
  for (const [x, z] of [[-17, 6], [-14, 12], [9, -6], [12, 4]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.4, 6), barkMat);
    t.position.set(x, 1.2, z);
    const c = new THREE.Mesh(fruit, foliageMat);
    c.position.set(x, 3.3, z);
    hof.add(t, c);
  }
  hof.position.set(HOUSE.x, height(HOUSE.x, HOUSE.z), HOUSE.z);
  hof.rotation.y = HOUSE.rot;
  scene.add(hof);
}

/* ------------------------------ Schwebeteilchen ------------------------------ */
const moteUniforms = { uTime: shared.uTime, uMotes: { value: 0.6 }, uColor: { value: new THREE.Color() }, uPx: { value: renderer.getPixelRatio() } };
{
  const n = small ? 900 : 2200, r = rng(17);
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (i % 5 === 0) { // um die Wurzeln
      x = OAK.x + (r() - 0.5) * 22; y = -1 - r() * 14; z = OAK.z + (r() - 0.5) * 22;
    } else if (i % 5 === 1) { // um den Hof
      x = HOUSE.x + (r() - 0.5) * 34; z = HOUSE.z + (r() - 0.5) * 34; y = height(x, z) + 0.3 + r() * 4;
    } else {
      const p = pathXZ[Math.floor(r() * pathXZ.length)];
      x = p[0] + (r() - 0.5) * 30; z = p[1] + (r() - 0.5) * 30; y = height(x, z) + 0.2 + r() * 3.5;
    }
    pos.set([x, y, z], i * 3);
    seed[i] = r();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const motes = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: moteUniforms,
    vertexShader: /* glsl */`
      uniform float uTime, uPx; attribute float aSeed; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * (0.15 + aSeed * 0.25) + aSeed * 40.0;
        p += vec3(sin(t) * 0.6, sin(t * 1.3) * 0.35, cos(t * 0.8) * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 30.0), 3.0);
        gl_PointSize = (2.0 + aSeed * 3.5) * uPx * (14.0 / -mv.z);
      }`,
    fragmentShader: /* glsl */`
      uniform float uMotes; uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uMotes;
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
  }));
  motes.frustumCulled = false;
  scene.add(motes);
}

/* ------------------------------ Bilder im Feld ------------------------------ */
const frames = [];
{
  const frameMat = new THREE.MeshStandardMaterial({ color: '#5e4730', roughness: 0.8 });
  const list = [
    ['nebel-morgen', 'Nebel über dem Löwenberger Land bei Sonnenaufgang', 5.4, 3.5, -0.55, 2.4],
    ['maria-pferde', 'Maria Schmitz mit zwei Pferden', -14, -4, 0.85, 1.15],
    ['maedchen-pferd', 'Grasendes Pferd im Abendlicht mit Zitat einer Mutter', 10.5, -9, -0.7, 1.45],
    ['mohnfeld-sonne', 'Mohnfeld im Gegenlicht', 15, -38, -0.5, 2.3],
    ['nebel-baeume', 'Baumgruppen im Morgennebel', 12.5, -24, -0.6, 2.3],
    ['mohn-kamille', 'Mohn und Kamille am Feldrand', -9, -28, 0.5, 2.1],
  ];
  for (const [img, alt, x, z, rot, w] of list) {
    const g = new THREE.Group();
    const tex = texLoader.load(`assets/img/${img}.jpg`, (t) => {
      const aspect = t.image.width / t.image.height;
      const h = w / aspect;
      pic.scale.set(w, h, 1);
      back.scale.set(w + 0.12, h + 0.12, 1);
      pic.position.y = back.position.y = 0.95 + h / 2;
      for (const leg of legs) leg.scale.y = 0.95 + h * 0.4;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const picMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 });
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), picMat);
    pic.position.z = 0.04;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.06), frameMat);
    const legs = [-0.35, 0.35].map((lx) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1, 0.07), frameMat);
      leg.geometry.translate(0, 0.5, 0);
      leg.position.set(lx * w, 0, -0.05);
      g.add(leg);
      return leg;
    });
    g.add(back, pic);
    g.position.set(x, height(x, z), z);
    g.rotation.y = rot;
    scene.add(g);
    pic.userData = { img, alt, group: g, hover: 0 };
    frames.push(pic);
  }
}

/* ------------------------------ Nachbearbeitung ------------------------------ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.75, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------ Kamera-Rig ------------------------------ */
const portrait = () => camera.aspect < 0.8;
const camPos = new THREE.CatmullRomCurve3(CHAPTERS.map((c) => new THREE.Vector3(...c.cam.pos)), false, 'centripetal');
const camTgt = new THREE.CatmullRomCurve3(CHAPTERS.map((c) => new THREE.Vector3(...c.cam.target)), false, 'centripetal');
const pointer = new THREE.Vector2(), parallax = new THREE.Vector2();
const tmpP = new THREE.Vector3(), tmpT = new THREE.Vector3(), tmpD = new THREE.Vector3();

function placeCamera(progress) {
  const n = CHAPTERS.length - 1;
  const i = Math.min(Math.floor(progress), n - 1);
  const local = smooth01(clamp(progress - i, 0, 1));
  const u = (i + local) / n;
  camPos.getPoint(u, tmpP);
  camTgt.getPoint(u, tmpT);
  let fov = THREE.MathUtils.lerp(CHAPTERS[i].cam.fov, CHAPTERS[i + 1].cam.fov, local);
  if (portrait()) {
    fov += 16;
    tmpD.subVectors(tmpP, tmpT).normalize();
    tmpP.addScaledVector(tmpD, 1.2);
  }
  const k = reduceMotion ? 0 : 1;
  camera.position.copy(tmpP);
  camera.lookAt(tmpT);
  camera.translateX(parallax.x * 0.35 * k);
  camera.translateY(parallax.y * 0.18 * k);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  flowerUniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  return { i, local };
}

const W = {};
const tmpC = new THREE.Color();
function applyWorld(i, t) {
  const a = CHAPTERS[i].world, b = CHAPTERS[i + 1].world;
  for (const k of NUM_KEYS) W[k] = THREE.MathUtils.lerp(a[k], b[k], t);
  for (const k of COLOR_KEYS) (W[k] ||= new THREE.Color()).copy(a[k]).lerp(b[k], t);
  (W.sunDir ||= new THREE.Vector3()).copy(a.sunDir).lerp(b.sunDir, t).normalize();

  // Unter der Erde: Himmel weicht dem Boden, Nebel wird dicht und dunkel.
  const under = THREE.MathUtils.smoothstep(-camera.position.y, -0.6, 1.2);
  skyUniforms.uUnder.value = under;
  skyUniforms.uTop.value.copy(W.skyTop);
  skyUniforms.uHorizon.value.copy(W.skyHorizon);
  skyUniforms.uSunVis.value = THREE.MathUtils.smoothstep(W.sunDir.y, -0.08, 0.03) * clamp(W.sunInt / 2.2, 0.15, 1.2);

  shared.uFogColor.value.copy(W.fogColor);
  shared.uFog.value = W.fog;
  shared.uSunDir.value.copy(W.sunDir);
  shared.uSunColor.value.copy(W.sunColor);
  shared.uSunInt.value = W.sunInt;
  shared.uHemiSky.value.copy(W.hemiSky);
  shared.uHemiGround.value.copy(W.hemiGround);
  shared.uHemiInt.value = W.hemiInt;
  scene.fog.color.copy(W.fogColor);
  scene.fog.density = W.fog;

  hemi.color.copy(W.hemiSky);
  hemi.groundColor.copy(W.hemiGround);
  hemi.intensity = W.hemiInt * 1.2;
  sun.color.copy(W.sunColor);
  sun.intensity = W.sunInt * clamp(W.sunDir.y * 6 + 0.5, 0, 1);
  sun.position.copy(camera.position).addScaledVector(W.sunDir, 100);
  sun.target.position.copy(camera.position);

  starMat.uniforms.uStars.value = W.stars;
  rootUniforms.uReveal.value = W.roots * rootMaxDist * 1.02;
  windowMat.emissiveIntensity = W.house * 1.3;
  lanternMat.emissiveIntensity = W.house * 4;
  horseUniforms.uGlow.value = Math.max(1 - clamp(W.sunInt / 1.8, 0, 1), under);
  const night = clamp((W.stars - 0.25) / 0.7, 0, 1);
  skyHorseUniforms.uDraw.value = night;
  skyHorseStars.material.opacity = night;
  houseLight.intensity = W.house * 40;
  moteUniforms.uMotes.value = W.motes;
  moteUniforms.uColor.value.copy(W.moteColor);
  mistUniforms.uMist.value = W.mist * (1 - under);
  mistUniforms.uColor.value.copy(tmpC.copy(W.fogColor).lerp(W.sunColor, 0.25));
  renderer.toneMappingExposure = W.exposure;
  bloom.strength = W.bloom;
}

/* ------------------------------ Interaktion ------------------------------ */
const raycaster = new THREE.Raycaster();
let hovered = null;
let state = { exact: 0, smooth: 0 };
addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}, { passive: true });
canvas.addEventListener('click', () => { if (hovered) openLightbox(hovered.userData.img, hovered.userData.alt); });
// Klicks gehen durch die Textebene hindurch auf die Leinwand
document.querySelector('main').addEventListener('click', (e) => {
  if (e.target.closest('.card, a, button')) return;
  if (hovered) openLightbox(hovered.userData.img, hovered.userData.alt);
});

function updateHover() {
  let hit = null;
  if (!coarse && state.exact < 1.7) {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(frames, false);
    if (hits.length && hits[0].distance < 40) hit = hits[0].object;
  }
  if (hit !== hovered) {
    hovered = hit;
    document.body.classList.toggle('hovering', !!hit);
  }
  for (const f of frames) {
    f.userData.hover += ((f === hovered ? 1 : 0) - f.userData.hover) * 0.12;
    f.material.emissiveIntensity = 0.12 + f.userData.hover * 0.45;
    f.userData.group.position.y = height(f.userData.group.position.x, f.userData.group.position.z) + f.userData.hover * 0.12;
  }
}

/* ------------------------------ DOM ------------------------------ */
const lightbox = document.querySelector('.lightbox');
function openLightbox(img, alt) {
  lightbox.querySelector('img').src = `assets/img/${img}.jpg`;
  lightbox.querySelector('img').alt = alt;
  lightbox.querySelector('.caption').textContent = alt;
  lightbox.showModal();
}
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });

function setupDom(conductor) {
  document.querySelectorAll('.thumbs button').forEach((b) =>
    b.addEventListener('click', () => openLightbox(b.dataset.img, b.dataset.alt)));
  const sections = [...document.querySelectorAll('.chapter')];
  const links = [...document.querySelectorAll('.chapters a')];
  links.forEach((a) => a.addEventListener('click', (e) => {
    if (!conductor) return;
    e.preventDefault();
    conductor.goTo(Number(a.dataset.i));
    history.replaceState(null, '', a.getAttribute('href'));
  }));
  return (index) => {
    sections.forEach((s, i) => s.classList.toggle('is-active', i === index));
    links.forEach((a, i) => a.setAttribute('aria-current', String(i === index)));
    document.body.classList.toggle('tone-dark', sections[index].dataset.tone === 'dark');
    document.body.classList.toggle('at-start', index === 0);
  };
}

/* ------------------------------ Schleife ------------------------------ */
// Ein Kapitel gilt als aktiv, sobald es näher liegt als seine Nachbarn.
let markChapter = () => {}, shown = -1;
const conductor = window.createScrollConductor({
  sections: document.querySelectorAll('.chapter'),
  damping: 3.2,
  reducedMotion: reduceMotion,
  onUpdate(s) {
    state = s;
    const nearest = Math.round(s.exact);
    if (nearest !== shown) markChapter((shown = nearest));
  },
});
markChapter = setupDom(conductor);

const clock = new THREE.Clock();
let frameTimes = [], lastGovern = 0;
function frame() {
  if (document.hidden) return;
  const dt = Math.min(clock.getDelta(), 1 / 30);
  if (!reduceMotion) shared.uTime.value += dt;
  parallax.lerp(coarse ? parallax.set(0, 0) : pointer, 1 - Math.exp(-2.5 * dt));

  const { i, local } = placeCamera(state.smooth);
  applyWorld(i, local);
  horseUniforms.uDraw.value = clamp((state.smooth - 0.3) / 0.65, 0, 1);
  sky.position.copy(camera.position);
  updateHover();
  composer.render();

  // Qualitätsregler: erst Auflösung senken, dann Bloom abschalten.
  frameTimes.push(dt);
  const now = performance.now();
  if (now - lastGovern > 2500 && frameTimes.length > 60) {
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    if (avg > 1 / 40 && dprCap > 1) {
      dprCap = Math.max(1, dprCap - 0.25);
      resize();
    } else if (avg > 1 / 30 && bloom.enabled) {
      bloom.enabled = false;
    }
    frameTimes = [];
    lastGovern = now;
  }
}

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  starMat.uniforms.uPx.value = moteUniforms.uPx.value = renderer.getPixelRatio();
}
addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });

let started = false;
function start() {
  if (started) return;
  started = true;
  conductor.start();
  renderer.setAnimationLoop(frame);
  requestAnimationFrame(() => document.body.classList.add('ready'));
}
manager.onLoad = start;
setTimeout(start, 6000); // falls ein Bild hängt, startet die Welt trotzdem

// Für Prüfungen von außen
window.__world = { conductor, CHAPTERS };
