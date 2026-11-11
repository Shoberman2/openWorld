// Teammates in the game: reports the player's own robot to the local server ten times a second,
// draws everyone else (avatars.ts), puts them on the map, and handles the moments between people:
// toasts when someone joins, leaves, waves or walks into your building, speech bubbles, "come here"
// markers, teleport and waypoints. main.ts owns the world; it hands this what it needs in TeamDeps.
import * as THREE from 'three';
import type { Repo, TeamMember } from '../../../shared/types.ts';
import { sendLive, track } from '../api.ts';
import type { EarthApi } from '../earth/index.ts';
import { haversine } from '../earth/frame.ts';
import { esc, type Labels } from '../interact.ts';
import type { Player } from '../player.ts';
import type { Robot } from '../robot.ts';
import type { MapMarker } from '../ui/earthMinimap.ts';
import { toast } from '../ui/panel.ts';
import { Avatars } from './avatars.ts';
import { makePhoneTeam, type PhoneTeam } from './phoneApp.ts';
import { safeColor, teamApi, teamStore, whereLine, type TeamStore } from './store.ts';
import './team.css';

/** Where the player is, as main.ts knows it. */
export interface TeamWhere {
  /** In a project HQ (with the floor's name), in some other building, or outdoors. */
  inside: { kind: 'hq'; repo: Repo; room: string } | { kind: 'room'; title: string } | null;
  /** Outdoors: unused. Indoors: the building's door in the city (interiors have their own space). */
  anchor: THREE.Vector3 | null;
  /** "Midtown, New York". */
  place: string;
}

export interface TeamDeps {
  earth: EarthApi | null;
  labels: Labels;
  player: Player;
  robot: Robot;
  camera: () => THREE.Camera;
  where: () => TeamWhere;
  /** The scene teammates can be drawn into now (null in a building that isn't a project HQ). */
  scene: () => THREE.Scene | null;
  /** Project buildings in this world, to recognise the one a teammate is in. */
  repos: () => Repo[];
  /** Go to a spot on Earth, or into one of this world's project HQs (by repo name) on a given floor height. */
  teleport: (t: { lat: number; lon: number; alt: number; agl: number; name: string; repo: string | null; y: number }) => Promise<void>;
  setWaypoint: (lat: number, lon: number, name: string) => void;
  wave: () => void;
  lite: () => boolean;
}

export interface Team {
  update(dt: number): void;
  /** Teammates and their "come here" markers, for the map and minimap. */
  markers(): MapMarker[];
  phone: PhoneTeam;
  teleportTo(id: string): Promise<void>;
  waypointTo(id: string): void;
  store: TeamStore;
  avatars: Avatars;
}

const sameRepo = (m: TeamMember, r: Repo) =>
  m.inside?.kind === 'hq' && ((!!m.inside.fullName && m.inside.fullName.toLowerCase() === r.fullName.toLowerCase()) || (!r.showcase && !!m.inside.localRepo && m.inside.localRepo === r.name));

