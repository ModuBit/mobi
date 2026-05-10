# mobi

## VS Code 调试配置

通过 `.vscode/launch.json` 可以在 VS Code 中调试 Bun 程序。

如果 VS Code 无法找到 Bun（常见于从 Dock/Spotlight 启动），需在用户级设置中指定 Bun 路径：

1. **Cmd+,** 打开设置，搜索 `bun.runtime`
2. 填入 Bun 可执行文件的绝对路径，例如：
   - macOS: `/Users/<你的用户名>/.bun/bin/bun`
   - Linux: `/home/<你的用户名>/.bun/bin/bun`