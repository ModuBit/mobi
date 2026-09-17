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

import { describe, expect, test } from 'bun:test'
import { createRfbInputFilter, RfbProtocolError } from '../../src/desktop/rfbInputFilter'

/** 构造一条完整的 client→server 消息 */
function msg(type: number, body: number[] = []): Uint8Array {
    return new Uint8Array([type, ...body])
}

// —— 各消息类型的合法形状（与 RFB 3.8 规范对照，见 rfbInputFilter.ts 的表） ——

/** FramebufferUpdateRequest（type 3，恒 10 字节） */
function fbUpdateReq(incremental = 1): Uint8Array {
    return msg(3, [incremental, 0, 0, 0, 0, 0, 0, 0, 0])
}

/** KeyEvent（type 4，恒 8 字节）：down-flag + key symbol */
function keyEvent(key = 0x41, down = 1): Uint8Array {
    return msg(4, [down, 0, 0, ...u32be(key)])
}

/** PointerEvent（type 5，恒 6 字节） */
function pointerEvent(x = 1, y = 2): Uint8Array {
    return msg(5, [1, ...u16be(x), ...u16be(y)])
}

/** ClientCutText（type 6，8 字节头 + 文本） */
function cutText(text = 'hi'): Uint8Array {
    const bytes = new TextEncoder().encode(text)
    return msg(6, [0, 0, 0, ...u32be(bytes.length), ...bytes])
}

/** SetPixelFormat（type 0，恒 20 字节） */
function setPixelFormat(): Uint8Array {
    return msg(0, new Array<number>(19).fill(0))
}

/** SetEncodings（type 2，4 + 4n 字节）：n 个编码 */
function setEncodings(n = 1): Uint8Array {
    const encodings = Array.from({ length: n }, () => u32be(0x10)).flat()
    return msg(2, [0, ...u16be(n), ...encodings])
}

/** ClientFence（type 248，8 + length 字节） */
function clientFence(payload = 4): Uint8Array {
    return msg(248, [0, 0, 0, ...u32be(0), ...u32be(payload), ...new Array<number>(payload).fill(0)])
}

/** EnableContinuousUpdates（type 249，恒 10 字节） */
function continuousUpdates(): Uint8Array {
    return msg(249, [1, 0, 0, 0, 0, 0, 0, 0, 0])
}

/** SetDesktopSize（type 251，8 + 4n 字节）：1 个屏 */
function setDesktopSize(n = 1): Uint8Array {
    return msg(251, [0, ...u16be(1920), ...u16be(1080), n, 0, ...new Array<number>(4 * n).fill(0)])
}

/** xvp client message（type 252，恒 4 字节） */
function xvp(): Uint8Array {
    return msg(252, [0, 1, 2])
}

function u16be(v: number): number[] {
    return [(v >> 8) & 0xff, v & 0xff]
}

function u32be(v: number): number[] {
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
}

describe('rfb input filter: view-only 剥除', () => {
    test('输入类消息（KeyEvent/PointerEvent/ClientCutText）被剥除', () => {
        const filter = createRfbInputFilter()
        const result = filter.feed(concat(keyEvent(), pointerEvent(), cutText()))
        expect(result.passthrough).toHaveLength(0)
        expect(result.sawInput).toBe(true)
    })

    test('SetDesktopSize 在 view-only 下同样被剥除', () => {
        const filter = createRfbInputFilter()
        const result = filter.feed(setDesktopSize())
        expect(result.passthrough).toHaveLength(0)
        expect(result.sawInput).toBe(true)
    })

    test('非输入类消息原样放行（观看必需）', () => {
        const filter = createRfbInputFilter()
        const input = concat(setPixelFormat(), fbUpdateReq(), setEncodings(), clientFence(), continuousUpdates(), xvp())
        const result = filter.feed(input)
        expect(result.passthrough).toEqual(input)
        expect(result.sawInput).toBe(false)
    })

    test('混合流：只剥输入类，其余保持边界完整', () => {
        const filter = createRfbInputFilter()
        const result = filter.feed(concat(fbUpdateReq(), keyEvent(), fbUpdateReq(0)))
        expect(result.passthrough).toEqual(concat(fbUpdateReq(), fbUpdateReq(0)))
    })
})

