---
description: "在指定工作区按每日挂钟时间无人值守启动会话并运行预设提示词的任务；面向安排周期性 agent 工作的用户与本插件的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-scheduler

[English](README.md) | 中文

## 概述

让你挑选的时间自动运行提示词——每天 09:30，或仅工作日——并在你指定的工作区中执行。到达该时间时，插件会在那里启动一个会话，应用你的权限预设与 Agent 预设，并把提示词作为其第一条消息发送；之后你像阅读任何其他会话一样阅读该记录。你可以在 Web GUI 的定时任务设置页编写任务，也可以在组合中直接提供。进程未运行时错过的时间会被跳过，并且定时运行没有人可以应答审批请求，因此需要使用无人值守预设。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载该插件，然后在它的 `config` 中提供任务，或在 GUI 中编写任务。随发布的 Web 组合以空任务列表挂载它，因此全新部署在你添加任务之前不会调度任何内容。

```yaml
- id: scheduler
  name: '@deepseek-ai/dsh-scheduler'
  config:
    tasks:
      - id: nightly-report
        time: '09:30:00'
        timeZone: Asia/Shanghai
        workspacePath: /home/me/project
        prompt: Summarize yesterday's commits and open issues.
        permissionPreset: unattended
        agentPreset: standard
```

成功的表现是：下一次到点时插件记录 `scheduler: task "nightly-report" Session "scheduler-nightly-report-…" completed for <instant>`，并且该工作区中存在一个标题为 `nightly-report` 的会话，其中保存着你的提示词与模型的回答。

### 何时选用

当工作必须在挂钟时间自行启动并留下记录时选用 Scheduler：早晨的分诊运行、每夜的依赖检查、每周报告。当任务必须在*某个特定会话打开期间*运行时请勿选用——[Schedule](../../schedule/schedule/README.zh.md) 包会把提醒送入一个活动会话并在重启后保留，但它绝不自行启动会话。Scheduler 不保存持久调度状态，因此不会补齐错过的时间，也无法保证某次运行确实发生：若进程在 09:30 时未运行，当天即被跳过。

### 任务字段

| 字段 | 默认值 | 含义 |
|---|---|---|
| `id` | `required` | 稳定 id；在任务之间唯一，用于命名会话标题，并随提示词的来源信息传递 |
| `workspacePath` | `required` | 会话运行所在目录的绝对路径，且该目录必须存在 |
| `time` | `required` | 本地挂钟时间，24 小时制 `HH:MM:SS` |
| `prompt` | `required` | 作为所创建会话第一条消息送入的文本 |
| `permissionPreset` | `required` | 在提示词之前应用的预设；其审批策略必须为 `never` |
| `enabled` | `true` | `false` 暂停任务而不删除 |
| `timeZone` | 进程时区 | 解读 `time` 所用的 IANA 时区，例如 `Europe/Berlin` |
| `weekdays` | 每天 | 运行的星期，`0`（周日）至 `6`（周六）；空列表会被拒绝 |
| `agentPreset` | 名单默认值 | 会话加入的 Agent 预设；部署配置了名单时必填，未配置时声明会被拒绝 |
| `title` | 任务 `id` | 在提示词之前应用的会话标题 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-scheduler)是每个可接受字段的完整来源。

### 在 GUI 中编写任务

配套包 [`@deepseek-ai/dsh-client-ui-scheduler`](../../client/ui-scheduler/README.zh.md) 在设置中增加一个**定时任务**页。它编辑本地草稿，并把整份任务列表作为一次写入提交，因此半成品任务绝不会被存储。该页校验 Host 会拒绝的同一套结构，因此结构上不可能成立的任务根本无法保存。它的权限预设选择器只提供此部署可无人值守运行的预设，并且这份列表读自 Host 自身的 schema，而不是在客户端重述策略。

没有 Web 界面的部署可以仅通过 `Config` 设置任务：插件通过 `ctx.get` 读取可选的 settings 服务，因此无界面组合无需该服务即可调度。

### 任务错过时间时

进程未运行时到达的到点会被跳过，因为下一个目标始终严格位于未来。若某个运行在自身下一次到点到达时仍在进行，该次到点即为逾期，并以同样方式跳过。不会有任何积压：调度直接推进到下一个未来到点。

### 运行结束时

