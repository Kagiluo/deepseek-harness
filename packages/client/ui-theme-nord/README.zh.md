---
description: "桌面内置主题插件：把 Nord 亮/暗配色作为十个可调色址派生整套别名 token 层，附带存储的背景图片，以及「设置 → 插件」中的调色面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-theme-nord

[English](README.md) | 中文

## 概述

`dsh-client-ui-theme-nord` 是桌面应用自己的外观：一套亮/暗配色加上一张背景图片，都在「设置 → 插件」的同一个标签页里编辑。十个色址——底色、三层表面、文字、两个品牌色，以及三个状态色——驱动 ui-theme 样式表声明的每一个 `--dsw-alias-*` 与 `--dsw-specific-*` token，因此调整一个色址会移动所有读取它的表面。浏览器半部把该派生结果叠加在 `ctx.theme` 上；Host 半部声明调色面板的 `Config`，并把选中的图片存到 Harness home 下。

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

打开「设置 → 插件」，选择 Nord 配色标签页。每次修改都会立即预览——十个颜色随拖动取色器重排 token 层，整个窗口随之变化。保存之前不会写入任何内容，放弃修改会丢弃草稿；恢复默认则把单个色址或全部十个色址恢复为组合的默认值。

### 挂载方式

桌面组合通过运行时侧覆盖文件（`apps/desktop-host/config/desktop.cordis.patch.yml`）挂载该行，其 `insert` 行按裸包名从打包后的运行时解析：

```yaml
- insert:
    - id: ui-theme-nord
      name: '@deepseek-ai/dsh-client-ui-theme-nord'
```

调色面板的取值位于该行的条目 id `ui-theme-nord` 之下：设置服务以插件 Loader 条目所挂载的 id 提供其 `Config` 表单，浏览器半部通过 `ctx.configForms` 读取该表单。组合可以通过该行的 `config` 提供这十个色址；未写入的设置文档解析到 schema 声明的 Nord 配色。CLI 或 Web 组合可以通过 profile bundle 或 `--patch` 覆盖文件挂载同一行。本包没有声明 `dsh.bundle`，因为它不是 profile bundle：该行直接指名它。

### 背景图片

「选择图片」打开操作系统的文件对话框，并把选中的文件按内容哈希存到 Host。不透明度滑块决定应用底色表面让出多少透明度；卡片、菜单等上层表面保持不透明，因此文字对比度不受影响。移除图片会让底色表面回到配色颜色。图片引用与其他改动一起写入，因此被放弃的选择只会留下一个无人引用的文件，而不会留下错误的背景。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

配色是每个色彩方案十个色址，每项一个亮色值和一个暗色值。`buildTokens` 由它们派生出完整的别名 token 表；`ctx.theme.overrideTokens` 在 `ctx.effect` 中叠加结果，因此卸载插件会恢复内置配色。调色面板的控制器持有一份暂存草稿：每次修改都重建该层，而设置文档只在保存时写入。设置表单仍是权威——控制器从表单读回被接受的值，而不是自行预测；角色修改以该角色 `light`/`dark` 叶节点的原子 mutation 写入，因为角色是嵌套对象而非顶层字段。

背景图片以字节形式存放在 `$DSH_HOME/theme-wallpaper/{sha256}`，并有一个 `.type` 兄弟文件；设置文档只携带哈希与媒体类型，因此设置链路上从不传输图片字节。字节以 base64 跨越 Remote 边界，因为该边界只承载 JSON；存储把单张图片限制在 8 MiB，只接受浏览器可显示的媒体类型。背景由两层绘制：持有配色底色的不透明底板，以及其上方按暂存不透明度绘制的图片。底色表面 token 恰好让出该不透明度，这正是图片能透过外壳框架显示、而上层表面仍保持不透明 token 的原因。

### 为何用覆盖层而不是注册主题

`ctx.theme.register()` 会新增一个具名主题，但第三方主题 id 不经过内置设置 schema，因此「外观」控件无法选中它。覆盖层改为叠加在用户选中的任一内置主题之上，并通过每项的 `colorScheme` 提供对应值，这也是本包覆盖两套配色而非一套的原因。

### 完整 token 覆盖

`buildTokens` 为 ui-theme 别名样式表声明的每个 token 都带有一项，因此配色是完整的而非部分的。Aurora 色相原样达不到文字对比度，因此三个状态族在亮色配色下使用加深变体、在暗色配色下使用变浅变体；对已发布配色的这一偏离是刻意的。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面是本源插件所扩展各层的归属地。

- [ui-theme](../ui-theme/README.zh.md) — 拥有 `--dsw-*` token 样式表，以及本源插件叠加覆盖层的主题注册表。
- [ui-settings](../ui-settings/README.zh.md) — 拥有本插件调色面板读取的 config forms 服务，以及它填充的插件标签页 slot。
- [file-upload](../file-upload/README.zh.md) — 另一个把浏览器半部与 Host Remote 贡献配对的客户端包。
- [Web styling](../../../docs/web-styling.zh.md) — 客户端样式表与 token 的权威规则。
- [Desktop application](../../../apps/desktop/README.zh.md) — profile、运行时闭包与内置行的组合方式。

-----

<a id="model-experience"></a>
## 模型体验

无。本包是浏览器侧外观层，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


以下限制界定了本插件声称拥有的范围。它们是当前的包约束，不是任务清单。

- **十个色址，而非全部 token** — 配色未命名的值（遮罩蒙层、媒体工具栏色块与 mask 渐变）在两套配色中都保持字面值；新增一个意味着增加一个色址及其派生，而不是一个一次性 token。
- **语法高亮不跟随** — ui-theme 的 shiki 样式表只别名了代码块背景与前景；其 `--shiki-token-*` 是字面值，因此高亮 token 保持内置颜色。
- **无人引用的图片可能比它的选择活得更久** — 存储按内容哈希寻址且从不回收，因此被放弃的选择会把字节留在 `$DSH_HOME/theme-wallpaper` 下，直到再次选中同一张图片或运维人员手动删除。
- **存储的图片通过一次 Remote 往返读回** — 放弃选择后恢复原存储图片会重新读取其字节而不是缓存它们；图片文件缺失时报错，而不会退回配色颜色。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

Host 半部是类插件：它声明调色面板的 `Config`（色址与背景图片字段全部 volatile，因此设置服务把它们暴露为可编辑字段），并因其标签页自带布局而退出自动表单；它还提供 `themeWallpaper` Remote 命名空间，由 `packages/api/remotes` 为应用的客户端装配挂载。

</details>

**运行时不变式：** 不发布伴随文件。控制器每个实例只叠加一个覆盖层，并在 dispose 时证明其释放；Host 回报它接受了什么，因此被拒绝的写入会作为未保存草稿保持可见。
