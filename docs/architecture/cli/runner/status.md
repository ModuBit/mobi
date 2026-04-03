# status 子命令

运行 doctor 诊断并显示 Runner 状态信息。

## 命令流程
```
mobi runner status
        │
        │ 调用 `runDoctorCommand('runner')`
```
### 诊断逻辑

通过 `doctor` 命令运行 runner 诊断:
详见 [Doctor 系统诊断](../doctor)。

## 代码入口
- **命令入口**: `cli/src/commands/runner.ts:106-108`
- **核心逻辑**: `cli/src/commands/runner.ts:106-109`
    `runDoctorCommand('runner')`
