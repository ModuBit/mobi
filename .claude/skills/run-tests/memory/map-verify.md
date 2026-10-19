---
name: map-verify
description: Map（高德）组件真机验收——设置页三档切换、无 key 降级、静态图代理 502 回退、交互地图反例
metadata:
  type: recipe
  last_verified: 2026-10-19
---

# Map 组件验收（高德三档）

## 设置页

- 入口 `/settings/map`；三个字段：JS API key、securityJsCode、Web 服务 key（后两个 Input.Password）
- 提交语义：非空覆盖、留空保持不变（placeholder 变「已设置（留空保持不变）」）；「清除全部」提交三个空串
- 观测点：标题右侧 Tag 文案 = `未配置` / `静态地图` / `交互地图`；保存后行内「已保存」
- 落盘断言：`~/.mobi-e2e/settings.daemon.json` 的 `map` 块

## 三档验收

1. **none**：清空三个字段 → 会话里渲染 `root = Stack([map]); map = Map("116.39,39.9", 12, [...])` → 块内出现「未配置高德地图 key」+ 链接
   `https://uri.amap.com/marker?position=116.39%2C39.9&name=%E5%85%AC%E5%8F%B8`（name 为 marker.label）
2. **static**：只设 `webServiceKey` → reload → 组件发 `<img src="/api/map/static?...">`。真 key 下代理返回 750×280 PNG
   （可直接 curl 断言 `content-type: image/png`）；假 key 走 502 → img onError → 「地图图片加载失败」+ URI 链接。
   两条一起覆盖静态分支：代理产图 + 组件回退
3. **interactive**：真 JS API key + securityJsCode 后 reload → `[data-mobi-map="interactive"]`、`box.amap.getZoom()===12`、
   `getCenter()≈[116.39,39.9]`、`.amap-marker` title=标注名、canvas 382×280、无「交互地图加载失败」。
   **canvas 像素不能用 `readPixels` 断言**（preserveDrawingBuffer=false，帧外恒 0）；用截图肉眼验收
4. **冷启动偶发空白**：首次加载若 AMap 样式/瓦片请求被网络掐断（console `ERR_CONNECTION_CLOSED`），画布会停在灰底网格且
   不自动重试；对实例调一次 `setMapStyle(...)` 可强制重拉恢复。真机验收看到空白先查 console，再刷新/换样式确认是否为瞬时网络问题

## key 注入（不走聊天）

用户终端执行：`umask 077` + `cat > ~/.mobi-e2e/map-keys.json` 写三个值 → 用 cookie 调
`POST /api/auth` 再 `curl -d @文件 http://localhost:2224/api/map` → `rm` 文件。`-d @file` 不回显 key，
但**不要**在页面里读回 settings（GET /api/map 会明文返回 jsApiKey/securityJsCode）。

## 坑

- **daemon 代码新鲜度**：map 路由新增后 `/api/map` 仍 404 = daemon 还是旧进程。bootstrap 常驻时按 [[env-bootstrap]] 走
  「kill -9 保数据 / 或 stop 后重启」；最省事是 TaskStop + 重跑 bootstrap（数据目录清空，需重新 seed 工作区）
- **seeded session 不在 daemon sessionCache**：store 直插的会话 GET 404、POST messages 返回 ok 但落不到该 id。
  兜底：先 `GET /api/sessions` 刷缓存；仍 404 就直接调 `/api/sessions/new?` 无，改用 UI 建会话或从返回的新 session id 继续
- **模型会为查 Map 签名反复 find/grep 本机文件**（多次权限弹窗、上百秒）：给模型自己的探针消息**直接内联完整代码**
  （「不要使用任何工具，直接输出以下代码块」）即可验证渲染链路；渲染正确性不依赖模型探索过程
- 渲染断言用 `[data-mobi-map="static"|"interactive"]` 与 `main main` innerText（fallback 文案）
