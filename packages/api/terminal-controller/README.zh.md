---
description: "Web GUI 的交互式终端 Remote：在会话的工作区中打开、驱动、调整尺寸并跟踪真实 shell。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-terminal-controller

[English](README.md) | 中文

## 概述

`dsh-api-terminal-controller` 是浏览器通往会话工作区中真实 shell 的路径。它在 `ctx.interactiveTerminals` 之上暴露 `terminals` Remote 命名空间：打开终端、写入输入、调整窗口尺寸、关闭终端、列出某个会话的终端，并以 Remote 流跟踪某个终端的输出。它不拥有终端机制，也不拥有身份——分配、授权与清理都由 seam 负责——也不注册任何工具或提示词片段。

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

把它与交互式终端 seam 及一个提供方一起挂载在 Host 上：

```yaml
- name: '@deepseek-ai/dsh-terminal-interactive'
- name: '@deepseek-ai/dsh-terminal-interactive-local'
- name: '@deepseek-ai/dsh-api-terminal-controller'
  config:
    type: shell
```

Client 以 `remote.terminals.<method>` 调用生成的命名空间。

### 方法

| 方法 | 返回 | 用途 |
|---|---|---|
| `open({ sessionId, cols, rows })` | `TerminalSnapshot` | 在该会话的工作区中分配一个终端 |
| `list({ sessionId })` | `TerminalSnapshot[]` | 该会话按发布顺序排列的存活终端 |
| `write({ sessionId, terminalId, data })` | — | 投递输入字节，不做换行转换 |
| `resize({ sessionId, terminalId, cols, rows })` | — | 变更窗口尺寸 |
| `close({ sessionId, terminalId })` | `TerminalCloseResult` | 在等待清理后关闭一个终端 |
| `output({ sessionId, terminalId })` | `TerminalFrame` 流 | 已保留的和实时的输出，随后是终端结局 |

### 帧与编码

`output` 是流式 Remote。它先产出 `output` 帧，其 `data` 是终端原始字节的 base64 编码，随后恰好产出一个终端结局：带进程状态的 `exit`，或带底层错误消息的 `failed`。base64 正是 JSON 载体所能承载、同时又能保留 shell 所写下的每个转义序列与不完整 UTF-8 序列的形式——Client 解码为字节后原样交给它的模拟器。

一个 generation 在其整个生命周期内持有该终端的唯一消费方槽位；对同一终端的第二条 `output` generation 会以 seam 的 `OUTPUT_ACTIVE` 失败，连接或调用方的 signal 结束时槽位即被释放。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `type` | `shell` | 每个终端打开时使用的提供方类型 |

### 失败

seam 的失败原样跨线传递：`NO_PROVIDER`、`NO_TERMINAL`、`FOREIGN_TERMINAL`、`OUTPUT_ACTIVE`、`SERVICE_DISPOSING` 与 `DUPLICATE_PROVIDER`，全部由 seam 的错误类型承载。调用方不拥有的会话身份不算一种单独的失败——seam 以确切的 owner 作为隔离依据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计概念

本包是一层无状态的翻译层。Client 发来的会话身份成为 seam 的 owner 键；提供方类型来自该行的配置；原始字节在出口处变为 base64。授权、保留、背压与清理都留在 `ctx.interactiveTerminals`，因此浏览器与任何未来的消费方共享同一份约定，而不是各自重新推导一份。

### 源码导览

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `TerminalController`：`terminals` 命名空间、它的 6 个方法与 base64 编码 |
| [`src/types.ts`](src/types.ts) | 线上的请求与结果值，以 `./types` 发布 |
| — | 未发布运行时 invariant 伴生包；控制器不持有状态，它的每个答案都在调用时从 seam 推导。 |

Typert 生成由 `./typert` 与 `./remote` 暴露的 Host 与 Client Remote 产物。

### 命名空间与 Cordis 键

线上的命名空间是 `terminals`，而 Cordis 服务键是 `terminalController`。二者刻意不同：`ctx.terminals` 已经是面向模型的持久 PTY seam，而一个 Context 键无法承载两份互不兼容的声明。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [交互式终端 seam](../../terminal/terminal-interactive/README.zh.md)——该注册表、它的帧与归属规则。
- [本地提供方](../../terminal/terminal-interactive-local/README.zh.md)——随附的 `shell` 提供方。
- [Remote 装配](../remotes/README.zh.md)——Client 包如何到达 `terminals` 命名空间。
- [workspace-files](../workspace-files/README.zh.md)——本包所沿用的、同类会话范围读取接口的兄弟 Remote。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册工具、不贡献提示词片段，也不追加会话事件。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有会话结束时的清理触发条件**——控制器在 Client 请求时、或其流 generation 结束时关闭终端；若 Client 直接消失而会话仍然打开，该终端要等到下一次显式请求才会被关闭，而不是由观察到的会话事件触发。
- **不能指定工作目录**——`open` 从执行策略中取得会话的工作区；Client 目前无法在别处启动 shell。
- **没有回滚接口**——`output` 只向前携带字节，因此重新连接的 Client 从空白模拟器开始，而不是重绘已保留的历史。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
