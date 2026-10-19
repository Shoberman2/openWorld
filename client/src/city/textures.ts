import * as THREE from 'three';

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g: CanvasRenderingContext2D, s: number, base: [number, number, number], amp: number, count: number, size = 2) {
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * amp;
    g.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v},${0.35 + Math.random() * 0.5})`;
    const r = Math.random() * size + 0.5;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}

export const asphalt = () => canvasTex(512, (g, s) => {
  noise(g, s, [58, 58, 62], 40, 26000, 2.2);
  // Tar seams and patches.
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(25,25,28,${0.25 + Math.random() * 0.3})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 80; y += (Math.random() - 0.5) * 80; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(40,40,44,${0.3 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * s, Math.random() * s, 30 + Math.random() * 60, 20 + Math.random() * 40);
  }
});

export const concrete = (base: number) => canvasTex(256, (g, s) => {
  const c = new THREE.Color(base);
  noise(g, s, [c.r * 255, c.g * 255, c.b * 255], 30, 7000, 1.6);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    g.beginPath(); g.moveTo(0, (i * s) / 2); g.lineTo(s, (i * s) / 2); g.stroke();
    g.beginPath(); g.moveTo((i * s) / 2, 0); g.lineTo((i * s) / 2, s); g.stroke();
  }
});

export const grass = () => canvasTex(256, (g, s) => {
  noise(g, s, [66, 104, 52], 50, 16000, 2.4);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${80 + Math.random() * 40},${120 + Math.random() * 30},60,0.25)`;
    g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 25, 0, Math.PI * 2); g.fill();
  }
});

export const sand = () => canvasTex(256, (g, s) => noise(g, s, [214, 196, 160], 30, 12000, 1.5));
