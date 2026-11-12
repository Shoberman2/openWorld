// "Sign in with GitHub" for the start page and Settings: asks the server for a short code, opens
// github.com/login/device in a new tab (with the code copied), and waits until it's approved there.
import type { Me } from '../../shared/types.ts';
import { api, track } from './api.ts';

export type LoginStep = { code: string; url: string };

/** Call straight from the click, so the browser lets the new tab open. Resolves with you, signed in. */
export async function signInWithGitHub(from: string, onCode: (s: LoginStep) => void): Promise<Me> {
  const tab = window.open('about:blank', '_blank');
  let start;
  try { start = await api.githubLogin(); } catch (e) { tab?.close(); throw e; }
  onCode({ code: start.userCode, url: start.verificationUri });
  navigator.clipboard?.writeText(start.userCode).catch(() => {});
  if (tab) tab.location.href = start.verificationUri;
  track('github_login_started', { from });
  let wait = start.interval;
  const until = Date.now() + start.expiresIn * 1000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    const r = await api.githubLoginPoll(start.id).catch(() => ({ status: 'pending' as const, interval: wait, me: undefined }));
    if (r.status === 'done' && r.me) { track('github_connected', { from, via: 'device' }); return r.me; }
    if (r.status === 'denied') throw new Error('Sign-in was cancelled on GitHub.');
    if (r.status === 'expired') break;
    wait = r.interval ?? wait;
  }
  throw new Error('The code expired. Try again.');
}
