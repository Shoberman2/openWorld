import * as THREE from 'three';
import { shared } from '../engine.ts';

export type FacadeKind = 'masonry' | 'glass';

const PRESETS: Record<FacadeKind, { bayW: number; floorH: number; ground: number; win: [number, number]; glass: number; lit: number; rough: number; metal: number }> = {
  masonry: { bayW: 3.2, floorH: 3.4, ground: 4.6, win: [0.52, 0.58], glass: 0x1d2630, lit: 0.34, rough: 0.88, metal: 0.0 },
  glass: { bayW: 2.6, floorH: 3.9, ground: 6.0, win: [0.9, 0.8], glass: 0x2a3a4a, lit: 0.38, rough: 0.35, metal: 0.25 },
};

/**
 * Procedural facade: windows laid out per floor/bay in object space (so they fit each box exactly),
 * glassy reflective panes by day, randomly lit offices + bright storefronts at night.
 * Geometry must be a unit box/cylinder with its base at y=0, scaled by the (instance) matrix.
 */
export function facadeMaterial(kind: FacadeKind, opts: { color?: THREE.ColorRepresentation; cylinder?: boolean; glass?: THREE.ColorRepresentation; world?: boolean } = {}) {
  const pr = PRESETS[kind];
  const mat = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff, roughness: pr.rough, metalness: pr.metal, vertexColors: !!opts.world });
  const uniforms = {
    uBayW: { value: pr.bayW },
    uFloorH: { value: pr.floorH },
    uGround: { value: pr.ground },
    uWin: { value: new THREE.Vector2(...pr.win) },
    uGlass: { value: new THREE.Color(opts.glass ?? pr.glass) },
    uLit: { value: pr.lit },
    uFrame: { value: kind === 'glass' ? 0.5 : 1.0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uNight: shared.uNight });
    if (opts.cylinder) sh.defines = { ...(sh.defines ?? {}), CYL: '' };
    // World mode: arbitrary extruded footprints carry their own facade coordinates per vertex
    // (aFac = along-wall meters, height above sea level, wall length, building top; aSeed = per building).
    if (opts.world) sh.defines = { ...(sh.defines ?? {}), WORLD: '' };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vUnit; flat varying vec3 vScale; varying vec3 vObjN; flat varying float vSeed;
        #ifdef WORLD
          attribute vec4 aFac; attribute float aSeed; varying vec4 vFac;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vUnit = position; vObjN = normal;
        #ifdef WORLD
          vFac = aFac;
        #endif
        #ifdef USE_INSTANCING
          mat4 fm = modelMatrix * instanceMatrix;
        #else
          mat4 fm = modelMatrix;
        #endif
        vScale = vec3(length(fm[0].xyz), length(fm[1].xyz), length(fm[2].xyz));
        vSeed = floor(fract(sin(dot(floor(fm[3].xz), vec2(0.1298, 0.7823))) * 437.585) * 997.0);
        #ifdef WORLD
          vSeed = aSeed;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vUnit; flat varying vec3 vScale; varying vec3 vObjN; flat varying float vSeed;
        #ifdef WORLD
          varying vec4 vFac;
        #endif
        float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        uniform float uBayW, uFloorH, uGround, uLit, uNight, uFrame; uniform vec2 uWin; uniform vec3 uGlass;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fn = normalize(vObjN);
        float wall = 1.0 - step(0.55, abs(fn.y));
        float along; float width;
        float hgt = vUnit.y * vScale.y, topH = vScale.y;
        #if defined(WORLD)
          width = vFac.z; along = vFac.x / max(width, 0.01); hgt = vFac.y; topH = vFac.w;
        #elif defined(CYL)
          along = atan(vUnit.z, vUnit.x) / 6.28318 + 0.5; width = 3.14159 * vScale.x;
        #else
          bool sideX = abs(fn.x) > abs(fn.z);
          along = (sideX ? vUnit.z : vUnit.x) + 0.5;
          width = sideX ? vScale.z : vScale.x;
        #endif
        float bayW = uBayW * (0.85 + 0.3 * fract(vSeed * 0.618));
        float bays = max(1.0, floor(width / bayW));
        float fu = along * bays;
        float fv = (hgt - uGround) / uFloorH;
        vec2 cell = floor(vec2(fu, fv));
        vec2 fr = fract(vec2(fu, fv));
        float isGround = step(hgt, uGround);
        float topCut = step(hgt, topH - 1.4);
        float wwin = step(abs(fr.x - 0.5), uWin.x * 0.5) * step(abs(fr.y - 0.55), uWin.y * 0.5);
        float gwin = step(abs(fract(fu * 0.5) - 0.5), 0.44) * step(0.35, hgt) * step(hgt, uGround - 0.7);
        float win = wall * topCut * mix(wwin, gwin, isGround);
        #ifdef CYL
          float sideKey = 0.0;
        #else
          float sideKey = fn.x * 7.0 + fn.z * 13.0;
        #endif
        float hsh = h21(cell + vec2(floor(sideKey + 0.5) * 131.0 + vSeed, vSeed * 3.0));
        vec3 glassC = uGlass * (0.7 + 0.6 * hsh);
        diffuseColor.rgb = mix(diffuseColor.rgb * uFrame, glassC, win);
        diffuseColor.rgb *= 1.0 - wall * (1.0 - win) * 0.1 * step(0.9, fr.y) * (1.0 - isGround);
        diffuseColor.rgb *= mix(1.0, 0.5, step(0.55, fn.y));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.04 + 0.12 * hsh, win);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.9 - uNight * 0.5, win);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lit = step(1.0 - uLit, fract(hsh * 7.31));
        vec3 warm = mix(vec3(1.0, 0.76, 0.48), vec3(0.78, 0.88, 1.0), step(0.72, fract(hsh * 3.7)));
        totalEmissiveRadiance += win * (1.0 - isGround) * lit * warm * (0.35 + 0.65 * fract(hsh * 13.1)) * (uNight * 0.6 + 0.02);
        totalEmissiveRadiance += win * isGround * vec3(1.0, 0.86, 0.62) * (uNight * 0.8 + 0.03);`);
  };
  mat.customProgramCacheKey = () => `facade-${kind}-${opts.cylinder ? 'c' : 'b'}${opts.world ? 'w' : ''}`;
  return mat;
}

/** Unit box with base at y=0 (no bottom face needed, but keep it simple). */
export const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

export function taperedBox(taper: number) {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 8, 1).translate(0, 0.5, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = 1 - (1 - taper) * y;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1, true).translate(0, 0.5, 0);
