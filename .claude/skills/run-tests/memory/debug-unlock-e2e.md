---
name: debug-unlock-e2e
description: E2E 验证「连点 logo 解锁调试区块」— evaluate_script 模拟连点 + 拦截 a.click 捕获下载
metadata:
  type: recipe
  last_verified: 2026-08-01
---

# 调试解锁 + diag 下载 E2E

## 场景

验证「创建页连点 Logo ≥5 次 → 解锁设置页调试区块 → diag 开关 / 下载诊断数据」链路。

## 步骤（能 work 的 recipe）

1. **导航到创建页**：`navigate_page` 到 `http://localhost:5175/sessions/new`
2. **evaluate_script 模拟连点**（不能逐个 click，1.5s 窗口内需 5 次）：
   ```js
   () => {
     const span = document.querySelector('span[style*="vertical-align"]')  // Logo 包裹 span，onClick 挂这里
     for (let i = 0; i < 5; i++) span.dispatchEvent(new MouseEvent('click', { bubbles: true }))
     return { unlocked: localStorage.getItem('mobi-debug-unlocked') }
   }
   ```
   → 期望 `unlocked: "1"`
3. **导航到设置页**：`navigate_page` `/settings` → `take_snapshot` 应见 "Debug" 区块 + 开关 + 下载按钮
4. **开关验证**：click 开关 → `localStorage.getItem('mobi-diag-enabled')` 变 `null`（关）或 `1`（开）
5. **下载验证**：先 evaluate_script 拦截 `HTMLAnchorElement.prototype.click`，捕获 `a.href`（blob）+ `a.download`，用 `fetch(href)` 读 blob 文本；再 click 下载按钮 → 断言文件名 `mobi-diag-<ts>.json` + JSON 含 `enabled` / `events` / `tools`

## 坑

- **桌面 Chrome 的 VConsole 不会开**：`enableVConsole()` 有 `isMobileDevice()`（pointer:coarse）守卫，桌面验证只看 localStorage 解锁标志，别断言 VConsole 存在
- **diag 开关状态非响应式**：Switch 用本地 `useState(isDiagEnabled())` 初始化，不驱动重渲染；验证用 `dumpDiag().enabled` 或 localStorage 值，别用 DOM checked
- **测试残留清理**：结束后 `localStorage.removeItem('mobi-debug-unlocked')` + `__mobiDiag.disable()`，并还原 `HTMLAnchorElement.prototype.click`
- **`?diag=1` URL 参数遗留**：会话详情页可能带 `?diag=1` 打开导致开关初始为 on，先 `localStorage` 确认实际状态
