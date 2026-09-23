---
description: "The Web GUI's Scheduled tasks settings page: author the daily tasks that start a session in a workspace at a set time; for users and maintainers of unattended agent runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-scheduler

English | [中文](README.zh.md)

## Summary

Use this page to schedule agent work from the browser: add a task, choose the workspace it runs in, set the time and days, write the prompt, and pick the permission and agent presets. Every task starts its own session when its time arrives, so you read the transcript afterwards like any other session. Editing is a local draft — the whole list is submitted as one save, and a half-typed task is never stored. The page refuses to save a task the host would reject, and it offers only the permission presets this deployment can run with nobody watching.

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

Mount the plugin alongside the settings shell and the host `@deepseek-ai/dsh-scheduler` package; a **Scheduled tasks** page then appears in Settings, ordered after Agent presets. The shipped Web bundle mounts both. Adding a task and pressing Save writes the list to the `scheduler` namespace, and the host re-arms every task without a restart.

Success looks like this: the task appears in the list with its heading, its next occurrence runs while the deployment is live, and a session named after the task id appears in the workspace you chose holding your prompt.

### When to choose it

Choose this page when tasks should be authored by a person in the browser. A deployment that ships a fixed task list in `cordis.yml`, or a headless deployment with no Web surface, sets the same tasks through the host package's `config` and needs no page at all. This page writes the user layer that replaces that shipped list once saved.

### Reading and editing a task

Each task renders as a card with its position heading, a paused marker when it is disabled, and a remove action. The fields are:

- **Task id** names the session and identifies the task in logs; it must be unique.
- **Workspace** is the directory the session runs in. A task whose saved directory is no longer registered keeps showing that path, marked as missing, instead of silently switching to another.
- **Time** is a local wall-clock time of day in 24-hour form, entered as three parts.
- **Time zone** is an optional IANA zone the time is read in; empty uses the process zone.
- **Days** selects the weekdays the task runs on. Selecting every day stores no day list, which is the every-day default.
- **Prompt** is sent as the session's first message.
- **Permission preset** must be one that never asks for approval, because nobody is present when a scheduled task runs.
- **Agent preset** is the composition the session joins, where the deployment configures a roster.
- **Enabled** pauses a task without deleting it.

The footer shows an unsaved-changes marker, a Discard action that restores the last saved list, and Save. A save is disabled while the draft is invalid, while a save is in flight, or when the host document does not accept writes.

### Validation and failed saves

The page validates the same structure the host refuses — a non-empty unique id, a chosen workspace, an `HH:MM:SS` time, at least one day, a non-empty prompt, and a permission preset — so a save never round-trips a refusal it could have shown immediately. When the host still refuses a write, the message appears beside the footer and the draft stays editable so the change can be retried. A task kept by the host that differs from what was submitted is reported the same way rather than being presented as stored.

### Removing a task

Removing asks for confirmation first, because the task stops running immediately. Sessions a removed task already created are kept: they are ordinary sessions and deleting the task does not touch them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the page and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Scope and composition

The plugin declares `inject = ['slots', 'locale', 'remote', 'settingsScope', 'settingsSchema', 'workspaces']` and registers one `settings.section` entry, `id: 'scheduled-tasks'`, at `order: 25`. `ctx.workspaces` is read through `ctx.get` so a deployment without the workspace service still mounts the page with an empty picker.

### Design philosophy

The page rests on one separation and three commitments:

- **One atomic write.** The settings wire replaces an array wholesale, so the page edits a local draft and submits the entire list in one mutation. A per-keystroke write would publish half-typed tasks.
- **The draft is fenced.** Each save carries the revision the draft began from, so a commit from another surface is refused rather than silently overwritten. A refused save keeps the edit and adopts the newer revision so a retry can land.
- **No policy is restated client side.** The permission picker reads the eligible preset names out of the host's own namespace schema, which is a union of the constants the host declares. A deployment that mounts no permission service registers a plain string instead, and the picker is simply empty.
- **The component never touches `ctx`.** The controller owns the draft in a snapshot store; the component reads it through the bound `useSchedulerTasks` seat and calls the callbacks the apply closure injects.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: `inject`, dictionaries, the controller, and the `settings.section` registration |
| [`src/client/controller.ts`](src/client/controller.ts) | The draft store, settings-scope mirroring, catalog refresh, and the one atomic save |
| [`src/client/tasks-store.ts`](src/client/tasks-store.ts) | Draft state and the action table that adds, patches, removes, and discards |
| [`src/client/SchedulerSection.tsx`](src/client/SchedulerSection.tsx) | The page: field rendering, client-side validation, and the removal confirmation |
| [`src/client/locales.ts`](src/client/locales.ts) | The English and Chinese dictionaries for the page |
| [`src/index.ts`](src/index.ts) | Node half: an empty `apply` so the row exists in the host composition |

