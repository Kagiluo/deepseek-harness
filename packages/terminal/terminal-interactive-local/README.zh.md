---
description: "本地交互式终端提供方：在共享沙箱策略下、基于 subprocess 终端原语运行真实 shell。"
kind: "package-reference"
---

# @deepseek-ai/dsh-terminal-interactive-local

[English](README.md) | 中文

## 概述

`dsh-terminal-interactive-local` 为 `ctx.interactiveTerminals` 提供 `shell` 类型：它为每个终端分配一个交互式 shell 进程，运行在请求的工作目录中、处于拥有该终端的会话的执行策略之下，并把原始字节传输、输入、尺寸变更和等待完成的清理交给调用方。它不拥有身份、保留或授权——这些由[交互式终端 seam](../terminal-interactive/README.zh.md) 拥有——也不注册任何工具或提示词片段。

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

把它与 seam 和进程底层一起挂载。它需要 `ctx.interactiveTerminals`、`ctx.sandboxPolicy` 与 `ctx.subprocess`。

```yaml
- name: '@deepseek-ai/dsh-terminal-interactive'
- name: '@deepseek-ai/dsh-terminal-interactive-local'
  config:
    providerType: shell
    shellDialect: bash
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerType` | `shell` | 本提供方注册所用的注册表类型 |
| `shellDialect` | `bash` | 交互式 shell 方言；用于选择 argv 默认值 |
| `shellPath` | 按方言——`/bin/bash`，或解析得到的 pwsh | 交互式 shell 可执行文件 |
| `shellArgs` | bash `['-i']`，pwsh `['-NoLogo']` | shell 参数 |
| `disposeGraceMs` | `3000` | 清理从 TERM 升级到 KILL 之前的宽限期 |

`shellPath`/`shellArgs` 未设置或为空时选择该方言的默认值；非空的显式值始终优先。

与面向模型的 PTY 后端不同，这里的默认参数会加载 shell 自身的启动文件：别名、提示符和补全正是一个用户终端存在的意义。

### 执行策略

分配会为拥有该终端的会话解析 `ctx.sandboxPolicy`——存活的会话贡献其不可变的 `cwd` 与其已记录的沙箱模式折叠值——并在模式不是 `danger-full-access` 时通过 `ctx.sandbox` 约束 argv。受限模式下执行环境中没有 `ctx.sandbox` 提供方，或约束结果为空的 argv 时，open 会在任何进程启动之前失败；不存活的会话回退到部署策略。

### 环境

提供方在 subprocess 提供方已清理的环境变量之上叠加 `TERM=xterm-256color`、`COLORTERM=truecolor`、`DSH_SHELL=1`、`DSH_SESSION_ID` 与 `DSH_PTY_SESSION_ID`。`TERM` 描述的是 Client 模拟器，因此 shell 会发出该终端能够绘制的转义序列。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计概念

本提供方是一层薄适配器。subprocess seam 的终端原语已经为整个进程会话负责控制终端、有序字节输出、输入、尺寸变更与 TERM 到 KILL 的静默完成，因此本包把这些映射到交互式终端会话约定上，并记住 `status()` 所报告的进程结局。

### 源码导览

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `LocalInteractiveTerminalProvider`：策略解析、沙箱约束、启动进程、插件注册 |
| [`src/config.ts`](src/config.ts) | `Config`、方言解析与校验 |
| [`src/session.ts`](src/session.ts) | `LocalInteractiveSession`：基于一个 `SubprocessTerminalHandle` 的会话约定 |
| — | 未发布运行时 invariant 伴生包；提供方不持有注册表，其唯一状态是每个会话一个进程句柄。 |

### 关闭与失败

`close` 会终止所捕获的进程会话一次，并把并发调用合并到那一次操作上；提供方清理失败时会带上 close 的原因上报，并清除已合并的 promise，使重试成为可能。结局 promise 映射为带所报告退出信息的 `exited`，而提供方或传输失败映射为两项信息均未知的 `exited`，因为没有观察到退出。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [交互式终端 seam](../terminal-interactive/README.zh.md)——本提供方注册进入的注册表。
- [subprocess seam](../../subprocess/subprocess/README.zh.md)——终端进程原语及其尺寸变更约定。
- [沙箱策略](../../sandbox/sandbox-policy/README.zh.md)——执行模式与工作区根目录的来源。
- [terminal-bash 后端](../terminal-bash/README.zh.md)——面向模型的 PTY 后端，共用同一底层但额外提供就绪检测与回滚。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册工具、不贡献提示词片段，也不追加会话事件。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限本地进程**——分配总是在本提供方的执行环境中启动进程；远程执行环境需要它自己的提供方。
- **会话策略在 open 时采样**——模式与工作区根目录只在终端启动时读取一次；之后的模式变更不会重新约束正在运行的 shell。
- **没有启动就绪检测**——`open` 在进程被分配后立即 resolve，因此消费方看到的是 shell 自身的提示符而不是就绪信号，启动失败的 shell 只能通过流结束来上报失败。
- **shell 配置文件不受沙箱约束**——默认参数会加载用户的启动文件；它们在受约束的 argv 下运行，但自身仍可能通过 shell 访问工作区之外的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
