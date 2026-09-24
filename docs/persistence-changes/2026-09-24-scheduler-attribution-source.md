---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-24-scheduler-attribution-source

English | [中文](2026-09-24-scheduler-attribution-source.zh.md)

## Summary

Declares the `scheduler` message source as an attribution-only kind. The plugin records it on user, developer, inbox-inserted, and title-request messages, and now promises that a reader without the plugin keeps the kind and its metadata without validation, replay, or authority from it.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-24-scheduler-attribution-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "3ed17de09bbfe348deae57638a170f9ec09d95cf5cb5fb58edd685d2ae48da9b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "48110ca848e28d5bba15815804574ab7baeacaa660c39dd02c2decaf5087bf52"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "2fe3adf97eb025bd8f15de83412d157471ca495b7b88eb743716cac63592c350"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "1f841f41c0cb27573907426a6f82560c1b376435661b25bd89cbbfea90c107d4"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The writer version stays at 4 and existing records stay valid. A reader that does not load the scheduler plugin keeps the `scheduler` kind and its `taskId`, `occurrenceAt`, `form`, and `summary` fields as recorded JSON. The plugin derives every occurrence from the wall clock, replays nothing, and keeps no durable schedule state, so the kind carries no validation, replay, or authority requirement.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/scheduler/scheduler/tests scripts/persistence-schema.spec.ts scripts/persistence-changes.spec.ts: 8 test files passed, 265 tests passed. pnpm run verify-persistence-changes classifies all four affected roots as `attribution-kind-added` (same-version allowed).

<a id="dev-note"></a>
## Dev Note

None.
