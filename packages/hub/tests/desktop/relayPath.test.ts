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
 * RelayPath 相位机的表驱动测试：接口是纯字节进出（feed / peerJoined → RelayAction），
 * 不持有任何 socket——相位转移（metadata 门、早期缓冲、握手代认证、输入过滤、
 * 控制权追平）全部在这里验证，broker 的 WS 胶水由 transport.test 兜底。
 * 「metadata 门后缓冲、加入时移交」用例是「RFB 首字节不丢」跨包不变量的
 * hub 端契约测试（协议陈述见 shared/desktopProtocol.ts 顶部）。
 */

import { describe, expect, test } from 'bun:test'
import { RelayPath, type RelayAction, type RelayTarget } from '../../src/desktop/relayPath'

const enc = new TextEncoder()

/** attach metadata 首帧（二进制 JSON，与 cli streamTransport 的上行形状一致） */
const metadataFrame = (machineId: string, vncPassword?: string) =>
    enc.encode(JSON.stringify({ protocol: 'mobi-desktop-1', machineId, ...(vncPassword ? { vncPassword } : {}) }))

const rfbVersion = (minor = '008') => enc.encode(`RFB 003.${minor}\n`)

/** 测试 harness：记录 forward / fail 动作与输入观测次数 */
function makePath(options: { machineId?: string; maxFrameBytes?: number } = {}) {
    const machineId = options.machineId ?? 'machine-1'
    const forwards: Array<{ target: RelayTarget; data: Uint8Array }> = []
    const reasons: string[] = []
    let inputObservedCount = 0
    const path = new RelayPath({
        machineId,
        maxFrameBytes: options.maxFrameBytes ?? 4 * 1024 * 1024,
        onInputObserved: () => {
            inputObservedCount += 1
        },
    })
    const run = (actions: RelayAction[]) => {
        for (const action of actions) {
            if (action.kind === 'forward') {
                forwards.push({ target: action.target, data: action.data })
            } else {
                reasons.push(action.reason)
            }
        }
    }
    const forwardedTo = (target: RelayTarget) => forwards.filter((f) => f.target === target).map((f) => f.data)
    return { path, run, forwards, forwardedTo, reasons, inputObserved: () => inputObservedCount, machineId }
}

/** 标准链路走到 live（None 认证全握手），返回 harness */
function livePath(): ReturnType<typeof makePath> {
    const h = makePath()
    h.run(h.path.peerJoined('attach'))
    h.run(h.path.feed('attach', metadataFrame(h.machineId)))
    h.run(h.path.peerJoined('observe'))
    h.run(h.path.feed('attach', rfbVersion()))
    h.run(h.path.feed('observe', rfbVersion()))
    h.run(h.path.feed('attach', Uint8Array.of(1, 1))) // 上游只提供 None
    h.run(h.path.feed('observe', Uint8Array.of(1))) // 浏览器选 None
    h.run(h.path.feed('attach', new Uint8Array(4))) // SecurityResult ok
    return h
}

describe('RelayPath metadata 门', () => {
    test('非二进制首帧 → invalid attach metadata', () => {
        const h = makePath()
        h.run(h.path.feed('attach', 'not binary'))
        expect(h.reasons).toEqual(['invalid attach metadata'])
        expect(h.forwards).toEqual([])
    })

    test('machineId 不符 → attach metadata mismatch', () => {
        const h = makePath({ machineId: 'expected' })
        h.run(h.path.feed('attach', metadataFrame('other-machine')))
        expect(h.reasons).toEqual(['attach metadata mismatch'])
    })

    test('metadata 通过后握手前的上游字节被缓冲，observe 加入后移交（首字节不丢）', () => {
        const h = makePath()
        h.run(h.path.peerJoined('attach'))
        h.run(h.path.feed('attach', metadataFrame(h.machineId)))
        // observe 未加入：上游立即发出的版本串必须缓冲而非转发
        h.run(h.path.feed('attach', rfbVersion()))
        expect(h.forwards).toEqual([])

        h.run(h.path.peerJoined('observe'))
        // 移交握手代理 → 代理向浏览器发固定的 3.8 版本串
        expect(h.forwardedTo('observe')).toEqual([rfbVersion()])
    })

    test('observe 先加入：浏览器字节同样缓冲，attach 加入并握手后排空', () => {
        const h = makePath()
        h.run(h.path.peerJoined('observe'))
        h.run(h.path.feed('observe', rfbVersion()))
        expect(h.forwards).toEqual([])

        h.run(h.path.peerJoined('attach'))
        h.run(h.path.feed('attach', metadataFrame(h.machineId)))
        // 代理此刻建立，缓冲的浏览器版本串已入代理（等上游版本串到齐才转发）
        h.run(h.path.feed('attach', rfbVersion('889')))
        // 上游 Apple 003.889：浏览器仍收到归一的 3.8 版本串（代认证时序）
        expect(h.forwardedTo('observe')).toEqual([rfbVersion()])
        expect(h.forwardedTo('attach')).toEqual([rfbVersion()])
    })
})

