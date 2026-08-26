---
name: scroll-follow-verify
description: 验证消息列表贴底跟随 / 「滚到底」按钮 —— 探针脚本、DOM 锚点、平滑追赶指标、scrollend 干扰坑、手势掉队语义
metadata:
  type: recipe
  last_verified: 2026-08-26
---

# 贴底跟随 / 滚到底按钮 验证

## 平滑追赶（2026-08-26 起，修换行「一跳一跳」）

RO 增高路径是 rAF 缓动追赶（`CHASE_EASE=0.25`，每帧追掉剩余距离 25%，≤1px 贴齐），
非瞬跳。硬钉仅保留给 smooth 门闩解除 / `stickToBottom('auto')`。

**探针判别「平滑 vs 瞬跳」**（每帧记 scrollTop，看运动串而非单帧位移）：
- 健康：多帧连续运动串（≥3 帧成串）、单帧位移中位 ~4px、运动帧占流式期 ~60%、单帧串 0 个
- 瞬跳回归：大量**单帧运动串**（一动即停）、单帧位移 ≈ 整行高度（~30px+）
- 分析陷阱：揭示增长窗口的边界要取「首个→最后一个增长帧」，别把完成后静止尾巴算进去

**两大干扰坑（都踩过）**：
1. **scrollend 无条件补钉会杀死追赶**：scrollend 对一切滚动（含追赶自身）触发，
   无条件 `pinIfFollowing` → 追赶第一帧 settle 即被硬拉到底、第二帧外部干预检测中止
   → 退化为单帧瞬跳。修复：`releaseSmoothGateAndPin` 仅在 smooth 门闩确实闭合时动作
2. **scrollTop 像素 snap**：浏览器把 scrollTop snap 到物理像素网格（DPR2 = 0.5px），
   外部干预检测的期望值必须「写后读回」，存浮点计算值会每帧误判中止
   （jsdom 假容器不 snap，单测测不出）

**现场抓干扰者的手法**：setter 间谍拿调用栈——
`Object.defineProperty(sc, 'scrollTop', { get: 原get, set(v){ 记录 new Error().stack; 原set.call(this,v) } })`，
再人为 `scrollTop -= 100`，看谁把它写回去。

## DOM 锚点（稳定）

| 目标 | 选择器 |
|---|---|
| 滚动容器（Bubble.List，现行） | `.ant-bubble-list-scroll-box` |
| 内容层（RO 观测） | `.ant-bubble-list-scroll-content` |
| 旧 virtuoso（已废弃） | `[data-testid="virtuoso-scroller"]` |
| 内容总高层 | `[data-testid="virtuoso-item-list"]` |

⚠️ **不要靠遍历父链找 `scrollHeight > clientHeight` 来定位 scroller** —— 会话短时内容不超视口，全链都不可滚，返回 null。直接用 testid。

「滚到底」按钮：`button.ant-btn-circle` 且 `getComputedStyle(b).position === 'absolute'`（区别于 composer 里的圆形按钮）。

## 探针（requestAnimationFrame 采样，evaluate_script 注入）

```js
const sc = document.querySelector('[data-testid="virtuoso-scroller"]');
const isBtnVisible = () => Array.from(document.querySelectorAll('button.ant-btn-circle'))
  .some(b => b.getBoundingClientRect().width > 0 && getComputedStyle(b).position === 'absolute');
let lastBtn = null, toggles = 0, maxDist = 0, over80 = 0, n = 0;
window.__stop = false;
const tick = () => {
  if (window.__stop) return;
  n++;
  const dist = Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight);
  if (dist > maxDist) maxDist = dist;
  if (dist > 80) over80++;
  const v = isBtnVisible();
  if (lastBtn !== null && v !== lastBtn) toggles++;
  lastBtn = v;
  window.__stat = { frames: n, maxDist, over80, toggles, btnNow: v };
  requestAnimationFrame(tick);
};
tick();
```

装完探针**再发消息**，读 `window.__stat`。收尾 `window.__stop = true` + delete 全局。

## 合格阈值（实测基线）

| 指标 | 合格 | 说明 |
|---|---|---|
| `maxDist` | ≤ ~150 | 单帧增长幅度，下一帧即钉回（折叠瞬间可能 ~170，单帧即收） |
| `over80 / frames` | < 1% | 超 80px 的帧占比 |
| `toggles` | 0 | 按钮显隐翻转次数，>2 即闪烁 |
| **`finalDist`** | **0** | **turn 结束必须精确贴底**（曾残留 35px = "差几十像素" bug） |

旧基线：`maxDist 1991`、`finalDist 35-36`、按钮反复闪。修后 `finalDist 0`。

## 触发真流式的 prompt（关键）

**「写一篇长文」不产生逐 token 流式** —— 整篇一次性到达，测不到跟随过程。

**用多步工具调用** 才有连续增长的真流式：
> 用 Bash 工具依次执行这几条命令，每条之间不要合并：先 ls -la，再 pwd，再 date，再 echo hello，再 uname -a。每执行完一条都简单说一句结果。

实测 `First token 5.1s / Turns 6`，内容持续增长 20+ 秒。

**测折叠（高度骤减，旧 bug 主触发器）** —— 连续工具、禁中间文字，让多个工具完成时折叠进 group：
> 连续用 Bash 工具执行这 8 条命令。要求：整个过程中绝对不要输出任何解释、说明或过渡文字，只连续发起 8 次 Bash 调用，全部完成之后再统一输出一句话总结。命令依次是：echo a1、echo a2、... echo a8

## 三条路径都要验

1. **流式/折叠钉底** —— 发消息后读 `__stat`，`finalDist` 应为 0
2. **上滚不被拉回** —— 派发**真实 WheelEvent**（见下坑），隔一会儿按钮出现、`following` 掉队
3. **点按钮恢复** —— `take_snapshot` 找 `button "down"` 点击，`dist` 应归 0 且按钮消失

## 坑

- **模拟用户上滚必须派发真实 WheelEvent**（`sc.dispatchEvent(new WheelEvent('wheel',{deltaY:-900,bubbles:true}))`）。
  `useStickToBottom` 的「停止跟随」**只认手势**（wheel/touchmove/keydown），程序改 scrollTop / 浏览器 clamp / Virtuoso 内部调整都不掉队（这是修「高度变化掉队」的关键设计）。所以 `sc.scrollTop = x` 不会掉队，测上滚必须用 wheel。
- **turn 结束差几十 px 的根因**：RO 回调触发时 `scroller.scrollHeight` 可能尚未反映最终布局（流式末帧/footer/badge settle），钉到偏小位置。修法：接 Virtuoso `totalListHeightChanged` 回调（测量系统 settle 后触发，此时读 scrollHeight 是最终值）+ 门闩释放补钉。验证靠 `finalDist === 0`。
- **探针要在发消息前装** —— 发完再装会漏掉前半段
- **`evaluate_script` 派发合成 wheel 不触发原生滚动**（scrollTop 不变），但会触发 hook 的 wheel 监听置 `following=false`（按钮出现）。要同时验证「位置不变」需真机/触控；合成 wheel 仅验证掉队语义
