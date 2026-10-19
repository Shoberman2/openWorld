# OpenWorld HQ

Your GitHub, as a living open world: **the whole planet**, streamed from OpenStreetMap with real terrain, in the bright, toy-like style of Charlie Chapman's "Hello World" game. You're a little robot in an orange hoodie with rocket shoes. Start anywhere, walk the real streets, or fly over the city and keep going: the world loads around you. Every repository you own becomes a building where you start: big, active projects take the tallest towers with their logo on the crown, small experiments are storefronts. Press **E** at a door to go inside. (The four hand-built classic cities, New York, San Francisco, Miami and Boston, are still there too.)

Inside each building:

- **Reception**: a receptionist who knows the project (README, stats, recent work) and points you around.
- **Work floor**: one desk per past PR (or commit, for repos without PRs). The person at the desk is whoever made the change: you, a teammate, or an AI agent like Claude. Press **E** and they explain the change in their own words, with the real diff as context, then answer follow-up questions.
- **Agent Lab**: hire an agent. Type a task and a real Claude Code agent starts working in an isolated git worktree of the repo. It takes a desk, its monitor shows live progress, and you can watch the diff grow, stop it, or open a pull request when it's done.
- **Boardroom**: put a decision to the board (Chair, CTO, Head of Product, Design Lead, Growth). They debate in turns, take positions for or against, and the Chair records a resolution with next steps. Past decisions stay on the wall.

## Anywhere on Earth

Search any place on the title screen (or pick Times Square, Russian Hill, the Jordaan, Le Marais, Shibuya…) and you start there. Nothing is pre-downloaded: like the game it's inspired by, the world **streams** around you as map tiles.

- **Map data**: OpenMapTiles vector tiles (from OpenFreeMap) with real building footprints and heights, roads and bridges, water and coastlines, parks, woods and land use, street and neighborhood names. Lanes, traffic lights, street lights and trees are derived from it.
- **Terrain**: real elevation (Mapterhorn / Copernicus terrain tiles), so San Francisco's hills are hills and bridges span rivers on piers.
- **The horizon**: low-detail terrain draped with Sentinel-2 cloudless satellite imagery, so you can fly up and see the coast 20 km away.
- **Look**: regional building styles (Amsterdam brick with gabled roofs, Paris sandstone and zinc, Manhattan brick, limestone and glass, Tokyo tile and glass), lit windows at night, a cartoon sky with big puffy clouds, golden sunsets, a starry night.
- **Life**: cars on the correct side of the road for the country (taxis in New York), stopping at signals and pitching over hills, and white caretaker robots walking the sidewalks, a few carrying packages.
- **Getting around**: walk, run, jump, or hold **Space** in the air for rocket shoes (**Shift** to burst, **C** to dive). Land on roofs and bridges; swim if you come down in the water. Press **M** for the map of the world: search, browse famous places, then **Drop here** to be anywhere on Earth in a few seconds, or **Navigate here** for a waypoint on the compass and minimap.
- **Vehicles** (keys **1–7** or the mode bar): skateboard, bike, jeep, prop plane (needs ~45 m of clear ground, or switch to it mid-air), kayak and motorboat (they find water within ~60 m).
- **Go inside anything**: walk up to any building's wall and press **E**. It gets an interior that fits its real footprint: house, apartments, offices or an office tower (stairs, and a lift above three floors), shop, mall, church, warehouse, named from the map when it can ("Saint Patrick's Cathedral"). Leave by the door, or jump out a window and catch yourself on the rocket shoes.
- **Live weather** for wherever you are (Open-Meteo): rain, snow, fog, thunderstorms, dust, auroras up north at night, big waves with whitecaps at sea when it's stormy. **L** runs a time-lapse; the map's Settings can force any weather.
- **Photo mode** (**F**): free camera, depth of field, zoom, time of day, time-lapse, a thirds grid; **Space** saves the picture to `~/.openworld/photos`.
- Your projects live where you started; the phone's **Go** buttons (and Tab) fly you home.

