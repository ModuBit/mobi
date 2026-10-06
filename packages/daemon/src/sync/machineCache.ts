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

import { z } from 'zod'
import type { Store } from '../store'

const machineMetadataSchema = z.object({
    host: z.string().optional(),
    platform: z.string().optional(),
    mobiCliVersion: z.string().optional(),
    displayName: z.string().optional(),
    homeDir: z.string().optional(),
    mobiHomeDir: z.string().optional(),
    mobiLibDir: z.string().optional()
})

export interface Machine {
    id: string
    namespace: string
    seq: number
    createdAt: number
    updatedAt: number
    active: boolean
    activeAt: number
    metadata: {
        host: string
        platform: string
        mobiCliVersion: string
        displayName?: string
        homeDir?: string
        mobiHomeDir?: string
        mobiLibDir?: string
    } | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
}

export class MachineCache {
    private readonly machines: Map<string, Machine> = new Map()

    constructor(private readonly store: Store) {
    }

    getMachines(): Machine[] {
        return Array.from(this.machines.values())
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.getMachines().filter((machine) => machine.namespace === namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machines.get(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        const machine = this.machines.get(machineId)
        if (!machine || machine.namespace !== namespace) {
            return undefined
        }
        return machine
    }

    getOnlineMachines(): Machine[] {
        return this.getMachines().filter((machine) => machine.active)
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.getMachinesByNamespace(namespace).filter((machine) => machine.active)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        const stored = this.store.machines.getOrCreateMachine(id, metadata, runnerState, namespace)
        return this.refreshMachine(stored.id) ?? (() => { throw new Error('Failed to load machine') })()
    }

    refreshMachine(machineId: string): Machine | null {
        const stored = this.store.machines.getMachine(machineId)
        if (!stored) {
            // 发射点已收敛到 executorRuntime 写路径（ticket 205），删除路径无 daemon-status
            // 事件——单机常驻机器不会消失，此分支只为 401 store 退场前的写路径完整性保留
            this.machines.delete(machineId)
            return null
        }

        const existing = this.machines.get(machineId)

        const metadata = (() => {
            const parsed = machineMetadataSchema.safeParse(stored.metadata)
            if (!parsed.success) return null
            const data = parsed.data
            const host = typeof data.host === 'string' ? data.host : 'unknown'
            const platform = typeof data.platform === 'string' ? data.platform : 'unknown'
            const mobiCliVersion = typeof data.mobiCliVersion === 'string' ? data.mobiCliVersion : 'unknown'
            const displayName = typeof data.displayName === 'string' ? data.displayName : undefined
            const homeDir = typeof data.homeDir === 'string' ? data.homeDir : undefined
            const mobiHomeDir = typeof data.mobiHomeDir === 'string' ? data.mobiHomeDir : undefined
            const mobiLibDir = typeof data.mobiLibDir === 'string' ? data.mobiLibDir : undefined
            return { host, platform, mobiCliVersion, displayName, homeDir, mobiHomeDir, mobiLibDir }
        })()

        const storedActiveAt = stored.activeAt ?? stored.createdAt
        const existingActiveAt = existing?.activeAt ?? 0
        const useStoredActivity = storedActiveAt > existingActiveAt

        const machine: Machine = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            active: useStoredActivity ? stored.active : (existing?.active ?? stored.active),
            activeAt: useStoredActivity ? storedActiveAt : (existingActiveAt || storedActiveAt),
            metadata,
            metadataVersion: stored.metadataVersion,
            runnerState: stored.runnerState,
            runnerStateVersion: stored.runnerStateVersion
        }

        this.machines.set(machineId, machine)
        return machine
    }

    warmupCache(): void {
        this.machines.clear()
        const machines = this.store.machines.getMachines()
        for (const machine of machines) {
            this.refreshMachine(machine.id)
        }
    }

    /**
     * 本机自注册（ticket-20）：upsert 本机行、标记常驻 active 并置活广播。
     * daemon 启动时调用一次，替代旧 machine 通道的「HTTP 注册 + 心跳保活」。
     * ticket-25 起 active 无翻转点（多机过期/驱逐逻辑已删）——「常驻」由
     * 「没有任何代码会把它翻成 false」保证。
     */
    registerLocalMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        const machine = this.getOrCreateMachine(id, metadata, runnerState, namespace)
        machine.active = true
        machine.activeAt = Date.now()
        // 启动期广播由 hubServer 的 executor 初始状态镜像 + publishDaemonStatus 承担（205 起发射点收敛）
        return machine
    }
}
