---
name: switch-perf-probe
description: 会话切换渲染性能量测 recipe——pushState+popstate 触发 SPA 切换 + rAF paint 探针 + longtask/fetch 抓取
metadata:
  type: recipe
  last_verified: 2026-09-21
---

# 会话切换性能量测

ChatContainer 以 `key={sessionId}` 重挂（ChatPane），切会话 = 整树重建。量测"切换到画出"的真实成本：

## 步骤

1. 会话数据用 [[real-session-seed]] 拷入 e2e；直开 `/sessions/<id>` 全量加载
2. **SPA 切换**（拷贝会话不在侧栏，且要绕开整页 reload 清空 query 缓存）：
   `history.pushState({}, '', '/sessions/<id>'); window.dispatchEvent(new PopStateEvent('popstate'))`
   ——与 Link 点击同代码路径
3. 双向各访一次（模拟用户"两边都开过"），再计时切换：
   ```js
   const t0 = performance.now();
   history.pushState(...); dispatchEvent(new PopStateEvent('popstate'));
   await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));  // = 完成一次 paint
   ```
4. 长任务与网络：PerformanceObserver `longtask` + 包一层 `window.fetch` 记 `/api/` 调用

## 基线数据（2026-09-21，dev build，20k/13.5k 消息两会话互切）

- 热切换（同方向第 2 次起）：paint 17–30ms，0 longtask，0 API 调用（query 缓存命中）
- 方向首切：paint 239–310ms，1 个 ~260ms longtask（卸旧树+挂新树+markdown 重解析）
- 重挂窗口只渲染尾部（首窗 ~13/33 个 bubble），20k 总量不进首挂成本

## 坑

- **paint 双 rAF 探针会提前停表**（2026-09-21）：切会话后消息是异步 fetch，双 rAF 只测到空壳挂载
  （25ms）——探针必须追加「等首窗 bubble 挂载」轮询（如 ≥5 个 bubble 元素，25ms 步进）再停表，
  否则量的是壳不是内容。

- performance_stop_trace 的 filePath 必须在 workspace 根内（/tmp 被拒）
- trace 摘要的 URL 标签是 tab 首次导航的 URL，不代表录制的页面
