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
 * RFB client→server 输入过滤器（迭代 2：控制权的服务端强制边界）。
 *
 * 观察侧（浏览器 noVNC）上行的字节流在此按 RFB 消息边界解析：
 * view-only 时剥除全部输入类消息（KeyEvent/PointerEvent/ClientCutText/SetDesktopSize），
 * controlled 时放行输入类、仅恒剥 SetDesktopSize（macOS 屏幕共享不支持分辨率协商，
 * 该消息无意义且属输入类变更）。观看必需消息（FramebufferUpdateRequest 等）恒放行。
 *
 * 解析器是流式的：WS 帧边界与 RFB 消息边界无关，半截消息在 carry 缓冲里
 * 等到完整才做剥除决策（消息头固定、长度可预知，无需整帧重组）。
 * 未知消息类型抛 RfbProtocolError——过滤器是安全边界，宁可拆会话不放过来路不明的字节。
 */

/** RFB 协议解析失败（消息边界错位或未知类型）：调用方应按协议错误拆会话 */
export class RfbProtocolError extends Error {}

export interface RfbInputFilterResult {
    /** 应放行转发给上游的字节（按完整消息重组；剥除消息后可能为空） */
    passthrough: Uint8Array
    /** 本次喂入是否包含输入类消息（含被剥除的）：broker 用它重置控制权空闲计时 */
    sawInput: boolean
}

export interface RfbInputFilter {
    /** 喂入观察侧上行字节；未知消息类型抛 RfbProtocolError（异常后实例不可再用，须 reset） */
    feed(data: Uint8Array): RfbInputFilterResult
    /** 翻转 controlled 模式（控制权授予/回落） */
    setControlled(controlled: boolean): void
    /** 丢弃跨帧残留（会话拆除/协议错误后复位） */
    reset(): void
}

/** 输入类消息的剥除策略：false = 两态恒剥，true = 仅 view-only 剥除 */
const INPUT_MESSAGE_TYPES = new Set<number>([
    4, // KeyEvent
    5, // PointerEvent
    6, // ClientCutText
    251, // SetDesktopSize（恒剥：macOS 屏幕共享不支持，属输入类变更）
])

/** 恒放行的非输入类消息（协议协商与观看必需） */
const KNOWN_MESSAGE_TYPES = new Set<number>([...INPUT_MESSAGE_TYPES, 0, 2, 3, 248, 249, 252])

/**
 * client→server 消息形状表（RFB 3.8 + TigerVNC 扩展，与 RFC 6143 对照）：
 * 返回该消息总字节数；fixed = 定长，var开头 = 依赖头内字段的可变长。
 * - 0 SetPixelFormat：定长 20
 * - 2 SetEncodings：4 + 4×numberOfEncodings
 * - 3 FramebufferUpdateRequest：定长 10
 * - 4 KeyEvent：定长 8；5 PointerEvent：定长 6
 * - 6 ClientCutText：8 + 4 字节 length
 * - 248 ClientFence：8 + 4 字节 length
 * - 249 EnableContinuousUpdates：定长 10
 * - 251 SetDesktopSize：8 + 4×numberOfScreens；252 xvp：定长 4
 */
function messageLength(type: number, buffer: Uint8Array): number | null {
    switch (type) {
        case 0:
            return 20
        case 3:
        case 249:
            return 10
        case 4:
            return 8
        case 5:
            return 6
        case 252:
            return 4
        case 2: {
            if (buffer.byteLength < 4) return null
            const count = (buffer[2] << 8) | buffer[3]
            return 4 + 4 * count
        }
        case 6: {
            if (buffer.byteLength < 8) return null
            const length = decodeU32(buffer, 4)
            return 8 + length
        }
        case 248: {
            // ClientFence：type(1) pad(3) flags(4) length(4)——length 在 offset 8
            if (buffer.byteLength < 12) return null
            const length = decodeU32(buffer, 8)
            return 12 + length
        }
        case 251: {
            if (buffer.byteLength < 8) return null
            const screens = buffer[6]
            return 8 + 4 * screens
        }
        default:
            return null
    }
}

function decodeU32(buffer: Uint8Array, offset: number): number {
    // ClientCutText/Fence 的 length 视作无符号（>>> 保证 >2GB 不变负）
    return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0
}

/** 单条消息超限即视为恶意流（消息头已声明不可能的长度），不等收齐 */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024

export function createRfbInputFilter(): RfbInputFilter {
    let controlled = false
    let carry: Uint8Array | null = null
    /** live 相位的第一个字节是 ClientInit（裸 1 字节 shared-flag，非类型化消息），直通后才开始消息解析 */
    let clientInitSeen = false

    function feed(data: Uint8Array): RfbInputFilterResult {
        const buffer = carry ? concat(carry, data) : data
        carry = null

        const passthrough: Uint8Array[] = []
        let sawInput = false
        let offset = 0

        if (!clientInitSeen) {
            if (buffer.byteLength < 1) {
                carry = buffer
                return { passthrough: new Uint8Array(0), sawInput: false }
            }
            passthrough.push(buffer.subarray(0, 1))
            clientInitSeen = true
            offset = 1
        }

        while (offset < buffer.byteLength) {
            const type = buffer[offset]
            if (!KNOWN_MESSAGE_TYPES.has(type)) {
                throw new RfbProtocolError(`unknown rfb client message type ${type}`)
            }

            const length = messageLength(type, buffer.subarray(offset))
            if (length !== null && length > MAX_MESSAGE_BYTES) {
                throw new RfbProtocolError(`rfb message length overflow: ${length}`)
            }
            if (length === null || offset + length > buffer.byteLength) {
                // 半截消息：从消息头开始留待下一帧
                carry = buffer.slice(offset)
                break
            }

            const message = buffer.subarray(offset, offset + length)
            const isInput = INPUT_MESSAGE_TYPES.has(type)
            if (isInput) {
                sawInput = true
            }
            // SetDesktopSize 恒剥；其余输入类仅 view-only 剥；非输入恒放行
            if (!isInput || (type !== 251 && controlled)) {
                passthrough.push(message)
            }
            offset += length
        }

        // 常见路径（单条完整消息/直通）零拷贝返回视图；调用方 send 后不保留引用。
        // 仅多片段（一帧含多条消息 + 直通首字节）才归并复制
        if (passthrough.length === 1) {
            return { passthrough: passthrough[0], sawInput }
        }
        if (passthrough.length === 0) {
            return { passthrough: new Uint8Array(0), sawInput }
        }
        const total = passthrough.reduce((sum, piece) => sum + piece.byteLength, 0)
        const merged = new Uint8Array(total)
        let cursor = 0
        for (const piece of passthrough) {
            merged.set(piece, cursor)
            cursor += piece.byteLength
        }
        return { passthrough: merged, sawInput }
    }

    return {
        feed,
        setControlled(next) {
            controlled = next
        },
        reset() {
            carry = null
            clientInitSeen = false
        },
    }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.byteLength + b.byteLength)
    out.set(a, 0)
    out.set(b, a.byteLength)
    return out
}
