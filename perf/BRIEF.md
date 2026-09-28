# 性能冲刺简报：mobi Web

> 方法论来源：《How we made claude.ai 3x faster in two weeks》（Anthropic, 2026-09）。
> 核心纪律：只要能把一件事量出来，就能把这件事变快。先测基线，再爬山，赢下来的用棘轮锁住。

## 你的职责

负责 mobi Web 打开和使用的速度：先测基线，再一步步优化，每一步都用测量证明，
赢下来的用棘轮锁住。主动提出改进，但用户看得见的变化和上线由人决定。

## 核心操作与「能用」的定义

mobi 是自托管局域网 App（浏览器 ↔ Hub 同机房/同机），网络往返 ~1ms，
首屏瓶颈在 JS 执行而非传输——因此结论口径不做网络限速，用 CPU 限速看低配机器。

| 操作 | 页面 | 起点 | 终点（真的能用） | 判定表达式要点 |
|---|---|---|---|---|
| 打开会话列表 | /sessions | 导航开始 | 列表行可见（目标会话名出现在页面文本中，且不在 /login） | `!location.pathname.startsWith('/login') && document.body.innerText.includes(<会话名>)` |
| 打开会话 | /sessions/:id | 导航开始 | composer 输入框真的能输入（渲染且可见），且会话内容出现——骨架屏/空壳不算 | `textarea.offsetParent !== null && document.body.innerText.includes(<会话名>)` |

判定表达式的权威实现在 `bench/bench.mjs` 的 `TARGETS`，改口径必须同步改这里。
判定用「会话名出现在页面文本」而不是 UI 文案/i18n 键，避免文案改动破坏测量。

骨架屏、占位图、没有事件响应的空壳不算能用（`offsetParent !== null` 挡掉隐藏态）。

## 不能动的东西

- 视觉：光/暗主题、布局、交互行为（优化前后需视觉一致，护栏阶段截图比对）
- 功能：消息收发、审批流、工具卡片渲染等全部行为
- 文案：i18n 文案不得为了「看起来加载快」而提前或删减

## 目标

- 首期（本阶段）：建立基线——`perf/基线.md` 记录两个核心操作在 lan / cpu4 两档的
  p50/p75/p95，以及确定性计数（长任务、样式写入、querySelectorAll、CLS）。
- 后续：每次优化以「目标操作 p75 降幅」为目标，逐条记录在 `perf/实验日志.md`。

## 测量口径

- 主口径 `lan`：真实局域网（不限速），CPU 不限速——用户实际体感所在档
- 慢机档 `cpu4`：CPU 4 倍限速——看低配电脑上的体感（mobi 瓶颈在 JS 执行，此档关键）
- 冷缓存：每次测量用全新浏览器上下文（bench 已实现）
- 每组至少 10 次，报 p50/p75/p95，不报平均数
- 前后对比必须配对测：两个版本同时起服务，A、B、A、B 交替跑
  （`bench.mjs --url-b` 即配对模式）
- 被测服务用 prod 构建（`bun run build` + `MOBI_API_URL=<hub> vite preview`），
  dev server 未压缩未摇树，数字不代表生产

## 确定性计数（每步优化的闸门）

真实耗时噪音大，适合当结论；每一步的闸门看这些确定性计数（bench 自动采集）：

- `longTasks` / `longTaskMs`：主线程长任务（>50ms）次数与总时长
- `qsa`：`querySelectorAll` 调用次数（ready 时刻快照 + 终态各一份）
- `styleWrites`：`CSSStyleDeclaration.setProperty` 调用次数
- `layoutShifts` / `layoutShiftScore`：CLS 布局抖动（Layout Instability API）
- `lcp`、资源请求数与传输字节、DOM 节点数

每个代理计数要证明自己：至少两次改动里，计数降了，真实耗时也跟着降。证明不了的不用。

## 棘轮

`bench/ratchet.mjs` 对照 `bench/caps.json`（当前 p75 上限），只许降不许升；
超限退出码 1，供后续接入 CI。`--update` 刷新上限（需在确认无退化时手动执行）。

## 上线与回滚

- web 产物随 CLI 二进制分发（构建链路见根 CLAUDE.md），上线即用户批准
- 每次优化一个 commit，一个问题一个回滚单位
- 用户看得见的变化（预览时机、加载样子、动画）附前后录屏/截图，由用户拍板
