---
description: "右侧栏的交互式终端标签页：基于限定会话范围的 terminals Remote 命名空间的 xterm.js 模拟器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-terminal

[English](README.md) | 中文

## 概述

在右侧栏中打开真实交互式 shell，并从浏览器驱动它。标签页类型是 `terminal`，属于页面类型：它不认领任何文件或资源地址，引导页会提供它，而从这个入口打开的每个终端都是独立的标签页——同一工作区的两个终端是两个 shell，而不是同一个东西的两种视图。一个 xterm.js 模拟器绘制一个 Host 进程，其工作目录是会话的工作区根目录，其约束来自会话的沙箱策略。

## 目录

- [注册内容](#what-it-registers)
- [模拟器与进程](#the-emulator-and-the-process)
- [读取与写入](#reading-and-writing)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册内容

- **类型**——`ctx.sidebarRightTabs.register(...)`，id 为 `@deepseek-ai/dsh-client-ui-terminal`（本实现在标签页系统中的身份，也是其正文注册所用的键），kind 为 `terminal`，band 为 `builtin`，且没有 `patterns`。没有 patterns 的类型按 kind 打开，因此 `ctx.sidebarRight.openTab('terminal')` 与引导页胶囊都能到达它；它永远不会认领另一个类型也会匹配的地址。引导页在 order 20 贡献一个条目，排在文件树的 order 10 之后，因此该列的默认页仍是工作区文件树。
- **正文**——以类型 id 为键的 `sidebar.right.pane.tab` 座位，文案命名空间为 `terminal`。没有 `sidebar.right.pane.tab.title` 注册：标签页打开时，芯片捕获的是类型自身的 `title` thunk，而终端标题不会变化。
- **词典**——`ctx.locale.register('terminal', { zh, en })`。

浏览器半边注入 `slots`、`locale`、`sidebarRightTabs`、`remote` 与 `remote.terminals`；Node 半边是一个不产生任何行为的 Loader 座位。

<a id="the-emulator-and-the-process"></a>
## 模拟器与进程

正文恰好拥有一个模拟器和一个 Host 终端，其 effect 以标签页记录的 `signal` 为键——而不是以标签页值为键，后者会在布局变化（焦点切换、展开）时改变身份。因此，只要标签页保持打开，进程就能在所有布局变化中存活：

- **挂载**时通过注入面按模拟器当前网格（全新 xterm.js 中为 80x24）进行分配，随后跟踪返回终端的帧。被拒绝的分配会渲染为一行状态，且没有需要关闭的东西。
- **隐藏但不关闭**会同时保留模拟器与进程：面板未激活时标签页仍处于挂载状态，因此切换标签页永远不会重启 shell。
- **卸载**会关闭 Host 终端、中止流、断开尺寸观察器、释放模拟器的输入监听并销毁模拟器。因此关闭标签页会结束它的进程。

窗口尺寸跟随宿主盒子，而不是相反。`ResizeObserver` 运行 `FitAddon.fit()` 并把得到的 `cols`/`rows` 发给 Host，这正是把平台尺寸变更通知投递给 shell 前台进程组的机制。折叠或尚未完成布局的宿主盒子不做任何测量，因此隐藏的面板永远不会向 addon 索取零尺寸网格。

<a id="reading-and-writing"></a>
## 读取与写入

Host 是屏幕的唯一写入者。按键作为输入发出，绝不在本地回显，因此读者看到的是 shell 实际发出的内容，而不是第二份产生分歧的渲染；Host 拒绝的写入表现为流结束，而不是一个组件无从等待的 rejected promise。输出帧携带 base64 编码的字节，因为 JSON 载体没有字节串，正文把它们解码回字节交给模拟器，从而让转义序列、光标移动和不完整的 UTF-8 序列原样保留。

已结束或已失败的终端会在模拟器下方渲染一行文字，指明退出码、信号或底层错误消息；被自身标签页记录取消的流不显示任何内容，因为那次取消是该 effect 自身的清理，而不是失败。

从 Remote 取得的注入面会把每次调用都指向构建该工厂时所针对的会话，因此一份注册即可服务每个会话中的每个终端标签页。

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册工具、不贡献提示词片段，也不追加会话事件。

#### KV Cache 影响

无；用户在该终端中输入或读取的任何内容都不会进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>
- **刷新不会保留任何终端状态。** 每个标签页都是一个只存在于进程内的 Host 终端；刷新页面或重新打开标签页会开启新的 shell 和空白屏幕。没有重新接入、没有回滚重放，已退出的终端上也没有重启控件。
- **使用模拟器默认主题。** 模拟器在构造时没有传入主题对象，因此沿用 xterm.js 自身的调色板，不跟随应用的 `--dsw-*` token。接入主题是被延期，而非被否决。
- **每个标签页一个终端，不共享。** 两个查看者看同一个终端会把同一条字节流拆给两个模拟器，因此该标签页类型不提供扇出、镜像或分屏视图。
- **约束来自会话策略。** Host 提供方通过会话的沙箱策略约束进程，并在 `danger-full-access` 会话中不加约束地运行；本包既不扩大也不缩小该范围。
- **自身没有剪贴板集成。** 选择、复制与粘贴使用浏览器和 xterm.js 的默认行为；本包不添加复制按钮，也不拦截粘贴。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 未发布伴生包。正文只持有每次出现对应的模拟器状态，且各注册由插件 fiber 拥有，因此没有可对比的独立运行时来源；注册释放与标签页生命周期由行为测试覆盖。
