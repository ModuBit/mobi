# list 子命令
列出 Runner 續理的所有活跃会话。

## 命令流程
```
mobi runner list
        │
        │ HTTP POST /list
        │
        │ runner.controlClient.ts:listRunnerSessions()
        │
        │ 返回会话列表
```

### HTTP 请求

通过 HTTP 向 ControlServer 请求:
- **端点**: `/list`
- **方法**: `listRunnerSessions()`
- **响应**: 活跃会话列表
    - startedBy: 会话启动来源
    - MztSessionId: Mobi 会话 ID
    - pid: 进程 ID