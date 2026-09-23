---
description: "Local interactive terminal provider: a real shell under the shared sandbox policy over the subprocess terminal primitive."
kind: "package-reference"
---

# @deepseek-ai/dsh-terminal-interactive-local

English | [中文](README.zh.md)

## Summary

`dsh-terminal-interactive-local` supplies the `shell` type to `ctx.interactiveTerminals`: it allocates one interactive shell process per terminal, in a requested working directory, under the owning Session's execution policy, and hands the caller raw byte transport, input, resize, and awaited teardown. It owns no identity, no retention, and no authorization — the [interactive terminal seam](../terminal-interactive/README.md) owns those — and it registers no tool and no prompt section.

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

Mount it beside the seam and the process substrate. It requires `ctx.interactiveTerminals`, `ctx.sandboxPolicy`, and `ctx.subprocess`.

```yaml
- name: '@deepseek-ai/dsh-terminal-interactive'
- name: '@deepseek-ai/dsh-terminal-interactive-local'
  config:
    providerType: shell
    shellDialect: bash
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerType` | `shell` | Registry type this provider registers under |
| `shellDialect` | `bash` | Interactive shell dialect; selects the argv defaults |
| `shellPath` | per dialect — `/bin/bash`, or the resolved pwsh | Interactive shell executable |
| `shellArgs` | bash `['-i']`, pwsh `['-NoLogo']` | Shell arguments |
| `disposeGraceMs` | `3000` | Grace before teardown escalates from TERM to KILL |

An unset or empty `shellPath`/`shellArgs` selects the dialect default; a non-empty explicit value always wins.

Unlike the model-facing PTY backend, the default arguments load the shell's own startup files: aliases, prompt, and completion are what a user's terminal is for.

### Execution policy

Allocation resolves `ctx.sandboxPolicy` for the owning Session — a live Session contributes its immutable `cwd` and its logged sandbox-mode fold — and confines the argv through `ctx.sandbox` unless the mode is `danger-full-access`. A restricted mode with no `ctx.sandbox` provider in the execution world, or a confinement that yields empty argv, fails the open before any process starts; a Session that is not live falls back to the deployment policy.

### Environment

The provider layers `TERM=xterm-256color`, `COLORTERM=truecolor`, `DSH_SHELL=1`, `DSH_SESSION_ID`, and `DSH_PTY_SESSION_ID` over the subprocess provider's scrubbed ambient environment. `TERM` describes the Client emulator, so a shell emits escapes the terminal can draw.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

This provider is a thin adapter. The subprocess seam's terminal primitive already owns the controlling terminal, ordered byte output, input, resize, and TERM-to-KILL quiescence for the whole process session, so this package maps those onto the interactive-terminal session contract and remembers the process outcome that `status()` reports.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `LocalInteractiveTerminalProvider`: policy resolution, sandbox confinement, spawn, plugin registration |
| [`src/config.ts`](src/config.ts) | `Config`, dialect resolution, and validation |
| [`src/session.ts`](src/session.ts) | `LocalInteractiveSession`: the session contract over one `SubprocessTerminalHandle` |
| — | No runtime invariant companion is published; the provider holds no registry and its only state is one process handle per session. |

### Close and failure

`close` terminates the captured process session once and coalesces concurrent calls onto that one operation; a provider cleanup failure is reported with the close reason and clears the coalesced promise so a retry is possible. The outcome promise maps to `exited` with the reported exit facts, and a provider or transport failure maps to `exited` with both facts unknown, because no exit was observed.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Interactive terminal seam](../terminal-interactive/README.md) — the registry this provider registers into.
- [subprocess seam](../../subprocess/subprocess/README.md) — the terminal-process primitive and its resize contract.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — where the execution mode and workspace root come from.
- [terminal-bash backend](../terminal-bash/README.md) — the model-facing PTY backend, which shares the substrate but adds readiness and scrollback.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, contributes no prompt section, and appends no session event.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Local processes only** — allocation always starts a process in this provider's execution world; a remote execution world needs its own provider.
- **Session policy is sampled at open** — the mode and workspace root are read once, when the terminal starts; a later mode change does not re-confine a running shell.
- **No startup readiness** — `open` resolves as soon as the process is allocated, so a consumer sees the shell's own prompt rather than a readiness signal, and a shell that fails to start reports the failure only through the stream ending.
- **Shell profiles are not sandboxed** — the default arguments load the user's startup files, which run with the confined argv but may themselves reach outside the workspace through the shell.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
