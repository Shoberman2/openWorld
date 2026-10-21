# OpenWorld HQ

Your GitHub, as a living open world: **the whole planet**, streamed from OpenStreetMap with real terrain, in the bright, toy-like style of Charlie Chapman's "Hello World" game. You're a little robot in an orange hoodie with rocket shoes. Start anywhere, walk the real streets, or fly over the city and keep going: the world loads around you. Every repository you own becomes a building where you start: big, active projects take the tallest towers with their logo on the crown, small experiments are storefronts. Press **E** at a door to go inside.

Inside each building:

- **Reception**: a receptionist who knows the project (README, stats, recent work) and points you around.
- **Work floor**: one desk per past PR (or commit, for repos without PRs). The person at the desk is whoever made the change: you, a teammate, or an AI agent like Claude. Press **E** and they explain the change in their own words, with the real diff as context, then answer follow-up questions.
- **Agent Lab**: hire an agent. Type a task and a real coding agent (Claude Code, Codex or Gemini CLI, whichever you set up) starts working in an isolated git worktree of the repo. It takes a desk, its monitor shows live progress, and you can watch the diff grow, stop it, or open a pull request when it's done.
- **Boardroom**: put a decision to the board (Chair, CTO, Head of Product, Design Lead, Growth). They debate in turns, take positions for or against, and the Chair records a resolution with next steps. Past decisions stay on the wall.

## Anywhere on Earth

Search any place on the title screen (or pick Times Square, Russian Hill, the Jordaan, Le Marais, Shibuya…) and you start there. Nothing is pre-downloaded: like the game it's inspired by, the world **streams** around you as map tiles.

