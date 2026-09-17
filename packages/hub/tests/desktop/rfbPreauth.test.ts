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
import { RfbHandshakeProxy, vncAuthResponse, encodeAuthFailure } from '../../src/desktop/rfbPreauth'

const SERVER_VERSION = new TextEncoder().encode('RFB 003.008\n')
const CLIENT_VERSION = new TextEncoder().encode('RFB 003.008\n')

/** 帧收集器：模拟 hub 向两侧的下行写 */
function makeCollector() {
    const toBrowser: Uint8Array[] = []
    const toServer: Uint8Array[] = []
    return {
        toBrowser,
        toServer,
        onToBrowser: (data: Uint8Array) => toBrowser.push(data),
        onToServer: (data: Uint8Array) => toServer.push(data),
        onDone: () => undefined,
    }
}

describe('vncAuthResponse（VNC DES 挑战应答）', () => {
    test('已知向量：密码 00000000 + 前 8 字节全零挑战 = 88f8569b4502edfa', () => {
        // 向量出处：与 noVNC genDES（真机验证的参考实现）交叉验证一致
        //（曾误记 2ee3b59d... 为该输入的结果——错误锚点，已用 noVNC 权威值替换）
        const challenge = new Uint8Array(8)
        expect([...vncAuthResponse(challenge, '00000000')].map((b) => b.toString(16).padStart(2, '0')).join(''))
            .toBe('88f8569b4502edfa')
    })

    test('应答长度与传入 challenge 等长（标准 8 字节 / Apple 889 传 16 字节）', () => {
        expect(vncAuthResponse(new Uint8Array(8).fill(0xab), 'abcdefgh')).toHaveLength(8)
        expect(vncAuthResponse(new Uint8Array(16).fill(0xab), 'abcdefgh')).toHaveLength(16)
    })
})

describe('RfbHandshakeProxy（上游提供 VNC-auth，hub 代答）', () => {
    test('安全类型重写：浏览器只看到 None；挑战由 hub 用密码应答', () => {
        const col = makeCollector()
        const proxy = new RfbHandshakeProxy('secret1', col)

        // 1. 上游版本 → 浏览器
        proxy.feedServer(SERVER_VERSION)
        expect(col.toBrowser[0]).toEqual(SERVER_VERSION)

        // 2. 浏览器版本 → 上游
        proxy.feedBrowser(CLIENT_VERSION)
        expect(col.toServer[0]).toEqual(CLIENT_VERSION)

        // 3. 上游仅提供 VNC-auth → 浏览器看到重写后的 [None]
        proxy.feedServer(new Uint8Array([1, 2]))
        expect(col.toBrowser[1]).toEqual(new Uint8Array([1, 1]))

        // 4. 浏览器选 None → hub 对上游发 VNC-auth
        proxy.feedBrowser(new Uint8Array([1]))
        expect(col.toServer[1]).toEqual(new Uint8Array([2]))

        // 5. 上游 challenge → hub 代答（16 字节读入，8 字节 response 回上游，浏览器无感知）
        const challenge = new Uint8Array(16).fill(0x5a)
        proxy.feedServer(challenge)
        expect(col.toServer[2]).toHaveLength(8)
        expect(col.toBrowser).toHaveLength(2) // 浏览器侧无新帧

        // 6. 上游 SecurityResult OK → 浏览器收到 OK，握手完成
        proxy.feedServer(new Uint8Array([0, 0, 0, 0]))
        expect(col.toBrowser[2]).toEqual(new Uint8Array([0, 0, 0, 0]))
        expect(proxy.phase).toBe('live')
    })

    test('onDone(true) 在 SecurityResult 转发后触发', () => {
        const col = makeCollector()
        const done: Array<{ ok: boolean; reason?: string }> = []
        const proxy = new RfbHandshakeProxy('secret1', { ...col, onDone: (ok, reason) => done.push({ ok, reason }) })

        proxy.feedServer(SERVER_VERSION)
        proxy.feedBrowser(CLIENT_VERSION)
        proxy.feedServer(new Uint8Array([2, 1, 2]))
        proxy.feedBrowser(new Uint8Array([1]))
        proxy.feedServer(new Uint8Array(16))
        proxy.feedServer(new Uint8Array([0, 0, 0, 0]))

        expect(done).toEqual([{ ok: true, reason: undefined }])
    })

    test('认证失败（SecurityResult 非 0）→ 浏览器收到标准失败序列（含 reason），onDone(false)', () => {
        const col = makeCollector()
        const done: Array<{ ok: boolean; reason?: string }> = []
        const proxy = new RfbHandshakeProxy('wrongpwd', { ...col, onDone: (ok, reason) => done.push({ ok, reason }) })

        proxy.feedServer(SERVER_VERSION)
        proxy.feedBrowser(CLIENT_VERSION)
        proxy.feedServer(new Uint8Array([1, 2])) // 仅 VNC-auth
        proxy.feedBrowser(new Uint8Array([1]))
        proxy.feedServer(new Uint8Array(16))
        proxy.feedServer(new Uint8Array([0, 0, 0, 1]))

        // RFB 3.8 失败序列：result=1 + reason string，noVNC 据此展示可理解文案
        expect(col.toBrowser.at(-1)).toEqual(encodeAuthFailure('vnc auth failed'))
        expect(done).toEqual([{ ok: false, reason: 'vnc auth failed' }])
        expect(proxy.phase).toBe('failed')
    })
})

