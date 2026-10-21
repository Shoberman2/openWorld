// The flight readout (bottom center, over the mode bar) and the autopilot chip (top center), styled
// after the game this follows: big speed, Mach, altitude, climb rate, throttle, and what's burning.
import { formatDistance } from './hud.ts';

export interface FlightFrame {
  /** What's flying: hide the readout for anything else. */
  kind: 'shuttle' | 'plane' | 'wingsuit' | 'rockets' | null;
  speed: number; // m/s
  altitude: number; // m above sea level
  climb: number; // m/s
  throttle: number | null; // 0..1
  burst: boolean;
  burning: boolean;
  g?: number;
  imperial: boolean;
  autopilot: { scale: number; limited: boolean; name: string; distance: number; eta: number } | null;
}

const CSS = `
.ow-flight{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;gap:14px;
  padding:7px 14px;border-radius:12px;background:rgba(18,20,24,.62);backdrop-filter:blur(8px);color:#fff;font:600 12px/1.2 Inter,system-ui,sans-serif;pointer-events:none;z-index:6;white-space:nowrap}
.ow-flight.hidden,.ow-apchip.hidden{display:none}
.ow-flight .spd{font:800 26px/1 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.ow-flight .unit{font-size:10px;opacity:.7;margin-left:3px}
.ow-flight .col{display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums}
.ow-flight .col small{opacity:.65;font-weight:600}
.ow-flight .thr{width:84px;height:5px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden}
.ow-flight .thr i{display:block;height:100%;background:#ff4d2e}
.ow-flight .tag{padding:3px 7px;border-radius:6px;background:#3a3f48;font-size:10px;letter-spacing:.06em}
.ow-flight .tag.hot{background:#e8452c}.ow-flight .tag.rocket{background:#b0279a}
.ow-apchip{position:fixed;left:50%;top:calc(64px + env(safe-area-inset-top,0px));transform:translateX(-50%);padding:7px 14px 6px;border-radius:10px;
  background:rgba(14,30,44,.78);backdrop-filter:blur(8px);color:#fff;text-align:center;font:700 13px/1.25 Inter,system-ui,sans-serif;pointer-events:none;z-index:6}
.ow-apchip b{color:#7fe3ff}.ow-apchip small{display:block;font-weight:600;font-size:11px;opacity:.75}
`;

export function installFlightHud() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = 'ow-flight hidden';
  const chip = document.createElement('div');
  chip.className = 'ow-apchip hidden';
  document.body.append(el, chip);
  let last = '', lastChip = '';
  return {
    update(f: FlightFrame) {
      let html = '';
      if (f.kind) {
        const spd = f.imperial ? `${Math.round(f.speed * 2.23694)}<span class="unit">mph</span>` : `${Math.round(f.speed * 3.6)}<span class="unit">km/h</span>`;
        const alt = f.imperial ? `${Math.round(f.altitude * 3.28084).toLocaleString()} ft` : `${Math.round(f.altitude).toLocaleString()} m`;
        const climb = f.imperial ? `${f.climb >= 0 ? '↑' : '↓'}${Math.abs(Math.round(f.climb * 196.85)).toLocaleString()} ft/min` : `${f.climb >= 0 ? '↑' : '↓'}${Math.abs(Math.round(f.climb))} m/s`;
        const mach = f.kind === 'shuttle' || f.speed > 150 ? `<div class="col"><span>M ${(f.speed / 340).toFixed(2)}</span><small>Mach</small></div>` : '';
        const thr = f.throttle != null ? `<div class="col"><div class="thr"><i style="width:${Math.round(f.throttle * 100)}%"></i></div><small>Throttle ${Math.round(f.throttle * 100)}%</small></div>` : '';
        const g = f.g != null ? `<div class="col"><span>${f.g.toFixed(1)} g</span><small>Load</small></div>` : '';
        const label = f.kind === 'wingsuit' ? (f.burning ? 'WINGSUIT · THRUSTERS' : 'WINGSUIT') : f.kind === 'shuttle' ? 'ROCKET' : f.kind === 'rockets' ? 'THRUSTERS' : 'PROP';
        const tag = `<span class="tag ${f.kind === 'shuttle' ? 'rocket' : ''}">${label}</span>${f.burst ? '<span class="tag hot">BURST</span>' : ''}`;
        html = `<div class="spd">${spd}</div>${mach}<div class="col"><span>${alt}</span><small>${climb}</small></div>${thr}${g}${tag}`;
      }
      if (html !== last) { el.innerHTML = html; el.classList.toggle('hidden', !html); last = html; }
      let c = '';
      if (f.autopilot) {
        const a = f.autopilot, m = Math.max(0, Math.round(a.eta));
        const eta = m >= 90 ? `${Math.round(m / 60)} min` : `${m} s`;
        c = `Autopilot · <b>${Math.round(a.scale)}×</b>${a.limited ? ' (streaming)' : ''} → ${escapeHtml(a.name)}<small>${formatDistance(a.distance, f.imperial)} · about ${eta} · any flying key takes over</small>`;
      }
      if (c !== lastChip) { chip.innerHTML = c; chip.classList.toggle('hidden', !c); lastChip = c; }
    },
    setVisible(on: boolean) { if (!on) { el.classList.add('hidden'); chip.classList.add('hidden'); last = lastChip = '__'; } },
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
