# E2E 学习记忆索引

E2E 操作的「越用越熟」知识库。每次 E2E **前先读**相关条目照做，**后回写**新发现 / 变化 / 弯路。维护纪律见 `../SKILL.md`「E2E 学习记忆（自优化）」。稳定的原则与命令参考仍在 `../references/e2e.md`。

- [环境启动](env-bootstrap.md) — bootstrap / cleanup / 就绪判断 / profile 检查 / 端口隔离 / 故障恢复
- [浏览器连接](browser-connect.md) — Chrome DevTools MCP 复用、僵尸进程清理
- [登录](login.md) — token 输入 + Connect 提交、验证跳转
- [自定义输入框操作](input-box.md) — click → Ctrl+A → type_text 通用规范（登录 / 聊天共用）
- [创建会话](create-session.md) — 新建 / 选机器 / 工作目录
- [对话与验证](chat-verify.md) — 发消息 / 等待轮询 / 权限审批 / 排队消息 / 停止按钮（composer 合并按钮）/ 渲染验证
- [通用误判](pitfalls-general.md) — 不归属单一任务的经验（token 用途、诊断命令、短生命周期 DOM 验证、工具禁用）
- [调试解锁 E2E](debug-unlock-e2e.md) — evaluate_script 模拟连点 + 拦截 a.click 捕获下载
