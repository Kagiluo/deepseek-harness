---
description: "Interactive terminal tab in the right Sidebar: an xterm.js emulator over the Session-scoped terminals Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-terminal

English | [中文](README.zh.md)

## Summary

Open a real interactive shell in the right Sidebar and drive it from the browser. The tab kind is `terminal`, a page type: it claims no file or resource address, the guide page offers it, and every terminal opened from that entry is its own tab — two terminals of one workspace are two shells, not two views of one thing. One xterm.js emulator draws one Host process, whose working directory is the Session's workspace root and whose confinement comes from the Session's sandbox policy.

## Table of Contents

- [What it registers](#what-it-registers)
- [The emulator and the process](#the-emulator-and-the-process)
- [Reading and writing](#reading-and-writing)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with id `@deepseek-ai/dsh-client-ui-terminal` (this implementation's identity in the tab system, and the key its body registers under), kind `terminal`, band `builtin`, and no `patterns`. A type without patterns is opened by kind, so `ctx.sidebarRight.openTab('terminal')` and the guide capsule reach it; it never claims an address another type would also match. The guide contributes one entry at order 20, after the file tree's order 10, so the column's default page stays the workspace tree.
- **The body** — the keyed `sidebar.right.pane.tab` seat under the type's id, with copy namespace `terminal`. There is no `sidebar.right.pane.tab.title` registration: the type's own `title` thunk is what the chip captures when a tab opens, and a terminal's title never changes.
- **The dictionaries** — `ctx.locale.register('terminal', { zh, en })`.

The browser half injects `slots`, `locale`, `sidebarRightTabs`, `remote`, and `remote.terminals`; the node half is an inert Loader seat.

<a id="the-emulator-and-the-process"></a>
## The emulator and the process

The body owns exactly one emulator and one Host terminal, and its effect is keyed by the tab record's `signal` — not by the tab value, which changes identity whenever the layout does (a focus change, an expand). The process therefore outlives every layout change that keeps the tab open:

- **Mount** allocates through the injected face with the emulator's current grid (80x24 in a fresh xterm.js), then follows the returned terminal's frames. A refused allocation renders as a status line and leaves nothing to close.
- **Hide without close** keeps both the emulator and the process: the tab stays mounted while its pane is inactive, so switching tabs never restarts a shell.
- **Unmount** closes the Host terminal, aborts the stream, disconnects the resize observer, releases the emulator's input listener, and disposes the emulator. Closing a tab therefore ends its process.

Window size follows the host box, not the other way round. A `ResizeObserver` runs `FitAddon.fit()` and sends the resulting `cols`/`rows` to the Host, which is what delivers the platform's resize notification to the shell's foreground process group. A collapsed or not-yet-laid-out host box measures nothing, so a hidden panel never asks the addon for a zero-sized grid.

<a id="reading-and-writing"></a>
## Reading and writing

The Host is the only writer to the screen. Keystrokes go out as input and are never echoed locally, so the reader sees what the shell actually sent rather than a second, divergent rendering; a write that the Host refuses surfaces as the stream ending, not as a rejected promise the component would have to await. Output frames carry base64-encoded bytes because a JSON carrier has no byte string, and the body decodes them back to bytes for the emulator so escape sequences, cursor movement, and partial UTF-8 sequences survive unchanged.

An ended or failed terminal renders one line under the emulator naming the exit code, the signal, or the substrate message; a stream cancelled by its own tab record says nothing, because that cancellation is the effect's own teardown rather than a failure.

The face taken from the Remote addresses every call at the Session the factory was built for, so one registration serves every terminal tab in every Session.

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, contributes no prompt section, and appends no session event.

#### KV Cache effect

None; nothing the user types into or reads from this terminal enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **No terminal state survives a reload.** Each tab is one process-local Host terminal; reloading the page or reopening the tab opens a new shell and a blank screen. There is no reattach, no scrollback replay, and no restart control on an exited terminal.
- **Default emulator theme.** The emulator is constructed without a theme object, so it uses xterm.js's own palette and does not follow the application's `--dsw-*` tokens. Wiring the theme is deferred rather than rejected.
- **One terminal per tab, no sharing.** Two viewers of one terminal would split one byte stream between two emulators, so this tab type offers no fan-out, mirror, or split view.
- **Confinement is the Session's policy.** The Host provider confines the process through the Session's sandbox policy and runs unconfined in a `danger-full-access` Session; this package neither widens nor narrows that.
- **No clipboard integration of its own.** Selection, copy, and paste are the browser's and xterm.js's defaults; the package adds no copy button and no paste interception.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The body holds only per-occurrence emulator state and the registrations are owned by the plugin fiber, so there is no independent runtime source to compare against; registration disposal and tab lifetimes are covered by behavior tests.
