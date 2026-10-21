// Live weather where you are, from Open-Meteo (free, no key). Cached for 15 minutes per 0.25° cell;
// if the service is down the game just keeps its own weather.
//   GET /api/weather?lat=&lon=  -> LiveWeather
import type { Express, Request, Response } from 'express';

export interface LiveWeather {
  tempC: number;
  windKmh: number;
  windDir: number; // degrees the wind blows FROM
  cloudCover: number; // 0..1
  precip: number; // mm/h
  kind: 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog';
  code: number; // WMO weather code
}

const cache = new Map<string, { at: number; w: LiveWeather }>();

/** WMO weather interpretation codes -> the handful of looks the game has. */
function kindOf(code: number, cloud: number, tempC: number, precip: number): LiveWeather['kind'] {
  if (code >= 95) return 'storm';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precip > 0.1) return tempC < 0 ? 'snow' : 'rain';
  if (code === 3 || cloud > 0.75) return 'cloudy';
  return 'clear';
}

export async function liveWeather(lat: number, lon: number): Promise<LiveWeather | null> {
  const key = `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.w;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
      + '&current=temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m';
    const res = await fetch(url, { headers: { 'User-Agent': 'OpenWorldHQ/0.1 (local open-world game)' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const c = ((await res.json()) as { current?: Record<string, number> }).current ?? {};
    const tempC = c.temperature_2m ?? 15, cloud = (c.cloud_cover ?? 30) / 100, precip = c.precipitation ?? 0, code = c.weather_code ?? 0;
    const w: LiveWeather = {
      tempC, windKmh: c.wind_speed_10m ?? 8, windDir: c.wind_direction_10m ?? 270, cloudCover: cloud, precip, code,
      kind: kindOf(code, cloud, tempC, precip),
    };
    cache.set(key, { at: Date.now(), w });
    return w;
  } catch {
    return hit?.w ?? null;
  }
}

// ---------- the whole planet, for the map's globe ----------
// A 15° grid of current conditions (264 points; Open-Meteo counts each point as a call, and the free
// tier allows 600 a minute), fetched in batches and kept for 30 minutes. Coarse on purpose: it shows
// where the cloud and the storms are right now, not their shape.
//   GET /api/weather/global -> GlobalWeather

export interface GlobalWeather {
  at: number; // ms epoch when fetched
  lat0: number; lon0: number; step: number; rows: number; cols: number;
  /** Row-major from lat0 (south) and lon0 (west): cloud 0..1, precip mm/h, WMO code, wind km/h and from-direction. */
  cloud: number[]; precip: number[]; code: number[]; wind: number[]; windDir: number[];
}

let globalCache: GlobalWeather | null = null;
let globalInflight: Promise<GlobalWeather | null> | null = null;

async function fetchGlobal(): Promise<GlobalWeather | null> {
  const step = 15, lat0 = -75, lon0 = -180, rows = 11, cols = 24;
  const pts: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push({ lat: lat0 + r * step, lon: lon0 + c * step });
  const out: GlobalWeather = { at: Date.now(), lat0, lon0, step, rows, cols, cloud: [], precip: [], code: [], wind: [], windDir: [] };
  for (let i = 0; i < pts.length; i += 100) {
    const batch = pts.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${batch.map((p) => p.lat).join(',')}&longitude=${batch.map((p) => p.lon).join(',')}`
      + '&current=precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m';
    const res = await fetch(url, { headers: { 'User-Agent': 'OpenWorldHQ/0.1 (local open-world game)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const body = (await res.json()) as { current?: Record<string, number> }[] | { current?: Record<string, number> };
    const list = Array.isArray(body) ? body : [body];
    for (const b of list) {
      const c = b.current ?? {};
      out.cloud.push((c.cloud_cover ?? 0) / 100);
      out.precip.push(c.precipitation ?? 0);
      out.code.push(c.weather_code ?? 0);
      out.wind.push(c.wind_speed_10m ?? 0);
      out.windDir.push(c.wind_direction_10m ?? 0);
    }
  }
  return out.cloud.length === pts.length ? out : null;
}

export async function globalWeather(): Promise<GlobalWeather | null> {
  if (globalCache && Date.now() - globalCache.at < 30 * 60_000) return globalCache;
  globalInflight ??= fetchGlobal()
    .then((g) => { if (g) globalCache = g; return g ?? globalCache; })
    .catch(() => globalCache)
    .finally(() => { globalInflight = null; });
  return globalInflight;
}

export function registerWeather(app: Express) {
  app.get('/api/weather/global', async (_req: Request, res: Response) => {
    const g = await globalWeather();
    if (!g) { res.status(503).json({ error: 'global weather unavailable' }); return; }
    res.json(g);
  });
  app.get('/api/weather', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      res.status(400).json({ error: 'lat and lon are required' });
      return;
    }
    const w = await liveWeather(lat, lon);
    if (!w) { res.status(503).json({ error: 'weather unavailable' }); return; }
    res.json(w);
  });
}
