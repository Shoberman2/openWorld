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

## Scope

In scope: the server in `server/`, the client in `client/`, and how they handle tokens, keys, agent runs and file paths. Out of scope: vulnerabilities in the third-party CLIs (Claude Code, Codex, Gemini CLI) or in model providers; report those to their makers.
