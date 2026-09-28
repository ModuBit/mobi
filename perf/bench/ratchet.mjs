#!/usr/bin/env bun
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
 * 棘轮：对照 caps.json 的 p75 上限校验 bench 输出，只许降不许升。
 *
 * 用法：
 *   bun perf/bench/ratchet.mjs --bench perf/bench/runs/base.json        # 校验，超限退出码 1
 *   bun perf/bench/ratchet.mjs --bench perf/bench/runs/base.json --update  # 确认无退化后刷新上限
 *
 * caps.json 结构：{ "<target>/<profile>": { "readyP75Ms": <毫秒上限> } }
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
    options: {
        bench: { type: 'string' },
        caps: { type: 'string', default: 'perf/bench/caps.json' },
        update: { type: 'boolean' },
    },
})

if (!values.bench || !existsSync(values.bench)) {
    console.error('--bench 必须指向 bench.mjs 的输出 JSON')
    process.exit(2)
}

const bench = JSON.parse(readFileSync(values.bench, 'utf8'))
const capsPath = path.resolve(values.caps)
const caps = existsSync(capsPath) ? JSON.parse(readFileSync(capsPath, 'utf8')) : {}
const key = `${bench.target}/${bench.profile}`
const cap = caps[key]?.readyP75Ms
const actual = bench.summary.readyP75

if (values.update) {
    if (cap !== undefined && actual > cap) {
        console.error(`拒绝更新：${key} p75=${actual.toFixed(0)}ms 超过现上限 ${cap}ms——先查退化，确认测量口径变更后再手动改 caps.json`)
        process.exit(1)
    }
    caps[key] = { readyP75Ms: Math.round(actual) }
    await Bun.write(capsPath, JSON.stringify(caps, null, 2) + '\n')
    console.log(`上限已写入 ${values.caps}: ${key} → ${Math.round(actual)}ms`)
    process.exit(0)
}

if (cap === undefined) {
    console.error(`caps.json 里没有 ${key} 的上限——先用 --update 建立基线`)
    process.exit(1)
}

if (actual > cap) {
    console.error(`棘轮触发：${key} p75=${actual.toFixed(0)}ms > 上限 ${cap}ms（+${(actual - cap).toFixed(0)}ms）`)
    process.exit(1)
}

console.log(`通过：${key} p75=${actual.toFixed(0)}ms ≤ 上限 ${cap}ms（余量 ${(cap - actual).toFixed(0)}ms）`)
