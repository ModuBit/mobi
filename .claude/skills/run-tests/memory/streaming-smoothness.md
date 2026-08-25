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

## 基线（2026-08-25 实测，多步工具流式 prompt，60Hz）

- 优化前（50ms 节流）：91% 步间隔 35-68ms、85% 步长 21-60 字符；帧率满 60fps（不卡但阶梯）
- 优化后（增量 Markdown + 每帧更新）：90% 步间隔 <17ms、92% 步长 ≤8 字符；p99 帧 33ms / max 100ms（长文 2500 字压测无回退）

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
