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
 * RFB 握手代理（hub 代认证）。
 *
 * 仅代理 RFB 3.8 握手到 SecurityResult 为止：
 * - 对浏览器（noVNC）始终只提供 None 认证——不弹密码框；
 * - 对上游（macOS 屏幕共享）：上游提供 None 则原样选取；仅提供 VNC-auth 时
 *   用 cli 上行的密码代答 DES 挑战（密码不出 hub，且不落盘不日志）。
 * SecurityResult 之后进入 live 相位，调用方切回纯透传（ClientInit/ServerInit
 * 起的字节流不再经过代理；迭代 2 的 view-only 过滤器在此相位上扩展）。
 *
 * 只支持 RFB 3.8（macOS 屏幕共享的标准行为）；其余版本直接失败。
 */

export interface RfbProxyCallbacks {
    /** 下行给浏览器（observe 侧） */
    onToBrowser(data: Uint8Array): void
    /** 上行给上游（attach 侧） */
    onToServer(data: Uint8Array): void
    /** 握手终结：ok=false 时 reason 为面向日志/关闭帧的英文归因 */
    onDone(ok: boolean, reason?: string): void
}

export type RfbPhase =
    | 'server-version'
    | 'client-version'
    | 'security-types'
    | 'await-browser-choice'
    | 'challenge'
    | 'security-result'
    | 'live'
    | 'failed'

import { createCipheriv } from 'node:crypto'
import { DESKTOP_CLOSE_REASONS } from '@mobi/shared'

const RFB_3_8 = 'RFB 003.008\n'
const SECURITY_NONE = 1
const SECURITY_VNC_AUTH = 2

/**
 * 上游版本串是否可按 RFB 3.8 时序代认证，返回解析出的次版本（不可协商返回 null）。
 * RFB 版本协商取 min(server, client)：客户端（noVNC）恒发 3.8，故上游次版本 ≥ 8
 * 即协商为 3.8。macOS 屏幕共享实际回 `RFB 003.889`（Apple 私有扩展，3.8 时序超集）。
 */
function parseUpstreamMinor(version: string): number | null {
    const match = /^RFB 003\.(\d{3})\n$/.exec(version)
    if (match === null) {
        return null
    }
    const minor = Number(match[1])
    return minor >= 8 ? minor : null
}

/** VNC 认证密钥派生：密码截断/补零到 8 字节，每字节位序反转（VNC 规范的特有处理） */
function deriveVncKey(password: string): Buffer {
    const raw = Buffer.from(password, 'latin1').subarray(0, 8)
    const key = Buffer.alloc(8)
    for (let i = 0; i < 8; i++) {
        const byte = i < raw.length ? raw[i]! : 0
        let reversed = 0
        for (let bit = 0; bit < 8; bit++) {
            if (byte & (1 << bit)) {
                reversed |= 1 << (7 - bit)
            }
        }
        key[i] = reversed
    }
    return key
}

/**
 * VNC 认证应答：DES-ECB 加密传入的 challenge（标准 RFB 为前 8 字节 → 8 字节应答；
 * Apple 003.889 的屏幕共享要求整个 16 字节 challenge 加密 → 16 字节应答，实测 8 字节
 * 应答会让 macOS 挂起等待而不回 SecurityResult）。
 */
export function vncAuthResponse(challenge: Uint8Array, password: string): Uint8Array {
    const cipher = createCipheriv('des-ecb', deriveVncKey(password), null)
    cipher.setAutoPadding(false)
    return new Uint8Array(Buffer.concat([cipher.update(challenge), cipher.final()]))
}

/**
 * RFB 3.8 认证失败的下行字节：SecurityResult=1 + reason string。
 * noVNC 收到后在 securityfailure 事件携带该文案，观看页可理解展示。
 */
export function encodeAuthFailure(reason: string): Uint8Array {
    const reasonBytes = new TextEncoder().encode(reason)
    const out = Buffer.alloc(8 + reasonBytes.length)
    out.writeUInt32BE(1, 0)
    out.writeUInt32BE(reasonBytes.length, 4)
    Buffer.from(reasonBytes).copy(out, 8)
    return new Uint8Array(out)
}

interface RfbProxyDeps extends RfbProxyCallbacks {
    /** 测试注入口：替代 node:crypto DES */
    encrypt?: (block: Uint8Array, key: Buffer) => Uint8Array
    /** 相位轨迹回调（hub 侧接日志；握手是黑盒协议，出问题时没有轨迹无从诊断） */
    onTrace?: (message: string) => void
}

export class RfbHandshakeProxy {
    phase: RfbPhase = 'server-version'
    private serverBuf = Buffer.alloc(0)
    private browserBuf = Buffer.alloc(0)
    private upstreamHasNone = false
    private upstreamMinor = 8
    private finished = false

    constructor(
        private readonly vncPassword: string | undefined,
        private readonly deps: RfbProxyDeps,
    ) {}

    private trace(message: string): void {
        this.deps.onTrace?.(`phase=${this.phase} ${message}`)
    }

    /** 上游（attach 侧）来的字节 */
    feedServer(data: Uint8Array): void {
        if (this.finished || this.phase === 'live') {
            return
        }
        this.serverBuf = Buffer.concat([this.serverBuf, Buffer.from(data)])
        this.processServer()
    }

    /** 浏览器（observe 侧）来的字节 */
    feedBrowser(data: Uint8Array): void {
        if (this.finished || this.phase === 'live') {
            return
        }
        this.browserBuf = Buffer.concat([this.browserBuf, Buffer.from(data)])
        this.processBrowser()
    }

