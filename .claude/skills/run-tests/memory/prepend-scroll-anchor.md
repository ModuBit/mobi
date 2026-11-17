---
last_verified: 2026-11-17
---

# 顶部 prepend 历史「加载完成后跳」验证与修复

BubbleListChat 滚到顶拉历史（fetch 新页 / window prepend / 贴末尾→滑动模式切换）后视口内容跳动。

## 根因判据（2026-11-17 实测）

Chrome/Firefox 有**原生 scroll anchoring**：prepend 后浏览器自己在 layout 阶段调 scrollTop
保持锚点节点不动。旧补偿 `scrollTop = 捕获时 scrollTop + (scrollHeight - 捕获时 scrollHeight)`
从 stale 值重算并覆盖，等于把已施加的补偿**再施加一遍** → 完成瞬间跳 ~219px。

**修法**：改用「锚点视口残差」——prepend 前记录顶部第一个可见项 + 末尾渲染项的
`data-bubble-key` 与 `rect.top`，DOM 提交后量同一元素的 `rect.top` 差值 `shift`，
`scrollTop += shift`（追加到**当前** scrollTop，不是重算）。浏览器已补偿时残差=0，天然不叠加。
`shift == null`（锚点全被窗口裁掉）且 `!CSS.supports('overflow-anchor','auto')` 时退回高度差兜底。

**Safari 无原生 anchoring**：走锚点法同样成立（残差即全部补偿量）；不可在 Chrome 验 Safari 分支，报告须标注未验。

## 验证 recipe

素材：真库拷入的 4933 条大会话（`real-session-seed.md`），桌面 1280x900。

1. 打开会话 → 滚到顶触发加载 → 在加载完成前后各采一次**全部** `[data-bubble-key]`
   的 `rect.top`，按 key 求交，断言公共项漂移 ≤1px（探针法，见下坑）。
2. 单调用内 rAF 轮询顶部可见项 offset，抓 transition 采样判中间态。

**探针坑**：连续多轮 rAF 探针会与 auto-continuation / 行插入补偿交错，出现锚点元素
短暂消失（tool group 重排）与 null 测量。最终判据用「完成后 vs 完成前全量 key→top 映射
diff」而不是盯单个锚点元素——它免疫 DOM 重排，也覆盖 window 裁切。

## 相关

- 顶部加载行统一 `HistoryLoadingRow`（logo+文案，见 `loading-skeleton-verify.md`），
  不用骨架——真数据替换时 1 行→几十个 bubble 的行高剧变更跳。
