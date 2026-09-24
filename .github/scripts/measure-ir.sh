#!/usr/bin/env bash
# 测量 AssistantPartialAssembler 基准的 Ir 指令数（单次运行，确定性读数）。
# 依赖：bun（构建产物）、node（--predictable 运行）、valgrind（计数，仅 Linux）。
# 输出：stdout 仅一行 Ir 数字；被 ci.yml 的 bench-ratchet 与 bench-baseline 工作流共用。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

ITERATIONS="${BENCH_IR_ITERATIONS:-20}"

# bun build 解析 @/ 路径别名，出 Node 自包含产物（产物内容随源码变化，正是要计数的对象）
bun build packages/cli/benchmarks/assistantPartialAssembler.bench.ts \
    --target=node --outfile /tmp/assembler.bench.js >/dev/null

# --predictable 让 V8 行为确定化：同 node 版本 + 同产物 → Ir 逐位可复现
valgrind --tool=callgrind --callgrind-out-file=/tmp/cg.out \
    node --predictable /tmp/assembler.bench.js --iterations "$ITERATIONS" >/dev/null

# callgrind 输出末尾的 summary 行即总指令数
grep -m1 '^summary:' /tmp/cg.out | awk '{print $2}'
