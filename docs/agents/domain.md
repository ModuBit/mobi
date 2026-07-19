# Domain Docs

engineering skills 探索代码库时应如何消费本仓库的 domain 文档。

## Before exploring, read these

- **`CONTEXT-MAP.md`**（仓库根）— multi-context 布局的入口，指向每个 context 的 `CONTEXT.md`。按主题读取相关包的那一份。
- 各包的 **`CONTEXT.md`**：`packages/shared/`、`packages/hub/`、`packages/cli/`、`packages/web/`
- **`docs/adr/`** — 系统级架构决策。涉及某包时也检查该包目录下是否有 context 级 ADR。
- **项目既有文档**（补充）：`docs/architecture/`（模块架构）、`docs/conventions/`（编码规范）、各包 `CLAUDE.md`。

若上述文件不存在，**静默继续**。不要标记缺失，也不要预先建议创建。`/domain-modeling` skill 会在术语或决策真正落定时按需创建它们。

## File structure

Multi-context 布局：

```
/
├── CONTEXT-MAP.md                      ← 指向各包 CONTEXT.md
├── docs/adr/                           ← 系统级决策
└── packages/
    ├── shared/CONTEXT.md
    ├── hub/CONTEXT.md
    ├── cli/CONTEXT.md
    └── web/CONTEXT.md
```

## Use the glossary's vocabulary

输出中提到 domain 概念时（issue 标题、重构提案、假设、测试名），使用 `CONTEXT.md` 中定义的术语，不要漂移到 glossary 明确避免的同义词。

若所需概念尚未收录，这是一个信号 — 要么你在发明项目不使用的语言（重新考虑），要么存在真实缺口（记下供 `/domain-modeling` 处理）。

## Flag ADR conflicts

若你的输出与既有 ADR 冲突，显式标出而非静默覆盖：

> _Contradicts ADR-0007 (...) — 但值得重开因为…_
