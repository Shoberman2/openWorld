// "Sign in with GitHub" without pasting a token: GitHub's device flow. The page asks for a short code,
// you type it at github.com/login/device and approve, and this server collects the token and saves it
// where a pasted one goes (~/.openworld/config.json). No secret is involved: a device flow needs only
// the OAuth app's public client ID, which is why it suits a program people run on their own computer.
import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { writeConfig, logEvent } from './config.ts';
import { getMe, resetToken, validateToken } from './github.ts';

/** The OpenWorld OAuth app (Settings → Developer settings → OAuth Apps, device flow on). Public by design. */
const BUILTIN_CLIENT_ID = '';
export const clientId = () => process.env.OPENWORLD_GITHUB_CLIENT_ID || BUILTIN_CLIENT_ID;

// What the game does with your GitHub: reads your repos (private ones too), opens pull requests, and
// lists the repos of organizations you belong to.
const SCOPES = 'repo read:org';

type Pending = { deviceCode: string; interval: number; expires: number };
const pending = new Map<string, Pending>();

const loopback = (req: Request) => {
  const a = req.socket.remoteAddress;
  return !a || a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

async function post(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'openworld-game' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok && !json.error) throw new Error(`GitHub answered ${res.status}`);
  return json;
}

export function registerGitHubLogin(app: Express) {
  app.post('/api/github/login', async (req, res) => {
    const id = clientId();
    if (!id) return void res.status(404).json({ error: 'Sign-in with GitHub is not set up in this copy. Paste a token instead.' });
    if (!loopback(req)) return void res.status(403).json({ error: 'Sign in on the computer running OpenWorld' });
    try {
      const r = await post('https://github.com/login/device/code', { client_id: id, scope: SCOPES });
      if (r.error) return void res.status(502).json({ error: `GitHub wouldn't start sign-in: ${r.error_description || r.error}. Paste a token instead.` });
      const key = randomUUID();
      pending.set(key, { deviceCode: r.device_code, interval: r.interval ?? 5, expires: Date.now() + (r.expires_in ?? 900) * 1000 });
      for (const [k, p] of pending) if (p.expires < Date.now()) pending.delete(k);
      logEvent('github_login_started', {});
      res.json({ id: key, userCode: r.user_code, verificationUri: r.verification_uri, interval: r.interval ?? 5, expiresIn: r.expires_in ?? 900 });
    } catch (e) {
      res.status(502).json({ error: `Couldn't reach GitHub: ${(e as Error).message}` });
    }
  });

  // One check per call; the page calls again after `interval` seconds until it's done.
  app.post('/api/github/login/poll', async (req, res) => {
    if (!loopback(req)) return void res.status(403).json({ error: 'Sign in on the computer running OpenWorld' });
    const p = pending.get(String(req.body?.id || ''));
    if (!p || p.expires < Date.now()) return void res.json({ status: 'expired' });
    try {
      const r = await post('https://github.com/login/oauth/access_token', {
        client_id: clientId(), device_code: p.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      if (r.access_token) {
        pending.delete(String(req.body.id));
        const me = await validateToken(r.access_token);
        if (!me.connected) return void res.json({ status: 'denied' });
        writeConfig({ token: r.access_token });
        resetToken();
        logEvent('github_login_done', {});
        return void res.json({ status: 'done', me: await getMe() });
      }
      if (r.error === 'slow_down') p.interval = r.interval ?? p.interval + 5;
      const status = r.error === 'authorization_pending' || r.error === 'slow_down' ? 'pending'
        : r.error === 'access_denied' ? 'denied' : r.error === 'expired_token' ? 'expired' : 'pending';
      if (status !== 'pending') pending.delete(String(req.body.id));
      res.json({ status, interval: p.interval });
    } catch {
      res.json({ status: 'pending', interval: p.interval }); // a blip: try again next round
    }
  });
}
