---
name: scroll-follow-verify
description: 验证消息列表贴底跟随 / 「滚到底」按钮 —— 探针脚本、DOM 锚点、指标阈值、手势掉队语义、totalListHeightChanged
metadata:
  type: recipe
  last_verified: 2026-08-03
---

# 贴底跟随 / 滚到底按钮 验证

## DOM 锚点（稳定，来自 react-virtuoso）

| 目标 | 选择器 |
|---|---|
| 滚动容器 | `[data-testid="virtuoso-scroller"]` |
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