describe('RelayPath 握手相位', () => {
    test('None 认证全握手：字节按代理时序转发，live 后直通', () => {
        const h = livePath()
        expect(h.reasons).toEqual([])
        // 握手期：浏览器收版本串/None offer/SecurityResult；上游收浏览器版本串与 None 选择
        expect(h.forwardedTo('observe')).toEqual([rfbVersion(), Uint8Array.of(1, 1), new Uint8Array(4)])
        expect(h.forwardedTo('attach')).toEqual([rfbVersion(), Uint8Array.of(1)])
        // live 后：两侧字节直通，不再经过代理
        h.forwards.length = 0
        h.run(h.path.feed('observe', Uint8Array.of(1))) // ClientInit
        h.run(h.path.feed('attach', rfbVersion())) // ServerInit 起的任意字节
        expect(h.forwardedTo('attach')).toEqual([Uint8Array.of(1)])
        expect(h.forwardedTo('observe')).toEqual([rfbVersion()])
    })

    test('上游 VNC-auth：代答挑战，密码不出 hub', () => {
        const h = makePath()
        h.run(h.path.peerJoined('attach'))
        h.run(h.path.feed('attach', metadataFrame(h.machineId, 'vnc-pass')))
        h.run(h.path.peerJoined('observe'))
        h.run(h.path.feed('attach', rfbVersion()))
        h.run(h.path.feed('observe', rfbVersion()))
        h.run(h.path.feed('attach', Uint8Array.of(1, 2))) // 上游仅提供 VNC-auth
        h.run(h.path.feed('observe', Uint8Array.of(1)))
        // 浏览器选择被翻译成 VNC-auth，随后挑战由代答回应（标准 RFB 为 8 字节应答；
        // 真实 DES 密文随 challenge/password 变化，只断言形状）
        h.run(h.path.feed('attach', new Uint8Array(16)))
        const [version, choice, response] = h.forwardedTo('attach')
        expect(version).toEqual(rfbVersion())
        expect(choice).toEqual(Uint8Array.of(2))
        expect(response.byteLength).toBe(8)
        h.run(h.path.feed('attach', new Uint8Array(4))) // SecurityResult ok
        expect(h.reasons).toEqual([])
        // 浏览器只见 None-only offer（不弹密码框），代答对它透明
        expect(h.forwardedTo('observe')).toEqual([rfbVersion(), Uint8Array.of(1, 1), new Uint8Array(4)])
    })

    test('上游版本不可代认证 → unsupported rfb version', () => {
        const h = makePath()
        h.run(h.path.peerJoined('attach'))
        h.run(h.path.feed('attach', metadataFrame(h.machineId)))
        h.run(h.path.peerJoined('observe'))
        h.run(h.path.feed('attach', enc.encode('RFB 003.007\n')))
        expect(h.reasons).toEqual(['unsupported rfb version'])
        expect(h.forwards).toEqual([])
    })
})

/** live 且 ClientInit 已直通（过滤器进入消息解析相位）的 harness：live 后 observe 首字节必是 ClientInit */
function liveStreamingPath(): ReturnType<typeof makePath> {
    const h = livePath()
    h.run(h.path.feed('observe', Uint8Array.of(1))) // ClientInit
    h.forwards.length = 0
    return h
}

