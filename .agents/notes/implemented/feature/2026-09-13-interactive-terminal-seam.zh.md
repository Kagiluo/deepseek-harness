# Agent Note：由浏览器驱动的交互式终端作为一个归会话所有的 seam

Status: implemented

[English](2026-09-13-interactive-terminal-seam.md) | 中文

## 问题

Web 客户端此前没有终端。想要一个 shell 的用户只能请模型去执行命令并读取渲染后的结果，而这对探索来说是用错了工具：模型不知道用户接下来会输入什么，而渲染后的输出丢失了终端模拟器所需的转义序列、光标移动和不完整 UTF-8 序列。

既有的终端能力 `ctx.terminals` 无法服务浏览器。它由确切的 `Agent` 拥有（用户界面没有 Agent），通过有界的回滚分页返回净化后的渲染文本，一次只接受一个独占的、按行组织的发送，执行用户并不希望在每次按键之间发生的就绪检测，并且完全没有窗口尺寸变更操作。把它扩展到同时为归会话所有的消费方携带原始字节，会让一个 Context 键承载两份互不兼容的声明，也会让一个服务背负两套互不兼容的归属规则。

## 决策

交互式终端是第二个能力 seam，具备全部三种角色和一个浏览器消费方，分布在四个包中：

- `@deepseek-ai/dsh-terminal-interactive`——Service Definition。位于 `ctx.interactiveTerminals` 的 `InteractiveTerminalService` 铸造不透明终端 id，把分配路由到已注册的提供方，把消费方接入之前产生的输出保留在有界队列中，并等待清理静默完成。owner 是确切的 `Session`；id 是 branded 的。
- `@deepseek-ai/dsh-terminal-interactive-local`——随附的 Provider，类型为 `shell`。它通过 subprocess 终端原语为每个终端分配一个交互式 shell，运行在拥有该终端的会话按策略解析出的工作区根目录中，并在该会话模式不是 `danger-full-access` 时由 `ctx.sandbox` 施加约束。
- `@deepseek-ai/dsh-api-terminal-controller`——Consumer 与 Typert Remote。它以 `terminals` 线上命名空间把该 seam 带给浏览器，为 JSON 载体把原始字节做 base64 编码。Cordis 键是 `terminalController`，因为 `ctx.terminals` 已经命名了面向模型的服务。
- `@deepseek-ai/dsh-client-ui-terminal`——浏览器消费方：右侧栏中 kind 为 `terminal` 的标签页类型，其正文是一个 Host 终端之上的单个 xterm.js 模拟器。

该 seam 的四个性质源于其消费方是模拟器而不是模型：

**原始字节，而非文本。** 帧在进程内携带 `Uint8Array`，在线上携带 base64。任何渲染或净化输出的环节，都必须由另一侧的模拟器再撤销一次。

**归会话所有。** 每次操作都以拥有该终端的确切 `Session` 作为隔离依据，`closeOwner` 会释放某个会话的终端。终端所跨越的是会话的结束，而不是 Agent 的结束。

**每个终端一个消费方。** 同一条字节流上的两个 generation 各自会绘制出不同且已损坏的终端，因此第二次 `frames` 调用会以 `OUTPUT_ACTIVE` 失败。该 generation 的 signal 中止时槽位即被释放，这正是重新连接的消费方能够接管的原因。

**带单向背压的保留。** `open` 返回身份，消费方随后才打开流，因此这期间产生的输出必须被保存。已保留字节由 `maxBufferedBytes` 限定；预算用尽后生产方等待，而消费方永远不会被阻塞。

为此 subprocess seam 增加了一个操作：`SubprocessTerminalHandle.resize(cols, rows)`，它变更终端的窗口尺寸并把平台的尺寸变更通知投递给前台进程组。两个提供方都实现了它——本地 PTY 句柄基于 node-pty，E2B 句柄基于 `sandbox.pty.resize`。没有它，模拟器的 fit 就无法到达 shell。

