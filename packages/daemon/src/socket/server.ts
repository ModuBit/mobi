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

import { daemonLogger } from '../logger'
import { Server as Engine } from '@socket.io/bun-engine'
import { Server, type DefaultEventsMap } from 'socket.io'
import { jwtVerify } from 'jose'
import { parseCookie } from 'cookie'
import { z } from 'zod'
import { RPC_MAX_HTTP_BUFFER_SIZE } from '@mobi/shared'
import type { Store } from '../store'
import { configuration } from '../configuration'
import { constantTimeEquals } from '../utils/crypto'
import { parseAccessToken } from '../utils/accessToken'
import { AUTH_COOKIE_NAME } from '../web/auth/session'
import { registerCliHandlers } from './handlers/cli'
import { registerTerminalHandlers } from './handlers/terminal'
import { RpcRegistry } from './rpcRegistry'
import { SessionSocketOwners } from './sessionSocketOwners'
import { BackgroundTaskTracker } from '../sync/backgroundTaskTracker'
import { SnapshotSync } from '../sync/snapshotSync'
import type { RewindDeleteBoundTracker } from '../sync/rewindDeleteBoundTracker'
import type { SessionSocketCapabilities, LazyCapability } from './capabilities'
import { TerminalRegistry } from './terminalRegistry'
import { TerminalHost } from '../terminal/TerminalHost'
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
const DEFAULT_MAX_TERMINALS = 3

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
    /** 活跃后台任务集合（CLI 事件维护，rewind API 闸门读取）。
     *  缺省时 socket server 自建实例——仅测试用；生产组装层（index.ts）必须传入与 web 路由层共用的同一实例 */
    backgroundTaskTracker?: BackgroundTaskTracker
    /** rewind 软删除上界（SyncEngine 受理时写，CLI rewind-truncated 读）。
     *  生产组装层（index.ts）必须传入与 SyncEngine 共用的同一实例 */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    /** 快照同步 module。必传：CLI ingest 与 SSEManager 的订阅必须共享同一实例，漏传会静默脑裂 */
    snapshotSync: SnapshotSync
    /** 会话归属与工作目录（终端 pty 的 cwd = metadata.path）。pty 由 daemon 持有
     *  （ticket-19），active 状态不再参与终端链路 */
    getSession?: (sessionId: string) => { namespace: string; sessionPath: string | null } | null
} & Partial<Pick<SessionSocketCapabilities, 'onWebappEvent' | 'hasActiveSseConnection' | 'publishUiCommand'>> & {
    /** 能力签名单源 socket/capabilities.ts（架构评审候选⑥票①）；须惰性的三项在此
     *  写 getter 投影——组装层 socket server 先于 SyncEngine 创建（真环，见文件头），
     *  connection 时解包。factsSink 兼容实体直传（部分测试用） */
    factsSink?: SessionSocketCapabilities['factsSink'] | LazyCapability<SessionSocketCapabilities['factsSink']>
    agentSessions?: LazyCapability<SessionSocketCapabilities['agentSessions']>
    emitCliNewMessage?: LazyCapability<SessionSocketCapabilities['emitCliNewMessage']>
}

