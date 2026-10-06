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
 * 「一个会话同时只允许一条 CLI socket」的接管仲裁表。
 *
 * 没有它时，同一 session 的两条连接会短暂并存（daemon 重启后旧 CLI 重连与唤醒新 CLI
 * 是真实场景）：RpcRegistry 的后写覆盖把方法映射判给后到者；先到者此后断开时
 * `unregisterAll` 连根拔掉唯一有效注册——幸存的 CLI 从此对所有会话 RPC 不可达，
 * web 端彻底失去对 Claude Code 进程的管理（2026-09-30 事故）。
 *
 * 规则：新连接接管（挤掉旧连接），保证任意时刻「持有方法映射的连接」与「活跃连接」
 * 唯一。被踢方迟到的 unregisterAll 由 RpcRegistry 的持有者守卫挡住（映射已指向
 * 新 socket.id，条件不命中不删），因此踢旧与注册覆盖之间无需额外同步。
 */
export class SessionSocketOwners {
    private readonly owners = new Map<string, string>()

    /**
     * 新连接接管：记录新持有者，返回被挤掉的旧 socket id（无则 null）。
     * 调用方负责据此断开旧连接——本类只管簿记，不断 socket。
     */
    takeOver(key: string, socketId: string): string | null {
        const prev = this.owners.get(key) ?? null
        this.owners.set(key, socketId)
        return prev !== socketId ? prev : null
    }

    /** 持有者断开才移除；被接管方迟到的 disconnect 是 no-op */
    release(key: string, socketId: string): void {
        if (this.owners.get(key) === socketId) {
            this.owners.delete(key)
        }
    }
}
