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
 * skillOverrides 写通道（skill-mgmt 票 03）：归属层 settings.json 的最小侵入读写。
 *
 * 「最小侵入」契约：读 → 只动 skillOverrides.<name> 一个键 → 原样写回
 * （其余键与顶层结构逐字保留；JSON.parse 保键序，2 空格缩进 + 尾换行对齐 CC 手写习惯）。
 * 文件不存在时创建仅含目标键的最小文档；整文件 JSON 损坏时拒绝写入（不吞用户数据）。
 * 落盘走 writeFileAtomic（tmp+rename，事实源落盘统一纪律）：裸 writeFileSync 半程崩溃
 * 会把 settings.json 截断成坏 JSON，后续所有启停永久 500。
 */
import { existsSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from '@mobi/node-core/git/atomicWrite'
import type { SkillOverrideState } from '@mobi/shared'

/** 写入目标键后原样回写；返回 false = 文件损坏拒绝写（调用方透传错误） */
export async function writeSkillOverride(settingsPath: string, skillName: string, state: SkillOverrideState): Promise<boolean> {
    let doc: Record<string, unknown>
    if (existsSync(settingsPath)) {
        try {
            doc = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
            if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false
        } catch {
            return false
        }
    } else {
        doc = {}
    }

    const overrides = { ...(doc.skillOverrides as Record<string, unknown> | undefined ?? {}) }
    overrides[skillName] = state
    doc.skillOverrides = overrides

    await writeFileAtomic(settingsPath, `${JSON.stringify(doc, null, 2)}\n`)
    return true
}
