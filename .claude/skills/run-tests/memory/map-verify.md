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
2. **static**：只设 `webServiceKey=fake` → reload → 组件发 `<img src="/api/map/static?...">`，代理带假 key 拉高德得
   `502 {"error":"map-upstream-failed"}`（curl 直接验）；img onError → 块内「地图图片加载失败」+ 同一 URI 链接。
   这条**能证明静态分支端到端接线**，真图需真实 Web 服务 key
3. **interactive**：真实 JS API key + securityJsCode 才可验（假 key 会让 loader 报错）。无真 key 时如实标注「未真机验证」，不要伪造 ✓

## 坑

- **daemon 代码新鲜度**：map 路由新增后 `/api/map` 仍 404 = daemon 还是旧进程。bootstrap 常驻时按 [[env-bootstrap]] 走
  「kill -9 保数据 / 或 stop 后重启」；最省事是 TaskStop + 重跑 bootstrap（数据目录清空，需重新 seed 工作区）
- **seeded session 不在 daemon sessionCache**：store 直插的会话 GET 404、POST messages 返回 ok 但落不到该 id。
  兜底：先 `GET /api/sessions` 刷缓存；仍 404 就直接调 `/api/sessions/new?` 无，改用 UI 建会话或从返回的新 session id 继续
- **模型会为查 Map 签名反复 find/grep 本机文件**（多次权限弹窗、上百秒）：给模型自己的探针消息**直接内联完整代码**
  （「不要使用任何工具，直接输出以下代码块」）即可验证渲染链路；渲染正确性不依赖模型探索过程
- 渲染断言用 `[data-mobi-map="static"|"interactive"]` 与 `main main` innerText（fallback 文案）
