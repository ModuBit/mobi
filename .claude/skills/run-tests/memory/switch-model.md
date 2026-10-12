---
name: switch-model
description: E2E 会话切模型 — 模型下拉为空时改走 POST /api/sessions/:id/model；CC Switch 本地 proxy 前缀路由与模型 ID 取法
metadata:
  type: recipe
  last_verified: 2026-10-12
---

# E2E 切模型（模型不可用 / 429 配额耗尽时）

## 现象（2026-10-12）

- 新建会话页模型下拉显示 `Sonnet`，会话内显示宿主当前模型（如 `glm-5.3-flash`），
  **两处点开 listbox 都是空的**——UI 无从切换。
- 根因：宿主 Claude Code 走 **CC Switch.app**（`~/.cc-switch/`，本地 proxy
  `127.0.0.1:15721`）。E2E bootstrap 只 `env -u MOBI_*`，**`ANTHROPIC_*` 全量继承宿主**，
  故 CLI 用宿主当前 provider 的模型。CC Switch 的 `/v1/models` 返回 `{"models":[]}`，
  CLI 的 `initializationResult()` 亦不带 `models` 字段 → mobi 模型下拉无选项。
  **列表为空 ≠ 不能切模型**，接口接受任意 model 值。

## 切换 recipe（不用重启 daemon）

页面内 fetch（cookie 认证，`credentials: 'include'`）：

```js
await fetch('/api/sessions/<sessionId>/model', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ model: 'ccs-claude-deepseek--deepseek-v4.1-flash-expires-on-0910[1M]' }),
})   // → {"ok":true}
```

刷新页面 → 模型显示位更新；**下一回合**即走新模型（CLI 内部重启 + resume，无需碰 daemon）。

## 模型 ID 的取法

形态：`ccs-claude-<providerSlug>--<modelName>`（CC Switch proxy 的路由前缀）。
`providerSlug` = provider 名小写（Zhipu GLM → `zhipu`；DeepSeek → `deepseek`）。

裸模型名从 CC Switch DB 读（**只取 model 字段，避开 api key**）：

```bash
sqlite3 ~/.cc-switch/cc-switch.db \
  "select settings_config from providers where name='DeepSeek';" \
  | jq -r '.env.ANTHROPIC_MODEL'          # → deepseek-v4.1-flash-expires-on-0910[1M]
sqlite3 -json ~/.cc-switch/cc-switch.db \
  "select id, name, app_type, is_current from providers;"   # 拿 provider 清单（不含密钥）
```

宿主当前用的是哪些前缀，看 `env | grep -i anthropic`（`ANTHROPIC_DEFAULT_SONNET_MODEL` 等）。

## 先验证路由通不通（可选，省一次 UI 往返）

```bash
curl -s -X POST http://127.0.0.1:15721/v1/messages \
  -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" \
  -H "content-type: application/json" -H "anthropic-version: 2023-06-01" \
  -d '{"model":"ccs-claude-deepseek--deepseek-v4.1-flash-expires-on-0910[1M]","max_tokens":16,
       "messages":[{"role":"user","content":"say OK"}]}'
```

返回正常 message 即前缀路由可用。

## 坑

- **别读 `~/.claude/settings.json`**（会被权限拒）；env 已经够判断当前模型。
- **429 配额耗尽的表现**：错误气泡文案形如
  `API Error: Request rejected (429) · [1310][您已达到每周/每月使用上限…]`，
  且 CLI 会先重试 10 次（每次 UI 显示「API 限流（重试 N/10）+ N 秒后重试」）→ 换模型比重试快。
- 换 provider 后**新建会话**仍用宿主 env 的模型（下拉空无法预选）——只能建完再切。
