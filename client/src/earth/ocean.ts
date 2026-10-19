// Open-sea waves: a grid that follows the camera, displaced by Gerstner waves whose height grows
// with the wind (gentle swell on a calm day, big rolling waves with whitecaps in a storm). It sits
// just above the flat sea polygons the chunks draw and fades into them at its edge.
import * as THREE from 'three';
import { waterMaterial } from './style.ts';

const N = 160; // grid cells per side
const SIZE = 900; // meters across
const STEP = SIZE / N;

// Direction (unit, x/z), wavelength (m), relative amplitude, steepness.
const WAVES: [number, number, number, number, number][] = [
  [0.89, 0.45, 62, 1.0, 0.55],
  [0.32, 0.95, 37, 0.55, 0.6],
  [-0.55, 0.83, 21, 0.3, 0.7],
  [0.98, -0.2, 12, 0.14, 0.8],
];

const head = /* glsl */ `
uniform float uWaveT, uAmp;
uniform vec4 uW[4]; // dir.x, dir.y, wavelength, amp
uniform float uSteep[4];
uniform vec2 uCenter;
uniform float uHalf;
varying float vCrest;
varying vec2 vOceanXZ;
vec3 gerstner(vec2 p, out vec3 n) {
  vec3 o = vec3(0.0);
  vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
  // Fade to flat at the grid edge so it meets the flat sea seamlessly.
  float edge = 1.0 - smoothstep(uHalf * 0.6, uHalf * 0.95, max(abs(p.x - uCenter.x), abs(p.y - uCenter.y)));
  for (int i = 0; i < 4; i++) {
    vec2 d = uW[i].xy;
    float k = 6.28318 / uW[i].z;
    float c = sqrt(9.8 / k);
    float a = uW[i].w * uAmp * edge;
    float q = uSteep[i] / (k * max(a, 0.001) * 4.0);
    q = min(q, 1.0) * step(0.001, a);
    float f = k * (dot(d, p) - c * uWaveT);
    float cf = cos(f), sf = sin(f);
    o.x += q * a * d.x * cf;
    o.z += q * a * d.y * cf;
    o.y += a * sf;
    tx += vec3(-q * d.x * d.x * k * a * sf, d.x * k * a * cf, -q * d.x * d.y * k * a * sf);
    tz += vec3(-q * d.x * d.y * k * a * sf, d.y * k * a * cf, -q * d.y * d.y * k * a * sf);
  }
  n = normalize(cross(tz, tx));
  return o;
}
`;

/** Wave height at a world point (CPU mirror of the shader, without the horizontal drift). */
function waveHeight(x: number, z: number, t: number, amp: number) {
  let y = 0;
  for (const [dx, dz, len, a] of WAVES) {
    const k = (Math.PI * 2) / len, c = Math.sqrt(9.8 / k);
    y += a * amp * Math.sin(k * (dx * x + dz * z - c * t));
  }
  return y;
}

export class OceanWaves {
  mesh: THREE.Mesh;
  private uniforms = {
    uWaveT: { value: 0 },
    uAmp: { value: 0.3 },
    uW: { value: WAVES.map(([dx, dz, len, a]) => new THREE.Vector4(dx, dz, len, a)) },
    uSteep: { value: WAVES.map((w) => w[4]) },
    uCenter: { value: new THREE.Vector2() },
    uHalf: { value: SIZE / 2 },
    uFoam: { value: 0 },
  };
  private amp = 0.3;
  private seaY = 0;
  private time = 0;

  constructor(scene: THREE.Object3D) {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, N, N).rotateX(-Math.PI / 2);
    // Same look as the flat sea (color, normal ripples, reflections), plus waves and foam.
    const base = waterMaterial();
    const mat = new THREE.MeshStandardMaterial({
      color: base.color, roughness: base.roughness, metalness: base.metalness,
      normalMap: base.normalMap, normalScale: base.normalScale, envMapIntensity: base.envMapIntensity,
    });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      base.onBeforeCompile?.(sh, null as never);
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${head}`)
        .replace('#include <beginnormal_vertex>', `
          vec2 wp = (modelMatrix * vec4(position, 1.0)).xz;
          vec3 wn;
          vec3 wo = gerstner(wp, wn);
          vec3 objectNormal = wn;
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = position + wo;
          vCrest = wo.y / max(uAmp, 0.05);
          vOceanXZ = wp;
          #ifdef USE_NORMALMAP
            vNormalMapUv = wp / 40.0; // ripples fixed to the world, not the moving grid
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uFoam, uWaveT;
          varying float vCrest;
          varying vec2 vOceanXZ;
          float ofh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          float ofn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(ofh(i), ofh(i + vec2(1, 0)), f.x), mix(ofh(i + vec2(0, 1)), ofh(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // Deeper blue in the troughs, lighter teal on the faces, white foam on the crests.
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.72, diffuseColor.rgb * 1.15 + vec3(0.0, 0.05, 0.05), smoothstep(-1.0, 1.0, vCrest));
            float n = ofn(vOceanXZ * 0.35 + uWaveT * 0.3) * 0.6 + ofn(vOceanXZ * 1.3 - uWaveT * 0.5) * 0.4;
            float foam = smoothstep(0.78, 1.0, vCrest * 0.85 + n * 0.5 - 0.1) * uFoam * (0.6 + 0.4 * n);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.98), foam);
          }`);
    };
    mat.customProgramCacheKey = () => 'earth-ocean-v2';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  /**
   * seaY: sea level in local y (null hides the waves: no ocean near, or the camera is far above it).
   * storm: 0 calm .. 1 storm (wind and weather); drives wave height and whitecaps.
   */
  update(dt: number, camera: THREE.Camera, seaY: number | null, storm: number) {
    this.time += dt;
    const cam = camera.position;
    const show = seaY !== null && cam.y - seaY < 600;
    this.mesh.visible = show;
    if (!show) return;
    this.seaY = seaY!;
    const want = 0.25 + storm * 2.2;
    this.amp += (want - this.amp) * (1 - Math.exp(-dt * 0.4));
    const u = this.uniforms;
    u.uWaveT.value = this.time;
    u.uAmp.value = this.amp;
    u.uFoam.value = THREE.MathUtils.smoothstep(this.amp, 0.6, 2.0);
    // Snap to the grid so vertices don't swim as the camera moves.
    const x = Math.round(cam.x / STEP) * STEP, z = Math.round(cam.z / STEP) * STEP;
    u.uCenter.value.set(x, z);
    this.mesh.position.set(x, this.seaY + 0.06, z);
  }

  /** Water surface height at (x, z) (for floating boats). */
  heightAt(x: number, z: number) {
    return this.seaY + 0.06 + waveHeight(x, z, this.time, this.amp);
  }
}