export function createSocketServer(deps: SocketServerDeps): {
    io: SocketServer
    /** 主端口 engine（web server 挂载：web HTTP + /terminal namespace） */
    engine: Engine
    /** 宿主端口 engine（独立 loopback listener：/cli namespace，ticket-21） */
    hostEngine: Engine
    rpcRegistry: RpcRegistry
} {
    const corsOrigins = deps.corsOrigins ?? configuration.corsOrigins
    const allowAllOrigins = corsOrigins.includes('*')
    // socket 层 credentials:false（terminal token 走 handshake.auth/cookie 双源，非 CORS credentials 闭环），
    // origin:'*' 在此合法。web 层 credentials:true 才与 '*' 互斥，由 assertCorsOriginsForCredentials 守卫。
    // 这里仅提示：若运维误以为 web 也允许 '*'，会导致 web 静默 401（web 层启动会 throw 阻断）。
    if (allowAllOrigins) {
        daemonLogger.warn('[CORS] socket 允许 origin:"*"（credentials:false，合法）。' +
            '注意：web HTTP 层 credentials:true 与 "*" 互斥，会在启动时 throw。')
    }
    const corsOriginOption = allowAllOrigins ? '*' : corsOrigins
    const corsOptions = {
        origin: corsOriginOption,
        methods: ['GET', 'POST'],
        credentials: false
    }

    // 双实例（ticket-21 Q10=a）：宿主通道（/cli namespace + /cli/* HTTP）走独立 loopback
    // listener，不经 frp 暴露；主 listener 只承载 web 与 /terminal。io 与 engine 的
    // 命名以「谁是默认返回值」为准——io=宿主 socket.io（SyncEngine/rpc 只用 /cli 族），
    // engine=主端口 engine（web server 挂载），hostEngine=宿主端口 engine
    const makeEngineOptions = () => ({
        path: '/socket.io/',
        cors: corsOptions,
        // 4MB：允许 readFileRange 单 chunk 二进制响应（cli → daemon 方向）。
        // maxHttpBufferSize 是 engine 层选项，必须直接设在 bun-engine 上——
        // io.bind(外部 engine) 不会把上面 new Server(maxHttpBufferSize) 的同名选项透传过来。
        // bun-engine 默认仅 1MB，超过会判定 "payload too large" 并断开 cli 连接（transport close），
        // 表现为 daemon stream 拿不到 chunk、大文件（图片/视频）预览 body 为空。
        // 值在 @mobi/shared RPC_MAX_HTTP_BUFFER_SIZE 统一（与 RPC_BINARY_CHUNK_SIZE 协同）。
        maxHttpBufferSize: RPC_MAX_HTTP_BUFFER_SIZE,
        allowRequest: async (req: Request) => {
            const origin = req.headers.get('origin')
            if (!origin || allowAllOrigins || corsOrigins.includes(origin)) {
                return
            }
            throw 'Origin not allowed'
        }
    })

    // 双 Server 实例（宿主 /cli 与主端口 /terminal）共用同一组选项（CORS + 4MB 上限）
    const makeServerOptions = () => ({
        cors: corsOptions,
        // 4MB：允许 readFileRange 单 chunk 二进制响应（socket.io 默认 1MB，超过会断连）。
        // 值在 @mobi/shared RPC_MAX_HTTP_BUFFER_SIZE 统一，与 RPC_BINARY_CHUNK_SIZE 协同
        maxHttpBufferSize: RPC_MAX_HTTP_BUFFER_SIZE
    })

    // 宿主实例（/cli namespace）：绑宿主端口 engine，由 startHostServer 挂载
    const io = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(makeServerOptions())
    const hostEngine = new Engine(makeEngineOptions())
    io.bind(hostEngine)

    // 主端口实例（/terminal namespace）：绑主端口 engine，由 startWebServer 挂载
    const webIo = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(makeServerOptions())
    const engine = new Engine(makeEngineOptions())
    webIo.bind(engine)

    const idleTimeoutMs = resolveEnvNumber('MOBI_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
    // 单 env 限额（历史 per-socket/per-session 曾为独立配置，合并后同值——
    // 消费方字段名保留语义，不再起中间别名）
    const maxTerminals = resolveEnvNumber('MOBI_TERMINAL_MAX_TERMINALS', DEFAULT_MAX_TERMINALS)
    
    const cliNs = io.of('/cli')
    // 终端 namespace 挂在主端口 socket.io 实例上（web 浏览器可达；frp 转发主端口）
    const terminalNs = webIo.of('/terminal')

    // 单实例共享（缺省自建仅测试路径用）：CLI 连接事件维护，rewind API 闸门读取
    const backgroundTaskTracker = deps.backgroundTaskTracker ?? new BackgroundTaskTracker()
    const snapshotSync = deps.snapshotSync

    const rpcRegistry = new RpcRegistry()
    // 同 session CLI socket 接管仲裁（sessionSocketOwners.ts 模块头写明为什么必须仲裁）
    const sessionSocketOwners = new SessionSocketOwners()
    // 空闲计时单源在 registry：到点通知 web 并杀 pty（host.close 复用主动关闭路径）
    const terminalRegistry = new TerminalRegistry({
        idleTimeoutMs,
        onIdle: (entry) => {
            emitToTerminalSocket(entry.terminalId, 'terminal:error', {
                terminalId: entry.terminalId,
                message: 'Terminal closed due to inactivity.'
            })
            terminalHost.close(entry.terminalId)
        }
    })

    // 终端事件出口：terminalId → 持有它的 web socket（找不到即丢弃——socket 已断/条目已摘）
    const emitToTerminalSocket = (
        terminalId: string,
        event: 'terminal:ready' | 'terminal:output' | 'terminal:exit' | 'terminal:error',
        payload: Record<string, unknown>
    ) => {
        const entry = terminalRegistry.get(terminalId)
        if (!entry) {
            return
        }
        terminalNs.sockets.get(entry.socketId)?.emit(event, payload)
    }

    // pty 宿主（ticket-19）：create 先注册 registry 再直开——onReady 回发时条目必在
    const terminalHost = new TerminalHost({
        terminalRegistry,
        getSessionPath: (sessionId) => deps.getSession?.(sessionId)?.sessionPath ?? null,
        emitToSocket: emitToTerminalSocket
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
    cliNs.on('connection', (socket) => {
        // 惰性 getter 在 connection 时解包一次：SyncEngine 在 socket server 之后创建，此时必已就绪
        // （listen 发生在 SyncEngine 构造之后）。整份能力对象往下交付，不在这里逐方法铺开
        const agentSessions = deps.agentSessions?.()
        registerCliHandlers(socket as CliSocketWithData, {
            io,
            store: deps.store,
            rpcRegistry,
            sessionSocketOwners,
            backgroundTaskTracker,
            snapshotSync,
            rewindDeleteBoundTracker: deps.rewindDeleteBoundTracker,
            // 会话事实（心跳/水位/目标/轮次/结束）→ sink 落库。
            // 惰性形式在 connection 时解包——SyncEngine 在 socket server 之后创建，此时必已就绪
            factsSink: typeof deps.factsSink === 'function' ? deps.factsSink() : deps.factsSink,
            emitCliNewMessage: deps.emitCliNewMessage?.(),
            onWebappEvent: deps.onWebappEvent,    // Web端实时事件
            hasActiveSseConnection: deps.hasActiveSseConnection,
            publishUiCommand: deps.publishUiCommand,
            // Agent 会话操作（B 类工具族）：整份服务一次交付——不再逐方法包一层闭包
            // （四个方法名此前在这条链上被改了三遍名、判了四遍空）
            agentSessions
        })
    })

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
        getSession: (sessionId) => deps.getSession?.(sessionId) ?? null,
        terminalRegistry,
        terminalHost,
        maxTerminalsPerSocket: maxTerminals,
        maxTerminalsPerSession: maxTerminals
    }))

    return { io, engine, hostEngine, rpcRegistry }
}
