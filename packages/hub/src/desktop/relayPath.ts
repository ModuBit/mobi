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
 * Desktop 中继相位机（RelayPath）。
 *
 * 一条观看链路从「attach metadata 门」到「live 透传」之间的全部相位决策
 * 收在这一个 module：metadata 校验、早期字节缓冲、RFB 握手代理装配（代
 * 认证）、输入过滤器接入、控制权与相位的追平。接口是纯字节进出：feed /
 * peerJoined 返回 RelayAction 列表，不持有任何 socket——broker 是它的
 * WS adapter（forward 交给目标方向发送，fail 拆会话），因此相位转移可以
 * 表驱动测试而无需模拟 WebSocket。
 *
 * 保留的时序不变量（Bun ServerWebSocket 读取侧不可暂停）：
 * metadata 之后、对端加入之前到达的早期字节由帧缓冲攒着，握手代理建立时
 * 移交，首字节不丢。这不是背压队列（见 broker 的 relay 注释）。
 */

import { desktopAttachMetadataSchema } from '@mobi/shared'
import { RfbHandshakeProxy } from './rfbPreauth'
import { createRfbInputFilter, RfbProtocolError, type RfbInputFilter } from './rfbInputFilter'

/** 中继的两个方向：attach = 上游（cli 泵 ↔ VNC server），observe = 浏览器（noVNC） */
export type RelayTarget = 'attach' | 'observe'

/** 相位机的输出动作：调用方负责执行——forward 发往 target 方向，fail 按协议错误拆会话 */
export type RelayAction =
    | { kind: 'forward'; target: RelayTarget; data: Uint8Array }
    | { kind: 'fail'; reason: string }

export interface RelayPathOptions {
    machineId: string
    /** 单帧字节上限（metadata 门与帧守卫共用） */
    maxFrameBytes: number
    /** 相位轨迹（hub 接日志；握手是黑盒协议，出问题时没有轨迹无从诊断） */
    onTrace?: (message: string) => void
    /** controlled 下放行了输入类消息：调用方用它重置控制权空闲计时 */
    onInputObserved?: () => void
}

export class RelayPath {
    private metadataAccepted = false
    /** VNC 密码（来自 attach metadata；仅内存持有，供握手代理代答） */
    private vncPassword?: string
    private attachJoined = false
    private observeJoined = false
    private handshake: RfbHandshakeProxy | null = null
    private handshakeLive = false
    private controlled = false
    private inputFilter: RfbInputFilter | null = null
    /** 早期帧缓冲：对端未就绪/握手未建立时先攒着（非背压队列，见文件头注释） */
    private toAttach: unknown[] = []
    private toObserve: unknown[] = []
    /** 本次调用的待执行动作：握手代理回调同步产出，统一在返回时交付调用方 */
    private outbox: RelayAction[] = []

    constructor(private readonly options: RelayPathOptions) {}

    /** 某一侧 WS 开链。两侧就绪且 metadata 已过门即建代理并移交缓冲字节 */
    peerJoined(role: RelayTarget): RelayAction[] {
        this.outbox = []
        if (role === 'attach') {
            this.attachJoined = true
        } else {
            this.observeJoined = true
        }
        this.tryStart()
        return this.outbox
    }

