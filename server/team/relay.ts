// The team relay: a tiny WebSocket server that passes presence and chat between the local servers of
// people on the same team. It never sees a GitHub token, an AI key, an agent or a file: only the few
// message kinds in protocol.ts, each clipped before it is passed on. A team is a room keyed by a long
// random code; without the code you get nothing. Runs standalone (`npm run team-relay`, see
// relay-main.ts) or inside a player's own server ("Host a team on this computer").
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  Bucket, LIMITS, PROTOCOL, cleanInfo, cleanName, cleanPing, cleanPose, roomKey, text, validCode, validId,
  type FromRelay, type WireInfo, type WirePose,
} from './protocol.ts';

export interface RelayOptions {
  port: number;
  /** Interface to listen on. Default: all of them (other computers must be able to reach it). */
  host?: string;
  /** When set, only these team codes are accepted (the embedded relay only knows its own team). */
  codes?: () => string[];
  maxRoom?: number;
  maxRooms?: number;
  /** Drop a socket that says nothing for this long (ms). */
  idleMs?: number;
  log?: (line: string) => void;
}

export interface Relay {
  port: number;
  close(): Promise<void>;
  stats(): { rooms: number; peers: number };
}

interface Peer {
  ws: WebSocket;
  ip: string;
  id: string;
  name: string;
  room: string | null;
  pose?: WirePose;
  info?: WireInfo;
  last: number;
  all: Bucket; poses: Bucket; infos: Bucket; chats: Bucket; emotes: Bucket; pings: Bucket;
  strikes: number;
}

const MAX_PER_IP = 24;

