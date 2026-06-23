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

import { Server as Engine } from '@socket.io/bun-engine'
import { Server, type DefaultEventsMap } from 'socket.io'
import { jwtVerify } from 'jose'
import { parse as parseCookie } from 'cookie'
import { z } from 'zod'
import type { Store } from '../store'
import { configuration } from '../configuration'
import { constantTimeEquals } from '../utils/crypto'
import { parseAccessToken } from '../utils/accessToken'
import { AUTH_COOKIE_NAME } from '../web/middleware/auth'
import { registerCliHandlers } from './handlers/cli'
import { registerTerminalHandlers } from './handlers/terminal'
import { RpcRegistry } from './rpcRegistry'
import type { SyncEvent } from '../sync/syncEngine'
import { TerminalRegistry } from './terminalRegistry'
import type { CliSocketWithData, SocketData, SocketServer } from './socketTypes'

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string()
})

/**
 * 从 socket handshake 双源提取 terminal token：cookie 优先，fallback handshake.auth.token。
 * 提取为纯函数便于单测；验证逻辑留在 terminalNs.use 内。
 */
export function extractTerminalToken(handshake: {
    headers: { cookie?: string }
    auth?: Record<string, unknown> | unknown
}): string | undefined {
    const cookieHeader = handshake.headers.cookie
    const tokenFromCookie = typeof cookieHeader === 'string'
        ? parseCookie(cookieHeader)[AUTH_COOKIE_NAME] : undefined
    const auth = handshake.auth as Record<string, unknown> | undefined
    const tokenFromAuth = typeof auth?.token === 'string' ? auth.token : undefined
    return tokenFromCookie ?? tokenFromAuth
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_MAX_TERMINALS = 4

function resolveEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export type SocketServerDeps = {
    store: Store
    jwtSecret: Uint8Array
    corsOrigins?: string[]
    getSession?: (sessionId: string) => { active: boolean; namespace: string } | null
    onWebappEvent?: (event: SyncEvent) => void
    onSessionAlive?: (payload: { sid: string; time: number; running?: boolean; mode?: 'local' | 'remote' }) => void
    onSessionEnd?: (payload: { sid: string; time: number }) => void
    onMachineAlive?: (payload: { machineId: string; time: number }) => void
}

export function createSocketServer(deps: SocketServerDeps): {
    io: SocketServer
    engine: Engine
    rpcRegistry: RpcRegistry
} {
    const corsOrigins = deps.corsOrigins ?? configuration.corsOrigins
    const allowAllOrigins = corsOrigins.includes('*')
    // socket 层 credentials:false（terminal token 走 handshake.auth/cookie 双源，非 CORS credentials 闭环），
    // origin:'*' 在此合法。web 层 credentials:true 才与 '*' 互斥，由 assertCorsOriginsForCredentials 守卫。
    // 这里仅提示：若运维误以为 web 也允许 '*'，会导致 web 静默 401（web 层启动会 throw 阻断）。
    if (allowAllOrigins) {
        console.warn('[CORS] socket 允许 origin:"*"（credentials:false，合法）。' +
            '注意：web HTTP 层 credentials:true 与 "*" 互斥，会在启动时 throw。')
    }
    const corsOriginOption = allowAllOrigins ? '*' : corsOrigins
    const corsOptions = {
        origin: corsOriginOption,
        methods: ['GET', 'POST'],
        credentials: false
    }

    const io = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>({
        cors: corsOptions,
        // 4MB：允许 readFileRange 单 chunk 二进制响应（socket.io 默认 1MB，超过会断连）
        maxHttpBufferSize: 4e6
    })

    const engine = new Engine({
        path: '/socket.io/',
        cors: corsOptions,
        allowRequest: async (req) => {
            const origin = req.headers.get('origin')
            if (!origin || allowAllOrigins || corsOrigins.includes(origin)) {
                return
            }
            throw 'Origin not allowed'
        }
    })
    io.bind(engine)

    const idleTimeoutMs = resolveEnvNumber('MOBI_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
    const maxTerminals = resolveEnvNumber('MOBI_TERMINAL_MAX_TERMINALS', DEFAULT_MAX_TERMINALS)
    const maxTerminalsPerSocket = maxTerminals
    const maxTerminalsPerSession = maxTerminals
    
    const cliNs = io.of('/cli')
    const terminalNs = io.of('/terminal')

    const rpcRegistry = new RpcRegistry()
    const terminalRegistry = new TerminalRegistry({
        idleTimeoutMs,
        onIdle: (entry) => {
            const terminalSocket = terminalNs.sockets.get(entry.socketId)
            terminalSocket?.emit('terminal:error', {
                terminalId: entry.terminalId,
                message: 'Terminal closed due to inactivity.'
            })
            const cliSocket = cliNs.sockets.get(entry.cliSocketId)
            cliSocket?.emit('terminal:close', {
                sessionId: entry.sessionId,
                terminalId: entry.terminalId
            })
        }
    })

    cliNs.use((socket, next) => {
        const auth = socket.handshake.auth as Record<string, unknown> | undefined
        const token = typeof auth?.token === 'string' ? auth.token : null
        const parsedToken = token ? parseAccessToken(token) : null
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return next(new Error('Invalid token'))
        }
        socket.data.namespace = parsedToken.namespace
        next()
    })
    cliNs.on('connection', (socket) => registerCliHandlers(socket as CliSocketWithData, {
        io,
        store: deps.store,
        rpcRegistry,
        terminalRegistry,
        // 以下回调转发给 SyncEngine 处理状态同步
        onSessionAlive: deps.onSessionAlive,  // CLI心跳保活
        onSessionEnd: deps.onSessionEnd,      // CLI会话结束
        onMachineAlive: deps.onMachineAlive,  // CLI机器心跳
        onWebappEvent: deps.onWebappEvent     // Web端实时事件
    }))

    terminalNs.use(async (socket, next) => {
        // 双源提取：cookie 优先（同源 httpOnly cookie 浏览器自动携带，刷新不丢），fallback auth.token（过渡兼容）
        const token = extractTerminalToken(socket.handshake)
        if (!token) {
            return next(new Error('Missing token'))
        }

        try {
            const verified = await jwtVerify(token, deps.jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return next(new Error('Invalid token payload'))
            }
            socket.data.userId = parsed.data.uid
            socket.data.namespace = parsed.data.ns
            next()
            return
        } catch {
            return next(new Error('Invalid token'))
        }
    })
    terminalNs.on('connection', (socket) => registerTerminalHandlers(socket, {
        io,
        // active 状态只从内存获取，不存储在数据库中
        getSession: (sessionId) => deps.getSession?.(sessionId) ?? null,
        terminalRegistry,
        maxTerminalsPerSocket,
        maxTerminalsPerSession
    }))

    return { io, engine, rpcRegistry }
}
