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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@/ui/logger'
import { configuration } from '@/configuration'

// 沙箱配置
export interface SandboxConfig {
  // 总开关，默认 true
  enabled: boolean
  // 网络限制
  network: {
    // 域名白名单，默认 []（禁止所有网络）
    allowedDomains: string[]
  }
  // 文件系统限制
  filesystem: {
    // 可写路径白名单
    allowWrite: string[]
    // 禁读路径黑名单
    denyRead: string[]
    // 禁写路径黑名单（在 allowWrite 范围内）
    denyWrite: string[]
  }
}

const CONFIG_PATH = join(configuration.mobiHomeDir, 'sandbox.json')

export function getDefaultSandboxConfig(): SandboxConfig {
  return {
    enabled: true,
    network: {
      allowedDomains: [],
    },
    filesystem: {
      allowWrite: ['.', '/tmp'],
      denyRead: ['~/.ssh', '~/.gnupg'],
      denyWrite: ['.env'],
    },
  }
}

export function loadSandboxConfig(): SandboxConfig {
  const defaults = getDefaultSandboxConfig()

  if (!existsSync(CONFIG_PATH)) {
    logger.debug(`[sandboxConfig] 配置文件不存在: ${CONFIG_PATH}，使用默认配置`)
    return defaults
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)

    return {
      enabled: parsed.enabled ?? defaults.enabled,
      network: {
        allowedDomains: parsed.network?.allowedDomains ?? defaults.network.allowedDomains,
      },
      filesystem: {
        allowWrite: parsed.filesystem?.allowWrite ?? defaults.filesystem.allowWrite,
        denyRead: parsed.filesystem?.denyRead ?? defaults.filesystem.denyRead,
        denyWrite: parsed.filesystem?.denyWrite ?? defaults.filesystem.denyWrite,
      },
    }
  } catch (_e) {
    logger.warn(`[sandboxConfig] 读取配置失败: ${CONFIG_PATH}，使用默认配置`)
    return defaults
  }
}
