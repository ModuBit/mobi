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
 * Web 路由能力集（架构深化候选①）：web 层消费的 daemon 侧能力的单一声明源。
 *
 * 此前 startServer → startWebServer → createWebApp → 各路由工厂是一条手写投影链，
 * 每层各抄一份字段清单——getWarmOnOpen 曾在中间层透传时漏抄（8311f1df），warm-on-open
 * 信号链整链 noop；同族前科 emitCliNewMessage / factsSink（socket 层已按本模式收口，
 * 见 socket/capabilities.ts）。本文件把路由工厂的消费面收成一份：能力签名一份，
 * startWebServer 是它的超集（+socketEngine），createWebApp 与路由工厂只做 Pick 投影——
 * 加一个路由依赖从改 3 处变 1 处，漏字段在编译期暴露。
 */

import type { SyncEngine } from '../sync/syncEngine'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Store } from '../store'
import type { BackgroundTaskTracker } from '../sync/backgroundTaskTracker'
import type { EmbeddedWebAsset } from './embeddedAssets'

/** warm-on-open 信号出口（WarmOnOpenCoordinator 的消费面；装配缺省 noop） */
export type WarmOnOpenSignal = {
    onSessionViewed: (sessionId: string, visible: boolean) => void
}

/** web 路由消费的 daemon 能力（实体形态；各路由工厂按需 Pick 投影） */
export type WebAppDeps = {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    /** warm-on-open（票 3.3）：会话查看信号出口，缺省 noop */
    getWarmOnOpen?: () => WarmOnOpenSignal | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    corsOrigins?: string[]
    /** 嵌入式 web 静态资产（编译形态由 startWebServer 计算；直跑 dev 形态缺省走磁盘） */
    embeddedAssetMap?: Map<string, EmbeddedWebAsset> | null
    distDirOverride?: string
    /** 活跃后台任务集合（rewind API 闸门；须与 CLI socket handler 写侧共用同一实例，生产组装层必传） */
    backgroundTaskTracker?: BackgroundTaskTracker
}