    /** 某一侧的一帧字节：按当前相位做门校验/代答/缓冲/过滤/转发决策 */
    feed(role: RelayTarget, data: unknown): RelayAction[] {
        this.outbox = []
        // metadata 门：attach 首帧必须是二进制 JSON 且 machineId 一致，否则协议错误
        if (role === 'attach' && !this.metadataAccepted) {
            this.acceptMetadata(data)
            return this.outbox
        }
        // 每帧大小守卫（防恶意大帧）
        if (frameBytes(data) > this.options.maxFrameBytes) {
            return this.fail('frame too large')
        }
        // 握手相位：字节交给 RFB 代理（代认证），完成（live）后不再经过它
        if (this.handshake && !this.handshakeLive) {
            if (role === 'attach') {
                this.handshake.feedServer(data as Uint8Array)
            } else {
                this.handshake.feedBrowser(data as Uint8Array)
            }
            return this.outbox
        }
        if (role === 'attach') {
            // observe 未就绪：上游早期字节缓冲（macOS 连接后立即发版本串，读取侧不可暂停）
            if (!this.observeJoined) {
                this.toObserve.push(data)
                return this.outbox
            }
            this.outbox.push({ kind: 'forward', target: 'observe', data: data as Uint8Array })
            return this.outbox
        }
        // observe 上行：attach 未就绪先缓冲
        if (!this.attachJoined) {
            this.toAttach.push(data)
            return this.outbox
        }
        // 握手 live 后过输入过滤器（控制权强制边界）：view-only 剥输入类，
        // controlled 放行（SetDesktopSize 恒剥），解析错位即协议错误拆会话
        if (this.inputFilter) {
            let filtered
            try {
                filtered = this.inputFilter.feed(data as Uint8Array)
            } catch (error) {
                if (error instanceof RfbProtocolError) {
                    this.inputFilter.reset()
                    return this.fail('rfb input parse failed')
                }
                throw error
            }
            if (filtered.sawInput && this.controlled) {
                this.options.onInputObserved?.()
            }
            if (filtered.passthrough.byteLength > 0) {
                this.outbox.push({ kind: 'forward', target: 'attach', data: filtered.passthrough })
            }
            return this.outbox
        }
        this.outbox.push({ kind: 'forward', target: 'attach', data: data as Uint8Array })
        return this.outbox
    }

    /** 控制权翻转：过滤器存在则同步；握手前授予的由 tryStart 追平到新过滤器 */
    setControlled(controlled: boolean): void {
        this.controlled = controlled
        this.inputFilter?.setControlled(controlled)
    }

    private tryStart(): void {
        if (!this.attachJoined || !this.observeJoined || !this.metadataAccepted || this.handshake) {
            return
        }
        const handshake = new RfbHandshakeProxy(this.vncPassword, {
            onTrace: (message) => this.options.onTrace?.(message),
            onToBrowser: (data) => this.outbox.push({ kind: 'forward', target: 'observe', data }),
            onToServer: (data) => this.outbox.push({ kind: 'forward', target: 'attach', data }),
            onDone: (ok, reason) => {
                if (ok) {
                    this.handshakeLive = true
                } else {
                    this.fail(reason ?? 'handshake failed')
                }
            },
        })
        this.handshake = handshake
        // 握手 live 后 observe 上行要过输入过滤器（控制权边界），随代理一并建立
        this.inputFilter = createRfbInputFilter()
        if (this.controlled) {
            this.inputFilter.setControlled(true)
        }
        // 握手建立前缓冲的早期字节先喂给代理（先上游后浏览器，与到达序一致）
        for (const frame of this.toObserve.splice(0)) {
            handshake.feedServer(frame as Uint8Array)
        }
        for (const frame of this.toAttach.splice(0)) {
            handshake.feedBrowser(frame as Uint8Array)
        }
    }

    private acceptMetadata(data: unknown): void {
        let metadata: unknown
        try {
            if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
                throw new Error('metadata must be binary')
            }
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
            if (bytes.byteLength === 0 || bytes.byteLength > this.options.maxFrameBytes) {
                throw new Error('metadata size out of range')
            }
            metadata = JSON.parse(new TextDecoder().decode(bytes))
        } catch {
            this.fail('invalid attach metadata')
            return
        }
        const parsed = desktopAttachMetadataSchema.safeParse(metadata)
        if (!parsed.success || parsed.data.machineId !== this.options.machineId) {
            this.fail('attach metadata mismatch')
            return
        }
        this.metadataAccepted = true
        this.vncPassword = parsed.data.vncPassword
        this.tryStart()
    }

    private fail(reason: string): RelayAction[] {
        this.outbox.push({ kind: 'fail', reason })
        return this.outbox
    }
}

/** 帧字节数（Buffer 是 Uint8Array 子类，一并覆盖；string 按 UTF-16 长度近似——守卫场景足够） */
export function frameBytes(data: unknown): number {
    if (data instanceof Uint8Array) return data.byteLength
    if (data instanceof ArrayBuffer) return data.byteLength
    if (typeof data === 'string') return data.length
    return 64
}
