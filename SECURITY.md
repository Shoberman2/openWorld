# Security

OpenWorld runs on your own computer and drives coding agents with your GitHub token and your AI keys, so we take reports seriously.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's **Report a vulnerability** button (Security tab → Advisories) on this repository, with steps to reproduce and the version or commit. We aim to answer within a week.

## How OpenWorld handles your secrets

- Keys and tokens you paste are stored only in `~/.openworld/config.json`, created with mode `0600`.
- They're sent only to the service they belong to (GitHub, Anthropic, OpenAI, Google, or the OpenAI-compatible server you chose), or passed to that vendor's own CLI as an environment variable.
- They're never returned to the browser: Settings shows only the last 4 characters. They're never written to logs.
- Keys can only be added or changed from the computer running OpenWorld (loopback requests), not from a headset or another device on the network.
- The HTTPS mode for VR (`OPENWORLD_HTTPS=1`) requires a one-time access key in the URL so other people on your network can't drive your agents.
- Coding agents work in separate git worktrees under `~/.openworld/`, never in your own checkout, and only open pull requests when you ask.

## Teammates and the team relay

Joining a team is the one feature that sends anything about you to other people, so here is exactly what it does.

- **No hosted service.** A team is a room on a small relay that one of you runs: inside OpenWorld ("Host a team on this computer", its own port, default 4319) or standalone (`npm run team-relay`). The main OpenWorld server stays reachable from your own machine only; hosting a team does not open it.
- **The relay passes presence and chat, nothing else.** It has no access to GitHub tokens, AI keys, agents, code or files, and no code path that could ask for them. It accepts six kinds of message (hello, pose, info, chat, wave, marker), clips every field, and drops everything else. It keeps nothing on disk and holds rooms by a hash of the team code.
- **The team code is the key.** It is 144 random bits inside the invite (`ws://host:4319/#code`). Without it a connection is closed. Anyone who has it can join the team and see what its members share, so treat an invite like a password; to cut someone off, leave and start a new team. An embedded relay only accepts its own team's code; a standalone one can be limited with `TEAM_RELAY_CODES`.
- **Limits.** 4 KB per message, 16 people per team, rate limits per connection on every message kind, a cap on connections per address, a few seconds to present the code, and sockets that go quiet are dropped. Browsers are turned away (any request with an `Origin` header), so a web page can't use a relay.
- **Your browser never connects to the relay.** Your own OpenWorld server holds one outbound WebSocket and bridges it to the page. Team settings (host, join, leave, name, sharing switches) can only be changed from the computer running OpenWorld, like keys, and the invite is only ever returned to that computer.
- **Everything from the relay is untrusted.** Your server cleans every incoming message again (types, ranges, lengths, control and text-direction characters), and the page escapes all teammate text before showing it and checks every number before using it.
- **What is shared, and the switches** (Settings → Team):
  - *Where I am* (on by default): position as latitude, longitude, altitude and heading, how the robot is moving, the name of the place, and whether you're inside a building. Off: none of that is sent.
  - *What I'm working on* (on by default): the project whose building you're in, your running agents there (name, task, status), and, if a local clone is found, its branch and most recently changed file (read with `git`, never file contents).
  - *Share details of private projects* (on by default, forced off while Hide private repos is on): a private repo is only ever sent as `sha256(team code + full name)`, cut to 128 bits. Teammates who have the same repo match it; everyone else sees "A private project". Off: the hash and an agent count only. On: branch, file and agent tasks too. Someone on your team who can guess a private repo's exact name can confirm the guess against the hash.
- **Chat** goes to whoever is online; the relay doesn't store it. Each player's last 200 messages are kept in `~/.openworld/team.json` on their own computer.
- **Transport.** The relay speaks plain `ws://`: fine on a LAN or over Tailscale (which encrypts), not across the open internet. There, put it behind a TLS proxy and use a `wss://` invite.
- **Who you're trusting.** Whoever runs the relay can read what passes through it (your shared presence and the chat) and sees the team's IP addresses. Teammates see what your switches allow. Display names are whatever each person types; the relay does not verify identity.

## Scope

In scope: the server in `server/`, the client in `client/`, and how they handle tokens, keys, agent runs and file paths. Out of scope: vulnerabilities in the third-party CLIs (Claude Code, Codex, Gemini CLI) or in model providers; report those to their makers.
