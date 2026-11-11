# OpenWorld HQ

Your GitHub, as a living open world. Start anywhere on Earth, walk the real streets, or fly over the city: the whole planet streams in around you from OpenStreetMap, with real terrain, landmarks, traffic, weather and people. Every repository you own becomes a building. Walk in and the people at the desks explain your recent changes; hire an AI coding agent and watch it work at a desk in the Agent Lab, using **Claude, ChatGPT (Codex), Gemini, Grok, or almost any other model**.

You play a robot with a white shell head and a visor face, in a navy suit and rocket shoes.

Free and open source under the [MIT License](LICENSE). Everything runs on your own computer, with your own GitHub account and your own AI keys or logins.

- [Quick start](#quick-start)
- [Connect your AI](#connect-your-ai): Claude, ChatGPT, Gemini, Grok, local models, OpenRouter and more
- [Connect GitHub](#connect-github)
- [What's in the world](#whats-in-the-world)
- [Teammates](#teammates): see your team in the world, chat, and jump to each other
- [Controls](#controls)
- [VR on Quest](#vr-on-quest)
- [Configuration](#configuration) · [Troubleshooting](#troubleshooting) · [How it's built](#how-its-built) · [Credits](#credits)

## Quick start

You need **Node.js 22.9 or newer** and **git**. macOS, Linux and Windows (WSL) work; a computer with a decent GPU makes the city look its best.

```bash
git clone https://github.com/Shoberman2/openWorld.git
cd openWorld
npm install      # also downloads the two character rigs (see Credits)
npm run dev
```

Open **http://localhost:5317**. (The API runs on port 4317; `npm run dev` starts both with hot reload.)

Prefer one process? `npm start` builds the client once and serves everything on http://localhost:4317. Or `node bin/openworld.js`, which builds on first run and opens your browser.

The world works straight away with no accounts at all: until you connect GitHub, the city is filled with famous open-source projects (React, Linux, VS Code, Python, Kubernetes and about 30 more) as buildings you can walk into. Then:

1. **Connect GitHub** so your repos become buildings (below).
2. **Connect an AI** in **Settings → Agents & keys** so the people inside talk back and agents can take tasks.

## Connect your AI

Open **Settings** (the gear, or **K**) → **Agents & keys**. There are two kinds of AI in OpenWorld, and you can use different providers for each:

- **Conversations**: the receptionist, the people at the desks, each project's lead, HQ and the boardroom. Any chat model works.
- **Coding agents**: the agents you hire in the Agent Lab, who edit code in an isolated copy of your repo. These run through a coding CLI.

| You have | Conversations | Coding agents |
| --- | --- | --- |
| **Claude** (Pro/Max subscription) | Install Claude Code and run `claude` once to sign in | Claude Code, same login |
| **Claude** (API key) | Paste your Anthropic key (`sk-ant-…`) | Claude Code with the same key |
| **ChatGPT** (Plus/Pro/Team) | Install Codex, run `codex login` and choose **Sign in with ChatGPT**, then pick **ChatGPT login (Codex)** as the voice of the office | Codex, same login. No API key needed |
| **OpenAI** (API key) | Paste your OpenAI key (`sk-…`) | Codex with the same key |
| **Gemini** | Paste your Gemini key (`AIza…`) | Gemini CLI: run `gemini` once, or the same key |
| **Grok** (SuperGrok / X Premium+) | Install Grok Build, run `grok login`, then pick **Grok login** as the voice of the office | Grok Build, same login. No API key needed |
| **Grok** (xAI API key) | Paste your xAI key (`xai-…`) | Grok Build with the same key |
| **Any other model** | **Any other model** card: OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, or a custom URL | OpenCode, same model |
| **A model on your computer** | **Any other model** → Ollama or LM Studio. Free, private, no key | OpenCode, same model |

Install the coding CLIs you want (each is optional):

```bash
npm i -g @anthropic-ai/claude-code   # Claude Code
npm i -g @openai/codex               # Codex (ChatGPT / OpenAI)
npm i -g @google/gemini-cli          # Gemini CLI
curl -fsSL https://x.ai/cli/install.sh | bash   # Grok Build (xAI)
npm i -g opencode-ai                 # OpenCode (any model: uses Any other model or your keys)
```

Settings shows which ones it found, whether they're signed in, and lets you pick the default for new tasks. Every "give a task" box also lets you choose per task.

### Any other model (OpenAI-compatible)

In **Settings → Agents & keys → Any other model**, pick a service, paste a key if it needs one, press **Test connection** (it lists the models the server offers and sends a one-word test), then **Save and use**.

| Service | Server URL | Key |
| --- | --- | --- |
| OpenRouter (hundreds of models, including Claude, GPT and Gemini) | `https://openrouter.ai/api/v1` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Ollama (on this computer) | `http://localhost:11434/v1` | none. Install from ollama.com, then `ollama pull llama3.2` |
| LM Studio (on this computer) | `http://localhost:1234/v1` | none. Start the server in the Developer tab |
| Groq | `https://api.groq.com/openai/v1` | console.groq.com |
| Mistral | `https://api.mistral.ai/v1` | console.mistral.ai |
| DeepSeek | `https://api.deepseek.com/v1` | platform.deepseek.com |
| xAI (Grok) | `https://api.x.ai/v1` | console.x.ai |
| Together AI | `https://api.together.xyz/v1` | api.together.ai |
| Anything else that speaks the OpenAI chat API (llama.cpp server, vLLM, LiteLLM…) | its `/v1` URL | if it needs one |

Or set it in `.env`: `OPENWORLD_LLM_BASE_URL`, `OPENWORLD_LLM_API_KEY` and `OPENWORLD_LLM_MODEL` (see [.env.example](.env.example)).

With no AI connected, the world, your repos and the buildings all still work: the people inside read from a script, and the Agent Lab waits until you add an agent.

### Where your keys go

Keys you paste are saved only in `~/.openworld/config.json` (readable by your user only), sent only to the service they belong to, never returned to the browser (Settings shows the last 4 characters) and never logged. They can only be changed from the computer running OpenWorld, not from a headset on the network. Environment variables override saved keys. More in [SECURITY.md](SECURITY.md).

## Connect GitHub

Your repos become the buildings, and agents open pull requests through your account. Any one of:

- **GitHub CLI**: run `gh auth login` once. OpenWorld picks it up.
- **Token in `.env`**: `GITHUB_TOKEN=…`
- **Paste a token** in **Settings → Agents & keys → GitHub**.

Before you connect, and afterwards if you turn on **Settings → Agents & keys → Show famous open-source projects**, the city also holds well-known public projects. You can go in, ask reception about the project and talk to the people behind its recent pull requests. They are other people's work, so agents, pull requests, schedules and the boardroom stay off there, and your own repos always pick their buildings first. Their numbers and recent work come from GitHub's public API and are cached for days.

A classic token needs the **`repo`** scope (to see private repos and open pull requests). A fine-grained token needs **Contents** and **Pull requests** (read and write) and **Metadata** (read) on the repos you want. Agents never open a pull request unless you ask.

## What's in the world

**Anywhere on Earth.** Search any place on the title screen, or pick Times Square, Russian Hill, the Jordaan, Le Marais, Shibuya… and you start there. Nothing is pre-downloaded: the world streams around you as map tiles.

- **Map and terrain**: real building footprints and heights, roads, bridges, water, parks and land use from OpenMapTiles; real elevation from Mapterhorn / Copernicus; Sentinel-2 satellite imagery on the far horizon, so you can fly up and see the coast 20 km away.
- **Streets**: regional building styles (Manhattan brick, limestone and cast iron; Paris sandstone and zinc; Amsterdam gables; Tokyo tile and glass), shopfronts with awnings and canopies, street signs and traffic lights at named corners, subway entrances, newsstands, hydrants and bus shelters, lit windows at night.
- **Landmarks**: hand-built models for places people check first, such as Times Square's screens, the Fifth Avenue glass cube, the Plaza, Rockefeller Center, the Flatiron, Grand Central, the Washington Square Arch, the Arc de Triomphe, the Louvre Pyramid, Notre-Dame, the Colosseum, the Burj Khalifa and the Sydney Opera House.
- **Life**: people of every kind on the sidewalks, cars and taxis driving on the correct side of the road and stopping at the lights, cyclists, container ships at sea.
- **Go inside anything**: walk up to any building and press **E**. It gets an interior that fits its real footprint and what it is: an Apple-style store with long wooden tables, a coffee shop, fast food, a pharmacy, a grocery, a deli, a bank, a clothing store, a bookshop, a bar or restaurant, a hotel lobby, offices, apartments, a church, a mall or a warehouse. Lifts only where real buildings have them, with a roof terrace on offices and towers.
- **Weather and time**: live weather where you are (Open-Meteo): rain with wet, reflective streets, snow, fog, storms, auroras up north. **L** runs a time-lapse.
- **Getting around**: walk and run; hold **Space** in the air to light the rocket shoes, **Shift** for the afterburner, **C** to cut them. Vehicles on **1–8**: on foot, skateboard, bike, jeep, prop plane, kayak, motorboat and a space shuttle. **Q** opens a wingsuit in the air. **O** is autopilot to your waypoint (New York to London in about five minutes).
- **The map** (**M**): search the world, drop anywhere, set a waypoint, or zoom out to a live globe with real clouds and storms.
- **Photo mode** (**F**): free camera, depth of field, time of day; **Space** saves the picture to `~/.openworld/photos`.
- **Record a clip** (**R** in photo mode or at one of your buildings' doors, or **Record clip** on its phone page): a 10 second orbit or flyover of the building, wide or tall, with the repo's name and numbers on it, saved to `~/.openworld/clips`. **Replay history** shows the building going up commit by commit from the repo's real history. A building with open pull requests has a crane on its roof.
- **Light and reflections**: after rain the streets mirror the city (lit windows, headlights, the people walking by); glass towers reflect the buildings across the avenue, water reflects the shore, and polished lobby floors reflect the room. After dark every street lamp and headlight really lights the street, walls, cars and people around it. Clouds are a real layer you can fly up through, lit by the sun and thickening with the weather; on a day of broken cloud their shadows drift across the city and the sun's beams come down through the gaps. The camera's exposure adjusts as you walk from a shaded street into the sun.
- **Quality**: Settings → Display offers Auto, Ultra, High and Performance. Ultra renders at up to 4K internally with sharper shadows and a wider detailed city. To hold 60 fps the game first draws the scene with fewer pixels and rebuilds a full-resolution picture from the last several frames (temporal upscaling; `?taa=0` turns it off), and only then lowers the output resolution. Add `?q=low` to the URL on a slow GPU.

## Your projects

Every repository you own becomes a building where you start: big, active projects take the tallest towers with their logo on the crown, small experiments are storefronts. Building size comes from commits, PRs, repo size, a live homepage and recency.

Inside each building:

- **Reception**: a receptionist who knows the project (README, stats, recent work) and points you around.
- **Work floor**: one desk per past PR (or commit). The person at the desk is whoever made the change: you, a teammate, or an AI agent. Press **E** and they explain the change in their own words, with the real diff as context, then answer follow-up questions.
- **Agent Lab**: hire an agent. Type a task and a real coding agent starts working in an isolated git worktree of the repo. It takes a desk in a suit, its monitor shows live progress, and you can watch the diff grow, stop it, or open a pull request when it's done. While a task runs, busy agents get up, walk over to each other and talk through what they're doing.
- **Boardroom**: put a decision to the board (Chair, CTO, Head of Product, Design Lead, Growth). They debate, take positions and record a resolution with next steps.

### Straight to the boardroom

From inside any of your repos, `node /path/to/openWorld/bin/boardroom.mjs "Should we ship this week?"` starts the game if it isn't running and opens it at the head of that project's board table, with the question typed in. The link it opens works on its own too: `http://localhost:4317/?repo=my-api&room=boardroom&ask=…` (leave out `room` to land in the lobby). In Claude Code, save the same line as a `/boardroom` command.

### The phone

Press **P** (or click the PHONE tab) anywhere, inside or out. It stays open while you play; **Minimize** tucks it away. While the mouse is steering the camera, press **P** or hold **Option/Alt** to get your cursor onto the phone.

- **Home**: your briefing, a box to give any agent a task, and one-tap **Teleport to work** chips.
- **Projects**: every project, with a lead you can text about it.
- **Chat**: text HQ, the agent that runs all the others ("can someone add tests to my-api?"); HQ hires agents in the right buildings and texts you back when they finish. Mail for bigger asks and finished-agent reports, and your threads with each project lead.
- **Team**: your teammates, the team chat and the invite (see [Teammates](#teammates)).
- **Travel**: teleport to the front door of any of your buildings or home, or straight inside.

### Teleport

The **Teleport** button in the bottom-right corner (or **M**) opens the map with your buildings and home marked. Click one and you land inside it, from anywhere, including from inside another building.

## Teammates

People on the same team see each other in the world: every teammate is a robot in their own suit color, with a name tag that says what they're on. There is no OpenWorld server in the middle. One of you runs a small **team relay** that passes presence and chat, and everyone joins it with an invite.

**Start a team.** Either:

- **Host it from the game**: **Settings → Team → Host a team** (or the phone's **Team** app). The relay runs inside your OpenWorld on port 4319 for as long as it's open. Teammates must be able to reach your computer: the same Wi-Fi, [Tailscale](https://tailscale.com), or a forwarded port.
- **Run it on its own**: `npm run team-relay` on any machine that stays up (a small VPS, a box on your Tailscale network). It prints an invite. Good for a team that's spread out.

**Join.** Copy the invite (it looks like `ws://host:4319/#code`), send it to a teammate, and they paste it into **Settings → Team → Join a team**. The invite holds the relay's address and the team code. Anyone with it can join, so send it like a password. OpenWorld reconnects on its own after a restart or a dropped connection.

Once you're together:

- **In the world**: teammates walk, run, fly, drive and wave where they really are on Earth. Walk into the same project's building and you see each other inside. Wave with **G**.
- **Roster** (phone → **Team** → People): who is online, where ("Midtown, New York" or "In my-api · Work floor"), the branch and file they're on, their running agents, and when someone who left was last seen. **Teleport** jumps to them; **Waypoint** points the way.
- **Chat** (phone → **Team** → Chat): team messages with an unread badge, and a speech bubble over the speaker's robot.
- **Call everyone here**: drops a marker where you stand that the whole team sees for a minute and a half.
- **Map**: teammates are on the minimap and the map (**M**); click one to teleport to them.

**What teammates see about you**, each with its own switch in **Settings → Team**:

- **Where I am**: your robot, the name of the place, and teleport to you. Off: you're on the roster and in chat only.
- **What I'm working on**: the project whose building you're in, your running agents there (name, task, status), and, when this computer has a clone of that repo (it looks in `~/code`, `~/src`, `~/Projects`, your home folder and a few more, or the folders in `OPENWORLD_CODE_DIRS`), its current branch and the file you changed last.
- **Share details of private projects**: a private repo's name never leaves your computer. Teammates get a scrambled id that only matches if they have the same repo; everyone else sees "A private project". With this switch on, its branch, file and agent tasks are shared too. It is always off while **Hide private repos** is on.

The relay never sees your GitHub token, your AI keys, your code or your agents, and the browser never talks to it: your own OpenWorld holds the one connection. The relay speaks plain `ws://`, so across the open internet put it behind Tailscale or a TLS proxy (`wss://` invites work). Up to 16 people per team. In the four classic cities there are no real coordinates, so teammates there get the roster and chat, and meet inside project buildings. More in [SECURITY.md](SECURITY.md).

| Relay setting | What it does |
| --- | --- |
| `TEAM_RELAY_PORT` | Port for `npm run team-relay` (default 4319) |
| `TEAM_RELAY_HOST` | Interface to listen on (default: all) |
| `TEAM_RELAY_CODES` | Comma-separated team codes to let in (default: any code makes its own room) |
| `TEAM_RELAY_MAX` | People per team (default 16) |

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (steer while flying) |
| Shift | Run (afterburner while flying) |
| **Space** | Jump; hold in the air to light the rocket shoes |
| C | Cut the rocket shoes (dive) |
| 1–8 | On foot, skateboard, bike, jeep, prop plane, kayak, motorboat, space shuttle |
| Q | Wingsuit (in the air) |
| O | Autopilot to the waypoint (shuttle or plane) |
| **E** | Enter a building, talk to someone, use a kiosk |
| **P** | Phone (or free the cursor for it while looking around) |
| Option / Alt (hold) | Free the cursor while looking around |
| **M** | Map, and teleport to your buildings |
| Tab | City directory: waypoint or fast travel to any project |
| K | Settings (rebind any key there) |
| F | Photo mode |
| L | Time-lapse |
| T | Skip ahead 3 hours |
| G / X | Wave / sit down |
| Mouse | Click the game to look around, or drag |
| Wheel | Camera distance |
| Esc | Close a panel or release the mouse |

## VR on Quest

OpenWorld runs in a Meta Quest's browser (WebXR). WebXR needs a secure page, so the headset needs either an HTTPS address or a USB tunnel to `localhost`.

**Over Wi-Fi (HTTPS):**

1. On your computer: `npm run vr`. This serves the game on http://localhost:4317 and over HTTPS on port 4318, with a self-signed certificate made once in `~/.openworld/certs`. It prints a line like `On your Quest, open: https://192.168.1.20:4318/?key=…`.
2. Put the Quest on the same Wi-Fi and open that full address, including `?key=…`. The key keeps other people on the network out, since the server drives agents with your GitHub token. It's remembered after the first time.
3. The browser warns about the certificate the first time: **Advanced → Proceed**.
4. Pick a place, enter the world, then press **Enter VR**.

**Over USB instead:** with the Quest in developer mode and plugged in, run `adb reverse tcp:4317 tcp:4317` and open http://localhost:4317 on the Quest. `npm start` is enough.

| Controller | Action |
| --- | --- |
| Left stick | Walk; steer vehicles |
| Left stick click / grip / trigger | Run |
| Right stick left/right | Turn (snap or smooth) |
| Right stick down | Dive (in the air) |
| Right stick click | First person or behind the robot |
| A | Jump; hold in the air for rocket shoes |
| B, or right trigger | Use / enter / talk; B closes a panel |
| X | Wrist phone |
| Y | Next vehicle |

The wrist phone on your left hand has every thread, with canned replies, the agent roster with Stop buttons, vehicles and VR settings. To stay smooth, VR streams a smaller area and skips some effects. `?vr=0` in the URL turns VR off.

## Configuration

Everything is optional. Copy [.env.example](.env.example) to `.env`; the `npm` scripts load it automatically.

| Variable | What it does |
| --- | --- |
| `GITHUB_TOKEN` | GitHub access (or use `gh auth login`) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` / `CODEX_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `XAI_API_KEY` | AI keys (or paste them in Settings) |
| `OPENWORLD_LLM_BASE_URL`, `OPENWORLD_LLM_API_KEY`, `OPENWORLD_LLM_MODEL` | Any OpenAI-compatible server for conversations |
| `OPENWORLD_MODEL` | Force the chat model by name |
| `PORT` / `HTTPS_PORT` | Server ports (default 4317 / 4318) |
| `OPENWORLD_HTTPS=1` | Also serve over HTTPS on the LAN (VR) |
| `OPENWORLD_HOME` | Where OpenWorld keeps its data (default `~/.openworld`) |
| `OPENWORLD_TILE_CACHE_MB` | Map tile cache size (default 3000) |
| `OPENWORLD_CODE_DIRS` | Folders to look in for local clones of your repos (separated like `PATH`), for the branch and file teammates see |
| `OPENWORLD_PUBLIC_ONLY=1` | Leave private repos out of the world (also in Settings → Agents & keys → Hide private repos), for streaming and recording |
| `OPENWORLD_FAKE_AGENTS=1`, `OPENWORLD_DRY_PR=1`, `OPENWORLD_DRY_GITHUB=1` | Testing: scripted agents, no real PRs, no GitHub writes |

OpenWorld keeps its state in `~/.openworld/`: settings and keys, the map tile cache, agent worktrees, boardroom minutes, photos and a local event log. Delete the folder to start over. Nothing is sent anywhere except the map, terrain and weather requests, GitHub, and the AI services you connect. If you join a team, what you chose to share and your chat also go to that team's relay.

## Troubleshooting

- **"Nothing is answering at http://localhost:11434"**: start Ollama (`ollama serve`) and pull a model (`ollama pull llama3.2`). For LM Studio, start its server in the Developer tab.
- **"The server rejected that key"**: copy the key again; make sure it belongs to the service you picked.
- **A coding agent shows "Not installed" or "Update needed"**: run the install command Settings shows, then reopen Settings.
- **No buildings for my repos**: connect GitHub (see above), then reload.
- **The city is slow**: choose **High** or **Performance** in Settings → Display, or add `?q=low` to the URL.
- **Port already in use**: something else is on 4317 or 5317. Stop it, or set `PORT`.
- **Can't click the phone**: while the mouse steers the camera, press **P** or hold **Option/Alt** first.

## How it's built

- `client/`: Three.js + Vite + TypeScript.
  - `src/earth/`: the streaming world. `frame.ts` (local meters ↔ lat/lon ↔ tiles), `worker.ts` + `build/` (vector tiles and terrain to meshes off the main thread), `chunks.ts` (what to load at which detail), `far.ts` (satellite horizon), `traffic.ts` + `crowd.ts` (cars and people), `landmarks/` (hand-built landmarks, signs, Times Square), `sites.ts` (project HQs), `style.ts` (materials).
  - `src/robot.ts` (the player), `player.ts` (movement, rocket shoes, collisions), `characters.ts` (people indoors and agents), `engine.ts` + `sky.ts` (rendering, quality tiers, sky and light).
  - `src/atmosphere.ts` + `src/post/`: the post chain. The scene is drawn once into a multisampled HDR target; `reflect.ts` (screen-space reflections, driven by a mask materials write into the alpha channel), `lights.ts` (hundreds of lamps and headlights as one deferred pass), `clouds.ts` (ray-marched volumetric clouds), `exposure.ts` (eye adaptation), `bloom.ts` and `final.ts` (tone mapping and grade) add the rest. Low quality and VR skip it and use simpler stand-ins.
  - `src/interior.ts` (project HQs) and `src/rooms/` (interiors for any building, `stores.ts` for shops).
  - `src/ui/`: HUD, minimap and world map, the phone, settings, panels. `src/xr/`: VR.
- `server/`: Express + WebSocket. Map tiles proxied and cached (`tiles.ts`), place search (`geo.ts`), GitHub (`github.ts`), conversations through your chosen provider (`llm.ts`), agent runs in git worktrees (`agents.ts`, one adapter per coding CLI in `providers/`, plus `providers/compat.ts` for OpenAI-compatible servers), HQ (`office.ts`), the boardroom (`boardroom.ts`), HTTPS for headsets (`https.ts`).
- `server/team/` and `client/src/team/`: teammates. `relay.ts` is the relay (also `npm run team-relay`), `protocol.ts` the few messages it passes and the cleaners both ends run, `index.ts` this player's connection to it and the `/api/team` routes; on the client, `avatars.ts` draws teammates, `phoneApp.ts` and `settingsTab.ts` are the UI.
- `shared/types.ts`: the contract between them.

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md). Product experiments and local analytics are described in [docs/experiments.md](docs/experiments.md).

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © OpenMapTiles (served by OpenFreeMap); terrain © Mapterhorn, Copernicus; imagery Sentinel-2 cloudless 2016 by EOX (CC BY 4.0); weather from Open-Meteo (CC BY 4.0); place search by Nominatim. Built with three.js, Vite, Express and ws; every npm dependency is MIT, ISC or BSD-3-Clause.

The two character rigs (`Xbot.glb`, `Soldier.glb`) come from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) and were made with Adobe Mixamo. Mixamo allows them in games but not redistribution of the raw files, so they aren't in this repository: `npm install` downloads them (`npm run models` to retry), and the game loads them from the same place if they're missing. The water normal map (`client/public/textures/waternormals.jpg`) is from the three.js examples (MIT).

OpenWorld's own code and assets are released under the [MIT License](LICENSE). Map data, terrain, imagery and the character rigs above keep their own terms (see [NOTICE](NOTICE)).
