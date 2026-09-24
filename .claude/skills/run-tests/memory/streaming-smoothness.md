---
name: streaming-smoothness
description: 流式丝滑度采样 — rAF 探针量化揭示节奏（间隔/步长分布）、A/B 对比基线、触发 prompt、E2E 环境 HMR 复测
metadata:
  type: recipe
  last_verified: 2026-08-25
---

# 流式丝滑度采样（揭示节奏 profile）

「不丝滑」≠「卡顿」：帧率满血也可能不丝滑——瓶颈在**揭示节奏**（间隔/步长分布）。
采样目标：display 内容长度随时间的变化序列，而非帧耗时。

## 探针（发消息前装）

```js
window.__samples = []; window.__stopProbe = false;
const tick = (now) => {
  if (window.__stopProbe) return;
  let total = 0;
  document.querySelectorAll('.x-markdown').forEach(n => { total += n.textContent.length });
  window.__samples.push({ t: Math.round(now), n: document.querySelectorAll('.x-markdown').length, len: total });
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

结束后分析：提取 len 变化的「揭示步」（dt = 与上一步的间隔、d = 步长），统计两分布：
- 步长分布桶：1-3 / 4-8 / 9-20 / 21-60 / >60（字符）
- 间隔分布桶：<17 / 17-34 / 35-68 / 69-150 / >150（ms；17ms=60fps 一帧）
- 帧率：活动窗口内相邻帧 gap 的 avg/max/p99（区分渲染卡顿与揭示阶梯）

## 判读

| 形态 | 含义 |
|---|---|
| 间隔集中 35-68ms + 步长 21-60 | 20fps 阶梯（节流型不丝滑，2026-08-25 优化前基线） |
| 间隔 <17 占比 >90% + 步长 ≤8 | 每帧连续流动（优化后形态） |
| 帧率 avg >20ms / max 频繁 >100 | 渲染卡顿（另一类问题） |
| 少量 >150ms gap + >60 步 | snapshot 批次边界 / turn 切换，正常 |

## 基线（历史演进，60Hz，多步工具流式 prompt）

- 优化前（50ms 节流）：91% 步间隔 35-68ms、85% 步长 21-60 字符；帧率满 60fps（不卡但阶梯）
- 双段增量渲染（2026-08-25，**已于 08-26 废弃**）：90% 步间隔 <17ms、92% 步长 ≤8 字符；p99 帧 33ms / max 100ms。双段因整块闪烁 + 跨容器间距断裂 + 结构复杂度被回退
- **单段 + 长度自适应节流（2026-08-26 起，现行）**：<4k 字符每帧揭示（中位 ~17ms）；>4k 进 32/48/64ms 档（revealIntervalFor）把单段全量 re-parse 成本封顶；6000 字实测帧 avg ~25ms（含探针开销）、结构恒单段、无闪烁签名

## 触发流式的 prompt

- 多步工具（连续增长 20s+）：见 [[scroll-follow-verify]]（「每执行完一条都简单说一句结果」，要长解释就改成「用三到四句话详细解释」）
- 长文压测（最重 parse 场景）：`不要使用任何工具。直接写一篇约 2500 字的技术散文，主题是「…」，分多个小节，包含代码示例、列表、表格和引用。一次性完整输出。` —— glm 实测会产生持续 snapshot 流式（非一次性），是每帧更新的重负载用例
- **「写一篇长文」可能不逐 token**（一次性到达）——见 [[scroll-follow-verify]] 坑；上面带小节/代码/表格要求的长 prompt 实测有流式

## 流程要点

1. e2e 环境是 vite dev：**改完代码 reload 页面即测 B 轮**（HMR 生效），无需重启环境
2. 探针要在发消息**前**装
3. 多步工具轮结束可能弹 change_title 审批卡住 turn——先 Allow this session 再继续
4. 贴底跟随会拉回程序性滚动（scrollTop/scrollIntoView 测中间内容会被钉回底部）——视觉验证收尾态即可；结构完整性用 DOM 查询（pre/table/ol/h2 计数）代替滚动截图
5. `.x-markdown` 是嵌套结构（Markdown 外壳 div + XMarkdown 内部 div 各一层）——querySelectorAll 会抓到两层同 textContent，**不是重复渲染**；按 parentElement 链判别

## 扫光归因修正（2026-09-21，受控实验）

- **帧间隔分桶坑**：17ms 正常帧会落进「17-34」桶——按桶占比判断掉帧会把 60fps 误读成掉帧，判读必须看 p50/p95 数值而非桶名
- **受控交错实验**（on/off/mask/pulse 交替 3.5s 窗、同文本量对比）：桌面端 background-clip 扫光与无扫光帧率**无差异**（p95 均 18-19ms）——「扫光导致流式掉帧」的早期归因**不成立**（分桶误读 + 阶段混杂）
- **6x CPU throttle 关键发现**：流式期间帧间隔 300-800ms，**与扫光开无关**——瓶颈是 XMarkdown 长文整段重解析本身，不是扫光。移动端流式卡顿的正解是降解析成本（拆段/增量/缓存），换扫光实现救不了
- 探针采样窗口必须覆盖目标负载期：节流下流式全程变长，sleep 后再采样常采到流结束后的空闲期（n=174/3.5s=17ms 间隔即空闲特征）

## 长任务 A/B 归因（2026-09-24，fence 高亮成本）

量化「某类内容对流式的阻塞贡献」：同长度两轮 turn 只差一个变量（如含/不含代码块），longtask PerformanceObserver 按发送时刻 `performance.now()` 过滤窗口，比阻塞总时长 / 占空比 / max。配合 `emulate` 工具 cpuThrottlingRate:6 模拟移动端——**桌面无 throttle 流式几乎零长任务，结论只在 throttle 下成立**，先想清楚目标设备再定是否 throttle。

- 探针：`new PerformanceObserver(l => …getEntries()…).observe({type:'longtask',buffered:true})`，条目存 `[startTime,duration]`；startTime 是 time origin 起算，**发消息前打的探针也会收到打字期任务**，窗口过滤必须以发送时刻为准
- 空闲态有每 ~10s 一次 ~50ms 周期长任务（来源未定位），A/B 时两轮同受污染，差值仍有效
- 实测结论：6x throttle 下 2500 字流式，含 4 代码块 vs 不含：长任务 133 vs 77、阻塞 21.9s vs 11.4s、最差停顿 1081ms vs 346ms——fence 重高亮是移动端流式卡顿主因
- `window.__mobiPerf.getShifts()`（layout-shift 观测器）在流式全程零位移，探针可用但聊天流恒真
