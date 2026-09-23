---
description: "Web GUI 的定时任务设置页：编写在设定时间于指定工作区启动会话的每日任务；面向无人值守 agent 运行的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-scheduler

[English](README.md) | 中文

## 概述

用这个页面在浏览器中安排 agent 工作：添加任务、选择其运行的工作区、设定时间与星期、编写提示词，并挑选权限预设与 Agent 预设。每个任务在时间到达时启动自己的会话，因此你之后像阅读其他任何会话一样阅读记录。编辑的是本地草稿——整份列表作为一次保存提交，半成品任务绝不会被存储。该页拒绝保存 Host 会拒绝的任务，并且只提供此部署可在无人值守下运行的权限预设。

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

把该插件与设置外壳以及 Host 的 `@deepseek-ai/dsh-scheduler` 包一起挂载；设置中随即出现一个**定时任务**页，位置在 Agent 预设之后。随发布的 Web 组合同时挂载两者。添加任务并按下保存会把列表写入 `scheduler` 命名空间，Host 无需重启即会重新挂载每个任务。

成功的表现是：任务带着其标题出现在列表中，其下一次到点在部署存活期间运行，并且一个以任务 id 命名的会话出现在你所选的工作区中，其中保存着你的提示词。

### 何时选用

当任务应由人在浏览器中编写时选用此页。在 `cordis.yml` 中提供固定任务列表的部署，或没有 Web 界面的无界面部署，都通过 Host 包的 `config` 设置同样的任务，完全不需要此页。此页写入的是用户层，一经保存即替换随发布提供的那份列表。

### 阅读与编辑任务

每个任务渲染为一张卡片，带有其序号标题、禁用时的暂停标记与删除操作。字段如下：

- **任务 ID** 用于命名会话并在日志中标识任务；它必须唯一。
- **工作区**是会话运行的目录。已保存目录不再被注册的任务会继续显示该路径并标记为缺失，而不是静默切换到另一个目录。
- **时间**是本地挂钟时间，24 小时制，由三段输入。
- **时区**是解读该时间所用的可选 IANA 时区；留空则使用进程时区。
- **星期**选择任务运行的日期。全选时不存储日期列表，这正是“每天”的默认值。
- **提示词**作为会话的第一条消息发送。
- **权限预设**必须是从不请求审批的那一类，因为定时任务运行时无人在场。
- **Agent 预设**是会话加入的组合，适用于部署配置了名单的情况。
- **启用**暂停任务而不删除。

页脚显示未保存更改标记、恢复上次已保存列表的放弃操作，以及保存。草稿无效、保存进行中，或 Host 文档不接受写入时，保存会被禁用。

### 校验与保存失败

该页校验 Host 会拒绝的同一套结构——非空且唯一的 id、已选择的工作区、`HH:MM:SS` 形式的时间、至少一天、非空提示词，以及权限预设——因此保存绝不会把本可立即显示出来的拒绝再绕一圈。当 Host 仍然拒绝写入时，消息出现在页脚旁，草稿保持可编辑以便重试。Host 保留下来的文档与提交内容不一致时，会以同样方式报告，而不会被当作已存储。

### 删除任务

