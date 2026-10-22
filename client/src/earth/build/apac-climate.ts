// ---- Asia-Pacific & Latin America: street-tree climate by city (worker side, no three.js).
// The tropics aren't all palm avenues: Hong Kong and Singapore streets are lined with banyans and
// rain trees, Mexico City (2,240 m up) with ash and jacaranda; Rio's beachfronts do run to palms.

const PALMS: Record<string, number> = { hk: 0.1, mo: 0.1, sg: 0.15, my: 0.25, tw: 0.2, mx: 0.12, br: 0.45, au: 0.08 };

/** Share of street trees that are palms here (the rest broadleaf). */
export function streetPalmShare(country: string, tropical: boolean) {
  return PALMS[country] ?? (tropical ? 1 : 0);
}

/**
 * Which features of the map's park layer are actually green. The layer also carries heritage and
 * planning zones — Mexico City's "Zona de Monumentos Históricos" over the whole Centro, Rio's
 * environmental-protection areas over Copacabana beach — which must not turn a plaza or a beach
 * into lawn and woods.
 */
const GREEN_PARKS = new Set(['national_park', 'nature_reserve', 'protected_area', 'park', 'garden', 'forest', 'state_park', 'regional_park', 'country_park']);
export function isGreenPark(props: Record<string, unknown>) {
  return GREEN_PARKS.has(String(props.class ?? '').toLowerCase());
}
