---
name: scroll-follow-verify
description: 验证消息列表贴底跟随 / 「滚到底」按钮 —— 探针脚本、DOM 锚点、指标阈值、易误判点
metadata:
  type: recipe
  last_verified: 2026-08-02
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
| `maxDist` | ≤ ~150 | 单帧增长幅度，下一帧即钉回 |
| `over80 / frames` | < 1% | 超 80px 的帧占比；实测 3/1882 |
| `toggles` | 0 | 按钮显隐翻转次数，>2 即闪烁 |

修复前基线：`maxDist 1991`，按钮反复闪。

## 触发真流式的 prompt（关键）

**「写一篇长文」不产生逐 token 流式** —— 实测 `Duration 1m30s / First token 1m30s`，整篇一次性到达，测不到跟随过程。

**用多步工具调用** 才有连续增长的真流式：
> 用 Bash 工具依次执行这几条命令，每条之间不要合并：先 ls -la，再 pwd，再 date，再 echo hello，再 uname -a。每执行完一条都简单说一句结果。

实测 `First token 5.1s / Turns 6`，内容持续增长 20+ 秒，scroll 日志密集。

## 三条路径都要验

1. **流式钉底** —— 发消息后读 `__stat`
2. **上滚不被拉回** —— `sc.scrollTop -= 900`，隔一会儿再读，`scrollTop` 应保持，按钮出现
3. **点按钮恢复** —— `take_snapshot` 找 `button "down"` 点击，`dist` 应归 0 且按钮消失

## 极端增长（可选，压力验证）

一帧内暴涨的场景可注入 spacer 模拟，比等真实长回复快：

```js
const il = document.querySelector('[data-testid="virtuoso-item-list"]');
const sp = document.createElement('div'); sp.style.height = '4000px'; il.appendChild(sp);
// 等两帧后读 dist，应 ≈ 0；读完 sp.remove()
```

## 坑

- **自己改 scrollTop 会污染观测** —— `evaluate_script` 里 `sc.scrollTop = x` 派发 scroll 事件，被判为「用户上滚」→ 跟随停止。之后测到的 `maxDist` 大是自己造成的，不是 bug。要测流式就别在中途动 scrollTop
- **探针要在发消息前装** —— 发完再装会漏掉前半段，且此时可能内容还不超视口
