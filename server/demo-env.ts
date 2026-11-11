// Settings for the public web demo, applied before anything else loads (config.ts reads them at import).
// The demo never touches a GitHub account, an AI account or anyone's keys: GitHub writes are dry runs,
// no token is ever looked up, and everything it caches lives in a throwaway folder.
process.env.OPENWORLD_DEMO = '1';
process.env.OPENWORLD_NO_GITHUB = '1';
process.env.OPENWORLD_DRY_PR = '1';
process.env.OPENWORLD_DRY_GITHUB = '1';
if (process.env.VERCEL) {
  // The only writable place on the host, and small: keep the tile cache well under it.
  process.env.OPENWORLD_HOME = '/tmp/openworld';
  process.env.OPENWORLD_TILE_CACHE_MB ??= '200';
}
export {};
