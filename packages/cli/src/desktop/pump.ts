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
 * 双向字节流泵（desktop 流的核心，transport 无关）。
 *
 * 两个 PumpEndpoint 之间的对称中继：A 的帧送 B、B 的帧送 A；
 * 目标写不动（send 返回 false）即暂停来源读取，目标缓冲排空（onDrain）后恢复。
 * 端点形状由适配器提供（内存 Duplex / Bun WebSocket / net.Socket），
 * 泵本体不感知传输——这是它可以用两根内存 Duplex 做单元测试的原因。
 */

export interface PumpEndpoint {
    /** 发送一帧；返回 false 表示目标背压（来源侧应暂停读取） */
    send(data: Uint8Array): boolean
    /** 暂停本端读取（把背压传导给对本端说话的人） */
    pause(): void
    /** 恢复本端读取 */
    resume(): void
    /** 注册缓冲排空回调（send 返回 false 后保证触发一次） */
    onDrain(callback: () => void): void
    /** 关闭本端 */
    close(): void
    isOpen(): boolean
}

export type PumpSide = 'a' | 'b'

export interface StreamPump {
    /** 来源侧送来一帧（来源侧数据处理器里调用） */
    feed(source: PumpSide, data: Uint8Array): void
    /** 统一拆除：双侧关闭，幂等 */
    teardown(reason?: string): void
    /** teardown 的通知（日志/归因/上层 Promise settle） */
    onTeardown(callback: (reason: string) => void): void
}

/** Duplex（net.Socket / PassThrough 等）→ PumpEndpoint 适配器 */
export function duplexEndpoint(stream: {
    write(data: Uint8Array): boolean
    pause(): void
    resume(): void
    on(event: 'drain', listener: () => void): unknown
    destroy(): void
    destroyed?: boolean
}): PumpEndpoint {
    return {
        send: (data) => stream.write(data),
        pause: () => stream.pause(),
        resume: () => stream.resume(),
        onDrain: (callback) => {
            stream.on('drain', callback)
        },
        close: () => stream.destroy(),
        isOpen: () => !stream.destroyed,
    }
}

export function createStreamPump(a: PumpEndpoint, b: PumpEndpoint): StreamPump {
    let tornDown = false
    let teardownReason = ''
    const teardownCallbacks: Array<(reason: string) => void> = []

    const teardown = (reason = 'closed'): void => {
        if (tornDown) {
            return
        }
        tornDown = true
        teardownReason = reason
        a.close()
        b.close()
        for (const callback of teardownCallbacks) {
            callback(reason)
        }
    }

    // 背压传导：目标排空 → 恢复来源读取（setup 时各注册一次）
    b.onDrain(() => {
        if (!tornDown && a.isOpen()) {
            a.resume()
        }
    })
    a.onDrain(() => {
        if (!tornDown && b.isOpen()) {
            b.resume()
        }
    })

    const feed = (source: PumpSide, data: Uint8Array): void => {
        if (tornDown) {
            return
        }
        const target = source === 'a' ? b : a
        const origin = source === 'a' ? a : b
        if (!target.isOpen()) {
            teardown(`${source === 'a' ? 'b' : 'a'}-closed`)
            return
        }
        const ok = target.send(data)
        if (!ok && origin.isOpen()) {
            origin.pause()
        }
    }

    return {
        feed,
        teardown,
        onTeardown(callback) {
            if (tornDown) {
                callback(teardownReason)
                return
            }
            teardownCallbacks.push(callback)
        },
    }
}
