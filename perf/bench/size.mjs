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
 * 体积棘轮：对 web 构建产物的 JS 体积设上限，只许小涨（头寸内）不许大退化。
 *
 * 为什么不用 p75 棘轮进 CI：CI runner 硬件浮动，跨 run 比较绝对耗时是
 * 「分开时段测」的假对比（perf/基线.md 测量口径）；而构建产物字节数是
 * 确定性指标，能拦住「bundle 悄悄变大」这类最常见的性能退化。
 * 运行时 p75 棘轮（bench.mjs + ratchet.mjs + caps.json）留在本机手动跑。
 *
 * 指标（KB，原始字节，仅 *.js）：
 * - totalJs：dist/assets 全部 JS——整体膨胀
 * - criticalJs：index.html 引用（script + modulepreload）的 JS——首屏关键路径
 * - maxChunk：最大单 chunk——单点爆炸
 *
 * 用法：
 *   bun perf/bench/size.mjs                     # 校验，超限退出码 1
 *   bun perf/bench/size.mjs --update            # 以当前产物 +5% 头寸刷新上限
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const DIST = path.resolve('packages/web/dist')
const CAPS = path.resolve('perf/bench/size-caps.json')
/** 刷新上限时预留的头寸：构建器版本差异 / 哈希抖动的噪声余量 */
const HEADROOM = 1.05

const { values } = parseArgs({
    options: { update: { type: 'boolean' } },
})

if (!existsSync(DIST)) {
    console.error(`找不到 ${DIST}——先 bun run build:web`)
    process.exit(2)
}

const assetsDir = path.join(DIST, 'assets')
const jsFiles = readdirSync(assetsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => {
        const file = path.join(assetsDir, f)
        return { name: f, bytes: statSync(file).size }
    })

// 首屏关键路径：index.html 里 <script src> 与 <link rel=modulepreload href> 引用的 JS
const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
const critical = new Set()
// 标签属性顺序不定（crossorigin 在 src/href 前），逐标签匹配 src/href；
// 路径带前导斜杠（/assets/...），剥掉后与 assets/ 下相对名对齐
for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const m = tag[0].match(/\b(?:src|href)="(\/assets\/[^"]+\.js)"/)
    if (m) critical.add(m[1].slice(1))
}

const kb = bytes => Math.round(bytes / 1024)
const metrics = {
    totalJs: kb(jsFiles.reduce((s, f) => s + f.bytes, 0)),
    criticalJs: kb(jsFiles.filter(f => critical.has(`assets/${f.name}`)).reduce((s, f) => s + f.bytes, 0)),
    maxChunk: kb(Math.max(...jsFiles.map(f => f.bytes))),
}

console.log(`JS 文件 ${jsFiles.length} 个（关键路径 ${critical.size} 个）`)
console.log(`totalJs=${metrics.totalJs}KB  criticalJs=${metrics.criticalJs}KB  maxChunk=${metrics.maxChunk}KB`)

const caps = existsSync(CAPS) ? JSON.parse(readFileSync(CAPS, 'utf8')) : {}

if (values.update) {
    const next = Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, Math.ceil(v * HEADROOM)]),
    )
    await Bun.write(CAPS, JSON.stringify(next, null, 2) + '\n')
    console.log(`\n上限已写入 ${path.relative(process.cwd(), CAPS)}（+${Math.round((HEADROOM - 1) * 100)}% 头寸）:`, next)
    process.exit(0)
}

if (!caps.totalJs) {
    console.error('\nsize-caps.json 不存在或为空——先跑 bun perf/bench/size.mjs --update 建立基线')
    process.exit(1)
}

let failed = false
for (const [key, value] of Object.entries(metrics)) {
    const cap = caps[key]
    if (cap === undefined) continue
    if (value > cap) {
        console.error(`✗ ${key}=${value}KB > 上限 ${cap}KB（+${value - cap}KB）——bundle 回潮，先优化体积；确需放宽跑 bun perf/bench/size.mjs --update 并在 PR 说明`)
        failed = true
    } else {
        console.log(`✓ ${key}=${value}KB ≤ 上限 ${cap}KB（余量 ${cap - value}KB）`)
    }
}
process.exit(failed ? 1 : 0)
