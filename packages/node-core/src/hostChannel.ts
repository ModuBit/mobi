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
 * 宿主通道拓扑（架构评审候选⑤）：宿主通道地址知识的单一归属。
 *
 * 「宿主端口 = 主端口 + 10000（2222→12222）」此前散落四处靠注释对齐——daemon 侧
 * HOST_PORT_OFFSET、node-core 开箱默认 12222、executor 直跑回退硬编码 2222、doctor
 * 文案。本 module 单源派生规则（env MOBI_HOST_PORT 覆盖 + 非法回退派生 fail-open +
 * 越界 wrap）与 loopback URL 构造；daemon 权威派生、同机 CLI 开箱默认、executor
 * spawn 注入三方只消费这里的结论，不再各自推导。
 *
 * 通道本身的决策（独立 loopback listener、不经 frp 暴露）见 ADR 0009，本 module
 * 只单源它的地址知识。
 */

import { readFileSync } from 'node:fs'

/** daemon 主端口默认值（开箱：2222 → 宿主 12222） */
export const DEFAULT_LISTEN_PORT = 2222

// 警告走 console.warn 而非本包 logger 单例：logger 顶层构造读 configuration，
// configuration 又消费本 module，import 会成环（TDZ 崩溃）；fail-open 警告频率极低，console 可见即可

/** 宿主端口派生偏移：listenPort + 10000 */
export const HOST_PORT_OFFSET = 10_000

/** 宿主端口解析：env MOBI_HOST_PORT 优先，否则按主端口派生（非法值回退派生，fail-open） */
export function resolveHostPort(listenPort: number): number {
    const raw = process.env.MOBI_HOST_PORT
    if (raw) {
        const parsed = Number.parseInt(raw, 10)
        if (Number.isFinite(parsed) && parsed > 0 && parsed < 65_536) {
            return parsed
        }
        console.warn(`[HOST_CHANNEL] MOBI_HOST_PORT="${raw}" 非法（须为 1-65535），回退派生端口`)
    }
    // 派生越界（listenPort 接近 65535 时）wrap 回非特权段；生产端口 2222-2224 派生恒在界内
    const derived = listenPort + HOST_PORT_OFFSET
    if (derived <= 65_535) {
        return derived
    }
    console.warn(`[HOST_CHANNEL] listenPort ${listenPort} 派生宿主端口 ${derived} 越界，wrap 回非特权段`)
    return 1_024 + (derived % (65_535 - 1_024))
}

/** 宿主通道 loopback URL（会话子进程回连 / 同机 CLI 默认地址） */
export function hostChannelUrl(hostPort: number): string {
    return `http://127.0.0.1:${hostPort}`
}

/** 同机 CLI 的开箱默认地址：daemon 按默认主端口起时的宿主通道 URL */
export function defaultHostChannelUrl(): string {
    return hostChannelUrl(resolveHostPort(DEFAULT_LISTEN_PORT))
}

/** 从 JSON 文件读合法端口（整数 1-65535）；缺失/损坏/非法 fail-open 返回 null */
function readJsonPort(file: string, key: string): number | null {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        const port = Number(parsed[key])
        return Number.isFinite(port) && Number.isInteger(port) && port > 0 && port < 65_536 ? port : null
    } catch {
        return null
    }
}

/**
 * 同机 CLI 的连接地址：daemon 自己是唯一权威，CLI 不维护会漂移的手写副本。
 *
 * ADR 0009（ticket-25）删除了 settings.cli.json 的 apiUrl——连接目标从权威源派生：
 * 1. daemon 运行中：daemon.state.json 的 hostPort（daemon 启动时写入的事实）
 * 2. daemon 未运行：settings.daemon.json 的 listenPort 派生（拉起后的配置意图，
 *    覆盖 wizard 自定义端口场景），派生经 resolveHostPort 尊重 MOBI_HOST_PORT env
 * 3. 都没有：默认主端口派生（开箱 2222→12222）
 *
 * 任意一层 fail-open：读不到/损坏即落下一层，CLI 永远拿到可用地址。
 */
export function localDaemonHostChannelUrl(daemonStateFile: string, daemonSettingsFile: string): string {
    const stateHostPort = readJsonPort(daemonStateFile, 'hostPort')
    if (stateHostPort !== null) {
        return hostChannelUrl(stateHostPort)
    }
    const listenPort = readJsonPort(daemonSettingsFile, 'listenPort')
    if (listenPort !== null) {
        return hostChannelUrl(resolveHostPort(listenPort))
    }
    return defaultHostChannelUrl()
}
