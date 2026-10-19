// The look of the streaming world: clean, bright, slightly toy-like (early Apple Maps / the "Hello
// World" game). Materials are shared across chunks so the GPU compiles each shader once.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared } from '../engine.ts';

const NOISE = /* glsl */ `
  float eh21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float evn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(eh21(i), eh21(i + vec2(1, 0)), f.x), mix(eh21(i + vec2(0, 1)), eh21(i + vec2(1, 1)), f.x), f.y); }
`;

let buildingMat: THREE.MeshStandardMaterial | null = null;
/**
 * Procedural facades from per-vertex facade coordinates (aFac = along-wall meters, height above the
 * building's ground, wall length (0 flat roof, -1 pitched roof, -2 gable end), building height) and a
 * per-building seed (aSeed; +2 marks a glass tower).
 */
export function buildingMaterial() {
  if (buildingMat) return buildingMat;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFac; attribute float aSeed; varying vec4 vFac; flat varying float vSeed; varying float vWy;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFac = aFac; vSeed = aSeed; vWy = (modelMatrix * vec4(position, 1.0)).y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec4 vFac; flat varying float vSeed; varying float vWy;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float glassB = step(1.5, vSeed);
        float seed = fract(vSeed);
        float u = vFac.x, v = vFac.y, W = vFac.z, Hh = vFac.w;
        float isWall = step(0.5, W);
        float isPitch = step(-1.5, W) * step(W, -0.5);
        vec3 base = diffuseColor.rgb;
        float win = 0.0; float lit = 0.0; float shopLit = 0.0; float rough = 0.86;
        if (isWall > 0.5) {
          if (glassB > 0.5) {
            // Curtain wall: mullions, spandrels, sky gradient.
            float floorH = 3.9;
            float fv = v / floorH;
            float mull = step(fract(u / 1.6), 0.035) + step(0.965, fract(u / 1.6));
            float spandrel = step(fract(fv), 0.13);
            vec3 sky = mix(base * 0.7, base * 1.05 + vec3(0.04, 0.05, 0.07), clamp(v / max(Hh, 1.0), 0.0, 1.0));
            sky *= 0.92 + 0.16 * eh21(vec2(floor(u / 1.6), floor(fv)) + seed * 91.0);
            vec3 frameC = base * 0.55 + vec3(0.06);
            diffuseColor.rgb = mix(sky, frameC, clamp(mull * 0.9 + spandrel * 0.75, 0.0, 1.0));
            win = 1.0 - clamp(mull + spandrel, 0.0, 1.0);
            rough = mix(0.6, 0.25, win);
            float hs = eh21(vec2(floor(u / 1.6), floor(fv)) + vec2(seed * 57.0, 3.0));
            lit = win * step(0.62, hs) * step(1.0, v);
          } else {
            float tall = step(7.0, Hh);
            float floorH = mix(3.0, 3.6, fract(seed * 7.13));
            float groundH = tall * mix(4.0, 4.8, fract(seed * 3.31));
            float bayW = mix(2.5, 3.5, fract(seed * 5.71));
            float bays = max(1.0, floor((W - 0.9) / bayW));
            float margin = (W - bays * bayW) * 0.5;
            float fu = (u - margin) / bayW;
            float fv = (v - groundH) / floorH;
            vec2 cell = floor(vec2(fu, fv));
            vec2 fr = fract(vec2(fu, fv));
            float inBays = step(0.0, fu) * step(fu, bays) * step(1.6, W);
            float ww = mix(0.4, 0.6, fract(seed * 11.1)) * 0.5, wh = mix(0.46, 0.62, fract(seed * 13.7)) * 0.5;
            float band = step(groundH + 0.3, v) * step(v, Hh - 1.0) * inBays;
            float pane = step(abs(fr.x - 0.5), ww) * step(abs(fr.y - 0.5), wh) * band;
            float frame = step(abs(fr.x - 0.5), ww + 0.05) * step(abs(fr.y - 0.5), wh + 0.06) * band - pane;
            float sill = step(abs(fr.x - 0.5), ww + 0.08) * step(abs(fr.y - (0.5 - wh - 0.05)), 0.035) * band;
            // Ground floor: shop windows with a dark frame, a lighter band above.
            float shopU = fract(u / 4.2);
            float shop = tall * step(0.35, v) * step(v, groundH - 0.75) * step(abs(shopU - 0.5), 0.4) * step(3.0, W);
            float cornice = step(Hh - 0.55, v) + tall * step(abs(v - groundH + 0.15), 0.22);
            vec3 glassC = mix(vec3(0.12, 0.16, 0.22), vec3(0.34, 0.45, 0.56), smoothstep(0.1, 1.0, fr.y));
            glassC *= 0.85 + 0.3 * eh21(cell + seed * 40.0);
            vec3 shopC = mix(vec3(0.12, 0.15, 0.19), vec3(0.42, 0.52, 0.62), fract((v - 0.35) / max(groundH - 1.1, 0.1)));
            vec3 frameC = mix(base, vec3(0.95, 0.93, 0.88), 0.75);
            vec3 c = base;
            c = mix(c, base * 1.13 + 0.03, clamp(cornice, 0.0, 1.0));
            c = mix(c, frameC, clamp(frame + sill, 0.0, 1.0));
            c = mix(c, glassC, pane);
            c = mix(c, shopC, shop);
            // Awnings over some shopfronts.
            float shopId = floor(u / 4.2);
            float awn = tall * step(groundH - 0.72, v) * step(v, groundH - 0.38) * step(abs(shopU - 0.5), 0.46) * step(3.0, W)
              * step(0.4, eh21(vec2(shopId, seed * 13.0)));
            float pick = eh21(vec2(shopId * 3.1, seed * 7.0));
            vec3 awnC = pick < 0.2 ? vec3(0.72, 0.24, 0.18) : pick < 0.4 ? vec3(0.22, 0.47, 0.30) : pick < 0.6 ? vec3(0.17, 0.28, 0.45) : pick < 0.8 ? vec3(0.85, 0.64, 0.2) : vec3(0.16, 0.52, 0.52);
            c = mix(c, awnC * (0.9 + 0.2 * step(0.5, fract(u * 1.4))), awn);
            // Gentle grime toward the street, lighter toward the sky.
            c *= mix(0.86, 1.0, smoothstep(0.0, 2.5, v)) * (0.97 + 0.06 * clamp(v / 40.0, 0.0, 1.0));
            diffuseColor.rgb = c;
            win = clamp(pane + shop, 0.0, 1.0);
            rough = mix(0.88, 0.18, win);
            float hs = eh21(cell + vec2(seed * 71.0, floor(u / max(W, 1.0)) * 13.0 + W));
            lit = pane * step(0.6, hs);
            shopLit = shop;
          }
        } else if (isPitch > 0.5) {
          float courses = smoothstep(0.08, 0.0, abs(fract(vWy * 2.6) - 0.5) - 0.38);
          diffuseColor.rgb = base * (0.92 + 0.08 * courses) * (0.96 + 0.08 * evn(vec2(vWy * 3.0, seed * 50.0)));
          rough = 0.8;
        } else if (W > -0.5) {
          // Flat roof: gravel/membrane with soft noise.
          diffuseColor.rgb = base * (0.94 + 0.1 * evn(vec2(vWy, seed * 40.0) * 2.0));
        }
        float facadeWin = win; float facadeLit = lit; float facadeShop = shopLit; float facadeRough = rough;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = facadeRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 warm = vec3(1.0, 0.78, 0.5);
        totalEmissiveRadiance += facadeLit * warm * uNight * 0.85;
        totalEmissiveRadiance += facadeShop * vec3(1.0, 0.86, 0.62) * (uNight * 0.9 + 0.02);`);
  };
  mat.customProgramCacheKey = () => 'earth-building-v1';
  buildingMat = mat;
  return mat;
}

const groundPatch = (sh: THREE.WebGLProgramParametersWithUniforms) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGw;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vGw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGw;
      ${NOISE}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float green = smoothstep(0.015, 0.09, c.g - max(c.r, c.b));
        vec2 p = vGw.xz;
        float n1 = evn(p * 0.07), n2 = evn(p * 0.6), n3 = eh21(floor(p * 3.0));
        c *= 1.0 + (n1 - 0.5) * 0.14 * (0.4 + green) + (n2 - 0.5) * 0.06;
        // Grass: darker tufts and little yellow flowers.
        c *= 1.0 - green * step(0.78, n3) * 0.10;
        float flower = green * step(0.992, eh21(floor(p * 1.7) + 7.0));
        c = mix(c, vec3(0.98, 0.9, 0.42), flower * 0.75);
        // Paving: faint slab joints.
        float paved = (1.0 - green) * step(0.55, c.r) * (1.0 - step(0.75, c.b - c.r + 0.75));
        vec2 slab = abs(fract(p / 2.2) - 0.5);
        c *= 1.0 - paved * 0.035 * step(0.47, max(slab.x, slab.y));
        diffuseColor.rgb = c;
      }`);
};

