---
description: "限定会话范围的交互式终端 seam，供组合、扩展或消费 ctx.interactiveTerminals 注册表的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-terminal-interactive

[English](README.md) | 中文

## 概述

`dsh-terminal-interactive` 向渲染终端本身的消费方提供原始的、双向的终端：限定会话范围的 `ctx.interactiveTerminals` 服务铸造不透明终端 id，把分配路由到已注册的提供方，保留在消费方接入之前产生的输出，并等待清理静默完成。它自身不定义任何终端机制——进程分配由诸如随附的 `dsh-terminal-interactive-local` 之类的提供方负责——也不注册任何工具或提示词片段。终端只存在于进程内：它们不会在 harness 重启后存活。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 `@deepseek-ai/dsh-terminal-interactive` 与一个提供方和一个消费方一起挂载。单独的服务不分配任何东西：没有注册的提供方时每次 `open` 都会失败，没有消费方时没有任何字节被读取。

```yaml
- name: '@deepseek-ai/dsh-terminal-interactive'
- name: '@deepseek-ai/dsh-terminal-interactive-local'
```

### 何时选择它

当消费方自己绘制终端时选择这个 seam——终端模拟器需要转义序列、光标移动、不完整的 UTF-8 序列和窗口尺寸变更。当消费方读取渲染后的文本、发送按行组织的输入并等待就绪时，请改用 [`ctx.terminals`](../terminal/README.zh.md)：那个服务面向模型，由确切的 `Agent` 拥有，并返回净化后的文本；本服务面向用户界面，由 `Session` 拥有。

### 终端操作

| 操作 | 返回 | 用途 |
|---|---|---|
| `open(owner, { type, cwd, cols, rows })` | `InteractiveTerminalSnapshot` | 分配一个终端并按 owner 发布 |
| `list(owner)` | `InteractiveTerminalSnapshot[]` | 该 owner 按发布顺序排列的存活终端 |
| `write(owner, id, data)` | — | 投递输入字节，不做换行转换 |
| `resize(owner, id, cols, rows)` | — | 变更窗口尺寸并通知前台进程组 |
| `frames(owner, id, signal)` | `AsyncIterable<InteractiveTerminalFrame>` | 该终端已保留的和实时的输出，随后是它的结局 |
| `close(owner, id, reason?)` | `boolean` | 在等待提供方清理后关闭一个终端 |
| `closeOwner(owner, reason?)` | — | 关闭一个会话拥有的所有终端 |
| `registerProvider(provider)` | 清理函数 | 贡献一个提供方类型 |
| `listProviders()` | `string[]` | 按注册顺序排列的已注册提供方类型 |

### 帧

终端的流先产出携带原始字节的 `output` 帧，随后恰好产出一个终端结局：带进程状态的 `exit`，或带底层错误消息的 `failed`。流在该结局之后结束，因此稍后重新连接的消费方仍能得知进程是如何结束的。

在 `open` 与消费方首次拉取之间产生的输出会被保留，这正是“先取身份、再开流”这一顺序安全的原因：`open` 返回一个 id，消费方随后再打开流。

### 归属与隔离

每个终端都由打开它的确切 `Session` 拥有。指向另一个会话终端的操作会以 `FOREIGN_TERMINAL` 失败，指向不存在的终端的操作会以 `NO_TERMINAL` 失败。终端 id 是不透明的，由本服务铸造，绝不来自提供方或调用方。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxBufferedBytes` | `1048576`（1 MiB） | 单个终端在消费方之前保留输出的字节预算（含端点）；预算用尽后生产方会等待 |

### 失败

每个失败都是一个携带稳定错误码的 `InteractiveTerminalError`：`DUPLICATE_PROVIDER`、`FOREIGN_TERMINAL`、`NO_PROVIDER`、`NO_TERMINAL`、`OUTPUT_ACTIVE`（对同一终端请求了第二条 generation），或 `SERVICE_DISPOSING`。无法完成分配的提供方会在任何内容被发布之前拒绝该次 open；失败的 close 不会谎称成功，而是让该终端仍然可寻址并上报失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计概念

服务负责身份、发布、授权、保留与清理顺序；提供方负责底层机制。提供方只交出一个存活会话，别的什么都不交出，因此同一个注册表既能服务本地 PTY，也能服务远程沙箱，或任何未来的底层。

保留正是本能力是一个服务而不是一层薄封装的原因。消费方在知道终端 id 之前无法接入，而 shell 在这之前就已经写出了第一个提示符。因此服务从发布那一刻起就一直消费提供方的输出，把它放入有界队列，并把帧交给随后到来的那个消费方。

背压是单向的。一旦保留字节达到 `maxBufferedBytes`，生产方就会等待；因此停滞的消费方无法通过该队列增长 Host 内存。消费方永远不会被预算阻塞：它会先取走已保留的内容，然后等待下一帧或流的结束。

### 源码导览

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `InteractiveTerminalService`：提供方注册表，open/list/write/resize/frames/close、按 owner 清理与释放 |
| [`src/buffer.ts`](src/buffer.ts) | `FrameBuffer`：有界队列、它的消费方槽位与背压 |
| [`src/types.ts`](src/types.ts) | 提供方与会话约定、帧、快照，以及 open 请求 |
| — | 未发布运行时 invariant 伴生包；提供方与终端注册表都是私有可变状态，且服务不暴露任何不受作用域限制的快照。 |

### 生命周期

一次 open 会铸造 id、调用提供方，并只在提供方 resolve 之后才发布记录。被取消或正在释放的 open 会关闭它刚刚拿到的会话，因此不会有进程存活于未发布的终端之后。每条已发布的记录会启动一个 drain 循环，该循环以终端结局结束并关闭队列。`close` 会等待提供方清理与 drain 循环，然后才移除记录；`closeOwner` 与服务释放会关闭每个被拥有的终端并汇总每个失败。

### 单消费方规则

一个终端的输出只属于一个 generation。两个 generation 会把同一条字节流拆给两个模拟器，各自看到的会是不同且已损坏的终端，因此第二次 `frames` 调用会以 `OUTPUT_ACTIVE` 失败。当该 generation 的 signal 中止或其消费方停止迭代时，槽位即被释放，这正是重新连接的消费方能够接管的原因。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [terminal/ 包映射](../README.zh.md)——终端家族及其成员的组合方式。
- [`ctx.terminals`](../terminal/README.zh.md)——本服务刻意不去扩展的、面向模型的持久 PTY seam。
- [terminal-interactive-local 提供方](../terminal-interactive-local/README.zh.md)——随附的本地 PTY 提供方。
- [subprocess seam](../../subprocess/subprocess/README.zh.md)——本地提供方所构建于其上的终端进程原语。
- [能力 seam](../../../docs/capability-seams.zh.md)——本包遵循的 Service Definition / Provider / Consumer 拆分。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册工具、不贡献提示词片段，也不追加会话事件。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有输出重放**——保留队列自发布起为空；在预算被用尽并排空之后才到来的消费方只能看到其后的内容。重新连接的终端模拟器从空白屏幕开始，而不是已保留的回滚内容。
- **不能读取回滚**——服务只转发字节，字节被消费之后不再保留，因此没有翻页操作，也没有总行数。
- **背压止于本队列**——预算用尽后生产方会停止拉取，但所配置的预算只约束本服务保留的内容；提供方自身底层的缓冲区不在本约定范围内。
- **终端只存在于进程内**——终端存在于本进程并随其消失；重启之后其 id 不再有意义。
- **每个终端只有一个消费方**——设计禁止扇出；两个查看者要看同一个终端需要消费方侧的共享，而不是在本服务中开第二条 generation。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
