#!/usr/bin/env bash
# 测量 AssistantPartialAssembler 基准的 Ir 指令数（单次运行即可，读数稳定但非逐位不变）。
# 依赖：bun（构建产物）、node（--predictable 运行）、valgrind（计数，仅 Linux）。
# 输出：stdout 仅一行 Ir 数字；被 ci.yml 的 bench-ratchet 与 bench-baseline 工作流共用。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

ITERATIONS="${BENCH_IR_ITERATIONS:-20}"

# bun build 解析 @/ 路径别名，出 Node 自包含产物（产物内容随源码变化，正是要计数的对象）
bun build packages/session/benchmarks/assistantPartialAssembler.bench.ts \
    --target=node --outfile /tmp/assembler.bench.js >/dev/null

# --predictable 让 V8 行为确定化：同 node 版本 + 同产物 → Ir 高度稳定，单次运行足够。
# 非逐位不变：同一基准产物两次 CI 运行的读数实测差 2835（≈0.0006%，2026-10-13），
# 棘轮容差的下限因此不能压到这个量级以下（当前 2%，见 ci.yml bench-ratchet）
valgrind --tool=callgrind --callgrind-out-file=/tmp/cg.out \
    node --predictable /tmp/assembler.bench.js --iterations "$ITERATIONS" >/dev/null

# callgrind 输出末尾的 summary 行即总指令数
grep -m1 '^summary:' /tmp/cg.out | awk '{print $2}'