/** Ground of a detailed chunk: its painted landuse map plus grass and paving detail. */
export function groundMaterial(tex: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xa9c77a, roughness: 0.97, metalness: 0 });
  m.onBeforeCompile = groundPatch;
  m.customProgramCacheKey = () => (tex ? 'earth-ground-map' : 'earth-ground-plain');
  return m;
}

/** Which detailed chunks are loaded, so the far terrain can hide underneath them. */
export const farMask = {
  n: 48,
  tex: null as THREE.DataTexture | null,
  origin: new THREE.Vector2(),
  cell: { value: 1 },
  base: { tx: 0, ty: 0 },
  uOrigin: { value: new THREE.Vector2() },
  uCell: { value: 1 },
  uN: { value: 48 },
  uMask: { value: null as THREE.DataTexture | null },
};

export function farMaterial(tex: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x7d9a62, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = farMask.uMask;
    sh.uniforms.uOrigin = farMask.uOrigin;
    sh.uniforms.uCell = farMask.uCell;
    sh.uniforms.uN = farMask.uN;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFw;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vFw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFw; uniform sampler2D uMask; uniform vec2 uOrigin; uniform float uCell; uniform float uN;`)
      .replace('void main() {', `void main() {
        {
          vec2 t = (vFw.xz - uOrigin) / uCell;
          if (t.x >= 0.0 && t.y >= 0.0 && t.x < uN && t.y < uN) {
            float m = texture2D(uMask, (floor(t) + 0.5) / uN).r;
            if (m > 0.5) discard;
          }
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // Satellite imagery, graded toward the stylized palette: brighter, greener, less murky.
          vec3 c = diffuseColor.rgb;
          float l = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(vec3(l), c, 1.45);
          c = pow(max(c, 0.0), vec3(0.8)) * 1.12;
          c = mix(c, c * vec3(0.92, 1.06, 0.9), 0.5);
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => `earth-far-${tex ? 1 : 0}`;
  return m;
}

let waterMat: THREE.MeshStandardMaterial | null = null;
const waterT = { value: 0 };
/**
 * Lakes, rivers and the flat sea: two layers of ripples drifting against each other, a lighter
 * teal toward grazing angles (fresnel), and a hot sun glint. The ocean waves reuse it.
 */
export function waterMaterial() {
  if (waterMat) return waterMat;
  const normals = new THREE.TextureLoader().load('/textures/waternormals.jpg');
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ color: 0x2f7fb3, roughness: 0.08, metalness: 0.05, normalMap: normals, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterT = waterT;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWaterT;`)
      .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 n1 = texture2D(normalMap, vNormalMapUv + uWaterT * vec2(0.013, 0.009)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vNormalMapUv * 2.3 + uWaterT * vec2(-0.018, 0.012)).xyz * 2.0 - 1.0;
          vec3 mapN = vec3((n1.xy + n2.xy) * 0.5 * normalScale, 1.0);
          normal = normalize(tbn * mapN);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Lighter, greener water at grazing angles, like the sky skimming off it.
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), -normal) * -1.0, 0.0, 1.0), 4.0);
          totalEmissiveRadiance += vec3(0.05, 0.16, 0.2) * fres;
        }`);
  };
  m.customProgramCacheKey = () => 'earth-water-v2';
  waterMat = m;
  return m;
}
export function updateWater(t: number) {
  waterT.value = t;
}

