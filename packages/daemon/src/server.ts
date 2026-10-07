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
 * daemon Web/同步服务生命周期（原 hubServer.ts，602 定名 server.ts）。
 *
 * `startServer` 只负责「起服务」：装配 config/store/socket/web 全家并监听就绪，
 * 返回 `ServerHandle`（port + stop）。**不含任何进程级职责**——exit logger、信号
 * 处理、启动崩溃检测、进程驻留（`await new Promise(() => {})`）都由调用方
 * （daemonEntry 的同进程编排）承担，否则两套信号处理互抢、shutdown 直接 exit
 * 砍掉清理。
 */

import { configuration, createConfiguration } from './configuration'
import { daemonLogger } from './logger'
import { Store } from './store'
import { SyncEngine, type SyncEvent } from './sync/syncEngine'
import { BackgroundTaskTracker } from './sync/backgroundTaskTracker'
import { RewindDeleteBoundTracker } from './sync/rewindDeleteBoundTracker'
import { NotificationHub } from './notifications/notificationHub'
import type { NotificationChannel } from './notifications/notificationTypes'
import { startWebServer, startHostServer, createHostApp } from './web/server'
import { getOrCreateJwtSecret } from './config/jwtSecret'
import { startWebApiTokenWatcher } from './config/settingsWatcher'
import { createSocketServer } from './socket/server'
import { SSEManager } from './sse/sseManager'
import { SnapshotDeltaStats } from './sync/snapshotDeltaStats'
import { SnapshotSync } from './sync/snapshotSync'
import { LocalExecutor } from './executor/localExecutor'
import type { ExecutorBridge } from './executor/lifecycle'
import { createSessionTrackingSync } from './executor/sessionTracking'
import { updateExecutorState as writeExecutorState } from './sync/executorRuntime'
import type { ExecutorState } from '@mobi/node-core/api/types'
import { parseAccessToken } from './utils/accessToken'
import { getOrCreateVapidKeys } from './config/vapidKeys'
import { PushService } from './push/pushService'
import { PushNotificationChannel } from './push/pushNotificationChannel'
import { VisibilityTracker } from './visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { WebSocketData } from '@socket.io/bun-engine'

/** 服务句柄：stop 只做组件级清理，不碰进程（不 process.exit、不挂信号） */
export interface ServerHandle {
    /** 实际监听端口（config 解析结果，可能来自 env/settings/default） */
    port: number
    /** 宿主通道端口（ticket-21：/cli socket + /cli/* HTTP 独立 loopback listener，127.0.0.1 only） */
    hostPort: number
    /** 数据目录（state 文件所在，供调用方绑定退出清理） */
    dataDir: string
    /**
     * 会话执行桥注入（ticket-18）：daemon 编排在 executor 就绪后调用——
     * LocalExecutor.spawnSession 翻直调，session-alive 驱动追踪补登/刷新。
     * 未调用（单测）时 spawn 报 bridge 未接线。
     */
    setExecutorBridge(bridge: ExecutorBridge): void
    /**
     * executor 状态直写（401 起 machineCache 落库退场）：daemon 编排注入给
     * executor core——spawn 结果上报 / 关停状态经此写 executorRuntime 内存单例并广播
     * daemon-status。
     */
    updateExecutorState(handler: (state: ExecutorState | null) => ExecutorState): void
    /** 优雅关停：清 state → 通知/SSE/engine/web 逐层停。幂等（二次调用为 no-op） */
    stop(): Promise<void>
}

export interface StartServerOptions {
    /** 传入则覆盖 env/settings 的监听地址（daemon start-sync --host 透传） */
    host?: string
    /** 传入则覆盖 env/settings 的监听端口 */
    port?: number
}

function formatSource(source: 'env' | 'file' | 'default' | 'generated'): string {
    switch (source) {
        case 'env': return 'environment'
        case 'file': return 'settings.daemon.json'
        case 'default': return 'default'
        case 'generated': return 'generated'
    }
}

/** 首次生成 token 时打印的横幅（CLI / Web 密钥共用，避免两段重复） */
function printTokenBanner(title: string, token: string, file: string, footer?: string): void {
    const bar = '='.repeat(70)
    daemonLogger.info('')
    daemonLogger.info(bar)
    daemonLogger.info(`  ${title}`)
    daemonLogger.info(bar)
    daemonLogger.info('')
    daemonLogger.info(`  Token: ${token}`)
    daemonLogger.info('')
    daemonLogger.info(`  Saved to: ${file}`)
    daemonLogger.info('')
    if (footer) {
        daemonLogger.info(`  ${footer}`)
        daemonLogger.info('')
    }
    daemonLogger.info(bar)
    daemonLogger.info('')
}

