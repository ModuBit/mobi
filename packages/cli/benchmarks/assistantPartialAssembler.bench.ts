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

/**
 * AssistantPartialAssembler 基准入口（确定性 fixture 重放）
 *
 * 用法（详见 benchmarks/README.md）：
 * - 墙钟：`bun packages/cli/benchmarks/assistantPartialAssembler.bench.ts --iterations 3000`
 * - 指令数（Linux）：bun build --target=node 出自包含产物后，
 *   `valgrind --tool=callgrind node --predictable /tmp/assembler.bench.js --iterations 20`
 *
 * 输出单行 `BENCH iterations=<n> totalMs=<ms> msgsPerSec=<n> outputs=<n>`，便于脚本采集。
 * 每次重放末尾断言输出总数 === fixture 声明的 expectedOutputs——装配语义回归会直接炸掉基准，
 * 防止「对坏掉的行为计数」。
 */

import { AssistantPartialAssembler } from '@/claude/utils/assistantPartialAssembler'
import { buildFixture } from './assistantPartialAssembler.fixture'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

function argIterations(): number {
    const i = process.argv.indexOf('--iterations')
    return i >= 0 ? Number.parseInt(process.argv[i + 1] ?? '', 10) || 3000 : 3000
}

const iterations = argIterations()
// 回合数固定 300：规模变化由 iterations 表达，数字才可跨时间对比
const { messages, expectedOutputs } = buildFixture(300)

// 首轮兼作语义校验：装配输出总数必须与 fixture 声明一致
function replay(): number {
    const out: SDKMessage[] = []
    const assembler = new AssistantPartialAssembler(m => out.push(m))
    for (const message of messages) assembler.submit(message)
    assembler.flushAll()
    return out.length
}

const first = replay()
if (first !== expectedOutputs) {
    console.error(`BENCH FAILED: outputs=${first} expected=${expectedOutputs}`)
    process.exit(1)
}

const start = process.hrtime.bigint()
let outputs = 0
for (let i = 0; i < iterations; i++) outputs += replay()
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6

console.log(`BENCH iterations=${iterations} totalMs=${elapsedMs.toFixed(1)} msgsPerSec=${Math.round((iterations * messages.length) / (elapsedMs / 1000))} outputs=${outputs}`)
