// Real places: geocoding with Nominatim (OpenStreetMap). Map data itself streams as tiles (tiles.ts).
import type { GeoPlace } from '../shared/types.ts';

const UA = 'OpenWorldHQ/0.1 (local open-world game; https://github.com/)';

// ---------- geocoding ----------

let lastNominatim = 0;
async function nominatim(path: string) {
  // Nominatim usage policy: at most one request per second, with a real User-Agent.
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(`https://nominatim.openstreetmap.org/${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  return res.json();
}

interface NominatimHit {
  lat: string; lon: string; name: string; display_name: string; type: string; category?: string;
  address?: Record<string, string>; boundingbox?: string[];
}

function toPlace(h: NominatimHit): GeoPlace {
  const a = h.address ?? {};
  const city = a.city || a.town || a.village || a.municipality || a.county || a.state || '';
  const name = h.name || h.display_name.split(',')[0];
  const country = a.country || '';
  const label = [name, city !== name ? city : '', country].filter(Boolean).join(', ');
  return { name, label, lat: Number(h.lat), lon: Number(h.lon), countryCode: (a.country_code || '').toLowerCase(), kind: h.type || h.category || 'place' };
}

const searchCache = new Map<string, GeoPlace[]>();
export async function searchPlaces(q: string): Promise<GeoPlace[]> {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  const hit = searchCache.get(key);
  if (hit) return hit;
  const raw = (await nominatim(`search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&addressdetails=1`)) as NominatimHit[];
  const out = raw.map(toPlace);
  searchCache.set(key, out);
  return out;
}

export async function reverse(lat: number, lon: number): Promise<GeoPlace | null> {
  try {
    const h = (await nominatim(`reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=16&addressdetails=1`)) as NominatimHit;
    return h && h.lat ? { ...toPlace(h), lat, lon } : null;
  } catch {
    return null;
  }
}