export async function startServer(opts: StartServerOptions = {}): Promise<ServerHandle> {
    if (opts.host) process.env.MOBI_LISTEN_HOST = opts.host
    if (opts.port) process.env.MOBI_LISTEN_PORT = String(opts.port)

    daemonLogger.info('Mobi Daemon starting...')

    const config = await createConfiguration()

    // 首次生成 CLI 密钥时打印横幅
    if (config.cliApiTokenIsNew) {
        printTokenBanner('NEW CLI_API_TOKEN GENERATED', config.cliApiToken, config.settingsFile)
    } else {
        daemonLogger.info(`[DAEMON] CLI_API_TOKEN: loaded from ${formatSource(config.sources.cliApiToken)}`)
    }

    // 首次生成 Web 密钥时打印横幅（Web 浏览器登录用，与 CLI 密钥独立）
    if (config.webApiTokenIsNew) {
        printTokenBanner(
            'NEW WEB_API_TOKEN GENERATED (Web 浏览器登录用，与 CLI 密钥独立)',
            config.webApiToken,
            config.settingsFile,
            '查看命令: mobi auth web-token    轮换命令: mobi auth rotate-web-token'
        )
    } else {
        daemonLogger.info(`[DAEMON] WEB_API_TOKEN: loaded from ${formatSource(config.sources.webApiToken)}`)
    }

    daemonLogger.info(`[DAEMON] MOBI_LISTEN_HOST: ${config.listenHost} (${formatSource(config.sources.listenHost)})`)
    daemonLogger.info(`[DAEMON] MOBI_LISTEN_PORT: ${config.listenPort} (${formatSource(config.sources.listenPort)})`)
    daemonLogger.info(`[DAEMON] MOBI_PUBLIC_URL: ${config.publicUrl} (${formatSource(config.sources.publicUrl)})`)

    // 数据存储
    const store = new Store(config.dbPath)
    // JWT 密钥
    const jwtSecret = await getOrCreateJwtSecret()
    const vapidKeys = await getOrCreateVapidKeys(config.dataDir)
    const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:admin@mobi.local'
    const pushService = new PushService(vapidKeys, vapidSubject, store)

    const visibilityTracker = new VisibilityTracker()
    // snapshot 流量观测（票 03）：MOBI_SNAPSHOT_STATS=1 开启，默认零开销
    const snapshotStats = new SnapshotDeltaStats(process.env.MOBI_SNAPSHOT_STATS === '1')
    // Socket 输入、SSE 输出与 HTTP resync 共用同一个快照同步生命周期。
    const snapshotSync = new SnapshotSync({ stats: snapshotStats })
    const sseManager = new SSEManager(30_000, visibilityTracker, snapshotSync)

    // 活跃后台任务集合：CLI socket handler 写（background_tasks_changed replace）、
    // rewind API 路由读（闸门）——两端共用同一实例，在此组装层创建并注入
    const backgroundTaskTracker = new BackgroundTaskTracker()

    // rewind 软删除上界：SyncEngine 受理时写、CLI socket handler 截断回报时读——共用同一实例
    const rewindDeleteBoundTracker = new RewindDeleteBoundTracker()

    let syncEngine: SyncEngine | null = null
    const socketServer = createSocketServer({
        store,
        jwtSecret,
        corsOrigins: config.corsOrigins,
        backgroundTaskTracker,
        rewindDeleteBoundTracker,
        snapshotSync,
        getSession: (sessionId) => {
            // 只从内存（SyncEngine）取，不查数据库；sessionPath 是终端 pty 的 cwd（ticket-19）
            const session = syncEngine?.getSession(sessionId)
            if (!session) {
                return null
            }
            const metadata = session.metadata as { path?: string } | null | undefined
            return { namespace: session.namespace, sessionPath: metadata?.path ?? null }
        },
        // Web 端实时事件（如文件变更、终端输出）→ 转发给 SyncEngine 处理
        onWebappEvent: (event: SyncEvent) => syncEngine?.handleRealtimeEvent(event),
        // 会话事实上报（心跳/水位/目标/轮次/结束）→ sink 落库 + SSE 推（深化候选③）；
        // 惰性：socket server 先于 SyncEngine 创建，handler 触发时才取 sink
        factsSink: () => syncEngine?.factsSink,
        // ui-command（agent 触达 mobi 界面）：Web SSE 在线检查 + 经 SyncEngine 发布广播
        hasActiveSseConnection: (namespace) => sseManager?.hasActiveConnection(namespace) ?? false,
        publishUiCommand: (event) => syncEngine?.publishUiCommand(event),
        // Agent 会话操作（agent 触达其他会话，B 类）：同属 SyncEngine 内部实例，惰性取用
        agentSessions: () => syncEngine?.agentSessions,
        // CLI 房间 new-message 广播出口（messageService 单一构造点），惰性取用
        emitCliNewMessage: () => syncEngine?.emitCliNewMessage.bind(syncEngine)
    })

    // 执行层显式注入（ticket-15 接口 / ticket-17 本地化 / ticket-20 唯一实现）：
    // LocalExecutor 直调 node-core handler 实现函数，不经 socket
    // bridge 持有槽（ticket-18）：LocalExecutor 构造期 executor 尚未启动，
    // 惰性 getter 在 spawn 时解包——注入前为 null（spawn 报 bridge 未接线），daemon 编排注入后直调
    let executorBridge: ExecutorBridge | null = null
    syncEngine = new SyncEngine(
        store,
        socketServer.io,
        socketServer.rpcRegistry,
        sseManager,
        rewindDeleteBoundTracker,
        new LocalExecutor(() => executorBridge)
    )

    // daemon 主 namespace 盖章 + executor 初始态（401：machines 行自注册退场——
    // store 层已删，executor 权威状态只在 executorRuntime 内存单例，205 定）
    syncEngine.setDaemonNamespace(parseAccessToken(configuration.cliApiToken)?.namespace ?? 'default')
    const initialExecutorState: ExecutorState = { status: 'running', pid: process.pid, startedAt: Date.now() }
    writeExecutorState(() => initialExecutorState)

    const notificationChannels: NotificationChannel[] = [
        // WEB端（SSE/WEB-PUSH)
        new PushNotificationChannel(pushService, sseManager, config.publicUrl)
    ]

    const notificationHub = new NotificationHub(syncEngine, notificationChannels)

    const webServer: BunServer<WebSocketData> = await startWebServer({
        getSyncEngine: () => syncEngine,
        getSseManager: () => sseManager,
        getVisibilityTracker: () => visibilityTracker,
        jwtSecret,
        store,
        vapidPublicKey: vapidKeys.publicKey,
        socketEngine: socketServer.engine,
        corsOrigins: config.corsOrigins,
        backgroundTaskTracker,
    })

    // 宿主通道 listener（ticket-21 Q10=a）：/cli/* HTTP + /cli namespace socket，
    // 只绑 127.0.0.1，不经 frp 暴露——外网物理够不到宿主通道
    const hostServer: BunServer<WebSocketData> = startHostServer({
        hostApp: createHostApp({
            getSyncEngine: () => syncEngine,
            corsOrigins: config.corsOrigins,
        }),
        hostEngine: socketServer.hostEngine,
    })

    // 启动 settings.daemon.json 监听：webApiToken 轮换时热 reload，无需重启 daemon
    const settingsWatcher = startWebApiTokenWatcher()

    daemonLogger.info('')
    daemonLogger.info('[Web] Listening on :' + config.listenPort)
    daemonLogger.info('[Web] Local:  http://localhost:' + config.listenPort)
    daemonLogger.info('[Host] Host channel on 127.0.0.1:' + config.hostPort + ' (loopback only)')
    daemonLogger.info('')
    daemonLogger.info('Mobi Daemon is ready!')

    // daemon 进程状态由 daemonEntry 统一写 daemon.state.json（历史 daemon/runner state 文件已停写）

    let stopped = false
    const setExecutorBridge = (bridge: ExecutorBridge): void => {
        executorBridge = bridge
        // executor 管线就绪：此后 spawn/resume 判据从「machineCache 有在线机器」切换为该标志
        syncEngine?.markExecutorReady()
        // 会话 socket 重连/心跳 → 会话行 metadata 同步进 executor 追踪表（Q8 补登 + 查重键刷新）
        const engine = syncEngine
        engine?.setSessionTrackingSync(createSessionTrackingSync((sid) => engine.getSession(sid), bridge.registerSessionTracking))
    }

    /**
     * executor 状态直写（205 收敛读源，401 落库退场）：daemon 编排注入给
     * executor core——spawn 结果上报 / 关停状态经此①写 executorRuntime 内存单例（权威读源，
     * /api/daemon/status 与 daemon-status SSE 的数据源）②广播 daemon-status 事件。
     * handler 只应用一次（以 executorRuntime 旧值为基）。
     */
    const updateExecutorState = (handler: (state: ExecutorState | null) => ExecutorState): void => {
        writeExecutorState(handler)
        syncEngine?.publishDaemonStatus()
    }

    return {
        port: config.listenPort,
        hostPort: config.hostPort,
        dataDir: config.dataDir,
        setExecutorBridge,
        updateExecutorState,
        stop: async () => {
            if (stopped) return
            stopped = true
            daemonLogger.info('Shutting down...')
            notificationHub?.stop()
            syncEngine?.stop()
            sseManager?.stop()
            hostServer?.stop()
            webServer?.stop()
            settingsWatcher.stop()
            store.close()
            daemonLogger.info('Shutdown complete.')
        },
    }
}
