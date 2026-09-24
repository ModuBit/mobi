/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

# AssistantPartialAssembler 基准

> 纪律来源：[docs/conventions/performance.md](../../../docs/conventions/performance.md)——
> 基准先证体感相关性，再考虑挂 CI 棘轮；本目录当前**只有基准，没有门禁**。

## 运行

### 墙钟（本机，bun）

```bash
bun packages/cli/benchmarks/assistantPartialAssembler.bench.ts --iterations 3000
# BENCH iterations=3000 totalMs=... msgsPerSec=... outputs=...
```

墙钟噪声大（机器压载可劣化 10 倍），只用于相关性验证，不作为跨日对比的绝对数字。

### 指令数（Linux / CI，macOS 无 valgrind）

```bash
# bun build 解析 @/ 别名出 Node 自包含产物
bun build packages/cli/benchmarks/assistantPartialAssembler.bench.ts \
    --target=node --outfile /tmp/assembler.bench.js

# node --predictable 让 V8 行为确定化，指令计数一次运行即得、无需统计
valgrind --tool=callgrind --callgrind-out-file=/tmp/cg.out \
    node --predictable /tmp/assembler.bench.js --iterations 20

callgrind_annotate /tmp/cg.out | head -30   # Ir 总数 + 热点函数
```

## 相关性验证流程（挂 CI 棘轮的前置条件）

1. 记录基线：同一提交下取 Ir（callgrind）与墙钟（bun，多次取中位）。
2. 做一次真实优化（哪怕手工制造，如临时去掉一个中间层），Ir 应显著下降。
3. **验证墙钟/真机体感同步变好**——下降幅度与墙钟改善方向一致，才算数。
4. 相关性成立 → 才可在 CI 加 Ir 棘轮（只降不升 + 日任务压上限）；不成立 → 撤基准，不留假指标。

## 基线记录（随优化更新）

| 日期 | 提交 | 墙钟（3000 迭代 ×3 中位，M 系列 Mac） | Ir（Linux CI） |
|---|---|---|---|
| 2026-09-24 | 建基准时的实现 | ~322ms（±1%） | 未测（需 Linux/valgrind） |

