---
name: flicker-regression
description: 流式渲染闪烁回归探针 — textContent 长度回退的比例判读、语法字符假阳性、单段结构不变式（2026-08-26 起单段架构）
metadata:
  type: recipe
  last_verified: 2026-08-26
---

# 流式闪烁回归探针

验证「流式 markdown 整块闪烁」类回归。**2026-08-26 起流式渲染为单段架构**
（双段拆分已整体移除，见 [[streaming-smoothness]]）：全程每条消息恒 1 个内层
XMarkdown，任何双段结构出现即回归。

## 探针（发消息前装）

```js
window.__flick = { samples: [], stop: false };
const tick = (now) => {
  if (window.__flick.stop) return;
  const tops = Array.from(document.querySelectorAll('.x-markdown'))
    .filter(el => !el.parentElement.closest('.x-markdown'));
  let total = 0;
  for (const t of tops) total += t.textContent.length;
  const inner = tops.reduce((a, t) => a + t.querySelectorAll('.x-markdown').length - 1, 0);
  window.__flick.samples.push({ t: Math.round(now), total, n: tops.length, inner });
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
```

单段架构下 `inner` 恒为 0（每消息 `内层数 - 1 = 0`）；**inner > 0 = 出现了多余的分段渲染**。

## 判读（2026-08-26 单段架构实测，6000 字长文）

- **大比例回退（>20%）**：两类来源——①AnimationText 空帧整块重建（真闪烁）；
  ②**源内容替换**（模型重启文本、snapshot→full message 收敛、message 重排）——
  判别法：看回退后 total 是否从低值重新增长（源替换）vs 迅速恢复原值（渲染抖动）
- **小回退（≤2 字符）= 假阳性**：markdown 语法字符（`**`/`|`/`#`）在强调/表格/
  标题完成瞬间从渲染文本消失，正常现象
- **揭示节奏分析注意**：步间隔必须算「相邻**增长事件**的 t 差」，不能用相邻帧差
  （后者恒 ≈ 帧时长，曾因此误判节流未生效）。帧率低时（重流式下 rAF ~25-33ms）
  名义 32ms 档实测会落到 66-100ms，属帧率×速率混合的正常表现

## 单段架构的期望形态（实测基线）

| 指标 | 期望 |
|---|---|
| inner | 全程 0（单段不变式） |
| 回退 | 仅语法符号假阳性 + 源替换事件 |
| 揭示节奏 | <4k 字符中位 ~17ms（每帧）；>4k 进 32ms+ 档（useStreamingContent revealIntervalFor） |
| 帧率 | 6.6k 字桌面 avg ~25ms（探针自身每帧全量 textContent 有开销，实际更好） |
| 终态结构 | DOM 完整（h/pre/table/ul 计数与文章内容匹配） |
