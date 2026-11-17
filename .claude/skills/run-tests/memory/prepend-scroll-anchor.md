---
last_verified: 2026-11-17
---

# 顶部 prepend 历史「加载完成后内容跳」验证与修复

BubbleListChat 加载更旧历史（fetch 分页 / window prepend / fill 补页 / 初次历史到位）后
视口内容跳动。用户症状：「内容被上移」/「加载前的内容找不到了」。

## 现行机制

- **视口内锚点快照**（`AnchorSnapshot`）：capture 视口内可见项（最多 8 个，按视口顺序）+ 末尾项。
  每次 items 变化的 layout effect 末尾重拍；**每次触发加载前重拍**；**滚动停止 80ms 后重拍**
  （连续滚动跨过大段内容时旧快照锚点全滑出视口）。
- **补偿**：`shift = 现 rect.top − 快照 rect.top`，`scrollTop += shift`（追加到当前值，浏览器
  原生 anchoring 已补偿时残差 0，天然不叠加）。
- **锚点选取三级兜底**：
  1. 此刻仍在视口内的锚点（首选，残差 0 即无操作）；
  2. **视口下方**的锚点——只受顶部 prepend 影响，位移等于上方插入量，只接受正位移。
     **这是 iOS/WebKit 上唯一生效的路径**（见坑 6）；
  3. 无原生 anchoring 的浏览器（`CSS.supports('overflow-anchor','auto')` = false）才用
     末尾项 / scrollHeight 高度差兜底。
- **RO 路径**：观测 `.ant-bubble-list-scroll-content` 高度变化（流式增量/图片/高亮撑高），
  rAF 合并后走同一 reconcile（`armPrefetch=false`，不设 scroll guard）。
- **fill 不钉底**：内容补满视口后不再 `scrollTop = scrollHeight`。

## 实踩的坑

1. **scrollHeight delta 重算 = 双重补偿**（桌面 Chrome 有原生 anchoring）：从捕获时的
   scrollTop 按 delta 重算覆盖 → 完成瞬间跳 ~219px。
2. **末尾渲染项不能当锚点**（视口外）：Chrome anchoring 只保证视口内节点；视口外项的位移
   混入窗口裁切/懒加载 → 一次 1639px 错误补偿。
3. **scroll 事件里的快照平移要加 scrollHeight 判据**：内容变化引发的 st 调整（anchoring /
   钉底）与锚点位移是同一笔账，平移会把已施加补偿二次计入（56px 补成 112px）。仅
   `scrollHeight === snapshot.scrollHeight`（纯用户滚动）时平移。
4. **guard 只在 armPrefetch 路径设置**：RO 路径若也设 `isRestoringScrollRef = true` 且无
   timer 复位 → scroll listener 永久失聪（滚动到顶不再加载）。
5. 触发点重拍快照是必须的：快照拍在底部（st=底）后用户滚到顶，平移出的锚点全在视口外。
6. **能力探测会骗人（2026-11-17 用户 iPhone 实测的最大坑）**：iOS WebKit 上
   `CSS.supports('overflow-anchor','auto')` 可能为 true，但浏览器实际不做 scroll anchoring。
   此时「只认视口内锚点 + 能力支持则跳过兜底」= **零补偿**，prepend 后 5000+px 内容整体漂移
   （用户截图症状：加载前 17:45 的内容，加载后视口在 17:35，原内容找不到）。
   **修法 = 坑 5 下方的「视口下方锚点」兜底**：浏览器没补偿时锚点被推到视口下方，位移仍
   等于上方插入量；Chrome 已补偿时锚点留在视口内，走首选路径，不叠加。

## 第五层根因（2026-11-17 桌面「有时候 OK 有时候跳」）

