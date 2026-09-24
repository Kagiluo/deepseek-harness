---
description: "定时唤醒 agent 任务包族说明：无人值守启动会话的 Host 调度器，以及编写这些任务的 Web 设置页。"
kind: "package-group"
---

# scheduler/ — 每日定时 agent 任务

[English](README.md) | 中文

## 概述

Scheduler 包族让你挑选的时间自动运行提示词。每次到达设定时间，Host 插件会在你指定的工作区中启动一个真实会话，应用你的权限预设与 Agent 预设，并把提示词作为该会话的第一条消息发送。Web 设置页负责编写和编辑这份任务列表。插件本身不保存任何持久调度状态：它创建的会话就是记录，进程未运行时错过的时间会被跳过。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 作用 | ctx 键 |
|---|---|---|
| [`scheduler/`](scheduler/README.zh.md) | 每日挂钟时间计时与无人值守会话事务 | 消费 `ctx.agents`、`ctx.workspaceRegistry`、`ctx.sessionTitle`、`ctx.permissionPresets`、`ctx.agentDefaultModel`、`ctx.sessions` |
| [`../client/ui-scheduler/`](../client/ui-scheduler/README.zh.md) | 基于 `scheduler` 设置条目的定时任务设置页 | 消费 `ctx.configForms`、`ctx.remote`、`ctx.workspaces` |

<a id="related-documentation"></a>
## 相关文档

[Scheduler 子系统参考](../../docs/subsystems/scheduler.zh.md)拥有共享的任务词汇与从挂载到释放的时序约定。Host 包 README 拥有配置与运行事务；客户端包 README 拥有设置页。

若需要把提醒送入一个正在进行的会话而不是新建会话，请改用同级的 [Schedule](../schedule/README.zh.md) 包族。

<a id="dev-note"></a>
## Dev Note

None.
