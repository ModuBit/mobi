# Web 工具配置 API

**文件**: [`packages/hub/src/web/routes/webTools.ts`](/packages/hub/src/web/routes/webTools.ts)

mobi 自定义 Web 工具（替换 CC 内置 WebSearch/WebFetch）的配置入口。**hub 纯透传、零存储**：配置真相源在目标机器的 `~/.mobi/settings.json` 的 `webTools` 段，读写经 [RpcGateway](../../sync/rpc-gateway.md) 的 machine 级 RPC 转发给 runner。

## 端点

| 方法 | 路径 | 说明 | 要求 |
|------|------|------|------|
| `GET` | `/api/machines/:id/web-tools` | 读取配置（凭据脱敏回显） | 机器在线 |
| `POST` | `/api/machines/:id/web-tools` | 写入配置（校验 + 凭据 merge + 原子落盘） | 机器在线 |

两个端点均经 `requireMachine` 鉴权（machine 不存在 → 404，namespace 不匹配 → 403）。

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
                "credentials": { "apiKey": { "set": true } }
            }
        ]
    }
}
```

凭据只回显"设没设"（`{ set: boolean }`），不回传明文。

## POST /machines/:id/web-tools

```json
// Request
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

```json
// Response —— 业务失败也是 200 envelope（与既有 RPC 路由约定一致）
{ "success": true }
{ "success": false, "error": "provider \"tavily\" 缺少凭据：apiKey" }
```

- **凭据 merge 语义**（runner 侧执行）：`credentials` 中空字符串 = 保持旧值不动；非空 = 覆盖
- **错误码**：body 缺 `config` → 400；runner RPC 传输层不可达/超时 → 502（业务失败走 envelope 200）

## 相关链路

- 协议类型：`@mobi/shared` 的 `WebToolsConfigSchema` / `RedactedWebToolsConfig`
- runner RPC handler：[`packages/cli/src/modules/common/handlers/webToolsConfig.ts`](/packages/cli/src/modules/common/handlers/webToolsConfig.ts)
- Web 配置页：`packages/web/src/components/settings/WebToolsSettings.tsx`
