# AssistantPartialAssembler 基准

> 纪律来源：[docs/conventions/performance.md](../../../docs/conventions/performance.md)——
> 基准先证体感相关性，再考虑挂 CI 棘轮；本目录当前**只有基准，没有门禁**。

## 运行

### 墙钟（本机，bun）

```bash
bun packages/session/benchmarks/assistantPartialAssembler.bench.ts --iterations 3000
# BENCH iterations=3000 totalMs=... msgsPerSec=... outputs=...
```

墙钟噪声大（机器压载可劣化 10 倍），只用于相关性验证，不作为跨日对比的绝对数字。

### 指令数（Linux / CI，macOS 无 valgrind）

```bash
# bun build 解析 @/ 别名出 Node 自包含产物
bun build packages/session/benchmarks/assistantPartialAssembler.bench.ts \
    --target=node --outfile /tmp/assembler.bench.js

# node --predictable 让 V8 行为确定化，指令计数一次运行即得、无需统计
# （读数稳定但非逐位不变：同产物两次 CI 运行实测差 ~1e-3%，棘轮容差下限须高于它）
valgrind --tool=callgrind --callgrind-out-file=/tmp/cg.out \
    node --predictable /tmp/assembler.bench.js --iterations 20

callgrind_annotate /tmp/cg.out | head -30   # Ir 总数 + 热点函数
```

## 棘轮（CI 门禁）

- **`bench-ratchet`**（ci.yml job）：每次 PR 测 Ir，超过 `ir-baseline.txt` 的 2% 即失败（回潮绊网）；同时打印墙钟数字积累相关性证据。**起步时容差 2% 是临时的**——Ir↔墙钟相关性验证完成后收紧。
- **`bench-baseline`** 工作流：手动触发 + 每周一调度。Ir 改进时自动下调基线并提交（棘轮的「只降不升」半边）；基线缺失时首次创建。
  - 该工作流只在**默认分支**注册（GitHub 规则：workflow 文件不在默认分支上就不会被 Actions 注册，`gh workflow run` 报 404）。仓库默认分支若落后于开发分支，就用 bench-ratchet 失败信息里打印的 `当前 Ir=` 手工建立基线——两份代码共用 `.github/actions/ir-measure`，环境与脚本同源，读数可比。
- Ir 对 node 版本敏感：两个工作流均精确 pin `node@22.11.0`，升级 node 必须同步 pin 并重录基线（删除基线文件 → 跑 bench-baseline 重建）。同 pin 下的读数漂移 ~1e-3%——这是容差能收紧的下限，不要按「零漂移」设。

## 相关性验证流程（挂 CI 棘轮的前置条件）

1. 记录基线：同一提交下取 Ir（callgrind）与墙钟（bun，多次取中位）。
2. 做一次真实优化（哪怕手工制造，如临时去掉一个中间层），Ir 应显著下降。
3. **验证墙钟/真机体感同步变好**——下降幅度与墙钟改善方向一致，才算数。
4. 相关性成立 → 才可在 CI 加 Ir 棘轮（只降不升 + 日任务压上限）；不成立 → 撤基准，不留假指标。

## 基线记录（随优化更新）

| 日期 | 提交 | 墙钟（3000 迭代 ×3 中位，M 系列 Mac） | Ir（Linux CI） |
|---|---|---|---|
| 2026-09-24 | 建基准时的实现 | ~322ms（±1%） | 未测（需 Linux/valgrind） |
| 2026-10-13 | `3249ecbe` | 未测 | **439576525**（bench-ratchet 的实测读数，据此建立 `ir-baseline.txt`） |