删除会先请求确认，因为任务会立即停止运行。被删除任务已创建的会话会被保留：它们是普通会话，删除任务不会触碰它们。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释该页背后的设计决策，并指向实现这些决策的代码；可观察行为已完整覆盖在[使用此包](#use-this-package)中。

### 作用域与组合

该插件声明 `inject = ['slots', 'locale', 'remote', 'settingsScope', 'settingsSchema', 'workspaces']`，并注册一个 `settings.section` 条目，`id: 'scheduled-tasks'`，`order: 25`。`ctx.workspaces` 通过 `ctx.get` 读取，因此没有 workspace 服务的部署仍能挂载该页，只是选择器为空。

### 设计理念

该页建立在一条分离与四项承诺之上：

- **一次原子写入。** settings 线路会整体替换数组，因此该页编辑本地草稿并把整份列表作为一次变更提交。逐键写入会发布半成品任务。
- **草稿被栅栏保护。** 每次保存都携带草稿起始时的 revision，因此来自另一界面的提交会被拒绝，而不是被静默覆盖。被拒的保存保留编辑内容并采纳更新的 revision，以便重试能够落地。
- **不在客户端重述任何策略。** 权限选择器从 Host 自身的命名空间 schema 中读取可用的预设名，而该 schema 正是 Host 所声明常量的并集。未挂载权限服务的部署会注册普通字符串，此时选择器就是空的。
- **组件绝不接触 `ctx`。** 控制器在快照 store 中持有草稿；组件通过绑定的 `useSchedulerTasks` 席位读取它，并调用 apply 闭包注入的回调。

### 源码导览

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件入口：`inject`、字典、控制器，以及 `settings.section` 注册 |
| [`src/client/controller.ts`](src/client/controller.ts) | 草稿 store、settings 作用域镜像、目录刷新，以及那一次原子保存 |
| [`src/client/tasks-store.ts`](src/client/tasks-store.ts) | 草稿状态与新增、修补、删除、放弃的动作表 |
| [`src/client/SchedulerSection.tsx`](src/client/SchedulerSection.tsx) | 页面：字段渲染、客户端校验与删除确认 |
| [`src/client/locales.ts`](src/client/locales.ts) | 该页的英文与中文词典 |
| [`src/index.ts`](src/index.ts) | Node 半边：空 `apply`，使该行存在于 Host 组合中 |

### 镜像与刷新

控制器订阅已绑定的 `scheduler` 命名空间作用域，并把每个被接受的 section 投影到草稿上。进行中的编辑绝不会被后台刷新覆盖，且栅栏被有意不推进：保持草稿起始时的 revision，正是让并发提交成为被拒写入而不是静默覆盖的原因。

选择器目录来自 Host 读取而非 settings 文档。工作区列表从已注册的 workspace 同步读取，Agent 预设名单来自异步 `agentPresets.list` 调用（失败时选择器没有选项），权限预设则从共享 describe 镜像中的命名空间 schema 解码。三者在转发的 `settings/document-updated` 事件上一并刷新。

### 解码权限预设

按命名空间的作用域携带解析后的值，但不携带该命名空间的 schema，因此可用名称读自共享 describe 镜像，并通过 settings 拥有的 schema 服务重新水合。这里的遍历是显式的，而不是走单键的 `nodeAtPath` 辅助函数——后者会下探数组却不消费指向其元素内字段的键。并集节点由其成员列表识别；普通字符串节点没有成员列表，这正是未挂载权限服务的部署。

### 草稿语义

清空可选字段会省略该键，而不是存入显式的 `undefined`，因此已保存文档中省略的字段保持省略。全选星期会清空日期列表，而不是重述默认值。任务列表逐字段复制而非使用 `structuredClone`，因为 store 的草稿是冻结的，克隆会拒绝冻结代理。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当页面级约定不足时，请阅读以下页面。

- [Scheduler Host 包](../../scheduler/scheduler/README.zh.md)——挂载此页所写任务的插件。
- [Scheduler 子系统](../../../docs/subsystems/scheduler.zh.md)——共享任务词汇与从挂载到释放的时序约定。
- [设置外壳](../ui-settings/README.zh.md)——拥有此页所消费 settings 作用域与 schema 服务的领域基座。
- [Slots 参考](../../../docs/subsystems/slots.zh.md)——设置分区如何注册并接收其 props。
- [Agent 预设](../ui-agent-preset/README.zh.md)——Agent 预设选择器所列出的名单。
- [权限预设](../ui-permission-presets/README.zh.md)——此页筛选出无人值守选项的预设族。

-----

<a id="model-experience"></a>
## 模型体验

### 经由 Host 调度器的间接模型上下文

#### 模型看到什么

没有直接内容：此页绝不触及模型请求。它写入 Host 包所读取的任务列表，而那些任务携带的 `prompt` 文本与部署默认模型选择是仅有的模型可见输入；其归属见 [Host 包的模型体验](../../scheduler/scheduler/README.zh.md#model-experience)。

#### Token 影响

无直接 token。此页贡献的每一个模型可见字节——即它保存的任务的 `prompt`——都经由 Host 包创建的会话到达。

#### KV Cache 影响

该页不影响任何请求前缀。它执行的写入改变的是此后启动哪些会话，而绝不是进行中请求的内容。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制说明此页何时不适用于你的用例，或需要特别的运维留意。它们是当前的包约束，而不是通用的设置界面对比或任务清单。

**运行时不变式：** 不发布 companion。此页不拥有任何自己的持久存储或事件流——它读写 Host 的 `scheduler` 设置命名空间——而唯一值得观察的关系（保存相对于草稿起始 revision 是否落地）在做出决定的地方校验。

- **需要 Host 文档**——当 `scheduler` 命名空间未被公开，或连接把设置保留在进程本地时，该页渲染不可用提示；没有 Host 包的部署没有任何内容可配置。
- **仅支持整表写入**——settings 线路整体替换数组，因此两个界面同时编辑列表时以 revision 栅栏裁决而非合并；第二次保存会被拒绝并保留其草稿。
- **页面中没有运行历史**——该页只显示配置，绝不显示某任务是否运行、成功或失败。结果位于进程日志与所创建的会话中。
- **跨重启没有暂停**——用“启用”开关暂停的任务因该标志被存储而保持暂停，但没有任何东西会在运行失败后自动暂停任务。
- **预设选择器反映 Host 读取**——Agent 预设名单读取失败只会让选择器为空，而不会阻塞该页，因此在后续刷新成功之前，任务可以在没有 Agent 预设的情况下保存。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：尚未决定的方向。它明确不具权威性——已发布的行为、限制与既有理由位于上文各节、包代码以及所链接的 Agent Note 中。

显示每个任务的下一次到点，以及按任务的上次运行结果，都归属于 Host 包的运行时而不是此页，目前没有设计负责人。该页目前只在 settings 文档变更时刷新目录；页面打开期间注册的工作区会在下次刷新时出现，而实时订阅不属于已发布范围。

</details>