- **Map data**: OpenMapTiles vector tiles (from OpenFreeMap) with real building footprints and heights, roads and bridges, water and coastlines, parks, woods and land use, street and neighborhood names. Lanes, traffic lights, street lights and trees are derived from it.
- **Terrain**: real elevation (Mapterhorn / Copernicus terrain tiles), so San Francisco's hills are hills and bridges span rivers on piers.
- **The horizon**: low-detail terrain draped with Sentinel-2 cloudless satellite imagery, so you can fly up and see the coast 20 km away.
- **Look**: regional building styles (Amsterdam brick with gabled roofs, Paris sandstone and zinc, Manhattan brick, limestone and glass, Tokyo tile and glass), lit windows at night, a cartoon sky with big puffy clouds, golden sunsets, a starry night.
- **Life**: cars on the correct side of the road for the country (taxis in New York), stopping at signals and pitching over hills, and white caretaker robots walking the sidewalks, a few carrying packages.
- **Getting around**: walk, run, jump, or hold **Space** in the air to light the rocket shoes: they kick you up and burn against gravity, you fly where you look, **Shift** is the afterburner, **C** cuts them, and a hard landing ends in a roll. Land on roofs and bridges; swim if you come down in the water. Press **M** for the map of the world: search, browse famous places, then **Drop here** to be anywhere on Earth in a few seconds, or **Navigate here** for a waypoint on the compass and minimap.
- **Vehicles** (keys **1–8** or the mode bar): skateboard, bike, jeep, prop plane (needs ~45 m of clear ground, or switch to it mid-air), kayak and motorboat (they find water within ~60 m), and the **space shuttle**: it stands on its tail and launches from anywhere dry, then flies at Mach 1 on the mains and close to Mach 2 on the boosters (**Shift**).
- **Wingsuit** (**Q** in the air): glide at about 2.5:1, steer with the mouse and **A**/**D**, **W** to dive and **S** to flare; the rocket shoes still burn (**Space**) for a wingsuit-and-rockets run. Bail out of the shuttle high up and open it.
- **Autopilot** (**O**, or **Autopilot** on a place in the map): the shuttle (or the plane you're in) climbs out, turns onto the great-circle course and cruises with time running up to **40×**, so the sun and clouds race past, then slows, descends and hands you the controls overhead. Any flying key takes over. New York to London takes about five minutes. It holds back the time compression while the horizon is still streaming in, and the HUD says so.
- **The whole planet**: fly anywhere without a loading screen. Far from where you started, the world quietly re-centers under you (an exact change of coordinates: the old tiles stay on screen until the new ones cover them). From altitude, satellite terrain rings reach about 30, 200 and 600 km and bend with the Earth's curvature; the haze thins as you climb. Streaming looks ahead along your flight path. Zoom the map all the way out for a **globe** lit by the real sun, with live **clouds**, **rain and storms** and **wind** from Open-Meteo (a 15° grid of current conditions, refreshed every 30 minutes: where the weather is, not its exact shape). Container ships sail the open sea; bikes ride with the traffic (lots of them in Amsterdam), and cars switch sides of the road with the country.
- **Go inside anything**: walk up to any building's wall and press **E**. It gets an interior that fits its real footprint: house, apartments, offices or an office tower (stairs, and a lift above three floors), shop, mall, church, warehouse, named from the map when it can ("Saint Patrick's Cathedral"). Leave by the door, or jump out a window and catch yourself on the rocket shoes.
- **Live weather** for wherever you are (Open-Meteo): rain, snow, fog, thunderstorms, dust, auroras up north at night, big waves with whitecaps at sea when it's stormy. **L** runs a time-lapse; the map's Settings can force any weather.
- **Photo mode** (**F**): free camera, depth of field, zoom, time of day, time-lapse, a thirds grid; **Space** saves the picture to `~/.openworld/photos`.
- Your projects live where you started; the phone's **Go** buttons (and Tab) fly you home.

Detail streams in near you (about 0.7 km, more when you're flying), lighter buildings out to ~3–5 km, satellite terrain beyond. Everything runs in background workers. Tiles are cached in `~/.openworld/cache/tiles` (capped at 3 GB, least recently visited trimmed first; set `OPENWORLD_TILE_CACHE_MB` to change it), and the tiles around wherever you are get fetched in the background, so places you've been, and the next block over, load instantly. Add `?q=low` to the URL on a slow GPU.

Map data © OpenStreetMap contributors, © OpenMapTiles; terrain © Mapterhorn, Copernicus; imagery Sentinel-2 cloudless 2016 by EOX (CC BY 4.0); weather from Open-Meteo.

## The phone and HQ

Press **P** (or click the phone in the corner) anywhere, outside or inside a building. The office is one agent, **HQ**, that runs every other agent:

- **Messages**: text HQ ("can someone add tests to my-api?"). HQ replies, hires agents in the right buildings, and texts you back with a report when they finish.
- **Mail**: the same thing as email, with a subject line and full reports in your inbox.
- **Agents**: every agent across all buildings, live: status, last action, files changed, cost. Stop one, open its log, or jump to its building.
- **Maps**: every project HQ in the current place; pin a waypoint or fast-travel.

HQ never opens a pull request unless you ask for one in your message.

## Run it

Requirements: Node 22+ and git. Everything else is your own: your GitHub account, and whichever coding agents you want working for you.

1. **Install and start**
   ```bash
   git clone <this repo> && cd openWorld
   npm install
   npm run dev        # Vite on :5317 with hot reload, API on :4317. Open http://localhost:5317
   # or: npm start    # builds the client once and serves it on http://localhost:4317
   ```
2. **Connect GitHub.** Either log in with the [GitHub CLI](https://cli.github.com) (`gh auth login`), set `GITHUB_TOKEN`, or paste a token with `repo` scope on the landing page. Your repos become the buildings.
3. **Add at least one agent** in **Settings → Agents & keys** (the landing page shows a short setup card until you have). Each agent works with its own CLI login or with an API key you paste:

   | Agent | Install | Sign in, or key |
   | --- | --- | --- |
   | [Claude Code](https://claude.com/claude-code) | `npm i -g @anthropic-ai/claude-code` | run `claude` once, or an Anthropic key (`ANTHROPIC_API_KEY`) |
   | [Codex CLI](https://github.com/openai/codex) | `npm i -g @openai/codex` | run `codex` once, or an OpenAI key (`OPENAI_API_KEY` / `CODEX_API_KEY`) |
   | [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` | run `gemini` once, or a Gemini key (`GEMINI_API_KEY`) |

   Pick a default agent there; every "give a task" box also lets you choose per task. The same tab sets who voices the office (the receptionist, project leads, HQ and the boardroom): your Anthropic, OpenAI or Gemini key, or your Claude Code login, and which model. With no key at all the world, your repos and the buildings still work; the people inside read from a script and agents wait until you add one.

**Privacy.** Everything runs on your computer. Keys you paste are stored only in `~/.openworld/config.json` (readable by your user only), sent only to the company that made that agent or model, never returned to the browser (Settings shows the last 4 characters), and can only be changed from the computer running OpenWorld, not from a headset on the network. Environment variables override stored keys. Your GitHub token is only used to call GitHub. Other state lives in `~/.openworld/` too (map tile and logo cache, agent worktrees, boardroom minutes, local analytics); delete the folder to start over.

## VR on Quest

OpenWorld runs in a Meta Quest's browser (WebXR). WebXR only works on a secure page, so the headset needs either an HTTPS address or a USB tunnel to `localhost`.

**Over Wi-Fi (HTTPS):**

1. On the Mac: `npm run vr`. This serves the game as usual on http://localhost:4317 and also over HTTPS on port 4318, using a self-signed certificate it makes once in `~/.openworld/certs`. It prints a line like `On your Quest, open: https://192.168.1.20:4318/?key=…`.
2. Put the Quest on the same Wi-Fi, open the Browser, and type that full address, including `?key=…`. The key keeps other people on the network out, since the server drives agents with your GitHub token. You only need it once; it's remembered after that.
3. The browser warns about the certificate the first time: **Advanced → Proceed**.
4. Pick a place, enter the world, then press **Enter VR** at the top of the screen.

**Over USB instead (no certificate):** with the Quest in developer mode and plugged in, run `adb reverse tcp:4317 tcp:4317` and open http://localhost:4317 on the Quest. `localhost` counts as secure, so plain `npm start` is enough.

**Controls:**

| Controller | Action |
| --- | --- |
| Left stick | Walk (same speeds as the keyboard); steer vehicles |
| Left stick click / left grip / left trigger | Run (stick click toggles it) |
| Right stick left/right | Turn (snap 30°, or smooth) |
| Right stick down | Dive (in the air) |
| Right stick click | Switch view: first person or behind the robot |
| A | Jump; hold in the air for rocket shoes |
| B, or right trigger | Use / enter / talk (the game's E); B closes a panel |
| Right trigger at a panel | Click |
| X | Wrist phone |
| Y | Next vehicle |

The **wrist phone** on your left hand has every thread: HQ and each project's lead (master) agent. There's no keyboard, so it offers canned replies ("What's the latest here?", "Start on the most useful next thing. No PR."). It also has the agent roster with Stop buttons, vehicles, and VR settings (view, snap or smooth turning, comfort vignette, time of day, Exit VR). When the game opens a panel (desk conversations, the Agent Lab, the boardroom), a copy floats in front of you with its buttons and a few canned questions.

To keep it smooth on the headset, VR streams a smaller area, uses a smaller shadow map and foveated rendering, and skips bloom and color grading. The map screen's Settings have **VR headset** (hide the button) and **VR view**; `?vr=0` in the URL also turns VR off.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (steer while flying) |
| Shift | Run (burst while flying) |
| **Space** | Jump; hold in the air to light the rocket shoes and burn (let go and gravity takes over) |
| C | Dive (drop out of rocket flight); pitch down in the plane |
| 1–8 | On foot, skateboard, bike, jeep, prop plane, kayak, motorboat, space shuttle |
| Q | Wingsuit (in the air) |
| O | Autopilot to the waypoint (shuttle or plane) |
| F | Photo mode |
| L | Time-lapse |
| Mouse (click to capture) | Look |
| Wheel | Camera distance |
| **E** | Enter a building, talk to someone, use a kiosk |
| **P** | Phone: text or email HQ, see every agent, map |
| **M** | Map of the world: search, Drop here, Navigate here |
| Tab | Directory: waypoint or fast travel to any project |
| G / X | Wave / sit down |
| T | Skip ahead 3 hours (day/night cycle) |
| Esc | Close a panel or release the mouse |

## How it's built

- `client/`: Three.js + Vite + TypeScript.
  - `src/earth/`: the streaming world. `frame.ts` (local meters ↔ lat/lon ↔ tiles), `worker.ts` + `build/` (decode a vector tile and its terrain into meshes off the main thread: draped ground with a painted land-use texture, water, buildings with facade coordinates and gabled roofs, roads, bridges, markings, signals, lights, trees), `chunks.ts` (what to load at which detail as you move, physics, the road network), `far.ts` (satellite horizon), `traffic.ts` + `crowd.ts` (cars and robots), `sites.ts` (project HQs), `style.ts` (the look: facade, ground, water and tree materials).
  - `src/robot.ts` (the player), `player.ts` (walk, jump, rocket shoes, roofs, swimming), `sky.ts` + `engine.ts` (sky dome, clouds, light, grading).
  - `src/ui/`: HUD (compass, info panel, navigation card, hints, mode bar), the heading-up minimap and the world map (`tilemap.ts` renders vector tiles in a worker), the phone, panels.
  - `src/xr/`: VR (WebXR on Meta Quest): controllers, play space, wrist phone, panel mirror, comfort vignette.
  - Classic cities (`src/city/`), interiors (`interior.ts`), aircraft (`aircraft.ts`).
- `server/`: Express + WebSocket. Map tiles proxied and cached (`tiles.ts`), place search (`geo.ts`, Nominatim), the HQ office agent (`office.ts`), GitHub GraphQL/REST (`github.ts`), conversations through your chosen key or CLI (`llm.ts`), agent runs in git worktrees streamed over the socket (`agents.ts`, with one adapter per coding CLI in `providers/`: Claude Code, Codex, Gemini; keys and readiness in `providers/index.ts`), the boardroom (`boardroom.ts`), and HTTPS for VR headsets (`https.ts`, with `OPENWORLD_HTTPS=1`).
- `shared/types.ts`: the contract between them.

Building size comes from a score of commits, PRs, repo size, a live homepage and recency, ranked into landmark, tower, mid-rise and storefront tiers.

## What we're testing

Value hypothesis: developers who walk into a repo's building will understand recent changes faster by talking to the desk workers than by reading the PR list, and will come back to hire agents from inside the game.

Growth hypothesis: a screenshot or clip of *your own* code as a skyline gets shared, and people install it to see theirs.

Exploration hypothesis: being able to go *anywhere* (and fly there) brings people back more than a fixed city does. Measured as the share of Earth sessions that leave the home district (`explore.exploreShare` in `/api/stats`).

Local, cohort-ready events go to `~/.openworld/events.jsonl` (`session_start` with the city or real place, `explore_far`, `explore_teleport`, `building_entered`, `desk_talk`, `agent_started`, `agent_pr_opened`, `boardroom_convened`, `office_message_sent`, `office_dispatch`); `GET /api/stats` summarizes them per day and session. Automated test runs are tagged and left out.
