---
name: pwa-precache-verify
description: PWA 预缓存分层验证 — 生产构建 preview 起法 / caches 条目断言 / 离线导航与 caches.match 坑
metadata:
  type: recipe
  last_verified: 2026-11-17
---

# PWA 预缓存分层验证（方案 A）

## 起生产构建验收环境

1. bootstrap e2e（daemon 2224 + web dev 5175，见 [[env-bootstrap]]）
2. preview 服务仓库 dist（5176，vite.config 的 preview.proxy 读 MOBI_API_URL）：

```bash
perl -e 'use POSIX qw(setsid); fork and exit; setsid; fork and exit; exec @ARGV or die' -- \
  bash -c 'cd <repo>/packages/web && MOBI_API_URL=http://localhost:2224 bun run preview --port 5176'
```

   就绪判据：`curl -s -o /dev/null -w %{http_code} http://localhost:5176/login` = 200，
   `POST /api/auth -d '{"accessToken":"e2e-test-token-mobi"}'` = 200。

3. 浏览器打开 `http://localhost:5176/login`（用 `isolatedContext` 保证干净 SW 与缓存）。

## 断言点

- **首屏请求**：`performance.getEntriesByType('resource')` 统计（登录页约 43 条：入口 17 + LoginPage 路由链）。
- **SW 就绪**：`navigator.serviceWorker.getRegistration()` → active，`navigator.serviceWorker.controller` 非空。
- **caches 条目**：
  - `workbox-precache-v2-*` = 应用壳（27 条 / 约 3MB）
  - `mobi-runtime-assets` 随访问功能增长（登录后 4 条 → 打开设置页后约 153 条）
- **缓存命中**：resource entries 中 `transferSize === 0 && decodedBodySize > 0` 的比例（设置页约 173/183）。

## 离线验证

- `emulate networkConditions: Offline` 后整页导航深层链接（如 `/settings/notifications`）：
  靠 sw.ts 的 `NavigationRoute(createHandlerBoundToURL('/index.html'))` 返回预缓存壳；
  缺这条命中 `ERR_INTERNET_DISCONNECTED`。
- 离线会跳 `/login`（认证依赖 API）——预期行为，不是回归。
- **`caches.match` 坑**：必须传 `cache.keys()` 返回的 Request 对象；传 URL 字符串会 miss
  （请求 headers/Vary 语义不同），别据此误判缓存缺失。

## 坑

- **chunk 聚合白屏（2026-11-17 实踩）**：`codeSplitting` 的 `$initial` 分组聚合后，
  若未开 `output.strictExecutionOrder: true`，生产构建白屏，console 报
  `x is not a function`（initial chunk 内跨 chunk 循环依赖提前执行）。静态构建指标
  完全正常，只有浏览器加载才暴露——聚合类改动必须走本 recipe 实测。
