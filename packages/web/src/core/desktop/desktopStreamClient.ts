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
 * noVNC 客户端轻封装（迭代 1 只读观看）。
 *
 * 职责收敛于三点：动态加载 @novnc/novnc、把 RFB 生命周期翻译成回调、
 * 统一 disconnect 语义（noVNC 的终态是永久的，重复 disconnect 须为幂等）。
 * 移动端键盘桥/控制权等重语义在后续迭代引入（参照 openclaw desktop-client）。
 */

export interface DesktopViewConnection {
    /** 幂等断开（含卸载清理与重连前的回收） */
    disconnect(): void
}

export interface DesktopViewCallbacks {
    onConnect?: () => void
    /**
     * clean=false 表示异常断开（网络/协议），调用方决定是否重走 watch；
     * close 携带底层 WS 关闭码（noVNC 不透传，由本封装在自建 WS 上捕获）：
     * 4000=被抢占、4002=被主动关闭——这类归因不该自动重连。
     */
    onDisconnect?: (detail: { clean: boolean; close?: { code: number; reason: string } }) => void
    onFailure?: (message: string) => void
}

/** 测试注入口：默认动态加载 @novnc/novnc */
export type RfbLoader = () => Promise<RfbConstructor>

export interface RfbConstructor {
    new (
        target: HTMLElement,
        urlOrChannel: string | WebSocket,
        options?: Record<string, unknown>,
    ): {
        scaleViewport: boolean
        viewOnly: boolean
        background: string
        disconnect(): void
        addEventListener(type: string, listener: (event: CustomEvent) => void): void
    }
}

export const defaultRfbLoader: RfbLoader = async () => {
    const module = (await import('@novnc/novnc')) as unknown as { default: RfbConstructor }
    return module.default
}

/**
 * hub 关闭归因（英文协议文案）→ 观看页 i18n 键。
 * 未知归因返回 null，调用方回退展示原始 reason（hub 归因是协议单源，
 * 见 hub 侧 RfbHandshakeProxy；此处只做已知归因的可理解翻译）。
 */
export function describeDesktopFailure(reason: string): string | null {
    switch (reason) {
        case 'vnc auth failed':
            return 'desktop.failure.vncAuthFailed'
        case 'vnc password not configured':
            return 'desktop.failure.vncPasswordMissing'
        case 'stream closed':
            return 'desktop.failure.streamClosed'
        case 'superseded':
            return 'desktop.failure.superseded'
        default:
            return null
    }
}

export async function connectDesktopView(options: {
    url: string
    container: HTMLElement
    callbacks?: DesktopViewCallbacks
    loader?: RfbLoader
}): Promise<DesktopViewConnection> {
    const { url, container, callbacks = {}, loader = defaultRfbLoader } = options
    const Rfb = await loader()

    let retired = false
    // noVNC 收到的是自建 WS 实例：close 事件在此捕获（code/reason noVNC 不透传）
    let closeInfo: { code: number; reason: string } | undefined
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.addEventListener('close', (event) => {
        closeInfo = { code: (event as CloseEvent).code, reason: (event as CloseEvent).reason }
    })
    const rfb = new Rfb(container, ws, {
        shared: false,
    })
    rfb.scaleViewport = true
    rfb.viewOnly = true
    rfb.background = 'transparent'

    rfb.addEventListener('connect', () => {
        if (!retired) callbacks.onConnect?.()
    })
    rfb.addEventListener('disconnect', (event) => {
        // noVNC 终态永久：断开后连接对象不再可用
        retired = true
        const clean = Boolean((event as CustomEvent<{ clean?: boolean }>).detail?.clean)
        callbacks.onDisconnect?.({ clean, close: closeInfo })
    })
    rfb.addEventListener('securityfailure', (event) => {
        const detail = (event as CustomEvent<{ reason?: string }>).detail
        callbacks.onFailure?.(detail?.reason ?? 'authentication failed')
    })

    return {
        disconnect() {
            if (retired) {
                return
            }
            retired = true
            rfb.disconnect()
        },
    }
}
