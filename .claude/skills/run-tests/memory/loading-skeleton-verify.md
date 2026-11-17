---
last_verified: 2026-11-17
---

# 加载态 skeleton 验证（react-query + axios）

列表加载态一闪而过，抓不住就验不了。核心两招：

## XHR patch（不是 fetch patch）

数据层走 axios（XHR），patch `window.fetch` 无效（2026-11-15 实踩：patch 后列表直接出数据）。
用 `navigate_page` 的 **initScript** 注入（**reload 也生效**，每次导航都要重新带）：

```js
(() => {
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url, ...r) { this.__url = String(url); return origOpen.call(this, m, url, ...r); };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    if (this.__url && this.__url.includes('/api/skills')) setTimeout(() => origSend.apply(this, a), 15000);
    else origSend.apply(this, a);
  };
})()
```

- reload 后立即断言 `[role="status"]`（uiarc Skeleton 是 role=status + aria-label）+ `take_screenshot`
- 延迟给足（15s）：截图 MCP 往返本身要几秒，6s 会眼睁睁看着它加载完
- 只想验某个 tab 分支就在 URL 匹配上排除/包含（如排除 `bundled`）
- **URL 写错 patch 静默不生效**：先按真实路径断言（会话消息是 `/api/sessions/<id>/messages`，不是 `/api/messages`；匹配写 `/\/api\/sessions\/[^/]+\/messages(\?|$)/`）。症状 = 页面内容直接到了、patch 看起来"没拦住"

## 断言面

- DOM：status 数、aria-label（i18n 后是「加载中...」）、行内衬 padding 对齐真实行
- CSS 变量链路：`getComputedStyle` 取占位块 `backgroundColor`（color-mix 解析成 oklab 即变量供给通）；`animationName` 含 skeleton-pulse 即脉冲在跑
- 收尾：等延迟放行后确认骨架清零 + 真实行渲染（无残留、无误入错误空态）
- 主题双档：改 `localStorage['mobi-ui'] state.theme` + reload（与 initScript 同一次导航合并做）

## 会话历史加载态（2026-11-17）

两个分支，素材各不相同：

- **空列表骨架**（首页历史未到、无任何内容）：dormant 大会话（真库拷入的 4933 条）+ 延迟 `/api/sessions/<id>/messages`。
  断言：外层 `[role=status][aria-label="正在加载历史消息…"]` + 内层 3 个 `[aria-label="Loading content"]`；
  `span[class*="_line_"]` 的 `animationName` 为 `_skeleton-pulse_*`；`.tiptap` 必须已在（旧全屏 loader 会卸载 composer，这是回归点）。
  到期（采样 transition）：skeleton 归零同帧气泡数跳到首页量（如 36），无中间空态。
- **SSE 先到 + 顶部历史行**（在线会话边流式边拉历史）：同一延迟 + 页面内 `fetch(POST /api/sessions/<id>/messages, {content})` 发一条长输出提示词。
  300ms 内断言列表出现「正在加载历史消息」行（role=status 文本）+ `.ant-bubble` 数 >0 + `.tiptap` 在；到期后行消失、气泡合并历史。
  注意：在线会话 reload 后 SSE 回填也会先落库（不必发消息即可造出该分支，但不能造出"空列表骨架"）。
- 采样：`evaluate_script` 单调用内 300ms 轮询返回 transition 列表（记录 sk 数 / bubbles / historyRow 文本存在性），避免 MCP 往返吃掉时间窗。
- 坑：通知 toast 每次 reload 重现并盖住顶部（关闭点击要在它渲染后，或先断言再关再截图）。

## 缓存热态绕法

已缓存的 query 不会重进 isLoading。两个出路：① initScript + 整页 reload（推荐，patch 随导航生效）；② 切到一个从未加载过的 tab（per-tab query key 不同）。
