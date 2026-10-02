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
 * 旧单文件 settings.json → settings.hub.json + settings.cli.json 的自动迁移。
 *
 * 背景：2026-09-05 起配置按部署归属拆分（hub 与 cli 支持不同机器部署）。
 * 迁移在 hub 启动时执行一次：旧文件存在 → 按字段归属拆入两个新文件
 * （新文件已有值不覆盖）→ 旧文件 rename 为 settings.json.bak 保留。
 *
 * 语义：
 * - 旧文件解析失败 → fail-fast 不动文件（沿用 hub 防丢语义，由调用方报错退出）
 * - 无旧文件 → 幂等跳过
 * - 新文件已存在（如升级后先跑过 wizard）→ 旧字段仅补缺、不覆盖新文件已有值，之后同样归档
 */
import { existsSync } from 'node:fs'
import { rename, readFile } from 'node:fs/promises'
import { hubLogger } from '../logger'
import { getCliSettingsFile, getLegacySettingsFile, getSettingsFile, updateSettingsFile } from './settings'

/** 迁移结果 */
export interface MigrationResult {
    migrated: boolean
    /** 迁移原因说明（未迁移时也有值） */
    reason: 'no-legacy' | 'migrated' | 'parse-error'
}

/** cli 专属字段：迁移时落 settings.cli.json，其余（hub 接口内字段）落 settings.hub.json */
const CLI_ONLY_FIELDS = [
    'machineId',
    'apiUrl',
    'serverUrl',
    'updateChannel',
    'disconnectTimeoutMs',
    'idleTimeoutMs',
    'timeoutWarningMs',
    'claudeEnv',
    'bashInjectContext',
    'webTools',
] as const

/** 死字段（零读写点）：不迁移，随旧文件 .bak 归档 */
const DEAD_FIELDS = ['machineIdConfirmedByServer', 'runnerAutoStartWhenRunningMobi'] as const

export async function migrateLegacySettings(dataDir: string): Promise<MigrationResult> {
    const legacyFile = getLegacySettingsFile(dataDir)
    const hubFile = getSettingsFile(dataDir)

    if (!existsSync(legacyFile)) {
        return { migrated: false, reason: 'no-legacy' }
    }

    let legacy: Record<string, unknown>
    try {
        legacy = JSON.parse(await readFile(legacyFile, 'utf8')) as Record<string, unknown>
    } catch (error) {
        hubLogger.error(`[Hub] Legacy ${legacyFile} exists but cannot be parsed. Please fix or remove it and restart.`, error)
        return { migrated: false, reason: 'parse-error' }
    }

    // 按归属拆分：cli 专属字段落 cli 文件，其余（hub Settings 已裁剪，只认得 hub 字段）
    // 落 hub 文件；死字段丢弃（留在 .bak 归档）
    const cliSplit: Record<string, unknown> = {}
    const hubSplit: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(legacy)) {
        if ((DEAD_FIELDS as readonly string[]).includes(key)) continue
        if ((CLI_ONLY_FIELDS as readonly string[]).includes(key)) {
            cliSplit[key] = value
        } else {
            hubSplit[key] = value
        }
    }

    // 补缺合并而非整文件覆盖：新文件已存在时（升级后先跑过 wizard 等）保留其已有值，
    // 旧文件只填缺失字段；锁内读-改-写与其他写点互斥。
    // cli 拆分结果为空且 cli 文件不存在时不写：空 {} 占位会阻断 co-located 同步
    await updateSettingsFile(hubFile, (existing) => ({ ...hubSplit, ...existing }))
    if (Object.keys(cliSplit).length > 0 || existsSync(getCliSettingsFile(dataDir))) {
        await updateSettingsFile<Record<string, unknown>>(getCliSettingsFile(dataDir), (existing) => ({ ...cliSplit, ...existing }))
    }
    await rename(legacyFile, legacyFile + '.bak')

    hubLogger.info(`[Hub] Migrated legacy ${legacyFile} -> ${hubFile} + ${getCliSettingsFile(dataDir)} (legacy kept as ${legacyFile}.bak)`)
    return { migrated: true, reason: 'migrated' }
}