export function startRelay(opts: RelayOptions): Promise<Relay> {
  const maxRoom = Math.max(2, Math.min(64, opts.maxRoom ?? LIMITS.room));
  const maxRooms = opts.maxRooms ?? 500;
  const idleMs = opts.idleMs ?? 45_000;
  const log = opts.log ?? (() => {});
  const rooms = new Map<string, Map<string, Peer>>();
  const peers = new Set<Peer>();
  const perIp = new Map<string, number>();

  // Plain HTTP answers with one line, so someone who opens the address in a browser learns what it is.
  const http: Server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end('OpenWorld team relay. Paste the invite into OpenWorld: Settings, Team.\n');
  });
  const wss = new WebSocketServer({
    server: http,
    maxPayload: LIMITS.payload,
    perMessageDeflate: false,
    // Only OpenWorld servers connect here. A browser always sends an Origin, so web pages are turned away.
    verifyClient: ({ req }: { req: IncomingMessage }) => req.headers.origin === undefined && (perIp.get(req.socket.remoteAddress ?? '') ?? 0) < MAX_PER_IP,
  });

  const send = (p: Peer, msg: FromRelay) => { if (p.ws.readyState === WebSocket.OPEN && p.ws.bufferedAmount < 256 * 1024) p.ws.send(JSON.stringify(msg)); };
  const others = (p: Peer, msg: FromRelay, andSelf = false) => {
    const room = p.room ? rooms.get(p.room) : null;
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const o of room.values()) if ((andSelf || o !== p) && o.ws.readyState === WebSocket.OPEN && o.ws.bufferedAmount < 256 * 1024) o.ws.send(data);
  };
  const drop = (p: Peer, reason?: FromRelay & { t: 'error' }) => {
    if (reason) send(p, reason);
    p.ws.close();
    setTimeout(() => p.ws.terminate(), 1000).unref();
  };
  const leave = (p: Peer) => {
    if (!peers.delete(p)) return;
    perIp.set(p.ip, Math.max(0, (perIp.get(p.ip) ?? 1) - 1));
    const room = p.room ? rooms.get(p.room) : null;
    if (!room || room.get(p.id) !== p) return;
    room.delete(p.id);
    if (!room.size) rooms.delete(p.room!);
    else others(p, { t: 'leave', id: p.id });
    log(`left (${room.size} in the room, ${rooms.size} rooms)`);
  };

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress ?? '';
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const p: Peer = {
      ws, ip, id: '', name: '', room: null, last: Date.now(), strikes: 0,
      all: new Bucket(40, 80), poses: new Bucket(15, 30), infos: new Bucket(1, 6), chats: new Bucket(0.5, 5), emotes: new Bucket(0.5, 4), pings: new Bucket(0.1, 3),
    };
    peers.add(p);
    // The code has to come first, and soon.
    const helloTimer = setTimeout(() => { if (!p.room) drop(p, { t: 'error', reason: 'hello' }); }, 6000);
    ws.on('close', () => { clearTimeout(helloTimer); leave(p); });
    ws.on('error', () => { /* 'close' follows */ });
    ws.on('pong', () => { p.last = Date.now(); });
    ws.on('message', (data, isBinary) => {
      p.last = Date.now();
      // Far too chatty: a few warnings, then out.
      if (!p.all.take()) { if (++p.strikes > 40) drop(p, { t: 'error', reason: 'busy' }); return; }
      if (isBinary) return;
      let m: Record<string, unknown>;
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;

      if (!p.room) {
        if (m.t !== 'hello') return;
        if (m.v !== PROTOCOL) return drop(p, { t: 'error', reason: 'version' });
        const allowed = opts.codes?.();
        if (!validCode(m.code) || !validId(m.id) || (allowed && !allowed.includes(m.code))) {
          // A wrong code looks the same as any other failure, after a pause.
          setTimeout(() => drop(p, { t: 'error', reason: 'code' }), 400).unref();
          return;
        }
        const key = roomKey(m.code);
        let room = rooms.get(key);
        if (!room) {
          if (rooms.size >= maxRooms) return drop(p, { t: 'error', reason: 'full' });
          rooms.set(key, (room = new Map()));
        }
        // The same player reconnecting replaces their old connection.
        const old = room.get(m.id);
        if (!old && room.size >= maxRoom) return drop(p, { t: 'error', reason: 'full' });
        p.id = m.id; p.name = cleanName(m.name); p.room = key;
        if (old) { old.room = null; old.ws.close(); }
        room.set(p.id, p);
        clearTimeout(helloTimer);
        send(p, { t: 'welcome', id: p.id, cap: maxRoom, peers: [...room.values()].filter((o) => o !== p).map((o) => ({ id: o.id, name: o.name, p: o.pose, i: o.info })) });
        if (!old) others(p, { t: 'join', id: p.id, name: p.name });
        log(`joined (${room.size} in the room, ${rooms.size} rooms)`);
        return;
      }

      switch (m.t) {
        case 'pose': {
          if (!p.poses.take()) return;
          const pose = cleanPose(m.p);
          if (!pose) return;
          p.pose = pose;
          others(p, { t: 'pose', id: p.id, p: pose });
          return;
        }
        case 'info': {
          if (!p.infos.take()) return;
          const info = cleanInfo(m.i);
          if (!info) return;
          p.info = info; p.name = info.name;
          others(p, { t: 'info', id: p.id, i: info });
          return;
        }
        case 'chat': {
          if (!p.chats.take()) return;
          const body = text(m.text, LIMITS.chat);
          if (body) others(p, { t: 'chat', id: p.id, name: p.name, text: body, ts: Date.now() }, true);
          return;
        }
        case 'emote':
          if (m.kind === 'wave' && p.emotes.take()) others(p, { t: 'emote', id: p.id, kind: 'wave' });
          return;
        case 'ping': {
          if (!p.pings.take()) return;
          const at = cleanPing(m);
          if (at) others(p, { t: 'ping', id: p.id, name: p.name, ...at, ts: Date.now() }, true);
          return;
        }
        default:
          return; // anything else is not passed on
      }
    });
  });

  // Quiet sockets get a ping; ones that stay quiet are dropped.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const p of peers) {
      if (now - p.last > idleMs) { p.ws.terminate(); continue; }
      if (now - p.last > idleMs / 3 && p.ws.readyState === WebSocket.OPEN) p.ws.ping();
    }
  }, Math.max(1000, Math.min(15_000, idleMs / 3)));
  sweep.unref();

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host, () => {
      http.off('error', reject);
      http.on('error', (e) => log(`relay error: ${e.message}`));
      const addr = http.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : opts.port,
        stats: () => ({ rooms: rooms.size, peers: peers.size }),
        close: () => new Promise<void>((done) => {
          clearInterval(sweep);
          for (const p of peers) p.ws.terminate();
          wss.close(() => http.close(() => done()));
          http.closeAllConnections?.();
        }),
      });
    });
  });
}