export function installTeam(deps: TeamDeps): Team {
  const store = teamStore();
  const { earth, player, robot } = deps;
  const myRepo = () => { const w = deps.where(); return w.inside?.kind === 'hq' ? w.inside.repo : null; };
  const avatars = new Avatars({
    earth, labels: deps.labels, camera: deps.camera, lite: deps.lite,
    me: () => player.position,
    scene: deps.scene,
    outdoors: () => !deps.where().inside,
    sameInterior: (m) => { const r = myRepo(); return !!r && sameRepo(m, r); },
  }, store);

  const myGeo = () => {
    if (!earth) return null;
    const w = deps.where();
    // Indoors the robot stands in the interior's own space: report the building's door instead.
    if (w.inside && !w.anchor) return null;
    const a = w.inside && w.anchor ? w.anchor : robot.root.position;
    return { ...earth.frame.toGeo(a.x, a.z), alt: a.y + earth.e0 };
  };

  // ---- actions ----
  async function teleportTo(id: string) {
    const m = store.member(id), g = store.geo(id);
    if (!m) return;
    const local = m.inside?.kind === 'hq' ? deps.repos().find((r) => sameRepo(m, r)) ?? null : null;
    if (!g && !local) { toast(`<b>${esc(m.name)}</b> isn't sharing where they are.`); return; }
    track('team_teleport', { inside: !!local });
    // Land a couple of meters beside them, not on their head.
    const lat = g?.lat ?? 0, lon = (g?.lon ?? 0) + 2.5 / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const p = store.pose(id);
    await deps.teleport({ lat, lon, alt: p?.alt ?? 0, agl: p?.agl ?? 0, name: m.name, repo: local?.name ?? null, y: p?.y ?? 0 });
  }
  function waypointTo(id: string) {
    const m = store.member(id), g = store.geo(id);
    if (!m) return;
    if (!g || !earth) { toast(`<b>${esc(m.name)}</b> isn't sharing where they are.`); return; }
    deps.setWaypoint(g.lat, g.lon, m.name);
  }
  async function callHere() {
    const g = myGeo();
    if (!g) { toast('Markers need the real world. Start anywhere on Earth.'); return; }
    try {
      await teamApi.ping({ lat: g.lat, lon: g.lon, alt: g.alt, label: deps.where().place });
      track('team_ping', {});
    } catch (e) { toast(esc((e as Error).message)); }
  }
  const wave = () => { deps.wave(); };

  const phone = makePhoneTeam(store, { teleportTo, waypointTo, callHere, wave, hasWorld: !!earth });

  // ---- moments ----
  store.onEvent = (e) => {
    if (e.kind === 'join') toast(`<b>${esc(e.name)}</b> is online.`, 5000);
    else if (e.kind === 'leave') toast(`<b>${esc(e.name)}</b> left.`, 4000);
    else toast(`<b>${esc(e.name)}</b> waved${avatars.distance(e.id) < 200 ? '' : ' from far away'}.`, 4000);
  };
  store.onChat = (m) => {
    if (m.mine) return;
    avatars.say(m.from, m.text);
    if (!phone.chatOnScreen()) toast(`<b>${esc(m.name)}</b> ${esc(m.text.length > 120 ? `${m.text.slice(0, 119)}…` : m.text)}`, 6000);
  };
  store.onPing = (p) => {
    if (p.mine) { toast('Marker dropped. Your teammates can see it for a minute and a half.', 4000); return; }
    const el = toast(`<b>${esc(p.name)}</b> wants you${p.label ? ` at ${esc(p.label)}` : ' over'}. Click to set a waypoint.`, 12000);
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { deps.setWaypoint(p.lat, p.lon, p.name); el.remove(); });
  };

  // Someone walks into the building you're in.
  const wasIn = new Map<string, string>();
  let sawOnline = false, sawCompany = false;
  const met = new Set<string>();
  store.subscribe((what) => {
    if (what !== 'state') return;
    const mine = myRepo();
    for (const m of store.here()) {
      const key = m.inside?.kind === 'hq' ? `${m.inside.fullName ?? ''}|${m.inside.localRepo ?? ''}|${m.inside.label}` : '';
      if (key && wasIn.has(m.id) && wasIn.get(m.id) !== key && mine && sameRepo(m, mine)) toast(`<b>${esc(m.name)}</b> walked into <b>${esc(mine.name)}</b>.`, 6000);
      wasIn.set(m.id, key);
    }
    // Local analytics: was this session on a team, and was anyone else there at the same time.
    if (store.online && !sawOnline) { sawOnline = true; track('team_online', {}); }
    if (store.online && !sawCompany && store.here().length) { sawCompany = true; track('team_company', { others: store.here().length }); }
  });

  // ---- my own robot, ten times a second ----
  let acc = 0, waving = false, metTimer = 0;
  function report() {
    const w = deps.where();
    const r = robot.root;
    const g = myGeo();
    const riding = player.vehicle !== 'foot';
    sendLive({
      type: 'team:pose',
      pose: {
        ...(g ? { lat: g.lat, lon: g.lon, alt: g.alt, agl: w.inside ? 0 : Math.max(0, player.agl) } : {}),
        rot: [r.rotation.x, r.rotation.y, r.rotation.z],
        st: robot.state, sp: riding ? player.vehicleSpeed : player.speed, veh: player.vehicle,
        rk: robot.rockets, lx: robot.lean.x, lz: robot.lean.z, wg: robot.wings, cad: robot.ride.cadence,
        place: w.place,
        ...(w.inside?.kind === 'hq' ? { in: 'hq' as const, x: r.position.x, y: r.position.y, z: r.position.z, room: w.inside.room, ...(w.inside.repo.showcase ? { pub: w.inside.repo.fullName } : { repo: w.inside.repo.name }) } : {}),
        ...(w.inside?.kind === 'room' ? { in: 'room' as const, title: w.inside.title } : {}),
      },
    });
  }

  return {
    store, avatars, phone, teleportTo, waypointTo,
    update(dt) {
      if (!store.state?.configured) { if (avatars.debug().length) avatars.update(dt); return; }
      acc += dt;
      if (acc >= 0.1 && store.online) {
        acc = 0;
        report();
        // A wave reaches teammates who can't see you, too.
        const w = robot.state === 'wave';
        if (w && !waving && store.here().length) void teamApi.emote().catch(() => {});
        waving = w;
      }
      avatars.update(dt);
      // The first time two players stand within 50 m of each other in a session.
      metTimer -= dt;
      if (metTimer < 0) {
        metTimer = 0.5;
        for (const m of store.here()) if (!met.has(m.id) && avatars.distance(m.id) < 50) { met.add(m.id); track('team_seen_together', { indoors: !!deps.where().inside }); }
      }
    },
    markers() {
      if (!earth || !store.online) return [];
      const out: MapMarker[] = [];
      for (const m of store.here()) {
        const g = store.geo(m.id);
        if (!g || m.idle) continue;
        out.push({ lat: g.lat, lon: g.lon, color: safeColor(m.color), label: m.name, sub: whereLine(m), big: true, live: true, group: 'team', teleport: () => { void teleportTo(m.id); } });
      }
      const me = myGeo();
      for (const p of store.livePings()) if (!p.mine || !me || haversine(me, p) > 30) out.push({ lat: p.lat, lon: p.lon, color: '#ff5a1f', label: `${p.name}: come here`, live: true, group: 'team' });
      return out;
    },
  };
}
