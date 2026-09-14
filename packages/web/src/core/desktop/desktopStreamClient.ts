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
    /** clean=false 表示异常断开（网络/协议），调用方决定是否重走 watch */
    onDisconnect?: (detail: { clean: boolean }) => void
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

export async function connectDesktopView(options: {
    url: string
    container: HTMLElement
    callbacks?: DesktopViewCallbacks
    loader?: RfbLoader
}): Promise<DesktopViewConnection> {
    const { url, container, callbacks = {}, loader = defaultRfbLoader } = options
    const Rfb = await loader()

    let retired = false
    const rfb = new Rfb(container, url, {
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
        callbacks.onDisconnect?.({ clean })
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