定时运行在该轮次期间拥有其 Agent，随后释放它，因此每日重复不会累积活动会话。停滞的运行——提供方停止流式输出、工具永不返回——会在一小时后被取消，因为没有人盯着，而一个被永久占住的 Agent 会静默地让该任务的调度停摆。无论哪种情况记录都保持持久；只有创建失败会被回滚。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释插件背后的设计决策，并指向实现这些决策的代码；可观察行为已完整覆盖在[使用此包](#use-this-package)中。

### 作用域与组合

该插件声明 `inject = ['agents', 'agentDefaultModel', 'permissionPresets', 'sessions', 'sessionTitle', 'workspaceRegistry']`，因此缺少任一会话创建服务都属于组合错误。`agentPresets` 与 `settings` 被有意排除在外：部署可能不配置名单，裸 profile 也不挂载 settings 服务，因此两者都通过 `ctx.get` 读取。

### 设计理念

该包建立在一条分离与四项承诺之上：

- **没有持久调度状态。** 运行所创建的会话是唯一的持久记录。既没有补跑队列、没有错过的到点日志，也没有持久化的上次触发标记，因此插件无法与自身历史产生偏差。
- **纯粹的到点运算。** `nextOccurrence` 不读时钟：由调用方传入 `now`，因此每次唤醒都从挂钟时间重新推导，系统调整或夏令时切换都无法留下过期目标。
- **结构在编写处校验，引用在挂载时解析。** 任务的 id、时间、时区与星期不会改变，因此不可能成立的结构在写入处即被拒绝。其工作区目录、权限预设与 Agent 预设名单会改变，因此不可用的引用只跳过该任务，其余调度继续运行。
- **从构造上就是无人值守。** 定时运行没有人可以应答审批请求，因此审批策略不是 `never` 的预设会在挂载时被拒绝，而不会被允许无限期停住该运行。

### 源码导览

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`/`inject`/`Config`/`apply`、挂载，以及设置提交后的重新挂载 |
| [`src/types.ts`](src/types.ts) | `SchedulerTask`、`ResolvedSchedulerTask`，以及提示词的 `MessageSourceMap` 声明 |
| [`src/time.ts`](src/time.ts) | `HH:MM:SS` 与时区校验、日历归一化，以及下一到点解析 |
| [`src/config.ts`](src/config.ts) | 结构与引用的分野、`SchedulerConfigError`，以及挂载集合 |
| [`src/settings.ts`](src/settings.ts) | `scheduler` 设置命名空间 schema 与无人值守预选筛选 |
| [`src/session.ts`](src/session.ts) | 单次到点的会话事务：创建、绑定、配置、提示、排空、释放 |
| [`src/runtime.ts`](src/runtime.ts) | `TaskRuntime`：有上限、可再分段的定时器与唯一的进行中运行 |

### 挂载与重新挂载

`apply` 先校验一次配置的结构，随后解析当前任务列表并替换已挂载集合。替换的顺序保证任一到点都不会被漏掉或重复挂载：先构造新的运行时，再释放旧的，最后才启动新集合。代次计数器会使被取代的解析——即在后续变更到达之后才完成的 `resolve`——丢弃自身结果，而不是复活一份过期调度。

当存在 settings 服务时，插件把 `scheduler` 命名空间作为可选消费者挂载：组合 `config` 是基础层，用户保存的列表会替换它，且每次提交的变更都无需重启即可重新挂载。该分区的写入路径复用 `validateTaskStructure`，因此结构上不可能成立的任务会在写入处被拒绝，而不是被挂载后忽略。

### 时间解析

`nextOccurrence` 把 `now` 投影到已配置时区，逐日向前推进，并返回严格晚于 `now` 的第一个被选中的到点。被春令时前移移除的本地时间在当天被跳过，因为该时区中没有任何时刻会投影回它；重叠时选择较早的那个瞬间。搜索上限为 14 天，足以覆盖任意星期选择，其余余量用于吸收夏令时切换处连续不存在的本地时间。

### 活动所有者

`TaskRuntime` 朝目标挂载一段有上限的 `setTimeout`，上限为 Node 的 `MAX_TIMER_DELAY_MS`，因为更长的延迟会被钳制并立即触发。每次唤醒都会重读挂钟时间并重新推导下一到点，因此事件循环停顿或时钟调整都无法留下过期目标。到点会恰好启动一次运行并立即重新挂载；仍在进行的运行会使下一次到点逾期，并以与进程未运行时错过完全相同的方式被跳过。

Agent 或插件释放会取消定时器，并等待进行中的运行达到静止。运行自身的取消依赖注册信号，因此卸载插件会停止运行而不会破坏其持久记录。

### Agent 默认值

定时会话由部署当前的默认模型选择构成，并在到点开始时采样，因此运行会跟随此后被修改的默认值。该选择通过普通的 Agent 作用域接口安装，这意味着模型选择会像其他任何会话一样被记录在会话上。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当包级约定不足时，请阅读以下页面。

- [定时任务设置页](../../client/ui-scheduler/README.zh.md)——编写本插件所挂载任务列表的 GUI。
- [会话内 Schedule](../../schedule/schedule/README.zh.md)——同类包，把提醒送入一个活动会话而不是新建会话。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-scheduler)——本插件接收的完整 `tasks` schema。
- [Agent 预设](../../preset/agent-presets/README.zh.md)——任务的 `agentPreset` 所指名的名单。
- [权限预设](../../interaction/permission-presets/README.zh.md)——其审批策略决定哪些任务可无人值守运行的预设。
- [Workspace 注册表](../../workspace/workspace/README.zh.md)——任务的 `workspacePath` 所解析的目录。
- [Scheduler 子系统](../../../docs/subsystems/scheduler.zh.md)——共享类型与从挂载到释放的时序约定。

-----

<a id="model-experience"></a>
## 模型体验

### 定时任务提示词

#### 模型看到什么

每次到点时，会话的第一条消息恰好是任务作者所写的非空 `prompt`。插件不在其周围添加任何私有框架；该文本本身作为普通用户角色消息逐字送入。

#### Token 影响

一条取决于数据的用户角色消息保留在新会话中并计入 token，直到常规压缩移除或替换该历史。

#### KV Cache 影响

提示词开启一个新会话，因此它建立而不是破坏该会话可复用的请求前缀。

### 部署默认模型选择

#### 模型看到什么

所创建的 Agent 请求部署当前默认选择的提供方与模型对，并在到点开始时采样。除该对外，任务的配置没有任何内容到达模型。

#### Token 影响

无直接 token。该对只决定由哪个模型作答；它不添加任何消息、工具 schema 或提示词分区。

#### KV Cache 影响

选择在会话开始时即固定，因此不会在会话内使前缀失效。修改部署默认值只影响此后启动的会话。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制说明 Scheduler 何时不适用于你的用例，或需要特别的运维留意。它们是当前的包约束，而不是通用的任务运行器对比或任务清单。

**运行时不变式：** 不发布 companion。该包不拥有任何包内持久事件流——运行所创建的会话才是记录——而可能产生偏差的到点运算保持纯粹、确定，并由 `tests/time.spec.ts` 覆盖。

- **不补跑**——进程未运行时到达的到点会被跳过，绝不重放；需要每个到点都执行的任务必须由持有持久队列状态的东西来调度。
- **进程必须在运行**——只有在部署存活时到点才会到达。关机的机器，或稍后才挂载该插件的部署，会错过这段时间内的每个时间点。
- **仅在进程内**——插件在运行中的进程里启动会话；它绝不启动单独的进程、服务或调度守护进程，也无法在部署关闭时运行任务。
- **仅限无人值守权限预设**——审批策略不是 `never` 的预设会在挂载时被拒绝，因此任务无法使用需要由人应答的交互式预设。
- **每个任务同一时刻只运行一个**——若某个运行在自身下一次到点到达时仍在进行，该次到点即为逾期，会被跳过而不是排队。
- **固定的一小时运行期限**——停滞的运行会在一小时后被取消；该期限不可按任务配置。
- **没有运行历史或失败通知**——结果写入进程日志与会话记录。没有任何东西会重试被拒的运行，也没有报告说明某任务运行过。
- **任务结构一经存储即固定**——id、时间、时区与星期不会因外部世界变化而失效，但编辑其中任何一项都意味着保存一条新的任务记录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：尚未决定的方向。它明确不具权威性——已发布的行为、限制与既有理由位于上文各节、包代码以及所链接的 Agent Note 中。

Cron 风格重复（用表达式取代“每日时间加星期”）仍是同一套纯解析器可能的扩展方向；已发布范围是每日挂钟时间。按任务的运行期限、运行历史与失败通知渠道都是可能的后续工作，目前没有设计负责人。跨重启的暂停如今是作者的选择：`enabled: false` 会被存储，且没有任何东西会在失败后自动暂停任务。

</details>
