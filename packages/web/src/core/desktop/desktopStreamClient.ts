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

import { DESKTOP_CLOSE_REASONS } from '@mobi/shared'

export interface DesktopViewConnection {
    /** 幂等断开（含卸载清理与重连前的回收） */
    disconnect(): void
    /** 翻转只读（控制权授予/回落）：noVNC 运行时属性，键盘/指针处理器实时读取 */
    setViewOnly(viewOnly: boolean): void
    /** 展示面容器尺寸变化后重算 scaleViewport（noVNC 自身只监听 window resize） */
    requestResize(): void
    /** 发送一次远端按键：down 缺省 = 敲击（按下并释放）；修饰键组合须显式 down/up */
    sendKey(keysym: number, down?: boolean): void
    /** 发送文本（移动端软键盘桥）：换行归一为 Enter；非 BMP 字符直接走 Unicode keysym */
    sendText(text: string): void
}

export interface DesktopViewCallbacks {
    onConnect?: () => void
    /**
     * 首条服务端数据到达（≈首帧渲染）：RFB connect 事件只代表协商开始，
     * 5K 大分辨率首帧洪峰传输可达数秒——此信号供 UI 收起 loading 覆盖层。
     */
    onFirstFrame?: () => void
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
        /** keysym 敲击/按下释放；code 缺省时 noVNC 不做物理键映射（移动端桥路径） */
        sendKey(keysym: number, code?: string | null, down?: boolean): void
        addEventListener(type: string, listener: (event: CustomEvent) => void): void
    }
}

export const defaultRfbLoader: RfbLoader = async () => {
    const module = (await import('@novnc/novnc')) as unknown as { default: RfbConstructor }
    return module.default
}

/**
 * hub 关闭归因（英文协议文案，常量单源在 shared DESKTOP_CLOSE_REASONS）→ 观看页 i18n 键。
 * 未知归因返回 null，调用方回退展示原始 reason；此处只做已知归因的可理解翻译。
 */
export function describeDesktopFailure(reason: string): string | null {
    switch (reason) {
        case DESKTOP_CLOSE_REASONS.VNC_AUTH_FAILED:
            return 'desktop.failure.vncAuthFailed'
        case DESKTOP_CLOSE_REASONS.VNC_PASSWORD_MISSING:
            return 'desktop.failure.vncPasswordMissing'
        case DESKTOP_CLOSE_REASONS.STREAM_CLOSED:
            return 'desktop.failure.streamClosed'
        case DESKTOP_CLOSE_REASONS.SUPERSEDED:
            return 'desktop.failure.superseded'
        case DESKTOP_CLOSE_REASONS.UPSTREAM_UNAVAILABLE:
            return 'desktop.failure.upstreamUnavailable'
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
    // 首条服务端数据（RFB 版本串起）即触发：noVNC 收帧到 blit canvas 是同步的
    ws.addEventListener('message', () => {
        if (!retired) callbacks.onFirstFrame?.()
    }, { once: true })
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

    // noVNC 的键盘翻译器挂在容器的 canvas 上：合成键盘事件派发给它即等价远端注入
    const dispatchKeyboardEvent = (event: KeyboardEvent) => {
        container.querySelector('canvas')?.dispatchEvent(event)
    }

    return {
        disconnect() {
            if (retired) {
                return
            }
            retired = true
            rfb.disconnect()
        },
        setViewOnly(viewOnly: boolean) {
            if (retired) {
                return
            }
            rfb.viewOnly = viewOnly
        },
        requestResize() {
            if (retired) {
                return
            }
            // 触发 noVNC 的 scaleViewport setter（内部重算 clip/scale）
            rfb.scaleViewport = true
        },
        sendKey(keysym: number, down?: boolean) {
            if (retired) {
                return
            }
            rfb.sendKey(keysym, null, down)
        },
        sendText(text: string) {
            if (retired) {
                return
            }
            // 移动端 IME 常不发 keydown/keyup：code=Unidentified 让 noVNC 的键盘翻译器
            // 对每个插入字符给出成对的按下/释放（openclaw 同款）。换行走 Enter 而非
            // Unicode LF；增补字符（length===2）超出 DOM 翻译器范围，直接发完整
            // Unicode scalar keysym（0x01000000 | codepoint）
            const normalized = text.replace(/\r\n?/g, '\n')
            for (const character of normalized) {
                if (character.length === 2) {
                    rfb.sendKey(0x01000000 | (character.codePointAt(0) as number), null)
                    continue
                }
                dispatchKeyboardEvent(
                    new KeyboardEvent('keydown', {
                        key: character === '\n' ? 'Enter' : character,
                        code: 'Unidentified',
                        bubbles: true,
                        cancelable: true,
                    }),
                )
            }
        },
    }
}
