# logs 子命令

显示最新 Runner 日志文件的路径，用于调试排查问题。

## 命令流程

```mermaid
flowchart TB
    Start["mobi runner logs"] --> GetLog["getLatestRunnerLog()"]
    GetLog --> StatePath{"runner.state.json 中\nrunnerLogPath 存在?"}
    StatePath -->|是| Return["返回路径"]
    StatePath -->|否| Scan["扫描 ~/.mobi/logs/"]
    Scan --> Filter["过滤 *-runner.log 文件"]
    Filter --> Sort["按修改时间降序"]
    Sort --> Latest["取最新的"]
    Latest --> Return

    Return --> Output{"路径存在?"}
    Output -->|是| Print["输出文件路径"]
    Output -->|否| None["No runner logs found"]
```

## 日志查找逻辑

两阶段查找：

| 优先级 | 方式 | 说明 |
|--------|------|------|
| 1 | `runner.state.json` → `runnerLogPath` | Runner 启动时写入的日志路径 |
| 2 | 扫描 `~/.mobi/logs/` 目录 | 兜底，适用于 Runner 已停止但日志仍在的场景 |

## 日志文件命名

```
~/.mobi/logs/YYYY-MM-DD-HH-mm-ss-pid-<PID>-runner.log
```

示例: `~/.mobi/logs/2026-03-30-22-13-45-pid-12345-runner.log`

命名中包含时间戳和 PID，方便区分不同 Runner 实例的日志。

## 使用示例

```bash
# 查看日志路径
mobi runner logs
# 输出: ~/.mobi/logs/2026-03-30-22-13-45-pid-12345-runner.log

# 直接查看日志内容
cat "$(mobi runner logs)"

# 实时跟踪日志
tail -f "$(mobi runner logs)"
```

## 代码入口

- **命令入口**: [`packages/cli/src/commands/runner.ts:111-119`](/packages/cli/src/commands/runner.ts)
- **日志查找**: [`packages/cli/src/ui/logger.ts`](/packages/cli/src/ui/logger.ts) — `getLatestRunnerLog()`
- **日志路径写入**: [`packages/cli/src/runner/run.ts:614-623`](/packages/cli/src/runner/run.ts) — `writeRunnerState({ runnerLogPath })`