describe('RelayPath live 相位与输入过滤', () => {
    test('view-only：输入类消息剥除，观看必需消息放行', () => {
        const h = liveStreamingPath()
        h.run(h.path.feed('observe', Uint8Array.of(4, 0, 0, 0, 0, 0, 0, 0))) // KeyEvent
        expect(h.forwardedTo('attach')).toEqual([])
        const fbReq = Uint8Array.of(3, 0, 0, 0, 0, 0, 0, 0, 0, 0) // FramebufferUpdateRequest
        h.run(h.path.feed('observe', fbReq))
        expect(h.forwardedTo('attach')).toEqual([fbReq])
        expect(h.inputObserved()).toBe(0)
    })

    test('controlled：输入放行并触发输入观测，SetDesktopSize 恒剥', () => {
        const h = liveStreamingPath()
        h.path.setControlled(true)
        const keyEvent = Uint8Array.of(4, 0, 0, 0, 0, 0, 0, 1)
        h.run(h.path.feed('observe', keyEvent))
        expect(h.forwardedTo('attach')).toEqual([keyEvent])
        expect(h.inputObserved()).toBe(1)
        const setDesktopSize = Uint8Array.of(251, 0, 0, 0, 0, 0, 0, 0) // screens=0
        h.run(h.path.feed('observe', setDesktopSize))
        expect(h.forwardedTo('attach')).toEqual([keyEvent])
        // sawInput 含被剥除的输入类消息（sawInput 与原 broker 语义一致），同样重置空闲计时
        expect(h.inputObserved()).toBe(2)
    })

    test('握手期间授予控制权：live 后过滤器已处于 controlled（相位追平）', () => {
        const h = makePath()
        h.run(h.path.peerJoined('attach'))
        h.run(h.path.feed('attach', metadataFrame(h.machineId)))
        h.run(h.path.peerJoined('observe'))
        h.path.setControlled(true) // 握手未 live，此时授予
        h.run(h.path.feed('observe', rfbVersion()))
        h.run(h.path.feed('attach', rfbVersion()))
        h.run(h.path.feed('attach', Uint8Array.of(1, 1)))
        h.run(h.path.feed('observe', Uint8Array.of(1)))
        h.run(h.path.feed('attach', new Uint8Array(4)))
        h.run(h.path.feed('observe', Uint8Array.of(1))) // ClientInit
        h.forwards.length = 0
        const keyEvent = Uint8Array.of(4, 0, 0, 0, 0, 0, 0, 1)
        h.run(h.path.feed('observe', keyEvent))
        expect(h.forwardedTo('attach')).toEqual([keyEvent])
        expect(h.inputObserved()).toBe(1)
    })

    test('半截 KeyEvent 跨帧：收齐后才按完整消息决策', () => {
        const h = liveStreamingPath()
        h.path.setControlled(true)
        h.run(h.path.feed('observe', Uint8Array.of(4, 1)))
        expect(h.forwardedTo('attach')).toEqual([])
        h.run(h.path.feed('observe', Uint8Array.of(0, 0, 0, 0, 0, 1)))
        expect(h.forwardedTo('attach')).toEqual([Uint8Array.of(4, 1, 0, 0, 0, 0, 0, 1)])
    })

    test('未知消息类型 → rfb input parse failed（过滤器是安全边界）', () => {
        const h = liveStreamingPath()
        h.run(h.path.feed('observe', Uint8Array.of(99, 0, 0, 0, 0)))
        expect(h.reasons).toEqual(['rfb input parse failed'])
    })
})

describe('RelayPath 帧守卫', () => {
    test('超过帧上限 → frame too large', () => {
        const h = makePath({ maxFrameBytes: 128 })
        h.run(h.path.peerJoined('attach'))
        h.run(h.path.feed('attach', metadataFrame(h.machineId)))
        h.run(h.path.peerJoined('observe'))
        h.run(h.path.feed('observe', new Uint8Array(129)))
        expect(h.reasons).toEqual(['frame too large'])
    })
})
