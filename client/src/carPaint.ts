import * as THREE from 'three';

/**
 * Automotive finish for the traffic's instanced bodies. One material, told apart per vertex by the
 * model's authored color (before the instance's paint is applied): body panels get metallic paint
 * under a clear coat, the greenhouse gets glossy tinted glass, tires and trim go matte, rims metal.
 * The extruded side panels are flat; their normals are bent a little (tumblehome up top, wrapping
 * toward the bumpers) so reflections sweep across them the way they do on a real, curved car.
 */
export function carPaintMaterial(lite = false) {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.4, clearcoat: lite ? 0 : 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRaw;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        {
          vec3 raw = color.rgb;
          float bright = max(raw.r, max(raw.g, raw.b));
          if (bright > 0.3 && abs(objectNormal.x) > 0.85) {
            // Side panels: lean in above the belt line, wrap toward the nose and tail.
            objectNormal.y += clamp((position.y - 0.85) * 0.9, -0.25, 0.45);
            objectNormal.z += position.z * 0.07;
            objectNormal = normalize(objectNormal);
          }
        }`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vRaw = color.rgb;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRaw;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float cBright = max(vRaw.r, max(vRaw.g, vRaw.b));
        float cGlass = step(cBright, 0.035) * step(vRaw.r + 0.006, vRaw.b);
        float cTire = step(cBright, 0.03) * (1.0 - cGlass);
        float cTrim = step(0.03, cBright) * step(cBright, 0.3) * (1.0 - cGlass);
        float cPaint = step(0.3, cBright);
        float cRim0 = step(0.3, cBright) * step(abs(vRaw.r - vRaw.b), 0.05) * step(cBright, 0.45);
        roughnessFactor = cPaint * mix(0.3, 0.28, cRim0) + cGlass * 0.04 + cTire * 0.9 + cTrim * 0.55;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        float cRim = step(0.3, cBright) * step(abs(vRaw.r - vRaw.b), 0.05) * step(cBright, 0.45);
        metalnessFactor = cPaint * 0.45 * (1.0 - cRim) + cRim * 0.9;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = cPaint * (1.0 - cRim) + cGlass;
        #endif`);
  };
  m.customProgramCacheKey = () => `car-paint-${lite ? 1 : 0}`;
  return m;
}
