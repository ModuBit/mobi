---
last_verified: 2026-11-17
---

# 顶部 prepend 历史「加载完成后内容跳」验证与修复

BubbleListChat 加载更旧历史（fetch 分页 / window prepend / fill 补页 / 初次历史到位）后
视口内容跳动。用户症状两种说法：「内容被上移」（大跳）/「aaaa 被顶走」。

## 现行机制（多处修补后的稳定形态）

- **视口内锚点快照**（`AnchorSnapshot`）：capture 视口内可见项（最多 8 个，按视口顺序）+ 末尾项。
  每次 items 变化的 layout effect 末尾重拍；**每次触发加载前重拍**（handleScroll 的 prefetch
  分支开头）——补偿基准永远是「用户此刻看到的内容」。
- **补偿**：`shift = 现 rect.top − 快照 rect.top`，`scrollTop += shift`（追加到当前值，Chrome
  原生 anchoring 已补偿时残差 0，天然不叠加）。只认**此刻仍在视口内**的锚点。
- **RO 路径**：观测 `.ant-bubble-list-scroll-content` 高度变化（流式增量/图片/高亮撑高），
  rAF 合并后走同一 reconcile（`armPrefetch=false`，不设 scroll guard）。
- **fill 不钉底**：内容补满视口后不再 `scrollTop = scrollHeight`（那会把正在看的内容瞬移走）。

## 实踩的坑（每条都是 2026-11-17 实测）

1. **scrollHeight delta 重算 = 双重补偿**：Chrome/Firefox 原生 scroll anchoring 在 layout
   阶段已调 scrollTop；再从捕获时的 scrollTop 按 delta 重算覆盖 → 完成瞬间跳 ~219px。
2. **末尾渲染项不能当锚点**（视口外）：Chrome anchoring 只保证视口内节点；视口外项的位移
   混入窗口裁切/懒加载 → 一次 1639px 错误补偿。无 anchoring 浏览器（Safari）才允许兜底。
3. **scroll 事件里的快照平移要加 scrollHeight 判据**：内容变化引发的 st 调整（anchoring /
   钉底）与锚点位移是同一笔账，平移会把已施加补偿二次计入 → 补偿一倍（56px 补成 112px）。
   仅 `scrollHeight === snapshot.scrollHeight`（纯用户滚动）时平移。
4. **guard 只在 armPrefetch 路径设置**：RO 路径若也设 `isRestoringScrollRef = true` 且无
   timer 复位 → scroll listener 永久失聪（滚动到顶不再加载）。
5. 触发点重拍快照是必须的：快照拍在底部（st=底）后用户滚到顶，平移出的锚点全在视口外，
   用户视角已无有效基准。

## 验收 recipe（用户视角判据）

在 dev 5174（vite 源码）+ 真库大会话（real-session-seed）：

```
visibleMap() = 视口内所有 [data-bubble-key] 的 key → (rect.top - boxTop)
每轮：wheel 合成上滚 + scrollTop=0 → 等 120ms 拍 before → 等加载完成拍 after
断言 common key 的 maxDiff === 0（不是 ≤2px，零容差）
```

- 三轮上滚（21→60→100→118）maxDiff 全 0；初始 reload（不滚动）maxDiff 0。
- **不要用视口外的单一跟踪锚点判据**：它的位移只反映「它上方内容总高变化」，不代表用户
  视角（曾因此误判 219px 未修好）。
- 视口拉高造「内容不足一屏 fill」在此布局下不生效（clientHeight 恒 493），fill 停钉底
  行为改由单测覆盖（mockLayout 可变几何 + 断言 scrollTop 不被改写）。

## 单测

`tests/chat/BubbleListChat.test.tsx`：
- prepend 补偿：stub `Element.prototype.getBoundingClientRect` 按 key 查表（每项 100px），
  rerender 前插 3 条 → 断言 `box.scrollTop === 300`。
- fill 不钉底：可变 mockLayout（50→5000）+ `vi.spyOn(CSS, 'supports').mockReturnValue(true)`
  （jsdom 无 anchoring 会走兜底干扰断言）→ 断言 scrollTop 保持用户值。

## 相关

- 顶部加载行统一 `HistoryLoadingRow`（logo+文案，见 `loading-skeleton-verify.md`）。
