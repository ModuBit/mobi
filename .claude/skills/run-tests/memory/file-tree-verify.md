---
name: file-tree-verify
description: 文件树 E2E — 打开 inspector 文件树 + 验证目录条目数/截断
metadata:
  type: recipe
  last_verified: 2026-08-05
---

# 打开 inspector 文件树 + 验证条目数

## 打开文件树

1. 会话页右上方 SessionContextBar 的 `right` 槽有「展开检视面板」按钮（`PanelRight` 图标，仅 `!expanded` 时渲染）。**无 aria-label**，靠图标 + tooltip `session.inspector.expand`。定位法：找 `ant-btn-text` 里只含一个 svg、无文本、且在 header 区的按钮，`.click()`。
2. 面板展开后出现 tab 行，点 `Open File` tab（`role=tab`，name="Open File"）即出文件树。
3. 展开目录：`click` 对应 `treeitem`（`expandAction="click"`，点节点标题即切换展开，不必点 caret）。

## 验证条目数 / 截断（虚拟滚动下不能数 DOM）

虚拟滚动开启后（`virtual=true`，见下）DOM 里只有可视区 ~20-30 节点，**不能靠 `querySelectorAll('.ant-tree-treenode').length` 数总数**。三选一：

- **首选 — 看 network 响应**（观察真实流量，非注入）：`list_network_requests` 过滤 `list-directory?path=<dir>`，`get_network_request` 取响应体，数 `entries.length` + 看 `truncated` / `total` 字段。这是最可靠的「后端实际返回多少」证据。
- `aria-setsize`：specs 子 treeitem 的 `aria-setsize` = 同级总数（但虚拟滚动下子项可能未渲染，需先滚到该目录）。
- 滚动收集：在树内滚到底，收集出现过的 title，去重计数（麻烦，少用）。

## 虚拟滚动是否启用

`document.querySelector('.ant-tree-list')` 存在 = antd Tree virtual 已开（rc-virtual-list）。逻辑节点远多于 DOM 节点（如 120 逻辑 vs 32 DOM）即证只渲染可视区。

## 坑

- **展开检视面板按钮无 aria-label** — `take_snapshot` 里是个无文本的 svg button，别找不到。用 evaluate_script 按「type=text + 只含 svg + 在 header」定位。
- **path 走 PathCascader 全路径输入** 见 [[create-session]]（Escape 确认，别 Enter）。
- **permission 弹窗会挡** — 会话发首条消息后 SDK 可能弹 tool permission，先 `Allow this session` 放行再操作文件树。
- 截断提示节点（`truncated:true` 时目录末尾挂）只在 >2000 条目目录才出现，单测已锁，E2E 一般不造这种目录。
