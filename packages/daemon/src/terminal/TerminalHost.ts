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
 * daemon 持有的终端宿主（ticket-19）：按 sessionId 惰性持有 TerminalManager，
 * web /terminal namespace 的 create/write/resize/close 直达本进程 pty，
 * 不再经会话进程转发（休眠会话开终端不再唤醒它）。
 *
 * 事件出口（ready/output/exit/error）经 terminalRegistry 定位 web socket 直发；
 * pty 退出/出错时同步摘除 registry 条目（旧 CLI 转发路径同款语义，防无限重连循环）。
 * 空闲回收由 registry 统一计时（TerminalManager 自身 idle 关闭），装配层
 * onIdle 时调 {@link TerminalHost.close} 杀 pty。
 */

import type {
    TerminalErrorPayload,
    TerminalExitPayload,
    TerminalOutputPayload,
    TerminalReadyPayload
} from '@mobi/shared'
import type { TerminalRegistry, TerminalRegistryEntry } from '../socket/terminalRegistry'
import { TerminalManager, type TerminalManagerOptions } from './TerminalManager'

export type TerminalHostDeps = {
    terminalRegistry: TerminalRegistry
    /** 会话工作目录（pty cwd），从 sessionCache 的 metadata.path 读 */
    getSessionPath: (sessionId: string) => string | null
    /** 事件出口：terminalId → 持有它的 web socket emit（找不到即丢弃） */
    emitToSocket: (
        terminalId: string,
        event: 'terminal:ready' | 'terminal:output' | 'terminal:exit' | 'terminal:error',
        payload: TerminalReadyPayload | TerminalOutputPayload | TerminalExitPayload | TerminalErrorPayload
    ) => void
    /** manager 构造注入（测试用）；缺省即真 TerminalManager */
    managerFactory?: (options: TerminalManagerOptions) => TerminalManager
}

export class TerminalHost {
    private readonly managers = new Map<string, TerminalManager>()

    constructor(private readonly deps: TerminalHostDeps) {}

    create(sessionId: string, terminalId: string, cols: number, rows: number): void {
        this.getOrCreateManager(sessionId).create(terminalId, cols, rows)
    }

    write(terminalId: string, data: string): void {
        this.managerFor(terminalId)?.write(terminalId, data)
    }

    resize(terminalId: string, cols: number, rows: number): void {
        this.managerFor(terminalId)?.resize(terminalId, cols, rows)
    }

    /** 显式关闭（web close / registry 空闲回收）：先摘 registry 再杀 pty——
     * 主动关闭场景 web 不需要后续 exit 事件（与旧 CLI 转发路径行为一致） */
    close(terminalId: string): void {
        const entry = this.deps.terminalRegistry.get(terminalId)
        const manager = entry ? this.managers.get(entry.sessionId) : null
        this.deps.terminalRegistry.remove(terminalId)
        manager?.close(terminalId)
    }

    /** web socket 断连：批量关闭其名下终端 */
    closeEntries(entries: TerminalRegistryEntry[]): void {
        for (const entry of entries) {
            this.close(entry.terminalId)
        }
    }

    private managerFor(terminalId: string): TerminalManager | null {
        const entry = this.deps.terminalRegistry.get(terminalId)
        if (!entry) {
            return null
        }
        return this.managers.get(entry.sessionId) ?? null
    }

    private getOrCreateManager(sessionId: string): TerminalManager {
        const existing = this.managers.get(sessionId)
        if (existing) {
            return existing
        }

        const { terminalRegistry, getSessionPath, emitToSocket, managerFactory } = this.deps
        const manager = (managerFactory ?? ((options: TerminalManagerOptions) => new TerminalManager(options)))({
            sessionId,
            getSessionPath: () => getSessionPath(sessionId),
            onReady: (payload) => emitToSocket(payload.terminalId, 'terminal:ready', payload),
            onOutput: (payload) => emitToSocket(payload.terminalId, 'terminal:output', payload),
            // pty 自然退出：exit 送达 web 后摘除 registry 条目（计数随之释放）
            onExit: (payload) => {
                emitToSocket(payload.terminalId, 'terminal:exit', payload)
                terminalRegistry.remove(payload.terminalId)
            },
            // 错误即终态：送达后摘除条目，防 web 无限重连循环（旧 hub 转发路径同款）
            onError: (payload) => {
                emitToSocket(payload.terminalId, 'terminal:error', payload)
                terminalRegistry.remove(payload.terminalId)
            },
            // 空闲计时统一在 registry（单源），manager 自身 idle 关闭
            idleTimeoutMs: 0,
            // 终端全空后回收 manager 实例（防会话数增长下 Map 无界累积）
            onAllClosed: () => {
                this.managers.delete(sessionId)
            }
        })
        this.managers.set(sessionId, manager)
        return manager
    }
}