**messageWindowStore 的 turn 边界裁剪在用户读历史期间裁掉了刚加载的内容**：
`following=false` 上滚读历史时，新加载的旧消息贴在窗口头部；只要期间有流式 ingest
（`hasMore=true`），`trimAfterMerge` 就按 turn 边界从头部裁到 ≤1000 行——用户正在看
的内容整段消失。是否触发取决于加载期间有没有 SSE → 「有时候 OK，有时候往上跳/往下跳」。

修法：`setHistoryReading(sessionId, !following)` 暂停裁剪，回贴底（following=true 或
距底 ≤40px）立即收敛窗口并重算 oldestSeq，离开会话页复位。
实测：活会话连续 12 次触顶加载，渲染气泡数 `49→61→…→210` 持续增长（修复前 12 页
全部 200 但气泡数恒 186，即每次 ingest 都裁掉刚加载的历史）。

## 截图验收的坑

加载行（`__loading-more__`）在内容顶部，插入后锚点补偿会把它推出视口：
`scrollTop` 0→44、行 top=-21，**50ms 内就看不见了**（真实用户触发阈值 st<200，
行本来就在视口上方）。要截「加载中」必须手动回拨：触发后趁 loading 期间
`box.scrollTop += rowTop - 8` 把行拉回视口顶部，再以视口内第一个稳定元素 key
拍 before/after 的 `rect.top - boxRect.top`，零容差对比（本轮 120→120，diff 0）。
不要拿 tool 行/合并组 key 当锚点——window 变化时 key 会重组消失。

## 验收 recipe

**必须两种条件都测**（只测桌面 Chrome 会漏掉 iOS 的真实行为——Chrome 有原生 anchoring，
走的根本不是同一条代码分支）：

1. **iOS 等价条件**：`emulate` 视口 `390x844x3,mobile,touch` + 在 scroll box 上
   `style.overflowAnchor = 'none'`（关掉真实 anchoring；**不要**改 `CSS.supports`，
   要的就是「探测 true 但实际不 anchoring」的组合）。
2. **桌面正常条件**：同上但不设 overflow-anchor，验证不双重补偿。

步骤：

```
initScript：延迟 /api/sessions/*/messages*beforeSeq* 的 XHR ~2.5s（axios 走 XHR）
box.dispatchEvent(new WheelEvent('wheel', {deltaY:-120, bubbles:true}))  // following=false
box.scrollTop = 0                                                          // 触发加载
等 500ms → scrollTop=0 拍 beforeMap（可见项 key → rect.top - boxTop）
等 ~3s  → 拍 afterMap，断言 common key 的 maxDiff === 0（零容差）
```

2026-11-17 实测基线（dev 5174 源码 / prod 2222 部署版，同一会话数据）：

| 条件 | 部署版（只有视口内锚点） | 修复版（+视口下方兜底） |
|---|---|---|
| iOS 等价（overflow-anchor:none，supports=true） | maxDiff **5088 / 6273px** | maxDiff **0 / 1 / 0px**（3 轮） |
| 桌面 Chrome（原生 anchoring） | — | maxDiff **0px** |

**注意**：会话正在流式输出时 scrollHeight 会持续增长（底部），不影响视口内容对比，但
「加载是否发生」要用 `document.body.innerText.includes('正在加载历史消息')` + 可见项 map
变化断言，不能只看 scrollHeight 变了就算加载。

## 单测

`tests/chat/BubbleListChat.test.tsx`：
- prepend 补偿：stub `Element.prototype.getBoundingClientRect` 按 key 查表（每项 100px），
  rerender 前插 3 条 → 断言 `box.scrollTop === 300`。
- fill 不钉底：可变 mockLayout（50→5000）+ `vi.spyOn(CSS, 'supports').mockReturnValue(true)`
  （jsdom 无 anchoring 会走兜底干扰断言）→ 断言 scrollTop 保持用户值。

## 相关

- 顶部加载行统一 `HistoryLoadingRow`（logo+文案，见 `loading-skeleton-verify.md`）。
- 用户实测设备：iPhone（1170×2532 截图），走 WebKit。
