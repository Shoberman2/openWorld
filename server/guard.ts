// Who may talk to this server. It runs coding agents and writes to GitHub with your keys, so only pages
// served from this machine may use it:
// - connections from other machines are refused (the HTTPS/VR server has its own access-key gate),
// - the Host header must be a local name, so a website can't reach it through DNS rebinding,
// - a browser's Origin must be local too, so other websites can't post to it or open its socket.
// OPENWORLD_ALLOWED_HOSTS (comma-separated) adds names, e.g. a reverse proxy in front of it.
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

const LOCAL_NAMES = ['localhost', '127.0.0.1', '::1'];
const extra = () => (process.env.OPENWORLD_ALLOWED_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const loopback = (addr?: string) => !addr || addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

/** Host names (no port) this server answers to; the HTTPS server adds this Mac's LAN addresses. */
let hosts = new Set([...LOCAL_NAMES, ...extra()]);
export function allowHosts(names: string[]) {
  hosts = new Set([...hosts, ...names.map((n) => n.toLowerCase())]);
}

/** "localhost:4317" / "[::1]:4317" / "192.168.1.2" → the bare host name. */
function hostName(hostHeader: string) {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.replace(/:\d+$/, '');
}

function originHost(origin: string) {
  try {
    return hostName(new URL(origin).host);
  } catch {
    return null;
  }
}

/** Host is one of ours, and the Origin (when a browser sends one) is too. */
export function trustedRequest(req: IncomingMessage) {
  const host = req.headers.host;
  if (!host || !hosts.has(hostName(host))) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true; // curl, or a same-origin GET
  const oh = originHost(origin);
  return !!oh && hosts.has(oh);
}

export function guardHttp(req: Request, res: Response, next: NextFunction) {
  if (trustedRequest(req)) return next();
  res.status(403).json({ error: 'OpenWorld only answers pages served from this machine.' });
}

/** For the plain-HTTP server: drop connections from anywhere but this machine. */
export function localOnly(socket: Socket) {
  if (!loopback(socket.remoteAddress)) socket.destroy();
}
