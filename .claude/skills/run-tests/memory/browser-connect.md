---
name: browser-connect
description: Chrome DevTools MCP 连接 / 复用 / 僵尸进程清理 / 手动 headless 验收浏览器纪律 / 点击穿透取证
metadata:
  type: recipe
  last_verified: 2026-10-31
---

# 浏览器连接

Chrome DevTools MCP 首次调用自动启动 Chrome，后续复用。

## 步骤（按序尝试）

1. `new_page` 打开目标 URL — 多数直接成功
2. 报 "browser already running"（上个会话 Chrome 还在）→ `list_pages` 能连上就复用：`close_page` 关多余页，或 `navigate_page` 导航到目标 URL
3. `list_pages` 也连不上（MCP 报 profile 被占且无法复用）→ 按 PID 清理旧自动化 Chrome 后重试 `new_page`：
   ```bash
   pgrep -fl 'user-data-dir=.*chrome-devtools-mcp/chrome-profile'   # 确认是自动化实例（--enable-automation 特征）
   kill <主 Chrome PID>                                             # 按 PID 杀，禁全局 pkill（防误杀生产）
   ```

## 坑

- **`navigate_page reload` 偶发丢 page** — 改用 `new_page` 重新打开 URL，或 `list_pages` 确认后 `select_page`
- **Codex 内置浏览器隐藏时可能吞掉键盘输入** — 使用 CUA 操作登录框或编辑器前，先通过浏览器的 `visibility` capability 将窗口设为可见。隐藏状态下点击仍可能成功，但输入不会落入控件；设为可见后再执行点击、全选和输入。
- **MCP `click` 的落点诊断（点击穿透类 bug 取证）** — click 命中哪个元素有歧义时（如叠层图标吞点击），先在 `evaluate_script` 里挂 document 级捕获监听记录 `pointerdown/mousedown/click` 的 target，再 `click`，读回记录即可实锤真实命中链。`elementsFromPoint` 只给静态叠层序，事件监听才证明运行时命中。合成事件（`dispatchEvent`）不触发 `:hover`/CSS 状态，验 hover 交互用 `hover` 工具先行。React 受控 input 设值用 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call()` + `input` 事件（直接赋值不触发 React onChange）。
- **React onClick 后 DOM 断言要等动画** — AnimatePresence/motion 的 exit 动画期间旧节点仍在 DOM，「点删后数量没变」可能是查早了；断言前 `setTimeout` ≥400ms 或等 a11y 快照稳定。

## 手动起 headless 验收浏览器（独立 profile / 调试端口）的纪律

动效采样、reduced-motion 两档、production 构建验收需要独立实例时，会话手动 `&`/`nohup` 起
`--headless=new --user-data-dir=/tmp/<名字> about:blank`。**坑（2026-10-31 实锤，两起事故）**：
后台化脱离启动 shell，会话结束即孤儿（PPID 1），里面留着的 mobi E2E 页面（SSE 重连 +
流式定时器）能烧 15% CPU + 800MB 渲染器撑几周，Activity Monitor 才看得见。

- **收尾必清扫**：跑 `bash .claude/skills/run-tests/scripts/sweep-verify-browsers.sh`
  （判据：命令行含 `--headless` + `--user-data-dir=/tmp/`，逐 PID 验证是 Google Chrome 再杀）；
  e2e-cleanup.sh 的 3.6 步已挂，cleanup 即自动收
- **杀进程用 `/bin/kill`**：沙箱内 bash 内建 kill 会假成功（exit 0 但信号未送达，实测）
- **验死活用 `ps -p <pid> -o stat=`**：ps 管道计数会被 Bash 包装进程自己的命令文本污染
