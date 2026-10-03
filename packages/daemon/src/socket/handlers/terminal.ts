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
 * web /terminal namespace 处理器（ticket-19 起 pty 由 daemon 持有）：
 * create/write/resize/close 直调 {@link TerminalHost}，不再转发会话进程——
 * 休眠会话开终端照常成功且不触发唤醒（dormancy spec §B.6 耦合已删）。
 * 事件名与载荷不变（02 webContract 契约锁定）。
 */

import { TerminalOpenPayloadSchema } from '@mobi/shared'
import { z } from 'zod'
import type { TerminalRegistry, TerminalRegistryEntry } from '../terminalRegistry'
import type { TerminalHost } from '../../terminal/TerminalHost'
import type { SocketWithData } from '../socketTypes'

const terminalCreateSchema = TerminalOpenPayloadSchema

const terminalWriteSchema = z.object({
    terminalId: z.string().min(1),
    data: z.string()
})

const terminalResizeSchema = z.object({
    terminalId: z.string().min(1),
    cols: z.number().int().positive(),
    rows: z.number().int().positive()
})

const terminalCloseSchema = z.object({
    terminalId: z.string().min(1)
})

export type TerminalHandlersDeps = {
    terminalRegistry: TerminalRegistry
    terminalHost: TerminalHost
    /** 会话归属（namespace 校验用；active 状态不再参与——终端与会话进程解耦） */
    getSession: (sessionId: string) => { namespace: string } | null
    maxTerminalsPerSocket: number
    maxTerminalsPerSession: number
}

export function registerTerminalHandlers(socket: SocketWithData, deps: TerminalHandlersDeps): void {
    const { terminalRegistry, terminalHost, getSession, maxTerminalsPerSocket, maxTerminalsPerSession } = deps
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null

    const emitTerminalError = (terminalId: string, message: string) => {
        socket.emit('terminal:error', { terminalId, message })
    }

    const resolveEntryForSocket = (terminalId: string): TerminalRegistryEntry | null => {
        const entry = terminalRegistry.get(terminalId)
        if (!entry || entry.socketId !== socket.id) {
            return null
        }
        return entry
    }

    socket.on('terminal:create', (data: unknown) => {
        const parsed = terminalCreateSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { sessionId, terminalId, cols, rows } = parsed.data
        const session = getSession(sessionId)
        if (!namespace || !session || session.namespace !== namespace) {
            emitTerminalError(terminalId, 'Session is unavailable.')
            return
        }

        // 同一 web socket 对同一 terminalId 重新 create（前端 reconnect 重发 create）：
        // 先清旧 entry 再做上限检查，避免达上限时重连被永久拒绝（旧 entry 仍占用计数）。
        // 不同 socket 占用同一 terminalId 视为冲突。
        const existing = terminalRegistry.get(terminalId)
        if (existing) {
            if (existing.socketId === socket.id) {
                terminalRegistry.remove(terminalId)
            } else {
                emitTerminalError(terminalId, 'Terminal ID is already in use.')
                return
            }
        }

        if (terminalRegistry.countForSocket(socket.id) >= maxTerminalsPerSocket) {
            emitTerminalError(terminalId, `Too many terminals open (max ${maxTerminalsPerSocket}).`)
            return
        }

        if (terminalRegistry.countForSession(sessionId) >= maxTerminalsPerSession) {
            emitTerminalError(terminalId, `Too many terminals open for this session (max ${maxTerminalsPerSession}).`)
            return
        }

        const entry = terminalRegistry.register(terminalId, sessionId, socket.id)
        if (!entry) {
            emitTerminalError(terminalId, 'Terminal ID is already in use.')
            return
        }

        // pty 直开（daemon 进程内）：ready/output/exit/error 经 TerminalHost 回发本 socket
        terminalHost.create(sessionId, terminalId, cols, rows)
        terminalRegistry.markActivity(terminalId)
    })

    socket.on('terminal:write', (data: unknown) => {
        const parsed = terminalWriteSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { terminalId, data: payload } = parsed.data
        const entry = resolveEntryForSocket(terminalId)
        if (!entry) {
            return
        }

        terminalHost.write(terminalId, payload)
        terminalRegistry.markActivity(terminalId)
    })

    socket.on('terminal:resize', (data: unknown) => {
        const parsed = terminalResizeSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { terminalId, cols, rows } = parsed.data
        const entry = resolveEntryForSocket(terminalId)
        if (!entry) {
            return
        }

        terminalHost.resize(terminalId, cols, rows)
        terminalRegistry.markActivity(terminalId)
    })

    socket.on('terminal:close', (data: unknown) => {
        const parsed = terminalCloseSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { terminalId } = parsed.data
        const entry = resolveEntryForSocket(terminalId)
        if (!entry) {
            return
        }

        terminalHost.close(terminalId)
    })

    socket.on('disconnect', () => {
        const removed = terminalRegistry.removeBySocket(socket.id)
        terminalHost.closeEntries(removed)
    })
}
