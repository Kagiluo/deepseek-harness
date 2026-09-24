---
description: "Package map for daily wall-clock agent tasks: the host scheduler that starts Sessions unattended and the Web settings page that authors them."
kind: "package-group"
---

# scheduler/ — daily wall-clock agent tasks

English | [中文](README.zh.md)

## Summary

The Scheduler family runs a prompt by itself at a time you choose. At each configured time the host plugin starts a real Session in a workspace you name, applies your permission and agent preset, and sends your prompt as its first message. The Web settings page authors and edits that task list. The plugin keeps no durable schedule state: the Sessions it creates are the record, and a time missed while the process was down is skipped.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`scheduler/`](scheduler/README.md) | Daily wall-clock arming and the unattended Session transaction | consumes `ctx.agents`, `ctx.workspaceRegistry`, `ctx.sessionTitle`, `ctx.permissionPresets`, `ctx.agentDefaultModel`, `ctx.sessions` |
| [`../client/ui-scheduler/`](../client/ui-scheduler/README.md) | The Scheduled tasks settings page over the `scheduler` settings entry | consumes `ctx.configForms`, `ctx.remote`, `ctx.workspaces` |

<a id="related-documentation"></a>
## Related documentation

The [Scheduler subsystem reference](../../docs/subsystems/scheduler.md) owns the shared task vocabulary and the arming-to-release timing contract. The host package README owns configuration and the run transaction; the client package README owns the settings page.

For reminders delivered into one live conversation rather than a new Session, use the sibling [Schedule](../schedule/README.md) family instead.

<a id="dev-note"></a>
## Dev Note

None.
