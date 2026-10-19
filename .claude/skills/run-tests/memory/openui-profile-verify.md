---
name: openui-profile-verify
description: openui prompt 档位（名录/签名分层）E2E 对比——探针脚本 / regenerate 切档 / transcript 解析坑 / 浏览器告警抽样
metadata:
  type: recipe
  last_verified: 2026-10-19
---

# openui prompt 档位对比验证

验证「核心段形态」（组件签名常驻 vs 名录+检索）对生成质量的影响。2026-10-19 三档对比 + 四项瘦身裁决落定 c 档（详见 docs/architecture/web/openui.md「prompt 形态 v2」）。

## 切档与跑批

1. `bun run packages/session/scripts/generate-openui-prompt.ts [--profile=a]`（默认 c；b 档已删）改写核心段产物。
   **不需要重启 daemon**——会话 CLI 是 daemon spawn 的独立进程，每次 spawn 重新加载 src；regenerate 后建新会话即生效。
   产物四件：核心段 .ts + catalog .ts + SKILL.md（索引）+ references/ 三文件（examples/signatures/app-details，2026-10-19 拆分）。
2. 探针脚本（API 直连，不经浏览器）：spawn 新会话（POST `/api/sessions/spawn` body `{directory}`）→
   POST `/api/sessions/:id/messages` body `{text}` → 轮询 `GET /api/sessions` 等 `running:false` →
   拉 messages 出指标。探针集：热路径表单 / 对比表 / 行程组合页（Map）/ 图表 / 日期预订 / 滑动图集（**该场景慢且路由不稳定，超时属常态**）。
   **glm-5.3 时段不稳时 turn 会停在 skill/工具调用后无新消息**（CLI 等流挂起、running 滞留）——两轮同点停滞且旧 skill 复现即环境因素，勿误判为 prompt/skill 改动回归；换时段重跑。
3. 指标：肯渲染（fence 有无）/ fence 组件集（冷组件命中率）/ 工具调用数（openui_components vs Skill）/ 耗时。

## transcript 解析坑

- **消息结构三层套**：`m.content.content.data.message.content[]`（外层 role/content/meta 信封 → output 信封 → CLI message）；
  user 行 `m.content` 直接是块数组——先判 `Array.isArray`。
- **Skill 注入文本带官方示例 fence**（`root = RootComp(...)` 骨架）：取 fence 必须取**最后一个** text block 的匹配，
  取第一个会把 skill 文档里的示例当成模型输出（fenceLen=101 / RootComp 假象就是这么来的）。
- `openui-lang` fence 用 ` /```openui-lang\n([\s\S]*?)```/ ` 提取。

## 浏览器告警抽样

封口渲染错误内联提示「交互 UI 有 N 处无效语句已被忽略」——SPA 路由切会话（pushState+popstate）后等 3-4s（openui chunk 懒加载），
扫 `main` innerText 含「无效语句」即有丢弃语句；逐条错误在其后列表。

## 已知环境坑（引用既有 memory）

- bootstrap 常驻期间被 kill → trap 清空 `~/.mobi-e2e`（含 map keys）——重启环境用 setsid 完全脱离，见 [[env-bootstrap]]
- 宿主 `MOBI_API_URL` 泄漏让 vite proxy 指错：重启 web dev 必须 `env -u` 清单，见 [[env-bootstrap]]
- 登录 token `e2e-test-token-mobi`（POST `/api/auth` body 字段名是 `accessToken`）