## 考虑过的备选方案

**扩展 `ctx.terminals`。** 上文已否决：这会把归 Agent 所有、按行组织、返回文本的语义与归会话所有、面向字节、感知尺寸变更的语义塞进同一个 Context 键，而每个消费方都不得不分辨自己用的是哪一半。

**独立的 Electron 或 `node-pty` 伴随应用。** 产品本身就是 Web 与 Desktop 客户端；第二个应用会重复会话选择、工作区策略和沙箱提供方，而且无法从用户已有的标签页中访问。

**在 Host 上渲染终端并流式传输文本或屏幕图像。** 两者都破坏了模拟器所消费的内容，而屏幕图像传输的数据量远大于它所替代的转义序列。

**把模拟器的回滚内容留在 Host 上以支持重新接入。** 保留队列是有意为之且有界的；重新接入缓冲区会成为由 Host 进程拥有的、每个终端输出的第二份无界副本，对于一个随用户关闭而关闭的标签页来说并不值得。

**用一个包同时承载定义、提供方和 Remote。** 这些角色各自独立演进：其他部署需要不同的底层（E2B 家族已经为 subprocess 终端提供了这样一个底层），而 Web 打包希望提供方那一行可以替换而不触动线上约定。

## 后果

与 `ctx.terminals` 一样，交互式终端只存在于进程内，不会在 harness 重启后存活。它们对模型完全不可见：不追加任何事件，不注册任何工具，用户输入的字节也绝不进入模型请求——这正是这四个包被审计为没有模型体验的原因。

随附的本地提供方加载用户的 shell 启动文件（`bash -i`、`pwsh -NoLogo`），而不是面向模型后端的非交互式参数集，因为别名、提示符和补全正是一个用户终端存在的意义。这些启动文件在受约束的 argv 下运行，但自身仍可能通过 shell 访问工作区之外的内容，这是各包 README 已声明的限制。

Desktop 与 Web profile 通过 `packages/bundle/web-app/cordis.patch.yml` 挂载全部四行，因此无法承载 PTY 的部署可以移除提供方那一行，此后该 seam 的每次 `open` 都会以 `NO_PROVIDER` 失败，而不是在加载时失败。

浏览器只能通过客户端装配体访问命名空间：`packages/api/remotes/src/client/index.ts` 挂载每一个被选中的 `/remote` 贡献，因此仅有 Host 侧那几行还不够。某个命名空间若不在该列表中，其消费方就会一直停留在 `remote.terminals` 上等待，客户端的启动检查会报告该未激活条目，而不会渲染终端。

## 测试

`dsh-terminal-interactive` 直接覆盖 `FrameBuffer`（保留、单消费方槽位、背压、终结帧），并通过真实 cordis Context 配合桩提供方覆盖服务（发布顺序、异主隔离、重复提供方、close 合并、owner 清理、释放失败、`OUTPUT_ACTIVE` 规则）。`dsh-terminal-interactive-local` 覆盖方言解析、各沙箱模式下的 argv 约束、环境变量层，以及会话的结局与关闭映射。`dsh-api-terminal-controller` 覆盖 base64 编码与各方法转发的参数。`dsh-client-ui-terminal` 在替身模拟器之上驱动正文：按模拟器网格分配、Host 字节上屏、按键回送为输入、fit 驱动的尺寸变更、每种失败提示，以及关闭进程的清理。

## 相关

- [持久 PTY Agent Note](2026-07-16-persistent-pty-sessions.zh.md)——本 seam 刻意不去扩展的、面向模型的 seam。
- [终端子系统参考](../../../../docs/subsystems/terminal.zh.md)——两个 seam 的词汇与生成的服务接口面。
- [能力 seam](../../../../docs/capability-seams.zh.md)——这四个包遵循的 Service Definition / Provider / Consumer 拆分。
- [dsh-terminal-interactive README](../../../../packages/terminal/terminal-interactive/README.zh.md)——该 seam 的配置、操作与限制。