### Mirroring and refresh

The controller subscribes to the bound `scheduler` namespace scope and projects each accepted section onto the draft. An in-progress edit is never overwritten by a background refresh, and the fence is deliberately not advanced: keeping the revision the draft began from is what makes a concurrent commit a refused write rather than a silent overwrite.

Picker catalogs come from host reads rather than the settings document. The workspace list is read synchronously from the registered workspaces, the agent-preset roster comes from an asynchronous `agentPresets.list` call whose failure leaves the picker with no options, and the permission presets are decoded from the namespace schema in the shared describe mirror. All three refresh on a forwarded `settings/document-updated` event.

### Decoding the permission presets

A per-namespace scope carries the resolved value but not the namespace's schema, so the eligible names are read from the shared describe mirror and rehydrated through the settings-owned schema service. The walk is explicit rather than going through the single-key `nodeAtPath` helper, which descends through an array without consuming the key that names a field inside its element. A union node is identified by its member list; a plain string node carries none, which is exactly the no-permission-service deployment.

### Draft semantics

Clearing an optional field omits the key rather than storing an explicit `undefined`, so the saved document keeps an omitted field omitted. Selecting every weekday clears the day list instead of restating the default. Task lists are copied field by field rather than with `structuredClone`, because the store's drafts are frozen and a clone refuses a frozen proxy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the page-level contract is not enough.

- [Scheduler host package](../../scheduler/scheduler/README.md) — the plugin that arms the tasks this page writes.
- [Scheduler subsystem](../../../docs/subsystems/scheduler.md) — the shared task vocabulary and the arming-to-release timing contract.
- [Settings shell](../ui-settings/README.md) — the domain base that owns the settings scope and schema services this page consumes.
- [Slots reference](../../../docs/subsystems/slots.md) — how a settings section is registered and receives its props.
- [Agent presets](../ui-agent-preset/README.md) — the roster the agent-preset picker lists.
- [Permission presets](../ui-permission-presets/README.md) — the preset family this page filters to unattended choices.

-----

<a id="model-experience"></a>
## Model Experience

### Indirect model context through the host scheduler

#### What the model sees

Nothing directly: this page never reaches a model request. It writes the task list the host package reads, and the `prompt` text plus the deployment default model selection those tasks carry are the only model-visible inputs; the [host package's Model Experience](../../scheduler/scheduler/README.md#model-experience) owns them.

#### Token effect

Zero direct tokens. Every model-visible byte this page contributes — the `prompt` of a task it saved — arrives through a Session the host package creates.

#### KV Cache effect

No request prefix is affected by the page. The writes it performs change which Sessions are started later, never the contents of an in-flight request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe when this page does not fit your use case or needs special operational care. They are current package constraints, not a general settings-UI comparison or a task backlog.

**Runtime invariant:** No companion is published. This page owns no durable store or event stream of its own — it reads and writes the host's `scheduler` settings namespace — and the one relationship worth observing, a save landing against the revision its draft began from, is checked where it is decided.

- **Host document required** — the page renders an unavailable notice when the `scheduler` namespace is not exposed or the connection keeps settings process-local; a deployment without the host package has nothing to configure.
- **Whole-list writes only** — the settings wire replaces the array wholesale, so two surfaces editing the list at once are resolved by the revision fence rather than merged; the second save is refused and its draft kept.
- **No run history in the page** — the page shows the configuration, never whether a task ran, succeeded, or failed. Outcomes live in the process log and the created Session.
- **No pause across restarts** — a task paused with the Enabled switch stays paused because the flag is stored, but nothing pauses a task automatically after a failed run.
- **Preset pickers reflect host reads** — an agent-preset roster read that fails leaves the picker empty rather than blocking the page, so a task can be saved without an agent preset until a later refresh succeeds.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Showing the next occurrence of each task, and a per-task last-run outcome, both belong to the host package's runtime rather than to this page and have no design owner. The page currently refreshes its catalogs on a settings document change only; a workspace registered while the page is open appears on the next refresh, and a live subscription is not part of the shipped scope.

</details>
