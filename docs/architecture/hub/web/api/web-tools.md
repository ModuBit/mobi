# Web 工具配置 API

**文件**: [`packages/hub/src/web/routes/webTools.ts`](/packages/hub/src/web/routes/webTools.ts)

mobi 自定义 Web 工具（替换 CC 内置 WebSearch/WebFetch）的配置入口。**hub 纯透传、零存储**：配置真相源在目标机器的 `~/.mobi/settings.json` 的 `webTools` 段，读写经 [RpcGateway](../../sync/rpc-gateway.md) 的 machine 级 RPC 转发给 runner。

## 端点

| 方法 | 路径 | 说明 | 要求 |
|------|------|------|------|
| `GET` | `/api/machines/:id/web-tools` | 读取配置（凭据脱敏回显） | 机器在线 |
| `POST` | `/api/machines/:id/web-tools` | 写入配置（校验 + 凭据 merge + 原子落盘） | 机器在线 |
| `POST` | `/api/machines/:id/web-tools/verify` | 验证 provider 连通性（一次真实搜索，不落盘） | 机器在线 |

三个端点均经 `requireMachine` 鉴权（machine 不存在 → 404，namespace 不匹配 → 403）。

## GET /machines/:id/web-tools

```json
// Response（runner RPC get-web-tools-config 的透传）
{
    "config": {
        "searchProviderId": "tavily",
        "fetchProviderId": "tavily",
        "providers": [
            {
                "id": "tavily",
                "enabled": true,
                "timeoutMs": 15000,
                "credentials": { "apiKey": { "set": true, "preview": "tvly-******89" } }
            }
        ]
    }
}
```

凭据只回显"设没设"与掩码预览（`{ set: boolean; preview?: string }`，`preview` 为 `maskCredential` 掩码产物），不回传明文。

## POST /machines/:id/web-tools

```json
// Request —— config 经 WebToolsConfigSubmissionSchema 校验（提交方向：credentials 值为 string | null）
{
    "config": {
        "searchProviderId": "tavily",
        "fetchProviderId": "tavily",
        "providers": [
            { "id": "tavily", "enabled": true, "credentials": { "apiKey": "tvly-xxx" } }
        ]
    }
}
```

提交方向 `credentials` 值为 `string | null`：`"apiKey": null` 表示清除该凭据，键不在场表示未修改（详见下方在场性语义）。

```json
// Response —— 业务失败也是 200 envelope（与既有 RPC 路由约定一致）
{ "success": true }
{ "success": false, "error": "provider \"tavily\" 缺少凭据：apiKey" }
```

- **凭据 merge 在场性语义**（runner 侧执行）：键不在场 = 保持旧值（新 UI 未修改）；空串 = 保持旧值（旧客户端全量提交兼容）；`null` = 清除；非空 = 覆盖。仅对 `credentialKeysFor` 声明键生效，脏键不落盘
- **错误码**：body 缺 `config` → 400；runner RPC 传输层不可达/超时 → 502（业务失败走 envelope 200）

## POST /machines/:id/web-tools/verify

保存前验证 provider 凭据连通性：runner 用草稿凭据（非空且为声明键时优先）合成后发起一次真实搜索，返回往返延迟。不落盘、不回传凭据值。

```json
// Request
{ "providerId": "tavily", "credentials": { "apiKey": "tvly-draft-xxx" } }
```

```json
// Response —— 业务失败也是 200 envelope
{ "success": true, "latencyMs": 842 }
{ "success": false, "error": "缺少凭据：apiKey" }
```

- **错误码**：body 缺 `providerId` → 400；runner RPC 传输层不可达/超时 → 502（业务失败走 envelope 200）

## 相关链路

- 协议类型：`@mobi/shared` 的 `WebToolsConfigSchema` / `WebToolsConfigSubmissionSchema` / `RedactedWebToolsConfig` / `maskCredential`
- runner RPC handler：[`packages/cli/src/modules/common/handlers/webToolsConfig.ts`](/packages/cli/src/modules/common/handlers/webToolsConfig.ts)
- Web 配置页：`packages/web/src/components/settings/webtools/`（分区入口见 `sections/WebToolsSection.tsx`）
