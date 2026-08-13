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

import type { Machine } from '@/core/data/api/types'

/**
 * 获取机器显示名称：displayName → host → id 前 8 位
 */
export function getMachineTitle(machine: Pick<Machine, 'id' | 'metadata'>): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

/**
 * 组装机器 Select 的 options：label 为「显示名 (平台)」，平台缺省时仅显示名
 */
export function buildMachineSelectOptions(
    machines: ReadonlyArray<Pick<Machine, 'id' | 'metadata'>>,
): Array<{ value: string; label: string }> {
    return machines.map(m => ({
        value: m.id,
        label: `${getMachineTitle(m)}${m.metadata?.platform ? ` (${m.metadata.platform})` : ''}`,
    }))
}
