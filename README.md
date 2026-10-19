# OpenWorld HQ

Your GitHub, as a living open-world city. Pick New York, San Francisco, Miami or Boston. Every repository you own becomes a building: big, active projects are skyscrapers with their logo on the crown, and small experiments are storefronts. Walk the streets past taxis, buses, pedestrians and airliners overhead, then press **E** at a door to go inside.

Inside each building:

- **Reception**: a receptionist who knows the project (README, stats, recent work) and points you around.
- **Work floor**: one desk per past PR (or commit, for repos without PRs). The person at the desk is whoever made the change: you, a teammate, or an AI agent like Claude. Press **E** and they explain the change in their own words, with the real diff as context, then answer follow-up questions.
- **Agent Lab**: hire an agent. Type a task and a real Claude Code agent starts working in an isolated git worktree of the repo. It takes a desk, its monitor shows live progress, and you can watch the diff grow, stop it, or open a pull request when it's done.
- **Boardroom**: put a decision to the board (Chair, CTO, Head of Product, Design Lead, Growth). They debate in turns, take positions for or against, and the Chair records a resolution with next steps. Past decisions stay on the wall.

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
| WASD / arrows | Move |
| Shift | Run |
| Mouse (click to capture) | Look |
| Wheel | Camera distance |
| **E** | Enter a building, talk to someone, use a kiosk |
| Tab | City directory: waypoint or fast travel to any project |
| M | Big map |
| T | Skip ahead 3 hours (day/night cycle) |
| Esc | Close a panel or release the mouse |

## How it's built

- `client/`: Three.js + Vite + TypeScript. Procedural cities (`client/src/city/`) with a shader that draws windows per floor and lights offices at night, instanced traffic with signals (`traffic.ts`), skinned pedestrians (`pedestrians.ts`), aircraft and helicopters (`aircraft.ts`), interiors (`interior.ts`) and UI panels (`ui/`).
- `server/`: Express + WebSocket. GitHub GraphQL/REST (`github.ts`), the `claude` CLI for conversations (`llm.ts`), agent runs in git worktrees streamed over the socket (`agents.ts`), and the boardroom (`boardroom.ts`).
- `shared/types.ts`: the contract between them.

Building size comes from a score of commits, PRs, repo size, a live homepage and recency, ranked into landmark, tower, mid-rise and storefront tiers.

## What we're testing

Value hypothesis: developers who walk into a repo's building will understand recent changes faster by talking to the desk workers than by reading the PR list, and will come back to hire agents from inside the game.

Growth hypothesis: a screenshot or clip of *your own* code as a skyline gets shared, and people install it to see theirs.

Local, cohort-ready events go to `~/.openworld/events.jsonl` (`session_start`, `building_entered`, `desk_talk`, `agent_started`, `agent_pr_opened`, `boardroom_convened`); `GET /api/stats` summarizes them per day and session.
