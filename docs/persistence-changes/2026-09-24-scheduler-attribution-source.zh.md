---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-24-scheduler-attribution-source

[English](2026-09-24-scheduler-attribution-source.md) | 中文

## 概述

把 `scheduler` 消息源声明为仅归属信息的 kind。该插件会在 user、developer、inbox 插入与标题请求消息中记录它，现在承诺：不加载该插件的读取器会保留该 kind 及其元数据，不需要它提供校验、回放或权限。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

写入器版本保持 4，已有记录仍然有效。不加载 scheduler 插件的读取器会按记录原样保留 `scheduler` kind 及其 `taskId`、`occurrenceAt`、`form`、`summary` 字段。该插件从挂钟时间推导每个到点、不回放任何内容，也不保存持久调度状态，因此该 kind 不带来校验、回放或权限要求。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/scheduler/scheduler/tests scripts/persistence-schema.spec.ts scripts/persistence-changes.spec.ts：8 个测试文件通过，265 个测试通过。`pnpm run verify-persistence-changes` 把受影响的四个根一律判为 `attribution-kind-added`（允许同版本）。

<a id="dev-note"></a>
## 开发备注

无。
