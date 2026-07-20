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
 * Mobi Hub - Main Entry Point
 *
 * Provides:
 * - Web app + HTTP API
 * - Socket.IO for CLI connections
 * - SSE updates for the web UI
 */

import { installExitLogger, installExitHandlers, resolveMobiLogsDir, resolveMobiHome, type ExitLogger } from '@mobi/shared'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProcessAlive } from './utils/process'
import { createConfiguration, type ConfigSource } from './configuration'
import { writeHubState, clearHubState } from './config/hubState'
import { Store } from './store'
import { SyncEngine, type SyncEvent } from './sync/syncEngine'
import { NotificationHub } from './notifications/notificationHub'
import type { NotificationChannel } from './notifications/notificationTypes'
import { startWebServer } from './web/server'
import { getOrCreateJwtSecret } from './config/jwtSecret'
import { startWebApiTokenWatcher } from './config/settingsWatcher'
import { createSocketServer } from './socket/server'
import { SSEManager } from './sse/sseManager'
import { getOrCreateVapidKeys } from './config/vapidKeys'
import { PushService } from './push/pushService'
import { PushNotificationChannel } from './push/pushNotificationChannel'
import { VisibilityTracker } from './visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { WebSocketData } from '@socket.io/bun-engine'

function formatSource(source: ConfigSource | 'generated'): string {
    switch (source) {
        case 'env': return 'environment'
        case 'file': return 'settings.json'
        case 'default': return 'default'
        case 'generated': return 'generated'
    }
}

/** 首次生成 token 时打印的横幅（CLI / Web 密钥共用，避免两段重复） */
function printTokenBanner(title: string, token: string, file: string, footer?: string): void {
    console.log('')
    console.log('='.repeat(70))
    console.log(`  ${title}`)
    console.log('='.repeat(70))
    console.log('')
    console.log(`  Token: ${token}`)
    console.log('')
    console.log(`  Saved to: ${file}`)
    console.log('')
    if (footer) {
        console.log(`  ${footer}`)
        console.log('')
    }
    console.log('='.repeat(70))
    console.log('')
}

let syncEngine: SyncEngine | null = null
let webServer: BunServer<WebSocketData> | null = null
let sseManager: SSEManager | null = null
let visibilityTracker: VisibilityTracker | null = null
let notificationHub: NotificationHub | null = null

/**
 * 启动检测兜底：读 hub.state.json，若上次实例 pid 已死则补记 killed-externally。
 * 覆盖 SIGKILL / OOM / 段错误等 JS 运行时来不及写记录的场景。
 */
function detectPreviousHubCrash(logger: ExitLogger): void {
    const stateFile = join(resolveMobiHome(), 'hub.state.json')
    if (!existsSync(stateFile)) return
    try {
        const prev = JSON.parse(readFileSync(stateFile, 'utf-8')) as { pid?: number; startTime?: string }
        if (typeof prev.pid === 'number' && prev.pid !== process.pid && !isProcessAlive(prev.pid)) {
            logger.recordExternalKill(prev.pid, prev.startTime)
        }
    } catch {
        // state 文件损坏，忽略
    }
}

async function main() {
    // —— 退出日志：最早挂载，确保后续配置加载失败也能捕获 ——
    const hubExitLogger = installExitLogger('hub', { logsDir: resolveMobiLogsDir() })
    installExitHandlers('hub', hubExitLogger)
    // —— OOM/SIGKILL 兜底：检测上次 hub 实例是否异常消失 ——
    detectPreviousHubCrash(hubExitLogger)

    console.log('Mobi Hub starting...')

    const config = await createConfiguration()

    // 首次生成 CLI 密钥时打印横幅
    if (config.cliApiTokenIsNew) {
        printTokenBanner('NEW CLI_API_TOKEN GENERATED', config.cliApiToken, config.settingsFile)
    } else {
        console.log(`[Hub] CLI_API_TOKEN: loaded from ${formatSource(config.sources.cliApiToken)}`)
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
        console.log(`[Hub] WEB_API_TOKEN: loaded from ${formatSource(config.sources.webApiToken)}`)
    }

    console.log(`[Hub] MOBI_LISTEN_HOST: ${config.listenHost} (${formatSource(config.sources.listenHost)})`)
    console.log(`[Hub] MOBI_LISTEN_PORT: ${config.listenPort} (${formatSource(config.sources.listenPort)})`)
    console.log(`[Hub] MOBI_PUBLIC_URL: ${config.publicUrl} (${formatSource(config.sources.publicUrl)})`)

    // 数据存储
    const store = new Store(config.dbPath)
    // JWT 密钥
    const jwtSecret = await getOrCreateJwtSecret()
    const vapidKeys = await getOrCreateVapidKeys(config.dataDir)
    const vapidSubject = process.env.VAPID_SUBJECT ?? 'mailto:admin@mobi.local'
    const pushService = new PushService(vapidKeys, vapidSubject, store)

    visibilityTracker = new VisibilityTracker()
    sseManager = new SSEManager(30_000, visibilityTracker)

    const socketServer = createSocketServer({
        store,
        jwtSecret,
        corsOrigins: config.corsOrigins,
        getSession: (sessionId) => {
            // active 状态只从内存（SyncEngine）获取，不存储在数据库中
            return syncEngine?.getSession(sessionId) ?? null
        },
        // Web 端实时事件（如文件变更、终端输出）→ 转发给 SyncEngine 处理
        onWebappEvent: (event: SyncEvent) => syncEngine?.handleRealtimeEvent(event),
        // CLI 心跳保活 → 更新会话活跃状态
        onSessionAlive: (payload) => syncEngine?.handleSessionAlive(payload),
        // CLI 断开/结束 → 清理会话资源
        onSessionEnd: (payload) => syncEngine?.handleSessionEnd(payload),
        // CLI 机器心跳 → 更新机器在线状态
        onMachineAlive: (payload) => syncEngine?.handleMachineAlive(payload)
    })

    syncEngine = new SyncEngine(store, socketServer.io, socketServer.rpcRegistry, sseManager)

    const notificationChannels: NotificationChannel[] = [
        // WEB端（SSE/WEB-PUSH)
        new PushNotificationChannel(pushService, sseManager, config.publicUrl)
    ]

    notificationHub = new NotificationHub(syncEngine, notificationChannels)

    webServer = await startWebServer({
        getSyncEngine: () => syncEngine,
        getSseManager: () => sseManager,
        getVisibilityTracker: () => visibilityTracker,
        jwtSecret,
        store,
        vapidPublicKey: vapidKeys.publicKey,
        socketEngine: socketServer.engine,
        corsOrigins: config.corsOrigins
    })

    // 启动 settings.json 监听：webApiToken 轮换时热 reload，无需重启 hub
    const settingsWatcher = startWebApiTokenWatcher()

    console.log('')
    console.log('[Web] Hub listening on :' + config.listenPort)
    console.log('[Web] Local:  http://localhost:' + config.listenPort)
    console.log('')
    console.log('Mobi Hub is ready!')

    // 写入 hub 状态文件，供 CLI status/stop 子命令使用
    writeHubState(config.dataDir, {
        pid: process.pid,
        listenHost: config.listenHost,
        listenPort: config.listenPort,
        startTime: new Date().toLocaleString()
    })

    const shutdown = async () => {
        console.log('\nShutting down...')
        clearHubState(config.dataDir)
        notificationHub?.stop()
        syncEngine?.stop()
        sseManager?.stop()
        webServer?.stop()
        settingsWatcher.stop()
        console.log('Shutdown complete.')
        process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    await new Promise(() => {})
}

main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
})
