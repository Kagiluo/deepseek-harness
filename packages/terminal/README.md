---
description: "Package map for the terminal capability family: the owner-scoped ctx.terminals service with its shell backend and six model-facing tools, and the Session-scoped interactive terminals a browser drives."
kind: "package-group"
---

# terminal/ — terminal capability family

English | [中文](README.zh.md)

## Summary

The `terminal/` family runs shells for two audiences. Agents keep interactive shell and REPL sessions alive across tool calls — including the working directory, environment, and child processes — through `ctx.terminals`, the sandboxed `terminal-bash/` backend, and six model-facing tools. A person drives a real shell in the Web GUI through `ctx.interactiveTerminals`, the local `terminal-interactive-local/` provider, and the `terminals` Remote carrying it to the browser. Choose this family when a task needs interactive input or state a one-shot bash command cannot retain. Sessions stay local to one harness process and do not survive a restart.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The family is two session services — one for an agent, one for a browser — with one shell backend and one set of model-facing tools. Each child README owns the full contract; the subsystem reference owns the shared vocabulary and the generated service surface.

| Package | Role | ctx key |
|---|---|---|
| [`terminal/`](terminal/README.md) | Session service: owner-scoped sessions with opaque ids, exact-owner fencing, and awaited cleanup | `ctx.terminals` |
| [`terminal-bash/`](terminal-bash/README.md) | Shell backend: interactive bash or pwsh under the shared sandbox policy, with readiness detection and bounded output | registers a backend on `ctx.terminals` |
| [`terminal-interactive/`](terminal-interactive/README.md) | Interactive terminal service: Session-scoped raw terminals with retained output, a single consumer per stream, and awaited cleanup | `ctx.interactiveTerminals` |
| [`terminal-interactive-local/`](terminal-interactive-local/README.md) | Local provider: one interactive shell per terminal under the owning Session's sandbox policy | registers a provider on `ctx.interactiveTerminals` |
| [`tool-terminal/`](tool-terminal/README.md) | Six model-facing tools with owner isolation and optional background sends | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared types and the service surface, then the Agent Note for the design rationale and deferred boundaries.

- [Terminal subsystem reference](../../docs/subsystems/terminal.md) — ids, backend and session contracts, send readiness, bounded reads, the interactive seam, and the generated service APIs.
- [Persistent PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md) — the design decision, alternatives, and deferred work.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
