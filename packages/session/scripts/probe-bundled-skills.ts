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
 * 一次性探测（skill-mgmt 票 06 前置验证）：headless SDK query 在 $TMPDIR/mobi-probe 下
 * 能否拿到 builtin 标 SlashCommand ∩ init.skills 的交集（= CC 内置 bundled skill 名单）。
 *
 * 验证点：①陌生目录无 trust 阻塞；②init 帧含 skills 名单与 claude_code_version；
 * ③bundled skill（如 doctor/verify）是否进 init.skills（决定交集法 vs 退化方案）。
 * 用完即删临时目录。
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const probeDir = join(tmpdir(), 'mobi-probe')
rmSync(probeDir, { recursive: true, force: true })
mkdtempSync(probeDir) // mkdtemp 会在 probeDir 后追加随机串——固定单目录语义要求 rm+mkdir，这里探测用随机子目录即可
rmSync(probeDir, { recursive: true, force: true })
const { mkdirSync } = await import('node:fs')
mkdirSync(probeDir, { recursive: true })

const started = Date.now()
const q = query({
    prompt: 'Reply with just: OK',
    options: {
        cwd: probeDir,
        permissionMode: 'bypassPermissions',
        maxTurns: 1,
    },
})

let initSkills: string[] | null = null
let claudeVersion: string | null = null

for await (const message of q) {
    if (message.type === 'system' && message.subtype === 'init') {
        const init = message as { skills?: string[]; claude_code_version?: string; slash_commands?: string[] }
        initSkills = init.skills ?? []
        claudeVersion = init.claude_code_version ?? null
        console.log('init.claude_code_version =', claudeVersion)
        console.log('init.skills =', JSON.stringify(initSkills))
        console.log('init.slash_commands =', JSON.stringify(init.slash_commands))
        break // 拿到 init 即可断流
    }
}

const commands = await q.supportedCommands()
console.log('supportedCommands builtin =', JSON.stringify(
    commands.filter(c => c.builtin).map(c => ({ name: c.name, description: c.description })),
))

if (initSkills) {
    const skillSet = new Set(initSkills)
    const bundled = commands.filter(c => c.builtin && skillSet.has(c.name))
    console.log('交集（builtin ∩ init.skills）=', JSON.stringify(
        bundled.map(c => ({ name: c.name, description: c.description })),
    ))
    console.log('builtin 但不在 init.skills（纯命令）=', JSON.stringify(
        commands.filter(c => c.builtin && !skillSet.has(c.name)).map(c => c.name),
    ))
}

console.log('elapsed_ms =', Date.now() - started)
rmSync(probeDir, { recursive: true, force: true })
process.exit(0)
