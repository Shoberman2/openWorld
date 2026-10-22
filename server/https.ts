import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { PATHS } from './config.ts';
import { allowHosts, loopback } from './guard.ts';

// HTTPS for VR headsets. WebXR only runs in a secure context, and a Meta Quest reaches this Mac over
// the LAN (not localhost), so `OPENWORLD_HTTPS=1` (or `npm run vr`) also serves the game over HTTPS
// with a self-signed certificate made once with openssl. The headset's browser shows a warning the
// first time ("Advanced → Proceed").
//
// The LAN can reach a server that drives agents with your GitHub token, so anyone not on this machine
// needs the key printed in the URL (it's then kept in a cookie).

const CERTS = join(PATHS.home, 'certs');
const KEY_FILE = join(CERTS, 'key.pem'), CERT_FILE = join(CERTS, 'cert.pem'), ACCESS_FILE = join(CERTS, 'access-key');

export function lanAddresses() {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

/** The self-signed cert, made on first use. Regenerated when this Mac's LAN address changes. */
function certificate() {
  mkdirSync(CERTS, { recursive: true });
  const ips = lanAddresses();
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  const sanFile = join(CERTS, 'san.txt');
  const stale = !existsSync(CERT_FILE) || !existsSync(sanFile) || readFileSync(sanFile, 'utf8') !== san;
  if (stale) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', KEY_FILE, '-out', CERT_FILE, '-subj', '/CN=OpenWorld (local)', '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' });
    chmodSync(KEY_FILE, 0o600);
    writeFileSync(sanFile, san);
  }
  return { key: readFileSync(KEY_FILE), cert: readFileSync(CERT_FILE) };
}

function accessKey() {
  mkdirSync(CERTS, { recursive: true });
  if (!existsSync(ACCESS_FILE)) writeFileSync(ACCESS_FILE, randomBytes(12).toString('hex'), { mode: 0o600 });
  return readFileSync(ACCESS_FILE, 'utf8').trim();
}

const cookieKey = (req: IncomingMessage) => /(?:^|;\s*)ow_key=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];

export const httpsEnabled = () => process.env.OPENWORLD_HTTPS === '1' || process.env.OPENWORLD_HTTPS === 'true';

/**
 * Serve `app` over HTTPS on every interface. `attach` gets the server (for the WebSocket) and a
 * check for upgrade requests. Prints the URL to open on the headset.
 */
export function startHttps(app: Express, port: number, attach: (srv: Server, allowed: (req: IncomingMessage) => boolean) => void) {
  const key = accessKey();
  allowHosts(lanAddresses()); // the headset reaches it by this Mac's LAN address
  const allowed = (req: IncomingMessage) => loopback(req.socket.remoteAddress) || cookieKey(req) === key;
  const gate = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (allowed(req)) return next();
    if (new URL(req.url ?? '/', 'https://x').searchParams.get('key') === key) {
      res.setHeader('Set-Cookie', `ow_key=${key}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict`);
      return next();
    }
    res.writeHead(403, { 'content-type': 'text/plain' }).end('OpenWorld: open the full URL (with ?key=...) printed in the terminal on your Mac.');
  };
  const srv = createServer(certificate(), (req, res) => gate(req, res, () => app(req, res)));
  attach(srv, allowed);
  srv.listen(port, () => {
    const ips = lanAddresses();
    console.log(`OpenWorld VR (HTTPS) on https://localhost:${port}`);
    for (const ip of ips) console.log(`  On your Quest, open: https://${ip}:${port}/?key=${key}`);
    if (!ips.length) console.log('  (no LAN address found; use `adb reverse` and https://localhost:' + port + ')');
  });
  return srv;
}
