# inline HTML 产物走 serve-file CSP iframe，不用 srcDoc fragment

## Status

accepted（2026-09-26）。产物声明特性（`:mobi-artifact`）的渲染安全基线。

## 背景

`:mobi-artifact` 声明的单文件 HTML 需要在聊天流中 inline 渲染。行业两条现成路线：

- **ChatGPT（asar 实证）**：模型产出 HTML fragment，前端以 `<iframe srcdoc sandbox="allow-scripts">`（不带 allow-same-origin → opaque origin）渲染，并向 fragment 注入 CSP meta。其源码注释明确把「不做带 same-origin 的 iframe」作为红线（ZCode 同样因 renderer 无 CSP 而全线拒绝 iframe，产物只出卡片）。
- **mobi 现状**：inspector 的 HTML 预览（HtmlPreviewView）已经走 serve-file URL + iframe sandbox + 服务端 `PREVIEW_CSP`（`default-src 'none'`、`connect-src 'none'`、脚本/样式限 self 与 https CDN、图片媒体仅 data:），etag/Range/缓存全部现成，且已在生产验证。

## 决定

**声明的 HTML 产物一律经 serve-file URL 进 iframe（复用 PREVIEW_CSP + sandbox），不走 srcDoc fragment。**

- iframe `src` 指向 serve-file 路由，内容不进前端内存——大文件、Range、304 缓存白拿
- 安全能力面由服务端 CSP 单点定义，web 端不复刻安全规则
- `mode="wide"` 只是同一 iframe 的容器宽度档位，不是第二条渲染路径

## Considered Options

- **srcDoc fragment（ChatGPT 路线）**：需要把文件内容读进前端再注入 CSP；大文件占内存、缓存失效、与既有 serve-file 安全面形成第二权威。该路线的存在理由（renderer 无 CSP 通道、产物是流式 fragment 而非文件）在 mobi 均不成立
- **不对 HTML inline（ZCode 路线，一律卡片）**： ZCode 是被其 renderer 无 CSP 倒逼的；mobi 有服务端 CSP 通道，放弃 inline 等于放弃核心痛点（简单网页还要跳 inspector）
- **放宽 PREVIEW_CSP 换渲染能力**：connect-src 'none' 是安全底线，产物规范（自包含、媒体内嵌）在 skill 侧约束模型，不动 CSP

## Consequences

- `PREVIEW_CSP` 是 mobi 所服务的**一切** text/html 的安全权威——2026-09-26 起下沉到 `serveFileContent` 层按 mime 恒注，与通道无关（serve-file 预览 / read-file 浏览器打开·复制链接 / machine 通道全覆盖）；早期只挂 serve-file 通道时，产物卡浏览器打开走 read-file 曾绕过 CSP（顶层同源脚本可带 httpOnly cookie 调 mobi API），已堵。skill（visualize）按它反推产物规范：禁 fetch/XHR/WebSocket、图片媒体必须 data: 内嵌或同源、脚本样式可引 https CDN
- top-level 打开（浏览器打开通道）没有 iframe sandbox（sandbox 是 iframe 标签属性不随 URL 走），防线只剩 CSP 单道——已接受取舍，不做 sandbox 中间页
- 双主题由产物自身负责（skill 教 `prefers-color-scheme` / `light-dark()`），iframe 内容不继承 mobi 主题
- 已知边界：用户项目恰为 home 时，读取黑名单（ADR 0004）会拦 `.mobi`——产物目录（`.mobi/artifacts/`）与附件（`.mobi/uploads/`）在该场景同样不可读，为既有语义的自然延伸，不单独豁免
