---
description: "Session-scoped interactive terminal seam for deployments composing, extending, or consuming the ctx.interactiveTerminals registry."
kind: "package-reference"
---

# @deepseek-ai/dsh-terminal-interactive

English | [中文](README.zh.md)

## Summary

`dsh-terminal-interactive` provides raw, bidirectional terminals to consumers that render them: the Session-scoped `ctx.interactiveTerminals` service mints opaque terminal ids, routes allocation through registered providers, retains output produced before a consumer attaches, and waits for quiescent cleanup. It defines no terminal mechanics itself — a provider such as the shipped `dsh-terminal-interactive-local` owns process allocation — and it registers no tool and no prompt section. Terminals are process-local: they do not survive a harness restart.

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

Mount `@deepseek-ai/dsh-terminal-interactive` together with one provider and one consumer. The service alone allocates nothing: without a registered provider every `open` fails, and without a consumer nothing reads the bytes.

```yaml
- name: '@deepseek-ai/dsh-terminal-interactive'
- name: '@deepseek-ai/dsh-terminal-interactive-local'
```

### When to choose it

Choose this seam for a consumer that draws the terminal itself — a terminal emulator that needs escape sequences, cursor movement, partial UTF-8 sequences, and window resize. Choose [`ctx.terminals`](../terminal/README.md) instead for a consumer that reads rendered text, sends line-oriented input, and waits for readiness: that service serves the model, is owned by an exact `Agent`, and returns sanitized text; this one serves a user interface and is owned by a `Session`.

### Terminal operations

| Operation | Returns | Purpose |
|---|---|---|
| `open(owner, { type, cwd, cols, rows })` | `InteractiveTerminalSnapshot` | Allocate one terminal and publish it under the owner |
| `list(owner)` | `InteractiveTerminalSnapshot[]` | The owner's live terminals in publication order |
| `write(owner, id, data)` | — | Deliver input bytes without newline conversion |
| `resize(owner, id, cols, rows)` | — | Change the window size and notify the foreground process group |
| `frames(owner, id, signal)` | `AsyncIterable<InteractiveTerminalFrame>` | The terminal's retained and live output, then its outcome |
| `close(owner, id, reason?)` | `boolean` | Close one terminal after awaited provider cleanup |
| `closeOwner(owner, reason?)` | — | Close every terminal one Session owns |
| `registerProvider(provider)` | disposer | Contribute one provider type |
| `listProviders()` | `string[]` | Registered provider types in registration order |

### Frames

A terminal's stream yields `output` frames carrying raw bytes, then exactly one terminal outcome: `exit` with the process status, or `failed` with the substrate's message. The stream completes after that outcome, so a consumer that reconnects later still learns how the process ended.

Output produced between `open` and the consumer's first pull is retained, which is what makes the identity-then-stream sequence safe: `open` returns an id, and the consumer opens the stream afterwards.

### Ownership and isolation

Every terminal is owned by the exact `Session` that opened it. An operation naming another Session's terminal fails with `FOREIGN_TERMINAL`, and one naming no live terminal fails with `NO_TERMINAL`. Terminal ids are opaque and minted by this service, never by a provider or a caller.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxBufferedBytes` | `1048576` (1 MiB) | Inclusive byte budget for one terminal's output retained ahead of its consumer; the producer waits once it is spent |

### Failures

Every failure is one `InteractiveTerminalError` carrying a stable code: `DUPLICATE_PROVIDER`, `FOREIGN_TERMINAL`, `NO_PROVIDER`, `NO_TERMINAL`, `OUTPUT_ACTIVE` (a second generation asked for a terminal's output), or `SERVICE_DISPOSING`. A provider that cannot allocate rejects the open before anything is published; a failed close leaves the terminal addressable and reports the failure rather than claiming success.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The service owns identity, publication, authorization, retention, and teardown order; providers own substrates. A provider hands over one live session and nothing else, so the same registry serves a local PTY, a remote sandbox, or any future substrate.

Retention is the reason this is a service and not a thin wrapper. A consumer cannot attach before it knows the terminal's id, and a shell writes its first prompt before that. The service therefore consumes the provider's output from publication onward into a bounded queue and hands frames to whichever consumer arrives.

Backpressure is one-way. Once retained bytes reach `maxBufferedBytes` the producer waits; a stalled consumer therefore cannot grow Host memory through this queue. A consumer is never blocked by the budget: it drains what is retained and then waits for the next frame or for closure.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `InteractiveTerminalService`: provider registry, open/list/write/resize/frames/close, owner cleanups, disposal |
| [`src/buffer.ts`](src/buffer.ts) | `FrameBuffer`: the bounded queue, its consumer slot, and its backpressure |
| [`src/types.ts`](src/types.ts) | Provider and session contracts, frames, snapshots, and the open request |
| — | No runtime invariant companion is published; the provider and terminal registries are private mutable state and the service exposes no unscoped snapshot. |

### Lifecycle

An open mints an id, calls the provider, and publishes a record only after the provider resolves. A cancelled or disposing open closes the session it just received, so no process outlives an unpublished terminal. Each published record starts one drain loop that ends with the terminal outcome and closes the queue. `close` awaits provider cleanup and the drain loop before removing the record; `closeOwner` and service disposal close every owned terminal and aggregate every failure.

### The single-consumer rule

One terminal's output belongs to exactly one generation. Two generations would split one byte stream between two emulators, each seeing a different, corrupt terminal, so a second `frames` call fails with `OUTPUT_ACTIVE`. The slot is released when the generation's signal aborts or its consumer stops iterating, which is what lets a reconnecting consumer take over.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [terminal/ package map](../README.md) — the terminal family and how its members compose.
- [`ctx.terminals`](../terminal/README.md) — the model-facing persistent PTY seam this one deliberately does not extend.
- [terminal-interactive-local provider](../terminal-interactive-local/README.md) — the shipped local PTY provider.
- [subprocess seam](../../subprocess/subprocess/README.md) — the terminal-process primitive the local provider builds on.
- [Capability seams](../../../docs/capability-seams.md) — the Service Definition / Provider / Consumer split this package follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, contributes no prompt section, and appends no session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No output replay** — the retained queue starts empty at publication; a consumer arriving after the budget was spent and drained sees only what follows. A terminal emulator that reconnects starts with a blank screen rather than the retained scrollback.
- **No scrollback read** — the service forwards bytes and retains none after a consumer consumes them, so there is no page-back operation and no total-line count.
- **Backpressure stops at this queue** — the producer stops pulling once the budget is spent, but the configured budget bounds only what this service retains; a provider's own substrate buffer is outside this contract.
- **Process-local terminals** — terminals live in this process and disappear with it; their ids are meaningless after a restart.
- **One consumer per terminal** — the design forbids fan-out; two viewers of one terminal need a consumer-side share, not a second generation here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
