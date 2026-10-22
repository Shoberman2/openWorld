# Contributing

Thanks for helping build OpenWorld. Bug reports, places that look wrong, new interiors, landmark models and provider adapters are all welcome.

## Getting set up

```bash
git clone https://github.com/<you>/openWorld.git && cd openWorld
npm install
cp .env.example .env   # optional
npm run dev            # http://localhost:5317 (API on :4317)
```

You don't need any AI key to work on the world itself: without one, the people in the buildings read from a script. To exercise agent runs without spending anything, start the server with `OPENWORLD_FAKE_AGENTS=1 OPENWORLD_DRY_PR=1`.

## Before you open a pull request

- `npm run typecheck` and `npm run build` pass.
- Look at your change in the game. Add `?q=low` to the URL on a slow GPU.
- Keep pull requests focused: one feature or fix each, with a screenshot for anything visual.
- Match the surrounding code: TypeScript, no new runtime dependencies without a good reason, comments that explain *why*.

## Ground rules

- **Keys never reach the browser and never get logged.** Anything that touches `~/.openworld/config.json`, `server/providers/` or agent runs gets extra review.
- **Original art only.** Models, textures and characters must be your own work or under a license that allows redistribution (CC0, CC BY, MIT…). Say where they come from in the pull request. No logos or trademarks of real brands.
- **Respect the map data licenses.** Map data is © OpenStreetMap contributors and must stay attributed.
- **Be kind.** Assume good intent, review the code, not the person.

## Where things live

See "How it's built" in [README.md](README.md). Good first areas: store interiors (`client/src/rooms/stores.ts`), landmarks (`client/src/earth/landmarks/`), and chat provider adapters (`server/providers/`).

By contributing you agree that your contributions are licensed under the MIT License in [LICENSE](LICENSE).