/** Pull coplanar overlays toward the camera so they never z-fight with the ground. */
export function overlay<T extends THREE.Material>(m: T, layer: number): T {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -layer;
  m.polygonOffsetUnits = -layer * 2;
  return m;
}

export const MATS = {
  road: overlay(new THREE.MeshStandardMaterial({ color: 0x64686f, roughness: 0.92 }), 3),
  walk: overlay(new THREE.MeshStandardMaterial({ color: 0xcfccc5, roughness: 0.95 }), 2),
  paintW: overlay(new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.7 }), 5),
  paintY: overlay(new THREE.MeshStandardMaterial({ color: 0xf0c24a, roughness: 0.7 }), 5),
  deck: new THREE.MeshStandardMaterial({ color: 0xb3afa6, roughness: 0.88, side: THREE.DoubleSide }),
};

// ---------------------------------------------------------------------------------------------
// Props

function colored(g: THREE.BufferGeometry, top: number, bottom = top) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y, y1 = g.boundingBox!.max.y;
  const a = new THREE.Color(bottom), b = new THREE.Color(top), c = new THREE.Color();
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / Math.max(0.001, y1 - y0);
    c.copy(a).lerp(b, t);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** A round, puffy "lollipop" tree like the game's: smooth canopy, light on top. */
export function lollipopTree() {
  const trunk = colored(new THREE.CylinderGeometry(0.14, 0.22, 2.6, 5, 1, true).translate(0, 1.3, 0), 0x7a5a3e);
  const parts = [trunk];
  // Low-poly on purpose: there can be thousands of these in a park.
  const blobs: [number, number, number, number][] = [[0, 4.1, 0, 1.95], [0.8, 3.55, 0.35, 1.3], [-0.6, 4.6, -0.3, 1.35]];
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    s.translate(x, y, z);
    parts.push(colored(s, 0x9fd65c, 0x4f8f3a));
  }
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }))!;
  g.computeVertexNormals();
  return g;
}

export function coniferTree() {
  const parts = [colored(new THREE.CylinderGeometry(0.15, 0.22, 2.0, 6).translate(0, 1.0, 0), 0x6e5038)];
  const tiers: [number, number, number][] = [[1.6, 2.2, 3.2], [3.0, 1.6, 2.7], [4.3, 1.05, 2.3]];
  for (const [y, r, h] of tiers) parts.push(colored(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), 0x6ea85a, 0x2f6a3a));
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }))!;
  g.computeVertexNormals();
  return g;
}

export const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

export function lampGeometries() {
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.08, 0.12, 7.5, 7).translate(0, 3.75, 0),
    new THREE.BoxGeometry(0.07, 0.07, 2.2).translate(0, 7.4, 1.1),
  ])!;
  const head = new THREE.BoxGeometry(0.45, 0.16, 0.8).translate(0, 7.32, 2.1);
  return { pole, head };
}
