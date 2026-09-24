# Agent Note: Sidebar 默认页顺序

Status: implemented

[English](2026-09-13-sidebar-default-page-order.md) | 中文

## 问题

[既有的选择规则](2026-09-08-sidebar-default-pages.zh.md)会直接打开唯一注册的引导入口，而一旦第二个类型贡献入口，就回退到引导页。因此，把 Terminal tab 加进右侧 Sidebar 会改变每一列打开时显示的页面：原本总是收到工作区文件树的格，改为收到引导页，并且同时失去条带上的新增控件，因为持有引导页的格不绘制该控件。一扇新门替换掉了用户本已拥有的界面。

## 决策

默认页是 order 最小的已注册引导入口；只有当没有任何类型贡献入口时才打开引导页。order 本就是引导页的列示位置，因此组合希望列在第一位的入口，正是其各列所打开的入口。随包组合保持原有页面不变：files（order 10）仍打开新格，terminal（order 20）只增加一扇门而不挤占它。入口数量不再参与决定。

选择逻辑仍留在 `defaultSeed`，它读取注册表中已按 order 排序的引导列表；选中的 kind 若无人注册，仍会明确报错。

## 考虑过的替代方案

**只要存在多个入口就打开引导页。** 已否决：这样一新增页面类型就会改变每一列打开的页面；而且由于以引导页打开的格不绘制新增控件，用户会在同一步里既失去文件树，也失去通往引导页的入口。

**写死 files 为默认页。** 已否决：这会把某个插件的 kind 写进 Sidebar 自己的选择规则，而省略该类型的组合将完全无法播种默认页。

**不把终端放上引导页。** 已否决：引导页是页面类型唯一的门，没有入口框的 tab 类型无法被打开。

## 后果

该规则读取的是各贡献类型本就会为引导页列示设置的值，因此组合只需对它的各扇门排序一次，默认页与列表便得到同一顺序。贡献多个入口的类型，以其中 order 最小的那个作为默认页。

默认页不再能从入口数量读出，因此若组合希望引导页打开新列，就必须完全不贡献入口。

## 测试

[`tab-registry.client.spec.ts`](../../../../packages/client/ui-sidebar-right/tests/tab-registry.client.spec.ts) 覆盖三种结果——无论注册顺序如何都取 order 最小的入口、只有一个入口、以及没有入口时取引导页——并与未注册 kind 的报错并列。[`seat.client.spec.tsx`](../../../../packages/client/ui-sidebar-right/tests/seat.client.spec.tsx) 在真实插件之上驱动已就座的列，覆盖零个、一个和两个入口。[`sidebar-right.e2e.ts`](../../../../apps/web/tests/sidebar-right.e2e.ts) 保持它在已确定会话与重新加载后对 Files 的断言，使随包界面在用户可见处保持锁定。

## 相关

- [Sidebar 默认页](2026-09-08-sidebar-default-pages.zh.md)——本笔记取代的选择规则；其关闭保护归属与每格至多一个引导页的规则继续有效。
- [Sidebar 与预览交互打磨](2026-09-09-sidebar-and-preview-interaction-polish.zh.md)——展开时惰性播种，未变。
- [Sidebar 文本预览与文件树](2026-09-05-sidebar-text-preview-and-file-tree.zh.md)——本规则在其中做选择的页面类型模板。
- [Web sidebar 终端](2026-09-09-web-sidebar-terminal.zh.md)——贡献第二扇门的那个 tab。