Detail streams in near you (about 0.7 km, more when you're flying), lighter buildings out to ~3–5 km, satellite terrain beyond. Everything runs in background workers. Tiles are cached in `~/.openworld/cache/tiles` (capped at 3 GB, least recently visited trimmed first; set `OPENWORLD_TILE_CACHE_MB` to change it), and the tiles around wherever you are get fetched in the background, so places you've been, and the next block over, load instantly. Add `?q=low` to the URL on a slow GPU.

Map data © OpenStreetMap contributors, © OpenMapTiles; terrain © Mapterhorn, Copernicus; imagery Sentinel-2 cloudless 2016 by EOX (CC BY 4.0); weather from Open-Meteo.

## The phone and HQ

Press **P** (or click the phone in the corner) anywhere, outside or inside a building. The office is one agent, **HQ**, that runs every other agent:

- **Messages**: text HQ ("can someone add tests to calendar-hub?"). HQ replies, hires agents in the right buildings, and texts you back with a report when they finish.
- **Mail**: the same thing as email, with a subject line and full reports in your inbox.
- **Agents**: every agent across all buildings, live: status, last action, files changed, cost. Stop one, open its log, or jump to its building.
- **Maps**: every project HQ in the current place; pin a waypoint or fast-travel.

HQ never opens a pull request unless you ask for one in your message.

## Run it

Requirements: Node 22+, the [GitHub CLI](https://cli.github.com) logged in (`gh auth login`), or a GitHub token pasted on the title screen. [Claude Code](https://claude.com/claude-code) is needed for desk conversations, agents and the boardroom.

```bash
npm install
npm start          # builds the client, starts the local server, open http://localhost:4317
# or
npx openworld      # same, and opens your browser
npm run dev        # development: Vite on :5317 with hot reload, API on :4317
```

Everything runs locally. Your token never leaves your machine except to call GitHub. State lives in `~/.openworld/` (logo cache, agent worktrees, boardroom minutes, local analytics).

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (steer while flying) |
| Shift | Run (burst while flying) |
| **Space** | Jump; hold in the air for rocket shoes, then climb (let go to hover) |
| C | Dive (drop out of rocket flight); pitch down in the plane |
| 1–7 | On foot, skateboard, bike, jeep, prop plane, kayak, motorboat |
| F | Photo mode |
| L | Time-lapse |
| Mouse (click to capture) | Look |
| Wheel | Camera distance |
| **E** | Enter a building, talk to someone, use a kiosk |
| **P** | Phone: text or email HQ, see every agent, map |
| **M** | Map of the world: search, Drop here, Navigate here (big map in classic cities) |
| Tab | Directory: waypoint or fast travel to any project |
| G / X | Wave / sit down |
| T | Skip ahead 3 hours (day/night cycle) |
| Esc | Close a panel or release the mouse |

## How it's built

- `client/`: Three.js + Vite + TypeScript.
  - `src/earth/`: the streaming world. `frame.ts` (local meters ↔ lat/lon ↔ tiles), `worker.ts` + `build/` (decode a vector tile and its terrain into meshes off the main thread: draped ground with a painted land-use texture, water, buildings with facade coordinates and gabled roofs, roads, bridges, markings, signals, lights, trees), `chunks.ts` (what to load at which detail as you move, physics, the road network), `far.ts` (satellite horizon), `traffic.ts` + `crowd.ts` (cars and robots), `sites.ts` (project HQs), `style.ts` (the look: facade, ground, water and tree materials).
  - `src/robot.ts` (the player), `player.ts` (walk, jump, rocket shoes, roofs, swimming), `sky.ts` + `engine.ts` (sky dome, clouds, light, grading).
  - `src/ui/`: HUD (compass, info panel, navigation card, hints, mode bar), the heading-up minimap and the world map (`tilemap.ts` renders vector tiles in a worker), the phone, panels.
  - Classic cities (`src/city/`), interiors (`interior.ts`), aircraft (`aircraft.ts`).
- `server/`: Express + WebSocket. Map tiles proxied and cached (`tiles.ts`), place search (`geo.ts`, Nominatim), the HQ office agent (`office.ts`), GitHub GraphQL/REST (`github.ts`), the `claude` CLI for conversations (`llm.ts`), agent runs in git worktrees streamed over the socket (`agents.ts`), and the boardroom (`boardroom.ts`).
- `shared/types.ts`: the contract between them.

Building size comes from a score of commits, PRs, repo size, a live homepage and recency, ranked into landmark, tower, mid-rise and storefront tiers.

## What we're testing

Value hypothesis: developers who walk into a repo's building will understand recent changes faster by talking to the desk workers than by reading the PR list, and will come back to hire agents from inside the game.

Growth hypothesis: a screenshot or clip of *your own* code as a skyline gets shared, and people install it to see theirs.

Exploration hypothesis: being able to go *anywhere* (and fly there) brings people back more than a fixed city does. Measured as the share of Earth sessions that leave the home district (`explore.exploreShare` in `/api/stats`).

Local, cohort-ready events go to `~/.openworld/events.jsonl` (`session_start` with the city or real place, `explore_far`, `explore_teleport`, `building_entered`, `desk_talk`, `agent_started`, `agent_pr_opened`, `boardroom_convened`, `office_message_sent`, `office_dispatch`); `GET /api/stats` summarizes them per day and session. Automated test runs are tagged and left out.
