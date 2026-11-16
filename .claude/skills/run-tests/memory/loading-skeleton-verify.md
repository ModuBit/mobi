---
last_verified: 2026-11-15
---

# 加载态 skeleton 验证（react-query + axios）

列表加载态一闪而过，抓不住就验不了。核心两招：

## XHR patch（不是 fetch patch）

数据层走 axios（XHR），patch `window.fetch` 无效（2026-11-15 实踩：patch 后列表直接出数据）。
用 `navigate_page` 的 **initScript** 注入（仅下一次导航生效，每次要重新带）：

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

## 断言面

- DOM：status 数、aria-label（i18n 后是「加载中...」）、行内衬 padding 对齐真实行
- CSS 变量链路：`getComputedStyle` 取占位块 `backgroundColor`（color-mix 解析成 oklab 即变量供给通）；`animationName` 含 skeleton-pulse 即脉冲在跑
- 收尾：等延迟放行后确认骨架清零 + 真实行渲染（无残留、无误入错误空态）
- 主题双档：改 `localStorage['mobi-ui'] state.theme` + reload（与 initScript 同一次导航合并做）

## 缓存热态绕法

已缓存的 query 不会重进 isLoading。两个出路：① initScript + 整页 reload（推荐，patch 随导航生效）；② 切到一个从未加载过的 tab（per-tab query key 不同）。
