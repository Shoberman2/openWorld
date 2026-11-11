// `npm run team-relay`: run a team relay on its own (a small VPS, a machine on your Tailscale network
// or your LAN) so teammates can find each other without anyone hosting from their laptop.
// TEAM_RELAY_PORT (default 4319), TEAM_RELAY_HOST (default: all interfaces), TEAM_RELAY_MAX (people per
// team, default 16), TEAM_RELAY_CODES (comma-separated: only these team codes are let in).
import { networkInterfaces } from 'node:os';
import { startRelay } from './relay.ts';
import { DEFAULT_RELAY_PORT, makeInvite, newCode, validCode } from './protocol.ts';

const port = Number(process.env.TEAM_RELAY_PORT) || DEFAULT_RELAY_PORT;
const host = process.env.TEAM_RELAY_HOST || undefined;
const codes = (process.env.TEAM_RELAY_CODES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const bad = codes.filter((c) => !validCode(c));
if (bad.length) {
  console.error('TEAM_RELAY_CODES: each code needs 16 to 64 letters, digits, - or _.');
  process.exit(1);
}

const relay = await startRelay({
  port, host,
  codes: codes.length ? () => codes : undefined,
  maxRoom: Number(process.env.TEAM_RELAY_MAX) || undefined,
  log: process.env.TEAM_RELAY_QUIET === '1' ? undefined : (line) => console.log(`[relay] ${line}`),
}).catch((e) => {
  console.error(`Couldn't start the relay on port ${port}: ${e.message}`);
  process.exit(1);
});

const addrs = Object.values(networkInterfaces()).flat().filter((a) => a && !a.internal && a.family === 'IPv4').map((a) => a!.address);
const shown = host && host !== '0.0.0.0' && host !== '::' ? [host] : addrs.length ? addrs : ['localhost'];
console.log(`OpenWorld team relay on port ${relay.port}. It passes presence and chat only.`);
if (codes.length) {
  console.log('Only the team codes in TEAM_RELAY_CODES are let in. Invites:');
  for (const c of codes) console.log(`  ${makeInvite(`ws://${shown[0]}:${relay.port}`, c)}`);
} else {
  const code = newCode();
  console.log('A fresh invite for a new team (paste it into OpenWorld: Settings, Team, Join):');
  for (const a of shown) console.log(`  ${makeInvite(`ws://${a}:${relay.port}`, code)}`);
  console.log('Anyone with an invite can join that team, so share it like a password.');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { void relay.close().then(() => process.exit(0)); });
