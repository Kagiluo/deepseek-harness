---
description: "Interactive terminal Remote for the web GUI: open, drive, resize, and follow a real shell in a Session's workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-terminal-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-terminal-controller` is the browser's path to a real shell in a Session's workspace. It exposes the `terminals` Remote namespace over `ctx.interactiveTerminals`: open a terminal, write input, resize the window, close it, list a Session's terminals, and follow one terminal's output as a Remote stream. It owns no terminal mechanics and no identity — the seam allocates, authorizes, and cleans up — and it registers no tool and no prompt section.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it on the Host beside the interactive terminal seam and one provider:

```yaml
- name: '@deepseek-ai/dsh-terminal-interactive'
- name: '@deepseek-ai/dsh-terminal-interactive-local'
- name: '@deepseek-ai/dsh-api-terminal-controller'
  config:
    type: shell
```

A Client calls the generated namespace as `remote.terminals.<method>`.

### Methods

| Method | Returns | Purpose |
|---|---|---|
| `open({ sessionId, cols, rows })` | `TerminalSnapshot` | Allocate a terminal in that Session's workspace |
| `list({ sessionId })` | `TerminalSnapshot[]` | The Session's live terminals in publication order |
| `write({ sessionId, terminalId, data })` | — | Deliver input bytes without newline conversion |
| `resize({ sessionId, terminalId, cols, rows })` | — | Change the window size |
| `close({ sessionId, terminalId })` | `TerminalCloseResult` | Close one terminal after awaited cleanup |
| `output({ sessionId, terminalId })` | stream of `TerminalFrame` | Retained and live output, then the terminal outcome |

### Frames and encoding

`output` is a stream Remote. It yields `output` frames whose `data` is the terminal's raw bytes base64-encoded, then exactly one terminal outcome: `exit` with the process status, or `failed` with the substrate's message. Base64 is what a JSON carrier can carry while preserving every escape sequence and partial UTF-8 sequence the shell wrote — the Client decodes to bytes and hands them to its emulator unchanged.

A generation holds the terminal's single consumer slot for its lifetime; a second `output` generation on the same terminal fails with the seam's `OUTPUT_ACTIVE`, and the slot is released when the connection or the caller's signal ends.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `type` | `shell` | Provider type every terminal opens under |

### Failures

The seam's failures cross the wire unchanged: `NO_PROVIDER`, `NO_TERMINAL`, `FOREIGN_TERMINAL`, `OUTPUT_ACTIVE`, `SERVICE_DISPOSING`, and `DUPLICATE_PROVIDER`, all carried by the seam's error type. A Session identity the caller does not own is not a separate failure — the seam fences on the exact owner.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

This package is a translation layer with no state. The Session identity a Client sends becomes the seam's owner key; the Provider type is the row's configuration; raw bytes become base64 on the way out. Authorization, retention, backpressure, and cleanup stay in `ctx.interactiveTerminals` so that the browser and any future consumer share one contract rather than each re-deriving one.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `TerminalController`: the `terminals` namespace, its six methods, and the base64 encoding |
| [`src/types.ts`](src/types.ts) | Wire request and result values, published as `./types` |
| — | No runtime invariant companion is published; the controller holds no state and its every answer is derived from the seam at call time. |

Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

### Namespace and Cordis key

The wire namespace is `terminals`, but the Cordis service key is `terminalController`. They differ deliberately: `ctx.terminals` is already the model-facing persistent PTY seam, and one Context key cannot carry two incompatible declarations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Interactive terminal seam](../../terminal/terminal-interactive/README.md) — the registry, its frames, and its ownership rules.
- [Local provider](../../terminal/terminal-interactive-local/README.md) — the shipped `shell` provider.
- [Remote assembly](../remotes/README.md) — how a Client package reaches the `terminals` namespace.
- [workspace-files](../workspace-files/README.md) — the sibling Remote whose Session-scoped read surface this one follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, contributes no prompt section, and appends no session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No session-end cleanup trigger** — the controller closes a terminal when a Client asks or when its stream generation ends; a terminal whose Client simply disappears while the Session stays open is closed by the next explicit request, not by an observed Session event.
- **No requested working directory** — `open` takes the Session's workspace from the execution policy; a Client cannot yet start a shell somewhere else.
- **No scrollback endpoint** — `output` carries bytes forward only, so a reconnecting Client starts from a blank emulator rather than redrawing retained history.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