describe('rfb input filter: controlled 放行', () => {
    test('输入类消息放行', () => {
        const filter = createRfbInputFilter()
        filter.setControlled(true)
        const input = concat(keyEvent(), pointerEvent(), cutText())
        const result = filter.feed(input)
        expect(result.passthrough).toEqual(input)
        expect(result.sawInput).toBe(true)
    })

    test('SetDesktopSize 恒剥除（即使 controlled）', () => {
        const filter = createRfbInputFilter()
        filter.setControlled(true)
        const result = filter.feed(setDesktopSize())
        expect(result.passthrough).toHaveLength(0)
    })

    test('回落 view-only 后恢复剥除', () => {
        const filter = createRfbInputFilter()
        filter.setControlled(true)
        filter.setControlled(false)
        const result = filter.feed(keyEvent())
        expect(result.passthrough).toHaveLength(0)
    })
})

describe('rfb input filter: 跨帧消息边界', () => {
    test('半截消息跨 feed 到达：剥除决策等到消息完整', () => {
        const filter = createRfbInputFilter()
        const key = keyEvent()
        const first = filter.feed(key.slice(0, 3))
        expect(first.passthrough).toHaveLength(0)
        const second = filter.feed(key.slice(3))
        expect(second.passthrough).toHaveLength(0)
        expect(second.sawInput).toBe(true)
    })

    test('半截非输入消息跨 feed 完整重组后放行', () => {
        const filter = createRfbInputFilter()
        const upd = fbUpdateReq()
        const first = filter.feed(upd.slice(0, 4))
        expect(first.passthrough).toHaveLength(0)
        const second = filter.feed(upd.slice(4))
        expect(second.passthrough).toEqual(upd)
    })

    test('多条消息挤在同一帧内（含剥除）', () => {
        const filter = createRfbInputFilter()
        const input = concat(fbUpdateReq(), keyEvent(), pointerEvent(), fbUpdateReq(0), cutText('abc'))
        const result = filter.feed(input)
        expect(result.passthrough).toEqual(concat(fbUpdateReq(), fbUpdateReq(0)))
        expect(result.sawInput).toBe(true)
    })

    test('变长消息（ClientCutText/SetEncodings/Fence）载荷跨帧', () => {
        const filter = createRfbInputFilter()
        const cut = cutText('long payload text')
        const enc = setEncodings(3)
        const fence = clientFence(8)
        // 每条消息都从中间劈开
        const parts = [cut.slice(0, 5), cut.slice(5), enc.slice(0, 3), enc.slice(3), fence.slice(0, 12), fence.slice(12)]
        const passthrough = parts.map((p) => filter.feed(p).passthrough)
        expect(concat(...passthrough)).toEqual(concat(enc, fence))
    })

    test('reset 清空跨帧残留', () => {
        const filter = createRfbInputFilter()
        filter.feed(keyEvent().slice(0, 2))
        filter.reset()
        const result = filter.feed(fbUpdateReq())
        // 残留被丢弃后重新按消息边界解析
        expect(result.passthrough).toEqual(fbUpdateReq())
    })
})

describe('rfb input filter: 协议错误', () => {
    test('未知消息类型抛 RfbProtocolError', () => {
        const filter = createRfbInputFilter()
        expect(() => filter.feed(msg(0x7f))).toThrow(RfbProtocolError)
    })

    test('未知类型的字节不会污染后续解析（错误即终止，剩余交还调用方处置）', () => {
        const filter = createRfbInputFilter()
        expect(() => filter.feed(concat(fbUpdateReq(), msg(0x7f)))).toThrow(RfbProtocolError)
    })
})

function concat(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array {
    const total = parts.reduce((sum, a) => sum + a.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const a of parts) {
        out.set(a, offset)
        offset += a.byteLength
    }
    return out
}