    private processServer(): void {
        switch (this.phase) {
            case 'server-version': {
                if (this.serverBuf.length < 12) return
                const version = this.serverBuf.subarray(0, 12).toString('latin1')
                this.serverBuf = this.serverBuf.subarray(12)
                const minor = parseUpstreamMinor(version)
                if (minor === null) {
                    this.trace(`server version rejected: ${JSON.stringify(version)}`)
                    this.finish(false, 'unsupported rfb version')
                    return
                }
                this.upstreamMinor = minor
                // 浏览器侧统一按 3.8 协商（代认证时序固定），上游侧由 client-version
                // 相位透传浏览器的 3.8 版本串——RFB 版本协商取 min，Apple 的 003.889
                // 收到 3.8 客户端后按 3.8 时序走（含 SecurityResult）
                this.deps.onToBrowser(new Uint8Array(Buffer.from(RFB_3_8, 'latin1')))
                this.phase = 'client-version'
                this.processBrowser()
                return
            }
            case 'security-types': {
                if (this.serverBuf.length < 1) return
                const count = this.serverBuf[0]!
                if (count === 0 || this.serverBuf.length < 1 + count) return
                const types = Array.from(this.serverBuf.subarray(1, 1 + count))
                this.serverBuf = this.serverBuf.subarray(1 + count)
                this.trace(`upstream security types: [${types.join(',')}]`)

                this.upstreamHasNone = types.includes(SECURITY_NONE)
                const canAuth = this.upstreamHasNone || (types.includes(SECURITY_VNC_AUTH) && this.vncPassword !== undefined)
                if (!canAuth) {
                    this.finish(false, types.includes(SECURITY_VNC_AUTH) ? DESKTOP_CLOSE_REASONS.VNC_PASSWORD_MISSING : 'no supported security type')
                    return
                }
                // 浏览器只看到 None-only offer：不需要密码，也不弹密码框
                this.deps.onToBrowser(new Uint8Array([1, SECURITY_NONE]))
                this.phase = 'await-browser-choice'
                this.processBrowser()
                return
            }
            case 'challenge': {
                if (this.serverBuf.length < 16) return
                const challenge = new Uint8Array(this.serverBuf.subarray(0, 16))
                this.serverBuf = this.serverBuf.subarray(16)
                this.trace('upstream challenge received, answering on behalf of browser')
                if (this.vncPassword === undefined) {
                    this.finish(false, DESKTOP_CLOSE_REASONS.VNC_PASSWORD_MISSING)
                    return
                }
                // Apple 003.889 要求对整个 16 字节 challenge 加密应答（16 字节）；
                // 标准 RFB 只加密前 8 字节（8 字节应答）——见 vncAuthResponse 注释
                const responseBytes = this.upstreamMinor === 889 ? 16 : 8
                const response = this.deps.encrypt
                    ? this.deps.encrypt(challenge.subarray(0, responseBytes), deriveVncKey(this.vncPassword))
                    : vncAuthResponse(challenge.subarray(0, responseBytes), this.vncPassword)
                this.deps.onToServer(response)
                this.phase = 'security-result'
                return
            }
            case 'security-result': {
                if (this.serverBuf.length < 4) return
                const result = new Uint8Array(this.serverBuf.subarray(0, 4))
                this.serverBuf = this.serverBuf.subarray(4)
                const ok = (result[0] | (result[1]! << 8) | (result[2]! << 16) | (result[3]! << 24)) === 0
                this.trace(`upstream security result: ${ok ? 'ok' : 'failed'}`)
                if (ok) {
                    this.deps.onToBrowser(result)
                    this.finish(true)
                    return
                }
                // RFB 3.8 标准失败序列：result=1 之后跟 reason string，noVNC 据此在
                // securityfailure 事件里给出可理解文案（随后 hub 拆会话关闭连接）
                this.deps.onToBrowser(encodeAuthFailure(DESKTOP_CLOSE_REASONS.VNC_AUTH_FAILED))
                this.finish(false, DESKTOP_CLOSE_REASONS.VNC_AUTH_FAILED)
                return
            }
            default:
                return
        }
    }

    private processBrowser(): void {
        switch (this.phase) {
            case 'client-version': {
                if (this.browserBuf.length < 12) return
                const version = this.browserBuf.subarray(0, 12)
                this.browserBuf = this.browserBuf.subarray(12)
                this.deps.onToServer(new Uint8Array(version))
                this.phase = 'security-types'
                this.processServer()
                return
            }
            case 'await-browser-choice': {
                if (this.browserBuf.length < 1) return
                this.browserBuf = this.browserBuf.subarray(1)
                // 浏览器只会看到 None-only，理论上必选 1；防御非 1 选择按 None 处理
                if (this.upstreamHasNone) {
                    this.trace('browser chose None → pass through to upstream')
                    this.deps.onToServer(new Uint8Array([SECURITY_NONE]))
                    this.phase = 'security-result'
                } else {
                    this.trace('browser chose None →代答上游 VNC-auth')
                    this.deps.onToServer(new Uint8Array([SECURITY_VNC_AUTH]))
                    this.phase = 'challenge'
                }
                this.processServer()
                return
            }
            default:
                return
        }
    }

    private finish(ok: boolean, reason?: string): void {
        if (this.finished) {
            return
        }
        this.trace(ok ? 'handshake complete → live passthrough' : `handshake failed: ${reason}`)
        this.finished = true
        this.phase = ok ? 'live' : 'failed'
        this.deps.onDone(ok, reason)
    }
}