describe('RfbHandshakeProxy（上游提供 None，无需密码）', () => {
    test('None 选取直接透传，SecurityResult 转发后完成', () => {
        const col = makeCollector()
        const done: Array<{ ok: boolean; reason?: string }> = []
        const proxy = new RfbHandshakeProxy(undefined, { ...col, onDone: (ok, reason) => done.push({ ok, reason }) })

        proxy.feedServer(SERVER_VERSION)
        proxy.feedBrowser(CLIENT_VERSION)
        proxy.feedServer(new Uint8Array([1, 1])) // 只提供 None
        expect(col.toBrowser[1]).toEqual(new Uint8Array([1, 1]))

        proxy.feedBrowser(new Uint8Array([1])) // 浏览器选 None → 原样转发上游
        expect(col.toServer[1]).toEqual(new Uint8Array([1]))

        // 3.8 None 也有 SecurityResult
        proxy.feedServer(new Uint8Array([0, 0, 0, 0]))
        expect(col.toBrowser[2]).toEqual(new Uint8Array([0, 0, 0, 0]))
        expect(done).toEqual([{ ok: true, reason: undefined }])
    })
})

describe('RfbHandshakeProxy（错误路径）', () => {
    test('上游仅提供 VNC-auth 且无密码 → onDone(false, vnc password not configured)', () => {
        const col = makeCollector()
        const done: Array<{ ok: boolean; reason?: string }> = []
        const proxy = new RfbHandshakeProxy(undefined, { ...col, onDone: (ok, reason) => done.push({ ok, reason }) })

        proxy.feedServer(SERVER_VERSION)
        proxy.feedBrowser(CLIENT_VERSION)
        proxy.feedServer(new Uint8Array([1, 2]))

        expect(done).toEqual([{ ok: false, reason: 'vnc password not configured' }])
        expect(proxy.phase).toBe('failed')
    })

    test('上游不支持 3.8 → onDone(false, unsupported version)', () => {
        const col = makeCollector()
        const done: Array<{ ok: boolean; reason?: string }> = []
        const proxy = new RfbHandshakeProxy('secret1', { ...col, onDone: (ok, reason) => done.push({ ok, reason }) })

        proxy.feedServer(new TextEncoder().encode('RFB 003.007\n'))
        expect(done).toEqual([{ ok: false, reason: 'unsupported rfb version' }])
    })

    test('跨帧粘包：challenge 分两帧到达也能正确应答', () => {
        const col = makeCollector()
        const proxy = new RfbHandshakeProxy('secret1', col)

        proxy.feedServer(SERVER_VERSION)
        proxy.feedBrowser(CLIENT_VERSION)
        // 上游仅提供 VNC-auth，challenge 的前 2 字节粘在 types 帧（协议外时序的防御性缓冲）
        proxy.feedServer(new Uint8Array([1, 2, 0xaa, 0xbb]))
        expect(col.toBrowser[1]).toEqual(new Uint8Array([1, 1]))

        // 浏览器选 None → hub 对上游发 VNC-auth
        proxy.feedBrowser(new Uint8Array([1]))
        expect(col.toServer[1]).toEqual(new Uint8Array([2]))

        // challenge 需要补齐 16 字节后才应答
        proxy.feedServer(new Uint8Array(14).fill(0x01))
        expect(col.toServer[2]).toHaveLength(8)
    })
})
