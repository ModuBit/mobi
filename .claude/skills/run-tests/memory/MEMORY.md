# E2E 学习记忆索引

E2E 操作的「越用越熟」知识库。每次 E2E **前先读**相关条目照做，**后回写**新发现 / 变化 / 弯路。维护纪律见 `../SKILL.md`「E2E 学习记忆（自优化）」。稳定的原则与命令参考仍在 `../references/e2e.md`。

- [环境启动](env-bootstrap.md) — bootstrap / cleanup / 就绪判断 / profile 检查 / 端口隔离 / 故障恢复
- [浏览器连接](browser-connect.md) — Chrome DevTools MCP 复用、僵尸进程清理
- [登录](login.md) — token 输入 + Connect 提交、验证跳转
- [自定义输入框操作](input-box.md) — click → Ctrl+A → type_text 通用规范（登录 / 聊天共用）
- [创建会话](create-session.md) — 项目即环境：可搜索下拉选项目 / 下拉底部新建项目自动回填 / 发消息即建
- [项目实体化 UI](create-project.md) — 建项目 / 项目内新建会话 / 归入项目往返 / 编辑 folders / 删项目（Escape 关 modal / hover 按钮 evaluate click 坑）
- [终端游离会话](terminal-session.md) — script 造 PTY 后台跑 CLI，会话入 Recent
- [文件树验证](file-tree-verify.md) — 展开 inspector 文件树 / 虚拟滚动下数条目（看 network 响应非 DOM）/ 截断字段
- [对话与验证](chat-verify.md) — 发消息 / 等待轮询 / 权限审批 / 排队消息 / 停止按钮（composer 合并按钮）/ 渲染验证
- [plan 模式切换验证](plan-mode-verify.md) — 切 plan / 触发 exit_plan_mode / 批准四档按钮 / 模式生效观测点（composer 指示器 + 编辑是否弹审批）
- [通用误判](pitfalls-general.md) — 不归属单一任务的经验（token 用途、诊断命令、短生命周期 DOM 验证、工具禁用）
- [调试解锁 E2E](debug-unlock-e2e.md) — evaluate_script 模拟连点 + 拦截 a.click 捕获下载
- [贴底跟随验证](scroll-follow-verify.md) — virtuoso DOM 锚点、rAF 探针、触发真流式的 prompt、指标阈值
- [标题同步验证](title-sync-verify.md) — Web rename / change_title MCP 回写 CC customTitle，查 jsonl custom-title entry，rename 框 Ctrl+A 追加坑
- [teammate 生命周期验证](teammate-verify.md) — 派带 name 的 Agent / 审批时序 / DB 轮询 teamState / envelope role 恒为 agent 的坑
- [Web 工具验证](web-tools-verify.md) — 设置页 Web Tools 卡片操作 / webTools 落盘断言 / merge 语义 / toolAliases 401 链路证据 / alias 不隐藏原始 MCP 工具的坑
- [native_id 绑定验证](native-id-verify.md) — SQL 断言各 push 路径绑定 / API 暴露；排队消息多走 steer 各自绑定；首回合 Change Title 审批卡输入坑
- [rewind 全链路验证](rewind-verify.md) — 按钮/ack/dry-run/截断上下文探针/连续 rewind/回填断言；进行中窗口 <2s 抓不到的坑
