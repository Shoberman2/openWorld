import * as THREE from 'three';
import type { Destination } from './places.ts';

/**
 * The landing page's Earth: Sentinel-2 cloudless imagery (the same tiles the game streams) reprojected
 * onto a sphere, with a pin on every destination. It turns slowly, and turns to face a place on hover.
 */
export class Globe {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private tilt = new THREE.Group();
  private spin = new THREE.Group();
  private pins: THREE.Mesh[] = [];
  private texCanvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private raf = 0;
  private visible = true;
  private yaw = -1.2;
  private pitch = 0.35;
  private target: { yaw: number; pitch: number } | null = null;
  private focusPin: THREE.Mesh | null = null;
  private ring: THREE.Mesh;
  private ray = new THREE.Raycaster();
  private hovered = -1;
  onPin?: (i: number) => void;
  onHover?: (i: number, x: number, y: number) => void;

  constructor(private canvas: HTMLCanvasElement, private places: Destination[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0, 4.6);

    this.texCanvas.width = 2048; this.texCanvas.height = 1024;
    const g = this.texCanvas.getContext('2d')!;
    g.fillStyle = '#0c2236'; g.fillRect(0, 0, 2048, 1024);
    this.texture = new THREE.CanvasTexture(this.texCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.92, metalness: 0 }));
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.08, 96, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      // Back faces: dot(n, v) runs from 0 at the halo's outer edge to about -0.37 at the Earth's limb.
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(clamp(-dot(vN, vV) / 0.37, 0.0, 1.0), 2.2); gl_FragColor = vec4(0.35, 0.68, 1.0, 1.0) * f * 0.85; }',
    }));
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.004, 96, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.6); gl_FragColor = vec4(0.45, 0.75, 1.0, 1.0) * f * 0.75; }',
    }));
    this.spin.add(earth, rim);

    const pinGeo = new THREE.SphereGeometry(0.011, 12, 8);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xffb02e });
    places.forEach((p, i) => {
      const m = new THREE.Mesh(pinGeo, pinMat);
      m.position.copy(Globe.point(p.lat, p.lon, 1.003));
      m.userData.i = i;
      this.spin.add(m);
      this.pins.push(m);
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.03, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.visible = false;
    this.spin.add(this.ring);

    this.tilt.add(this.spin);
    this.scene.add(this.tilt, atmosphere);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-3, 1.6, 2.4);
    this.scene.add(sun, new THREE.AmbientLight(0x6f8fb8, 0.55));

    canvas.addEventListener('pointermove', (e) => this.pick(e));
    canvas.addEventListener('pointerleave', () => { this.hovered = -1; this.onHover?.(-1, 0, 0); canvas.style.cursor = ''; });
    canvas.addEventListener('click', () => { if (this.hovered >= 0) this.onPin?.(this.hovered); });
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(canvas);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.loadImagery();
    const loop = (t: number) => { this.raf = requestAnimationFrame(loop); if (this.visible) this.frame(t); };
    this.raf = requestAnimationFrame(loop);
  }

  /** Same layout as THREE.SphereGeometry's UVs, so pins sit on the right spot of the equirectangular map. */
  static point(lat: number, lon: number, r: number) {
    const phi = ((lon + 180) / 360) * Math.PI * 2, th = ((90 - lat) / 180) * Math.PI;
    return new THREE.Vector3(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r);
  }

  /** Turn to face a place and ring it (or let go with -1). */
  focus(i: number) {
    if (i < 0) { this.target = null; this.focusPin = null; this.ring.visible = false; return; }
    const p = this.places[i], v = Globe.point(p.lat, p.lon, 1);
    let yaw = -Math.atan2(v.x, v.z);
    while (yaw - this.yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw - this.yaw < -Math.PI) yaw += Math.PI * 2;
    this.target = { yaw, pitch: THREE.MathUtils.clamp(p.lat * (Math.PI / 180) * 0.75, -0.9, 0.9) };
    this.focusPin = this.pins[i];
    this.ring.position.copy(Globe.point(p.lat, p.lon, 1.004));
    this.ring.lookAt(Globe.point(p.lat, p.lon, 2));
    this.ring.visible = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(t: number) {
    const dt = 1 / 60;
    if (this.target) {
      this.yaw = THREE.MathUtils.damp(this.yaw, this.target.yaw, 4, dt);
      this.pitch = THREE.MathUtils.damp(this.pitch, this.target.pitch, 4, dt);
    } else {
      this.yaw += dt * 0.06;
      this.pitch = THREE.MathUtils.damp(this.pitch, 0.35, 1, dt);
    }
    this.spin.rotation.y = this.yaw;
    this.tilt.rotation.x = this.pitch;
    const pulse = 1 + 0.35 * Math.sin(t / 260);
    for (const p of this.pins) p.scale.setScalar(p === this.focusPin || this.pins[this.hovered] === p ? 2.2 : 1);
    this.ring.scale.setScalar(pulse);
    this.renderer.render(this.scene, this.camera);
  }

  private pick(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    let best = -1, bestD = 0.045;
    const o = this.ray.ray.origin, dir = this.ray.ray.direction;
    // Pins are tiny: pick the nearest one to the ray that faces the camera.
    for (const p of this.pins) {
      const w = p.getWorldPosition(new THREE.Vector3());
      if (w.z < 0.15) continue;
      const dist = dir.clone().cross(w.clone().sub(o)).length();
      if (dist < bestD) { bestD = dist; best = p.userData.i; }
    }
    this.hovered = best;
    this.canvas.style.cursor = best >= 0 ? 'pointer' : '';
    this.onHover?.(best, e.clientX - r.left, e.clientY - r.top);
  }

  /** Mercator imagery tiles, reprojected row by row into an equirectangular texture. z2 first, then z3. */
  private async loadImagery() {
    for (const z of [2, 3]) {
      const n = 2 ** z, S = 256 * n;
      const merc = document.createElement('canvas');
      merc.width = S; merc.height = S;
      const mg = merc.getContext('2d')!;
      const jobs: Promise<void>[] = [];
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
        jobs.push(new Promise((res) => {
          const img = new Image();
          img.onload = () => { mg.drawImage(img, x * 256, y * 256); res(); };
          img.onerror = () => res();
          img.src = `/api/tiles/sat/${z}/${x}/${y}`;
        }));
      }
      await Promise.all(jobs);
      const W = this.texCanvas.width, H = this.texCanvas.height, g = this.texCanvas.getContext('2d')!;
      for (let j = 0; j < H; j++) {
        const lat = THREE.MathUtils.clamp(90 - ((j + 0.5) / H) * 180, -85, 85) * (Math.PI / 180);
        const my = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
        g.drawImage(merc, 0, Math.min(S - 1, Math.floor(my * S)), S, 1, 0, j, W, 1);
      }
      this.texture.needsUpdate = true;
    }
  }
}
