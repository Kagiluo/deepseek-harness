---
description: "The Web GUI's Scheduled tasks settings page: author the daily tasks that start a session in a workspace at a set time; for users and maintainers of unattended agent runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-scheduler

English | [中文](README.zh.md)

## Summary

Use this page to schedule agent work in the browser: add a task, choose its workspace, time, and days, write the prompt, and pick the permission and agent presets. Each task starts its own session when its time arrives, so its transcript reads like any other session. Editing is a local draft: the whole list is saved at once, and saving is blocked while a task is invalid. A half-typed task is never stored, and the host refuses a permission preset that asks for approval, because nobody is present when a scheduled task runs.

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

Mount the plugin alongside the settings shell and the host `@deepseek-ai/dsh-scheduler` package; a **Scheduled tasks** page then appears in Settings, ordered after Agent presets. The shipped Web bundle mounts both. Adding a task and pressing Save writes the list to the `scheduler` settings entry, and the host re-arms every task without a restart.

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
- **Permission preset** is applied before the run; the host refuses one whose approval policy is not `never`, because nobody is present when a scheduled task runs.
- **Agent preset** is the composition the session joins, where the deployment configures a roster.
- **Enabled** pauses a task without deleting it.

The footer shows an unsaved-changes marker, a Discard action that restores the last saved list, and Save. A save is disabled while the draft is invalid, while a save is in flight, or when the host document does not accept writes.

### Validation and failed saves

The page validates each task before saving — a non-empty unique id, a registered workspace, an `HH:MM:SS` time, at least one day, a non-empty prompt, and a permission preset — so the common mistakes are shown beside the field rather than round-tripped. The write itself is accepted on the field schema, so the host's own `validateTaskStructure` runs when it arms the list and reports a structurally impossible list in the process log. When the host still refuses a write, the message appears beside the footer and the draft stays editable so the change can be retried. A task kept by the host that differs from what was submitted is reported the same way rather than being presented as stored.

### Removing a task

Removing asks for confirmation first, because the task stops running immediately. Sessions a removed task already created are kept: they are ordinary sessions and deleting the task does not touch them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the page and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Scope and composition

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.agentPresets', 'remote.permissionPresets', 'configForms', 'workspaces']` and registers one `settings.section` entry, `id: 'scheduled-tasks'`, at `order: 25`. `configForms` carries the `scheduler` entry's values and write queue. The two dotted Remote namespaces are declared separately because a generated Remote namespace is its own service: `ctx.remote`'s property proxy resolves one only when its dotted name is in the injection set.

### Design philosophy

The page rests on one separation and three commitments:

- **One atomic write.** The settings wire replaces an array wholesale, so the page edits a local draft and submits the entire list in one mutation. A per-keystroke write would publish half-typed tasks.
- **The draft is fenced.** Each save carries the revision the draft began from, so a commit from another surface is refused rather than silently overwritten. A refused save keeps the edit and adopts the newer revision so a retry can land.
- **No policy is restated client side.** The permission picker lists every preset the deployment's Remote catalog advertises, and the host refuses a preset whose approval policy is not `never` when it arms the task.
- **The component never touches `ctx`.** The controller owns the draft in a snapshot store; the component reads it through the bound `useSchedulerTasks` seat and calls the callbacks the apply closure injects.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: `inject`, dictionaries, the controller, and the `settings.section` registration |
| [`src/client/controller.ts`](src/client/controller.ts) | The draft store, configuration-form mirroring, catalog refresh, and the one atomic save |
| [`src/client/tasks-store.ts`](src/client/tasks-store.ts) | Draft state and the action table that adds, patches, removes, and discards |
| [`src/client/SchedulerSection.tsx`](src/client/SchedulerSection.tsx) | The page: field rendering, client-side validation, and the removal confirmation |
| [`src/client/locales.ts`](src/client/locales.ts) | The English and Chinese dictionaries for the page |
| [`src/index.ts`](src/index.ts) | Node half: an empty `apply` so the row exists in the host composition |

### Mirroring and refresh

The controller subscribes to the `scheduler` configuration form and projects each accepted section onto the draft. An in-progress edit is never overwritten by a background refresh, and the fence is deliberately not advanced: keeping the revision the draft began from is what makes a concurrent commit a refused write rather than a silent overwrite.

Picker catalogs come from host reads rather than the settings document. The workspace list is read synchronously from the registered workspaces, the agent-preset roster from an asynchronous `agentPresets.list` call, and the permission presets from the `permissionPresets.catalog` Remote method. All three refresh on this entry's forwarded `settings/document-updated` event and on every `permission-presets/catalog-changed` event; a failed read leaves its picker empty rather than failing the page.

### Permission presets

The permission table's Remote catalog carries each preset's `value` and display `name`, not its approval policy, so the page cannot tell which presets run unattended. It lists every catalogued preset and leaves the `never` requirement to the host, which refuses a task whose preset asks for approval when that task is armed.

### Draft semantics

Clearing an optional field omits the key rather than storing an explicit `undefined`, so the saved document keeps an omitted field omitted. Selecting every weekday clears the day list instead of restating the default. Task lists are copied field by field rather than with `structuredClone`, because the store's drafts are frozen and a clone refuses a frozen proxy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the page-level contract is not enough.

- [Scheduler host package](../../scheduler/scheduler/README.md) — the plugin that arms the tasks this page writes.
- [Scheduler subsystem](../../../docs/subsystems/scheduler.md) — the shared task vocabulary and the arming-to-release timing contract.
- [Settings shell](../ui-settings/README.md) — the domain base that owns the `ctx.configForms` service this page consumes.
- [Slots reference](../../../docs/subsystems/slots.md) — how a settings section is registered and receives its props.
- [Agent presets](../ui-agent-preset/README.md) — the roster the agent-preset picker lists.
- [Permission presets](../ui-permission-presets/README.md) — the preset family whose catalog fills this page's permission picker.

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
- **Preset pickers reflect host reads** — a failed agent-preset roster read leaves that picker empty rather than blocking the page, so a task can be saved without an agent preset until a later refresh succeeds; a failed permission-catalog read leaves no selectable permission preset.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Showing the next occurrence of each task, and a per-task last-run outcome, both belong to the host package's runtime rather than to this page and have no design owner. The page refreshes its catalogs on this entry's forwarded settings change and on every permission-catalog change, re-reading the workspace list at the same time; a live workspace subscription is not part of the shipped scope.

</details>
