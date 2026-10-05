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
 * loopback 代理豁免：保证 mobi 进程的自访流量（127.0.0.1 / localhost / ::1）
 * 永远直连、不经过 HTTP 代理。
 *
 * 背景（2026-10-05 生产故障）：用户 shell 常驻 http_proxy（本地代理网关）且无
 * no_proxy，supervisor/daemon 从 shell 继承后，健康门 isUrlOk 对
 * http://127.0.0.1:<port>/health 的 fetch 被代理劫持回 502——restart 实际成功
 * 却 30s 超时误报 "health check failed"，CLI 后续 axios API 调用同样吃到 502。
 *
 * 实现：向 no_proxy / NO_PROXY（大小写各一份，覆盖不同 HTTP 客户端的读取习惯）
 * 合并 loopback 条目，保留既有条目、幂等。Bun fetch 与 axios 都在请求时惰性
 * 读取环境变量，入口处归一化一次即对全进程（及后续 spawn 的子进程）生效。
 *
 * 调用位置：CLI 组合根（packages/cli/src/index.ts）——所有 mobi 进程
 * （supervisor / daemon start-sync / 单发命令）都经 CLI 入口 spawn，env 随之继承。
 */

/** mobi 自访的 loopback 主机名集合 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'] as const

export function ensureLoopbackBypassesProxy(): void {
    for (const key of ['no_proxy', 'NO_PROXY']) {
        const existing = (process.env[key] ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        process.env[key] = [...new Set([...existing, ...LOOPBACK_HOSTS])].join(',')
    }
}
