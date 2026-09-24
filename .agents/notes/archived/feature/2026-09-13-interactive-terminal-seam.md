# Agent Note: Browser-driven interactive terminals as a Session-owned seam

Status: implemented
Archived: 2026-09-24

English | [中文](2026-09-13-interactive-terminal-seam.zh.md)

## Problem

The Web client had no terminal. A user who wanted a shell had to ask the model to run commands and read the rendered result, which is the wrong tool for exploration: the model does not know what the user will type next, and rendered output loses the escape sequences, cursor movement, and partial UTF-8 sequences a terminal emulator needs.

The existing terminal capability, `ctx.terminals`, cannot serve a browser. It is owned by an exact `Agent` (a UI has none), returns sanitized rendered text through a bounded scrollback page, accepts one exclusive line-oriented send at a time, performs readiness detection the user does not want between their keystrokes, and has no window-resize operation at all. Widening it to also carry raw bytes for a Session-owned consumer would give one Context key two incompatible declarations and one service two incompatible ownership rules.

## Decision

Interactive terminals are a second capability seam with all three roles and a browser consumer, in four packages:

- `@deepseek-ai/dsh-terminal-interactive` — the Service Definition. `InteractiveTerminalService` at `ctx.interactiveTerminals` mints opaque terminal ids, routes allocation through registered providers, retains output produced before a consumer attaches in a bounded queue, and waits for quiescent cleanup. The owner is an exact `Session`; ids are branded.
- `@deepseek-ai/dsh-terminal-interactive-local` — the shipped Provider, type `shell`. It allocates one interactive shell per terminal through the subprocess terminal primitive, in the owning Session's policy-resolved workspace root, confined by `ctx.sandbox` unless the Session's mode is `danger-full-access`.
- `@deepseek-ai/dsh-api-terminal-controller` — the Consumer and Typert Remote. It carries the seam to the browser as the `terminals` wire namespace, base64-encoding raw bytes for a JSON carrier. The Cordis key is `terminalController`, because `ctx.terminals` already names the model-facing service.
- `@deepseek-ai/dsh-client-ui-terminal` — the browser consumer: a right-Sidebar tab type of kind `terminal` whose body is one xterm.js emulator over one Host terminal.

Four properties of the seam follow from the consumer being an emulator rather than a model:

**Raw bytes, not text.** A frame carries `Uint8Array` in process and base64 on the wire. Anything that renders or sanitizes output would have to be undone by the emulator on the other side.

**Session ownership.** Every operation is fenced on the exact owning `Session`, and `closeOwner` releases a Session's terminals. What a terminal outlives is a Session ending, not an Agent ending.

**One consumer per terminal.** Two generations over one byte stream would each draw a different, corrupt terminal, so the second `frames` call fails with `OUTPUT_ACTIVE`. The slot is released when the generation's signal aborts, which is what lets a reconnecting consumer take over.

**Retention with one-way backpressure.** `open` returns an identity and the consumer opens the stream afterwards, so output produced in between must be held. Retained bytes are bounded by `maxBufferedBytes`; once the budget is spent, the producer waits and the consumer is never blocked.

The subprocess seam gained one operation for this: `SubprocessTerminalHandle.resize(cols, rows)`, which changes the terminal's window size and delivers the platform's resize notification to the foreground process group. Both providers implement it — the local PTY handle on node-pty, the E2B handle on `sandbox.pty.resize`. Without it the emulator's fit could not reach the shell.

## Alternatives considered

**Extending `ctx.terminals`.** Rejected above: it would have put Agent-owned, line-oriented, text-returning semantics and Session-owned, byte-oriented, resize-aware semantics behind one Context key, and every consumer would have had to disambiguate which half it was using.

**A standalone Electron or `node-pty` sidecar application.** The product is the Web and Desktop client; a second application would duplicate session selection, workspace policy, and the sandbox provider, and would not be reachable from the tabs a user already has.

**Rendering the terminal on the Host and streaming text or a screen image.** Both destroy what an emulator consumes, and a screen image would move far more data than the escape sequences it replaces.

**Keeping the emulator's scrollback on the Host to support reattach.** The retained queue is deliberate and bounded; a reattach buffer would be a second, unbounded copy of every terminal's output owned by the Host process, which is not worth it for a tab that is closed when the user closes it.

**A single package holding the definition, the provider, and the Remote.** The roles evolve independently: another deployment wants a different substrate (the E2B family already has one for subprocess terminals), and the web bundle wants the provider row to be replaceable without touching the wire contract.

## Consequences

Interactive terminals are process-local and do not survive a harness restart, matching `ctx.terminals`. Nothing about them is model-visible: no event is appended, no tool is registered, and the bytes a user types never enter a model request — which is why the four packages are audited as having no Model Experience.

The shipped local provider loads the user's shell startup files (`bash -i`, `pwsh -NoLogo`) rather than the model-facing backend's non-interactive argument set, because aliases, prompt, and completion are the point of a user's terminal. Those startup files run under the confined argv but may themselves reach outside the workspace through the shell, which is a limitation the package README states.

The Desktop and Web profiles mount all four rows through `packages/bundle/web-app/cordis.patch.yml`, so a deployment that cannot host a PTY removes the provider row and the seam fails every `open` with `NO_PROVIDER` rather than failing at load.

The browser reaches a namespace only through the client assembly: `packages/api/remotes/src/client/index.ts` mounts each selected `/remote` contribution, so the host rows alone are not enough. A namespace missing from that list leaves its consumer pending on `remote.terminals`, and the client's boot check reports the unactivated entry instead of rendering the shell.

## Testing

`dsh-terminal-interactive` covers `FrameBuffer` directly (retention, the single consumer slot, backpressure, final frames) and the service through a real cordis Context with stub providers (publication order, foreign-owner fencing, duplicate providers, close coalescing, owner cleanup, disposal failures, the `OUTPUT_ACTIVE` rule). `dsh-terminal-interactive-local` covers dialect resolution, argv confinement per sandbox mode, the environment layer, and the session's outcome and close mapping. `dsh-api-terminal-controller` covers the base64 encoding and the argument each method forwards. `dsh-client-ui-terminal` drives the body over a stand-in emulator: allocation at the emulator grid, Host bytes on the screen, keystrokes back as input, fit-driven resize, each failure notice, and teardown that closes the process.

## Related

- [Persistent PTY Agent Note](2026-07-16-persistent-pty-sessions.md) — the model-facing seam this one deliberately does not extend.
- [Terminal subsystem reference](../../../../docs/subsystems/terminal.md) — both seams' vocabulary and the generated service surfaces.
- [Capability seams](../../../../docs/capability-seams.md) — the Service Definition / Provider / Consumer split these four packages follow.
- [dsh-terminal-interactive README](../../../../packages/terminal/terminal-interactive/README.md) — the seam's config, operations, and limitations.
