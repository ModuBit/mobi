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
 * 最小假 RFB server（demo/联调用，非生产代码）。
 *
 * 说话 RFB 3.8 + None 认证 + raw 编码：握手后把每个FramebufferUpdateRequest
 * 回以一帧渐变测试画面（按请求序号变色，便于肉眼确认「画面在动」）。
 * 运行：bun packages/cli/scripts/fake-rfb-server.ts [port]（默认 15900）
 * 配合 mobi：MOBI_DESKTOP_VNC_PORT=15900 启动 cli 后在 web 观看页看到测试画面。
 */

import net from 'node:net'

const port = Number(process.argv[2] ?? 15900)
const width = 400
const height = 300

const RFB_VERSION = Buffer.from('RFB 003.008\n', 'ascii')

/** ServerInit：尺寸 + 32bpp true-colour 像素格式 + 名字 */
function serverInit(): Buffer {
    const name = Buffer.from('mobi-fake-rfb', 'ascii')
    const buf = Buffer.alloc(24 + name.length)
    buf.writeUInt16BE(width, 0)
    buf.writeUInt16BE(height, 2)
    let o = 4
    buf.writeUInt8(32, o++) // bits-per-pixel
    buf.writeUInt8(24, o++) // depth
    buf.writeUInt8(0, o++) // big-endian
    buf.writeUInt8(1, o++) // true-colour
    buf.writeUInt16BE(255, o); o += 2 // red-max
    buf.writeUInt16BE(255, o); o += 2 // green-max
    buf.writeUInt16BE(255, o); o += 2 // blue-max
    buf.writeUInt8(16, o++) // red-shift
    buf.writeUInt8(8, o++) // green-shift
    buf.writeUInt8(0, o++) // blue-shift
    o += 3 // padding
    buf.writeUInt32BE(name.length, o); o += 4
    name.copy(buf, o)
    return buf
}

/** raw 编码的整帧测试画面：水平渐变基调 + 按帧序号滚动的色带 */
let frameSeq = 0
function framebufferUpdate(): Buffer {
    const seq = frameSeq++
    // rect 头 12 字节（x/y/w/h/encoding），多 1 字节都会让 noVNC 字节流错位
    const rects = Buffer.alloc(12 + width * height * 4)
    rects.writeUInt16BE(0, 0) // x
    rects.writeUInt16BE(0, 2) // y
    rects.writeUInt16BE(width, 4)
    rects.writeUInt16BE(height, 6)
    rects.writeUInt32BE(0, 8) // encoding: raw
    const pixels = rects.subarray(12)
    for (let y = 0; y < height; y++) {
        const band = Math.floor((y + seq * 8) / 40) % 3
        const g = band === 0 ? 220 : 40
        const b = band === 1 ? 220 : 40
        const r = band === 2 ? 220 : 40
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4
            pixels[o] = Math.min(255, r + (x % 32))
            pixels[o + 1] = g
            pixels[o + 2] = b
            pixels[o + 3] = 255
        }
    }
    const header = Buffer.alloc(4)
    header.writeUInt8(0, 0) // message type: FramebufferUpdate
    header.writeUInt8(0, 1)
    header.writeUInt16BE(1, 2) // num-rects
    return Buffer.concat([header, rects])
}

net.createServer((sock) => {
    console.log('[fake-rfb] client connected')
    let buffer = Buffer.alloc(0)
    let stage: 'version' | 'security-type' | 'security-result' | 'client-init' | 'live' = 'version'
    let write = (data: Buffer) => sock.write(data)

    write(RFB_VERSION)

    // 帧率节流：noVNC 收到 update 会立即请求下一帧，无节流时全帧刷屏打满浏览器主线程。
    // 间隔内的请求不丢弃（noVNC 等 update 才会发下一个 request，丢弃即死锁），延迟到点发送
    const FRAME_INTERVAL_MS = 500
    let lastFrameAt = 0
    let frameTimer: ReturnType<typeof setTimeout> | undefined
    const sendUpdate = () => {
        if (frameTimer) return
        const delay = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - lastFrameAt))
        frameTimer = setTimeout(() => {
            frameTimer = undefined
            lastFrameAt = Date.now()
            write(framebufferUpdate())
        }, delay)
        frameTimer.unref?.()
    }

    sock.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
            if (stage === 'version') {
                if (buffer.length < 12) return
                buffer = buffer.subarray(12)
                // security types: 1 种（None）
                write(Buffer.from([0x01, 0x01]))
                stage = 'security-type'
            } else if (stage === 'security-type') {
                if (buffer.length < 1) return
                buffer = buffer.subarray(1)
                // SecurityResult: OK（3.8 起None 也要求回）
                write(Buffer.from([0, 0, 0, 0]))
                stage = 'security-result'
            } else if (stage === 'security-result') {
                if (buffer.length < 1) return
                buffer = buffer.subarray(1) // ClientInit shared-flag
                write(serverInit())
                stage = 'live'
            } else {
                // live：逐条吃 client message；只处理 FramebufferUpdateRequest
                if (buffer.length < 1) return
                const type = buffer[0]
                if (type === 0) {
                    // FramebufferUpdateRequest: type(1) incremental(1) x(2) y(2) w(2) h(2)
                    if (buffer.length < 10) return
                    buffer = buffer.subarray(10)
                    sendUpdate()
                } else if (type === 2) {
                    if (buffer.length < 4) return // SetPixelFormat: type(1) padding(3) + 16
                    buffer = buffer.subarray(20)
                } else if (type === 4) {
                    // SetEncodings: type(1) padding(1) count(2) + count*4
                    if (buffer.length < 4) return
                    const count = buffer.readUInt16BE(2)
                    const total = 4 + count * 4
                    if (buffer.length < total) return
                    buffer = buffer.subarray(total)
                } else {
                    buffer = Buffer.alloc(0)
                }
            }
        }
    })
    sock.on('error', (err) => console.log('[fake-rfb] socket error:', err.message))
    sock.on('close', () => console.log('[fake-rfb] client disconnected'))
}).listen(port, '127.0.0.1', () => {
    console.log(`[fake-rfb] listening on 127.0.0.1:${port} (${width}x${height}, raw)`)
})
