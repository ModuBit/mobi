# stop 子命令

停止 Runner 进程，会话继续运行但 Runner 不再管理会话。

## 命令流程

```
mobi runner stop
        │
        │ HTTP POST /stop │
        │   └───→ 优雅关闭
        │ 强制终止
```

### 优雅关闭

通过 HTTP `/stop` 端点请求 Runner 停止。

```mermaid
sequenceDiagram
    CLI->>+: HTTP: POST /stop
    HTTP->>+ Response: Runner 收到请求
    Response --> StopControlServer["关闭 ControlServer"]
    StopControlServer --> Wait: 等待进程死亡（2s)
    Wait -->|成功| Done["优雅关闭"]
    Wait -->|超时| Force["强制终止"]
    Force --> KillProcess["杀死进程"]
```

### 强制终止
如果 HTTP 关闭失败或超时，强制杀死 Runner 进程。

**代码入口**: `cli/src/commands/runner.ts:101-104`

**核心逻辑**: `cli/src/runner/controlClient.ts:233-265`

**调用**: `stopRunner()`

**流程**:
1. 读取 `runner.state.json`
2. 检查进程是否存活
3. 尝试 HTTP `/stop`
4. 磀存则强制杀死进程
5. 清理状态文件

**代码入口**: `cli/src/commands/runner.ts:101-104`

**核心逻辑**: `cli/src/runner/controlClient.ts:233-265`

**调用**: `stopRunner()`

## 错误处理

- HTTP 请求失败 → 返回错误
- 进程已死亡 → 清理状态文件
- 强制终止超时 → `killProcess()`

## 代码入口
- **命令入口**: `cli/src/commands/runner.ts:101-104`
- **核心逻辑**: `cli/src/runner/controlClient.ts:233-265`

**调用**: `stopRunner()`
